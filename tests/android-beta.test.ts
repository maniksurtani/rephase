import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { betaConfiguration, prepareBeta, propertyValue } from '../scripts/prepare-android-beta.mjs';

const environment = {
  FIREBASE_APP_ID: '1:123456789:android:abc123',
  FIREBASE_PROJECT_ID: 'rephase-test',
  FIREBASE_WORKLOAD_IDENTITY_PROVIDER:
    'projects/123456789/locations/global/workloadIdentityPools/github-rephase/providers/android-beta',
  FIREBASE_SERVICE_ACCOUNT: 'rephase-distribution@rephase-test.iam.gserviceaccount.com',
  GOOGLE_SERVER_CLIENT_ID: '123-example.apps.googleusercontent.com',
  ANDROID_KEYSTORE_BASE64: Buffer.alloc(2000, 42).toString('base64'),
  ANDROID_KEYSTORE_PASSWORD: ' leading\\secret\npassword=é🔑',
};

describe('Android beta preparation', () => {
  it('fails before building when signing or Firebase configuration is incomplete or mismatched', () => {
    for (const name of Object.keys(environment)) {
      expect(() => betaConfiguration({ ...environment, [name]: '' })).toThrow();
    }
    expect(() =>
      betaConfiguration({ ...environment, FIREBASE_APP_ID: '1:999:android:abc123' }),
    ).toThrow(/same project/);
    expect(() =>
      betaConfiguration({ ...environment, ANDROID_KEYSTORE_BASE64: 'not a key' }),
    ).toThrow(/base64/);
    expect(() =>
      betaConfiguration({ ...environment, FIREBASE_TESTER_GROUP: 'friends\n--debug' }),
    ).toThrow(/group alias/);
    expect(() =>
      betaConfiguration({ ...environment, GOOGLE_SERVER_CLIENT_ID: 'secret-token' }),
    ).toThrow(/OAuth/);
  });

  it('preserves arbitrary passwords as Java property values without injecting settings', () => {
    expect(propertyValue(' x=y:z\\\n\r\t#é🔑')).toBe(
      '\\ x\\=y\\:z\\\\\\n\\r\\t\\#\\u00e9\\ud83d\\udd11',
    );
  });

  it('gives a later rerun a newer Android build number independent of the workflow run number', () => {
    const first = betaConfiguration(environment, Date.UTC(2026, 10, 14));
    const later = betaConfiguration(environment, Date.UTC(2026, 10, 14) + 60_000);
    expect(first.buildNumber).toBeGreaterThan(1);
    expect(later.buildNumber).toBe(first.buildNumber + 60);
    expect(later.buildNumber).toBeLessThan(2_100_000_000);
    expect(() => betaConfiguration(environment, Date.UTC(2100, 0, 1))).toThrow(/limit/);
  });

  it('writes only public OAuth configuration into the app and keeps signing files private', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rephase-beta-'));
    try {
      await mkdir(join(root, 'mobile/android'), { recursive: true });
      const env = {
        ...environment,
        RUNNER_TEMP: root,
        GITHUB_ENV: join(root, 'env'),
        GITHUB_SHA: 'abc123',
        RELEASE_NOTES: 'Try $(literal) and `literal` text.',
      };
      await prepareBeta(env, root);
      const config = await readFile(join(root, 'mobile/config.json'), 'utf8');
      expect(JSON.parse(config)).toEqual({
        API_ORIGIN: 'https://rephase.surtani.org',
        GOOGLE_SERVER_CLIENT_ID: environment.GOOGLE_SERVER_CLIENT_ID,
      });
      expect(config).not.toContain('secret');
      for (const path of ['mobile/android/key.properties', 'rephase-android-beta/release.p12']) {
        expect((await stat(join(root, path))).mode & 0o777).toBe(0o600);
      }
      const notes = await readFile(join(root, 'rephase-android-beta/release-notes.txt'), 'utf8');
      expect(notes).toContain('$(literal) and `literal`');
      await expect(prepareBeta(env, root)).rejects.toThrow(/exist/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
