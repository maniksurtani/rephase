import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import { availablePreparationStart, groundSleepSchedule } from '../src/lib/sleep-policy';
import { dateInZone, formatTime, localToInstant } from '../src/lib/time';
import type { Plan, Preferences, Trip } from '../src/lib/types';
import { generatePlan } from './support/planning';
import october from './fixtures/itineraries/oct2026.json';

const HOUR = 3_600_000;
const zone = 'Australia/Sydney';
const now = Date.parse('2026-11-07T00:00:00Z');
const prefs: Preferences = { ...DEFAULT_PREFERENCES, homeTimeZone: zone, preparationDays: 3 };
// Illustrative test times; these are not the traveler's confirmed booking.
const trip: Trip = {
  id: 'qf11-late-entry',
  name: 'Sydney to Los Angeles',
  createdAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
  legs: [
    {
      id: 'qf11',
      flightNumber: 'QF11',
      departureAirport: 'SYD',
      arrivalAirport: 'LAX',
      departureDateTime: '2026-11-08T11:20',
      arrivalDateTime: '2026-11-08T06:00',
      departureTimeZone: zone,
      arrivalTimeZone: 'America/Los_Angeles',
      stayAfter: 'destination',
      strategy: 'adapt',
      lieFlat: true,
      travelClass: 'business',
    },
  ],
};
function nights(plan: Plan, timeZone: string) {
  const result: { start: number; end: number }[] = [];
  for (const action of plan.days
    .flatMap((day) => day.actions)
    .filter((a) => a.type === 'sleep' && a.timeZone === timeZone)
    .sort((a, b) => a.start.localeCompare(b.start))) {
    const start = Date.parse(action.start),
      end = Date.parse(action.end),
      previous = result.at(-1);
    if (previous?.end === start) previous.end = end;
    else result.push({ start, end });
  }
  return result;
}

