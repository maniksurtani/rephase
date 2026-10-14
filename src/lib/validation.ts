import type { AppData } from './types';
import { Temporal } from '@js-temporal/polyfill';
import { localToInstant } from './time';

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

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  try { Temporal.Instant.from(value); return Number.isFinite(Date.parse(value)); } catch { return false; }
}
function optional(record: RecordValue, key: string, validator: (v: unknown) => boolean): boolean {
  return !Object.hasOwn(record, key) || validator(record[key]);
}
function flightInterval(leg: RecordValue): boolean {
  try {
    const departure = localToInstant(leg.departureDateTime as string, leg.departureTimeZone as string, leg.departureDisambiguation as 'earlier' | 'later' | undefined);
    const arrival = localToInstant(leg.arrivalDateTime as string, leg.arrivalTimeZone as string, leg.arrivalDisambiguation as 'earlier' | 'later' | undefined);
    if (arrival <= departure || arrival - departure > 36 * 3_600_000) return false;
    const takeoff = Object.hasOwn(leg, 'takeoffDateTime') ? localToInstant(leg.takeoffDateTime as string, leg.departureTimeZone as string, leg.departureDisambiguation as 'earlier' | 'later' | undefined) : departure;
    const landing = Object.hasOwn(leg, 'landingDateTime') ? localToInstant(leg.landingDateTime as string, leg.arrivalTimeZone as string, leg.arrivalDisambiguation as 'earlier' | 'later' | undefined) : arrival;
    return takeoff >= departure && landing <= arrival && landing > takeoff;
  } catch { return false; }
}
function adherenceRecords(value: unknown, tripId: string): boolean {
  if (!Array.isArray(value) || value.length > 1500) return false;
  const ids = new Set<string>();
  for (const entry of value) {
    if (!record(entry) || !knownKeys(entry, ['id', 'tripId', 'actionId', 'type', 'scheduledStart', 'scheduledEnd', 'timeZone', 'status', 'recordedAt'], ['actualStart', 'actualEnd'])
      || !identity(entry.id) || ids.has(entry.id) || entry.tripId !== tripId || !text(entry.actionId, 200)
      || !choice(entry.type, ['sleep', 'light', 'avoid-light', 'caffeine', 'melatonin'])
      || !choice(entry.status, ['completed', 'missed', 'partial']) || !timeZone(entry.timeZone)
      || !timestamp(entry.scheduledStart) || !timestamp(entry.scheduledEnd) || !timestamp(entry.recordedAt)
      || !optional(entry, 'actualStart', timestamp) || !optional(entry, 'actualEnd', timestamp)
      || Date.parse(entry.scheduledEnd) < Date.parse(entry.scheduledStart)
      || Date.parse(entry.scheduledEnd) - Date.parse(entry.scheduledStart) > 48 * 3_600_000
      || (typeof entry.actualStart === 'string' && typeof entry.actualEnd === 'string' && Date.parse(entry.actualEnd) < Date.parse(entry.actualStart))) return false;
    ids.add(entry.id);
  }
  return true;
}

