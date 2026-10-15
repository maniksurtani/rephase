import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Node entry points are plain ESM so they run without a build step.
// @ts-expect-error JavaScript command modules intentionally have no declaration files.
import { verifyDeployment } from '../scripts/deploy.mjs';

const settings = { origin: 'https://rephase.example', clientId: 'example.apps.googleusercontent.com' };
const readyConfig = { googleClientId: settings.clientId, syncAvailable: true, flightLookupAvailable: false };
const readyResponse = () => Response.json(readyConfig);

describe('optional manual public verification', () => {
  beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('allows first-deployment DNS/TLS readiness to take over three minutes of fast failures', async () => {
    const fetchPublicConfig = vi.fn()
      .mockImplementation(async () => { throw new Error('private network diagnostics'); });
    for (let attempt = 0; attempt < 38; attempt += 1) {
      fetchPublicConfig.mockRejectedValueOnce(new Error('private network diagnostics'));
    }
    fetchPublicConfig.mockResolvedValueOnce(readyResponse());
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(verifyDeployment(settings, false, { fetch: fetchPublicConfig, wait })).resolves.toBeUndefined();

    expect(fetchPublicConfig).toHaveBeenCalledTimes(39);
    expect(wait).toHaveBeenCalledTimes(38);
    expect(wait.mock.calls.reduce((total, [delay]) => total + delay, 0)).toBeGreaterThanOrEqual(180_000);
    expect(fetchPublicConfig).toHaveBeenLastCalledWith(`${settings.origin}/api/config`, {
      cache: 'no-store', signal: expect.any(AbortSignal),
    });
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('private network diagnostics');
  });

  it.each([
    ['an HTML error page', () => new Response('<html>Not ready</html>', { headers: { 'Content-Type': 'text/html' } })],
    ['HTTP 503 even with valid JSON', () => Response.json(readyConfig, { status: 503 })],
    ['a different Google client', () => Response.json({ ...readyConfig, googleClientId: 'another-client' })],
    ['a missing database binding', () => Response.json({ ...readyConfig, syncAvailable: false })],
    ['a null configuration', () => Response.json(null)],
  ])('does not accept %s as ready public configuration', async (_label, response) => {
    const fetchPublicConfig = vi.fn().mockImplementation(async () => response());
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(verifyDeployment(settings, false, {
      fetch: fetchPublicConfig, wait, attempts: 2, retryDelay: 0,
    })).rejects.toThrow('Public origin verification is not ready');

    expect(fetchPublicConfig).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('accepts an app without optional live flight lookup when no provider key was supplied', async () => {
    const fetchPublicConfig = vi.fn().mockResolvedValue(readyResponse());
    const wait = vi.fn();

    await expect(verifyDeployment(settings, false, { fetch: fetchPublicConfig, wait })).resolves.toBeUndefined();
    expect(wait).not.toHaveBeenCalled();
  });

  it('waits for live flight lookup only when a provider key was supplied', async () => {
    const fetchPublicConfig = vi.fn()
      .mockResolvedValueOnce(readyResponse())
      .mockResolvedValueOnce(Response.json({ ...readyConfig, flightLookupAvailable: true }));
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(verifyDeployment(settings, true, {
      fetch: fetchPublicConfig, wait, attempts: 2, retryDelay: 5,
    })).resolves.toBeUndefined();

    expect(fetchPublicConfig).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledExactlyOnceWith(5);
  });

  it('fails finitely when a supplied flight provider never becomes available', async () => {
    const fetchPublicConfig = vi.fn().mockImplementation(async () => readyResponse());
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(verifyDeployment(settings, true, {
      fetch: fetchPublicConfig, wait, attempts: 3, retryDelay: 0,
    })).rejects.toThrow('DNS/TLS readiness');

    expect(fetchPublicConfig).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('reports an allowlisted network error without printing error messages, stacks or arbitrary fields', async () => {
    const error = new TypeError('private request URL or credentials', {
      cause: { code: 'ENOTFOUND', message: 'private DNS details', hostname: 'private hostname' },
    });
    const fetchPublicConfig = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(readyResponse());
    const wait = vi.fn().mockResolvedValue(undefined);

    await verifyDeployment(settings, false, { fetch: fetchPublicConfig, wait, attempts: 2, retryDelay: 0 });

    const logs = JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(logs).toContain('TypeError');
    expect(logs).toContain('ENOTFOUND');
    expect(logs).not.toContain('private');
  });

  it('stops immediately on a Cloudflare challenge with safe diagnostics and Security Events guidance', async () => {
    const fetchPublicConfig = vi.fn().mockResolvedValueOnce(new Response('<html>private response body</html>', {
      status: 403,
      headers: {
        'Content-Type': 'text/html; private-parameter=secret', 'cf-mitigated': 'challenge',
        'cf-ray': '1234567890abcdef-SYD', 'x-private': 'secret header',
      },
    })).mockResolvedValueOnce(readyResponse());
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(verifyDeployment(settings, false, { fetch: fetchPublicConfig, wait }))
      .rejects.toThrow('Security Events in the Cloudflare dashboard');

    const logs = JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(logs).toContain('403');
    expect(logs).toContain('HTML');
    expect(logs).toContain('challenge\\\":true');
    expect(logs).toContain('1234567890abcdef-SYD');
    expect(logs).not.toContain('private');
    expect(logs).not.toContain('secret');
    expect(logs).not.toContain('Worker uploaded');
    expect(fetchPublicConfig).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it.each(['private-ray-id', '1234567890abcdef-SYD private'])('omits an invalid Cloudflare trace header: %s', async (cfRay) => {
    const fetchPublicConfig = vi.fn().mockResolvedValueOnce(new Response('private challenge body', {
      status: 403, headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge', 'cf-ray': cfRay },
    }));
    const wait = vi.fn();

    await expect(verifyDeployment(settings, false, { fetch: fetchPublicConfig, wait }))
      .rejects.toThrow('Security Events');

    const logs = JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(logs).not.toContain('cfRay');
    expect(logs).not.toContain('private');
    expect(wait).not.toHaveBeenCalled();
  });

  it('uses fixed diagnostic categories when error names, codes or MIME types contain arbitrary text', async () => {
    const fetchPublicConfig = vi.fn()
      .mockRejectedValueOnce({ name: 'private error name', cause: { code: 'private error code' } })
      .mockResolvedValueOnce(new Response('private non-JSON content', {
        status: 502, headers: { 'content-type': 'private/content-type' },
      }))
      .mockResolvedValueOnce(readyResponse());
    const wait = vi.fn().mockResolvedValue(undefined);

    await verifyDeployment(settings, false, { fetch: fetchPublicConfig, wait, attempts: 3, retryDelay: 0 });

    const logs = JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(logs).toContain('other');
    expect(logs).not.toContain('private');
  });

  it('reports configuration readiness using booleans without printing configuration values', async () => {
    const fetchPublicConfig = vi.fn().mockResolvedValueOnce(Response.json({
      googleClientId: 'private incorrect client ID', syncAvailable: false, flightLookupAvailable: false, arbitrary: 'private value',
    })).mockResolvedValueOnce(readyResponse());
    const wait = vi.fn().mockResolvedValue(undefined);

    await verifyDeployment(settings, false, { fetch: fetchPublicConfig, wait, attempts: 2, retryDelay: 0 });

    const logs = JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(logs).toContain('clientMatches\\\":false');
    expect(logs).toContain('syncReady\\\":false');
    expect(logs).toContain('flightReady\\\":true');
    expect(logs).not.toContain('private');
  });

  it.each([
    { attempts: 0 }, { attempts: Infinity }, { attempts: 1.5 },
    { retryDelay: -1 }, { retryDelay: Infinity }, { retryDelay: 60_001 },
  ])('rejects invalid retry options before making requests: %s', async (options) => {
    const fetchPublicConfig = vi.fn();
    await expect(verifyDeployment(settings, false, { ...options, fetch: fetchPublicConfig }))
      .rejects.toThrow('Public verification requires');
    expect(fetchPublicConfig).not.toHaveBeenCalled();
  });
});
