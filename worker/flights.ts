import { findAirport } from '../src/lib/airports';
import { Temporal } from '@js-temporal/polyfill';
import type { AircraftType, FlightCandidate, FlightLookupResult } from '../src/lib/types';

/** Contract checked against https://doc.aerodatabox.com/docs/openapi-rapidapi-v1.json. */
export interface FlightEnv {
  RAPIDAPI_KEY?: string;
  FLIGHT_DAILY_LIMIT?: string;
  FLIGHT_MONTHLY_LIMIT?: string;
  FLIGHT_GLOBAL_MONTHLY_LIMIT?: string;
}
export interface FlightQuery { flightNumber: string; date: string; departureAirport?: string }
export interface FlightDependencies { fetch?: typeof fetch; timeoutMs?: number; /** Internal deadline covering flight plus airport requests. */ deadlineMs?: number }
interface CacheRow { data: string; fetched_at: number; expires_at: number; retain_until: number }
type JsonRecord = Record<string, unknown>;
const object = (v: unknown): v is JsonRecord => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const HOST = 'aerodatabox.p.rapidapi.com';
const PROVIDER = 'https://' + HOST;
const ATTRIBUTION = 'Flight data by AeroDataBox · https://aerodatabox.com';
// Six days leaves a full day for an hourly scheduled purge to run before the
// provider's seven-day maximum (Terms 5.5). No raw provider responses are stored.
const RETENTION = 6 * 24 * 60 * 60;
const RESPONSE_BYTES = 512 * 1024;
const MAX_FLIGHTS = 40;
const activeRequests = new WeakMap<D1Database, Map<string, Promise<FlightLookupResult>>>();

export class FlightApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type ProviderFailure = 'configuration' | 'timeout' | 'network' | 'redirect' | 'access_denied' | 'rate_limit' | 'http' | 'response';
function providerFailure(path: string, category: ProviderFailure, started: number, status: number, message: string, providerStatus?: number): FlightApiError {
  const reference = 'FLT-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  // This allowlist deliberately excludes the URL, flight/date, account, headers,
  // provider response, and exception text, any of which may contain private data
  // or credentials. The reference connects the on-screen error to Worker logs.
  console.warn(JSON.stringify({
    event: 'flight_provider_failure', provider: 'aerodatabox', reference,
    operation: path.startsWith('/airports/') ? 'airport_lookup' : 'flight_lookup',
    category, elapsedMs: Math.max(0, Date.now() - started),
    ...(providerStatus === undefined ? {} : { providerStatus }),
  }));
  return new FlightApiError(status, `${message} Reference: ${reference}.`);
}

export function normalizeFlightNumber(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 16) return null;
  const normalized = value.trim().toUpperCase().replace(/ +/g, '');
  // IATA carriers include alphanumeric pairs (U2, 6E); ICAO carriers use three
  // letters. A suffix is accepted for an explicitly supplied flight designator.
  return /^(?:[A-Z0-9]{2}|[A-Z]{3})[0-9]{1,4}[A-Z]?$/.test(normalized) && /[A-Z]/.test(normalized.slice(0, 2))
    ? normalized : null;
}
function airportCode(value: unknown): string | null {
  return typeof value === 'string' && /^(?:[A-Z]{3}|[A-Z]{4})$/.test(value) ? value : null;
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 80) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}
export function validateFlightQuery(url: URL, now: number): FlightQuery {
  if (url.search.length > 200 || [...url.searchParams.keys()].some(k => !['flightNumber', 'date', 'departureAirport'].includes(k))
    || [...new Set(url.searchParams.keys())].some(k => url.searchParams.getAll(k).length !== 1)) {
    throw new FlightApiError(400, 'Provide one flight number, departure date, and optional departure airport.');
  }
  const flightNumber = normalizeFlightNumber(url.searchParams.get('flightNumber'));
  const date = url.searchParams.get('date') ?? '';
  const rawAirport = url.searchParams.get('departureAirport');
  const departureAirport = rawAirport === null ? undefined : airportCode(rawAirport.trim().toUpperCase());
  const days = (Date.parse(date + 'T00:00:00Z') - Date.parse(new Date(now * 1000).toISOString().slice(0, 10) + 'T00:00:00Z')) / 86_400_000;
  if (!flightNumber || !validDate(date) || days < -1 || days > 365 || departureAirport === null) {
    throw new FlightApiError(400, 'Use an IATA or ICAO flight number and a valid local departure date within the next year.');
  }
  return { flightNumber, date, ...(departureAirport ? { departureAirport } : {}) };
}

