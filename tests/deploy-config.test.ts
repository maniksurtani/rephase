import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Node entry points are plain ESM so they run without a build step.
// @ts-expect-error JavaScript command modules intentionally have no declaration files.
import {
  buildDeploymentConfig,
  parseJsonc,
  validateDeploymentEnvironment,
} from '../scripts/check-deploy-config.mjs';

const environment = {
  CLOUDFLARE_ACCOUNT_ID: '1234567890abcdef1234567890abcdef',
  CLOUDFLARE_D1_DATABASE_ID: 'b5e100d0-6122-4466-a7d7-ae63485e2502',
  PUBLIC_APP_ORIGIN: 'https://rephase.example.workers.dev',
  GOOGLE_CLIENT_ID: '123456789-example.apps.googleusercontent.com',
};
const base = {
  name: 'rephase',
  main: 'worker/index.ts',
  assets: { directory: './dist', binding: 'ASSETS' },
  d1_databases: [
    {
      binding: 'DB',
      database_name: 'rephase',
      database_id: '00000000-0000-0000-0000-000000000000',
      migrations_dir: 'migrations',
    },
  ],
  triggers: { crons: ['0 * * * *'] },
};

describe('deployment configuration', () => {
  it('offers CLI help without credentials and rejects unknown arguments before reading configuration', () => {
    const script = fileURLToPath(new URL('../scripts/check-deploy-config.mjs', import.meta.url));
    const env = {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: '',
      CLOUDFLARE_D1_DATABASE_ID: '',
      PUBLIC_APP_ORIGIN: '',
      GOOGLE_CLIENT_ID: '',
    };
    const help = spawnSync(process.execPath, [script, '--help'], { env, encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(help.stdout).toContain('no files or remote resources');
    const invalid = spawnSync(process.execPath, [script, '--unknown'], { env, encoding: 'utf8' });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('Unknown option');
    expect(invalid.stderr).not.toContain('configuration is incomplete');
  }, 20_000);

  it('replaces the local database placeholder and preserves assets, migrations and purge schedule', () => {
    const config = buildDeploymentConfig(base, environment);
    expect(config.d1_databases[0].database_id).toBe(environment.CLOUDFLARE_D1_DATABASE_ID);
    expect(config.d1_databases[0].migrations_dir).toBe('migrations');
    expect(config.assets).toEqual(base.assets);
    expect(config.triggers).toEqual(base.triggers);
    expect(config.vars.ALLOWED_ORIGIN).toBe(environment.PUBLIC_APP_ORIGIN);
  });

  it('never serializes deployment or provider credentials from the environment', () => {
    const config = buildDeploymentConfig(base, {
      ...environment,
      CLOUDFLARE_API_TOKEN: 'private-cf-token',
      RAPIDAPI_KEY: 'private-provider-key',
      UNRELATED_SECRET: 'private-other-value',
    });
    expect(JSON.stringify(config)).not.toContain('private-');
    expect(config.vars.FLIGHT_GLOBAL_MONTHLY_LIMIT).toBe('150');
    expect(config.vars.FLIGHT_DAILY_LIMIT).toBe('10');
  });

  it('binds the selected custom domain and disables alternate deployment URLs', () => {
    const origin = 'https://rephase.surtani.org';
    const config = buildDeploymentConfig(base, { ...environment, PUBLIC_APP_ORIGIN: origin });
    expect(config.routes).toEqual([{ pattern: 'rephase.surtani.org', custom_domain: true }]);
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.vars.ALLOWED_ORIGIN).toBe(origin);
  });

  it('retains workers.dev hosting when it is the chosen origin', () => {
    const config = buildDeploymentConfig(base, environment);
    expect(config.workers_dev).toBe(true);
    expect(config.routes).toEqual([]);
    expect(config.preview_urls).toBe(false);
  });

  it('rejects local-only placeholder IDs before producing a deployable configuration', () => {
    expect(() =>
      buildDeploymentConfig(base, {
        ...environment,
        CLOUDFLARE_D1_DATABASE_ID: base.d1_databases[0].database_id,
      }),
    ).toThrow('placeholder');
    expect(() =>
      validateDeploymentEnvironment({
        ...environment,
        CLOUDFLARE_ACCOUNT_ID: '00000000000000000000000000000000',
      }),
    ).toThrow('CLOUDFLARE_ACCOUNT_ID');
  });

  it.each([
    'http://rephase.example',
    'https://rephase.example/',
    'https://rephase.example/path',
    'https://user:password@rephase.example',
    'https://localhost',
    'https://rephase.example?token=secret',
    'https://rephase.surtani.org:8443',
  ])('rejects unsafe/non-origin target %s', (origin) => {
    expect(() =>
      validateDeploymentEnvironment({ ...environment, PUBLIC_APP_ORIGIN: origin }),
    ).toThrow('PUBLIC_APP_ORIGIN');
  });

  it('reports invalid variable names without echoing potentially sensitive values', () => {
    let message = '';
    try {
      validateDeploymentEnvironment({ GOOGLE_CLIENT_ID: 'secret-example-bad-input' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('GOOGLE_CLIENT_ID');
    expect(message).toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(message).not.toContain('secret-example-bad-input');
  });

  it('validates adjustable flight quotas', () => {
    expect(
      buildDeploymentConfig(base, { ...environment, FLIGHT_GLOBAL_MONTHLY_LIMIT: '50' }).vars
        .FLIGHT_GLOBAL_MONTHLY_LIMIT,
    ).toBe('50');
    expect(() =>
      buildDeploymentConfig(base, { ...environment, FLIGHT_GLOBAL_MONTHLY_LIMIT: '-1' }),
    ).toThrow('FLIGHT_GLOBAL_MONTHLY_LIMIT');
    expect(() =>
      buildDeploymentConfig(base, { ...environment, FLIGHT_DAILY_LIMIT: '1.5' }),
    ).toThrow('FLIGHT_DAILY_LIMIT');
    expect(() =>
      buildDeploymentConfig(base, { ...environment, FLIGHT_DAILY_LIMIT: '1001' }),
    ).toThrow('1000');
    expect(() =>
      buildDeploymentConfig(base, { ...environment, FLIGHT_MONTHLY_LIMIT: '10001' }),
    ).toThrow('10000');
  });

  it('parses comments without corrupting HTTPS URLs or escaped quotation marks', () => {
    expect(
      parseJsonc(
        '{ // outside comment\n "url":"https://example.com/a//b", /* block */ "text":"\\\"//still inside\\\""\n}',
      ),
    ).toEqual({ url: 'https://example.com/a//b', text: '"//still inside"' });
    expect(() => parseJsonc('{ /* unclosed')).toThrow('Unclosed');
  });
});
