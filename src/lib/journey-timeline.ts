import { Temporal } from '@js-temporal/polyfill';
import {
  buildDayTimeline,
  type TimelineBand,
  type TimelineBandKind,
  type TimelineEntry,
} from './day-timeline';
import type { PlanCalendarDay } from './plan-calendar';
import type { LoungeFlightContext } from './lounge-windows';
import { airportCityName, planDayCity } from './plan-places';
import { travelClock } from './travel-clocks';
import type { PlanAction } from './types';

const HOUR = 3_600_000;
const iso = (at: number) => new Date(at).toISOString();
export type JourneyClock = ReturnType<typeof travelClock>;
export interface JourneyBand extends TimelineBand {
  actions: PlanAction[];
  lane: number;
  laneCount: number;
  top: number;
  height: number;
  label: string;
  duration: string;
}
export interface JourneyMarker {
  at: number;
  top: number;
  height: number;
  kind: 'day' | 'clock';
  city: string;
  clock: JourneyClock;
  fromCity?: string;
  fromClock?: JourneyClock;
  change?: string;
}
export interface JourneyPoint {
  at: number;
  top: number;
  y: number;
  end: number;
  height: number;
  compressed: boolean;
  clock: JourneyClock;
  city: string;
}
export interface JourneyDay {
  date: string;
  at: number;
  y: number;
  city: string;
  travel: boolean;
}
export interface JourneyTimeline {
  start: number;
  end: number;
  height: number;
  bands: JourneyBand[];
  events: { entry: TimelineEntry; top: number }[];
  markers: JourneyMarker[];
  points: JourneyPoint[];
  ticks: { at: number; top: number; clock: JourneyClock }[];
  days: JourneyDay[];
}