describe('practical sleep policy', () => {
  it.each(['model', 'rules'] as const)(
    'late-entry QF11 keeps usual wake time and cannot invent prior preparation (%s)',
    (planningMode) => {
      const plan = generatePlan(trip, { ...prefs, planningMode }, { now });
      const sleep = nights(plan, zone);
      expect(sleep).toHaveLength(1);
      expect(dateInZone(sleep[0].start, zone)).toBe('2026-11-07');
      expect(formatTime(sleep[0].start, zone) >= '22:00').toBe(true);
      expect(formatTime(sleep[0].end, zone)).toBe('07:00');
      expect(sleep[0].end - sleep[0].start).toBeGreaterThanOrEqual(8 * HOUR);
      expect(
        plan.days
          .filter((day) => day.stage === 'preparation')
          .every((day) => day.date >= '2026-11-07'),
      ).toBe(true);
      expect(
        nights(generatePlan(trip, { ...prefs, preparationDays: 7, planningMode }, { now }), zone),
      ).toEqual(sleep);
      // Loading later must not drift or erase tonight's already-issued schedule.
      expect(
        nights(generatePlan(trip, { ...prefs, planningMode }, { now: now + HOUR }), zone),
      ).toEqual(sleep);
    },
  );

  it('offers bounded extra rest without forcing an earlier morning, including early and late sleepers', () => {
    for (const [bed, wake] of [
      ['23:00', '07:00'],
      ['21:00', '05:00'],
      ['01:00', '09:00'],
    ]) {
      const custom = { ...prefs, usualBedtime: bed, usualWakeTime: wake };
      const result = groundSleepSchedule(
        {
          start: localToInstant('2026-11-05T11:00', zone),
          end: localToInstant('2026-11-08T09:20', zone),
        },
        custom,
        { zone, preparation: true, direction: 'advance', choice: 'extended', routeHours: 6 },
      );
      for (const sleep of result.sleeps) {
        expect(formatTime(sleep.end, zone)).toBe(wake);
        expect(sleep.end - sleep.start).toBeLessThanOrEqual(10 * HOUR);
        expect(sleep.end - sleep.start).toBeGreaterThanOrEqual(8 * HOUR);
      }
      expect(result.sleeps.some((sleep) => sleep.end - sleep.start > 8 * HOUR)).toBe(true);
    }
  });

  it.each(['model', 'rules'] as const)(
    'an early flight moves bedtime too, while late entry cannot recover elapsed sleep (%s)',
    (planningMode) => {
      const early = { ...trip, legs: [{ ...trip.legs[0], departureDateTime: '2026-11-08T07:00' }] };
      const [sleep] = nights(generatePlan(early, { ...prefs, planningMode }, { now }), zone);
      expect(formatTime(sleep.end, zone)).toBe('05:00');
      expect(sleep.end - sleep.start).toBe(8 * HOUR);
      const created = localToInstant('2026-11-07T23:30', zone);
      const late = { ...early, createdAt: new Date(created).toISOString() };
      const [short] = nights(
        generatePlan(late, { ...prefs, planningMode }, { now: created }),
        zone,
      );
      expect(short.start).toBe(created);
      expect(formatTime(short.end, zone)).toBe('05:00');
    },
  );

  it('keeps local anchors and elapsed sleep across both DST changes', () => {
    for (const date of ['2026-03-08', '2026-11-01']) {
      const ny = 'America/New_York';
      const range = {
        start: localToInstant(`${date}T00:00`, ny),
        end: localToInstant(`${date}T23:59`, ny),
      };
      for (const anchor of ['wake', 'bed'] as const) {
        const result = groundSleepSchedule(
          range,
          { ...prefs, sleepAnchor: anchor },
          { zone: ny, preparation: false, direction: 'advance', choice: 'routine', routeHours: 4 },
        );
        for (const sleep of result.sleeps) {
          expect(sleep.end - sleep.start).toBe(8 * HOUR);
          expect(formatTime(anchor === 'wake' ? sleep.end : sleep.start, ny)).toBe(
            anchor === 'wake' ? '07:00' : '23:00',
          );
        }
      }
    }
  });

  it('retains reported past exposure on import and all flights on retrospective entry', () => {
    const requested = now - 3 * 24 * HOUR,
      departure = localToInstant(trip.legs[0].departureDateTime, zone);
    const observed = now - 24 * HOUR;
    const imported: Trip = {
      ...trip,
      adherence: [
        {
          id: 'record',
          tripId: trip.id,
          actionId: 'sleep',
          type: 'sleep',
          status: 'completed',
          scheduledStart: new Date(observed).toISOString(),
          scheduledEnd: new Date(observed + 8 * HOUR).toISOString(),
          recordedAt: new Date(observed + 8 * HOUR).toISOString(),
          timeZone: zone,
        },
      ],
    };
    expect(availablePreparationStart(imported, requested, departure, now)).toBe(observed);
    const enteredAfter = { ...trip, createdAt: '2026-11-10T00:00:00Z' };
    expect(availablePreparationStart(enteredAfter, requested, departure)).toBe(departure);
    const plan = generatePlan(enteredAfter, prefs, { now: Date.parse(enteredAfter.createdAt) });
    expect(plan.summary.flightHours).toBeGreaterThan(0);
    expect(
      plan.days
        .flatMap((day) => day.travelSegments ?? [])
        .some((flight) => flight.flightNumber === 'QF11'),
    ).toBe(true);
  });

  it('keeps San Francisco nights practical across the multi-destination Pacific itinerary', () => {
    const plan = generatePlan(october.trip as Trip, prefs, {
      now: Date.parse('2026-10-21T12:00:00Z'),
    });
    const sfo = nights(plan, 'America/Los_Angeles').filter((sleep) =>
      ['2026-10-21', '2026-10-22', '2026-10-23'].includes(
        dateInZone(sleep.start, 'America/Los_Angeles'),
      ),
    );
    expect(sfo).toHaveLength(3);
    for (const sleep of sfo) {
      expect(formatTime(sleep.end, 'America/Los_Angeles')).toBe('07:00');
      expect(formatTime(sleep.start, 'America/Los_Angeles') >= '22:00').toBe(true);
      expect(sleep.end - sleep.start).toBeGreaterThanOrEqual(8 * HOUR);
    }
    expect(plan.days.some((day) => day.remainingShiftHours > 1)).toBe(true);
  });
});
