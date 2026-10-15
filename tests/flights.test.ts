import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleApi, hashToken, type Env } from '../worker/index';
import { normalizeFlightNumber, normalizeFlights, purgeFlightData, validateFlightQuery } from '../worker/flights';
import type { FlightLookupResult } from '../src/lib/types';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const ORIGIN = 'https://rephase.example';
const SESSION_A = 'a'.repeat(64); const SESSION_B = 'b'.repeat(64);
const QUERY = { flightNumber: 'BA286', date: '2026-11-05' };
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/flights/scheduled.json', import.meta.url), 'utf8'));
const providerResponse = (value: unknown = fixture()) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function d1For(sqlite: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    let values: (string | number | null)[] = [];
    const statement = {
      bind(...args: (string | number | null)[]) { values = args; return statement; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      _run() { const result = sqlite.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
      async run() { return statement._run(); },
    };
    return statement;
  };
  return { prepare, async batch(statements: ReturnType<typeof prepare>[]) {
    sqlite.exec('BEGIN');
    try { const result = statements.map(s => s._run()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
}
function flightRequest(query = '?flightNumber=BA286&date=2026-11-05', account = 'user-a', token = SESSION_A): Request {
  return new Request(ORIGIN + '/api/flights' + query, { headers: { Cookie: `__Host-rephase_session=${token}`, 'X-Rephase-Account': account } });
}
const resolver = async (airport: Record<string, unknown>) => typeof airport.timeZone === 'string' ? airport.timeZone : null;

describe('AeroDataBox normalization', () => {
  it('normalizes IATA/ICAO numbers without accepting URL/query injection', () => {
    expect(normalizeFlightNumber(' ba 286 ')).toBe('BA286'); expect(normalizeFlightNumber('baw286')).toBe('BAW286');
    expect(normalizeFlightNumber('6E 123')).toBe('6E123'); expect(normalizeFlightNumber('U2123')).toBe('U2123');
    for (const invalid of ['BA286?key=secret', '../BA286', '123456', 'BA', 'BA12345', 'BA\n286', 'B-286']) expect(normalizeFlightNumber(invalid)).toBeNull();
  });
  it('validates departure-date bounds, impossible dates, duplicate and unknown query params', () => {
    expect(validateFlightQuery(new URL(ORIGIN + '/api/flights?flightNumber=ba%20286&date=2026-11-05&departureAirport=sfo'), NOW / 1000)).toEqual({ ...QUERY, departureAirport: 'SFO' });
    for (const query of ['date=2026-02-30', 'date=2026-10-10', 'date=2028-11-01', 'date=2026-11-05&date=2026-11-06', 'date=2026-11-05&key=secret', 'date=2026-11-05&departureAirport=']) {
      expect(() => validateFlightQuery(new URL(ORIGIN + '/api/flights?flightNumber=BA286&' + query), NOW / 1000)).toThrow();
    }
  });
  it('uses explicit scheduled UTC/local pairs, airline and runway fields', async () => {
    const normalized = await normalizeFlights(fixture(), QUERY, resolver);
    expect(normalized.candidates).toHaveLength(1);
    expect(normalized.candidates[0]).toMatchObject({ flightNumber: 'BA286', departureDateTime: '2026-11-05T20:00', arrivalDateTime: '2026-11-06T14:00', departureUtc: '2026-11-06T04:00:00.000Z', durationMinutes: 600, takeoffDateTime: '2026-11-05T20:20', landingDateTime: '2026-11-06T13:50', airline: 'British Airways' });
  });
  it('preserves runway seconds so the first thirty minutes are not shortened by rounding', async () => {
    const copy = fixture();
    copy[0].departure.runwayTime = { utc: '2026-11-06T04:20:45Z', local: '2026-11-05 20:20:45-08:00' };
    expect((await normalizeFlights(copy, QUERY, resolver)).candidates[0].takeoffDateTime).toBe('2026-11-05T20:20:45');
  });
  it('keeps ambiguous revised gate times out of takeoff/landing fields', async () => {
    const payload = fixture(); delete payload[0].departure.runwayTime; delete payload[0].arrival.runwayTime;
    const { candidates } = await normalizeFlights(payload, QUERY, resolver);
    expect(candidates[0]).not.toHaveProperty('takeoffDateTime'); expect(candidates[0]).not.toHaveProperty('landingDateTime');
    expect(candidates[0].departureDateTime).toBe('2026-11-05T20:00');
  });
  it('omits incomplete, inconsistent, wrong-day, canceled and missing-zone records', async () => {
    const invalid = fixture()[0];
    const variants = [
      (x: typeof invalid) => delete x.arrival.scheduledTime,
      (x: typeof invalid) => x.arrival.scheduledTime.local = '2026-11-07 14:00+00:00',
      (x: typeof invalid) => x.departure.scheduledTime.local = '2026-11-05 20:00+00:00',
      (x: typeof invalid) => x.status = 'Canceled',
      (x: typeof invalid) => x.departure.airport.timeZone = undefined,
      (x: typeof invalid) => x.arrival.scheduledTime.utc = '2026-11-05T14:00:00Z',
    ];
    for (const change of variants) { const copy = structuredClone(invalid); change(copy); expect((await normalizeFlights([copy], QUERY, resolver)).candidates).toEqual([]); }
    expect((await normalizeFlights([invalid], { ...QUERY, date: '2026-11-06' }, resolver)).candidates).toEqual([]);
  });
  it('returns multi-leg/code-share candidates without fabricating an operator', async () => {
    const original = fixture()[0]; const codeshare = structuredClone(original); codeshare.number = 'AA6932'; codeshare.codeshareStatus = 'IsCodeshared';
    const { candidates, warnings } = await normalizeFlights([original, original, codeshare], QUERY, resolver);
    expect(candidates).toHaveLength(2); expect(warnings.join(' ')).toContain('Code-share');
    expect(candidates[1]).not.toHaveProperty('operatingFlightNumber');
  });
  it('preserves UTC-backed earlier/later choice during a daylight-saving fold', async () => {
    const copy = fixture();
    copy[0].departure.scheduledTime = { utc: '2026-11-01T09:30:00Z', local: '2026-11-01 01:30-08:00' };
    copy[0].arrival.scheduledTime = { utc: '2026-11-01T19:30:00Z', local: '2026-11-01 19:30+00:00' };
    delete copy[0].departure.runwayTime; delete copy[0].arrival.runwayTime;
    expect((await normalizeFlights(copy, { ...QUERY, date: '2026-11-01' }, resolver)).candidates[0]).toMatchObject({ departureDisambiguation: 'later', durationMinutes: 600 });
  });
  it('omits runway occurrences that need a different DST-fold choice from gate times', async () => {
    const copy = fixture();
    copy[0].departure.scheduledTime = { utc: '2026-11-01T08:30:00Z', local: '2026-11-01 01:30-07:00' };
    copy[0].departure.runwayTime = { utc: '2026-11-01T09:40:00Z', local: '2026-11-01 01:40-08:00' };
    copy[0].arrival.scheduledTime = { utc: '2026-11-01T18:30:00Z', local: '2026-11-01 18:30+00:00' };
    delete copy[0].arrival.runwayTime;
    const candidate = (await normalizeFlights(copy, { ...QUERY, date: '2026-11-01' }, resolver)).candidates[0];
    expect(candidate.departureDisambiguation).toBe('earlier'); expect(candidate).not.toHaveProperty('takeoffDateTime');
  });
  it('rejects unexpected envelopes and oversized collections', async () => {
    await expect(normalizeFlights({ flights: fixture() }, QUERY, resolver)).rejects.toThrow();
    await expect(normalizeFlights(Array(41).fill(fixture()[0]), QUERY, resolver)).rejects.toThrow();
  });
});

describe('Authenticated flight lookup, retention and quota', () => {
  let sqlite: DatabaseSync; let env: Env; let provider: ReturnType<typeof vi.fn<typeof fetch>>;
  const invoke = (req = flightRequest(), now = NOW, overrides: Partial<Env> = {}) => handleApi(req, { ...env, ...overrides }, { now: () => now, fetch: provider });
  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:');
    for (const migration of ['0001_accounts.sql', '0002_flight_cache.sql', '0003_google_avatar.sql']) sqlite.exec(readFileSync(new URL('../migrations/' + migration, import.meta.url), 'utf8'));
    env = { DB: d1For(sqlite), GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com', RAPIDAPI_KEY: 'test-secret-never-exposed' };
    provider = vi.fn<typeof fetch>(async () => providerResponse());
    for (const [id, token] of [['user-a', SESSION_A], ['user-b', SESSION_B]]) {
      sqlite.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run(id, id, id + '@example.com');
      sqlite.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(await hashToken(token), id, NOW / 1000 + 366 * 86_400);
    }
  });
  afterEach(() => sqlite.close());
  it('reports availability without exposing the provider secret', async () => {
    const config = await invoke(new Request(ORIGIN + '/api/config'));
    expect(await config.json()).toMatchObject({ flightLookupAvailable: true, flightProvider: 'aerodatabox' });
    expect(await (await invoke(new Request(ORIGIN + '/api/config'), NOW, { RAPIDAPI_KEY: '' })).json()).toMatchObject({ flightLookupAvailable: false });
  });
  it('requires verified session, expected account and permitted origin before spending credits', async () => {
    const missing = flightRequest(); missing.headers.delete('Cookie'); expect((await invoke(missing)).status).toBe(401);
    expect((await invoke(flightRequest(undefined, 'user-b', SESSION_A))).status).toBe(403);
    const noAccount = flightRequest(); noAccount.headers.delete('X-Rephase-Account'); expect((await invoke(noAccount)).status).toBe(403);
    const foreign = flightRequest(); foreign.headers.set('Origin', 'https://evil.example'); expect((await invoke(foreign)).status).toBe(403);
    const crossSite = flightRequest(); crossSite.headers.set('Sec-Fetch-Site', 'cross-site'); expect((await invoke(crossSite)).status).toBe(403);
    expect((await invoke(undefined, NOW, { RAPIDAPI_KEY: '' })).status).toBe(503);
    expect(provider).not.toHaveBeenCalled();
  });
  it('calls exact provider endpoint with departure-only dates and secrets in headers', async () => {
    const result = await invoke(); expect(result.status).toBe(200);
    const [url, options] = provider.mock.calls[0];
    expect(String(url)).toBe('https://aerodatabox.p.rapidapi.com/flights/number/BA286/2026-11-05?dateLocalRole=Departure&withAircraftImage=false&withLocation=false&withFlightPlan=false');
    expect(String(url)).not.toContain(env.RAPIDAPI_KEY); expect(options?.headers).toMatchObject({ 'X-RapidAPI-Key': env.RAPIDAPI_KEY, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' });
    expect(options?.redirect).toBe('error'); expect(options?.cache).toBe('no-store'); expect(await result.text()).not.toContain(env.RAPIDAPI_KEY);
  });
  it('serves fresh public cache across accounts without reading saved owner trips or spending credits', async () => {
    const first = await (await invoke()).json(); const other = await invoke(flightRequest(undefined, 'user-b', SESSION_B));
    expect(await other.json()).toEqual(first); expect(provider).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM user_state').get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT requests FROM flight_usage WHERE principal = 'global'").get()).toEqual({ requests: 1 });
  });
  it('caches missing flight responses briefly and returns no fabricated schedule', async () => {
    provider.mockImplementation(async () => new Response(null, { status: 204 }));
    const first = await (await invoke()).json() as FlightLookupResult;
    expect(first.candidates).toEqual([]); expect(Date.parse(first.expiresAt) - Date.parse(first.fetchedAt)).toBe(300_000);
    await invoke(undefined, NOW + 299_000); expect(provider).toHaveBeenCalledTimes(1);
    await invoke(undefined, NOW + 301_000); expect(provider).toHaveBeenCalledTimes(2);
  });
  it('uses shorter near-departure freshness and refreshes distant schedules after 24 hours', async () => {
    const far = await (await invoke()).json() as FlightLookupResult;
    expect(Date.parse(far.expiresAt) - NOW).toBe(86_400_000);
    await invoke(undefined, NOW + 86_400_000); expect(provider).toHaveBeenCalledTimes(2);
    const near = await (await invoke(flightRequest('?flightNumber=BA287&date=2026-11-05'), Date.parse('2026-11-04T12:00Z'))).json() as FlightLookupResult;
    expect(Date.parse(near.expiresAt) - Date.parse(near.fetchedAt)).toBe(900_000);
  });
  it('labels stale results on errors, retains original dates, and purges them before seven days', async () => {
    const first = await (await invoke()).json() as FlightLookupResult;
    provider.mockImplementation(async () => new Response('secret-key-detail', { status: 503 }));
    const stale = await (await invoke(undefined, NOW + 86_401_000)).json() as FlightLookupResult;
    expect(stale.stale).toBe(true); expect(stale.fetchedAt).toBe(first.fetchedAt); expect(stale.warnings.join(' ')).toContain('stale');
    const expired = await invoke(undefined, NOW + 6 * 86_400_000); expect(expired.status).toBe(503);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flight_cache').get()).toEqual({ count: 0 });
    expect(await expired.text()).not.toContain('secret-key-detail');
  });
  it('reserves per-account and global limits atomically and lets fresh cache bypass quota', async () => {
    env.FLIGHT_DAILY_LIMIT = '1';
    expect((await invoke()).status).toBe(200); expect((await invoke()).status).toBe(200);
    expect((await invoke(flightRequest('?flightNumber=BA287&date=2026-11-05'))).status).toBe(429); expect(provider).toHaveBeenCalledTimes(1);
    env.FLIGHT_GLOBAL_MONTHLY_LIMIT = '1';
    expect((await invoke(flightRequest('?flightNumber=BA287&date=2026-11-05', 'user-b', SESSION_B))).status).toBe(429);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('bounds monthly usage and does not retry failed provider calls automatically', async () => {
    env.FLIGHT_MONTHLY_LIMIT = '1'; provider.mockImplementation(async () => { throw new Error('key=' + env.RAPIDAPI_KEY); });
    const fail = await invoke(); expect(fail.status).toBe(503); expect(await fail.text()).not.toContain(env.RAPIDAPI_KEY);
    expect((await invoke(flightRequest('?flightNumber=BA287&date=2026-11-05'), NOW + 86_400_000)).status).toBe(429);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('deduplicates concurrent same-key requests within an isolate', async () => {
    let release!: () => void; const hold = new Promise<void>(resolve => release = resolve);
    provider.mockImplementation(async () => { await hold; return providerResponse(); });
    const first = invoke(); const second = invoke(flightRequest(undefined, 'user-b', SESSION_B));
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1)); release();
    expect((await first).status).toBe(200); expect((await second).status).toBe(200); expect(provider).toHaveBeenCalledTimes(1);
  });
  it('resolves unknown airports through verified provider IANA zones and caches only reduced airport fields', async () => {
    const copy = fixture(); copy[0].departure.airport = { iata: 'ZZZ', icao: 'KZZZ', name: 'Synthetic test airport' };
    provider.mockImplementation(async (url) => String(url).includes('/airports/') ? providerResponse({ iata: 'ZZZ', icao: 'KZZZ', timeZone: 'America/Los_Angeles', unwanted: 'never-store' }) : providerResponse(copy));
    const result = await (await invoke()).json() as FlightLookupResult;
    expect(result.candidates[0].departureTimeZone).toBe('America/Los_Angeles'); expect(provider).toHaveBeenCalledTimes(2);
    expect(sqlite.prepare('SELECT time_zone FROM flight_airport_cache').get()).toEqual({ time_zone: 'America/Los_Angeles' });
    expect(sqlite.prepare("SELECT requests FROM flight_usage WHERE principal = 'global'").get()).toEqual({ requests: 2 });
    expect(JSON.stringify(sqlite.prepare('SELECT * FROM flight_cache').get())).not.toContain('never-store');
  });
  it('uses catalog fallback but omits unresolved airports instead of treating UTC offset as an IANA zone', async () => {
    const copy = fixture(); delete copy[0].departure.airport.timeZone; provider.mockImplementation(async () => providerResponse(copy));
    expect((await (await invoke()).json() as FlightLookupResult).candidates).toHaveLength(1); expect(provider).toHaveBeenCalledTimes(1);
    copy[0].departure.airport = { iata: 'XYZ', name: 'Unresolved' };
    provider.mockImplementation(async url => String(url).includes('/airports/') ? new Response(null, { status: 204 }) : providerResponse(copy));
    expect((await (await invoke(flightRequest('?flightNumber=BA287&date=2026-11-05'))).json() as FlightLookupResult).candidates).toEqual([]);
  });
  it('rejects malformed, large, non-JSON and oversized provider collections without exposing provider body', async () => {
    const responses = [new Response('{broken secret', { headers: { 'Content-Type': 'application/json' } }), new Response('secret-body', { headers: { 'Content-Type': 'text/plain' } }), new Response('x', { headers: { 'Content-Type': 'application/json', 'Content-Length': '524289' } }), providerResponse('x'.repeat(524288)), providerResponse(Array(41).fill(fixture()[0]))];
    for (let i = 0; i < responses.length; i++) {
      provider.mockImplementationOnce(async () => responses[i]);
      const result = await invoke(flightRequest(`?flightNumber=BA${290 + i}&date=2026-11-05`)); expect(result.status).toBe(502);
      expect(await result.text()).not.toMatch(/secret|broken/);
    }
  });
  it('enforces quota during concurrent distinct lookups and never substitutes stale data for a quota error', async () => {
    env.FLIGHT_DAILY_LIMIT = '1';
    const results = await Promise.all([invoke(), invoke(flightRequest('?flightNumber=BA287&date=2026-11-05'))]);
    expect(results.map(result => result.status).sort()).toEqual([200, 429]); expect(provider).toHaveBeenCalledTimes(1);
    env.FLIGHT_MONTHLY_LIMIT = '1';
    const staleAttempt = await invoke(undefined, NOW + 86_401_000);
    expect(staleAttempt.status).toBe(429); expect(provider).toHaveBeenCalledTimes(1);
  });

  it('rejects unrelated airport identity responses and does not invent a time zone', async () => {
    const copy = fixture(); copy[0].departure.airport = { icao: 'KZZZ', name: 'Synthetic test airport' };
    provider.mockImplementation(async url => String(url).includes('/airports/') ? providerResponse({ icao: 'KYYY', timeZone: 'America/Los_Angeles' }) : providerResponse(copy));
    const result = await (await invoke()).json() as FlightLookupResult;
    expect(result.candidates).toEqual([]);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flight_airport_cache').get()).toEqual({ count: 0 });
  });
  it('bounds the whole flight-plus-airport workflow before reserving another provider request', async () => {
    const copy = fixture(); copy[0].departure.airport = { iata: 'ZZZ', name: 'Synthetic test airport' };
    let wall = Date.now(); const clock = vi.spyOn(Date, 'now').mockImplementation(() => wall);
    provider.mockImplementation(async () => { wall += 16_000; return providerResponse(copy); });
    try {
      const result = await invoke(); expect(result.status).toBe(503); expect(provider).toHaveBeenCalledTimes(1);
      expect(sqlite.prepare("SELECT requests FROM flight_usage WHERE principal = 'global'").get()).toEqual({ requests: 1 });
    } finally { clock.mockRestore(); }
  });
  it('aborts slow provider calls and returns a bounded generic error', async () => {
    provider.mockImplementation(async (_url, options) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('key=' + env.RAPIDAPI_KEY)), { once: true });
    }));
    const result = await handleApi(flightRequest(), env, { now: () => NOW, fetch: provider, timeoutMs: 5 });
    expect(result.status).toBe(503); expect(await result.text()).not.toContain(env.RAPIDAPI_KEY);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('filters optional departure-airport requests and reports method restrictions', async () => {
    const result = await (await invoke(flightRequest('?flightNumber=BA286&date=2026-11-05&departureAirport=LAX'))).json() as FlightLookupResult;
    expect(result.candidates).toEqual([]); expect(provider).toHaveBeenCalledTimes(1);
    const icao = await (await invoke(flightRequest('?flightNumber=BA286&date=2026-11-05&departureAirport=KSFO'))).json() as FlightLookupResult;
    expect(icao.candidates[0].departureAirport).toBe('SFO');
    const wrongMethod = new Request(ORIGIN + '/api/flights', { method: 'POST', headers: { Origin: ORIGIN } });
    const response = await invoke(wrongMethod); expect(response.status).toBe(405); expect(response.headers.get('Allow')).toBe('GET');
  });
  it('scheduled maintenance deletes provider copies and old counters without deleting owner data', async () => {
    await invoke(); await purgeFlightData(env.DB!, NOW / 1000 + 41 * 86_400);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flight_cache').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flight_usage').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 2 });
  });
});