export async function purgeFlightData(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM flight_cache WHERE retain_until <= ?').bind(now),
    db.prepare('DELETE FROM flight_airport_cache WHERE retain_until <= ?').bind(now),
    db.prepare('DELETE FROM flight_usage WHERE retain_until <= ?').bind(now),
  ]);
}
function limit(value: string | undefined, fallback: number, max: number): number {
  return value && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max ? Number(value) : fallback;
}
async function reserveRequest(db: D1Database, env: FlightEnv, accountId: string, now: number): Promise<void> {
  const date = new Date(now * 1000).toISOString();
  const nextDay = new Date(Date.parse(date.slice(0, 10) + 'T00:00:00Z') + 86_400_000).toISOString();
  const nextMonth = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1)).toISOString();
  const reservations = [
    { principal: `user:${accountId}`, bucket: `day:${date.slice(0, 10)}`, maximum: limit(env.FLIGHT_DAILY_LIMIT, 10, 1000), scope: 'account_day', resetsAt: nextDay },
    { principal: `user:${accountId}`, bucket: `month:${date.slice(0, 7)}`, maximum: limit(env.FLIGHT_MONTHLY_LIMIT, 40, 10_000), scope: 'account_month', resetsAt: nextMonth },
    { principal: 'global', bucket: `month:${date.slice(0, 7)}`, maximum: limit(env.FLIGHT_GLOBAL_MONTHLY_LIMIT, 150, 1_000_000), scope: 'global_month', resetsAt: nextMonth },
  ] as const;
  // One SQLite write is atomic across Worker isolates. Materialize the shared
  // capacity decision before modifying any row: all three budgets advance, or
  // none do. Separate upserts would spend a daily/monthly allowance even when a
  // later budget refuses the request and no provider call can be made.
  const reserved = await db.prepare(`
    WITH reservations(principal, bucket, maximum, retain_until) AS (VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)),
    permit(allowed) AS MATERIALIZED (
      SELECT NOT EXISTS (
        SELECT 1 FROM reservations r JOIN flight_usage u ON u.principal = r.principal AND u.bucket = r.bucket
        WHERE u.requests >= r.maximum
      )
    )
    INSERT INTO flight_usage (principal, bucket, requests, retain_until)
    SELECT principal, bucket, 1, retain_until FROM reservations WHERE (SELECT allowed FROM permit)
    ON CONFLICT(principal, bucket) DO UPDATE SET requests = flight_usage.requests + 1
    RETURNING principal, bucket
  `).bind(...reservations.flatMap(value => [value.principal, value.bucket, value.maximum, now + 40 * 86_400])).all();
  if (reserved.results.length === reservations.length) return;
  // Counters only increase during their active bucket, so a second read can
  // identify an exhausted scope without placing private principal IDs in logs.
  for (const reservation of reservations) {
    const current = await db.prepare('SELECT requests FROM flight_usage WHERE principal = ? AND bucket = ?')
      .bind(reservation.principal, reservation.bucket).first<{ requests: number }>();
    if (!current || current.requests < reservation.maximum) continue;
    const reference = 'FLT-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    console.warn(JSON.stringify({ event: 'flight_lookup_allowance_reached', reference, scope: reservation.scope, used: current.requests, maximum: reservation.maximum, resetsAt: reservation.resetsAt }));
    const description = reservation.scope === 'account_day' ? 'daily allowance for this account'
      : reservation.scope === 'account_month' ? 'monthly allowance for this account' : 'shared monthly allowance';
    const reset = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(reservation.resetsAt));
    throw new FlightApiError(429, `Rephase's ${description} for flight lookup has been reached. This is an app safety limit, separate from RapidAPI usage. It resets on ${reset} at 00:00 UTC. Use manual entry until then. Reference: ${reference}.`);
  }
  // Defensive fallback for an unexpected database result; never send a provider
  // request unless all three reservations were confirmed.
  throw new FlightApiError(503, 'Flight lookup allowance could not be checked. Use manual entry or try again later.');
}