export const journeyLabels: Record<TimelineBandKind, string> = {
  awake: 'Awake',
  sleep: 'Sleep',
  rest: 'Rest',
  light: 'Daylight',
  'avoid-light': 'Dim light',
  caffeine: 'Caffeine',
  melatonin: 'Melatonin',
  flight: 'Flight',
};
export function journeyDuration(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${minutes}m`;
}
export function journeyPosition(
  timeline: Pick<JourneyTimeline, 'points' | 'height'>,
  at: number,
): number {
  const points = timeline.points;
  if (!points.length) return 0;
  const point = points.find((p) => p.at <= at && at < p.end);
  if (point) return point.y + (point.height * (at - point.at)) / (point.end - point.at);
  return at <= points[0].at ? points[0].y : points[points.length - 1].y;
}

/** A presentation-only clock handoff halfway through a flight, never a claim about aircraft position. */
export function buildJourneyTimeline(
  days: readonly PlanCalendarDay[],
  options: { loungeContexts?: readonly LoungeFlightContext[] } = {},
): JourneyTimeline | null {
  if (!days.length) return null;
  const actions = [
    ...new Map(
      days.flatMap((day) =>
        (day.allActions ?? day.actions).map((a) => [`${a.id}:${a.start}:${a.end}`, a] as const),
      ),
    ).values(),
  ];
  const flights = [
    ...new Map(days.flatMap((day) => day.travelSegments.map((f) => [f.id, f] as const))).values(),
  ].sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure));
  const first = days[0],
    last = days[days.length - 1];
  const start =
    first.displayStart ??
    Temporal.PlainDate.from(first.date).toZonedDateTime(first.timeZone).epochMilliseconds;
  const end =
    last.displayEnd ??
    Temporal.PlainDate.from(last.date).add({ days: 1 }).toZonedDateTime(last.timeZone)
      .epochMilliseconds;
  if (!(end > start)) return null;
  type ClockRegion = { at: number; timeZone: string; city: string; airport?: string };
  const regions: ClockRegion[] = [
    {
      at: start,
      timeZone: flights[0]?.departureTimeZone ?? first.timeZone,
      city: airportCityName(flights[0]?.departureAirport) ?? planDayCity(first),
      airport: flights[0]?.departureAirport,
    },
  ];
  for (const flight of flights) {
    const departure = Date.parse(flight.departure),
      arrival = Date.parse(flight.arrival);
    if (!(arrival > departure)) continue;
    const midpoint = Math.floor((departure + arrival) / 120_000) * 60_000;
    const instant = Temporal.Instant.fromEpochMilliseconds(midpoint);
    const changed =
      instant.toZonedDateTimeISO(flight.departureTimeZone).offsetNanoseconds !==
      instant.toZonedDateTimeISO(flight.arrivalTimeZone).offsetNanoseconds;
    const at = changed ? midpoint : arrival;
    const region = {
      at,
      timeZone: flight.arrivalTimeZone,
      city: airportCityName(flight.arrivalAirport) ?? flight.arrivalAirport,
      airport: flight.arrivalAirport,
    };
    if (at <= start) regions[0] = { ...region, at: start };
    else if (at < end) regions.push(region);
  }
  regions.sort((a, b) => a.at - b.at);
  const regionAt = (at: number) =>
    [...regions].reverse().find((region) => region.at <= at) ?? regions[0];
  const clockAt = (at: number) => travelClock(iso(at), regionAt(at).timeZone);
  const source = buildDayTimeline(
    {
      ...first,
      date: first.date,
      actions,
      allActions: actions,
      travelSegments: flights,
      departureFlightIds: flights.map((f) => f.id),
      displayStart: start,
      displayEnd: end,
      clockChanges: regions.map((r) => ({
        at: r.at,
        timeZone: r.timeZone,
        locationAirport: r.airport,
      })),
    },
    options,
  );
  const markerMap = new Map<number, JourneyMarker>();
  const makeMarker = (
    at: number,
    kind: JourneyMarker['kind'],
    region = regionAt(at),
  ): JourneyMarker => ({
    at,
    top: 0,
    height: kind === 'clock' ? 144 : 46,
    kind,
    clock: clockAt(at),
    city: region.city,
  });
  markerMap.set(start, makeMarker(start, 'day'));
  const hourTicks: number[] = [];
  for (let index = 0; index < regions.length; index++) {
    const region = regions[index],
      until = regions[index + 1]?.at ?? end;
    const local = Temporal.Instant.fromEpochMilliseconds(region.at).toZonedDateTimeISO(
      region.timeZone,
    );
    const previous = regions[index - 1];
    if (previous && previous.timeZone !== region.timeZone) {
      const from = Temporal.Instant.fromEpochMilliseconds(region.at).toZonedDateTimeISO(
        previous.timeZone,
      );
      const delta = (local.offsetNanoseconds - from.offsetNanoseconds) / 3.6e12;
      if (delta !== 0)
        markerMap.set(region.at, {
          ...makeMarker(region.at, 'clock'),
          fromCity: previous.city,
          fromClock: travelClock(iso(region.at), previous.timeZone),
          change: `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}h`,
        });
    }
    let date = local.toPlainDate().add({ days: 1 });
    for (
      let midnight = date.toZonedDateTime(region.timeZone).epochMilliseconds;
      midnight < until;
      date = date.add({ days: 1 }),
        midnight = date.toZonedDateTime(region.timeZone).epochMilliseconds
    ) {
      if (midnight > region.at) markerMap.set(midnight, makeMarker(midnight, 'day'));
    }
    for (
      let at = local.with({ minute: 0, second: 0, millisecond: 0 }).epochMilliseconds;
      at < until;
      at += HOUR
    )
      if (at >= region.at) hourTicks.push(at);
    let transition = local.getTimeZoneTransition('next');
    while (transition && transition.epochMilliseconds < until) {
      const at = transition.epochMilliseconds;
      const before = Temporal.Instant.fromEpochMilliseconds(at - 1).toZonedDateTimeISO(
        region.timeZone,
      );
      const delta = (transition.offsetNanoseconds - before.offsetNanoseconds) / 3.6e12;
      // Format the preceding offset at the same absolute instant, including repeated DST hours.
      const beforeClock = travelClock(iso(at + before.offsetNanoseconds / 1e6), 'UTC');
      beforeClock.zone = travelClock(iso(at - 1), region.timeZone).zone;
      markerMap.set(at, {
        ...makeMarker(at, 'clock'),
        fromCity: region.city,
        fromClock: beforeClock,
        change: `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}h`,
      });
      transition = transition.getTimeZoneTransition('next');
    }
  }
  // Join the planner's midnight sleep fragments, keeping every original action for recording.
  const bands: JourneyBand[] = [];
  const joined = new Map<string, JourneyBand>();
  for (const band of source.bands) {
    if (band.kind === 'flight') continue;
    const entry =
      band.action && source.entries.find((e) => e.kind === 'action' && e.action === band.action);
    const episode = entry?.kind === 'action' ? entry.sleepEpisode : undefined;
    const key = episode ? `${band.kind}:${episode.start}:${episode.end}` : band.id;
    const existing = joined.get(key);
    if (existing) {
      if (band.action) existing.actions.push(band.action);
      continue;
    }
    const value: JourneyBand = {
      ...band,
      id: key,
      start: Math.max(start, episode?.start ?? band.start),
      end: Math.min(end, episode?.end ?? band.end),
      actions: band.action ? [band.action] : [],
      lane: 0,
      laneCount: 1,
      top: 0,
      height: 0,
      label: journeyLabels[band.kind],
      duration: '',
    };
    joined.set(key, value);
    bands.push(value);
  }
  // Independent sublanes preserve concurrent observations and optional guidance within each category.
  const category = (kind: TimelineBandKind) =>
    ['awake', 'sleep', 'rest'].includes(kind) ? 0 : ['light', 'avoid-light'].includes(kind) ? 1 : 2;
  for (let group = 0; group < 3; group++) {
    const members = bands
      .filter((b) => category(b.kind) === group)
      .sort((a, b) => a.start - b.start);
    const ends: number[] = [];
    for (const band of members) {
      let lane = ends.findIndex((until) => until <= band.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = band.end;
      band.lane = lane;
    }
    for (const band of members) {
      band.laneCount = ends.length;
      band.lane = group + band.lane / ends.length;
    }
  }
  const events = source.entries
    .filter(
      (entry) =>
        entry.kind !== 'action' && !(entry.kind === 'flight' && entry.phase === 'continuation'),
    )
    .map((entry) => ({ entry, top: 0 }));
  const cuts = [
    ...new Set([
      start,
      end,
      ...bands.flatMap((b) => [b.start, b.end]),
      ...flights.flatMap((f) => [Date.parse(f.departure), Date.parse(f.arrival)]),
      ...events.map((e) => e.entry.start),
      ...regions.map((r) => r.at),
      ...markerMap.keys(),
    ]),
  ]
    .filter((t) => t >= start && t <= end)
    .sort((a, b) => a - b);
  const points: JourneyPoint[] = [];
  let top = 0;
  for (let index = 0; index < cuts.length; index++) {
    const at = cuts[index],
      until = cuts[index + 1] ?? at,
      marker = markerMap.get(at);
    if (marker) marker.top = top;
    const y = top + (marker?.height ?? 0);
    const active = bands.filter((b) => b.start < until && b.end > at);
    const compressed = until - at >= 3 * HOUR && active.every((b) => b.kind === 'awake');
    const starting = bands.some((b) => b.start === at);
    const pointEvents = events.filter((e) => e.entry.start === at);
    const height =
      index === cuts.length - 1
        ? 0
        : Math.max(
            starting ? 92 : 24,
            pointEvents.length * 90,
            compressed ? 78 : ((until - at) / HOUR) * 42,
          );
    pointEvents.forEach((e, i) => {
      e.top = y + i * 90;
    });
    points.push({
      at,
      top,
      y,
      end: until,
      height,
      compressed,
      clock: clockAt(at),
      city: regionAt(at).city,
    });
    top = y + height;
  }
  const timeline: JourneyTimeline = {
    start,
    end,
    height: top + 120,
    points,
    bands,
    events,
    markers: [...markerMap.values()].sort((a, b) => a.at - b.at),
    ticks: [],
    days: [],
  };
  for (const band of bands) {
    band.top = journeyPosition(timeline, band.start);
    band.height = journeyPosition(timeline, band.end) - band.top - 2;
    band.duration = journeyDuration(band.end - band.start);
  }
  for (const flight of source.bands.filter((b) => b.kind === 'flight'))
    bands.push({
      ...flight,
      actions: [],
      lane: 3,
      laneCount: 1,
      top: journeyPosition(timeline, flight.start),
      height: journeyPosition(timeline, flight.end) - journeyPosition(timeline, flight.start),
      label: flight.flight?.flightNumber || 'Flight',
      duration: journeyDuration(flight.end - flight.start),
    });
  const ticks = [...new Set([...cuts, ...hourTicks])].sort((a, b) => a - b);
  for (const at of ticks) {
    const point = points.find((p) => p.at <= at && at < p.end);
    if (!point || (point.compressed && at !== point.at)) continue;
    const y = journeyPosition(timeline, at);
    if (timeline.ticks.some((tick) => Math.abs(tick.top - y) < 22)) continue;
    timeline.ticks.push({ at, top: y, clock: clockAt(at) });
  }
  for (const marker of timeline.markers) {
    const date = marker.clock.dateKey;
    const existing = timeline.days.findIndex((day) => day.date === date);
    const day = { date, at: marker.at, y: marker.top, city: marker.city, travel: false };
    // A date repeated after a backward clock change should open the local stay,
    // rather than an earlier origin midnight that happened during the flight.
    if (existing < 0) timeline.days.push(day);
    else if (marker.kind === 'day') timeline.days[existing] = day;
  }
  timeline.days.sort((a, b) => a.at - b.at);
  timeline.days.forEach((day, index) => {
    const until = timeline.days[index + 1]?.at ?? end;
    day.travel = flights.some(
      (f) => Date.parse(f.departure) < until && Date.parse(f.arrival) > day.at,
    );
  });
  return timeline;
}
