import { Temporal } from '@js-temporal/polyfill';
import { dateInZone } from './time';

export interface Coordinates {
  latitude?: number;
  longitude?: number;
}

export interface DaylightWindow {
  status: 'normal' | 'polar-day' | 'polar-night' | 'unknown';
  /** UTC epoch milliseconds; events may cross midnight in the requested zone. */
  sunrise?: number;
  sunset?: number;
}

export type DaylightFeasibility = 'daylight' | 'indoor' | 'unknown';
export interface DaylightSegment {
  start: number;
  end: number;
  feasibility: DaylightFeasibility;
}

const DAY = 86_400_000;
const RAD = Math.PI / 180;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const J0 = 0.0009;

function validCoordinates(coords?: Coordinates): coords is Required<Coordinates> {
  return (
    typeof coords?.latitude === 'number' &&
    Number.isFinite(coords.latitude) &&
    Math.abs(coords.latitude) <= 90 &&
    typeof coords.longitude === 'number' &&
    Number.isFinite(coords.longitude) &&
    Math.abs(coords.longitude) <= 180
  );
}

function localDay(date: string, zone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('Use an ISO local date.');
  const day = Temporal.PlainDate.from(date, { overflow: 'reject' });
  const noon = day.toPlainDateTime('12:00').toZonedDateTime(zone);
  if (noon.toPlainDate().toString() !== date)
    throw new RangeError('This local date does not exist.');
  return {
    noon: noon.epochMilliseconds,
    start: day.toZonedDateTime(zone).epochMilliseconds,
    end: day.add({ days: 1 }).toZonedDateTime(zone).epochMilliseconds,
  };
}

/**
 * Standard approximate solar-position equations, as documented by SunCalc:
 * https://github.com/mourner/suncalc/blob/master/suncalc.js (BSD-2-Clause).
 * Solar anomaly, equation of center, declination, and hour angle use a -0.833°
 * sunrise altitude (refraction + the Sun's radius), consistent with NOAA:
 * https://gml.noaa.gov/grad/solcalc/calcdetails.html
 * This models an unobstructed horizon, not weather, terrain, or indoor light.
 */
function solarDay(instant: number, coords: Required<Coordinates>): DaylightWindow {
  const longitudeWest = -coords.longitude * RAD;
  const latitude = coords.latitude * RAD;
  const days = instant / DAY - 0.5 + J1970 - J2000;
  const cycle = Math.round(days - J0 - longitudeWest / (2 * Math.PI));
  const transit = J0 + longitudeWest / (2 * Math.PI) + cycle;
  const anomaly = RAD * (357.5291 + 0.98560028 * transit);
  const center =
    RAD *
    (1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly));
  const longitude = anomaly + center + 102.9372 * RAD + Math.PI;
  const declination = Math.asin(Math.sin(longitude) * Math.sin(23.4397 * RAD));
  const correction = 0.0053 * Math.sin(anomaly) - 0.0069 * Math.sin(2 * longitude);
  const noon = J2000 + transit + correction;
  const hourAngleCosine =
    (Math.sin(-0.833 * RAD) - Math.sin(latitude) * Math.sin(declination)) /
    (Math.cos(latitude) * Math.cos(declination));
  if (hourAngleCosine <= -1) return { status: 'polar-day' };
  if (hourAngleCosine >= 1) return { status: 'polar-night' };
  if (!Number.isFinite(hourAngleCosine)) return { status: 'unknown' };
  const hourAngle = Math.acos(hourAngleCosine);
  const sunsetJulian =
    J2000 + J0 + (hourAngle + longitudeWest) / (2 * Math.PI) + cycle + correction;
  const sunriseJulian = 2 * noon - sunsetJulian;
  return {
    status: 'normal',
    sunrise: Math.round((sunriseJulian + 0.5 - J1970) * DAY),
    sunset: Math.round((sunsetJulian + 0.5 - J1970) * DAY),
  };
}

/** Estimate sunrise/sunset for the solar day surrounding the requested local noon. */
export function daylightWindow(date: string, zone: string, coords?: Coordinates): DaylightWindow {
  if (!validCoordinates(coords)) return { status: 'unknown' };
  try {
    return solarDay(localDay(date, zone).noon, coords);
  } catch {
    return { status: 'unknown' };
  }
}

function daylightIntervals(date: string, zone: string, coords: Required<Coordinates>) {
  const day = localDay(date, zone);
  const intervals: Array<{ start: number; end: number }> = [];
  // Adjacent solar days matter where daylight straddles local midnight. Use
  // real UTC instants, so date-line offsets and 23/25-hour DST days are preserved.
  for (const offset of [-1, 0, 1]) {
    const window = solarDay(day.noon + offset * DAY, coords);
    if (window.status === 'polar-day' && offset === 0) {
      intervals.push({ start: day.start, end: day.end });
    } else if (window.status === 'normal') {
      const start = Math.max(day.start, window.sunrise!);
      const end = Math.min(day.end, window.sunset!);
      if (end > start) intervals.push({ start, end });
    }
  }
  return { ...day, intervals };
}

/**
 * Split a UTC interval at local midnights and sunrise/sunset. The date is the
 * initial local date; subsequent dates are calculated from the actual instants.
 */
export function splitDaylight(
  range: { start: number; end: number },
  date: string,
  zone: string,
  coords?: Coordinates,
): DaylightSegment[] {
  const { start, end } = range;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const unknown: DaylightSegment[] = [{ start, end, feasibility: 'unknown' }];
  if (!validCoordinates(coords)) return unknown;
  try {
    // Validate the caller's date rather than interpreting an invalid date as a
    // successful astronomy lookup. Intersections themselves follow UTC times.
    localDay(date, zone);
    const segments: DaylightSegment[] = [];
    let cursor = start;
    let dayCount = 0;
    while (cursor < end) {
      if (++dayCount > 370) return unknown;
      const { intervals, end: dayEnd } = daylightIntervals(dateInZone(cursor, zone), zone, coords);
      const limit = Math.min(end, dayEnd);
      if (limit <= cursor) return unknown;
      const boundaries = [
        cursor,
        limit,
        ...intervals.flatMap((interval) => [interval.start, interval.end]),
      ]
        .filter((value) => value >= cursor && value <= limit)
        .sort((a, b) => a - b);
      const unique = [...new Set(boundaries)];
      for (let i = 0; i < unique.length - 1; i++) {
        const segmentStart = unique[i];
        const segmentEnd = unique[i + 1];
        const daylight = intervals.some(
          (interval) => segmentStart >= interval.start && segmentEnd <= interval.end,
        );
        const feasibility = daylight ? 'daylight' : 'indoor';
        const previous = segments.at(-1);
        if (previous?.feasibility === feasibility && previous.end === segmentStart)
          previous.end = segmentEnd;
        else segments.push({ start: segmentStart, end: segmentEnd, feasibility });
      }
      cursor = limit;
    }
    return segments;
  } catch {
    return unknown;
  }
}

/** Conservatively label mixed night/day windows as requiring an indoor light option. */
export function daylightFeasibility(
  start: number,
  end: number,
  date: string,
  zone: string,
  coords?: Coordinates,
): DaylightFeasibility {
  const segments = splitDaylight({ start, end }, date, zone, coords);
  if (!segments.length || segments.some((segment) => segment.feasibility === 'unknown'))
    return 'unknown';
  return segments.every((segment) => segment.feasibility === 'daylight') ? 'daylight' : 'indoor';
}
