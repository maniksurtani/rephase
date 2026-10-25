import { Temporal } from '@js-temporal/polyfill';
import type { PlanAction, PlanDay, PlanTravelSegment } from './types';
import { withJourneyWindows, type JourneyClockChange } from './journey-calendar';
export type { JourneyClockChange } from './journey-calendar';

/** A single date tile, retaining the original zoned days for model context. */
export interface PlanCalendarDay extends PlanDay {
  sourceDays: PlanDay[];
  timeZones: string[];
  travelSegments: PlanTravelSegment[];
  /** Estimates are selected from one zoned day, never added across clocks. */
  phaseEstimateSourceId?: string;
  /** Nonoverlapping UTC bounds for this date's portion of the journey. */
  displayStart?: number;
  displayEnd?: number;
  clockChanges?: JourneyClockChange[];
  /** Departure summaries can sit at the end boundary before a clock change. */
  departureFlightIds?: string[];
  /** Shared original references let adjacent sleep fragments form one episode. */
  allActions?: readonly PlanAction[];
  /** The last supported local day, one day after final arrival. */
  tripComplete?: boolean;
}

/** A merged day can be current on either side of a timezone/date-line change. */
export function isCalendarDayCurrent(day: PlanCalendarDay, instant: number): boolean {
  if (day.displayStart !== undefined && day.displayEnd !== undefined)
    return instant >= day.displayStart && instant < day.displayEnd;
  const time = Temporal.Instant.fromEpochMilliseconds(instant);
  return day.timeZones.some(
    (zone) => time.toZonedDateTimeISO(zone).toPlainDate().toString() === day.date,
  );
}

function calendarEnd(day: PlanDay): number {
  return Temporal.PlainDate.from(day.date).add({ days: 1 }).toZonedDateTime(day.timeZone)
    .epochMilliseconds;
}

function lastInstant(day: PlanDay): number {
  return day.actions.length
    ? Math.max(...day.actions.map((action) => Date.parse(action.end)))
    : calendarEnd(day);
}

function compareActions(a: PlanAction, b: PlanAction): number {
  return (
    Date.parse(a.start) - Date.parse(b.start) ||
    Date.parse(a.end) - Date.parse(b.end) ||
    a.id.localeCompare(b.id)
  );
}

function compareSegments(a: PlanTravelSegment, b: PlanTravelSegment): number {
  return (
    Date.parse(a.departure) - Date.parse(b.departure) ||
    Date.parse(a.arrival) - Date.parse(b.arrival) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Merge presentation tiles by their existing local calendar date. This does not
 * move, clip or regenerate a recommendation: each action keeps its own clock,
 * UTC instants and adherence ID, including when crossing the date line or DST.
 */
export function groupPlanDays(days: PlanDay[]): PlanCalendarDay[] {
  const dates = new Map<string, PlanDay[]>();
  for (const day of days) {
    const members = dates.get(day.date);
    if (members) members.push(day);
    else dates.set(day.date, [day]);
  }

  const grouped = [...dates.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, members]) => {
      // A late destination estimate describes the end of this presentation day
      // better than the origin morning. Schedule-only placeholders never win.
      const sourceDays = [...members].sort(
        (a, b) => lastInstant(a) - lastInstant(b) || a.id.localeCompare(b.id),
      );
      const estimates = sourceDays.filter(
        (day) =>
          day.phaseEstimateAvailable !== false &&
          Number.isFinite(day.phaseShiftHours) &&
          Number.isFinite(day.remainingShiftHours),
      );
      const estimate = estimates.at(-1);
      const representative =
        estimate ??
        [...sourceDays]
          .sort(
            (a, b) =>
              a.actions.length - b.actions.length ||
              lastInstant(a) - lastInstant(b) ||
              a.id.localeCompare(b.id),
          )
          .at(-1)!;

      const actionsById = new Map<string, PlanAction>();
      const flightsById = new Map<string, PlanTravelSegment>();
      for (const day of sourceDays) {
        for (const action of day.actions) {
          const key = `${action.id}:${action.start}:${action.end}`;
          if (!actionsById.has(key)) actionsById.set(key, action);
        }
        for (const segment of day.travelSegments ?? [])
          if (!flightsById.has(segment.id)) flightsById.set(segment.id, segment);
      }
      const actions = [...actionsById.values()].sort(compareActions);
      const travelSegments = [...flightsById.values()].sort(compareSegments);
      const travel = travelSegments.length > 0 || sourceDays.some((day) => day.stage === 'travel');
      const routes = [
        ...new Set(
          travelSegments.map(
            (segment) => `${segment.departureAirport} → ${segment.arrivalAirport}`,
          ),
        ),
      ];

      return {
        ...representative,
        id: date,
        date,
        sourceDays,
        timeZones: [...new Set(sourceDays.map((day) => day.timeZone))],
        actions,
        travelSegments,
        stage: travel ? 'travel' : representative.stage,
        label: travel && routes.length ? routes.join(' · ') : representative.label,
        note: [...new Set(sourceDays.map((day) => day.note).filter(Boolean))].join('\n\n'),
        phaseEstimateAvailable: Boolean(estimate),
        phaseEstimateSourceId: estimate?.id,
      };
    });
  return withJourneyWindows(grouped);
}
