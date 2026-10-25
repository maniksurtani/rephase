import { describe, expect, it } from 'vitest';
import { buildDayTimeline } from '../src/lib/day-timeline';
import { buildCalendar } from '../src/lib/export';
import { groupPlanDays } from '../src/lib/plan-calendar';
import { arrivalPlanHorizon, limitPlanToArrival } from '../src/lib/plan-horizon';
import type { Plan, PlanAction, PlanDay, PlanTravelSegment, Trip } from '../src/lib/types';
import october from './fixtures/itineraries/oct2026.json';

const trip = { ...october.trip, legs: october.trip.legs.slice(0, 4) } as Trip;
const flight: PlanTravelSegment = {
  id: 'qf94',
  flightNumber: 'QF94',
  departureAirport: 'LAX',
  arrivalAirport: 'MEL',
  departure: '2026-10-25T06:40:00.000Z',
  arrival: '2026-10-25T22:30:00.000Z',
  departureTimeZone: 'America/Los_Angeles',
  arrivalTimeZone: 'Australia/Melbourne',
};
const sleep = (id: string, start: string, end: string): PlanAction => ({
  id,
  type: 'sleep',
  start,
  end,
  timeZone: 'Australia/Melbourne',
  title: 'Bedtime',
  detail: 'Aim for eight hours.',
  reason: 'Sleep supports alertness.',
});
const day = (date: string, actions: PlanAction[] = []): PlanDay => ({
  id: `${date}:Australia/Melbourne`,
  date,
  timeZone: 'Australia/Melbourne',
  stage: 'destination',
  locationAirport: 'MEL',
  label: 'Stay in Melbourne',
  actions,
  phaseShiftHours: 0,
  remainingShiftHours: 0,
  note: '',
});
const plan = (days: PlanDay[]): Plan => ({
  version: 'test',
  tripId: trip.id,
  generatedAt: '2026-10-24T00:00:00.000Z',
  days,
  warnings: [],
  summary: { destinations: 3, flightHours: 0, timeZoneChanges: 3 },
});

describe('published trip horizon', () => {
  it('uses the final arrival clock and real local midnights through DST', () => {
    expect(arrivalPlanHorizon(Date.parse(flight.arrival), flight.arrivalTimeZone)).toEqual({
      lastDate: '2026-10-27',
      end: Date.parse('2026-10-27T13:00:00Z'),
    });
    expect(arrivalPlanHorizon(Date.parse('2026-10-17T18:55:00Z'), 'Pacific/Honolulu')).toEqual({
      lastDate: '2026-10-18',
      end: Date.parse('2026-10-19T10:00:00Z'),
    });
    expect(arrivalPlanHorizon(Date.parse('2026-11-01T04:30:00Z'), 'America/New_York')).toEqual({
      lastDate: '2026-11-02',
      end: Date.parse('2026-11-03T05:00:00Z'),
    });
  });

  it('ends on October 27 while retaining the final bedtime until its actual wake time', () => {
    const bedtime = sleep(
      'bedtime-before-midnight',
      '2026-10-27T12:00:00.000Z',
      '2026-10-27T13:00:00.000Z',
    );
    const nextMorning = sleep(
      'bedtime-after-midnight',
      '2026-10-27T13:00:00.000Z',
      '2026-10-27T20:00:00.000Z',
    );
    const nextBedtime = sleep(
      'another-night',
      '2026-10-28T12:00:00.000Z',
      '2026-10-28T13:00:00.000Z',
    );
    const original = plan([
      { ...day('2026-10-26'), travelSegments: [flight] },
      day('2026-10-27', [bedtime]),
      day('2026-10-28', [nextMorning, nextBedtime]),
      day('2026-10-29'),
    ]);
    const before = JSON.stringify(original);
    const limited = limitPlanToArrival(original, trip);
    expect(limited.days.map((value) => value.date)).toEqual(['2026-10-26', '2026-10-27']);
    expect(limited.days.at(-1)!.actions).toEqual([bedtime, nextMorning]);
    expect(limited.days.at(-1)!.actions[0]).toBe(bedtime);
    expect(limited.days.at(-1)!.actions[1]).toBe(nextMorning);
    expect(JSON.stringify(original)).toBe(before);
    const calendar = groupPlanDays(limited.days);
    const final = calendar.at(-1)!;
    expect(final.date).toBe('2026-10-27');
    expect(final.tripComplete).toBe(true);
    expect(final.displayEnd).toBe(Date.parse('2026-10-27T13:00:00Z'));
    expect(final.actions).toEqual([bedtime]);
    const entry = buildDayTimeline(final).entries.find((value) => value.kind === 'action');
    expect(entry?.kind === 'action' && entry.sleepEpisode).toMatchObject({
      start: Date.parse(bedtime.start),
      end: Date.parse(nextMorning.end),
      continuesAfter: true,
    });
    const ics = buildCalendar(limited, trip, false);
    expect(ics).toContain('DTSTART:20261027T120000Z');
    expect(ics).toContain('DTEND:20261027T200000Z');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it('also caps overlong imported calendar coverage without inventing new dates', () => {
    const calendar = groupPlanDays([
      { ...day('2026-10-26'), travelSegments: [flight] },
      day('2026-10-27'),
      day('2026-10-28'),
      day('2026-11-02'),
    ]);
    expect(calendar.map((value) => value.date)).toEqual(['2026-10-26', '2026-10-27']);
    expect(calendar.map((value) => value.tripComplete)).toEqual([false, true]);
    const imported = groupPlanDays([day('2026-11-02')]);
    expect(imported[0].date).toBe('2026-11-02');
    expect(imported[0].tripComplete).toBeUndefined();
  });
});
