import { localToInstant } from './time';
import type { FlightLeg } from './types';

/** Gate schedule and airborne schedule are different: default taxi allowances are conservative estimates. */
export function flightAirborneTiming(leg: FlightLeg): { takeoff: number; landing: number } {
  const departure = localToInstant(
    leg.departureDateTime,
    leg.departureTimeZone,
    leg.departureDisambiguation,
  );
  const arrival = localToInstant(
    leg.arrivalDateTime,
    leg.arrivalTimeZone,
    leg.arrivalDisambiguation,
  );
  return {
    takeoff: leg.takeoffDateTime
      ? localToInstant(leg.takeoffDateTime, leg.departureTimeZone, leg.departureDisambiguation)
      : departure + (leg.taxiOutMinutes ?? 30) * 60_000,
    landing: leg.landingDateTime
      ? localToInstant(leg.landingDateTime, leg.arrivalTimeZone, leg.arrivalDisambiguation)
      : arrival - (leg.taxiInMinutes ?? 30) * 60_000,
  };
}
