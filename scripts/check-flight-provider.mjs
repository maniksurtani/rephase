import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESPONSE_BYTES = 512 * 1024;
const HOST = 'aerodatabox.p.rapidapi.com';
// A real itinerary already supplied by the owner. This request is opt-in; no
// provider call is made by deployment or by the default usage diagnostic.
const PROBE_PATH = '/flights/number/QF103/2026-10-17?dateLocalRole=Departure&withAircraftImage=false&withLocation=false&withFlightPlan=false';
const USAGE_SQL = `SELECT CASE WHEN principal = 'global' THEN 'global' ELSE 'account' END AS scope,
  bucket, COUNT(*) AS principals, SUM(requests) AS reserved_requests, MAX(requests) AS max_requests
  FROM flight_usage WHERE retain_until > CAST(strftime('%s', 'now') AS INTEGER)
  GROUP BY scope, bucket ORDER BY bucket, scope`;
const PROBE_QUERY = { flightNumber: 'QF103', date: '2026-10-17' };

function value(env, name) { return typeof env[name] === 'string' ? env[name].trim() : ''; }
function safeInteger(number) { return typeof number === 'number' && Number.isSafeInteger(number) && number >= 0; }
function budget(env, name, fallback, maximum) {
  const supplied = value(env, name);
  if (!supplied) return fallback;
  if (!/^\d+$/.test(supplied) || Number(supplied) < 1 || Number(supplied) > maximum) {
    throw new Error('Invalid application allowance configuration.');
  }
  return Number(supplied);
}

/** Never include response bodies, request URLs, exception text or credentials in logs. */
async function requestJson(url, init, fetcher) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal, redirect: 'manual', cache: 'no-store' });
    if (!response.body) return { response, bytes: 0, data: null };
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > RESPONSE_BYTES) {
          await reader.cancel();
          return { response, bytes: RESPONSE_BYTES + 1, data: null };
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    let data = null;
    if (response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      const joined = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
      try { data = JSON.parse(new TextDecoder().decode(joined)); } catch { /* Log only the invalid-data classification. */ }
    }
    return { response, bytes, data };
  } catch {
    throw new Error(controller.signal.aborted ? 'Diagnostic request timed out.' : 'Diagnostic network request failed.');
  } finally { clearTimeout(timeout); }
}

export async function inspectUsage(env = process.env, fetcher = fetch, output = console.log) {
  const account = value(env, 'CLOUDFLARE_ACCOUNT_ID');
  const database = value(env, 'CLOUDFLARE_D1_DATABASE_ID');
  const token = value(env, 'CLOUDFLARE_API_TOKEN');
  if (!/^[a-f0-9]{32}$/i.test(account) || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(database) || !token) {
    throw new Error('Cloudflare account, database and token settings are required.');
  }
  const limits = {
    accountDay: budget(env, 'FLIGHT_DAILY_LIMIT', 10, 1_000),
    accountMonth: budget(env, 'FLIGHT_MONTHLY_LIMIT', 40, 10_000),
    globalMonth: budget(env, 'FLIGHT_GLOBAL_MONTHLY_LIMIT', 150, 1_000_000),
  };
  const { response, data } = await requestJson(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: USAGE_SQL }),
  }, fetcher);
  if (!response.ok || data?.success !== true || !Array.isArray(data.result) || data.result.length !== 1 || data.result[0]?.success !== true || !Array.isArray(data.result[0]?.results)) {
    output(JSON.stringify({ event: 'flight_usage_diagnostic', status: response.status, result: 'unavailable' }));
    throw new Error('Read-only application allowance inspection failed.');
  }
  const rows = data.result[0].results.map(row => {
    if (!['account', 'global'].includes(row.scope) || !/^(day:\d{4}-\d{2}-\d{2}|month:\d{4}-\d{2})$/.test(row.bucket)
        || !safeInteger(row.principals) || !safeInteger(row.reserved_requests) || !safeInteger(row.max_requests)) {
      throw new Error('Application allowance diagnostic returned unexpected data.');
    }
    return { scope: row.scope, bucket: row.bucket, counterCount: row.principals, reservedRequests: row.reserved_requests, maxRequests: row.max_requests };
  });
  output(JSON.stringify({ event: 'flight_usage_diagnostic', result: 'ok', limits, rows }));
}

