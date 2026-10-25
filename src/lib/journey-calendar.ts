import { Temporal } from '@js-temporal/polyfill';
import type { PlanCalendarDay } from './plan-calendar';
import type { PlanAction, PlanTravelSegment } from './types';
import { arrivalPlanHorizon } from './plan-horizon';

/** The displayed clock changes at departure, not at an inferred geographic date line. */
export interface JourneyClockChange {
  at: number;
  timeZone: string;
  locationAirport?: string;
  fromTimeZone?: string;
}

interface JourneyWindow {
  date: string;
  start: number;
  end: number;
  clockChanges: JourneyClockChange[];
}

const HOUR = 3_600_000;
const localDate = (instant: number, zone: string) =>
  Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(zone).toPlainDate();
const midnight = (date: string, zone: string) =>
  Temporal.PlainDate.from(date).toZonedDateTime(zone).epochMilliseconds;

function overlaps(start: number, end: number, window: JourneyWindow): boolean {
  return start < window.end && end > window.start;
}

/**
 * Build one elapsed-time partition before assigning facts to calendar tiles.
 * A backward date change lengthens the current journey date; a forward change
 * starts the next date at that same instant. No civil day is replayed in a new
 * clock, and dates skipped by a forward clock change do not invent elapsed time.
 */
export function withJourneyWindows(groups: PlanCalendarDay[]): PlanCalendarDay[] {
  if (!groups.length) return groups;
  const flights = [
    ...new Map(
      groups.flatMap((day) => day.travelSegments.map((flight) => [flight.id, flight])),
    ).values(),
  ]
    .filter((flight) => Date.parse(flight.arrival) > Date.parse(flight.departure))
    .sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure));
  const allActions = [
    ...new Map(
      groups.flatMap((day) =>
        day.actions.map((action) => [`${action.id}:${action.start}:${action.end}`, action]),
      ),
    ).values(),
  ].sort(
    (a, b) =>
      Date.parse(a.start) - Date.parse(b.start) ||
      Date.parse(a.end) - Date.parse(b.end) ||
      a.id.localeCompare(b.id),
  );
  // Standalone imported days retain their clocks but still share sleep context.
  if (!flights.length) return groups.map((day) => ({ ...day, allActions }));
  const firstFlight = flights[0];
  let zone = firstFlight.departureTimeZone;
  let airport = firstFlight.departureAirport;
  const sources = groups.flatMap((day) => day.sourceDays);
  const originDates = sources
    .filter((day) => day.timeZone === zone)
    .map((day) => day.date)
    .sort();
  const firstDate = originDates[0] ?? groups[0].date;
  if (!originDates.length) {
    zone = groups[0].timeZone;
    airport = groups[0].locationAirport ?? firstFlight.arrivalAirport;
  }
  // The first date may include a preceding-evening airport visit. Extending only
  // the first window cannot duplicate time from another displayed day.
  const firstMidnight = midnight(firstDate, zone);
  const firstDeparture = Date.parse(firstFlight.departure);
  const startsWithDeparture =
    zone === firstFlight.departureTimeZone &&
    firstDeparture >= firstMidnight &&
    localDate(firstDeparture, zone).toString() === firstDate;
  const start = startsWithDeparture
    ? Math.min(firstMidnight, firstDeparture - 3 * HOUR)
    : firstMidnight;
  const finalFlight = [...flights].sort((a, b) => Date.parse(b.arrival) - Date.parse(a.arrival))[0];
  const horizon = arrivalPlanHorizon(Date.parse(finalFlight.arrival), finalFlight.arrivalTimeZone);
  const end = Math.min(
    horizon.end,
    Math.max(
      ...sources.map(
        (day) =>
          Temporal.PlainDate.from(day.date).add({ days: 1 }).toZonedDateTime(day.timeZone)
            .epochMilliseconds,
      ),
    ),
  );
  if (start >= end) return [];
  let flightIndex = 0;
  while (flightIndex < flights.length && Date.parse(flights[flightIndex].departure) < start) {
    zone = flights[flightIndex].arrivalTimeZone;
    airport = flights[flightIndex].arrivalAirport;
    flightIndex++;
  }
  const windows: JourneyWindow[] = [];
  let current: JourneyWindow = {
    date: firstDate,
    start,
    end: start,
    clockChanges: [{ at: start, timeZone: zone, locationAirport: airport }],
  };
  let cursor = start;
  const moveDate = (date: string, change: JourneyClockChange) => {
    if (date > current.date) {
      current.end = cursor;
      windows.push(current);
      current = { date, start: cursor, end: cursor, clockChanges: [change] };
    } else if (
      current.clockChanges[current.clockChanges.length - 1].timeZone !== change.timeZone ||
      current.clockChanges[current.clockChanges.length - 1].locationAirport !==
        change.locationAirport
    ) {
      current.clockChanges.push(change);
    }
  };
  while (cursor < end) {
    const nextMidnight = localDate(cursor, zone)
      .add({ days: 1 })
      .toZonedDateTime(zone).epochMilliseconds;
    const nextFlight = flights[flightIndex];
    const departure = nextFlight ? Date.parse(nextFlight.departure) : Number.POSITIVE_INFINITY;
    const next = Math.min(end, nextMidnight, Math.max(cursor, departure));
    current.end = next;
    cursor = next;
    if (cursor >= end) break;
    // A flight departing exactly at midnight belongs to that new origin date.
    if (cursor === nextMidnight)
      moveDate(localDate(cursor, zone).toString(), {
        at: cursor,
        timeZone: zone,
        locationAirport: airport,
      });
    if (cursor === departure && nextFlight) {
      const previousZone = zone;
      zone = nextFlight.arrivalTimeZone;
      airport = nextFlight.arrivalAirport;
      moveDate(localDate(cursor, zone).toString(), {
        at: cursor,
        timeZone: zone,
        locationAirport: airport,
        ...(zone !== previousZone ? { fromTimeZone: previousZone } : {}),
      });
      flightIndex++;
    }
  }
  windows.push(current);

  const departures = new Map<string, string[]>();
  for (const flight of flights) {
    const departure = Date.parse(flight.departure);
    if (departure < start || departure > end) continue;
    const departureDate = localDate(departure, flight.departureTimeZone).toString();
    const owner =
      windows.find(
        (window) =>
          window.date === departureDate && window.start <= departure && window.end >= departure,
      ) ??
      windows.find((window) => window.start <= departure && window.end > departure) ??
      windows[windows.length - 1];
    const owned = departures.get(owner.date) ?? [];
    owned.push(flight.id);
    departures.set(owner.date, owned);
  }

  return windows.map((window) => {
    const sourceDate = groups.find((day) => day.date === window.date);
    const template = sourceDate ?? groups[groups.length - 1];
    const departureFlightIds = departures.get(window.date) ?? [];
    const travelSegments = flights.filter(
      (flight) =>
        overlaps(Date.parse(flight.departure), Date.parse(flight.arrival), window) ||
        Date.parse(flight.arrival) === window.start ||
        departureFlightIds.includes(flight.id),
    );
    const actions = allActions.filter((action: PlanAction) =>
      overlaps(Date.parse(action.start), Date.parse(action.end), window),
    );
    const routes = [
      ...new Set(
        travelSegments.map(
          (flight: PlanTravelSegment) => `${flight.departureAirport} → ${flight.arrivalAirport}`,
        ),
      ),
    ];
    return {
      ...template,
      // Filling a calendar gap must not copy a future day's numerical estimate.
      ...(!sourceDate ? { phaseEstimateAvailable: false, phaseEstimateSourceId: undefined } : {}),
      id: window.date,
      date: window.date,
      displayStart: window.start,
      displayEnd: window.end,
      clockChanges: window.clockChanges,
      departureFlightIds,
      tripComplete: window.date === horizon.lastDate,
      allActions,
      actions,
      travelSegments,
      timeZones: [...new Set(window.clockChanges.map((change) => change.timeZone))],
      ...(travelSegments.length ? { stage: 'travel' as const, label: routes.join(' · ') } : {}),
    };
  });
}
