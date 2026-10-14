import { describe, expect, it } from 'vitest';
import { generatePlan, PLAN_VERSION, validateTrip } from '../src/lib/plan';
import { localToInstant } from '../src/lib/time';
import type { FlightLeg, Preferences, Trip } from '../src/lib/types';

const HOUR = 3_600_000;
const preferences: Preferences = {
  homeTimeZone: 'America/New_York', chronotype: 'intermediate',
  usualBedtime: '23:00', usualWakeTime: '07:00',
  preferredBedtime: '23:00', preferredWakeTime: '07:00', sleepHours: 8, sleepAnchor: 'wake',
  caffeine: true, melatonin: false, melatoninAcknowledged: false, preparationDays: 3, planningMode: 'rules',
};
const first: FlightLeg = {
  id: 'outbound', flightNumber: 'BA178', departureAirport: 'JFK', arrivalAirport: 'LHR',
  departureDateTime: '2026-10-14T18:00', arrivalDateTime: '2026-10-15T06:00',
  departureTimeZone: 'America/New_York', arrivalTimeZone: 'Europe/London',
  stayAfter: 'destination', strategy: 'adapt', travelClass: 'economy', lieFlat: false,
};
const trip = (legs: FlightLeg[] = [first]): Trip => ({
  id: 'trip', name: 'Test trip', createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z', legs,
});
const actions = (result: ReturnType<typeof generatePlan>) => result.days.flatMap(day => day.actions);
const overlap = (a: { start: string; end: string }, start: number, end: number) => Date.parse(a.start) < end && Date.parse(a.end) > start;

