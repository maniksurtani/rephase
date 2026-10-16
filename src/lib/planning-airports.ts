import { findAirport } from './airports';
import type { PlanningContext } from './planning-context';
import type { Trip } from './types';

/** Resolve geographic facts on the UI thread; unknown airports remain explicitly unknown. */
export function createPlanningContext(trip: Trip): PlanningContext {
  const airports: PlanningContext['airports'] = {};
  for (const leg of trip.legs)
    for (const code of [leg.departureAirport, leg.arrivalAirport]) {
      const airport = findAirport(code);
      if (airport)
        airports[airport.code] = {
          city: airport.city,
          latitude: airport.latitude,
          longitude: airport.longitude,
        };
    }
  return { airports };
}
