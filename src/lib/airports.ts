import airportData from './airport-catalog.js';

export interface Airport {
  code: string;
  name: string;
  city: string;
  timeZone: string;
  latitude?: number;
  longitude?: number;
}

// Pinned MIT airportsdata snapshot. See DATA_SOURCES.md for attribution and regeneration.
// Sorted by IATA code so search results and server normalization remain deterministic.
export const AIRPORTS: Airport[] = airportData;
const airportsByCode = new Map(AIRPORTS.map(airport => [airport.code, airport]));

export const findAirport = (code: string): Airport | undefined => airportsByCode.get(code.trim().toUpperCase());
