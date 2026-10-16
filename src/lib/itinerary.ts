import { Temporal } from '@js-temporal/polyfill';
import { localToInstant } from './time';
import { flightAirborneTiming } from './flight-timing';
import type { Preferences, Trip } from './types';

const HOUR = 3_600_000;
const MAX_HORIZON = 90 * 24 * HOUR;

function validZone(zone: string): boolean {
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(zone);
    return true;
  } catch {
    return false;
  }
}

export function validateTrip(trip: Trip): string[] {
  const errors: string[] = [];
  if (!trip.legs?.length) return ['Add at least one flight.'];
  if (trip.legs.length > 30) return ['A trip can include up to 30 flight legs.'];
  let previousArrival: number | undefined;
  let firstDeparture: number | undefined;
  let lastArrival: number | undefined;
  const ids = new Set<string>();
  trip.legs.forEach((leg, index) => {
    const prefix = `Flight ${index + 1}`;
    if (!leg.id || ids.has(leg.id)) errors.push(`${prefix}: use a unique flight identifier.`);
    ids.add(leg.id);
    if (
      !/^[A-Z0-9]{3,4}$/.test(leg.departureAirport) ||
      !/^[A-Z0-9]{3,4}$/.test(leg.arrivalAirport)
    ) {
      errors.push(
        `${prefix}: select departure and arrival airports using a 3–4 character uppercase airport code.`,
      );
    }
    if (!['connection', 'destination'].includes(leg.stayAfter)) {
      errors.push(`${prefix}: choose a connection or destination stay.`);
    }
    if (!['adapt', 'partial', 'home'].includes(leg.strategy)) {
      errors.push(`${prefix}: choose an adaptation strategy.`);
    }
    let departure: number | undefined;
    let arrival: number | undefined;
    try {
      departure = localToInstant(
        leg.departureDateTime,
        leg.departureTimeZone,
        leg.departureDisambiguation,
      );
    } catch {
      errors.push(
        `${prefix}: departure date/time or zone is invalid, nonexistent, or ambiguous during daylight saving. Choose a valid local time; select earlier or later when that clock occurs twice.`,
      );
    }
    try {
      arrival = localToInstant(leg.arrivalDateTime, leg.arrivalTimeZone, leg.arrivalDisambiguation);
    } catch {
      errors.push(
        `${prefix}: arrival date/time or zone is invalid, nonexistent, or ambiguous during daylight saving. Choose a valid local time; select earlier or later when that clock occurs twice.`,
      );
    }
    if (departure !== undefined && arrival !== undefined) {
      if (arrival <= departure)
        errors.push(`${prefix}: arrival must follow departure in real time.`);
      for (const minutes of [leg.taxiOutMinutes, leg.taxiInMinutes]) {
        if (minutes !== undefined && (!Number.isFinite(minutes) || minutes < 0 || minutes > 180))
          errors.push(`${prefix}: taxi allowances must be between 0 and 180 minutes.`);
      }
      try {
        const airborne = flightAirborneTiming(leg);
        if (
          airborne.takeoff < departure ||
          airborne.landing > arrival ||
          (airborne.landing <= airborne.takeoff &&
            (leg.takeoffDateTime ||
              leg.landingDateTime ||
              leg.taxiOutMinutes !== undefined ||
              leg.taxiInMinutes !== undefined))
        ) {
          errors.push(
            `${prefix}: takeoff and landing must fit in gate departure/arrival order; revise airborne times or taxi allowances.`,
          );
        }
      } catch {
        errors.push(
          `${prefix}: airborne takeoff or landing time is invalid, nonexistent, or ambiguous.`,
        );
      }
      if (arrival - departure > 36 * HOUR)
        errors.push(`${prefix}: flight duration exceeds 36 hours; check dates and zones.`);
      if (previousArrival !== undefined && departure < previousArrival + HOUR / 2) {
        errors.push(
          `${prefix}: leave at least 30 minutes after the previous arrival and put flights in travel order.`,
        );
      }
      firstDeparture ??= departure;
      previousArrival = arrival;
      lastArrival = arrival;
    }
  });
  if (
    firstDeparture !== undefined &&
    lastArrival !== undefined &&
    lastArrival - firstDeparture > MAX_HORIZON
  ) {
    errors.push(
      'The trip exceeds the supported 90-day planning horizon. Split it into shorter trips.',
    );
  }
  return errors;
}

export function validatePreferences(prefs: Preferences): void {
  if (!validZone(prefs.homeTimeZone)) throw new RangeError('Select a valid home time zone.');
  for (const value of [
    prefs.usualBedtime,
    prefs.usualWakeTime,
    prefs.preferredBedtime,
    prefs.preferredWakeTime,
  ]) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
      throw new RangeError('Use valid 24-hour sleep and wake times.');
  }
  if (!Number.isFinite(prefs.sleepHours) || prefs.sleepHours < 4 || prefs.sleepHours > 12) {
    throw new RangeError('Sleep duration must be between 4 and 12 hours.');
  }
  if (
    !Number.isInteger(prefs.preparationDays) ||
    prefs.preparationDays < 0 ||
    prefs.preparationDays > 7
  ) {
    throw new RangeError('Preparation days must be between 0 and 7.');
  }
  if (!['wake', 'bed'].includes(prefs.sleepAnchor))
    throw new RangeError('Choose a sleep or wake anchor.');
  if (prefs.planningMode !== undefined && !['rules', 'model'].includes(prefs.planningMode))
    throw new RangeError('Choose a supported planning mode.');
}
