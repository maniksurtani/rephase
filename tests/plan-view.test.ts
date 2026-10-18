import { describe, expect, it } from 'vitest';
import { groupPlanDays } from '../src/lib/plan-calendar';
import { selectPlanTiming, todayPreview } from '../src/lib/plan-view';
import type { PlanAction, PlanDay, PlanTravelSegment } from '../src/lib/types';

const action = (id: string, start: string, end: string, timeZone = 'UTC'): PlanAction => ({
  id,
  start,
  end,
  timeZone,
  type: 'light',
  title: 'Seek light',
  detail: '',
  reason: '',
});
const day = (date: string, timeZone = 'UTC', actions: PlanAction[] = []): PlanDay => ({
  id: `${date}:${timeZone}`,
  date,
  timeZone,
  actions,
  stage: 'destination',
  label: 'Stay',
  phaseShiftHours: 0,
  remainingShiftHours: 0,
  note: '',
});
const timing = (days: PlanDay[], instant: string, selected: string | null = null) => {
  const calendarDays = groupPlanDays(days);
  const actions = calendarDays
    .flatMap((source) => source.actions)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const flights = calendarDays
    .flatMap((source) => source.travelSegments)
    .sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure));
  return {
    calendarDays,
    ...selectPlanTiming(calendarDays, actions, flights, selected, new Date(instant)),
  };
};

describe('Today current and upcoming guidance', () => {
  it('drops ended actions and flights while preserving ongoing original objects and their times', () => {
    const ended = action('ended', '2026-10-18T06:00:00Z', '2026-10-18T08:00:00Z');
    const ongoing = action('ongoing', '2026-10-18T14:00:00Z', '2026-10-18T17:00:00Z');
    const next = action('next', '2026-10-18T18:00:00Z', '2026-10-18T19:00:00Z');
    const flight: PlanTravelSegment = {
      id: 'arrived',
      flightNumber: 'QF103',
      departureAirport: 'SYD',
      arrivalAirport: 'HNL',
      departure: '2026-10-18T01:00:00Z',
      arrival: '2026-10-18T07:00:00Z',
      departureTimeZone: 'UTC',
      arrivalTimeZone: 'UTC',
    };
    const airborne = {
      ...flight,
      id: 'airborne',
      departure: '2026-10-18T15:00:00Z',
      arrival: '2026-10-18T18:00:00Z',
    };
    const [calendar] = groupPlanDays([
      { ...day('2026-10-18', 'UTC', [next, ended, ongoing]), travelSegments: [airborne, flight] },
    ]);
    const before = JSON.stringify(calendar);
    const preview = todayPreview(calendar, Date.parse('2026-10-18T15:45:00Z'));
    expect(preview.actions).toEqual([ongoing, next]);
    expect(preview.actions[0]).toBe(ongoing);
    expect(preview.actions[0].start).toBe('2026-10-18T14:00:00Z');
    expect(preview.flights).toEqual([airborne]);
    expect(preview.flights[0]).toBe(airborne);
    expect(JSON.stringify(calendar)).toBe(before);
  });

  it('uses elapsed instants through the repeated daylight-saving hour', () => {
    const first = action(
      'first',
      '2026-11-01T05:10:00Z',
      '2026-11-01T05:45:00Z',
      'America/New_York',
    );
    const repeated = action(
      'second',
      '2026-11-01T06:10:00Z',
      '2026-11-01T06:45:00Z',
      'America/New_York',
    );
    const [calendar] = groupPlanDays([day('2026-11-01', 'America/New_York', [first, repeated])]);
    expect(todayPreview(calendar, Date.parse('2026-11-01T06:15:00Z')).actions).toEqual([repeated]);
    expect(todayPreview(calendar, Date.parse(repeated.end)).actions).toEqual([]);
  });

  it('retains the first preparation day preview before a future trip begins', () => {
    const prepare = action('prepare', '2026-11-01T06:00:00Z', '2026-11-01T08:00:00Z');
    const view = timing(
      [{ ...day('2026-11-01', 'UTC', [prepare]), stage: 'preparation' }],
      '2026-10-18T15:45:00Z',
    );
    expect(view.today).toBeUndefined();
    expect(view.itineraryFinished).toBe(false);
    expect(view.timelineDay?.date).toBe('2026-11-01');
    expect(
      todayPreview(view.timelineDay!, Date.parse('2026-10-18T15:45:00Z'), view.calendarDays)
        .actions,
    ).toEqual([prepare]);
  });

  it('keeps Saturday in Honolulu current and previews Sunday bedtime when today has no remaining guidance', () => {
    const morning = action(
      'origin',
      '2026-10-17T02:00:00Z',
      '2026-10-17T03:00:00Z',
      'Australia/Sydney',
    );
    const bedtime = {
      ...action('bedtime', '2026-10-18T11:42:00Z', '2026-10-18T19:42:00Z', 'Pacific/Honolulu'),
      type: 'sleep' as const,
    };
    const now = '2026-10-18T01:45:00Z'; // Saturday 17 October, 15:45 HST.
    const view = timing(
      [
        day('2026-10-17', 'Australia/Sydney', [morning]),
        day('2026-10-17', 'Pacific/Honolulu'),
        day('2026-10-18', 'Pacific/Honolulu', [bedtime]),
      ],
      now,
      '2026-10-18',
    );
    expect(view.today?.date).toBe('2026-10-17');
    expect(view.timelineDay?.date).toBe('2026-10-17');
    expect(view.selectedDay?.date).toBe('2026-10-18');
    const preview = todayPreview(view.timelineDay!, Date.parse(now), view.calendarDays);
    expect(preview.actionDay.date).toBe('2026-10-18');
    expect(preview.actions).toEqual([bedtime]);
    expect(preview.actions[0]).toBe(bedtime);
  });

  it('selects today rather than an ongoing interval’s previous source date', () => {
    const sleep = {
      ...action('overnight', '2026-10-18T23:00:00Z', '2026-10-19T07:00:00Z'),
      type: 'sleep' as const,
    };
    const view = timing(
      [day('2026-10-18', 'UTC', [sleep]), day('2026-10-19')],
      '2026-10-19T01:00:00Z',
    );
    expect(view.today?.date).toBe('2026-10-19');
    expect(view.itineraryFinished).toBe(false);
    expect(
      todayPreview(view.timelineDay!, Date.parse('2026-10-19T01:00:00Z'), view.calendarDays)
        .actions,
    ).toEqual([sleep]);
  });

  it('limits the preview to three chronological unexpired actions and leaves history available in the full day', () => {
    const actions = [6, 7, 8, 9, 10].map((hour) =>
      action(
        `${hour}`,
        `2026-10-18T${String(hour).padStart(2, '0')}:00:00Z`,
        `2026-10-18T${String(hour + 1).padStart(2, '0')}:00:00Z`,
      ),
    );
    const [calendar] = groupPlanDays([day('2026-10-18', 'UTC', actions)]);
    expect(
      todayPreview(calendar, Date.parse('2026-10-18T07:30:00Z')).actions.map((value) => value.id),
    ).toEqual(['7', '8', '9']);
    expect(calendar.actions).toHaveLength(5);
    expect(todayPreview(calendar, Date.parse('2026-10-18T12:00:00Z')).actions).toEqual([]);
  });
});
