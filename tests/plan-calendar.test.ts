import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import { generatePlan } from './support/planning';
import { groupPlanDays, isCalendarDayCurrent } from '../src/lib/plan-calendar';
import type { PlanAction, PlanDay, PlanTravelSegment, Trip } from '../src/lib/types';
import octoberItinerary from './fixtures/itineraries/oct2026.json';

const action = (id: string, start: string, end: string, timeZone = 'UTC'): PlanAction => ({
  id,
  type: 'sleep',
  start,
  end,
  timeZone,
  title: 'Sleep',
  detail: 'Original detail',
  reason: 'Original reason',
});
const day = (date: string, timeZone: string, changes: Partial<PlanDay> = {}): PlanDay => ({
  id: `${date}:${timeZone}`,
  date,
  timeZone,
  stage: 'destination',
  label: 'Stay at destination',
  actions: [],
  phaseShiftHours: 0.3,
  remainingShiftHours: 2,
  note: 'Unmeasured estimate.',
  ...changes,
});
const segment: PlanTravelSegment = {
  id: 'qf103',
  flightNumber: 'QF103',
  departureAirport: 'SYD',
  arrivalAirport: 'HNL',
  departure: '2026-10-17T09:15:00.000Z',
  arrival: '2026-10-17T18:55:00.000Z',
  departureTimeZone: 'Australia/Sydney',
  arrivalTimeZone: 'Pacific/Honolulu',
};