async function readProviderJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > RESPONSE_BYTES) throw new FlightApiError(502, 'Flight provider response is too large. Use manual entry.');
  if (!response.headers.get('Content-Type')?.toLowerCase().includes('application/json') || !response.body) {
    throw new FlightApiError(502, 'Flight provider returned an unreadable response. Use manual entry.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_BYTES) { await reader.cancel(); throw new FlightApiError(502, 'Flight provider response is too large. Use manual entry.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); }
  catch { throw new FlightApiError(502, 'Flight provider returned invalid data. Use manual entry.'); }
}
async function providerRequest(path: string, db: D1Database, env: FlightEnv, accountId: string, now: number, dependencies: FlightDependencies): Promise<unknown> {
  const started = Date.now();
  const remaining = (dependencies.deadlineMs ?? (Date.now() + 15_000)) - Date.now();
  if (remaining <= 0) throw providerFailure(path, 'timeout', started, 503, 'Flight lookup timed out. Use manual entry or try again later.');
  const controller = new AbortController();
  const url = PROVIDER + path;
  const options: RequestInit = {
    method: 'GET', headers: { 'X-RapidAPI-Key': env.RAPIDAPI_KEY?.trim() ?? '', 'X-RapidAPI-Host': HOST, Accept: 'application/json' },
    // Workers rejects redirect:'error' before sending the request. Manual mode
    // plus an explicit status check also keeps credentials off redirect hosts.
    signal: controller.signal, redirect: 'manual', cache: 'no-store',
  };
  let request: Request;
  try {
    // Catch known local URL/header/options errors before reserving any budget.
    // A fetch exception after this point might follow a billable network call,
    // so those reservations remain spent rather than blindly refunding errors.
    if (!env.RAPIDAPI_KEY?.trim()) throw new Error('Missing provider key');
    request = new Request(url, options);
  } catch {
    throw providerFailure(path, 'configuration', started, 503, 'Flight lookup is not configured correctly. Use manual entry while the API configuration is checked.');
  }
  await reserveRequest(db, env, accountId, now);
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(dependencies.timeoutMs ?? 8_000, 10_000, remaining)));
  let category: ProviderFailure = 'network';
  let providerStatus: number | undefined;
  try {
    const result = await (dependencies.fetch ?? fetch)(request);
    providerStatus = result.status;
    category = 'http';
    if (result.status >= 300 && result.status < 400) {
      category = 'redirect';
      throw new FlightApiError(503, 'Flight provider returned an unexpected redirect. Use manual entry or try again later.');
    }
    if (result.status === 204 || result.status === 404) return null;
    if (result.status === 401 || result.status === 403) {
      category = 'access_denied';
      throw new FlightApiError(503, 'Flight provider access was denied. Use manual entry while the API subscription is checked.');
    }
    if (result.status === 429) {
      category = 'rate_limit';
      throw new FlightApiError(503, 'The flight provider rate limit was reached. Use manual entry or try again later.');
    }
    if (!result.ok) throw new FlightApiError(503, 'Flight provider is temporarily unavailable or the subscription does not cover this date. Use manual entry.');
    category = 'response';
    return await readProviderJson(result);
  } catch (error) {
    if (controller.signal.aborted) throw providerFailure(path, 'timeout', started, 503, 'Flight lookup timed out. Use manual entry or try again later.', providerStatus);
    if (error instanceof FlightApiError) throw providerFailure(path, category, started, error.status, error.message, providerStatus);
    // Do not log or expose network/body exceptions or automatically retry and
    // spend more credits. Only the allowlisted category/status are recorded.
    throw providerFailure(path, category, started, 503,
      category === 'response' ? 'Flight provider response could not be read. Use manual entry or try again later.'
        : 'Flight provider could not be reached. Use manual entry or try again later.', providerStatus);
  } finally { clearTimeout(timeout); }
}

