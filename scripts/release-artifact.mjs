import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { isMainModule, parseJsonc, projectRoot } from './check-deploy-config.mjs';

export const releaseDirectory = resolve(projectRoot, 'artifacts/release');
const digest = (data) => createHash('sha256').update(data).digest('hex');

export function assertCheckedOutCommit(sha) {
  const checkedOut = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 1024 }).trim();
  if (checkedOut !== sha) throw new Error('The checkout does not match the exact verified release commit.');
}

export function releaseContext(env = process.env) {
  const context = {
    sha: env.RELEASE_SHA || env.GITHUB_SHA,
    repository: env.GITHUB_REPOSITORY,
    runId: env.RELEASE_RUN_ID || env.GITHUB_RUN_ID,
    runAttempt: env.RELEASE_RUN_ATTEMPT || env.GITHUB_RUN_ATTEMPT,
  };
  if (!/^[a-f0-9]{40}$/.test(context.sha || '')
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(context.repository || '')
      || !/^[1-9]\d*$/.test(context.runId || '')
      || !/^[1-9]\d*$/.test(context.runAttempt || '')) {
    throw new Error('Verified release requires the exact commit, repository, Checks run ID and attempt.');
  }
  return context;
}

async function inventory(directory, prefix = '') {
  const files = Object.create(null);
  for (const name of (await readdir(resolve(directory, prefix))).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    const entry = await lstat(resolve(directory, path));
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      throw new Error('Release artifacts must contain only ordinary files and directories.');
    }
    if (entry.isDirectory()) Object.assign(files, await inventory(directory, path));
    else if (path !== 'manifest.json') files[path] = digest(await readFile(resolve(directory, path)));
  }
  return files;
}

function safeManifestFiles(files) {
  return files && typeof files === 'object' && !Array.isArray(files)
    && Object.entries(files).every(([path, hash]) => !path.includes('\\') && !path.startsWith('/')
      && path.split('/').every((part) => part && part !== '.' && part !== '..')
      && /^(?:dist\/|worker\/|migrations\/|wrangler\.jsonc$)/.test(path)
      && /^[a-f0-9]{64}$/.test(hash));
}

export async function verifyRelease(context, { directory = releaseDirectory, sourceRoot = projectRoot } = {}) {
  const manifestPath = resolve(directory, 'manifest.json');
  if (!(await lstat(manifestPath)).isFile() || (await lstat(manifestPath)).isSymbolicLink()) {
    throw new Error('Release manifest must be an ordinary file.');
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.version !== 1 || Object.entries(context).some(([key, value]) => manifest[key] !== value)) {
    throw new Error('Release provenance does not match this exact commit and successful Checks run.');
  }
  if (!safeManifestFiles(manifest.files)
      || !manifest.files['dist/index.html'] || !manifest.files['worker/index.js']
      || !manifest.files['wrangler.jsonc']
      || !Object.keys(manifest.files).some((path) => /^migrations\/[^/]+\.sql$/.test(path))) {
    throw new Error('Release inventory is invalid or missing frontend, Worker, configuration or migrations.');
  }
  const actual = await inventory(directory);
  const paths = Object.keys(actual).sort();
  if (JSON.stringify(paths) !== JSON.stringify(Object.keys(manifest.files).sort())
      || paths.some((path) => actual[path] !== manifest.files[path])) {
    throw new Error('Release files differ from the verified inventory; refusing to deploy.');
  }
  // Configuration is generated at deploy time, but its source must be the same
  // configuration verified by Checks. Google configuration is runtime /api/config.
  if (digest(await readFile(resolve(sourceRoot, 'wrangler.jsonc'))) !== actual['wrangler.jsonc']) {
    throw new Error('Release configuration differs from the checked-out commit.');
  }
  const base = parseJsonc(await readFile(resolve(directory, 'wrangler.jsonc'), 'utf8'));
  if (base.build?.command) throw new Error('Verified releases cannot run a deployment-time build command.');
  return manifest;
}

export function useReleaseConfig(config, directory = releaseDirectory) {
  const path = (part) => relative(projectRoot, resolve(directory, part)).split(sep).join('/');
  return {
    ...config,
    main: path('worker/index.js'),
    no_bundle: true,
    assets: { ...config.assets, directory: path('dist') },
    d1_databases: config.d1_databases.map((database) => database.binding === 'DB'
      ? { ...database, migrations_dir: path('migrations') } : database),
  };
}

export async function createRelease(context = releaseContext()) {
  assertCheckedOutCommit(context.sha);
  await rm(releaseDirectory, { recursive: true, force: true });
  await mkdir(resolve(releaseDirectory, 'worker'), { recursive: true });
  await cp(resolve(projectRoot, 'dist'), resolve(releaseDirectory, 'dist'), { recursive: true });
  await cp(resolve(projectRoot, 'migrations'), resolve(releaseDirectory, 'migrations'), { recursive: true });
  await cp(resolve(projectRoot, 'wrangler.jsonc'), resolve(releaseDirectory, 'wrangler.jsonc'));
  // Wrangler creates the complete Worker module tree once in credential-free CI.
  // It does not rebuild the frontend already exercised by Playwright.
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve(projectRoot, 'node_modules/wrangler/bin/wrangler.js'),
      'deploy', '--config', 'wrangler.jsonc', '--dry-run', '--outdir', 'artifacts/release/worker'], {
      cwd: projectRoot, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    child.once('error', () => reject(new Error('Could not bundle the verified Worker.')));
    child.once('exit', (code) => code === 0 ? done() : reject(new Error('Verified Worker bundling failed.')));
  });
  const files = await inventory(releaseDirectory);
  // The Wrangler dry-run README contains a timestamp and is harmless, but all
  // produced sidecars are included in the inventory instead of being assumed.
  await writeFile(resolve(releaseDirectory, 'manifest.json'), `${JSON.stringify({ version: 1, ...context, files }, null, 2)}\n`);
  await verifyRelease(context);
  console.log(`Prepared verified release for ${context.sha}.`);
}

if (isMainModule(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || !['create', 'verify'].includes(process.argv[2])) {
      throw new Error('Usage: node scripts/release-artifact.mjs create|verify');
    }
    if (process.argv[2] === 'create') await createRelease();
    else {
      const context = releaseContext();
      assertCheckedOutCommit(context.sha);
      await verifyRelease(context);
      console.log('Verified release provenance and complete file inventory.');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
