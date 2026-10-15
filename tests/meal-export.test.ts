import { describe, expect, it } from 'vitest';
import { buildCalendar } from '../src/lib/export';
import type { MealWindow, Plan, PlanAction, PlanTravelSegment, Trip } from '../src/lib/types';

const trip: Trip = {
  id: 'meal-trip', name: 'Sleep through dinner', legs: [],
  createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z',
};
const meal = (changes: Partial<MealWindow> = {}): MealWindow => ({
  id: 'flight-meal', start: '2026-10-17T07:00:00Z', end: '2026-10-17T07:30:00Z',
  location: 'in-flight', title: 'Eat after your rest', detail: 'Choose a light meal if available.', ...changes,
});
const sleep: PlanAction = {
  id: 'sleep', type: 'sleep', start: '2026-10-17T00:00:00Z', end: '2026-10-17T06:00:00Z',
  timeZone: 'Pacific/Honolulu', title: 'Protected sleep', detail: 'Rest undisturbed.', reason: 'Protect the sleep opportunity.',
};
const segment = (windows: MealWindow[]): PlanTravelSegment => ({
  id: 'flight', flightNumber: 'QF103', departureAirport: 'SYD', arrivalAirport: 'HNL',
  departure: '2026-10-16T22:00:00Z', arrival: '2026-10-17T10:00:00Z',
  departureTimeZone: 'Australia/Sydney', arrivalTimeZone: 'Pacific/Honolulu',
  mealPlan: {
    wakeForMeals: false, advice: 'Ask the crew not to wake you for meals.',
    reason: 'Avoid fragmenting your planned sleep.', windows,
  },
});
const plan = (segments: PlanTravelSegment[], actions: PlanAction[] = [sleep]): Plan => ({
  version: 'test', tripId: trip.id, generatedAt: trip.createdAt, warnings: [],
  summary: { destinations: 1, flightHours: 12, timeZoneChanges: 1 },
  days: [{
    id: 'day', date: '2026-10-17', timeZone: 'Pacific/Honolulu', label: 'Travel', stage: 'travel',
    phaseShiftHours: 0, remainingShiftHours: 0, note: '', actions, travelSegments: segments,
  }],
});
const events = (calendar: string) => calendar.replace(/\r\n /g, '').match(/BEGIN:VEVENT\r\n[\s\S]*?END:VEVENT/g) ?? [];

