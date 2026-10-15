import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import { generatePlan } from '../src/lib/plan';
import { groupPlanDays } from '../src/lib/plan-calendar';
import { actionCity, airportCityName, planDayCity, stayPlaceLabel } from '../src/lib/plan-places';
import type { FlightLeg, Trip } from '../src/lib/types';

const flight: FlightLeg = {
  id: 'honolulu-san-francisco', flightNumber: 'AS812', departureAirport: 'HNL', arrivalAirport: 'SFO',
  departureDateTime: '2026-10-19T11:00', arrivalDateTime: '2026-10-19T19:00',
  departureTimeZone: 'Pacific/Honolulu', arrivalTimeZone: 'America/Los_Angeles',
  stayAfter: 'destination', strategy: 'adapt', flightSource: 'manual',
};
const itinerary: Trip = {
  id: 'city-regression', name: 'California cities', createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z',
  legs: [flight, {
    ...flight, id: 'san-francisco-san-diego', flightNumber: 'TEST2', departureAirport: 'SFO', arrivalAirport: 'SAN',
    departureDateTime: '2026-10-23T10:00', arrivalDateTime: '2026-10-23T11:45', departureTimeZone: 'America/Los_Angeles',
    flightSource: 'aerodatabox',
  }],
};

describe('itinerary place names', () => {
  it('distinguishes cities that share the same IANA clock and uses neutral unknown-place labels', () => {
    expect(airportCityName(' sfo ')).toBe('San Francisco');
    expect(airportCityName('LAX')).toBe('Los Angeles');
    expect(airportCityName('SAN')).toBe('San Diego');
    expect(airportCityName('ZZZ')).toBeUndefined();
    expect(stayPlaceLabel('SFO', true)).toBe('Stay in San Francisco');
    expect(stayPlaceLabel('SFO', false)).toBe('Connection in San Francisco');
    expect(stayPlaceLabel('ZZZ', true)).toBe('Stay at destination');
    expect(stayPlaceLabel('ZZZ', false)).toBe('Connection');
    expect(planDayCity({ locationAirport: 'ZZZ', stage: 'destination' })).toBe('Destination');
    expect(planDayCity({ stage: 'preparation' })).toBe('Departure city');
  });

  it.each(['rules', 'model'] as const)('labels saved manual/imported stays by actual city with the %s engine', planningMode => {
    const plan = generatePlan(itinerary, {
      ...DEFAULT_PREFERENCES, homeTimeZone: 'Australia/Sydney', preparationDays: 0, planningMode,
    });
    const days = groupPlanDays(plan.days);
    for (const date of ['2026-10-20', '2026-10-21', '2026-10-22']) {
      const day = days.find(day => day.date === date)!;
      expect(day).toMatchObject({ locationAirport: 'SFO', label: 'Stay in San Francisco', timeZone: 'America/Los_Angeles' });
      expect(planDayCity(day)).toBe('San Francisco');
      expect(day.actions.length).toBeGreaterThan(0);
      expect(actionCity(day.actions[0], plan.days)).toBe('San Francisco');
    }
    const sanDiego = days.find(day => day.date === '2026-10-24')!;
    expect(sanDiego).toMatchObject({ locationAirport: 'SAN', label: 'Stay in San Diego', timeZone: 'America/Los_Angeles' });
    expect(planDayCity(sanDiego)).toBe('San Diego');
    expect(actionCity(sanDiego.actions[0], plan.days)).toBe('San Diego');
  }, 30_000);

  it.each(['rules', 'model'] as const)('keeps the arrival city even when its timezone equals the home timezone with %s planning', planningMode => {
    const plan = generatePlan({ ...itinerary, legs: [flight] }, {
      ...DEFAULT_PREFERENCES, homeTimeZone: 'America/Los_Angeles', preparationDays: 0, planningMode,
    });
    const day = groupPlanDays(plan.days).find(day => day.date === '2026-10-20')!;
    expect(day.stage).toBe('home');
    expect(day.label).toBe('Stay in San Francisco');
    expect(planDayCity(day)).toBe('San Francisco');
    expect(day.timeZone).toBe('America/Los_Angeles');
  }, 30_000);
});
