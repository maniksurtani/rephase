import { Temporal } from '@js-temporal/polyfill';
import { localToInstant } from './time';
import type { Plan, PlanDay, PlanTravelSegment, Trip } from './types';

/** A calendar day is a real zoned interval: DST days are not always 24 hours. */
function calendarBounds(date: string, zone: string): { start: number; end: number } {
  const day = Temporal.PlainDate.from(date);
  return {
    start: day.toZonedDateTime(zone).epochMilliseconds,
    end: day.add({ days: 1 }).toZonedDateTime(zone).epochMilliseconds,
  };
}

function localDate(instant: number, zone: string): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(zone).toPlainDate();
}

function overlapsDay(segment: PlanTravelSegment, bounds: { start: number; end: number }): boolean {
  const departure = Date.parse(segment.departure),
    arrival = Date.parse(segment.arrival);
  // Landing at midnight belongs on the arrival date too. A departure at midnight
  // must not make the preceding calendar day a travel day.
  return bounds.end > bounds.start && departure < bounds.end && arrival >= bounds.start;
}

/**
 * Add itinerary facts after either planning engine runs. A short daytime flight
 * still exists when there is no safe in-flight recommendation to display.
 * Existing recommendation IDs, timing, notes and phase estimates are untouched.
 */
export function decoratePlanWithTravel(plan: Plan, trip: Trip): Plan {
  const segments: PlanTravelSegment[] = trip.legs.map((leg) => ({
    id: leg.id,
    flightNumber: leg.flightNumber,
    departureAirport: leg.departureAirport,
    arrivalAirport: leg.arrivalAirport,
    departure: new Date(
      localToInstant(leg.departureDateTime, leg.departureTimeZone, leg.departureDisambiguation),
    ).toISOString(),
    arrival: new Date(
      localToInstant(leg.arrivalDateTime, leg.arrivalTimeZone, leg.arrivalDisambiguation),
    ).toISOString(),
    departureTimeZone: leg.departureTimeZone,
    arrivalTimeZone: leg.arrivalTimeZone,
    ...(leg.aircraft ? { aircraft: { ...leg.aircraft } } : {}),
  }));
  const days = new Map<string, PlanDay>(
    plan.days.map((day) => [`${day.date}:${day.timeZone}`, { ...day }]),
  );
  const bounds = new Map<string, { start: number; end: number }>();
  const boundsFor = (day: Pick<PlanDay, 'date' | 'timeZone'>) => {
    const key = `${day.date}:${day.timeZone}`;
    let value = bounds.get(key);
    if (!value) {
      value = calendarBounds(day.date, day.timeZone);
      bounds.set(key, value);
    }
    return value;
  };

  const ensureDay = (date: Temporal.PlainDate, zone: string, segment: PlanTravelSegment) => {
    const key = `${date}:${zone}`;
    if (days.has(key)) return;
    const day: PlanDay = {
      id: key,
      date: date.toString(),
      timeZone: zone,
      locationAirport:
        zone === segment.arrivalTimeZone ? segment.arrivalAirport : segment.departureAirport,
      label: `${segment.departureAirport} → ${segment.arrivalAirport}`,
      stage: 'travel',
      actions: [],
      phaseShiftHours: 0,
      remainingShiftHours: 0,
      phaseEstimateAvailable: false,
      note: 'Flight schedule only. No body-clock estimate is available for this calendar day.',
    };
    if (overlapsDay(segment, boundsFor(day))) days.set(key, day);
  };
  for (const segment of segments) {
    const departure = Date.parse(segment.departure),
      arrival = Date.parse(segment.arrival);
    const originDate = localDate(departure, segment.departureTimeZone);
    const arrivalDate = localDate(arrival, segment.arrivalTimeZone);
    ensureDay(originDate, segment.departureTimeZone, segment);
    ensureDay(arrivalDate, segment.arrivalTimeZone, segment);
    let date = localDate(departure, segment.arrivalTimeZone);
    // A westbound/date-line flight can already be airborne on the preceding
    // destination calendar date. Do not create an extra "before departure" day
    // merely for that second clock; the endpoint cards show both local times.
    if (Temporal.PlainDate.compare(date, originDate) < 0) date = originDate;
    // Validated flights last at most 36 hours. Eight local dates also covers
    // exceptional timezone changes without an unbounded calendar loop.
    for (
      let count = 0;
      Temporal.PlainDate.compare(date, arrivalDate) <= 0 && count < 8;
      count++, date = date.add({ days: 1 })
    ) {
      ensureDay(date, segment.arrivalTimeZone, segment);
    }
  }

  for (const day of days.values()) {
    const travel = segments.filter((segment) => overlapsDay(segment, boundsFor(day)));
    if (travel.length) {
      day.travelSegments = travel;
      day.stage = 'travel';
      day.label = [
        ...new Set(
          travel.map((segment) => `${segment.departureAirport} → ${segment.arrivalAirport}`),
        ),
      ].join(' · ');
    }
  }
  return {
    ...plan,
    days: [...days.values()].sort((a, b) => boundsFor(a).start - boundsFor(b).start),
  };
}
