import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Java Properties.load uses ISO-8859-1, not UTF-8. Escape secrets as values so
// punctuation, newlines and non-ASCII passwords cannot become new properties.
export function propertyValue(value) {
  return [...value]
    .map((character) => {
      if ('\\=:#! '.includes(character)) return `\\${character}`;
      if (character === '\n') return '\\n';
      if (character === '\r') return '\\r';
      if (character === '\t') return '\\t';
      return character
        .split('')
        .map((unit) => {
          const code = unit.charCodeAt(0);
          return code < 32 || code > 126 ? `\\u${code.toString(16).padStart(4, '0')}` : unit;
        })
        .join('');
    })
    .join('');
}

export function betaConfiguration(env, now = Date.now()) {
  const required = (name) => {
    if (!env[name]?.trim()) throw new Error(`Set ${name} in the android-beta GitHub environment.`);
    return env[name];
  };
  const app = required('FIREBASE_APP_ID');
  if (!/^1:\d+:android:[a-f0-9]+$/i.test(app))
    throw new Error('FIREBASE_APP_ID must identify a Firebase Android app.');
  const project = required('FIREBASE_PROJECT_ID');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project))
    throw new Error('Invalid FIREBASE_PROJECT_ID.');
  const provider = required('FIREBASE_WORKLOAD_IDENTITY_PROVIDER');
  const number = app.split(':')[1];
  if (
    !new RegExp(
      `^projects/${number}/locations/global/workloadIdentityPools/[a-z0-9-]+/providers/[a-z0-9-]+$`,
    ).test(provider)
  )
    throw new Error('Firebase app and workload identity provider must belong to the same project.');
  const account = required('FIREBASE_SERVICE_ACCOUNT');
  if (account !== `rephase-distribution@${project}.iam.gserviceaccount.com`)
    throw new Error('Use the dedicated rephase-distribution service account.');
  const client = required('GOOGLE_SERVER_CLIENT_ID');
  if (!/^[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(client))
    throw new Error('GOOGLE_SERVER_CLIENT_ID must be the web OAuth client ID.');
  const group = env.FIREBASE_TESTER_GROUP || 'friends-family';
  if (!/^[a-z0-9-]+$/.test(group)) throw new Error('Use one Firebase tester group alias.');
  const encoded = required('ANDROID_KEYSTORE_BASE64').replace(/\s/g, '');
  const keystore = Buffer.from(encoded, 'base64');
  if (
    keystore.length < 1000 ||
    keystore.length > 512_000 ||
    keystore.toString('base64') !== encoded
  )
    throw new Error('ANDROID_KEYSTORE_BASE64 must be the base64-encoded PKCS12 signing file.');
  const password = required('ANDROID_KEYSTORE_PASSWORD');
  // Serial publishing plus seconds since 2020 makes reruns newer than earlier
  // builds, while staying below Android's 2,100,000,000 versionCode limit.
  const buildNumber = Math.floor((now - Date.UTC(2020, 0, 1)) / 1000);
  if (!Number.isSafeInteger(buildNumber) || buildNumber < 2 || buildNumber > 2_100_000_000)
    throw new Error('The beta build number is outside Android limits.');
  return {
    app,
    project,
    provider,
    account,
    group,
    keystore,
    password,
    buildNumber,
    publicConfig: { API_ORIGIN: 'https://rephase.surtani.org', GOOGLE_SERVER_CLIENT_ID: client },
  };
}

export async function prepareBeta(
  env,
  root = resolve(fileURLToPath(new URL('..', import.meta.url))),
) {
  const config = betaConfiguration(env);
  if (!env.RUNNER_TEMP || !env.GITHUB_ENV)
    throw new Error('Run this preparation script inside GitHub Actions.');
  const privateDir = resolve(env.RUNNER_TEMP, 'rephase-android-beta');
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const keyPath = resolve(privateDir, 'release.p12');
  const values = {
    storeFile: keyPath,
    storePassword: config.password,
    keyPassword: config.password,
    keyAlias: 'rephase',
  };
  await writeFile(keyPath, config.keystore, { mode: 0o600, flag: 'wx' });
  // Refuse to overwrite developer configuration if invoked outside a fresh CI checkout.
  await writeFile(
    resolve(root, 'mobile/android/key.properties'),
    Object.entries(values)
      .map(([key, value]) => `${key}=${propertyValue(value)}\n`)
      .join(''),
    { mode: 0o600, flag: 'wx' },
  );
  await writeFile(resolve(root, 'mobile/config.json'), JSON.stringify(config.publicConfig), {
    mode: 0o600,
    flag: 'wx',
  });
  await writeFile(
    resolve(privateDir, 'release-notes.txt'),
    `${env.RELEASE_NOTES?.trim() || 'Rephase Android beta'}\n\nCommit: ${env.GITHUB_SHA}\nBuild: ${config.buildNumber}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    env.GITHUB_ENV,
    `BETA_BUILD_NUMBER=${config.buildNumber}\nBETA_TESTER_GROUP=${config.group}\n`,
    { flag: 'a' },
  );
  console.log(
    `Prepared Android beta build ${config.buildNumber}. Signing credentials are not printed.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareBeta(process.env);
}