describe('flight meal calendar export', () => {
  it('deduplicates repeated day displays and meal windows by identity or absolute interval', () => {
    const first = segment([
      meal(),
      meal({ id: 'same-time-other-id', start: '2026-10-17T18:00:00+11:00', end: '2026-10-17T18:30:00+11:00' }),
      meal({ start: '2026-10-17T08:00:00Z', end: '2026-10-17T08:30:00Z' }),
    ]);
    const original = plan([first], []);
    const repeated = { ...original, days: [...original.days, { ...original.days[0], id: 'arrival-display' }] };
    const calendar = buildCalendar(repeated, trip);
    expect(events(calendar)).toHaveLength(1);
    expect(calendar.match(/^UID:.*$/gm)).toEqual(buildCalendar(plan([segment([meal()])], []), trip).match(/^UID:.*$/gm));
  });

  it('never alarms for suggested meals and preserves the existing recommendation event exactly', () => {
    const baseline = events(buildCalendar(plan([]), trip));
    const withMeals = events(buildCalendar(plan([segment([meal()])]), trip));
    expect(withMeals).toHaveLength(2);
    expect(withMeals[0]).toBe(baseline[0]);
    expect(withMeals[0]).toContain('BEGIN:VALARM');
    expect(withMeals[1]).not.toContain('VALARM');
    expect(buildCalendar(plan([segment([meal()])]), trip, false)).not.toContain('VALARM');
  });

  it('uses explicit UTC instants and retains origin, destination, flight and service caveats', () => {
    const calendar = buildCalendar(plan([segment([meal({
      start: '2026-10-17T18:30:00+11:00', end: '2026-10-17T19:00:00+11:00',
    })])], []), trip).replace(/\r\n /g, '');
    expect(calendar).toContain('DTSTART:20261017T073000Z\r\nDTEND:20261017T080000Z');
    expect(calendar).toContain('SUMMARY:Suggested meal · Eat after your rest');
    expect(calendar).toContain('QF103 · SYD → HNL');
    expect(calendar).toContain('Origin zone: Australia/Sydney. Destination zone: Pacific/Honolulu.');
    expect(calendar).toContain('Ask the crew not to wake you for meals.');
    expect(calendar).toContain('airline meal service times are not known');
    expect(calendar).not.toContain('TZID=');
  });

  it('omits invalid, floating, empty and reversed intervals without throwing', () => {
    const windows = [
      meal({ id: 'invalid-start', start: 'not-a-timeZ' }),
      meal({ id: 'invalid-end', end: 'not-a-timeZ' }),
      meal({ id: 'floating', start: '2026-10-17T07:00:00' }),
      meal({ id: 'empty', end: '2026-10-17T07:00:00Z' }),
      meal({ id: 'reversed', end: '2026-10-17T06:59:00Z' }),
    ];
    expect(events(buildCalendar(plan([segment(windows)], []), trip))).toHaveLength(0);
  });

  it('omits any meal overlapping sleep while allowing meals exactly before or after it', () => {
    const windows = [
      meal({ id: 'inside', start: '2026-10-17T02:00:00Z', end: '2026-10-17T02:30:00Z' }),
      meal({ id: 'cross-start', start: '2026-10-16T23:50:00Z', end: '2026-10-17T00:10:00Z' }),
      meal({ id: 'cross-end', start: '2026-10-17T05:50:00Z', end: '2026-10-17T06:10:00Z' }),
      meal({ id: 'covering', start: '2026-10-16T23:00:00Z', end: '2026-10-17T07:00:00Z' }),
      meal({ id: 'before', start: '2026-10-16T23:30:00Z', end: sleep.start, location: 'before-flight' }),
      meal({ id: 'after', start: sleep.end, end: '2026-10-17T06:30:00Z', location: 'after-flight' }),
    ];
    const exported = events(buildCalendar(plan([segment(windows)]), trip));
    expect(exported).toHaveLength(3);
    expect(exported.slice(1).join('\n')).toContain('Before departure');
    expect(exported.slice(1).join('\n')).toContain('After arrival');
    expect(exported.slice(1).join('\n')).not.toContain('DTSTART:20261017T020000Z');
  });

  it('keeps a meal within scheduled sleep that was logged as missed', () => {
    const missedTrip: Trip = { ...trip, adherence: [{
      id: 'missed-sleep', tripId: trip.id, actionId: sleep.id, type: 'sleep', status: 'missed',
      scheduledStart: sleep.start, scheduledEnd: sleep.end, timeZone: sleep.timeZone,
      recordedAt: '2026-10-17T06:30:00Z',
    }] };
    const window = meal({ start: '2026-10-17T02:00:00Z', end: '2026-10-17T02:30:00Z' });
    const calendar = buildCalendar(plan([segment([window])], [{ ...sleep, title: 'Logged sleep · missed' }]), missedTrip);
    expect(events(calendar).filter(event => event.includes('SUMMARY:Suggested meal'))).toHaveLength(1);
  });

  it('protects completed actual sleep outside its original scheduled interval', () => {
    const completedTrip: Trip = { ...trip, adherence: [{
      id: 'completed-sleep', tripId: trip.id, actionId: sleep.id, type: 'sleep', status: 'completed',
      scheduledStart: sleep.start, scheduledEnd: sleep.end, timeZone: sleep.timeZone,
      actualStart: '2026-10-17T07:00:00Z', actualEnd: '2026-10-17T08:00:00Z',
      recordedAt: '2026-10-17T08:30:00Z',
    }] };
    const awake = meal({ id: 'awake', start: '2026-10-17T02:00:00Z', end: '2026-10-17T02:30:00Z' });
    const calendar = buildCalendar(plan([segment([meal(), awake])], [{ ...sleep, title: 'Logged sleep · completed' }]), completedTrip);
    const exportedMeals = events(calendar).filter(event => event.includes('SUMMARY:Suggested meal'));
    expect(exportedMeals).toHaveLength(1);
    expect(exportedMeals[0]).toContain('DTSTART:20261017T020000Z');
    expect(exportedMeals[0]).not.toContain('DTSTART:20261017T070000Z');
  });

  it('continues protecting generated future sleep even when an older missed log shares its action ID', () => {
    const loggedTrip: Trip = { ...trip, adherence: [{
      id: 'older-missed-sleep', tripId: trip.id, actionId: sleep.id, type: 'sleep', status: 'missed',
      scheduledStart: sleep.start, scheduledEnd: sleep.end, timeZone: sleep.timeZone,
      recordedAt: '2026-10-17T06:30:00Z',
    }] };
    const futureSleep = { ...sleep, start: '2026-10-18T00:00:00Z', end: '2026-10-18T06:00:00Z' };
    const window = meal({ start: '2026-10-18T02:00:00Z', end: '2026-10-18T02:30:00Z' });
    const calendar = buildCalendar(plan([segment([window])], [futureSleep]), loggedTrip);
    expect(events(calendar).filter(event => event.includes('SUMMARY:Suggested meal'))).toHaveLength(0);
  });

  it('escapes meal content and folds UTF-8 without allowing calendar property injection', () => {
    const malicious = segment([meal({
      title: 'Dinner\r\nBEGIN:VEVENT',
      detail: '旅'.repeat(90) + '; water, then rest.\nBEGIN:VALARM',
    })]);
    malicious.flightNumber = 'QF103\nBEGIN:VEVENT';
    malicious.mealPlan!.advice += '\r\nACTION:DISPLAY';
    malicious.arrivalTimeZone += '\nBEGIN:VALARM';
    const calendar = buildCalendar(plan([malicious], []), { ...trip, id: 'trip\nBEGIN:VEVENT' });
    const unfolded = calendar.replace(/\r\n /g, '');
    expect(events(calendar)).toHaveLength(1);
    expect(calendar).not.toMatch(/^BEGIN:VALARM\r?$/m);
    expect(unfolded).toContain('Dinner\\nBEGIN:VEVENT');
    expect(unfolded).toContain('旅'.repeat(90) + '\\; water\\, then rest.\\nBEGIN:VALARM');
    expect(calendar.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });
});
