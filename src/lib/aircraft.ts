import type { AircraftType } from './types';

/** Saved/imported aircraft metadata is bounded and never contains tracking fields. */
export function isAircraftType(value: unknown): value is AircraftType {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return (
    Object.keys(object).length === 1 &&
    Object.hasOwn(object, 'model') &&
    typeof object.model === 'string' &&
    object.model.length > 0 &&
    object.model.length <= 120 &&
    object.model.trim() === object.model &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(object.model)
  );
}

export function aircraftLabel(aircraft?: AircraftType): string | null {
  return aircraft?.model ?? null;
}
