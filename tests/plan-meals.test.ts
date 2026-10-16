import { describe, expect, it } from 'vitest';
import { buildCalendar } from '../src/lib/export';
import { flightAirborneTiming } from '../src/lib/flight-timing';
import {
  buildFlightMealPlan,
  decoratePlanWithMeals,
  effectiveSleepIntervals,
} from '../src/lib/plan-meals';
import { decoratePlanWithTravel } from '../src/lib/plan-travel';
import type {
  AdherenceRecord,
  FlightLeg,
  FlightMealPlan,
  Plan,
  PlanAction,
  PlanDay,
  Trip,
} from '../src/lib/types';

const MINUTE = 60_000,
  HOUR = 60 * MINUTE;
const leg = (changes: Partial<FlightLeg> = {}): FlightLeg => ({
  id: 'outbound',
  flightNumber: 'QF1',
  departureAirport: 'SYD',
  arrivalAirport: 'HNL',
  departureDateTime: '2026-10-17T10:00',
  arrivalDateTime: '2026-10-17T20:00',
  departureTimeZone: 'UTC',
  arrivalTimeZone: 'UTC',
  stayAfter: 'destination',
  strategy: 'adapt',
  ...changes,
});
const trip = (legs: FlightLeg[]): Trip => ({
  id: 'meal-trip',
  name: 'Meals and sleep',
  legs,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
});
const sleep = (start: string, end: string, id = 'sleep'): PlanAction => ({
  id,
  type: 'sleep',
  start,
  end,
  timeZone: 'UTC',
  title: 'Bedtime',
  detail: 'Preserve sleep.',
  reason: 'Rest.',
});
const day = (actions: PlanAction[]): PlanDay => ({
  id: '2026-10-17:UTC',
  date: '2026-10-17',
  timeZone: 'UTC',
  stage: 'travel',
  label: 'SYD → HNL',
  phaseShiftHours: 0.4,
  remainingShiftHours: 3.2,
  note: 'Existing estimate',
  actions,
});
const plan = (actions: PlanAction[] = []): Plan => ({
  version: 'test',
  tripId: 'meal-trip',
  generatedAt: '2026-10-01T00:00:00Z',
  days: [day(actions)],
  warnings: [],
  summary: { destinations: 1, flightHours: 10, timeZoneChanges: 0 },
});
const loggedSleep = (
  action: PlanAction,
  status: AdherenceRecord['status'],
  actual: Partial<AdherenceRecord> = {},
) => ({
  action: { ...action, origin: 'observation' as const, title: 'Recorded rest' },
  record: {
    id: `log-${action.id}`,
    tripId: 'meal-trip',
    actionId: action.id,
    type: 'sleep',
    scheduledStart: action.start,
    scheduledEnd: action.end,
    timeZone: action.timeZone,
    status,
    recordedAt: '2026-10-17T21:00:00Z',
    ...actual,
  } as AdherenceRecord,
});

function expectAwakeWindows(result: FlightMealPlan, actions: PlanAction[]) {
  for (const window of result.windows) {
    const start = Date.parse(window.start),
      end = Date.parse(window.end);
    expect(end - start).toBeGreaterThanOrEqual(20 * MINUTE);
    expect(end - start).toBeLessThanOrEqual(30 * MINUTE);
    for (const action of actions)
      if (action.type === 'sleep') {
        expect(
          start >= Date.parse(action.end) || end <= Date.parse(action.start),
          `${window.title} overlaps ${action.id}`,
        ).toBe(true);
      }
  }
}

