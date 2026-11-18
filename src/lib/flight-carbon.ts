import { findAirport } from './airports';
import type { TravelClass } from './types';

export const CARBON_METHODOLOGY_URL = '/science.html#flight-carbon';
export const CARBON_METHOD = 'myclimate-standard-2023-v1';

// Published standard-aircraft parameters, checked 2026-11-18. See DATA_SOURCES.md.
const SHORT = { a: 0.000007, b: 2.775, c: 1260.608, seats: 157.86, load: 0.796 };
const LONG = { a: 0.00029, b: 3.475, c: 3259.691, seats: 302.58, load: 0.82 };
const CABINS: Record<TravelClass, { label: string; short: number; long: number }> = {
  economy: { label: 'Economy', short: 1, long: 1 },
  'premium-economy': { label: 'Premium economy', short: 1, long: 1.5 },
  business: { label: 'Business', short: 1.5, long: 4 },
  first: { label: 'First', short: 1.5, long: 5 },
};

/** Great-circle distance in km; independent of local dates, flight time and date-line crossings. */
export function flightDistanceKm(departureAirport: string, arrivalAirport: string): number | null {
  const origin = findAirport(departureAirport),
    destination = findAirport(arrivalAirport);
  if (!origin || !destination || origin.code === destination.code) return null;
  const points = [origin, destination];
  if (
    points.some(
      (p) =>
        !Number.isFinite(p.latitude) ||
        !Number.isFinite(p.longitude) ||
        Math.abs(p.latitude!) > 90 ||
        Math.abs(p.longitude!) > 180,
    )
  )
    return null;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = radians(origin.latitude!),
    lat2 = radians(destination.latitude!);
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(radians(destination.longitude! - origin.longitude!) / 2) ** 2;
  const distance = 2 * 6371.0088 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
  return distance > 0 ? distance : null;
}

/** Published fleet-average model, per passenger and per flight leg; no measured aircraft fuel data. */
export function carbonForDistance(distanceKm: number, cabin: TravelClass = 'economy') {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  const weights = CABINS[cabin];
  if (!weights) return null;
  const x = distanceKm + 95;
  const fuel = (p: typeof SHORT, weight: number) =>
    ((p.a * x * x + p.b * x + p.c) / (p.seats * p.load)) * 0.74 * weight;
  // Interpolate complete estimates at the same corrected distance, not the coefficients.
  const blend = Math.max(0, Math.min(1, (x - 1500) / 1000));
  const passengerFuelKg =
    fuel(SHORT, weights.short) * (1 - blend) + fuel(LONG, weights.long) * blend;
  return {
    co2Kg: passengerFuelKg * 3.16,
    climateImpactKgCo2e: passengerFuelKg * (3.16 * 3 + 0.538) + 0.00034 * x + 11.68,
  };
}

const massLabel = (kg: number) =>
  kg >= 1000
    ? `${(kg / 1000).toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`
    : `${Math.max(1, Math.round(kg / 10) * 10).toLocaleString('en')} kg`;

/** Shared presentation keeps web and native units, rounding and assumptions identical. */
export function flightCarbonFootprint(flight: {
  departureAirport: string;
  arrivalAirport: string;
  travelClass?: TravelClass;
}) {
  const distanceKm = flightDistanceKm(flight.departureAirport, flight.arrivalAirport);
  const cabin = flight.travelClass ?? 'economy';
  const estimate = distanceKm === null ? null : carbonForDistance(distanceKm, cabin);
  if (!estimate || distanceKm === null) return null;
  return {
    ...estimate,
    method: CARBON_METHOD,
    distanceKm,
    cabin,
    cabinAssumed: flight.travelClass === undefined,
    cabinLabel: `${CABINS[cabin].label}${flight.travelClass === undefined ? ' (assumed)' : ''}`,
    climateImpactLabel: `≈ ${massLabel(estimate.climateImpactKgCo2e)} CO₂e`,
    co2Label: `≈ ${massLabel(estimate.co2Kg)} CO₂`,
  };
}
