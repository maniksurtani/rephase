import { describe, expect, it } from 'vitest';
import { createEmptyTrip } from '../src/lib/defaults';
import { tripEditConflict } from '../src/lib/trip-edit';

describe('open trip editor baseline', () => {
  it('blocks changed flight details even when timestamps match, and a remotely deleted trip', () => {
    const baseline = createEmptyTrip();
    const current = structuredClone(baseline);
    current.legs[0].departureDateTime = '2026-10-17T12:30';
    expect(tripEditConflict(baseline, current)).toBe('changed');
    expect(tripEditConflict(baseline, undefined)).toBe('deleted');
  });

  it('allows unchanged content regardless of object field order, or a newly created trip', () => {
    const baseline = createEmptyTrip();
    const { name, ...rest } = structuredClone(baseline);
    expect(tripEditConflict(baseline, { ...rest, name })).toBeNull();
    expect(tripEditConflict(null, undefined)).toBeNull();
  });
});
