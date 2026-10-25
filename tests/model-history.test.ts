import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import { buildDayTimeline } from '../src/lib/day-timeline';
import { groupPlanDays } from '../src/lib/plan-calendar';
import type { AdherenceRecord, PlanAction, Trip } from '../src/lib/types';
import { generatePlan } from './support/planning';
import octoberItinerary from './fixtures/itineraries/oct2026.json';

const HOUR = 3_600_000;
const overlaps = (action: PlanAction, start: number, end: number) =>
  Date.parse(action.start) < end && Date.parse(action.end) > start;

describe('unrecorded plan history after adherence replay', () => {
  it('retains actual-model sleep before, during and after the Pacific crossing without assuming it happened', () => {
    const trip: Trip = {
      ...(octoberItinerary.trip as Trip),
      legs: (octoberItinerary.trip as Trip).legs.slice(0, 4),
    };
    const prefs = {
      ...DEFAULT_PREFERENCES,
      homeTimeZone: 'Australia/Sydney',
      planningMode: 'model' as const,
    };
    const now = Date.parse('2026-10-26T10:00:00.000Z');
    const baseline = generatePlan(trip, prefs, { now });
    const source = baseline.days.flatMap((day) => day.actions);
    expect(source.every((action) => action.origin === undefined)).toBe(true);
    const preparationSleep = source.find((action) => action.type === 'sleep')!;
    const start = Date.parse(preparationSleep.start);
    const end = Date.parse(preparationSleep.end);
    const middle = Math.round((start + end) / 2);
    const records: AdherenceRecord[] = [
      {
        id: 'missed-half',
        tripId: trip.id,
        actionId: preparationSleep.id,
        type: 'sleep',
        scheduledStart: preparationSleep.start,
        scheduledEnd: new Date(middle).toISOString(),
        timeZone: preparationSleep.timeZone,
        status: 'missed',
        recordedAt: preparationSleep.end,
      },
      {
        id: 'partial-half',
        tripId: trip.id,
        actionId: 'partial-sleep',
        type: 'sleep',
        scheduledStart: new Date(middle).toISOString(),
        scheduledEnd: preparationSleep.end,
        actualStart: new Date(Math.round((middle + end) / 2)).toISOString(),
        actualEnd: preparationSleep.end,
        timeZone: preparationSleep.timeZone,
        status: 'partial',
        recordedAt: preparationSleep.end,
      },
    ];
    const replay = generatePlan({ ...trip, adherence: records }, prefs, { now });
    const actions = replay.days.flatMap((day) => day.actions);
    const history = actions.filter((action) => action.origin === 'original-plan');
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((action) => Date.parse(action.end) <= now)).toBe(true);
    expect(
      actions.filter((action) => !action.origin).every((action) => Date.parse(action.start) >= now),
    ).toBe(true);
    expect(new Set(actions.map((action) => action.id)).size).toBe(actions.length);
    for (const record of records) {
      expect(
        history.some(
          (action) =>
            action.type === record.type &&
            overlaps(action, Date.parse(record.scheduledStart), Date.parse(record.scheduledEnd)),
        ),
      ).toBe(false);
      expect(
        actions.find((action) => action.id === record.actionId && action.origin === 'observation')
          ?.title,
      ).toContain(record.status);
    }

    const days = groupPlanDays(replay.days).filter(
      (day) => day.date >= '2026-10-24' && day.date <= '2026-10-26',
    );
    expect(days.map((day) => day.date)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    for (const day of days)
      expect(
        buildDayTimeline(day).entries.some(
          (entry) => entry.kind === 'action' && entry.action.type === 'sleep',
        ),
      ).toBe(true);
    const flightStart = Date.parse('2026-10-25T06:40:00.000Z');
    const flightEnd = Date.parse('2026-10-25T22:30:00.000Z');
    const originalFlightSleep = source.filter(
      (action) => action.type === 'sleep' && overlaps(action, flightStart, flightEnd),
    );
    const retainedFlightSleep = history.filter(
      (action) => action.type === 'sleep' && overlaps(action, flightStart, flightEnd),
    );
    expect(retainedFlightSleep.map((action) => [action.start, action.end])).toEqual(
      originalFlightSleep.map((action) => [action.start, action.end]),
    );
    expect(
      retainedFlightSleep.reduce(
        (total, action) => total + Date.parse(action.end) - Date.parse(action.start),
        0,
      ),
    ).toBe(prefs.sleepHours * HOUR);
    expect(
      actions.some(
        (action) =>
          action.type === 'sleep' && !action.origin && action.start === '2026-10-26T12:00:00.000Z',
      ),
    ).toBe(true);
  }, 30_000);
});
