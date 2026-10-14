import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const deploymentConfigPath = resolve(projectRoot, 'wrangler.deploy.json');

/** Values are validated without including their contents in errors or logs. */
export function validateDeploymentEnvironment(env = process.env) {
  const errors = [];
  const value = (name) => typeof env[name] === 'string' ? env[name].trim() : '';
  const accountId = value('CLOUDFLARE_ACCOUNT_ID');
  const databaseId = value('CLOUDFLARE_D1_DATABASE_ID');
  const origin = value('PUBLIC_APP_ORIGIN');
  const clientId = value('GOOGLE_CLIENT_ID');
  if (!/^[a-f0-9]{32}$/i.test(accountId) || /^0+$/.test(accountId)) {
    errors.push('CLOUDFLARE_ACCOUNT_ID must be your 32-character Cloudflare account ID.');
  }
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(databaseId)
      || databaseId === '00000000-0000-0000-0000-000000000000') {
    errors.push('CLOUDFLARE_D1_DATABASE_ID must be a real D1 database UUID, not the local placeholder.');
  }
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password
        || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error();
  } catch {
    errors.push('PUBLIC_APP_ORIGIN must be an exact public HTTPS origin, with no path or trailing slash.');
  }
  if (!/^[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(clientId)) {
    errors.push('GOOGLE_CLIENT_ID must be a Google OAuth Web application client ID.');
  }
  if (errors.length) throw new Error(`Deployment configuration is incomplete:\n${errors.join('\n')}`);
  return { accountId, databaseId, origin, clientId };
}

/** Base JSONC currently has line comments only. Preserve quoted URLs and strings. */
export function parseJsonc(source) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') { inString = true; result += char; }
    else if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      result += '\n';
    } else if (char === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      if (i >= source.length) throw new Error('Unclosed JSONC comment.');
      i += 1;
      result += ' ';
    } else result += char;
  }
  return JSON.parse(result);
}

export function buildDeploymentConfig(base, env = process.env) {
  const settings = validateDeploymentEnvironment(env);
  if (!base.main || !base.assets?.directory || !Array.isArray(base.d1_databases)
      || base.d1_databases.filter((db) => db.binding === 'DB').length !== 1) {
    throw new Error('The base Wrangler configuration must define main, assets and exactly one DB binding.');
  }
  const budgets = {};
  for (const [name, [fallback, maximum]] of Object.entries({ FLIGHT_DAILY_LIMIT: [10, 1000], FLIGHT_MONTHLY_LIMIT: [40, 10_000], FLIGHT_GLOBAL_MONTHLY_LIMIT: [150, 1_000_000] })) {
    const supplied = env[name] === undefined || env[name] === '' ? String(fallback) : String(env[name]);
    if (!/^\d+$/.test(supplied) || Number(supplied) < 1 || Number(supplied) > maximum) {
      throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
    }
    budgets[name] = supplied;
  }
  // Explicit allowlist: public vars only. API tokens/provider keys never enter the JSON.
  return {
    ...base,
    account_id: settings.accountId,
    workers_dev: true,
    vars: { GOOGLE_CLIENT_ID: settings.clientId, ALLOWED_ORIGIN: settings.origin, ...budgets },
    d1_databases: base.d1_databases.map((db) => db.binding === 'DB'
      ? { ...db, database_id: settings.databaseId } : db),
  };
}

export async function readBaseConfig() {
  return parseJsonc(await readFile(resolve(projectRoot, 'wrangler.jsonc'), 'utf8'));
}

export function isMainModule(url) {
  return Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url));
}

export const configurationHelp = 'Required public environment variables: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, PUBLIC_APP_ORIGIN and GOOGLE_CLIENT_ID.\nOptional public quota variables: FLIGHT_DAILY_LIMIT, FLIGHT_MONTHLY_LIMIT and FLIGHT_GLOBAL_MONTHLY_LIMIT.\nProvider/deployment secrets are never written to generated configuration. See DEPLOYMENT.md.';

if (isMainModule(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
      console.log(`Usage: node scripts/check-deploy-config.mjs [--help]\n${configurationHelp}\nValidates only; no files or remote resources are changed.`);
    } else {
      if (args.length) throw new Error('Unknown option. Usage: node scripts/check-deploy-config.mjs [--help]');
      buildDeploymentConfig(await readBaseConfig());
      console.log('Deployment configuration is valid. No Cloudflare resources were changed.');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
