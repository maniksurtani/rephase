import { describe, expect, it } from 'vitest';
import {
  carbonForDistance,
  flightCarbonFootprint,
  flightDistanceKm,
} from '../src/lib/flight-carbon';

describe('per-passenger flight carbon estimates', () => {
  // Independent Decimal calculations from the published standard-aircraft formula.
  it.each([
    [1000, 'economy', 80.1625720744, 266.1879477979],
    [1905, 'business', 309.7575419217, 994.3698275226],
    [10000, 'economy', 639.8711097239, 2043.6657105106],
    [10000, 'business', 2559.4844388954, 8129.3259420425],
  ] as const)('matches the reference for %s km in %s', (km, cabin, co2, climate) => {
    const result = carbonForDistance(km, cabin)!;
    expect(result.co2Kg).toBeCloseTo(co2, 7);
    expect(result.climateImpactKgCo2e).toBeCloseTo(climate, 7);
  });

  it('is continuous at both corrected-distance band boundaries', () => {
    for (const km of [1405, 2405]) {
      for (const cabin of ['economy', 'premium-economy', 'business', 'first'] as const) {
        const below = carbonForDistance(km - 0.0001, cabin)!;
        const above = carbonForDistance(km + 0.0001, cabin)!;
        expect(Math.abs(above.climateImpactKgCo2e - below.climateImpactKgCo2e)).toBeLessThan(0.001);
      }
    }
  });

  it('uses the short great-circle path across the Pacific and is direction independent', () => {
    const distance = flightDistanceKm('SYD', 'LAX')!;
    expect(distance).toBeGreaterThan(12000);
    expect(distance).toBeLessThan(12200);
    expect(flightDistanceKm('lax', ' syd ')).toBeCloseTo(distance, 8);
    expect(flightDistanceKm('HNL', 'NRT')).toBeGreaterThan(6000);
    expect(flightDistanceKm('HNL', 'NRT')).toBeLessThan(6500);
    expect(flightDistanceKm('SFO', 'LAX')).toBeGreaterThan(500);
    expect(flightDistanceKm('SFO', 'LAX')).toBeLessThan(600);
  });

  it('never fabricates a zero or NaN footprint for missing or invalid route data', () => {
    for (const km of [0, -1, NaN, Infinity]) expect(carbonForDistance(km)).toBeNull();
    for (const arrivalAirport of ['ZZZ', 'SFO']) {
      expect(flightCarbonFootprint({ departureAirport: 'SFO', arrivalAirport })).toBeNull();
    }
  });

  it('labels a missing cabin assumption and rounds kilograms/tonnes consistently', () => {
    const local = flightCarbonFootprint({ departureAirport: 'SFO', arrivalAirport: 'LAX' })!;
    expect(local.cabinLabel).toBe('Economy (assumed)');
    expect(local.climateImpactLabel).toMatch(/^≈ \d+ kg CO₂e$/);
    const long = flightCarbonFootprint({
      departureAirport: 'SYD',
      arrivalAirport: 'LAX',
      travelClass: 'business',
    })!;
    expect(long.cabinAssumed).toBe(false);
    expect(long.cabinLabel).toBe('Business');
    expect(long.climateImpactLabel).toMatch(/^≈ \d+\.\d t CO₂e$/);
    expect(long.co2Kg).toBeLessThan(long.climateImpactKgCo2e);
  });
});
