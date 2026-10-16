import type { PlanAction, PlanTravelSegment } from './types';

const clocks = new Map<string, Intl.DateTimeFormat>();
const dates = new Map<string, Intl.DateTimeFormat>();

/** Format one instant in an airport's time zone, including its actual date and DST offset. */
export function travelClock(
  iso: string,
  zone: string,
): { time: string; date: string; zone: string; dateKey: string } {
  let clock = clocks.get(zone);
  if (!clock) {
    clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    });
    clocks.set(zone, clock);
  }
  let date = dates.get(zone);
  if (!date) {
    date = new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short' });
    dates.set(zone, date);
  }
  const instant = new Date(iso);
  const parts = clock.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)!.value;
  return {
    time: `${part('hour')}:${part('minute')}`,
    date: date.format(instant),
    zone: part('timeZoneName'),
    dateKey: `${part('year')}-${part('month')}-${part('day')}`,
  };
}

/** Choose the relevant leg for dual-clock action labels, even outside the flight itself. */
export function actionTravelSegment(
  action: PlanAction,
  segments?: PlanTravelSegment[],
): PlanTravelSegment | undefined {
  const start = Date.parse(action.start),
    end = Date.parse(action.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  let selected: PlanTravelSegment | undefined;
  let bestOverlap = -1,
    nearestDistance = Infinity;
  for (const segment of segments ?? []) {
    const departure = Date.parse(segment.departure),
      arrival = Date.parse(segment.arrival);
    if (!Number.isFinite(departure) || !Number.isFinite(arrival) || arrival < departure) continue;
    const overlap = Math.max(0, Math.min(end, arrival) - Math.max(start, departure));
    const distance = Math.max(0, departure - end, start - arrival);
    if (overlap > bestOverlap || (overlap === bestOverlap && distance < nearestDistance)) {
      selected = segment;
      bestOverlap = overlap;
      nearestDistance = distance;
    }
  }
  return selected;
}
