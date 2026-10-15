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

// Optional, read-only diagnostics for the manually dispatched Verify production
// workflow. Public security challenges must not determine deployment success.
export async function verifyDeployment(settings, expectFlightLookup = false, options = {}) {
  const {
    fetch: fetchPublicConfig = globalThis.fetch,
    wait = (delay) => new Promise((resolvePromise) => setTimeout(resolvePromise, delay)),
    attempts = 40,
    retryDelay = 5000,
  } = options;
  if (!Number.isSafeInteger(attempts) || attempts < 1
      || !Number.isFinite(retryDelay) || retryDelay < 0 || retryDelay > 60_000) {
    throw new Error('Public verification requires a positive attempt count and a retry delay between 0 and 60000 milliseconds.');
  }
  // A first Custom Domain needs time for DNS and TLS as well as edge propagation.
  // Forty checks provide over three minutes even when every request fails quickly.
  console.log('Checking public configuration and HTTPS readiness.');
  const errorNames = new Set(['Error', 'TypeError', 'AbortError', 'TimeoutError', 'SyntaxError']);
  const networkCodes = new Set([
    'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
    'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  ]);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let diagnostic = {};
    try {
      const response = await fetchPublicConfig(`${settings.origin}/api/config`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      const mimeType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || '';
      diagnostic = {
        status: response.status,
        content: mimeType === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(mimeType) ? 'JSON'
          : ['text/html', 'application/xhtml+xml'].includes(mimeType) ? 'HTML' : 'other',
        challenge: response.headers.get('cf-mitigated') === 'challenge',
      };
      if (diagnostic.challenge) {
        const cfRay = response.headers.get('cf-ray');
        if (cfRay && /^[a-f0-9]{16}-[a-z]{3}$/i.test(cfRay)) diagnostic.cfRay = cfRay;
        // A challenge cannot be solved by a noninteractive deployment check.
        // Discard its body without parsing or logging any challenge content.
        await response.body?.cancel();
      } else {
        const config = await response.json();
        const clientMatches = config?.googleClientId === settings.clientId;
        const syncReady = config?.syncAvailable === true;
        const flightReady = !expectFlightLookup || config?.flightLookupAvailable === true;
        diagnostic = { ...diagnostic, clientMatches, syncReady, flightReady };
        if (response.ok && clientMatches && syncReady && flightReady) {
          console.log(`Public configuration responds at ${settings.origin}. Google client and database bindings are configured.`);
          console.log('Complete a real Google sign-in and save/reload a trip to verify account sync.');
          return;
        }
      }
    } catch (error) {
      // Log only categories from fixed allowlists, never server bodies or error messages.
      diagnostic = {
        ...diagnostic,
        error: errorNames.has(error?.name) ? error.name : 'other',
        networkCode: networkCodes.has(error?.cause?.code) ? error.cause.code : 'other',
      };
    }
    if (diagnostic.challenge || attempt === 0 || (attempt + 1) % 6 === 0) {
      const nextStep = diagnostic.challenge ? 'blocked by a Cloudflare security challenge.'
        : attempt < attempts - 1 ? 'retrying.' : 'no checks remain.';
      console.log(`Public configuration is not ready (check ${attempt + 1}/${attempts}; ${JSON.stringify(diagnostic)}); ${nextStep}`);
    }
    if (diagnostic.challenge) {
      throw new Error('Cloudflare security challenge blocked GET /api/config. Open the zone\'s Security Events in the Cloudflare dashboard, filter by the configured public origin and GET /api/config, and review the matching rule before rerunning verification. Guidance: https://developers.cloudflare.com/waf/analytics/security-events/');
    }
    if (attempt < attempts - 1) await wait(retryDelay);
  }
  throw new Error('Public origin verification is not ready. Check DNS/TLS readiness, PUBLIC_APP_ORIGIN, the Worker route and Google/database configuration before retrying verification.');
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
  console.log('Cloudflare deployment commands completed. Public configuration can be checked separately with the optional Verify production workflow.');
}

if (isMainModule(import.meta.url)) {
  try { await deploy(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
