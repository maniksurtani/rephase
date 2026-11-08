import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import { buildJourneyTimeline, journeyPosition } from '../src/lib/journey-timeline';
import { groupPlanDays } from '../src/lib/plan-calendar';
import { buildFlightLoungeContexts } from '../src/lib/lounge-windows';
import type { PlanAction, PlanDay, Trip } from '../src/lib/types';
import { generatePlan } from './support/planning';
import october from './fixtures/itineraries/oct2026.json';

const day = (date: string, actions: PlanAction[] = [], timeZone = 'UTC'): PlanDay => ({
  id: date,
  date,
  actions,
  timeZone,
  stage: 'destination',
  label: 'Stay',
  phaseShiftHours: 0,
  remainingShiftHours: 0,
  note: '',
  locationAirport: 'SFO',
});
const advice = (
  id: string,
  start: string,
  end: string,
  type: PlanAction['type'] = 'sleep',
): PlanAction => ({
  id,
  start,
  end,
  type,
  timeZone: 'UTC',
  title: type,
  detail: 'Original advice',
  reason: 'Original reason',
});

describe('shared continuous Bands timeline', () => {
  it('preserves real Pacific flight and recommendation intervals through midflight clock folds', () => {
    const trip = { ...october.trip, legs: october.trip.legs.slice(0, 4) } as Trip;
    const plan = generatePlan(
      trip,
      { ...DEFAULT_PREFERENCES, homeTimeZone: 'Australia/Sydney', planningMode: 'model' },
      { now: Date.parse('2026-10-15T00:00Z') },
    );
    const days = groupPlanDays(plan.days);
    const original = JSON.stringify(days);
    const timeline = buildJourneyTimeline(days, {
      loungeContexts: buildFlightLoungeContexts(trip),
    })!;
    expect(JSON.stringify(days)).toBe(original);
    const flights = timeline.bands.filter((b) => b.kind === 'flight');
    expect(flights.map((b) => b.flight!.id)).toEqual(['qf103', 'as812', 'aa6276', 'qf94']);
    for (const band of flights) {
      expect(band.start).toBe(Date.parse(band.flight!.departure));
      expect(band.end).toBe(Date.parse(band.flight!.arrival));
      const lounge = timeline.events.find(
        (e) => e.entry.kind === 'lounge' && e.entry.lounge.legId === band.flight!.id,
      )!;
      expect(lounge.entry.start).toBeLessThan(band.start);
      const departure = timeline.events.find(
        (e) =>
          e.entry.kind === 'flight' &&
          e.entry.flight.id === band.flight!.id &&
          e.entry.phase === 'departure',
      )!;
      expect(lounge.top).toBeLessThan(departure.top);
    }
    const qf94 = flights.at(-1)!;
    const fold = timeline.markers.find(
      (m) => m.kind === 'clock' && m.at > qf94.start && m.at < qf94.end,
    )!;
    expect(fold).toMatchObject({
      fromCity: 'Los Angeles',
      city: 'Melbourne',
      change: '+18h',
      fromClock: { dateKey: '2026-10-25' },
      clock: { dateKey: '2026-10-26' },
    });
    expect(fold.at).toBe(Math.floor((qf94.start + qf94.end) / 120_000) * 60_000);
    expect(
      timeline.bands.some(
        (b) => ['sleep', 'rest'].includes(b.kind) && b.start < fold.at && b.end > fold.at,
      ),
    ).toBe(true);
    expect(timeline.days.map((d) => d.date)).toContain('2026-10-25');
    expect(timeline.days.find((d) => d.date === '2026-10-18')).toMatchObject({
      city: 'Honolulu',
      travel: false,
    });
    expect(timeline.days.at(-1)?.date).toBe('2026-10-27');
    expect(new Set(timeline.days.map((d) => d.date)).size).toBe(timeline.days.length);
    expect(timeline.days.find((d) => d.date === '2026-10-22')?.city).toBe('San Francisco');
    for (const [index, point] of timeline.points.entries()) {
      if (index) {
        expect(point.at).toBe(timeline.points[index - 1].end);
        expect(point.y).toBeGreaterThan(timeline.points[index - 1].y);
      }
    }
    const awake = timeline.bands.filter((b) => b.kind === 'awake');
    for (const sleep of timeline.bands.filter((b) => ['sleep', 'rest'].includes(b.kind)))
      expect(awake.some((b) => b.start < sleep.end && b.end > sleep.start)).toBe(false);
  });

  it('joins only matching sleep fragments and retains every original recording ID', () => {
    const before = advice('night-before', '2026-11-07T23:00Z', '2026-11-08T00:00Z');
    const after = advice('night-after', '2026-11-08T00:00Z', '2026-11-08T07:00Z');
    const timeline = buildJourneyTimeline(
      groupPlanDays([day('2026-11-07', [before]), day('2026-11-08', [after])]),
    )!;
    const sleep = timeline.bands.filter((b) => b.kind === 'sleep');
    expect(sleep).toHaveLength(1);
    expect(sleep[0].duration).toBe('8h');
    expect(sleep[0].actions).toEqual([before, after]);
    expect(sleep[0].actions[0]).toBe(before);
    const midnight = timeline.markers.find((m) => m.at === Date.parse('2026-11-08T00:00Z'))!;
    expect(sleep[0].top).toBeLessThan(midnight.top);
    expect(sleep[0].top + sleep[0].height).toBeGreaterThan(midnight.top + midnight.height);
  });

  it('marks a repeated DST hour without losing elapsed time or the preceding offset', () => {
    const timeline = buildJourneyTimeline(
      groupPlanDays([day('2026-11-01', [], 'America/New_York')]),
    )!;
    expect(timeline.end - timeline.start).toBe(25 * 3_600_000);
    expect(timeline.markers.find((m) => m.kind === 'clock')).toMatchObject({
      at: Date.parse('2026-11-01T06:00Z'),
      change: '−1h',
      fromClock: { time: '02:00' },
      clock: { time: '01:00' },
    });
    expect(journeyPosition(timeline, Date.parse('2026-11-01T06:30Z'))).toBeGreaterThan(
      journeyPosition(timeline, Date.parse('2026-11-01T05:30Z')),
    );
  });

  it('gives simultaneous recommendations separate space and keeps short labels readable', () => {
    const actions = [
      advice('coffee', '2026-11-08T18:00Z', '2026-11-08T20:00Z', 'caffeine'),
      advice('melatonin', '2026-11-08T19:00Z', '2026-11-08T19:15Z', 'melatonin'),
    ];
    const timeline = buildJourneyTimeline(groupPlanDays([day('2026-11-08', actions)]))!;
    const [coffee, melatonin] = actions.map((a) =>
      timeline.bands.find((b) => b.actions.includes(a))!,
    );
    expect(coffee.lane).not.toBe(melatonin.lane);
    expect(coffee.laneCount).toBe(2);
    expect(melatonin.height).toBeGreaterThanOrEqual(90);
    expect(timeline.points.some((p) => p.compressed)).toBe(true);
  });
});
