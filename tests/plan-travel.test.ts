import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import { buildCalendar } from '../src/lib/export';
import { generatePlan } from './support/planning';
import { decoratePlanWithTravel } from '../src/lib/plan-travel';
import type { FlightLeg, Plan, PlanAction, PlanDay, Trip } from '../src/lib/types';
import octoberItinerary from './fixtures/itineraries/oct2026.json';

const leg = (changes: Partial<FlightLeg> = {}): FlightLeg => ({
  id: 'outbound',
  flightNumber: 'BA123',
  departureAirport: 'JFK',
  arrivalAirport: 'LHR',
  departureDateTime: '2026-10-15T10:00',
  arrivalDateTime: '2026-10-15T11:15',
  departureTimeZone: 'UTC',
  arrivalTimeZone: 'UTC',
  stayAfter: 'destination',
  strategy: 'adapt',
  ...changes,
});
const trip = (legs: FlightLeg[]): Trip => ({
  id: 'trip',
  name: 'Travel metadata',
  legs,
  createdAt: '2026-10-01T12:00:00Z',
  updatedAt: '2026-10-01T12:00:00Z',
});
const plan = (days: PlanDay[] = []): Plan => ({
  version: 'test',
  tripId: 'trip',
  generatedAt: '2026-10-01T12:00:00Z',
  days,
  warnings: [],
  summary: { destinations: 1, flightHours: 1.25, timeZoneChanges: 0 },
});
const day = (date: string, timeZone = 'UTC', changes: Partial<PlanDay> = {}): PlanDay => ({
  id: `${date}:${timeZone}`,
  date,
  timeZone,
  label: 'Stay in LHR',
  stage: 'destination',
  actions: [],
  phaseShiftHours: 0.3,
  remainingShiftHours: 2.4,
  note: 'Existing scientific limitation.',
  ...changes,
});

