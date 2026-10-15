import { localToInstant } from './time';
import type { FlightLeg, TravelClass, Trip } from './types';

export interface LoungeOpportunity {
  id: string;
  legId: string;
  airport: string;
  kind: 'pre-flight' | 'transit';
  /** Assumed usable lounge window, as UTC instants. */
  start: string;
  end: string;
  departure: string;
  timeZone: string;
  flightNumber: string;
  destinationAirport: string;
  travelClass: TravelClass;
  minutes: number;
  note: string;
}

// The airport catalog does not include countries. Keep this small, explicit map
// independent of timezone names: an unknown route gets international buffers.
const COUNTRY_AIRPORTS: Record<string, readonly string[]> = {
  AU: ['SYD', 'MEL', 'BNE', 'PER', 'ADL', 'CBR', 'CNS', 'OOL', 'HBA', 'DRW', 'LST', 'ASP', 'AYQ'],
  US: ['SFO', 'HNL', 'LAX', 'JFK', 'EWR', 'BOS', 'ORD', 'DFW', 'ATL', 'MIA', 'SEA', 'SJC', 'OAK',
    'SAN', 'IAD', 'DCA', 'LAS', 'DEN', 'PDX', 'IAH', 'AUS', 'PHX', 'ANC', 'MSP', 'PHL', 'CLT', 'FLL', 'DTW', 'SLC', 'MCO', 'KOA', 'OGG', 'LIH'],
  NZ: ['AKL', 'WLG', 'CHC', 'ZQN'],
  GB: ['LHR', 'LGW', 'MAN', 'EDI', 'STN', 'LCY', 'BHX', 'GLA'],
  CA: ['YYZ', 'YVR', 'YUL', 'YYC', 'YOW'],
  JP: ['HND', 'NRT', 'KIX', 'ITM'],
  SG: ['SIN'],
  HK: ['HKG'],
  AE: ['DXB', 'AUH'],
  QA: ['DOH'],
  FR: ['CDG', 'ORY'],
  DE: ['FRA', 'MUC'],
};
const countries = new Map(Object.entries(COUNTRY_AIRPORTS)
  .flatMap(([country, airports]) => airports.map(airport => [airport, country] as const)));
const MINUTE = 60_000;

export function airportCountry(airport: string): string | undefined {
  return countries.get(airport.trim().toUpperCase());
}

function isDomestic(leg: FlightLeg): boolean {
  const country = airportCountry(leg.departureAirport);
  return country !== undefined && country === airportCountry(leg.arrivalAirport);
}

interface TimedLeg { departure: number; arrival: number }

function timedLeg(leg: FlightLeg): TimedLeg | undefined {
  try {
    const departure = localToInstant(leg.departureDateTime, leg.departureTimeZone, leg.departureDisambiguation);
    const arrival = localToInstant(leg.arrivalDateTime, leg.arrivalTimeZone, leg.arrivalDisambiguation);
    return arrival > departure ? { departure, arrival } : undefined;
  } catch {
    // Invalid dates, nonexistent clocks and unresolved DST folds cannot establish
    // a usable airport visit. Do not silently invent an instant for these trips.
    return undefined;
  }
}

/**
 * Airport visit suggestions, independent of circadian recommendations. These
 * windows reserve time for airport formalities and boarding; they do not claim
 * that the traveler has arrived or that any particular lounge can be reached.
 */
export function buildLoungeOpportunities(trip: Trip): LoungeOpportunity[] {
  const times = trip.legs.map(timedLeg);
  const opportunities: LoungeOpportunity[] = [];

  trip.legs.forEach((leg, index) => {
    const timing = times[index];
    const airport = leg.departureAirport.trim().toUpperCase();
    const destinationAirport = leg.arrivalAirport.trim().toUpperCase();
    if (!timing || !/^[A-Z]{3}$/.test(airport) || !/^[A-Z]{3}$/.test(destinationAirport)) return;

    const previous = trip.legs[index - 1];
    const previousTiming = times[index - 1];
    // A prior leg with unknown or overlapping timing cannot establish that the
    // traveler has reached the next airport, even if the stay is a destination.
    if (previous && (!previousTiming || previousTiming.arrival >= timing.departure)) return;

    const domestic = isDomestic(leg);
    const boardingMinutes = domestic ? 30 : 45;
    const end = timing.departure - boardingMinutes * MINUTE;
    let start: number;
    let kind: LoungeOpportunity['kind'];
    let note: string;

    if (previous?.stayAfter === 'connection') {
      // Cross-airport transfers and long stopovers need additional information.
      // In particular, do not fall back to a presumed pre-flight arrival when a
      // connection is too short to offer a useful lounge visit.
      if (previous.arrivalAirport.trim().toUpperCase() !== airport || !previousTiming
        || timing.departure - previousTiming.arrival > 12 * 60 * MINUTE) return;
      const clearanceMinutes = isDomestic(previous) ? 30 : 60;
      start = previousTiming.arrival + clearanceMinutes * MINUTE;
      kind = 'transit';
      note = `Assumes ${clearanceMinutes} minutes for arrival formalities and leaves ${boardingMinutes} minutes before departure for boarding.`;
    } else {
      const arrivalMinutes = domestic ? 120 : 180;
      start = timing.departure - arrivalMinutes * MINUTE;
      // A short destination stay must not imply being in the lounge while the
      // preceding flight is still airborne or clearing arrival formalities.
      if (previous && previousTiming && previous.arrivalAirport.trim().toUpperCase() === airport) {
        start = Math.max(start, previousTiming.arrival + (isDomestic(previous) ? 30 : 60) * MINUTE);
      }
      kind = 'pre-flight';
      note = `Assumes airport arrival ${arrivalMinutes / 60} hours before departure; adjust the visit time in Lounge Explorer. Leaves ${boardingMinutes} minutes for boarding.`;
    }

    const minutes = Math.floor((end - start) / MINUTE);
    if (minutes < 60) return;
    opportunities.push({
      id: `${leg.id}:${kind}`, legId: leg.id, airport, kind,
      start: new Date(start).toISOString(), end: new Date(end).toISOString(),
      departure: new Date(timing.departure).toISOString(), timeZone: leg.departureTimeZone,
      flightNumber: leg.flightNumber, destinationAirport, travelClass: leg.travelClass ?? 'economy',
      minutes, note,
    });
  });

  return opportunities;
}