function airportFrom(movement: unknown): JsonRecord | null { return object(movement) && object(movement.airport) ? movement.airport : null; }
function aircraftFrom(value: unknown): AircraftType | undefined {
  // FlightAircraftContract exposes a nullable model, not IATA/ICAO type codes.
  // Keep just this optional label: registration, transponder and photo data
  // must never become part of a saved trip or imply a confirmed seat layout.
  if (!object(value) || typeof value.model !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(value.model)) return undefined;
  const model = value.model.trim();
  return model && model.length <= 120 ? { model } : undefined;
}
function codeFrom(airport: JsonRecord): string | null { return airportCode(airport.iata) ?? airportCode(airport.icao); }
async function airportZone(airport: JsonRecord, db: D1Database, env: FlightEnv, accountId: string, now: number, dependencies: FlightDependencies, memo: Map<string, string | null>): Promise<string | null> {
  if (validZone(airport.timeZone)) return airport.timeZone;
  const code = codeFrom(airport);
  if (!code) return null;
  const catalogZone = findAirport(code)?.timeZone;
  if (catalogZone) return catalogZone;
  if (memo.has(code)) return memo.get(code)!;
  const saved = await db.prepare('SELECT time_zone FROM flight_airport_cache WHERE airport_code = ? AND retain_until > ?').bind(code, now).first<{ time_zone: string }>();
  if (saved && validZone(saved.time_zone)) { memo.set(code, saved.time_zone); return saved.time_zone; }
  const data = await providerRequest(`/airports/${code.length === 3 ? 'iata' : 'icao'}/${code}?withRunways=false&withTime=false`, db, env, accountId, now, dependencies);
  const zone = object(data) && ((typeof airport.iata === 'string' && data.iata === airport.iata) || (typeof airport.icao === 'string' && data.icao === airport.icao)) && validZone(data.timeZone) ? data.timeZone : null;
  memo.set(code, zone);
  if (zone) await db.prepare('INSERT INTO flight_airport_cache (airport_code, time_zone, retain_until) VALUES (?, ?, ?) ON CONFLICT(airport_code) DO UPDATE SET time_zone = excluded.time_zone, retain_until = excluded.retain_until').bind(code, zone, now + RETENTION).run();
  return zone;
}

/** Require explicit UTC AND local values and check them against an IANA zone.
 * This detects arrival-date, DST-offset and duration errors rather than guessing. */
function timePair(value: unknown, timeZone: string): { utc: string; local: string; epoch: number; disambiguation?: 'earlier' | 'later' } | null {
  if (!object(value) || typeof value.utc !== 'string' || typeof value.local !== 'string'
    || value.utc.length > 40 || value.local.length > 40
    || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|\+00:00)$/.test(value.utc)
    || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value.local)) return null;
  // AeroDataBox uses both separators in explicit UTC fields. Normalize only
  // the separator; the required UTC suffix and all calendar/zone checks stay.
  const utcValue = value.utc.replace(' ', 'T');
  const epoch = Date.parse(utcValue);
  if (!Number.isFinite(epoch)) return null;
  const utcClock = utcValue.replace(/(?:Z|\+00:00)$/, '').replace(/\.\d{1,3}$/, '');
  if (new Date(epoch).toISOString().slice(0, 19) !== (utcClock.length === 16 ? utcClock + ':00' : utcClock)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch));
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  const canonical = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  if (canonical !== value.local.replace(' ', 'T').slice(0, 16)) return null;
  if (value.local.length >= 19 && value.local[16] === ':' && value.local.slice(17, 19) !== get('second')) return null;
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value.local) && Date.parse(value.local.replace(' ', 'T')) !== epoch) return null;
  const clock = Temporal.PlainDateTime.from(canonical);
  const early = clock.toZonedDateTime(timeZone, { disambiguation: 'earlier' }).epochMilliseconds;
  const late = clock.toZonedDateTime(timeZone, { disambiguation: 'later' }).epochMilliseconds;
  const disambiguation = early === late ? undefined : Math.abs(epoch - early) < 60_000 ? 'earlier' : 'later';
  const local = get('second') === '00' ? canonical : `${canonical}:${get('second')}`;
  return { utc: new Date(epoch).toISOString(), local, epoch, ...(disambiguation ? { disambiguation } : {}) };
}

