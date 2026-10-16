import { Temporal } from '@js-temporal/polyfill';
import type { PlanCalendarDay } from './plan-calendar';
import type { ActionType, PlanAction, PlanTravelSegment } from './types';

export type TimelineBandKind = ActionType | 'rest' | 'flight' | 'awake';

/** Fractions use elapsed UTC time, so DST and travel never reverse the rail. */
export interface TimelineSpan {
  start: number;
  end: number;
  startFraction: number;
  endFraction: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export type TimelineEntry = TimelineSpan &
  (
    | { id: string; kind: 'action'; action: PlanAction }
    | { id: string; kind: 'flight'; flight: PlanTravelSegment }
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
  durationMinutes: number;
  timeZone: string;
  entries: TimelineEntry[];
  bands: TimelineBand[];
  ticks: Array<{ instant: number; fraction: number }>;
}

type Range = { start: number; end: number };
type VisibleEntry = (
  | { id: string; kind: 'action'; action: PlanAction }
  | { id: string; kind: 'flight'; flight: PlanTravelSegment }
) &
  Range & { originalStart: number; originalEnd: number };

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

function compareEntries(a: VisibleEntry, b: VisibleEntry): number {
  return (
    a.start - b.start ||
    a.originalStart - b.originalStart ||
    (a.kind === b.kind ? 0 : a.kind === 'flight' ? -1 : 1) ||
    a.end - b.end ||
    a.id.localeCompare(b.id)
  );
}

/** Rest is still the original sleep recommendation, with its original log ID. */
export function timelineActionKind(action: PlanAction): ActionType | 'rest' {
  return action.type === 'sleep' && /\b(?:rest|nap)\b/i.test(action.title) ? 'rest' : action.type;
}

/**
 * Present one calendar tile on one chronological rail. The representative clock
 * supplies the normal day bounds; origin-clock recommendations and the portions
 * of flights belonging to another source clock can extend that rail. A return
 * across the date line therefore remains one tile without hiding its departure.
 * This is presentation only: original recommendations and flight objects are
 * returned by reference, and their model times and adherence IDs never change.
 */
export function buildDayTimeline(
  day: PlanCalendarDay,
  options: { tickMinutes?: number } = {},
): DayTimeline {
  const tickMinutes = options.tickMinutes ?? 120;
  if (!Number.isFinite(tickMinutes) || tickMinutes < 1)
    throw new RangeError('Timeline ticks must be at least one minute apart.');
  const calendar = calendarBounds(day.date, day.timeZone);
  const sources = day.sourceDays.length ? day.sourceDays : [day];
  const sourceBounds = sources.map((source) => ({
    source,
    ...calendarBounds(source.date, source.timeZone),
  }));
  const visible: VisibleEntry[] = [];
  const actionIds = new Set<string>(),
    flightIds = new Set<string>();

  for (const action of day.actions) {
    if (actionIds.has(action.id)) continue;
    actionIds.add(action.id);
    const originalStart = Date.parse(action.start),
      originalEnd = Date.parse(action.end);
    if (!validRange(originalStart, originalEnd)) continue;
    // Models normally split at local midnight already. Clip longer imported or
    // historical intervals for display rather than rendering the next day twice.
    const bounds = calendarBounds(day.date, action.timeZone);
    const range = intersection({ start: originalStart, end: originalEnd }, bounds);
    if (range)
      visible.push({ id: action.id, kind: 'action', action, ...range, originalStart, originalEnd });
  }

  for (const flight of day.travelSegments) {
    if (flightIds.has(flight.id)) continue;
    flightIds.add(flight.id);
    const originalStart = Date.parse(flight.departure),
      originalEnd = Date.parse(flight.arrival);
    if (!validRange(originalStart, originalEnd)) continue;
    const assigned = sourceBounds.filter(({ source }) =>
      source.travelSegments?.some((segment) => segment.id === flight.id),
    );
    const relevant = assigned.length ? assigned : sourceBounds;
    const portions = relevant.flatMap((bounds) => {
      const range = intersection({ start: originalStart, end: originalEnd }, bounds);
      // The travel calendar includes an arrival exactly at midnight on the new
      // date; keep that arrival card as a point rather than losing the flight.
      return range
        ? [range]
        : originalEnd === bounds.start
          ? [{ start: originalEnd, end: originalEnd }]
          : [];
    });
    if (portions.length)
      visible.push({
        id: flight.id,
        kind: 'flight',
        flight,
        start: Math.min(...portions.map((portion) => portion.start)),
        end: Math.max(...portions.map((portion) => portion.end)),
        originalStart,
        originalEnd,
      });
  }

  const start = Math.min(calendar.start, ...visible.map((entry) => entry.start));
  const end = Math.max(calendar.end, ...visible.map((entry) => entry.end));
  const duration = end - start;
  const span = (range: Range, original: Range = range): TimelineSpan => ({
    start: range.start,
    end: range.end,
    startFraction: (range.start - start) / duration,
    endFraction: (range.end - start) / duration,
    continuesBefore: original.start < range.start,
    continuesAfter: original.end > range.end,
  });
  const entries = visible.sort(compareEntries).map((entry): TimelineEntry => ({
    id: entry.id,
    ...span(entry, { start: entry.originalStart, end: entry.originalEnd }),
    ...(entry.kind === 'action'
      ? { kind: 'action', action: entry.action }
      : { kind: 'flight', flight: entry.flight }),
  }));
  const bands: TimelineBand[] = entries.map((entry) => ({
    id: `${entry.kind}:${entry.id}`,
    ...span(entry, {
      start:
        entry.kind === 'action'
          ? Date.parse(entry.action.start)
          : Date.parse(entry.flight.departure),
      end:
        entry.kind === 'action' ? Date.parse(entry.action.end) : Date.parse(entry.flight.arrival),
    }),
    ...(entry.kind === 'action'
      ? { kind: timelineActionKind(entry.action), action: entry.action }
      : { kind: 'flight', flight: entry.flight }),
  }));

  // These gaps mean only "no sleep/rest scheduled". They do not assert that a
  // traveler was awake, nor prescribe activities during transfers or buffers.
  const sleep = entries.filter((entry) => entry.kind === 'action' && entry.action.type === 'sleep');
  let cursor = start;
  for (const rest of sleep) {
    if (rest.start > cursor)
      bands.push({
        id: `awake:${cursor}`,
        kind: 'awake',
        ...span({ start: cursor, end: rest.start }),
      });
    cursor = Math.max(cursor, rest.end);
  }
  if (cursor < end)
    bands.push({ id: `awake:${cursor}`, kind: 'awake', ...span({ start: cursor, end }) });
  bands.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));

  const step = tickMinutes * 60_000;
  const ticks = new Set([start, end]);
  for (
    let instant = calendar.start + Math.ceil((start - calendar.start) / step) * step;
    instant < end;
    instant += step
  ) {
    ticks.add(instant);
  }
  return {
    start,
    end,
    durationMinutes: duration / 60_000,
    timeZone: day.timeZone,
    entries,
    bands,
    ticks: [...ticks]
      .sort((a, b) => a - b)
      .map((instant) => ({ instant, fraction: (instant - start) / duration })),
  };
}