describe('calendar date presentation', () => {
  it('recognizes Today in every source clock, even when the representative clock still shows yesterday', () => {
    const [group] = groupPlanDays([
      day('2026-10-17', 'Australia/Sydney', {
        actions: [
          action('sydney', '2026-10-17T02:00:00Z', '2026-10-17T03:00:00Z', 'Australia/Sydney'),
        ],
      }),
      day('2026-10-17', 'Pacific/Honolulu', {
        actions: [
          action('honolulu', '2026-10-18T07:00:00Z', '2026-10-18T08:00:00Z', 'Pacific/Honolulu'),
        ],
      }),
    ]);
    expect(group.timeZone).toBe('Pacific/Honolulu');
    expect(isCalendarDayCurrent(group, Date.parse('2026-10-16T23:00:00Z'))).toBe(true);
    expect(isCalendarDayCurrent(group, Date.parse('2026-10-18T09:00:00Z'))).toBe(true);
    expect(isCalendarDayCurrent(group, Date.parse('2026-10-16T00:00:00Z'))).toBe(false);
    expect(isCalendarDayCurrent(group, Date.parse('2026-10-18T12:00:00Z'))).toBe(false);
  });

  it('merges origin and destination dates without moving or clipping actions across the date line', () => {
    const origin = action(
      'origin-rest',
      '2026-10-17T10:30:00Z',
      '2026-10-17T12:00:00Z',
      'Australia/Sydney',
    );
    const destination = action(
      'destination-sleep',
      '2026-10-18T07:00:00Z',
      '2026-10-18T10:00:00Z',
      'Pacific/Honolulu',
    );
    const source = [
      day('2026-10-17', 'Australia/Sydney', {
        actions: [origin],
        travelSegments: [segment],
        stage: 'travel',
      }),
      day('2026-10-17', 'Pacific/Honolulu', {
        actions: [destination],
        travelSegments: [segment],
        stage: 'travel',
      }),
    ];
    const before = JSON.stringify(source);
    Object.freeze(source);
    source.forEach((value) => {
      Object.freeze(value.actions);
      Object.freeze(value.travelSegments);
      Object.freeze(value);
    });
    const [group] = groupPlanDays(source);
    expect(group.id).toBe('2026-10-17');
    expect(group.actions).toEqual([origin, destination]);
    expect(group.actions[0]).toBe(origin);
    expect(group.actions[1]).toBe(destination);
    expect(group.travelSegments).toEqual([segment]);
    expect(group.travelSegments[0]).toBe(segment);
    expect(group.timeZones).toEqual(['Australia/Sydney', 'Pacific/Honolulu']);
    expect(group.label).toBe('SYD → HNL');
    expect(JSON.stringify(source)).toBe(before);
  });

  it('deduplicates repeated action IDs and sorts by UTC during a DST fall-back fold', () => {
    const first = action(
      'first-0130',
      '2026-11-01T05:30:00Z',
      '2026-11-01T05:45:00Z',
      'America/New_York',
    );
    const second = action(
      'second-0130',
      '2026-11-01T06:30:00Z',
      '2026-11-01T06:45:00Z',
      'America/New_York',
    );
    const [group] = groupPlanDays([
      day('2026-11-01', 'Europe/London', { actions: [second, first] }),
      day('2026-11-01', 'America/New_York', { actions: [first] }),
    ]);
    expect(group.actions.map((value) => value.id)).toEqual(['first-0130', 'second-0130']);
    expect(group.actions.map((value) => [value.start, value.end, value.timeZone])).toEqual([
      [first.start, first.end, first.timeZone],
      [second.start, second.end, second.timeZone],
    ]);
  });

  it('selects the latest available source estimate without summing overlapping clocks', () => {
    const morning = day('2026-10-17', 'Australia/Sydney', {
      actions: [action('morning', '2026-10-17T00:00:00Z', '2026-10-17T02:00:00Z')],
      phaseShiftHours: 1.2,
    });
    const evening = day('2026-10-17', 'Pacific/Honolulu', {
      actions: [action('evening', '2026-10-18T06:00:00Z', '2026-10-18T08:00:00Z')],
      phaseShiftHours: 0.4,
      remainingShiftHours: 1.6,
    });
    const [group] = groupPlanDays([evening, morning]);
    expect(group.phaseShiftHours).toBe(0.4);
    expect(group.remainingShiftHours).toBe(1.6);
    expect(group.phaseEstimateSourceId).toBe(evening.id);
    expect(group.timeZone).toBe('Pacific/Honolulu');
    expect(group.note).toBe('Unmeasured estimate.');
  });

  it('never lets a schedule-only day hide a real estimate, including a genuine zero shift', () => {
    const real = day('2026-10-17', 'Australia/Sydney', {
      phaseShiftHours: 0,
      phaseEstimateAvailable: true,
    });
    const synthetic = day('2026-10-17', 'Pacific/Honolulu', {
      phaseShiftHours: 0,
      remainingShiftHours: 0,
      phaseEstimateAvailable: false,
      travelSegments: [segment],
    });
    const [group] = groupPlanDays([real, synthetic]);
    expect(group).toMatchObject({
      stage: 'travel',
      phaseShiftHours: 0,
      remainingShiftHours: 2,
      phaseEstimateAvailable: true,
      phaseEstimateSourceId: real.id,
    });
    expect(group.sourceDays).toHaveLength(2);
    expect(groupPlanDays([synthetic])[0].phaseEstimateAvailable).toBe(false);
  });

  it('uses real zoned day boundaries to select an estimate on the 25-hour DST day', () => {
    const ny = day('2026-11-01', 'America/New_York', { phaseShiftHours: 0.8 });
    const london = day('2026-11-01', 'Europe/London', { phaseShiftHours: 0.2 });
    const [group] = groupPlanDays([ny, london]);
    expect(group.phaseEstimateSourceId).toBe(ny.id);
    expect(group.phaseShiftHours).toBe(0.8);
  });

  it('keeps distinct local dates in calendar order even when crossing the date line backwards', () => {
    const previous = day('2026-10-14', 'Pacific/Honolulu');
    const departure = day('2026-10-15', 'Pacific/Kiritimati');
    expect(groupPlanDays([departure, previous]).map((value) => value.date)).toEqual([
      '2026-10-14',
      '2026-10-15',
    ]);
    expect(groupPlanDays([])).toEqual([]);
  });

  it('has one tile per date throughout the five-flight itinerary, retaining both 24 October flights and 25 October transit', () => {
    const plan = generatePlan(octoberItinerary.trip as Trip, {
      ...DEFAULT_PREFERENCES,
      homeTimeZone: 'Australia/Sydney',
      preparationDays: 3,
      planningMode: 'rules',
    });
    const grouped = groupPlanDays(plan.days);
    const forDate = (date: string) => grouped.filter((value) => value.date === date);
    expect(new Set(grouped.map((value) => value.date)).size).toBe(grouped.length);
    expect(forDate('2026-10-17')).toHaveLength(1);
    expect(forDate('2026-10-19')).toHaveLength(1);
    expect(forDate('2026-10-17')[0].travelSegments.map((value) => value.flightNumber)).toContain(
      'QF103',
    );
    expect(forDate('2026-10-19')[0].travelSegments.map((value) => value.flightNumber)).toContain(
      'AS812',
    );
    expect(forDate('2026-10-24')[0].travelSegments.map((value) => value.flightNumber)).toEqual([
      'AA6276',
      'QF94',
    ]);
    expect(
      forDate('2026-10-25')[0].travelSegments.some((value) => value.flightNumber === 'QF94'),
    ).toBe(true);
    expect(forDate('2026-10-20')[0].stage).not.toBe('travel');
    expect(forDate('2026-10-20')[0].travelSegments).toEqual([]);
    const originalActions = new Map(
      plan.days.flatMap((value) => value.actions).map((value) => [value.id, value]),
    );
    const presentedActions = grouped.flatMap((value) => value.actions);
    expect(new Set(presentedActions.map((value) => value.id))).toEqual(
      new Set(originalActions.keys()),
    );
    for (const value of presentedActions) expect(value).toBe(originalActions.get(value.id));
  });
});