describe('itinerary-derived travel days', () => {
  it.each(['rules', 'model'] as const)(
    'marks a second short daytime segment as travel with the %s engine even without in-flight rest',
    (planningMode) => {
      const second = leg({
        id: 'onward',
        flightNumber: 'BA456',
        departureAirport: 'LHR',
        arrivalAirport: 'CDG',
        departureDateTime: '2026-10-18T10:00',
        arrivalDateTime: '2026-10-18T11:15',
      });
      const result = generatePlan(trip([leg(), second]), {
        ...DEFAULT_PREFERENCES,
        homeTimeZone: 'UTC',
        preparationDays: 0,
        planningMode,
      });
      const travel = result.days.find(
        (value) => value.date === '2026-10-18' && value.timeZone === 'UTC',
      )!;
      expect(travel.stage).toBe('travel');
      expect(travel.label).toBe('LHR → CDG');
      expect(travel.travelSegments?.map((segment) => segment.id)).toEqual(['onward']);
      expect(
        travel.actions.some(
          (action) =>
            Date.parse(action.start) < Date.parse('2026-10-18T11:15Z') &&
            Date.parse(action.end) > Date.parse('2026-10-18T10:00Z'),
        ),
      ).toBe(false);
    },
    30_000,
  );

  it('preserves existing recommendations, scientific notes and estimates while correcting a stay label', () => {
    const action: PlanAction = {
      id: 'stable',
      type: 'sleep',
      start: '2026-10-15T00:00:00Z',
      end: '2026-10-15T07:00:00Z',
      timeZone: 'UTC',
      title: 'Sleep',
      detail: 'Existing detail',
      reason: 'Existing reason',
    };
    const existing = day('2026-10-15', 'UTC', { actions: [action] });
    const original = plan([existing]);
    const result = decoratePlanWithTravel(original, trip([leg()]));
    expect(result.days).toHaveLength(1);
    expect(result.days[0]).toMatchObject({
      id: existing.id,
      stage: 'travel',
      label: 'JFK → LHR',
      actions: [action],
      phaseShiftHours: 0.3,
      remainingShiftHours: 2.4,
      note: existing.note,
    });
    expect(original.days[0].stage).toBe('destination');
    expect(result.days[0].actions).toBe(existing.actions);
  });

  it('adds schedule-only days without inventing recommendations, phase estimates, or calendar alarms', () => {
    const itinerary = trip([leg()]);
    const result = decoratePlanWithTravel(plan(), itinerary);
    expect(result.days).toHaveLength(1);
    expect(result.days[0]).toMatchObject({
      stage: 'travel',
      actions: [],
      phaseEstimateAvailable: false,
    });
    expect(buildCalendar(result, itinerary)).not.toContain('BEGIN:VEVENT');
    expect(buildCalendar(result, itinerary)).not.toContain('BEGIN:VALARM');
  });

  it('retains all flight segments sharing a calendar day in itinerary order', () => {
    const second = leg({
      id: 'onward',
      departureAirport: 'LHR',
      arrivalAirport: 'CDG',
      departureDateTime: '2026-10-15T15:00',
      arrivalDateTime: '2026-10-15T16:15',
    });
    const result = decoratePlanWithTravel(plan([day('2026-10-15')]), trip([leg(), second]));
    expect(result.days[0].travelSegments?.map((segment) => segment.id)).toEqual([
      'outbound',
      'onward',
    ]);
    expect(result.days[0].label).toBe('JFK → LHR · LHR → CDG');
  });

  it('represents origin, destination and intermediate local dates for an overnight flight', () => {
    const overnight = leg({
      departureDateTime: '2026-10-15T22:00',
      arrivalDateTime: '2026-10-17T09:00',
      departureTimeZone: 'America/New_York',
      arrivalTimeZone: 'Europe/London',
    });
    const result = decoratePlanWithTravel(plan(), trip([overnight]));
    expect(result.days.map((value) => value.id)).toEqual(
      expect.arrayContaining([
        '2026-10-15:America/New_York',
        '2026-10-16:Europe/London',
        '2026-10-17:Europe/London',
      ]),
    );
    expect(result.days).toHaveLength(3);
    expect(result.days.every((value) => value.travelSegments?.[0].id === 'outbound')).toBe(true);
    expect(result.days[0].travelSegments?.[0]).toMatchObject({
      departure: '2026-10-16T02:00:00.000Z',
      arrival: '2026-10-17T08:00:00.000Z',
    });
  });

  it('preserves both local calendar dates when crossing the date line backwards', () => {
    const crossing = leg({
      departureAirport: 'CXI',
      arrivalAirport: 'HNL',
      departureDateTime: '2026-10-15T08:00',
      arrivalDateTime: '2026-10-14T10:00',
      departureTimeZone: 'Pacific/Kiritimati',
      arrivalTimeZone: 'Pacific/Honolulu',
    });
    const result = decoratePlanWithTravel(plan(), trip([crossing]));
    expect(result.days.map((value) => value.id)).toEqual(
      expect.arrayContaining(['2026-10-15:Pacific/Kiritimati', '2026-10-14:Pacific/Honolulu']),
    );
    expect(result.days).toHaveLength(2);
    expect(
      Date.parse(result.days[0].travelSegments![0].arrival) -
        Date.parse(result.days[0].travelSegments![0].departure),
    ).toBe(2 * 3_600_000);
  });

  it('does not invent a preceding destination day for a Sydney-to-Honolulu flight', () => {
    const crossing = leg({
      departureAirport: 'SYD',
      arrivalAirport: 'HNL',
      departureDateTime: '2026-10-17T10:00',
      arrivalDateTime: '2026-10-17T00:30',
      departureTimeZone: 'Australia/Sydney',
      arrivalTimeZone: 'Pacific/Honolulu',
    });
    const result = decoratePlanWithTravel(plan(), trip([crossing]));
    expect(result.days.map((value) => value.id)).toEqual(
      expect.arrayContaining(['2026-10-17:Australia/Sydney', '2026-10-17:Pacific/Honolulu']),
    );
    expect(result.days).toHaveLength(2);
    expect(result.days.some((value) => value.date === '2026-10-16')).toBe(false);
    const existing = day('2026-10-16', 'Pacific/Honolulu');
    expect(
      decoratePlanWithTravel(plan([existing]), trip([crossing])).days.find(
        (value) => value.id === existing.id,
      )?.travelSegments,
    ).toHaveLength(1);
  });

  it('respects an explicit fall-back fold and real midnight boundaries on a 25-hour day', () => {
    const fold = leg({
      departureDateTime: '2026-11-01T01:30',
      departureTimeZone: 'America/New_York',
      departureDisambiguation: 'later',
      arrivalDateTime: '2026-11-01T10:00',
      arrivalTimeZone: 'Europe/London',
    });
    const result = decoratePlanWithTravel(
      plan([day('2026-10-31', 'America/New_York'), day('2026-11-02', 'America/New_York')]),
      trip([fold]),
    );
    const travel = result.days.find((value) => value.id === '2026-11-01:America/New_York')!;
    expect(travel.travelSegments?.[0].departure).toBe('2026-11-01T06:30:00.000Z');
    expect(result.days.find((value) => value.date === '2026-10-31')?.stage).toBe('destination');
    expect(result.days.find((value) => value.date === '2026-11-02')?.stage).toBe('destination');
  });

  it('includes the arrival date at midnight and excludes the day before a midnight departure', () => {
    const midnight = leg({
      departureDateTime: '2026-10-15T00:00',
      arrivalDateTime: '2026-10-16T00:00',
    });
    const result = decoratePlanWithTravel(
      plan([day('2026-10-14'), day('2026-10-17')]),
      trip([midnight]),
    );
    expect(result.days.find((value) => value.date === '2026-10-14')?.stage).toBe('destination');
    expect(result.days.find((value) => value.date === '2026-10-15')?.stage).toBe('travel');
    expect(result.days.find((value) => value.date === '2026-10-16')?.stage).toBe('travel');
    expect(result.days.find((value) => value.date === '2026-10-17')?.stage).toBe('destination');
  });

  it('uses the 23-hour spring-forward day when a flight crosses the following midnight', () => {
    const spring = leg({
      departureDateTime: '2026-03-09T03:30',
      arrivalDateTime: '2026-03-09T00:30',
      departureTimeZone: 'UTC',
      arrivalTimeZone: 'America/New_York',
    });
    const result = decoratePlanWithTravel(
      plan([day('2026-03-08', 'America/New_York')]),
      trip([spring]),
    );
    expect(result.days.find((value) => value.id === '2026-03-08:America/New_York')?.stage).toBe(
      'travel',
    );
    expect(result.days.find((value) => value.id === '2026-03-09:America/New_York')?.stage).toBe(
      'travel',
    );
  });

  it.each(['rules', 'model'] as const)(
    'represents every segment and date-line transit day in the five-flight October itinerary with %s planning',
    (planningMode) => {
      // Sources, schedule conflicts and codeshare ambiguity are recorded alongside
      // this shared fixture. No live lookup or booking verification is implied.
      const itinerary = octoberItinerary.trip as Trip;
      const result = generatePlan(itinerary, {
        ...DEFAULT_PREFERENCES,
        homeTimeZone: 'Australia/Sydney',
        preparationDays: 0,
        planningMode,
      });
      for (const flight of itinerary.legs) {
        for (const [date, zone] of [
          [flight.departureDateTime.slice(0, 10), flight.departureTimeZone],
          [flight.arrivalDateTime.slice(0, 10), flight.arrivalTimeZone],
        ]) {
          const value = result.days.find(
            (candidate) => candidate.date === date && candidate.timeZone === zone,
          );
          expect(value?.stage, `${flight.flightNumber} ${date} ${zone}`).toBe('travel');
          expect(value?.travelSegments?.some((segment) => segment.id === flight.id)).toBe(true);
        }
      }
      expect(
        result.days
          .find((value) => value.id === '2026-10-24:America/Los_Angeles')
          ?.travelSegments?.map((segment) => segment.flightNumber),
      ).toEqual(['AA6276', 'QF94']);
      expect(
        result.days
          .find((value) => value.id === '2026-10-25:Australia/Melbourne')
          ?.travelSegments?.some((segment) => segment.flightNumber === 'QF94'),
      ).toBe(true);
      expect(result.days.some((value) => value.id === '2026-10-16:Pacific/Honolulu')).toBe(false);
      expect(
        result.days.filter(
          (value) =>
            value.date === '2026-10-27' &&
            value.travelSegments?.some((segment) => segment.flightNumber === 'QF490'),
        ).length,
      ).toBeGreaterThan(0);
      // Missing model history can now accompany real recommendations. Only a
      // synthetic schedule-only day promises to have no scientific actions.
      expect(
        result.days
          .filter((value) => value.note.startsWith('Flight schedule only.'))
          .every((value) => value.phaseEstimateAvailable === false && value.actions.length === 0),
      ).toBe(true);
    },
    30_000,
  );
});
