import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { configureCloudflare } from './configure-cloudflare.mjs';
import { isMainModule, projectRoot, validateDeploymentEnvironment } from './check-deploy-config.mjs';
import { githubRequest } from './select-release.mjs';
import { assertCheckedOutCommit, releaseContext, useReleaseConfig, verifyRelease } from './release-artifact.mjs';

export function runNodeCommand(script, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: projectRoot, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...options.env },
      stdio: options.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    });
    child.on('error', () => reject(new Error('Could not start the deployment command. Check the installed dependencies.')));
    child.on('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`Deployment command failed (${signal || code}).`)));
    if (options.input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(options.input);
    }
  });
}

async function buildApp() {
  if (process.env.npm_execpath) return runNodeCommand(process.env.npm_execpath, ['run', 'build']);
  // Allows `node --env-file=.deployment.env scripts/deploy.mjs` as well as npm.
  return new Promise((done, reject) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
      cwd: projectRoot, stdio: 'inherit', env: process.env, shell: process.platform === 'win32',
    });
    child.once('error', () => reject(new Error('npm is unavailable. Install Node.js with npm and run npm ci first.')));
    child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`Build failed (${signal || code}).`)));
  });
}

export async function deploy(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('Usage: node scripts/deploy.mjs --dry-run | --apply [--verified-release]\n--dry-run builds and checks locally; --apply applies remote D1 migrations and deploys.\n--verified-release is reserved for CI: validate and publish its exact successful Checks artifact without rebuilding.\nReads CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, PUBLIC_APP_ORIGIN and GOOGLE_CLIENT_ID.\nCLOUDFLARE_API_TOKEN authenticates CI. RAPIDAPI_KEY is optional and is sent through stdin.');
    return;
  }
  const verified = args.length === 2 && args[0] === '--apply' && args[1] === '--verified-release';
  if (!verified && (args.length !== 1 || !['--dry-run', '--apply'].includes(args[0]))) {
    throw new Error('Choose --dry-run for a local deployment check, or --apply to deploy to Cloudflare.');
  }
  validateDeploymentEnvironment();
  const wrangler = resolve(projectRoot, 'node_modules/wrangler/bin/wrangler.js');
  await access(wrangler);
  // Compilation or verified artifact validation must precede all remote changes.
  let context;
  if (verified) {
    if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Verified artifact deployment is only supported inside the release workflow.');
    context = releaseContext();
    assertCheckedOutCommit(context.sha);
    await verifyRelease(context);
  } else await buildApp();
  let config = await configureCloudflare();
  if (verified) {
    config = useReleaseConfig(config);
    await writeFile(resolve(projectRoot, 'wrangler.deploy.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    // Check again immediately before migrations: main may have advanced while
    // waiting for an environment approval or downloading dependencies/artifacts.
    const branch = await githubRequest(`/repos/${context.repository}/git/ref/heads/main`);
    if (branch.object?.sha !== context.sha) throw new Error('Main has advanced; refusing to deploy an older verified release. Run deployment again for current main.');
  }
  if (args[0] === '--dry-run') {
    await mkdir(resolve(projectRoot, '.deploy-dry-run'), { recursive: true });
    await runNodeCommand(wrangler, ['deploy', '--config', 'wrangler.deploy.json', '--dry-run', '--outdir', '.deploy-dry-run']);
    console.log('Local deployment check passed. No migrations, secrets or code were sent to Cloudflare.');
    return;
  }
  const db = config.d1_databases.find((database) => database.binding === 'DB');
  await runNodeCommand(wrangler, ['d1', 'migrations', 'apply', db.database_name, '--remote', '--config', 'wrangler.deploy.json']);
  await runNodeCommand(wrangler, ['deploy', '--config', 'wrangler.deploy.json', ...(verified ? ['--no-bundle'] : [])]);
  if (process.env.RAPIDAPI_KEY?.trim()) {
    // No shell interpolation, command-line secret, temporary secret file or logging.
    await runNodeCommand(wrangler, ['secret', 'bulk', '--config', 'wrangler.deploy.json'], {
      input: JSON.stringify({ RAPIDAPI_KEY: process.env.RAPIDAPI_KEY.trim() }),
    });
  }
  console.log('Cloudflare deployment commands completed. Open the app to check the published experience.');
}

if (isMainModule(import.meta.url)) {
  try { await deploy(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
