// App Store Connect REST API, using the same team key as the IPA upload.
// Schemas: https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip
import { createPrivateKey, sign } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { isMainModule } from './check-deploy-config.mjs';

const bundleId = 'app.rephase.Rephase';
const groupName = 'friends-family';
const origin = 'https://api.appstoreconnect.apple.com';
const relationship = (type, id) => ({ data: { type, id } });
const query = (path, params) => `${path}?${new URLSearchParams(params)}`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function appleToken(env, now = Date.now()) {
  const keyId = env.APP_STORE_CONNECT_KEY_ID;
  const issuer = env.APP_STORE_CONNECT_ISSUER_ID;
  if (!/^[A-Z0-9]{10}$/.test(keyId || '') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(issuer || '')) {
    throw new Error('Set the App Store Connect team key ID and issuer in the ios-beta environment.');
  }
  const key = createPrivateKey(env.APP_STORE_CONNECT_PRIVATE_KEY || '');
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('App Store Connect requires an ES256 .p8 private key.');
  const encoded = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const iat = Math.floor(now / 1000);
  const body = `${encoded({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${encoded({ iss: issuer, iat, exp: iat + 600, aud: 'appstoreconnect-v1' })}`;
  return `${body}.${sign('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

export function appleAPI(env, fetcher = fetch, wait = pause) {
  return async function request(path, { method = 'GET', body } = {}) {
    const url = new URL(path, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/v1/')) throw new Error('Invalid App Store Connect API URL.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetcher(url, { method,
        headers: { Authorization: `Bearer ${appleToken(env)}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (method === 'GET' && (response.status === 429 || response.status >= 500) && attempt < 2) {
        await wait(5_000 * (attempt + 1));
        continue;
      }
      if (response.status === 204) return {};
      const result = await response.json();
      if (!response.ok) {
        const detail = (result.errors || []).map((error) => `${error.code}: ${error.detail || error.title}`).join('; ').slice(0,1200);
        throw new Error(`App Store Connect HTTP ${response.status}: ${detail}. Check TestFlight review/contact/export-compliance details and API-key access, then retry in distribute mode.`);
      }
      return result;
    }
  };
}

export async function testflightTarget(request) {
  const { data: apps = [] } = await request(query('/v1/apps', { 'filter[bundleId]': bundleId, limit: '2' }));
  const matches = apps.filter((app) => app.attributes?.bundleId === bundleId);
  if (matches.length !== 1) throw new Error(`The API key must have access to exactly one ${bundleId} app.`);
  const app = matches[0];
  const { data: groups = [] } = await request(query('/v1/betaGroups', {
    'filter[app]': app.id, 'filter[name]': groupName, 'filter[isInternalGroup]': 'false', limit: '200',
  }));
  const external = groups.filter((group) => group.attributes?.name === groupName && group.attributes?.isInternalGroup === false);
  if (external.length !== 1) throw new Error(`Create the external TestFlight group '${groupName}' for Rephase and grant this API key access.`);
  return { app, group: external[0] };
}

