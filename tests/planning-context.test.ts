import { describe, expect, it } from 'vitest';
import { createPlanningContext } from '../src/lib/planning-airports';
import { createDemoTrip } from '../src/lib/defaults';
import { planningStayLabel } from '../src/lib/planning-context';

describe('planner geography boundary', () => {
  it('transfers only itinerary locations with real city/solar metadata and leaves unknown locations unknown', () => {
    const trip = createDemoTrip();
    trip.legs = [{ ...trip.legs[0], departureAirport: ' sfo ', arrivalAirport: 'ZZZ' }];
    const context = structuredClone(createPlanningContext(trip));
    expect(Object.keys(context.airports)).toEqual(['SFO']);
    expect(context.airports.SFO).toMatchObject({
      city: 'San Francisco',
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    });
    expect(planningStayLabel(context, 'SFO', true)).toBe('Stay in San Francisco');
    expect(planningStayLabel(context, 'ZZZ', true)).toBe('Stay at destination');
  });
});
