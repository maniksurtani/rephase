import type { AppData } from '../src/lib/types';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: RecordValue, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const knownKeys = (value: RecordValue, required: string[], optional: string[]) => required.every((key) => Object.hasOwn(value, key))
  && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0);
const choice = (value: unknown, options: string[]) => typeof value === 'string' && options.includes(value);
const time = (value: unknown) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const airport = (value: unknown) => typeof value === 'string' && (value === '' || /^[A-Z0-9]{3,4}$/.test(value));
const identity = (value: unknown): value is string => text(value, 80) && /^[A-Za-z0-9_-]+$/.test(value);

function timeZone(value: unknown): boolean {
  if (!text(value, 80)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}

function localDateTime(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return false;
  const date = new Date(`${value}Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, value.length) === value;
}

function timestamp(value: unknown): boolean {
  return typeof value === 'string' && value.length <= 40
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

/** Validate the persisted contract, without accepting IDs or arbitrary server-owned fields. */
export function validateAppData(value: unknown): string | null {
  if (!record(value) || !exactKeys(value, ['schemaVersion', 'preferences', 'trips', 'selectedTripId']) || value.schemaVersion !== 1) {
    return 'Unsupported saved-data schema.';
  }
  const p = value.preferences;
  const preferenceKeys = ['homeTimeZone', 'chronotype', 'usualBedtime', 'usualWakeTime', 'preferredBedtime', 'preferredWakeTime',
    'sleepHours', 'sleepAnchor', 'caffeine', 'melatonin', 'melatoninAcknowledged', 'preparationDays'];
  if (!record(p) || !exactKeys(p, preferenceKeys) || !timeZone(p.homeTimeZone)
    || !choice(p.chronotype, ['early', 'intermediate', 'late', 'unsure'])
    || ![p.usualBedtime, p.usualWakeTime, p.preferredBedtime, p.preferredWakeTime].every(time)
    || typeof p.sleepHours !== 'number' || !Number.isFinite(p.sleepHours) || p.sleepHours < 4 || p.sleepHours > 12
    || !choice(p.sleepAnchor, ['wake', 'bed'])
    || ![p.caffeine, p.melatonin, p.melatoninAcknowledged].every((item) => typeof item === 'boolean')
    || !Number.isInteger(p.preparationDays) || (p.preparationDays as number) < 0 || (p.preparationDays as number) > 7) {
    return 'Saved preferences contain an invalid value.';
  }
  if (!Array.isArray(value.trips) || value.trips.length > 100) return 'Save at most 100 trips.';
  const tripIds = new Set<string>();
  for (const trip of value.trips) {
    if (!record(trip) || !exactKeys(trip, ['id', 'name', 'legs', 'createdAt', 'updatedAt']) || !identity(trip.id)
      || tripIds.has(trip.id) || !text(trip.name, 120) || !timestamp(trip.createdAt) || !timestamp(trip.updatedAt)
      || !Array.isArray(trip.legs) || trip.legs.length > 40) return 'Saved trip details are invalid.';
    tripIds.add(trip.id);
    const legIds = new Set<string>();
    for (const leg of trip.legs) {
      const keys = ['id', 'flightNumber', 'departureAirport', 'arrivalAirport', 'departureDateTime', 'arrivalDateTime',
        'departureTimeZone', 'arrivalTimeZone', 'stayAfter', 'strategy'];
      if (!record(leg) || !knownKeys(leg, keys, ['travelClass', 'lieFlat']) || !identity(leg.id) || legIds.has(leg.id)
        || !text(leg.flightNumber, 24, true) || !airport(leg.departureAirport) || !airport(leg.arrivalAirport)
        || !localDateTime(leg.departureDateTime) || !localDateTime(leg.arrivalDateTime)
        || !timeZone(leg.departureTimeZone) || !timeZone(leg.arrivalTimeZone)
        || !choice(leg.stayAfter, ['connection', 'destination']) || !choice(leg.strategy, ['adapt', 'partial', 'home'])
        || (Object.hasOwn(leg, 'travelClass') && !choice(leg.travelClass, ['economy', 'premium-economy', 'business', 'first']))
        || (Object.hasOwn(leg, 'lieFlat') && typeof leg.lieFlat !== 'boolean')) {
        return 'Saved flight details contain an invalid value.';
      }
      legIds.add(leg.id);
    }
  }
  if (value.selectedTripId !== null && (typeof value.selectedTripId !== 'string' || !tripIds.has(value.selectedTripId))) {
    return 'The selected trip does not exist.';
  }
  return null;
}

export function isAppData(value: unknown): value is AppData { return validateAppData(value) === null; }
