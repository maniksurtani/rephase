import { describe, expect, it } from 'vitest';
import { actionTravelSegment, travelClock } from '../src/lib/travel-clocks';
import type { PlanAction, PlanTravelSegment } from '../src/lib/types';

const segment = (id: string, departure: string, arrival: string): PlanTravelSegment => ({
  id,
  flightNumber: '',
  departureAirport: 'LHR',
  arrivalAirport: 'SYD',
  departureTimeZone: 'Europe/London',
  arrivalTimeZone: 'Australia/Sydney',
  departure,
  arrival,
});
const action = (start: string, end: string): PlanAction => ({
  id: 'rest',
  type: 'sleep',
  start,
  end,
  timeZone: 'UTC',
  title: 'Rest',
  detail: '',
  reason: '',
});

describe('travel clocks', () => {
  it('shows both calendar dates when a single instant crosses the international date line', () => {
    const instant = '2026-10-16T18:15:00Z';
    expect(travelClock(instant, 'Pacific/Kiritimati')).toMatchObject({
      time: '08:15',
      date: '17 Oct',
      dateKey: '2026-10-17',
    });
    expect(travelClock(instant, 'Pacific/Honolulu')).toMatchObject({
      time: '08:15',
      date: '16 Oct',
      dateKey: '2026-10-16',
    });
  });

  it('uses the offset at the event rather than the current season', () => {
    const before = travelClock('2026-10-25T00:30:00Z', 'Europe/London');
    const after = travelClock('2026-10-25T01:30:00Z', 'Europe/London');
    expect(before.time).toBe('01:30');
    expect(after.time).toBe('01:30');
    expect(before.zone).not.toBe(after.zone);
    expect(before.dateKey).toBe(after.dateKey);
    expect(travelClock('2026-10-16T18:15:00Z', 'Australia/Sydney')).toMatchObject({
      time: '05:15',
      date: '17 Oct',
      dateKey: '2026-10-17',
    });
  });

  it('preserves fractional offsets and displays midnight as 00:00', () => {
    expect(travelClock('2026-10-17T00:00:00Z', 'Asia/Kathmandu').time).toBe('05:45');
    expect(travelClock('2026-10-17T00:00:00Z', 'UTC').time).toBe('00:00');
    expect(travelClock('2026-10-16T13:30:00Z', 'Australia/Lord_Howe')).toMatchObject({
      time: '00:30',
      dateKey: '2026-10-17',
    });
  });
});

describe('action flight selection', () => {
  const first = segment('first', '2026-10-17T06:00:00Z', '2026-10-17T09:00:00Z');
  const next = segment('next', '2026-10-17T12:00:00Z', '2026-10-17T18:00:00Z');

  it('selects the overlapping onward leg rather than the first leg on a travel day', () => {
    expect(
      actionTravelSegment(action('2026-10-17T13:00:00Z', '2026-10-17T14:00:00Z'), [first, next])
        ?.id,
    ).toBe('next');
    expect(
      actionTravelSegment(action('2026-10-17T11:30:00Z', '2026-10-17T12:30:00Z'), [first, next])
        ?.id,
    ).toBe('next');
  });

  it('adds upcoming flight clocks near boarding, including a connection', () => {
    expect(
      actionTravelSegment(action('2026-10-17T04:00:00Z', '2026-10-17T05:00:00Z'), [first, next])
        ?.id,
    ).toBe('first');
    expect(
      actionTravelSegment(action('2026-10-17T11:00:00Z', '2026-10-17T11:30:00Z'), [first, next])
        ?.id,
    ).toBe('next');
    expect(
      actionTravelSegment(action('2026-10-17T01:00:00Z', '2026-10-17T02:00:00Z'), [first, next]),
    ).toBeUndefined();
  });

  it('does not attach the previous origin clock to ground advice after arrival', () => {
    expect(
      actionTravelSegment(action('2026-10-17T19:00:00Z', '2026-10-17T20:00:00Z'), [first, next]),
    ).toBeUndefined();
    const melbourne = segment('qf94', '2026-10-25T06:40:00Z', '2026-10-25T22:30:00Z');
    expect(
      actionTravelSegment(action('2026-10-26T12:00:00Z', '2026-10-26T20:00:00Z'), [melbourne]),
    ).toBeUndefined();
    expect(
      actionTravelSegment(action('2026-10-25T22:30:00Z', '2026-10-25T23:00:00Z'), [melbourne]),
    ).toBeUndefined();
  });

  it('retains a point inside a flight but treats its arrival as ground time', () => {
    expect(
      actionTravelSegment(action('2026-10-17T07:00:00Z', '2026-10-17T07:00:00Z'), [first])?.id,
    ).toBe('first');
    expect(
      actionTravelSegment(action('2026-10-17T09:00:00Z', '2026-10-17T09:00:00Z'), [first]),
    ).toBeUndefined();
  });

  it('uses the larger actual overlap when an action spans more than one flight', () => {
    expect(
      actionTravelSegment(action('2026-10-17T08:00:00Z', '2026-10-17T16:00:00Z'), [first, next])
        ?.id,
    ).toBe('next');
  });

  it('handles an absent itinerary and ignores invalid intervals', () => {
    const rest = action('2026-10-17T13:00:00Z', '2026-10-17T14:00:00Z');
    expect(actionTravelSegment(rest)).toBeUndefined();
    expect(actionTravelSegment(rest, [segment('invalid', 'invalid', 'invalid')])).toBeUndefined();
    expect(actionTravelSegment(action('invalid', 'invalid'), [first])).toBeUndefined();
  });
});
