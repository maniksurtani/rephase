import { Temporal } from '@js-temporal/polyfill';
import { dateInZone } from './time';
import type { Preferences, Trip } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
type Range = { start: number; end: number };
export type SleepChoice = 'routine' | 'extended';

const clock = (date: string, time: string, zone: string) =>
  Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(zone, {
    disambiguation: 'compatible',
  }).epochMilliseconds;
const addDate = (date: string, days: number) =>
  Temporal.PlainDate.from(date).add({ days }).toString();

/** A newly entered trip cannot supply days of imaginary preparation. Reported
 * past exposure may predate an imported trip's creation, and remains usable. */
export function availablePreparationStart(
  trip: Trip,
  requested: number,
  departure: number,
  now = Date.now(),
): number {
  let available = Date.parse(trip.createdAt);
  if (!Number.isFinite(available)) return requested;
  for (const record of trip.adherence ?? []) {
    if (
      record.tripId !== trip.id ||
      !['sleep', 'light', 'avoid-light'].includes(record.type) ||
      !['completed', 'partial'].includes(record.status) ||
      !(Date.parse(record.recordedAt) <= now)
    )
      continue;
    const actual = record.actualStart && record.actualEnd;
    const start = Date.parse(actual ? record.actualStart! : record.scheduledStart);
    const end = Date.parse(actual ? record.actualEnd! : record.scheduledEnd);
    if (Number.isFinite(start) && end > start) available = Math.min(available, start);
  }
  // Retrospective entry must still retain the flights themselves.
  return Math.max(requested, Math.min(available, departure));
}

/** Civil sleep opportunities are constraints on the light-driven model, not a
 * direct translation of estimated biological phase into an alarm clock.
 * Extension limits and the disruption score are product heuristics, not rates
 * of physiological adaptation or a claim that all time in bed is spent asleep. */
export function groundSleepSchedule(
  range: Range,
  prefs: Preferences,
  options: {
    zone: string;
    preparation: boolean;
    direction: 'advance' | 'delay';
    choice: SleepChoice;
    routeHours: number;
  },
): { sleeps: Range[]; disruptionHours: number } {
  const sleeps: Range[] = [];
  const zone = options.preparation ? prefs.homeTimeZone : options.zone;
  let date = addDate(dateInZone(range.start, zone), -1);
  const lastDate = addDate(dateInZone(range.end, zone), 1);
  let disruptionHours = 0;
  while (date <= lastDate) {
    let start: number, end: number;
    if (options.preparation) {
      end = clock(date, prefs.usualWakeTime, zone);
      const bedDate = prefs.usualBedtime < prefs.usualWakeTime ? date : addDate(date, -1);
      const bed = clock(bedDate, prefs.usualBedtime, zone);
      const habit = (end - bed) / HOUR;
      start =
        habit >= 4 && habit <= 12
          ? Math.min(bed, end - prefs.sleepHours * HOUR)
          : end - prefs.sleepHours * HOUR;
    } else if (prefs.sleepAnchor === 'wake') {
      end = clock(date, prefs.preferredWakeTime, zone);
      start = end - prefs.sleepHours * HOUR;
    } else {
      start = clock(date, prefs.preferredBedtime, zone);
      end = start + prefs.sleepHours * HOUR;
    }
    // An early departure can require an earlier wake-up. Move the bedtime as
    // well when the available evening permits, rather than quietly cutting
    // hours off the night. This is a flight constraint, not a phase shift.
    const flightLimited = options.preparation && start < range.end && end > range.end;
    if (flightLimited) {
      end = range.end;
      start = Math.min(start, end - prefs.sleepHours * HOUR);
    }
    let extra = 0;
    const earlierBed =
      options.direction === 'advance' && (options.preparation || prefs.sleepAnchor === 'wake');
    const laterWake =
      !options.preparation && options.direction === 'delay' && prefs.sleepAnchor === 'bed';
    if (options.choice === 'extended' && !flightLimited && (earlierBed || laterWake)) {
      const nightsAvailable = Math.max(0, Math.ceil((start - range.start) / DAY));
      const limit = options.preparation ? Math.min(2, nightsAvailable) : 1;
      extra = Math.max(0, Math.min(limit, options.routeHours, 12 - (end - start) / HOUR));
      // Do not ask for an earlier bedtime that has already passed at plan start.
      if (earlierBed) extra = Math.min(extra, Math.max(0, (start - range.start) / HOUR));
      extra = Math.floor(extra * 4) / 4;
    }
    if (earlierBed) start -= extra * HOUR;
    else if (laterWake) end += extra * HOUR;
    if (start < range.end && end > range.start) {
      sleeps.push({ start, end });
      const covered = Math.min(range.end, end) - Math.max(range.start, start);
      disruptionHours += (extra * covered) / (end - start);
    }
    date = addDate(date, 1);
  }
  return { sleeps, disruptionHours };
}

export function groundSleepDetail(hours: number, preparation: boolean): string {
  return preparation
    ? `Aim for ${hours} hours of sleep. Extra time allows for sleep or quiet rest; keep your usual wake time unless your flight requires an earlier start.`
    : `Aim for ${hours} hours of sleep within this window. Rest in dim light if you are not asleep for the whole period.`;
}
