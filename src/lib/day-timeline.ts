import { Temporal } from '@js-temporal/polyfill';
import type { JourneyClockChange, PlanCalendarDay } from './plan-calendar';
import type { LoungeFlightContext } from './lounge-windows';
import type { ActionType, PlanAction, PlanTravelSegment } from './types';

export type TimelineBandKind = ActionType | 'rest' | 'flight' | 'awake';

/** Elapsed UTC bounds keep DST and travel from reversing the rail. */
export interface TimelineSpan {
  start: number;
  end: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** Presentation of a whole night; the original fragments retain their recording IDs. */
export type SleepEpisode = TimelineSpan;

export type TimelineEntry = TimelineSpan &
  (
    | { id: string; kind: 'action'; action: PlanAction; sleepEpisode?: SleepEpisode }
    | {
        id: string;
        kind: 'flight';
        flight: PlanTravelSegment;
        phase: 'departure' | 'continuation' | 'arrival';
      }
    | { id: string; kind: 'lounge'; lounge: LoungeFlightContext }
  );

export interface TimelineBand extends TimelineSpan {
  id: string;
  kind: TimelineBandKind;
  action?: PlanAction;
  flight?: PlanTravelSegment;
}

export interface DayTimeline {
  start: number;
  end: number;
  timeZone: string;
  clockChanges?: JourneyClockChange[];
  entries: TimelineEntry[];
  bands: TimelineBand[];
}

type Range = { start: number; end: number };
const actionKey = (action: PlanAction) => `${action.id}:${action.start}:${action.end}`;

function calendarBounds(date: string, zone: string): Range {
  const day = Temporal.PlainDate.from(date);
  return {
    start: day.toZonedDateTime(zone).epochMilliseconds,
    end: day.add({ days: 1 }).toZonedDateTime(zone).epochMilliseconds,
  };
}

function intersection(range: Range, bounds: Range): Range | undefined {
  const start = Math.max(range.start, bounds.start),
    end = Math.min(range.end, bounds.end);
  return end > start ? { start, end } : undefined;
}

function validRange(start: number, end: number): boolean {
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

function span(range: Range, original: Range = range): TimelineSpan {
  return {
    ...range,
    continuesBefore: original.start < range.start,
    continuesAfter: original.end > range.end,
  };
}

/** Use the clock active at an instant; an interval's end can retain its preceding clock. */
export function timelineTimeZone(timeline: DayTimeline, instant: number, before = false): string {
  for (let index = (timeline.clockChanges?.length ?? 0) - 1; index >= 0; index--) {
    const change = timeline.clockChanges![index];
    if (before ? change.at < instant : change.at <= instant) return change.timeZone;
  }
  return timeline.timeZone;
}

/** Rest is still the original sleep recommendation, with its original log ID. */
export function timelineActionKind(action: PlanAction): ActionType | 'rest' {
  return action.type === 'sleep' && action.sleepKind === 'rest' ? 'rest' : action.type;
}

function sleepEpisodes(actions: readonly PlanAction[]): Map<string, Range> {
  const episodes = new Map<string, Range>();
  let previous: PlanAction | undefined;
  let episode: Range | undefined;
  const sleeps = [...new Map(actions.map((action) => [actionKey(action), action])).values()]
    .filter(
      (action) =>
        action.type === 'sleep' && validRange(Date.parse(action.start), Date.parse(action.end)),
    )
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  for (const action of sleeps) {
    const start = Date.parse(action.start),
      end = Date.parse(action.end);
    const boundary = Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(
      action.timeZone,
    );
    // The planner splits a single night at local midnight. Join only matching
    // neighboring fragments there, never unrelated naps or observed/planned sleep.
    const joins =
      previous &&
      episode &&
      episode.end === start &&
      previous.timeZone === action.timeZone &&
      previous.sleepKind === action.sleepKind &&
      previous.origin === action.origin &&
      previous.title === action.title &&
      boundary.hour === 0 &&
      boundary.minute === 0 &&
      boundary.second === 0 &&
      boundary.millisecond === 0;
    if (joins) episode!.end = end;
    else episode = { start, end };
    episodes.set(actionKey(action), episode!);
    previous = action;
  }
  return episodes;
}

/** Render a precomputed journey window, preserving original model objects and IDs. */
export function buildDayTimeline(
  day: PlanCalendarDay,
  options: { loungeContexts?: readonly LoungeFlightContext[] } = {},
): DayTimeline {
  const partitioned = day.displayStart !== undefined && day.displayEnd !== undefined;
  const calendar = calendarBounds(day.date, day.timeZone);
  const bounds: Range = partitioned ? { start: day.displayStart!, end: day.displayEnd! } : calendar;
  const entries: TimelineEntry[] = [];
  const bands: TimelineBand[] = [];
  const episodes = sleepEpisodes(day.allActions ?? day.actions);
  const actions = [...new Map(day.actions.map((action) => [actionKey(action), action])).values()];
  const actionIdCounts = new Map<string, number>();
  for (const action of actions)
    actionIdCounts.set(action.id, (actionIdCounts.get(action.id) ?? 0) + 1);

  for (const action of actions) {
    const original = { start: Date.parse(action.start), end: Date.parse(action.end) };
    if (!validRange(original.start, original.end)) continue;
    const range = intersection(
      original,
      partitioned ? bounds : calendarBounds(day.date, action.timeZone),
    );
    if (!range) continue;
    if (!partitioned) {
      bounds.start = Math.min(bounds.start, range.start);
      bounds.end = Math.max(bounds.end, range.end);
    }
    const episode = episodes.get(actionKey(action));
    const id = actionIdCounts.get(action.id)! > 1 ? actionKey(action) : action.id;
    entries.push({
      id,
      kind: 'action',
      action,
      ...span(range, episode ?? original),
      ...(episode
        ? {
            sleepEpisode: {
              ...episode,
              continuesBefore: episode.start < range.start,
              continuesAfter: episode.end > range.end,
            },
          }
        : {}),
    });
    bands.push({
      id: `action:${id}`,
      kind: timelineActionKind(action),
      action,
      ...span(range, episode ?? original),
    });
  }

  const flights = [...new Map(day.travelSegments.map((flight) => [flight.id, flight])).values()];
  for (const flight of flights) {
    const original = { start: Date.parse(flight.departure), end: Date.parse(flight.arrival) };
    if (!validRange(original.start, original.end)) continue;
    const range = intersection(original, bounds);
    const ownsDeparture = day.departureFlightIds
      ? day.departureFlightIds.includes(flight.id)
      : original.start >= bounds.start && original.start < bounds.end;
    if (range) {
      bands.push({
        id: `flight:${flight.id}`,
        kind: 'flight',
        flight,
        ...span(range, original),
        continuesBefore: !ownsDeparture || original.start < range.start,
      });
    }
    if (ownsDeparture && original.start >= bounds.start && original.start <= bounds.end) {
      entries.push({
        id: flight.id,
        kind: 'flight',
        flight,
        phase: 'departure',
        ...span({ start: original.start, end: Math.min(original.end, bounds.end) }, original),
      });
    } else if (range) {
      entries.push({
        id: `${flight.id}:continuation`,
        kind: 'flight',
        flight,
        phase: 'continuation',
        ...span(range, original),
        continuesBefore: true,
      });
    }
    if (original.end >= bounds.start && original.end < bounds.end) {
      entries.push({
        id: `${flight.id}:arrival`,
        kind: 'flight',
        flight,
        phase: 'arrival',
        ...span({ start: original.end, end: original.end }),
      });
    }
  }

  // Airport links belong to their own instant, including the preceding evening.
  for (const lounge of options.loungeContexts ?? []) {
    const departure = Date.parse(lounge.departure);
    const available = lounge.start ? Date.parse(lounge.start) : Number.NaN;
    const at =
      Number.isFinite(available) && available < departure ? available : departure - 30 * 60_000;
    const localDate = Temporal.Instant.fromEpochMilliseconds(departure)
      .toZonedDateTimeISO(lounge.timeZone)
      .toPlainDate()
      .toString();
    const legacyPreflight = !partitioned && localDate === day.date;
    if (!Number.isFinite(at) || (!legacyPreflight && !(at >= bounds.start && at < bounds.end)))
      continue;
    if (legacyPreflight) bounds.start = Math.min(bounds.start, at);
    entries.push({
      id: `lounge:${lounge.legId}`,
      kind: 'lounge',
      lounge,
      ...span({ start: at, end: at }),
    });
  }

  const entryRank = { flight: 0, lounge: 1, action: 2 };
  entries.sort(
    (a, b) =>
      a.start - b.start ||
      entryRank[a.kind] - entryRank[b.kind] ||
      a.end - b.end ||
      a.id.localeCompare(b.id),
  );
  // Use every visible sleep interval from the global plan. A clock change must
  // never turn sleep on the preceding screen into an Awake label here.
  let cursor = bounds.start;
  for (const rest of entries.filter(
    (entry) => entry.kind === 'action' && entry.action.type === 'sleep',
  )) {
    if (rest.start > cursor)
      bands.push({
        id: `awake:${cursor}`,
        kind: 'awake',
        ...span({ start: cursor, end: rest.start }),
      });
    cursor = Math.max(cursor, rest.end);
  }
  if (cursor < bounds.end)
    bands.push({
      id: `awake:${cursor}`,
      kind: 'awake',
      ...span({ start: cursor, end: bounds.end }),
    });
  bands.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const clockChanges = day.clockChanges ?? [
    { at: bounds.start, timeZone: day.timeZone, locationAirport: day.locationAirport },
  ];
  return {
    ...bounds,
    timeZone: clockChanges[0]?.timeZone ?? day.timeZone,
    clockChanges,
    entries,
    bands,
  };
}