/** Validate the persisted contract, without accepting IDs or arbitrary server-owned fields. */
export function validateAppData(value: unknown): string | null {
  if (!record(value) || !exactKeys(value, ['schemaVersion', 'preferences', 'trips', 'selectedTripId']) || value.schemaVersion !== 1) {
    return 'Unsupported saved-data schema.';
  }
  const p = value.preferences;
  const preferenceKeys = ['homeTimeZone', 'chronotype', 'usualBedtime', 'usualWakeTime', 'preferredBedtime', 'preferredWakeTime',
    'sleepHours', 'sleepAnchor', 'caffeine', 'melatonin', 'melatoninAcknowledged', 'preparationDays'];
  if (!record(p) || !knownKeys(p, preferenceKeys, ['planningMode', 'autoSync', 'calendarAlarms']) || !timeZone(p.homeTimeZone)
    || !choice(p.chronotype, ['early', 'intermediate', 'late', 'unsure'])
    || ![p.usualBedtime, p.usualWakeTime, p.preferredBedtime, p.preferredWakeTime].every(time)
    || typeof p.sleepHours !== 'number' || !Number.isFinite(p.sleepHours) || p.sleepHours < 4 || p.sleepHours > 12
    || !choice(p.sleepAnchor, ['wake', 'bed'])
    || !optional(p, 'planningMode', value => choice(value, ['rules', 'model']))
    || !optional(p, 'autoSync', value => typeof value === 'boolean')
    || !optional(p, 'calendarAlarms', value => typeof value === 'boolean')
    || ![p.caffeine, p.melatonin, p.melatoninAcknowledged].every((item) => typeof item === 'boolean')
    || !Number.isInteger(p.preparationDays) || (p.preparationDays as number) < 0 || (p.preparationDays as number) > 7) {
    return 'Saved preferences contain an invalid value.';
  }
  if (!Array.isArray(value.trips) || value.trips.length > 100) return 'Save at most 100 trips.';
  const tripIds = new Set<string>();
  for (const trip of value.trips) {
    if (!record(trip) || !knownKeys(trip, ['id', 'name', 'legs', 'createdAt', 'updatedAt'], ['adherence']) || !identity(trip.id)
      || tripIds.has(trip.id) || !text(trip.name, 120) || !timestamp(trip.createdAt) || !timestamp(trip.updatedAt)
      || !Array.isArray(trip.legs) || trip.legs.length > 40
      || !optional(trip, 'adherence', value => adherenceRecords(value, trip.id as string))) return 'Saved trip details are invalid.';
    tripIds.add(trip.id);
    const legIds = new Set<string>();
    for (const leg of trip.legs) {
      const keys = ['id', 'flightNumber', 'departureAirport', 'arrivalAirport', 'departureDateTime', 'arrivalDateTime',
        'departureTimeZone', 'arrivalTimeZone', 'stayAfter', 'strategy'];
      if (!record(leg) || !knownKeys(leg, keys, ['travelClass', 'lieFlat', 'departureDisambiguation', 'arrivalDisambiguation', 'takeoffDateTime', 'landingDateTime', 'taxiOutMinutes', 'taxiInMinutes', 'flightSource', 'flightFetchedAt', 'providerRecordConfirmed']) || !identity(leg.id) || legIds.has(leg.id)
        || !text(leg.flightNumber, 24, true) || !airport(leg.departureAirport) || !airport(leg.arrivalAirport)
        || !localDateTime(leg.departureDateTime) || !localDateTime(leg.arrivalDateTime)
        || !timeZone(leg.departureTimeZone) || !timeZone(leg.arrivalTimeZone)
        || !choice(leg.stayAfter, ['connection', 'destination']) || !choice(leg.strategy, ['adapt', 'partial', 'home'])
        || (Object.hasOwn(leg, 'travelClass') && !choice(leg.travelClass, ['economy', 'premium-economy', 'business', 'first']))
        || (Object.hasOwn(leg, 'lieFlat') && typeof leg.lieFlat !== 'boolean')
        || !optional(leg, 'departureDisambiguation', value => choice(value, ['earlier', 'later']))
        || !optional(leg, 'arrivalDisambiguation', value => choice(value, ['earlier', 'later']))
        || !optional(leg, 'takeoffDateTime', localDateTime) || !optional(leg, 'landingDateTime', localDateTime)
        || !optional(leg, 'taxiOutMinutes', value => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 180)
        || !optional(leg, 'taxiInMinutes', value => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 180)
        || !optional(leg, 'flightSource', value => choice(value, ['manual', 'aerodatabox']))
        || !optional(leg, 'flightFetchedAt', timestamp)
        || !optional(leg, 'providerRecordConfirmed', value => typeof value === 'boolean')
        || (leg.flightSource === 'aerodatabox' && (leg.providerRecordConfirmed !== true || !timestamp(leg.flightFetchedAt)))
        || !flightInterval(leg)) {
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
