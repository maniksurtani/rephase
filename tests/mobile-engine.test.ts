import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { buildMobileEngine } from '../scripts/build-mobile-engine.mjs';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import { buildCalendar } from '../src/lib/export';
import { generatePlan } from './support/planning';
import { evaluateAirportLounges } from '../src/lib/lounge-access';
import { loungeDataFor } from '../src/lib/lounge-data';
import type { LoungeVisitContext } from '../src/lib/lounge-types';
import type { AppData, Plan, Trip } from '../src/lib/types';
import october from './fixtures/itineraries/oct2026.json';

type Result = Record<string, any>;
let invoke: (operation: string, payload?: Record<string, unknown>) => Result;
let directory: string;
const preferences = { ...DEFAULT_PREFERENCES, homeTimeZone: 'Australia/Sydney' };
const now = Date.parse('2026-10-18T23:13:00Z');
const serial = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const comparable = (plan: Plan) => ({ ...plan, generatedAt: 'ignored-wall-clock' });

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rephase-mobile-engine-'));
  const outfile = join(directory, 'engine.js');
  await buildMobileEngine(outfile);
  const context = { Intl, Date, TextEncoder, TextDecoder, structuredClone, crypto: webcrypto };
  runInNewContext(await readFile(outfile, 'utf8'), context);
  invoke = (operation, payload = {}) => {
    const response = serial((context as Result).RephaseMobile.invoke(operation, serial(payload)));
    if (!response.ok) throw new Error(response.error);
    return response.result;
  };
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('bundled offline mobile boundary', () => {
  it('preserves the exact five-flight plan and airport identities through JSON', () => {
    const trip = october.trip as Trip;
    const prefs = { ...preferences, planningMode: 'rules' as const };
    const result = invoke('plan', { trip, preferences: prefs, now });
    expect(comparable(result.plan)).toEqual(comparable(generatePlan(trip, prefs, { now })));
    expect(result.days.find((day: Result) => day.date === '2026-10-20').city).toBe('San Francisco');
    expect(result.days.map((day: Result) => day.date)).toContain('2026-10-18');
    const departure = result.days.find((day: Result) => day.date === '2026-10-19');
    const entries = departure.steps.flatMap((step: Result) => step.entries);
    const lounge = entries.find((entry: Result) => entry.kind === 'lounge');
    const flight = entries.find((entry: Result) => entry.kind === 'flight');
    expect(lounge.start).toBeLessThan(flight.start);
    expect(flight.flight.departureClock.time).toBe('14:40');
    expect(
      result.today.previewActions.every((action: Result) => Date.parse(action.end) > now),
    ).toBe(true);
  });

  it('retains Sunday and the exact model after adherence replay', () => {
    const trip: Trip = { ...october.trip, legs: october.trip.legs.slice(0, 4) as Trip['legs'] };
    const original = generatePlan(trip, preferences, { now });
    const sleep = original.days
      .flatMap((day) => day.actions)
      .find((action) => action.type === 'sleep' && action.start < '2026-10-17')!;
    trip.adherence = [
      {
        id: 'mobile-observation',
        tripId: trip.id,
        actionId: sleep.id,
        type: sleep.type,
        scheduledStart: sleep.start,
        scheduledEnd: sleep.end,
        timeZone: sleep.timeZone,
        status: 'completed',
        recordedAt: sleep.end,
      },
    ];
    const result = invoke('plan', { trip, preferences, now });
    expect(result.plan).toEqual(serial(generatePlan(trip, preferences, { now })));
    expect(result.days.find((day: Result) => day.date === '2026-10-18')).toMatchObject({
      city: 'Honolulu',
      actions: [],
      stage: 'destination',
    });
    expect(result.today.dayId).toBe('2026-10-18');
  }, 30_000);

  it('rejects DST gaps, requires a fold choice, and renders the repeated hour with its actual offset', () => {
    expect(
      invoke('localTime', { dateTime: '2026-03-08T02:30', timeZone: 'America/New_York' }),
    ).toMatchObject({ valid: false, ambiguous: false });
    expect(
      invoke('localTime', { dateTime: '2026-11-01T01:30', timeZone: 'America/New_York' }),
    ).toMatchObject({ valid: false, ambiguous: true });
    const earlier = invoke('localTime', {
      dateTime: '2026-11-01T01:30',
      timeZone: 'America/New_York',
      disambiguation: 'earlier',
    });
    const later = invoke('localTime', {
      dateTime: '2026-11-01T01:30',
      timeZone: 'America/New_York',
      disambiguation: 'later',
    });
    expect(later.epochMs - earlier.epochMs).toBe(3_600_000);
    expect(invoke('clock', { instant: later.iso, timeZone: 'America/New_York' })).toMatchObject({
      localDateTime: '2026-11-01T01:30',
      choice: 'later',
    });
    const plan: Plan = {
      version: 'fixture',
      tripId: october.trip.id,
      generatedAt: new Date(now).toISOString(),
      warnings: [],
      summary: { destinations: 1, flightHours: 0, timeZoneChanges: 0 },
      days: [
        {
          id: 'dst-day',
          date: '2026-10-25',
          timeZone: 'Europe/London',
          locationAirport: 'LHR',
          stage: 'destination',
          label: 'London',
          actions: [],
          phaseShiftHours: 0,
          remainingShiftHours: 0,
          note: '',
        },
      ],
    };
    const result = invoke('view', { plan, trip: { ...october.trip, legs: [] }, now });
    expect(result.days[0].timeline.end - result.days[0].timeline.start).toBe(25 * 3_600_000);
    expect(
      new Set(result.days[0].steps.flatMap((step: Result) => [step.clock.zone, step.endClock.zone]))
        .size,
    ).toBe(2);
  });

  it('uses the shared catalogs, validation, merge, lounge rules and calendar exporter', () => {
    const catalog = invoke('bootstrap');
    expect(catalog.airports.find((airport: Result) => airport.code === 'SFO').city).toBe(
      'San Francisco',
    );
    expect(
      catalog.loyaltyPrograms
        .find((program: Result) => program.id === 'united-mileageplus')
        .tiers.map((tier: Result) => tier.id),
    ).toContain('united-premier-1k');
    const data: AppData = {
      schemaVersion: 1,
      preferences,
      trips: [october.trip as Trip],
      selectedTripId: october.trip.id,
    };
    expect(invoke('validateData', { data }).valid).toBe(true);
    const local = structuredClone(data);
    local.preferences.caffeine = false;
    const remote = structuredClone(data);
    remote.preferences.loungeMemberships = ['priority-pass'];
    expect(invoke('merge', { base: data, local, remote })).toMatchObject({
      data: { preferences: { caffeine: false, loungeMemberships: ['priority-pass'] } },
      conflicts: [],
    });
    const context: LoungeVisitContext = {
      memberships: ['qantas-platinum'],
      cabin: 'business',
      operatingCarrier: 'QF',
      marketingCarrier: 'QF',
      route: 'international',
      terminal: 'Tom Bradley International Terminal',
      visitStart: '2026-10-25T02:00:00Z',
      visitEnd: '2026-10-25T05:00:00Z',
      departure: '2026-10-25T06:40:00Z',
      now: new Date(now).toISOString(),
    };
    expect(invoke('lounges', { airport: 'LAX', context }).results).toEqual(
      serial(evaluateAirportLounges(loungeDataFor('LAX')!, context).results),
    );
    expect(
      invoke('lounges', { airport: 'LAX', context: { ...context, visitEnd: context.departure } }),
    ).toMatchObject({
      results: [],
      error: 'Finish your lounge visit at least 30 minutes before departure.',
    });
    const plan = generatePlan(
      october.trip as Trip,
      { ...preferences, planningMode: 'rules' },
      { now },
    );
    expect(invoke('calendar', { plan, trip: october.trip, withAlarms: false }).contents).toBe(
      buildCalendar(plan, october.trip as Trip, false),
    );
  });
});
