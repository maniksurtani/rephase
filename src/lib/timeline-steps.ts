import { Temporal } from '@js-temporal/polyfill';
import type { DayTimeline, TimelineBand, TimelineEntry } from './day-timeline';

export interface TimelineStep {
  start: number;
  end: number;
  bands: TimelineBand[];
  entries: TimelineEntry[];
  compressed: boolean;
}

const TWO_HOURS = 2 * 60 * 60_000;

/** Keep clock changes visible even when a long, unchanged period is compressed. */
function clockBoundaries(timeline: DayTimeline): number[] {
  const start = Temporal.Instant.fromEpochMilliseconds(timeline.start).toZonedDateTimeISO(timeline.timeZone);
  const boundaries: number[] = [];
  let date = start.toPlainDate().add({ days: 1 });
  for (let midnight = date.toZonedDateTime(timeline.timeZone).epochMilliseconds;
    midnight < timeline.end;
    date = date.add({ days: 1 }), midnight = date.toZonedDateTime(timeline.timeZone).epochMilliseconds) {
    if (midnight > timeline.start) boundaries.push(midnight);
  }

  let transition = start.getTimeZoneTransition('next');
  while (transition && transition.epochMilliseconds < timeline.end) {
    if (transition.epochMilliseconds > timeline.start) boundaries.push(transition.epochMilliseconds);
    transition = transition.getTimeZoneTransition('next');
  }
  return boundaries;
}

/**
 * Compact the display between real changes, rather than adding hourly rows.
 * Every concurrent band remains present throughout its elapsed UTC interval;
 * original entries and bands are returned by reference, with no model edits.
 * Point entries at the final instant belong to the component's end-of-day row.
 */
export function buildTimelineSteps(timeline: DayTimeline): TimelineStep[] {
  const points = [...new Set([
    timeline.start, timeline.end,
    ...timeline.bands.flatMap(band => [band.start, band.end]),
    ...timeline.entries.flatMap(entry => [entry.start, entry.end]),
    ...clockBoundaries(timeline),
  ])].filter(instant => instant >= timeline.start && instant <= timeline.end).sort((a, b) => a - b);

  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    return {
      start, end,
      bands: timeline.bands.filter(band => band.start < end && band.end > start),
      entries: timeline.entries.filter(entry => entry.start === start),
      compressed: end - start >= TWO_HOURS,
    };
  });
}
