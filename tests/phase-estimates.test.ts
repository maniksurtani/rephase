import { describe, expect, it } from 'vitest';
import { generateModelPlan } from '../src/lib/model-plan';
import { DEFAULT_PREFERENCES, createDemoTrip } from '../src/lib/defaults';
import itinerary from './fixtures/itineraries/oct2026.json';
import type { AdherenceRecord, Trip } from '../src/lib/types';

const trip = itinerary.trip as Trip;
const preferences = { ...DEFAULT_PREFERENCES, homeTimeZone: 'Australia/Sydney' };

describe('modeled daily body-clock estimates', () => {
  const plan = generateModelPlan(trip, preferences);

  it('reports changes between successive modeled lows instead of comparing forecasts of the same low', () => {
    const changes = plan.days.filter(day => day.phaseEstimateAvailable);
    const preparation = changes.filter(day => day.stage === 'preparation');
    expect(preparation.length).toBeGreaterThanOrEqual(2);
    expect(preparation.every(day => day.phaseShiftHours > 0.25)).toBe(true);
    expect(changes.some(day => day.phaseShiftHours < -0.25)).toBe(true);
    expect(changes.every(day => Number.isFinite(day.phaseShiftHours))).toBe(true);
    expect(changes.every(day => day.note.includes('successive simulated biological low points'))).toBe(true);
    expect(changes.every(day => day.note.includes('unmeasured estimate'))).toBe(true);
  });

  it('marks a partial first day and the first low without an earlier cycle unavailable', () => {
    const initialDays = plan.days.filter(day => day.date <= '2026-10-15');
    expect(initialDays.length).toBe(2);
    expect(initialDays.every(day => day.phaseEstimateAvailable === false)).toBe(true);
    expect(initialDays.every(day => day.note.includes('No daily body-clock change is available'))).toBe(true);
  });

  it('retains small modeled changes instead of rounding them to a claimed zero', () => {
    const small = plan.days.find(day => day.date === '2026-10-26' && day.timeZone === 'Australia/Melbourne')!;
    expect(small.phaseEstimateAvailable).toBe(true);
    expect(Math.abs(small.phaseShiftHours)).toBeGreaterThan(0);
    expect(Math.abs(small.phaseShiftHours)).toBeLessThan(0.05);
  });

  it('does not attach a later or final-trip estimate to saved historical days', () => {
    const action = plan.days[0].actions[0];
    const cutoff = Date.parse(action.end) + 24 * 3_600_000;
    const record: AdherenceRecord = {
      id: 'historical-sleep', tripId: trip.id, actionId: action.id, type: action.type,
      scheduledStart: action.start, scheduledEnd: action.end, timeZone: action.timeZone,
      status: 'completed', recordedAt: new Date(cutoff).toISOString(),
    };
    const updated = generateModelPlan({ ...trip, adherence: [record] }, preferences, { now: cutoff });
    const historical = updated.days.find(day => day.actions.some(item => item.id === action.id))!;
    expect(historical.actions.find(item => item.id === action.id)?.title).toContain('Logged');
    expect(historical.phaseEstimateAvailable).toBe(false);
    expect(historical.note).toContain('Saved history; future-only replanning.');
    expect(updated.days.some(day => day.phaseEstimateAvailable === true)).toBe(true);
  }, 30_000);

  it('provides nonzero modeled changes for the built-in multi-stop example too', () => {
    const demo = generateModelPlan(createDemoTrip(), DEFAULT_PREFERENCES);
    expect(demo.days.filter(day => day.phaseEstimateAvailable && Math.abs(day.phaseShiftHours) > 0.25).length).toBeGreaterThan(3);
  }, 30_000);
});
