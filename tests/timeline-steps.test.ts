import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import { buildDayTimeline } from '../src/lib/day-timeline';
import { groupPlanDays } from '../src/lib/plan-calendar';
import { buildTimelineSteps } from '../src/lib/timeline-steps';
import type { ActionType, PlanAction, PlanDay, PlanTravelSegment } from '../src/lib/types';

const instant = (value: string) => Date.parse(value);
const action = (id: string, type: ActionType, start: string, end: string, changes: Partial<PlanAction> = {}): PlanAction => ({
  id, type, start, end, timeZone: 'UTC', title: type === 'sleep' ? 'Bedtime' : type,
  detail: 'Original advice', reason: 'Original reason', ...changes,
});
const day = (date = '2026-10-20', timeZone = 'UTC', changes: Partial<PlanDay> = {}): PlanDay => ({
  id: `${date}:${timeZone}`, date, timeZone, stage: 'destination', label: 'Stay in San Francisco',
  actions: [], phaseShiftHours: .3, remainingShiftHours: 2, note: '', ...changes,
});

describe('compact timeline presentation', () => {
  it('renders an uninterrupted free day as one compressed interval without hourly rows', () => {
    const [calendar] = groupPlanDays([day()]);
    const timeline = buildDayTimeline(calendar, { tickMinutes: 60 });
    const before = JSON.stringify(timeline);
    const steps = buildTimelineSteps(timeline);

    expect(timeline.ticks).toHaveLength(25);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({
      start: timeline.start, end: timeline.end, bands: [timeline.bands[0]], entries: [], compressed: true,
    });
    expect(steps[0].bands[0]).toBe(timeline.bands[0]);
    expect(JSON.stringify(timeline)).toBe(before);
  });

  it('keeps sleep and flight spans continuous without splitting at decorative ticks', () => {
    const sleep = action('bedtime', 'sleep', '2026-10-20T01:00:00Z', '2026-10-20T09:00:00Z');
    const flight: PlanTravelSegment = {
      id: 'flight', flightNumber: 'QF1', departureAirport: 'SYD', arrivalAirport: 'LHR',
      departure: '2026-10-20T00:00:00Z', arrival: '2026-10-20T12:00:00Z',
      departureTimeZone: 'UTC', arrivalTimeZone: 'UTC',
    };
    const [calendar] = groupPlanDays([day(undefined, undefined, { actions: [sleep], travelSegments: [flight] })]);
    const timeline = buildDayTimeline(calendar, { tickMinutes: 60 });
    const steps = buildTimelineSteps(timeline);

    expect(steps.map(step => [step.start, step.end])).toEqual([
      ['2026-10-20T00:00:00Z', '2026-10-20T01:00:00Z'],
      ['2026-10-20T01:00:00Z', '2026-10-20T09:00:00Z'],
      ['2026-10-20T09:00:00Z', '2026-10-20T12:00:00Z'],
      ['2026-10-20T12:00:00Z', '2026-10-21T00:00:00Z'],
    ].map(range => range.map(instant)));
    expect(steps.map(step => step.compressed)).toEqual([false, true, true, true]);
    expect(steps.map(step => step.bands.map(band => band.kind).sort())).toEqual([
      ['awake', 'flight'], ['flight', 'sleep'], ['awake', 'flight'], ['awake'],
    ]);
    expect(steps.flatMap(step => step.entries)).toEqual(timeline.entries);
    expect(steps[0].entries[0]).toBe(timeline.entries[0]);
    expect(steps[0].entries[0].kind === 'flight' && steps[0].entries[0].flight).toBe(flight);
    expect(steps[1].entries[0].kind === 'action' && steps[1].entries[0].action).toBe(sleep);
  });

  it('preserves every overlapping recommendation boundary and all concurrent band coverage', () => {
    const actions = [
      action('light', 'light', '2026-10-20T06:00:00Z', '2026-10-20T10:00:00Z'),
      action('caffeine', 'caffeine', '2026-10-20T07:00:00Z', '2026-10-20T08:00:00Z'),
      action('melatonin', 'melatonin', '2026-10-20T09:45:00Z', '2026-10-20T10:00:00Z'),
      action('darkness', 'avoid-light', '2026-10-20T20:00:00Z', '2026-10-20T23:00:00Z'),
      action('sleep', 'sleep', '2026-10-20T22:00:00Z', '2026-10-21T00:00:00Z'),
    ];
    const [calendar] = groupPlanDays([day(undefined, undefined, { actions })]);
    const timeline = buildDayTimeline(calendar);
    const steps = buildTimelineSteps(timeline);

    expect(steps.map(step => step.start)).toEqual([
      '2026-10-20T00:00:00Z', '2026-10-20T06:00:00Z', '2026-10-20T07:00:00Z',
      '2026-10-20T08:00:00Z', '2026-10-20T09:45:00Z', '2026-10-20T10:00:00Z',
      '2026-10-20T20:00:00Z', '2026-10-20T22:00:00Z', '2026-10-20T23:00:00Z',
    ].map(instant));
    for (const band of timeline.bands) {
      const slices = steps.filter(step => step.bands.includes(band));
      expect(slices[0].start).toBe(band.start);
      expect(slices.at(-1)?.end).toBe(band.end);
      expect(slices.reduce((duration, step) => duration + step.end - step.start, 0)).toBe(band.end - band.start);
    }
    expect(steps.flatMap(step => step.entries)).toEqual(timeline.entries);
    expect(steps.reduce((duration, step) => duration + step.end - step.start, 0)).toBe(timeline.end - timeline.start);
  });

  it.each([
    ['2026-03-08', 'America/New_York', '2026-03-08T07:00:00Z', 23],
    ['2026-11-01', 'America/New_York', '2026-11-01T06:00:00Z', 25],
    ['2026-10-04', 'Australia/Lord_Howe', '2026-10-03T15:30:00Z', 23.5],
  ])('retains the exact offset transition on %s in %s', (date, zone, transition, hours) => {
    const [calendar] = groupPlanDays([day(date, zone)]);
    const timeline = buildDayTimeline(calendar, { tickMinutes: 60 });
    const steps = buildTimelineSteps(timeline);
    expect(steps).toHaveLength(2);
    expect(steps[0].end).toBe(instant(transition));
    expect(steps[1].start).toBe(instant(transition));
    expect(steps[0].start).toBe(timeline.start);
    expect(steps[1].end).toBe(timeline.end);
    expect(steps.reduce((duration, step) => duration + step.end - step.start, 0)).toBe(Number(hours) * 3_600_000);
    const before = Temporal.Instant.fromEpochMilliseconds(instant(transition) - 1).toZonedDateTimeISO(zone);
    const after = Temporal.Instant.fromEpochMilliseconds(instant(transition)).toZonedDateTimeISO(zone);
    expect(before.offset).not.toBe(after.offset);
  });

  it('retains a local midnight inside a date-line travel day with extended UTC coverage', () => {
    const origin = action('origin', 'light', '2026-10-17T02:00:00Z', '2026-10-17T03:00:00Z', { timeZone: 'Australia/Sydney' });
    const destination = action('destination', 'sleep', '2026-10-18T07:00:00Z', '2026-10-18T10:00:00Z', { timeZone: 'Pacific/Honolulu' });
    const [calendar] = groupPlanDays([
      day('2026-10-17', 'Australia/Sydney', { actions: [origin] }),
      day('2026-10-17', 'Pacific/Honolulu', { actions: [destination] }),
    ]);
    const timeline = buildDayTimeline(calendar, { tickMinutes: 60 });
    const steps = buildTimelineSteps(timeline);
    expect(timeline.timeZone).toBe('Pacific/Honolulu');
    expect(steps.map(step => step.start)).toEqual([
      '2026-10-17T02:00:00Z', '2026-10-17T03:00:00Z', '2026-10-17T10:00:00Z', '2026-10-18T07:00:00Z',
    ].map(instant));
    expect(steps.at(-1)?.end).toBe(timeline.end);
  });

  it('keeps a point arrival card even when its zero-length band has no interval', () => {
    const flight: PlanTravelSegment = {
      id: 'midnight-arrival', flightNumber: 'QF1', departureAirport: 'SYD', arrivalAirport: 'LHR',
      departure: '2026-10-19T22:00:00Z', arrival: '2026-10-20T00:00:00Z',
      departureTimeZone: 'UTC', arrivalTimeZone: 'UTC',
    };
    const [calendar] = groupPlanDays([day(undefined, undefined, { travelSegments: [flight] })]);
    const timeline = buildDayTimeline(calendar);
    const steps = buildTimelineSteps(timeline);
    expect(steps).toHaveLength(1);
    expect(steps[0].entries[0]).toBe(timeline.entries[0]);
    expect(steps[0].entries[0].start).toBe(steps[0].entries[0].end);
    expect(steps[0].bands.map(band => band.kind)).toEqual(['awake']);
  });
});
