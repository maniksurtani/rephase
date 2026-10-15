import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Log, LogLevel, Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Run the actual adapter under workerd, rather than Node's different fetch
// implementation. All outbound requests are intercepted; no provider account,
// production database, credentials, or external network is used by this test.
describe('Cloudflare flight adapter runtime', () => {
  let runtime: Miniflare;
  const requests: { url: string; key: string | null }[] = [];
  beforeAll(async () => {
    const bundled = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('..', import.meta.url)),
        contents: `
          import { lookupFlights } from './worker/flights.ts';
          export default { async fetch(request, env) {
            try {
              const flightNumber = new URL(request.url).searchParams.get('flightNumber');
              const result = await lookupFlights({ flightNumber, date: '2026-11-05' }, env.DB, env, 'runtime-test-account', Date.parse('2026-10-15T12:00:00Z') / 1000);
              return Response.json(result);
            } catch (error) { return Response.json({ error: error.message }, { status: error.status ?? 500 }); }
          } }`,
      },
      bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    });
    runtime = new Miniflare(convertV4MiniflareOptions({
      compatibilityDate: '2026-10-14', modules: true, script: bundled.outputFiles[0].text,
      bindings: { RAPIDAPI_KEY: 'dummy-runtime-key' }, d1Databases: ['DB'],
      log: new Log(LogLevel.NONE),
      outboundService: request => {
        requests.push({ url: request.url, key: request.headers.get('X-RapidAPI-Key') });
        if (request.url.includes('/BA287/')) return new Response(null, { status: 302, headers: { Location: 'https://must-not-follow.example/' } });
        return new Response(readFileSync(new URL('./fixtures/flights/scheduled.json', import.meta.url), 'utf8'), { headers: { 'Content-Type': 'application/json' } });
      },
    }));
    const db = await runtime.getD1Database('DB');
    // D1 exec accepts one statement per line; migration comments are omitted.
    const migration = readFileSync(new URL('../migrations/0002_flight_cache.sql', import.meta.url), 'utf8').replace(/^--.*$/gm, '');
    for (const statement of migration.split(';').map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
  }, 20_000);
  afterAll(async () => { await runtime?.dispose(); });

  it('performs the provider lookup using options accepted by Cloudflare fetch', async () => {
    const result = await runtime.dispatchFetch('http://localhost/?flightNumber=BA286');
    expect(result.status).toBe(200);
    expect((await result.json() as { candidates: unknown[] }).candidates).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({ url: 'https://aerodatabox.p.rapidapi.com/flights/number/BA286/2026-11-05?dateLocalRole=Departure&withAircraftImage=false&withLocation=false&withFlightPlan=false', key: 'dummy-runtime-key' });
  });

  it('never follows a provider redirect with its API credential', async () => {
    const result = await runtime.dispatchFetch('http://localhost/?flightNumber=BA287');
    expect(result.status).toBe(503);
    expect(await result.text()).toContain('unexpected redirect');
    expect(requests).toHaveLength(2);
    expect(requests.every(request => new URL(request.url).hostname === 'aerodatabox.p.rapidapi.com')).toBe(true);
  });

  it('reserves all budgets atomically under concurrent D1 requests and explains an app limit', async () => {
    const db = await runtime.getD1Database('DB');
    await db.prepare("UPDATE flight_usage SET requests = 149 WHERE principal = 'global' AND bucket = 'month:2026-10'").run();
    const results = await Promise.all([
      runtime.dispatchFetch('http://localhost/?flightNumber=BA288'),
      runtime.dispatchFetch('http://localhost/?flightNumber=BA289'),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 429]);
    const denied = results.find(result => result.status === 429)!;
    const body = await denied.text();
    expect(body).toContain('shared monthly allowance');
    expect(body).toContain('separate from RapidAPI usage');
    expect(body).toContain('1 November 2026 at 00:00 UTC');
    expect(body).toMatch(/Reference: FLT-[0-9a-f]{12}/);
    expect(requests).toHaveLength(3);
    expect(await db.prepare("SELECT requests FROM flight_usage WHERE principal = 'global'").first()).toEqual({ requests: 150 });
    const account = await db.prepare("SELECT requests FROM flight_usage WHERE principal = 'user:runtime-test-account'").all();
    expect(account.results).toEqual([{ requests: 3 }, { requests: 3 }]);
  });
});
