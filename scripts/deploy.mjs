import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { configureCloudflare } from './configure-cloudflare.mjs';
import { isMainModule, projectRoot, validateDeploymentEnvironment } from './check-deploy-config.mjs';

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

export async function verifyDeployment(settings, expectFlightLookup = false) {
  // Retries allow Cloudflare's newly deployed version to reach the public edge.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(`${settings.origin}/api/config`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      const config = await response.json();
      if (response.ok && config.googleClientId === settings.clientId && config.syncAvailable === true
          && (!expectFlightLookup || config.flightLookupAvailable === true)) {
        console.log(`Deployment responds at ${settings.origin}. Google client and database bindings are configured.`);
        console.log('Complete a real Google sign-in and save/reload a trip to verify account sync.');
        return;
      }
    } catch { /* Network errors are retried without printing request internals. */ }
    if (attempt < 11) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  throw new Error('Deployment finished, but the public configuration check did not pass. Check PUBLIC_APP_ORIGIN, the Worker route and Google configuration.');
}

export async function deploy(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('Usage: node scripts/deploy.mjs --dry-run | --apply\n--dry-run builds and checks locally; --apply applies remote D1 migrations and deploys.\nReads CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, PUBLIC_APP_ORIGIN and GOOGLE_CLIENT_ID.\nCLOUDFLARE_API_TOKEN authenticates CI. RAPIDAPI_KEY is optional and is sent through stdin.');
    return;
  }
  if (args.length !== 1 || !['--dry-run', '--apply'].includes(args[0])) {
    throw new Error('Choose --dry-run for a local deployment check, or --apply to deploy to Cloudflare.');
  }
  const settings = validateDeploymentEnvironment();
  const wrangler = resolve(projectRoot, 'node_modules/wrangler/bin/wrangler.js');
  await access(wrangler);
  // Compilation must succeed before the first remote change, including migrations.
  await buildApp();
  const config = await configureCloudflare();
  if (args[0] === '--dry-run') {
    await mkdir(resolve(projectRoot, '.deploy-dry-run'), { recursive: true });
    await runNodeCommand(wrangler, ['deploy', '--config', 'wrangler.deploy.json', '--dry-run', '--outdir', '.deploy-dry-run']);
    console.log('Local deployment check passed. No migrations, secrets or code were sent to Cloudflare.');
    return;
  }
  const db = config.d1_databases.find((database) => database.binding === 'DB');
  await runNodeCommand(wrangler, ['d1', 'migrations', 'apply', db.database_name, '--remote', '--config', 'wrangler.deploy.json']);
  await runNodeCommand(wrangler, ['deploy', '--config', 'wrangler.deploy.json']);
  if (process.env.RAPIDAPI_KEY?.trim()) {
    // No shell interpolation, command-line secret, temporary secret file or logging.
    await runNodeCommand(wrangler, ['secret', 'bulk', '--config', 'wrangler.deploy.json'], {
      input: JSON.stringify({ RAPIDAPI_KEY: process.env.RAPIDAPI_KEY.trim() }),
    });
  }
  await verifyDeployment(settings, Boolean(process.env.RAPIDAPI_KEY?.trim()));
}

if (isMainModule(import.meta.url)) {
  try { await deploy(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