/** Bundle only repository code in memory; payloads and credentials never enter it. */
export async function loadFlightNormalizer() {
  try {
    const { build } = await import('esbuild');
    const projectRoot = fileURLToPath(new URL('../', import.meta.url));
    const result = await build({
      stdin: {
        contents: `import { normalizeFlights } from './worker/flights.ts';
          import { findAirport } from './src/lib/airports.ts';
          export async function normalize(payload, query) {
            return normalizeFlights(payload, query, async airport => {
              if (typeof airport.timeZone === 'string') {
                try { new Intl.DateTimeFormat('en', { timeZone: airport.timeZone }); return airport.timeZone; } catch {}
              }
              const code = typeof airport.iata === 'string' ? airport.iata : airport.icao;
              return typeof code === 'string' ? findAirport(code)?.timeZone ?? null : null;
            });
          }`,
        resolveDir: projectRoot, sourcefile: 'flight-diagnostic-normalizer.ts', loader: 'ts',
      },
      bundle: true, platform: 'node', format: 'esm', target: 'node24', write: false, logLevel: 'silent',
    });
    const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    return module.normalize;
  } catch {
    throw new Error('Could not load application flight validation. No provider request was made.');
  }
}

export async function inspectProvider(env = process.env, fetcher = fetch, output = console.log, suppliedNormalizer) {
  const key = value(env, 'RAPIDAPI_KEY');
  if (!key) throw new Error('The production RAPIDAPI_KEY secret is required.');
  // Prepare the real application validator before spending provider units.
  const normalize = suppliedNormalizer ?? await loadFlightNormalizer();
  const { response, bytes, data } = await requestJson(`https://${HOST}${PROBE_PATH}`, {
    method: 'GET', headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': HOST, Accept: 'application/json' },
  }, fetcher);
  const quota = {};
  for (const header of ['x-ratelimit-requests-limit', 'x-ratelimit-requests-remaining', 'x-ratelimit-requests-reset',
    'x-ratelimit-api-units-limit', 'x-ratelimit-api-units-remaining', 'x-ratelimit-api-units-reset']) {
    const number = response.headers.get(header);
    if (number !== null && /^\d{1,12}$/.test(number)) quota[header] = Number(number);
  }
  const result = response.status === 204 || response.status === 404 ? 'no_schedule'
    : response.ok && Array.isArray(data) ? (data.length ? 'schedule_returned' : 'no_schedule')
      : response.status === 401 || response.status === 403 ? 'access_denied'
        : response.status === 429 ? 'provider_rate_limit' : 'provider_error';
  // Presence checks only: this is not a replacement for the Worker's airport,
  // timezone, UTC/local and duration validation before offering a flight.
  const completeScheduleRecordCount = Array.isArray(data) ? data.filter(row => [row?.departure, row?.arrival].every(movement =>
    movement && typeof (movement.airport?.iata ?? movement.airport?.icao) === 'string'
      && typeof movement.scheduledTime?.utc === 'string' && typeof movement.scheduledTime?.local === 'string')).length : undefined;
  const utcSpaceRecordCount = Array.isArray(data) ? data.filter(row => [row?.departure, row?.arrival].some(movement =>
    typeof movement?.scheduledTime?.utc === 'string' && /^\d{4}-\d{2}-\d{2} /.test(movement.scheduledTime.utc))).length : undefined;
  let normalized;
  if (Array.isArray(data)) {
    try {
      const checked = await normalize(data, PROBE_QUERY);
      if (Array.isArray(checked?.candidates) && Array.isArray(checked?.warnings)) normalized = checked;
    } catch { /* Do not print payload details or application exceptions. */ }
  }
  output(JSON.stringify({ event: 'flight_provider_diagnostic', status: response.status, result, responseBytes: bytes,
    ...(Array.isArray(data) ? { scheduleCount: data.length, completeScheduleRecordCount, utcSpaceRecordCount,
      normalizedCandidateCount: normalized?.candidates.length ?? 0, warningCount: normalized?.warnings.length ?? 0 } : {}), quota }));
  if (!['schedule_returned', 'no_schedule'].includes(result)) throw new Error('Provider diagnostic did not confirm a usable subscription.');
  if (result === 'schedule_returned' && !normalized?.candidates.length) {
    throw new Error('Provider returned schedules that the application could not validate.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !['--usage', '--provider'].includes(args[0])) throw new Error('Usage: node scripts/check-flight-provider.mjs --usage | --provider');
    if (args[0] === '--usage') await inspectUsage();
    else await inspectProvider();
  } catch (error) {
    // All errors raised above use fixed messages; never print fetch errors.
    console.error(error.message);
    process.exitCode = 1;
  }
}
