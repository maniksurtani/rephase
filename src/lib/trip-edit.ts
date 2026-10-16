import type { Trip } from './types';

function sortedFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedFields);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, field]) => [key, sortedFields(field)]),
    );
  }
  return value;
}

/** Compare content too: timestamps alone cannot distinguish concurrent edits. */
export function tripEditConflict(
  baseline: Trip | null,
  current: Trip | undefined,
): 'changed' | 'deleted' | null {
  if (!baseline) return null;
  if (!current) return 'deleted';
  return JSON.stringify(sortedFields(baseline)) === JSON.stringify(sortedFields(current))
    ? null
    : 'changed';
}
