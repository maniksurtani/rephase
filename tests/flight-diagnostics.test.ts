import { afterEach, describe, expect, it, vi } from 'vitest';
// Node command modules intentionally run without a TypeScript build.
// @ts-expect-error JavaScript command modules intentionally have no declaration files.
import { inspectProvider as runProviderInspection, inspectUsage, loadFlightNormalizer } from '../scripts/check-flight-provider.mjs';

// Most tests isolate request/privacy behavior from the bundled app validator.
const inspectProvider = (env: unknown, fetcher: unknown, log: unknown, normalize = async () => ({ candidates: [{}], warnings: [] })) =>
  runProviderInspection(env, fetcher, log, normalize);

const environment = {
  CLOUDFLARE_ACCOUNT_ID: '1234567890abcdef1234567890abcdef',
  CLOUDFLARE_D1_DATABASE_ID: 'b5e100d0-6122-4466-a7d7-ae63485e2502',
  CLOUDFLARE_API_TOKEN: 'private-cloudflare-token',
  RAPIDAPI_KEY: 'private-provider-key',
};
const usageResponse = (rows: unknown[]) => Response.json({ success: true, result: [{ success: true, results: rows }] });
const scheduled = {
  departure: { airport: { iata: 'SYD' }, scheduledTime: { utc: '2026-10-17T09:00:00Z', local: '2026-10-17T20:00:00+11:00' } },
  arrival: { airport: { iata: 'HNL' }, scheduledTime: { utc: '2026-10-17T18:30:00Z', local: '2026-10-17T08:30:00-10:00' } },
};

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('manual flight diagnostics', () => {
  it('queries read-only aggregates and emits only safe fields and configured limits', async () => {
    const fetchDiagnostic = vi.fn().mockResolvedValue(usageResponse([{
      scope: 'account', bucket: 'day:2026-10-15', principals: 2, reserved_requests: 12, max_requests: 10,
      principal: 'private-account-identifier', providerKey: 'private-response-value',
    }, { scope: 'global', bucket: 'month:2026-10', principals: 1, reserved_requests: 15, max_requests: 15 }]));
    const log = vi.fn();

    await inspectUsage({ ...environment, FLIGHT_DAILY_LIMIT: '15', FLIGHT_MONTHLY_LIMIT: '50', FLIGHT_GLOBAL_MONTHLY_LIMIT: '100' }, fetchDiagnostic, log);

    expect(fetchDiagnostic).toHaveBeenCalledTimes(1);
    const [url, options] = fetchDiagnostic.mock.calls[0];
    expect(url).toMatch(/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\//);
    expect(options.method).toBe('POST');
    expect(options.redirect).toBe('manual');
    const { sql } = JSON.parse(options.body);
    expect(sql).toMatch(/^SELECT /);
    expect(sql).toContain('GROUP BY scope, bucket');
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE)\b/i);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      event: 'flight_usage_diagnostic', result: 'ok',
      limits: { accountDay: 15, accountMonth: 50, globalMonth: 100 },
      rows: [
        { scope: 'account', bucket: 'day:2026-10-15', counterCount: 2, reservedRequests: 12, maxRequests: 10 },
        { scope: 'global', bucket: 'month:2026-10', counterCount: 1, reservedRequests: 15, maxRequests: 15 },
      ],
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-');
    expect(JSON.stringify(log.mock.calls)).not.toContain(environment.CLOUDFLARE_ACCOUNT_ID);
    expect(JSON.stringify(log.mock.calls)).not.toContain(environment.CLOUDFLARE_D1_DATABASE_ID);
  });

  it('keeps Cloudflare error bodies out of diagnostic output', async () => {
    const fetchDiagnostic = vi.fn().mockResolvedValue(Response.json({
      success: false, errors: [{ message: 'private-cloudflare-token private-account-identifier' }],
    }, { status: 403 }));
    const log = vi.fn();

    await expect(inspectUsage(environment, fetchDiagnostic, log)).rejects.toThrow('Read-only application allowance inspection failed.');

    expect(JSON.parse(log.mock.calls[0][0])).toEqual({ event: 'flight_usage_diagnostic', status: 403, result: 'unavailable' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-');
  });

  it('rejects unexpected aggregate fields before logging potentially identifying values', async () => {
    const fetchDiagnostic = vi.fn().mockResolvedValue(usageResponse([{
      scope: 'private-account-identifier', bucket: 'day:2026-10-15', principals: 1, reserved_requests: 3, max_requests: 3,
    }]));
    const log = vi.fn();

    await expect(inspectUsage(environment, fetchDiagnostic, log)).rejects.toThrow('unexpected data');
    expect(log).not.toHaveBeenCalled();
  });

  it('reports schedule presence and numeric provider quota headers without response details', async () => {
    const fetchDiagnostic = vi.fn().mockResolvedValue(Response.json([
      { ...scheduled, number: 'private-flight-designator', privateValue: 'private-provider-body' },
      { number: 'private-incomplete-flight', departure: scheduled.departure },
    ], { headers: {
      'x-ratelimit-api-units-limit': '400', 'x-ratelimit-api-units-remaining': '398',
      'x-ratelimit-api-units-reset': '172000', 'x-ratelimit-requests-remaining': 'private-header-value',
      'x-private-header': 'private-header-value',
    } }));
    const log = vi.fn();

    await inspectProvider(environment, fetchDiagnostic, log);

    expect(fetchDiagnostic).toHaveBeenCalledTimes(1);
    const [url, options] = fetchDiagnostic.mock.calls[0];
    expect(url).toMatch(/^https:\/\/aerodatabox\.p\.rapidapi\.com\/flights\/number\//);
    expect(options.method).toBe('GET');
    expect(options.headers['X-RapidAPI-Key']).toBe(environment.RAPIDAPI_KEY);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      event: 'flight_provider_diagnostic', status: 200, result: 'schedule_returned', responseBytes: expect.any(Number),
      scheduleCount: 2, completeScheduleRecordCount: 1, utcSpaceRecordCount: 0,
      aircraftModelRecordCount: 0, normalizedCandidateCount: 1, normalizedAircraftCount: 0, warningCount: 0,
      quota: { 'x-ratelimit-api-units-limit': 400, 'x-ratelimit-api-units-remaining': 398, 'x-ratelimit-api-units-reset': 172000 },
    });
    const output = JSON.stringify(log.mock.calls);
    expect(output).not.toContain('private-');
    expect(output).not.toContain('SYD');
    expect(output).not.toContain('HNL');
    expect(output).not.toContain('2026-10-17');
  });

  it('bundles the actual application normalizer and static airport zones without making a provider request', async () => {
    const normalize = await loadFlightNormalizer();
    const result = await normalize([{ ...scheduled, number: 'QF103', status: 'Expected' }], { flightNumber: 'QF103', date: '2026-10-17' });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ departureAirport: 'SYD', arrivalAirport: 'HNL', durationMinutes: 570 });
    expect(result.warnings).toEqual([]);
  });

  it('counts provided aircraft labels and normalized aircraft without revealing models or tracking fields', async () => {
    const normalize = await loadFlightNormalizer();
    const fetchDiagnostic = vi.fn().mockResolvedValue(Response.json([
      { ...scheduled, number: 'QF103', aircraft: { model: 'private-aircraft-model', registration: 'private-registration', modeS: 'private-transponder', image: 'https://private-image.example/' } },
      { ...scheduled, number: 'QF103' },
      { ...scheduled, number: 'QF103', aircraft: { model: 123, registration: 'private-registration' } },
      { ...scheduled, number: 'QF103', aircraft: { model: '   ' } },
    ]));
    const log = vi.fn();

    await inspectProvider(environment, fetchDiagnostic, log, normalize);

    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      scheduleCount: 4, aircraftModelRecordCount: 1, normalizedCandidateCount: 1, normalizedAircraftCount: 1,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/registration|modeS|transponder|https:|image/);
  });

  it('flags schedules rejected by the application without logging warnings, dates or validation exceptions', async () => {
    const fetchDiagnostic = vi.fn().mockResolvedValue(Response.json([{ ...scheduled, number: 'private-designator' }]));
    const log = vi.fn();
    const normalize = vi.fn().mockResolvedValue({ candidates: [], warnings: ['private-date private-route private-warning'] });

    await expect(inspectProvider(environment, fetchDiagnostic, log, normalize)).rejects.toThrow('application could not validate');

    expect(normalize).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ normalizedCandidateCount: 0, warningCount: 1 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-');
  });

  it('counts provider UTC strings with a space separator without exposing the timestamps', async () => {
    const fetchDiagnostic = vi.fn().mockResolvedValue(Response.json([{
      ...scheduled, departure: { ...scheduled.departure, scheduledTime: { ...scheduled.departure.scheduledTime, utc: '2026-10-17 09:00Z' } },
    }]));
    const log = vi.fn();

    await inspectProvider(environment, fetchDiagnostic, log);

    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ utcSpaceRecordCount: 1 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('2026-10-17');
  });

  it('never follows provider redirects with credentials or logs their location/body', async () => {
    const fetchDiagnostic = vi.fn().mockResolvedValue(new Response('private-redirect-body', {
      status: 302, headers: { location: 'https://private-redirect.example/?token=private-provider-key' },
    }));
    const log = vi.fn();

    await expect(inspectProvider(environment, fetchDiagnostic, log)).rejects.toThrow('did not confirm a usable subscription');

    expect(fetchDiagnostic).toHaveBeenCalledTimes(1);
    expect(fetchDiagnostic.mock.calls[0][1].redirect).toBe('manual');
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ status: 302, result: 'provider_error' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-');
    expect(JSON.stringify(log.mock.calls)).not.toContain('location');
  });

  it('cancels an oversized stream at the byte limit without parsing or logging its body', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(512 * 1024 + 1).fill(65)); },
      cancel,
    });
    const fetchDiagnostic = vi.fn().mockResolvedValue(new Response(stream, { headers: { 'content-type': 'application/json' } }));
    const log = vi.fn();

    await expect(inspectProvider(environment, fetchDiagnostic, log)).rejects.toThrow('did not confirm a usable subscription');

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      event: 'flight_provider_diagnostic', status: 200, result: 'provider_error', responseBytes: 512 * 1024 + 1, quota: {},
    });
    expect(log.mock.calls[0][0].length).toBeLessThan(250);
  });

  it.each([
    [401, 'access_denied'], [403, 'access_denied'], [429, 'provider_rate_limit'], [500, 'provider_error'],
  ])('classifies provider HTTP %i without exposing error bodies', async (status, result) => {
    const fetchDiagnostic = vi.fn().mockResolvedValue(Response.json({ message: 'private-provider-key private-provider-body' }, { status }));
    const log = vi.fn();

    await expect(inspectProvider(environment, fetchDiagnostic, log)).rejects.toThrow('did not confirm a usable subscription');

    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ status, result });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-');
  });

  it('sanitizes network exceptions instead of exposing URLs, credentials or stack traces', async () => {
    const fetchDiagnostic = vi.fn().mockRejectedValue(new Error('private-provider-key https://private-network.example/'));
    const log = vi.fn();

    await expect(inspectProvider(environment, fetchDiagnostic, log)).rejects.toThrow('Diagnostic network request failed.');
    expect(log).not.toHaveBeenCalled();
  });

  it('times out a stalled provider request without logging the underlying exception', async () => {
    vi.useFakeTimers();
    const fetchDiagnostic = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('private-provider-key timeout details')));
    }));
    const log = vi.fn();
    const result = expect(inspectProvider(environment, fetchDiagnostic, log)).rejects.toThrow('Diagnostic request timed out.');

    await vi.advanceTimersByTimeAsync(12_000);
    await result;
    expect(log).not.toHaveBeenCalled();
  });

  it('does not make network calls when secrets or allowance settings are invalid', async () => {
    const fetchDiagnostic = vi.fn();
    const log = vi.fn();

    await expect(inspectProvider({}, fetchDiagnostic, log)).rejects.toThrow('RAPIDAPI_KEY');
    await expect(inspectUsage({ ...environment, CLOUDFLARE_API_TOKEN: '' }, fetchDiagnostic, log)).rejects.toThrow('settings are required');
    await expect(inspectUsage({ ...environment, FLIGHT_DAILY_LIMIT: 'private-invalid-budget' }, fetchDiagnostic, log)).rejects.toThrow('Invalid application allowance configuration.');

    expect(fetchDiagnostic).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
