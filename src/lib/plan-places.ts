import { findAirport } from './airports';
import type { PlanAction, PlanDay } from './types';

/** A time-zone identifier describes clock rules, not the traveler's city. */
export function airportCityName(code: string | undefined): string | undefined {
  return code ? findAirport(code)?.city.trim() || undefined : undefined;
}

export function stayPlaceLabel(airport: string, destination: boolean): string {
  const city = airportCityName(airport);
  return city ? `${destination ? 'Stay' : 'Connection'} in ${city}` : destination ? 'Stay at destination' : 'Connection';
}

/** The itinerary supplies this place independently of the clock used for timing. */
export function planDayCity(day: Pick<PlanDay, 'locationAirport' | 'stage'>): string {
  return airportCityName(day.locationAirport) ?? (day.stage === 'preparation' ? 'Departure city' : 'Destination');
}

export function actionCity(action: PlanAction, days: PlanDay[]): string {
  const day = days.find(day => day.actions.some(item => item.id === action.id));
  if (!day) return 'Local time';
  const segment = day.travelSegments?.filter(segment => action.timeZone === segment.arrivalTimeZone
    && Date.parse(action.start) >= Date.parse(segment.departure)).at(-1);
  return segment ? airportCityName(segment.arrivalAirport) ?? 'Destination' : planDayCity(day);
}