describe('planning rules', () => {
  it('creates dated preparation and destination opportunities with transparent limitations', () => {
    const result = generatePlan(trip(), preferences);
    expect(result.version).toBe(PLAN_VERSION);
    expect(result.days.some(day => day.stage === 'preparation')).toBe(true);
    expect(result.days.some(day => day.stage === 'destination')).toBe(true);
    expect(result.summary.flightHours).toBe(7);
    expect(result.warnings.join(' ')).toContain('not a clinically validated');
    expect(actions(result).some(action => action.type === 'light')).toBe(true);
    expect(actions(result).some(action => action.type === 'sleep')).toBe(true);
  });
  it('protects boarding, landing, and transfer buffers and avoids light during sleep', () => {
    const connection = { ...first, stayAfter: 'connection' as const };
    const onwards: FlightLeg = { ...first, id: 'onwards', departureAirport: 'LHR', arrivalAirport: 'DEL',
      departureTimeZone: 'Europe/London', arrivalTimeZone: 'Asia/Kolkata',
      departureDateTime: '2026-10-15T10:00', arrivalDateTime: '2026-10-15T23:00' };
    const itinerary = trip([connection, onwards]);
    const result = generatePlan(itinerary, preferences);
    for (const leg of itinerary.legs) {
      const departure = localToInstant(leg.departureDateTime, leg.departureTimeZone);
      const arrival = localToInstant(leg.arrivalDateTime, leg.arrivalTimeZone);
      for (const action of actions(result)) {
        expect(overlap(action, departure - 2 * HOUR, departure + HOUR)).toBe(false);
        expect(overlap(action, arrival - HOUR, arrival + HOUR)).toBe(false);
      }
    }
    const sleep = actions(result).filter(action => action.type === 'sleep');
    for (const action of actions(result).filter(action => ['light', 'avoid-light', 'caffeine', 'melatonin'].includes(action.type))) {
      for (const window of sleep) expect(overlap(action, Date.parse(window.start), Date.parse(window.end))).toBe(false);
    }
  });
  it('clips sleep covering both flight edges for every class and destination sleep target', () => {
    const overnight: FlightLeg = { ...first, departureAirport: 'JFK', arrivalAirport: 'BOS',
      departureDateTime: '2026-10-14T23:00', arrivalDateTime: '2026-10-15T07:00',
      departureTimeZone: 'UTC', arrivalTimeZone: 'UTC' };
    const departure = localToInstant(overnight.departureDateTime, overnight.departureTimeZone);
    const arrival = localToInstant(overnight.arrivalDateTime, overnight.arrivalTimeZone);
    for (const travelClass of ['economy', 'premium-economy', 'business', 'first'] as const) {
      for (const lieFlat of [false, true]) for (const preferredWakeTime of ['07:00', '19:00']) {
        const result = generatePlan(trip([{ ...overnight, travelClass, lieFlat }]), {
          ...preferences, homeTimeZone: 'UTC', preparationDays: 0, preferredWakeTime,
        });
        const inFlightSleep = actions(result).filter(action => action.type === 'sleep'
          && Date.parse(action.start) >= departure && Date.parse(action.end) <= arrival);
        expect(inFlightSleep.length).toBeGreaterThan(0);
        expect(Math.min(...inFlightSleep.map(action => Date.parse(action.start)))).toBe(departure + HOUR);
        expect(Math.max(...inFlightSleep.map(action => Date.parse(action.end)))).toBe(arrival - 1.5 * HOUR);
        for (const sleep of inFlightSleep) {
          expect(overlap(sleep, departure, departure + HOUR)).toBe(false);
          expect(overlap(sleep, arrival - HOUR, arrival)).toBe(false);
        }
      }
    }
  });
  it('uses actual lie-flat availability rather than inferring it from class', () => {
    const economy = generatePlan(trip([{ ...first, travelClass: 'economy', lieFlat: false }]), preferences);
    const business = generatePlan(trip([{ ...first, travelClass: 'business', lieFlat: false }]), preferences);
    expect(economy.days).toEqual(business.days);
    const lieFlat = generatePlan(trip([{ ...first, travelClass: 'economy', lieFlat: true }]), preferences);
    const seated = actions(business).filter(action => action.title === 'Seated rest or nap opportunity');
    const flat = actions(lieFlat).filter(action => action.title === 'Lie-flat sleep opportunity');
    expect(seated.length).toBeGreaterThan(0);
    expect(flat.length).toBe(seated.length);
    expect(seated.every(action => action.detail.includes('does not assume you obtain your usual sleep hours'))).toBe(true);
    expect(flat.every(action => action.detail.includes('actual sleep duration and recovery vary'))).toBe(true);
    expect(flat.map(action => [action.start, action.end])).toEqual(seated.map(action => [action.start, action.end]));
    expect(lieFlat.days.map(day => [day.phaseShiftHours, day.remainingShiftHours]))
      .toEqual(business.days.map(day => [day.phaseShiftHours, day.remainingShiftHours]));
  });
  it('prepares for the first destination beyond a connection and carries that progress forward', () => {
    const connection: FlightLeg = { ...first, arrivalAirport: 'BOS', arrivalTimeZone: 'America/New_York',
      arrivalDateTime: '2026-10-14T19:30', stayAfter: 'connection', strategy: 'home' };
    const onwards: FlightLeg = { ...first, id: 'connection-onwards', departureAirport: 'BOS',
      departureDateTime: '2026-10-14T22:00', arrivalDateTime: '2026-10-15T09:00' };
    const prepared = generatePlan(trip([connection, onwards]), preferences);
    const unprepared = generatePlan(trip([connection, onwards]), { ...preferences, preparationDays: 0 });
    const prepDays = prepared.days.filter(day => day.stage === 'preparation');
    expect(prepDays.reduce((sum, day) => sum + day.phaseShiftHours, 0)).toBeGreaterThan(2);
    expect(prepDays.some(day => day.actions.some(action => action.type === 'light'))).toBe(true);
    expect(prepared.days.find(day => day.stage === 'destination')!.remainingShiftHours)
      .toBeLessThan(unprepared.days.find(day => day.stage === 'destination')!.remainingShiftHours);
  });
  it('limits westward preparation to one hour per day while protecting sleep duration', () => {
    const west: FlightLeg = { ...first, arrivalAirport: 'LAX', arrivalTimeZone: 'America/Los_Angeles', arrivalDateTime: '2026-10-14T20:00' };
    const result = generatePlan(trip([west]), preferences);
    const preparation = result.days.filter(day => day.stage === 'preparation');
    const assumedShift = Math.abs(preparation.reduce((sum, day) => sum + day.phaseShiftHours, 0));
    expect(assumedShift).toBeGreaterThan(2);
    expect(assumedShift).toBeLessThanOrEqual(preferences.preparationDays);
    expect(preparation.every(day => day.note.includes('at most 1 hour/day'))).toBe(true);
  });
  it('warns about an unspecified surface transfer between different airports', () => {
    const onwards: FlightLeg = { ...first, id: 'surface-onwards', departureAirport: 'CDG', arrivalAirport: 'DEL',
      departureDateTime: '2026-10-17T12:00', arrivalDateTime: '2026-10-18T00:30',
      departureTimeZone: 'Europe/Paris', arrivalTimeZone: 'Asia/Kolkata' };
    const itinerary = trip([first, onwards]);
    expect(validateTrip(itinerary)).toEqual([]);
    expect(generatePlan(itinerary, preferences).warnings.join(' ')).toContain('surface transfer');
  });
  it('keeps caffeine at least eight hours before every future planned sleep', () => {
    const result = generatePlan(trip(), preferences);
    const sleep = actions(result).filter(action => action.type === 'sleep');
    const caffeine = actions(result).filter(action => action.type === 'caffeine');
    expect(caffeine.length).toBeGreaterThan(0);
    for (const action of caffeine) for (const window of sleep) {
      if (Date.parse(window.start) > Date.parse(action.start)) {
        expect(Date.parse(action.end)).toBeLessThanOrEqual(Date.parse(window.start) - 8 * HOUR);
      }
    }
  });
  it('respects caffeine and melatonin opt-outs and requires melatonin acknowledgement', () => {
    const off = actions(generatePlan(trip(), { ...preferences, caffeine: false, melatonin: false }));
    expect(off.some(action => action.type === 'caffeine' || action.type === 'melatonin')).toBe(false);
    const unacknowledged = generatePlan(trip(), { ...preferences, melatonin: true, melatoninAcknowledged: false });
    expect(actions(unacknowledged).some(action => action.type === 'melatonin')).toBe(false);
    expect(unacknowledged.warnings.join(' ')).toContain('disabled until');
    const acknowledged = actions(generatePlan(trip(), { ...preferences, melatonin: true, melatoninAcknowledged: true }));
    expect(acknowledged.some(action => action.type === 'melatonin')).toBe(true);
    for (const action of acknowledged.filter(action => action.type === 'melatonin')) {
      expect(action.dose).toContain('0.5–1 mg');
      expect(action.detail).toContain('not a personalized dose');
    }
  });
  it('does not offer a dose before a truncated night or alertness-critical onward flight', () => {
    const onwards: FlightLeg = { ...first, id: 'early-onwards', departureAirport: 'LHR', arrivalAirport: 'CDG',
      departureDateTime: '2026-10-16T04:00', arrivalDateTime: '2026-10-16T06:30',
      departureTimeZone: 'Europe/London', arrivalTimeZone: 'Europe/Paris' };
    const result = generatePlan(trip([first, onwards]), { ...preferences, preparationDays: 0, melatonin: true, melatoninAcknowledged: true });
    const dosesOnFirstNight = actions(result).filter(action => action.type === 'melatonin' && action.start < '2026-10-16T03:00:00.000Z');
    expect(dosesOnFirstNight).toEqual([]);
  });
  it('carries phase between stays rather than resetting to a fresh home clock', () => {
    const returnLeg: FlightLeg = { ...first, id: 'return', departureAirport: 'LHR', arrivalAirport: 'JFK',
      departureDateTime: '2026-10-18T12:00', arrivalDateTime: '2026-10-18T15:00',
      departureTimeZone: 'Europe/London', arrivalTimeZone: 'America/New_York' };
    const full = generatePlan(trip([first, returnLeg]), { ...preferences, preparationDays: 0 });
    const home = full.days.find(day => day.stage === 'home');
    expect(home).toBeDefined();
    expect(home!.remainingShiftHours).toBeGreaterThan(0);
    const isolated = generatePlan(trip([returnLeg]), { ...preferences, preparationDays: 0 });
    expect(isolated.days.find(day => day.stage === 'home')!.remainingShiftHours).toBe(0);
  });
  it('does not invent an extra chronotype offset', () => {
    const early = generatePlan(trip(), { ...preferences, chronotype: 'early' });
    const late = generatePlan(trip(), { ...preferences, chronotype: 'late' });
    expect(early.days).toEqual(late.days);
  });
  it('supports minute-level sleep clocks without fractional epoch errors', () => {
    const result = generatePlan(trip(), { ...preferences, usualWakeTime: '07:17', preferredWakeTime: '07:23',
      usualBedtime: '23:11', melatonin: true, melatoninAcknowledged: true });
    expect(actions(result).length).toBeGreaterThan(0);
    expect(actions(result).every(action => Number.isFinite(Date.parse(action.start)) && Number.isFinite(Date.parse(action.end)))).toBe(true);
  });
  it('warns about large shifts and omits their precise phase interventions', () => {
    const tokyo: FlightLeg = { ...first, arrivalAirport: 'HND', arrivalDateTime: '2026-10-16T00:00', arrivalTimeZone: 'Asia/Tokyo' };
    const result = generatePlan(trip([tokyo]), { ...preferences, preparationDays: 0, melatonin: true, melatoninAcknowledged: true });
    expect(result.warnings.join(' ')).toContain('uncertain advance/delay route');
    expect(actions(result).some(action => ['light', 'avoid-light', 'melatonin'].includes(action.type))).toBe(false);
    const prepared = generatePlan(trip([tokyo]), { ...preferences, preparationDays: 7, melatonin: true, melatoninAcknowledged: true });
    expect(prepared.warnings.join(' ')).toContain('Assumed progress cannot establish');
    expect(actions(prepared).some(action => ['light', 'avoid-light', 'melatonin'].includes(action.type))).toBe(false);
  });
  it('supports home and partial strategies without requiring full destination adaptation', () => {
    const home = generatePlan(trip([{ ...first, strategy: 'home' }]), { ...preferences, preparationDays: 0 });
    expect(home.days.filter(day => day.stage === 'destination').every(day => day.remainingShiftHours === 0)).toBe(true);
    const partial = generatePlan(trip([{ ...first, strategy: 'partial' }]), { ...preferences, preparationDays: 0 });
    const full = generatePlan(trip(), { ...preferences, preparationDays: 0 });
    expect(partial.days.find(day => day.stage === 'destination')!.remainingShiftHours).toBeLessThan(full.days.find(day => day.stage === 'destination')!.remainingShiftHours);
  });
  it('preserves requested sleep duration across daylight saving when ground time permits', () => {
    const dstLeg: FlightLeg = { ...first, departureDateTime: '2026-10-23T18:00', arrivalDateTime: '2026-10-24T06:00' };
    const result = generatePlan(trip([dstLeg]), { ...preferences, preparationDays: 0 });
    const sleep = actions(result).filter(action => action.type === 'sleep').sort((a, b) => a.start.localeCompare(b.start));
    // A midnight display split retains eight elapsed hours for each consecutive main sleep opportunity.
    let longest = 0;
    let blockStart = 0;
    let blockEnd = 0;
    for (const action of sleep) {
      const start = Date.parse(action.start), end = Date.parse(action.end);
      if (start !== blockEnd) blockStart = start;
      blockEnd = end;
      longest = Math.max(longest, blockEnd - blockStart);
    }
    expect(longest).toBe(8 * HOUR);
  });
  it('bounds the complete generated horizon to ninety days', () => {
    const distant: FlightLeg = { ...first, id: 'distant', departureDateTime: '2027-01-09T18:00', arrivalDateTime: '2027-01-10T06:00' };
    const result = generatePlan(trip([first, distant]), preferences);
    const emitted = actions(result);
    expect(Math.max(...emitted.map(action => Date.parse(action.end))) - Math.min(...emitted.map(action => Date.parse(action.start)))).toBeLessThanOrEqual(90 * 24 * HOUR);
  }, 20_000);
});