export async function normalizeFlights(payload: unknown, query: FlightQuery, resolveZone: (airport: JsonRecord) => Promise<string | null>): Promise<{ candidates: FlightCandidate[]; warnings: string[] }> {
  if (!Array.isArray(payload) || payload.length > MAX_FLIGHTS) throw new FlightApiError(502, 'Flight provider returned an unexpected collection. Use manual entry.');
  const candidates: FlightCandidate[] = [];
  const warnings = new Set<string>();
  for (const flight of payload) {
    if (!object(flight)) throw new FlightApiError(502, 'Flight provider returned invalid flight data. Use manual entry.');
    const departure = flight.departure; const arrival = flight.arrival;
    const origin = airportFrom(departure); const destination = airportFrom(arrival);
    if (!origin || !destination || !object(departure) || !object(arrival) || !codeFrom(origin) || !codeFrom(destination)) {
      warnings.add('Some provider records lacked complete airports or schedules and were omitted.'); continue;
    }
    if (query.departureAirport && query.departureAirport !== origin.iata && query.departureAirport !== origin.icao) continue;
    if (['Canceled', 'Diverted', 'CanceledUncertain'].includes(String(flight.status)) || flight.isCargo === true) {
      warnings.add('Canceled, diverted, uncertain, or cargo flights were omitted. Confirm your booking with the airline.'); continue;
    }
    const number = normalizeFlightNumber(flight.number);
    if (!number) { warnings.add('A provider record had an invalid flight number and was omitted.'); continue; }
    const departureZone = await resolveZone(origin); const arrivalZone = await resolveZone(destination);
    if (!departureZone || !arrivalZone) { warnings.add('Some airports have no verified IANA time zone; enter these flights manually.'); continue; }
    const start = timePair(departure.scheduledTime, departureZone); const end = timePair(arrival.scheduledTime, arrivalZone);
    if (!start || !end || start.local.slice(0, 10) !== query.date || end.epoch <= start.epoch || end.epoch - start.epoch > 36 * 3_600_000) {
      warnings.add('Some provider schedules had missing or inconsistent dates, UTC times, or durations and were omitted.'); continue;
    }
    if (number !== query.flightNumber || flight.codeshareStatus === 'IsCodeshared') {
      warnings.add('Code-share or operating-flight results may use a different flight number. Select the route that matches your booking.');
    }
    const takeoff = timePair(departure.runwayTime, departureZone); const landing = timePair(arrival.runwayTime, arrivalZone);
    // revisedTime is explicitly ambiguous in the provider contract. It must
    // never be treated as takeoff or landing. Retain explicit runwayTime only
    // when it lies inside the selected schedule and forms a sensible interval.
    const usableTakeoff = takeoff && takeoff.epoch >= start.epoch && takeoff.epoch < end.epoch
      && (!takeoff.disambiguation || takeoff.disambiguation === start.disambiguation);
    const usableLanding = landing && landing.epoch > (usableTakeoff ? takeoff.epoch : start.epoch) && landing.epoch <= end.epoch
      && (!landing.disambiguation || landing.disambiguation === end.disambiguation);
    if (departure.runwayTime || arrival.runwayTime) warnings.add('Runway times, when supplied, are provider estimates or actual times. Recheck after schedule changes.');
    const aircraft = aircraftFrom(flight.aircraft);
    const candidate: FlightCandidate = {
      id: `${number}-${codeFrom(origin)}-${codeFrom(destination)}-${start.utc}`,
      flightNumber: number, airline: object(flight.airline) && typeof flight.airline.name === 'string' ? flight.airline.name.slice(0, 120) : 'Airline not supplied',
      ...(aircraft ? { aircraft } : {}),
      departureAirport: codeFrom(origin)!, arrivalAirport: codeFrom(destination)!,
      departureDateTime: start.local, arrivalDateTime: end.local,
      departureTimeZone: departureZone, arrivalTimeZone: arrivalZone,
      ...(start.disambiguation ? { departureDisambiguation: start.disambiguation } : {}),
      ...(end.disambiguation ? { arrivalDisambiguation: end.disambiguation } : {}),
      departureUtc: start.utc, arrivalUtc: end.utc, durationMinutes: Math.round((end.epoch - start.epoch) / 60_000),
      ...(usableTakeoff ? { takeoffDateTime: takeoff.local } : {}), ...(usableLanding ? { landingDateTime: landing.local } : {}),
    };
    if (!candidates.some(c => c.id === candidate.id)) candidates.push(candidate);
  }
  if (candidates.length > 1) warnings.add('More than one matching leg was found. Select the airports and times on your booking.');
  if (!candidates.length) warnings.add('No complete matching scheduled flight was found. Coverage varies by date and route; use manual entry.');
  return { candidates, warnings: [...warnings] };
}

