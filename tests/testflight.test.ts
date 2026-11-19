import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
// @ts-expect-error Plain Node release tooling.
import { appleAPI, appleToken, distributeTestflight, testflightTarget } from '../scripts/testflight.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const env = { APP_STORE_CONNECT_KEY_ID: 'KEY1234567', APP_STORE_CONNECT_ISSUER_ID: '11111111-2222-3333-4444-555555555555',
  APP_STORE_CONNECT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
function fixture(state = 'READY_FOR_BETA_SUBMISSION') {
  const app = { id: 'app', attributes: { bundleId: 'app.rephase.Rephase' } };
  const group = { id: 'family', attributes: { name: 'friends-family', isInternalGroup: false } };
  const build = { id: 'build-6', attributes: { version: '6', processingState: 'VALID', expired: false }, relationships: { preReleaseVersion: { data: { id: 'version' } } } };
  const release = { type: 'preReleaseVersions', id: 'version', attributes: { version: '0.1.0', platform: 'IOS' } };
  const request = vi.fn(async (path: string, options?: any): Promise<any> => {
    if (options) return {};
    if (path.startsWith('/v1/apps?')) return { data: [app] };
    if (path.startsWith('/v1/betaGroups?')) return { data: [group] };
    if (path.startsWith('/v1/builds?')) return { data: [build], included: [release] };
    if (path.endsWith('/buildBetaDetail')) return { data: { id: 'detail', attributes: { externalBuildState: state } } };
    if (path.includes('/betaBuildLocalizations')) return { data: [] };
    throw new Error(`Unexpected path ${path}`);
  });
  const wait = vi.fn(async () => {});
  return { app, group, build, release, request, wait, options: { request, wait, version: '0.1.0', buildNumber: '6', notes: 'Try the carbon disclosure.', attempts: 2 } };
}

describe('TestFlight external distribution', () => {
  it('creates a short-lived correctly encoded ES256 team token', () => {
    const token = appleToken(env, 1_800_000_000_000);
    const [header, body, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toMatchObject({ alg: 'ES256', kid: 'KEY1234567' });
    expect(JSON.parse(Buffer.from(body, 'base64url').toString())).toMatchObject({ iat: 1_800_000_000, exp: 1_800_000_600, aud: 'appstoreconnect-v1' });
    expect(verify('sha256', Buffer.from(`${header}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))).toBe(true);
  });
  it('checks the named external group without creating groups or changing tester membership', async () => {
    const f = fixture(); await expect(testflightTarget(f.request)).resolves.toMatchObject({ group: { id: 'family' } });
    f.group.attributes.isInternalGroup = true;
    await expect(testflightTarget(f.request)).rejects.toThrow('external TestFlight group');
    expect(f.request.mock.calls.every((call) => call[1] === undefined)).toBe(true);
  });
  it('sets release notes and auto-notification, submits review, then assigns only the requested build', async () => {
    const f = fixture();
    await expect(distributeTestflight(f.options)).resolves.toContain('Apple beta review is pending');
    const writes = f.request.mock.calls.filter((call) => call[1]);
    expect(writes.map(([path]) => path)).toEqual(['/v1/betaBuildLocalizations', '/v1/buildBetaDetails/detail', '/v1/betaAppReviewSubmissions', '/v1/betaGroups/family/relationships/builds']);
    expect(writes.at(-1)?.[1]).toEqual({ method: 'POST', body: { data: [{ type: 'builds', id: 'build-6' }] } });
    expect(writes[1][1].body.data.attributes).toEqual({ autoNotifyEnabled: true });
    const search = new URL(f.request.mock.calls.find(([path]) => path.startsWith('/v1/builds?'))![0], 'https://example.test');
    expect(search.searchParams.get('filter[preReleaseVersion.version]')).toBe('0.1.0');
    expect(search.searchParams.get('filter[version]')).toBe('6');
  });
  it.each(['WAITING_FOR_BETA_REVIEW', 'IN_BETA_REVIEW', 'IN_BETA_TESTING'])('retries assignment without a second review submission in state %s', async (state) => {
    const f = fixture(state);
    await distributeTestflight(f.options);
    expect(f.request.mock.calls.some(([path]) => path === '/v1/betaAppReviewSubmissions')).toBe(false);
  });
  it('waits for processing without any mutations and times out with no-rebuild recovery instructions', async () => {
    const f = fixture(); f.build.attributes.processingState = 'PROCESSING';
    await expect(distributeTestflight(f.options)).rejects.toThrow('do not rebuild');
    expect(f.wait).toHaveBeenCalledExactlyOnceWith(30_000);
    expect(f.request.mock.calls.every((call) => call[1] === undefined)).toBe(true);
  });
  it.each(['MISSING_EXPORT_COMPLIANCE', 'BETA_REJECTED', 'NOT_APPLICABLE'])('does not bypass Apple requirements: %s', async (state) => {
    const f = fixture(state);
    await expect(distributeTestflight(f.options)).rejects.toThrow(state);
    expect(f.request.mock.calls.every((call) => call[1] === undefined)).toBe(true);
  });
  it('rejects missing build selection, invalid processing, and mismatched marketing versions before distribution', async () => {
    const f = fixture();
    await expect(distributeTestflight({ ...f.options, buildNumber: '' })).rejects.toThrow('exact marketing version');
    f.build.attributes.processingState = 'INVALID';
    await expect(distributeTestflight(f.options)).rejects.toThrow('Apple rejected');
    f.build.attributes.processingState = 'VALID'; f.release.attributes.version = '0.2.0';
    await expect(distributeTestflight(f.options)).rejects.toThrow('different version');
    expect(f.request.mock.calls.every((call) => call[1] === undefined)).toBe(true);
  });
  it('does not send credentials off-origin and reports Apple failures without retrying a review POST', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ errors: [{ code: 'FORBIDDEN', detail: 'Access denied' }] }), { status: 403 }));
    const api = appleAPI(env, fetcher, vi.fn());
    await expect(api('https://elsewhere.test/v1/builds')).rejects.toThrow('Invalid');
    expect(fetcher).not.toHaveBeenCalled();
    await expect(api('/v1/betaAppReviewSubmissions', { method: 'POST', body: {} })).rejects.toThrow('HTTP 403');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