describe('itinerary validation', () => {
  it('rejects invalid order, overlapping flights, and ambiguous DST input', () => {
    const earlier = { ...first, id: 'earlier', departureDateTime: '2026-10-13T18:00', arrivalDateTime: '2026-10-14T06:00' };
    expect(validateTrip(trip([first, earlier])).join(' ')).toContain('travel order');
    const ambiguous = { ...first, departureDateTime: '2026-11-01T01:30', arrivalDateTime: '2026-11-01T16:00' };
    expect(validateTrip(trip([ambiguous])).join(' ')).toContain('ambiguous');
    expect(() => generatePlan(trip([ambiguous]), preferences)).toThrow();
  });
  it('accepts date-line travel arriving on an earlier local calendar date', () => {
    const leg: FlightLeg = { ...first, departureAirport: 'CXI', arrivalAirport: 'HNL',
      departureDateTime: '2026-10-15T08:00', arrivalDateTime: '2026-10-14T10:00',
      departureTimeZone: 'Pacific/Kiritimati', arrivalTimeZone: 'Pacific/Honolulu' };
    expect(validateTrip(trip([leg]))).toEqual([]);
    expect(generatePlan(trip([leg]), { ...preferences, homeTimeZone: 'Pacific/Kiritimati', preparationDays: 0 }).summary.flightHours).toBe(2);
  });
  it('rejects malformed airport codes and gate flights longer than 36 hours', () => {
    expect(validateTrip(trip([{ ...first, departureAirport: 'XX' }])).join(' ')).toContain('airport code');
    const longFlight = { ...first, departureTimeZone: 'UTC', arrivalTimeZone: 'UTC', departureDateTime: '2026-10-14T06:00', arrivalDateTime: '2026-10-16T00:30' };
    expect(validateTrip(trip([longFlight])).join(' ')).toContain('36 hours');
  });
  it('rejects excessive trip duration', () => {
    const distant = { ...first, id: 'distant', departureDateTime: '2027-02-14T18:00', arrivalDateTime: '2027-02-15T06:00' };
    expect(validateTrip(trip([first, distant])).join(' ')).toContain('90-day');
  });
});