describe('flexible flight meals', () => {
  it('protects planned in-flight sleep and places meals before boarding and after rest', () => {
    const flight = leg(),
      actions = [sleep('2026-10-17T11:00:00Z', '2026-10-17T17:00:00Z')];
    const result = buildFlightMealPlan(plan(actions), trip([flight]), flight);
    expect(result.wakeForMeals).toBe(false);
    expect(result.advice).toBe('Let me sleep through meal service');
    expect(Date.parse(result.sleepStart!)).toBe(Date.parse(actions[0].start));
    expect(Date.parse(result.sleepEnd!)).toBe(Date.parse(actions[0].end));
    expect(result.windows.map((window) => window.location)).toEqual(['before-flight', 'in-flight']);
    expect(Date.parse(result.windows[1].start)).toBeGreaterThanOrEqual(Date.parse(actions[0].end));
    expect(result.windows[1].detail).toContain('not a confirmed airline service time');
    expectAwakeWindows(result, actions);
  });

  it('uses an after-arrival meal when sleep fills the protected in-flight interval', () => {
    const flight = leg(),
      actions = [sleep('2026-10-17T11:00:00Z', '2026-10-17T18:30:00Z')];
    const result = buildFlightMealPlan(plan(actions), trip([flight]), flight);
    expect(result.windows.map((window) => window.location)).toEqual([
      'before-flight',
      'after-flight',
    ]);
    expect(result.windows[1].start).toBe('2026-10-17T20:45:00.000Z');
    expectAwakeWindows(result, actions);
  });

  it('offers normal service while awake without treating a nearby ground sleep as in-flight rest', () => {
    const flight = leg(),
      actions = [sleep('2026-10-17T00:00:00Z', '2026-10-17T08:00:00Z')];
    const result = buildFlightMealPlan(plan(actions), trip([flight]), flight);
    expect(result.wakeForMeals).toBe(true);
    expect(result.sleepStart).toBeUndefined();
    expect(result.windows.every((window) => window.location === 'in-flight')).toBe(true);
    expect(result.windows).toHaveLength(2);
    expectAwakeWindows(result, actions);
  });

  it('does not invent service opportunities on a short flight', () => {
    const flight = leg({ arrivalDateTime: '2026-10-17T11:15' });
    const result = buildFlightMealPlan(plan(), trip([flight]), flight);
    expect(result.wakeForMeals).toBe(true);
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].location).toBe('before-flight');
    expect(Date.parse(result.windows[0].end)).toBeLessThanOrEqual(Date.parse('2026-10-17T09:00Z'));
  });

  it('uses actual airborne times and conservatively excludes climb and approach from meal windows', () => {
    const flight = leg({
      takeoffDateTime: '2026-10-17T10:12',
      landingDateTime: '2026-10-17T19:42',
    });
    const result = buildFlightMealPlan(plan(), trip([flight]), flight);
    const timing = flightAirborneTiming(flight);
    for (const window of result.windows.filter((window) => window.location === 'in-flight')) {
      expect(Date.parse(window.start)).toBeGreaterThanOrEqual(timing.takeoff + 30 * MINUTE);
      expect(Date.parse(window.end)).toBeLessThanOrEqual(timing.landing - 60 * MINUTE);
    }
    expect(result.windows[0].start).toBe('2026-10-17T10:42:00.000Z');
  });

  it('merges midnight-split and duplicated sleep intervals without waking for a meal at midnight', () => {
    const flight = leg({
      departureDateTime: '2026-10-17T20:00',
      arrivalDateTime: '2026-10-18T10:00',
    });
    const first = sleep('2026-10-17T21:00:00Z', '2026-10-18T00:00:00Z', 'before-midnight');
    const second = sleep('2026-10-18T00:00:00Z', '2026-10-18T07:00:00Z', 'after-midnight');
    const input = plan([first, second]);
    input.days.push({ ...day([second]), id: 'duplicate-zone' });
    const result = buildFlightMealPlan(input, trip([flight]), flight);
    expect(Date.parse(result.sleepStart!)).toBe(Date.parse(first.start));
    expect(Date.parse(result.sleepEnd!)).toBe(Date.parse(second.end));
    expectAwakeWindows(result, [first, second]);
  });

  it('handles date-line flight durations in UTC rather than comparing local departure and arrival clocks', () => {
    const flight = leg({
      departureDateTime: '2026-10-17T20:15',
      arrivalDateTime: '2026-10-17T09:50',
      departureTimeZone: 'Australia/Sydney',
      arrivalTimeZone: 'Pacific/Honolulu',
    });
    const actions = [sleep('2026-10-17T10:15:00Z', '2026-10-17T17:00:00Z')];
    const result = buildFlightMealPlan(plan(actions), trip([flight]), flight);
    const timing = flightAirborneTiming(flight);
    expect(result.wakeForMeals).toBe(false);
    expect(result.windows.find((window) => window.location === 'in-flight')?.start).toBe(
      '2026-10-17T17:00:00.000Z',
    );
    for (const window of result.windows.filter((window) => window.location === 'in-flight')) {
      expect(Date.parse(window.start)).toBeGreaterThanOrEqual(timing.takeoff + 30 * MINUTE);
      expect(Date.parse(window.end)).toBeLessThanOrEqual(timing.landing - HOUR);
    }
    expectAwakeWindows(result, actions);
  });

  it('respects ground sleep and short connections instead of adding impossible airport meals', () => {
    const first = leg({
      id: 'first',
      departureDateTime: '2026-10-17T08:00',
      arrivalDateTime: '2026-10-17T09:15',
      arrivalAirport: 'HNL',
    });
    const second = leg({
      id: 'second',
      departureAirport: 'HNL',
      departureDateTime: '2026-10-17T10:15',
      arrivalDateTime: '2026-10-17T11:30',
    });
    const actions = [sleep('2026-10-17T00:00:00Z', '2026-10-17T07:45:00Z')];
    const itinerary = trip([first, second]),
      input = decoratePlanWithTravel(plan(actions), itinerary);
    const result = decoratePlanWithMeals(input, itinerary);
    const all = [
      ...new Map(
        result.days
          .flatMap((value) => value.travelSegments ?? [])
          .map((segment) => [segment.id, segment]),
      ).values(),
    ];
    expect(all.find((segment) => segment.id === 'first')!.mealPlan!.windows).toHaveLength(0);
    const secondMeals = all.find((segment) => segment.id === 'second')!.mealPlan!;
    expect(secondMeals.windows.map((window) => window.location)).toEqual(['after-flight']);
    expectAwakeWindows(secondMeals, actions);
    expect(Date.parse(secondMeals.windows[0].start)).toBeGreaterThanOrEqual(
      Date.parse('2026-10-17T12:15Z'),
    );
  });

  it('returns no invented window when sleep and operational buffers leave no feasible eating time', () => {
    const flight = leg({ arrivalDateTime: '2026-10-17T11:15' });
    const actions = [sleep('2026-10-17T00:00:00Z', '2026-10-18T00:00:00Z')];
    const result = buildFlightMealPlan(plan(actions), trip([flight]), flight);
    expect(result.wakeForMeals).toBe(false);
    expect(result.windows).toEqual([]);
  });

  it('does not add a post-arrival meal that would interrupt planned ground sleep', () => {
    const flight = leg();
    const actions = [
      sleep('2026-10-17T11:00:00Z', '2026-10-17T18:30:00Z', 'in-flight-rest'),
      sleep('2026-10-17T20:30:00Z', '2026-10-18T04:30:00Z', 'ground-sleep'),
    ];
    const result = buildFlightMealPlan(plan(actions), trip([flight]), flight);
    expect(result.wakeForMeals).toBe(false);
    expect(result.windows.map((window) => window.location)).toEqual(['before-flight']);
    expectAwakeWindows(result, actions);
  });

  it('does not mistake a preserved missed sleep instruction for actual rest', () => {
    const flight = leg(),
      logged = loggedSleep(sleep('2026-10-17T11:00:00Z', '2026-10-17T17:00:00Z'), 'missed');
    const itinerary = { ...trip([flight]), adherence: [logged.record] },
      input = plan([logged.action]);
    const result = buildFlightMealPlan(input, itinerary, flight);
    expect(effectiveSleepIntervals(input, itinerary)).toEqual([]);
    expect(result.wakeForMeals).toBe(true);
    expect(result.sleepStart).toBeUndefined();
    expect(result.windows[0].start).toBe('2026-10-17T11:00:00.000Z');
  });

  it.each(['completed', 'partial'] as const)(
    'uses actual %s sleep outside its original scheduled interval for meal policy and bounds',
    (status) => {
      const flight = leg();
      const logged = loggedSleep(sleep('2026-10-17T06:00:00Z', '2026-10-17T07:00:00Z'), status, {
        actualStart: '2026-10-17T11:00:00Z',
        actualEnd: '2026-10-17T15:00:00Z',
      });
      const itinerary = { ...trip([flight]), adherence: [logged.record] },
        input = plan([logged.action]);
      const result = buildFlightMealPlan(input, itinerary, flight);
      expect(result.wakeForMeals).toBe(false);
      expect(Date.parse(result.sleepStart!)).toBe(Date.parse(logged.record.actualStart!));
      expect(Date.parse(result.sleepEnd!)).toBe(Date.parse(logged.record.actualEnd!));
      expect(result.windows.find((window) => window.location === 'in-flight')!.start).toBe(
        '2026-10-17T15:00:00.000Z',
      );
      expectAwakeWindows(result, [
        { ...logged.action, start: logged.record.actualStart!, end: logged.record.actualEnd! },
      ]);
      expect(effectiveSleepIntervals(input, itinerary)).toEqual([
        {
          start: Date.parse(logged.record.actualStart!),
          end: Date.parse(logged.record.actualEnd!),
        },
      ]);
    },
  );

  it('does not retain scheduled in-flight sleep when the recorded actual sleep occurred outside the flight', () => {
    const flight = leg();
    const logged = loggedSleep(sleep('2026-10-17T11:00:00Z', '2026-10-17T15:00:00Z'), 'partial', {
      actualStart: '2026-10-17T22:00:00Z',
      actualEnd: '2026-10-18T03:00:00Z',
    });
    const itinerary = { ...trip([flight]), adherence: [logged.record] };
    const result = buildFlightMealPlan(plan([logged.action]), itinerary, flight);
    expect(result.wakeForMeals).toBe(true);
    expect(result.windows[0].start).toBe('2026-10-17T11:00:00.000Z');
  });

  it('preserves future recommended sleep independently when a missed log shares its action ID', () => {
    const flight = leg(),
      logged = loggedSleep(
        sleep('2026-10-17T11:00:00Z', '2026-10-17T12:00:00Z', 'reused-id'),
        'missed',
      );
    const future = sleep('2026-10-17T15:00:00Z', '2026-10-17T17:00:00Z', 'reused-id');
    const itinerary = { ...trip([flight]), adherence: [logged.record] },
      input = plan([logged.action, future]);
    expect(effectiveSleepIntervals(input, itinerary)).toEqual([
      { start: Date.parse(future.start), end: Date.parse(future.end) },
    ]);
    const result = buildFlightMealPlan(input, itinerary, flight);
    expect(result.wakeForMeals).toBe(false);
    expect(Date.parse(result.sleepStart!)).toBe(Date.parse(future.start));
    expectAwakeWindows(result, [future]);
  });

  it('discloses conservative scheduled protection for partial sleep logs without actual times', () => {
    const flight = leg(),
      logged = loggedSleep(sleep('2026-10-17T11:00:00Z', '2026-10-17T17:00:00Z'), 'partial');
    const itinerary = { ...trip([flight]), adherence: [logged.record] },
      input = plan([logged.action]);
    const result = buildFlightMealPlan(input, itinerary, flight);
    expect(result.wakeForMeals).toBe(false);
    expect(result.reason).toContain('partial sleep log has no actual times');
    expect(result.reason).toContain('uncertain rest buffer');
    expectAwakeWindows(result, [logged.action]);
  });

  it('leaves action IDs/timing and phase estimates intact and reuses one meal plan on repeated flight metadata', () => {
    const flight = leg(),
      itinerary = trip([flight]);
    const actions = [sleep('2026-10-17T11:00:00Z', '2026-10-17T18:30:00Z')];
    const input = decoratePlanWithTravel(plan(actions), itinerary);
    input.days.push({ ...input.days[0], id: 'other-zone' });
    const originalCalendar = buildCalendar(input, itinerary),
      original = JSON.stringify(input);
    const result = decoratePlanWithMeals(input, itinerary);
    expect(JSON.stringify(input)).toBe(original);
    expect(result.days[0].actions).toBe(input.days[0].actions);
    expect(result.days[0].phaseShiftHours).toBe(0.4);
    expect(result.days[0].remainingShiftHours).toBe(3.2);
    expect(result.days[0].travelSegments![0].mealPlan).toBe(
      result.days[1].travelSegments![0].mealPlan,
    );
    const ids = result.days[0].travelSegments![0].mealPlan!.windows.map((window) => window.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('meal:outbound:'))).toBe(true);
    // Calendar integration belongs to the exporter; the underlying actions are
    // unchanged regardless of whether it opts into meal metadata.
    expect(originalCalendar).toContain('SUMMARY:Bedtime');
  });
});
