import type { FlightLeg } from './types';

/** Editor-only state; a saved or explicitly entered arrival is never an automatic default. */
export type ArrivalDefaultState = { mode: 'automatic'; value: string } | { mode: 'manual' };

/** Keep provider precision in stored data while presenting editable minute-resolution clocks. */
export function minuteDateTimeValue(value?: string): string {
  return value?.slice(0, 16) ?? '';
}

export function departureTimeEdit(
  leg: Pick<FlightLeg, 'arrivalDateTime' | 'flightSource'>,
  departureDateTime: string,
  state?: ArrivalDefaultState,
): { patch: Partial<FlightLeg>; state: ArrivalDefaultState } {
  const followsDefault = state?.mode === 'automatic' && leg.arrivalDateTime === state.value;
  const untouchedEmpty = state === undefined && !leg.arrivalDateTime;
  if (leg.flightSource !== 'aerodatabox' && (followsDefault || untouchedEmpty)) {
    return {
      // This is a wall-clock starting point only. The user still confirms arrival and chronology.
      patch: { departureDateTime, arrivalDateTime: departureDateTime },
      state: { mode: 'automatic', value: departureDateTime },
    };
  }
  return { patch: { departureDateTime }, state: { mode: 'manual' } };
}