export async function distributeTestflight({ request, version, buildNumber, notes, wait = pause, attempts = 60 }) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || !/^[1-9]\d{0,3}$/.test(buildNumber || '')) {
    throw new Error('Provide the exact marketing version and existing build number; distribute mode never chooses the latest build.');
  }
  if (!notes?.trim() || Buffer.byteLength(notes, 'utf8') > 4000) throw new Error('Provide What to Test notes of 1–4000 UTF-8 bytes.');
  const { app, group } = await testflightTarget(request);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { data: builds = [], included = [] } = await request(query('/v1/builds', {
      'filter[app]': app.id, 'filter[version]': buildNumber, 'filter[preReleaseVersion.version]': version,
      'filter[preReleaseVersion.platform]': 'IOS', include: 'preReleaseVersion', limit: '2',
    }));
    if (builds.length > 1) throw new Error('Apple returned multiple builds for the exact version; refusing to choose one.');
    const build = builds[0];
    if (build) {
      const release = included.find((item) => item.type === 'preReleaseVersions' && item.id === build.relationships?.preReleaseVersion?.data?.id);
      if (build.attributes?.version !== buildNumber || release?.attributes?.version !== version || release?.attributes?.platform !== 'IOS') {
        throw new Error('Apple returned a different version or platform; no distribution was changed.');
      }
      const processing = build.attributes.processingState;
      if (build.attributes.expired || ['FAILED','INVALID'].includes(processing)) throw new Error(`Apple rejected or expired build ${version} (${buildNumber}). Inspect its processing details in App Store Connect.`);
      if (processing === 'VALID') {
        const { data: detail } = await request(`/v1/builds/${encodeURIComponent(build.id)}/buildBetaDetail`);
        const state = detail?.attributes?.externalBuildState;
        if (state && state !== 'PROCESSING') {
          const eligible = ['READY_FOR_BETA_SUBMISSION','WAITING_FOR_BETA_REVIEW','IN_BETA_REVIEW','BETA_APPROVED','READY_FOR_BETA_TESTING','IN_BETA_TESTING'];
          if (!eligible.includes(state)) throw new Error(`Build ${version} (${buildNumber}) needs attention in App Store Connect: ${state}. Resolve review/export compliance, then retry distribute mode without rebuilding.`);
          // Preserve other locales and groups; only update this build's English notes.
          const { data: localizations = [] } = await request(`/v1/builds/${encodeURIComponent(build.id)}/betaBuildLocalizations?limit=200`);
          const english = localizations.find((value) => value.attributes?.locale === 'en-US');
          if (english) await request(`/v1/betaBuildLocalizations/${encodeURIComponent(english.id)}`, {
            method: 'PATCH', body: { data: { type: 'betaBuildLocalizations', id: english.id, attributes: { whatsNew: notes } } },
          });
          else await request('/v1/betaBuildLocalizations', { method: 'POST', body: { data: {
            type: 'betaBuildLocalizations', attributes: { locale: 'en-US', whatsNew: notes },
            relationships: { build: relationship('builds', build.id) },
          } } });
          await request(`/v1/buildBetaDetails/${encodeURIComponent(detail.id)}`, { method: 'PATCH', body: {
            data: { type: 'buildBetaDetails', id: detail.id, attributes: { autoNotifyEnabled: true } },
          } });
          // Submit before assigning external groups, matching Apple's TestFlight flow.
          if (state === 'READY_FOR_BETA_SUBMISSION') await request('/v1/betaAppReviewSubmissions', { method: 'POST', body: {
            data: { type: 'betaAppReviewSubmissions', relationships: { build: relationship('builds', build.id) } },
          } });
          await request(`/v1/betaGroups/${encodeURIComponent(group.id)}/relationships/builds`, {
            method: 'POST', body: { data: [{ type: 'builds', id: build.id }] },
          });
          const pending = ['READY_FOR_BETA_SUBMISSION','WAITING_FOR_BETA_REVIEW','IN_BETA_REVIEW'].includes(state);
          return `Assigned ${version} (${buildNumber}) to ${groupName}. ${pending ? 'Apple beta review is pending; testers will be notified after approval.' : 'Automatic tester notification is enabled.'}`;
        }
      } else if (processing !== 'PROCESSING') throw new Error(`Unknown Apple processing state: ${processing}.`);
    }
    if (attempt === 0) console.log(`Waiting for Apple to process ${version} (${buildNumber}); no rebuild is needed.`);
    if (attempt < attempts - 1) await wait(30_000);
  }
  throw new Error(`Apple processing exceeded 30 minutes. Re-run only the distribute job, or use distribute mode with version ${version} and build ${buildNumber}; do not rebuild.`);
}

if (isMainModule(import.meta.url)) {
  try {
    const request = appleAPI(process.env);
    if (process.argv[2] === 'preflight') {
      await testflightTarget(request);
      console.log('App Store Connect key can access Rephase and the friends-family external group.');
    } else if (process.argv[2] === 'distribute') {
      const result = await distributeTestflight({ request, version: process.env.IOS_VERSION,
        buildNumber: process.env.BETA_BUILD_NUMBER, notes: process.env.TESTFLIGHT_RELEASE_NOTES });
      console.log(result);
      if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${result}\n`);
    } else throw new Error('Usage: node scripts/testflight.mjs preflight|distribute');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