export async function lookupFlights(query: FlightQuery, db: D1Database, env: FlightEnv, accountId: string, now: number, dependencies: FlightDependencies = {}): Promise<FlightLookupResult> {
  if (!env.RAPIDAPI_KEY?.trim()) throw new FlightApiError(503, 'Flight lookup is not configured. Use manual entry.');
  await purgeFlightData(db, now);
  // The cache is only public scheduled data, never an owner trip record. The
  // search result is shared for a bounded time under Terms 5.5, not pooled from
  // retained owner records under Terms 5.8.
  // Version normalized cache entries so earlier rows that discarded aircraft
  // metadata cannot be mistaken for a current provider omission.
  const key = `v2:${query.flightNumber}:${query.date}:${query.departureAirport ?? '*'}`;
  const cached = await db.prepare('SELECT data, fetched_at, expires_at, retain_until FROM flight_cache WHERE cache_key = ? AND retain_until > ?').bind(key, now).first<CacheRow>();
  let saved: FlightLookupResult | undefined;
  if (cached) {
    try { saved = JSON.parse(cached.data) as FlightLookupResult; }
    catch { await db.prepare('DELETE FROM flight_cache WHERE cache_key = ?').bind(key).run(); }
    if (saved && cached.expires_at > now) return saved;
  }
  let requests = activeRequests.get(db);
  if (!requests) { requests = new Map(); activeRequests.set(db, requests); }
  const existing = requests.get(key);
  if (existing) return await existing;
  if (requests.size >= 30) throw new FlightApiError(503, 'Flight lookup is busy. Try again shortly or use manual entry.');
  const bounded = { ...dependencies, deadlineMs: Date.now() + 15_000 };
  const pending = (async () => {
    try {
      const payload = await providerRequest(`/flights/number/${query.flightNumber}/${query.date}?dateLocalRole=Departure&withAircraftImage=false&withLocation=false&withFlightPlan=false`, db, env, accountId, now, bounded);
      const memo = new Map<string, string | null>();
      const normalized = payload === null ? { candidates: [], warnings: ['No flight was found for this departure date. Use manual entry.'] }
        : await normalizeFlights(payload, query, airport => airportZone(airport, db, env, accountId, now, bounded, memo));
      const near = Date.parse(query.date + 'T00:00:00Z') - now * 1000 < 48 * 3_600_000;
      const ttl = normalized.candidates.length ? (near ? 15 * 60 : 24 * 3_600) : 5 * 60;
      const result: FlightLookupResult = { provider: 'aerodatabox', ...normalized, fetchedAt: new Date(now * 1000).toISOString(), expiresAt: new Date((now + ttl) * 1000).toISOString(), stale: false, attribution: ATTRIBUTION };
      await db.prepare('INSERT INTO flight_cache (cache_key, data, fetched_at, expires_at, retain_until) VALUES (?, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at, retain_until = excluded.retain_until')
        .bind(key, JSON.stringify(result), now, now + ttl, now + RETENTION).run();
      return result;
    } catch (error) {
      // Never hide a quota decision behind stale data; only a provider failure
      // can use a still-permitted stale copy, and it remains explicitly dated.
      if (saved && cached && cached.retain_until > now && error instanceof FlightApiError && [502, 503].includes(error.status)) {
        return { ...saved, stale: true, warnings: [...saved.warnings, 'Provider refresh failed. These cached times are stale; verify them with your airline before using them.'] };
      }
      throw error;
    } finally { requests!.delete(key); }
  })();
  requests.set(key, pending);
  return await pending;
}
