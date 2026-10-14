import { describe, expect, it } from 'vitest';
import { daylightFeasibility, daylightWindow, splitDaylight } from '../src/lib/daylight';
import { dateInZone, localToInstant } from '../src/lib/time';

const london = { latitude: 51.5074, longitude: -0.1278 };
const minute = 60_000;

describe('daylight estimates', () => {
  it('matches London summer sunrise and sunset within five minutes', () => {
    // Rounded public almanac times for an unobstructed horizon; the model is
    // approximate, and actual outdoor exposure also depends on weather/terrain.
    const window = daylightWindow('2026-06-21', 'Europe/London', london);
    expect(window.status).toBe('normal');
    expect(Math.abs(window.sunrise! - Date.parse('2026-06-21T03:43:00Z'))).toBeLessThan(5 * minute);
    expect(Math.abs(window.sunset! - Date.parse('2026-06-21T20:21:00Z'))).toBeLessThan(5 * minute);
  });

  it('preserves the requested local date across the international date line', () => {
    const zone = 'Pacific/Kiritimati';
    const window = daylightWindow('2026-10-15', zone, { latitude: 1.8721, longitude: -157.4278 });
    expect(window.status).toBe('normal');
    expect(dateInZone(window.sunrise!, zone)).toBe('2026-10-15');
    expect(dateInZone(window.sunset!, zone)).toBe('2026-10-15');
    expect(dateInZone(window.sunrise!, 'UTC')).toBe('2026-10-14');
    expect(window.sunrise!).toBeGreaterThan(localToInstant('2026-10-15T05:00', zone));
    expect(window.sunrise!).toBeLessThan(localToInstant('2026-10-15T07:00', zone));
  });

  it('uses the local southern-hemisphere date when sunrise is on the previous UTC date', () => {
    const window = daylightWindow('2026-12-21', 'Australia/Sydney', { latitude: -33.8688, longitude: 151.2093 });
    expect(window.status).toBe('normal');
    expect(Math.abs(window.sunrise! - Date.parse('2026-12-20T18:41:00Z'))).toBeLessThan(5 * minute);
    expect(Math.abs(window.sunset! - Date.parse('2026-12-21T09:06:00Z'))).toBeLessThan(5 * minute);
    expect(dateInZone(window.sunrise!, 'Australia/Sydney')).toBe('2026-12-21');
  });

  it('classifies polar day and night without invented sunrise times', () => {
    const tromso = { latitude: 69.6492, longitude: 18.9553 };
    expect(daylightWindow('2026-06-21', 'Europe/Oslo', tromso)).toEqual({ status: 'polar-day' });
    expect(daylightWindow('2026-12-21', 'Europe/Oslo', tromso)).toEqual({ status: 'polar-night' });
    expect(daylightWindow('2026-12-21', 'UTC', { latitude: -90, longitude: 0 })).toEqual({ status: 'polar-day' });
    expect(daylightWindow('2026-06-21', 'UTC', { latitude: -90, longitude: 0 })).toEqual({ status: 'polar-night' });
  });

  it('reports unknown for missing, invalid, or unusable location information', () => {
    const examples = [undefined, {}, { latitude: 51 }, { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: 181 }, { latitude: NaN, longitude: 0 }, { latitude: 0, longitude: Infinity }];
    for (const coords of examples) expect(daylightWindow('2026-06-21', 'Europe/London', coords)).toEqual({ status: 'unknown' });
    expect(daylightWindow('2026-02-30', 'UTC', london)).toEqual({ status: 'unknown' });
    expect(daylightWindow('2026-06-21', 'Invalid/Zone', london)).toEqual({ status: 'unknown' });
    expect(daylightWindow('2011-12-30', 'Pacific/Apia', london)).toEqual({ status: 'unknown' });
  });
});

describe('daylight recommendation feasibility', () => {
  it('splits a sunrise crossing into indoor and outdoor opportunities', () => {
    const date = '2026-06-21';
    const zone = 'Europe/London';
    const sunrise = daylightWindow(date, zone, london).sunrise!;
    const start = sunrise - 30 * minute;
    const end = sunrise + 30 * minute;
    expect(splitDaylight({ start, end }, date, zone, london)).toEqual([
      { start, end: sunrise, feasibility: 'indoor' },
      { start: sunrise, end, feasibility: 'daylight' },
    ]);
    expect(daylightFeasibility(start, end, date, zone, london)).toBe('indoor');
    expect(daylightFeasibility(sunrise, end, date, zone, london)).toBe('daylight');
  });

  it('splits sunset and preserves every millisecond of an overnight interval', () => {
    const date = '2026-06-21';
    const zone = 'Europe/London';
    const sunset = daylightWindow(date, zone, london).sunset!;
    const start = sunset - 30 * minute;
    const end = localToInstant('2026-06-22T08:00', zone);
    const segments = splitDaylight({ start, end }, date, zone, london);
    expect(segments[0]).toEqual({ start, end: sunset, feasibility: 'daylight' });
    expect(segments.map(segment => segment.feasibility)).toEqual(['daylight', 'indoor', 'daylight']);
    expect(segments[0].start).toBe(start);
    expect(segments.at(-1)!.end).toBe(end);
    expect(segments.reduce((duration, segment) => duration + segment.end - segment.start, 0)).toBe(end - start);
    for (let i = 1; i < segments.length; i++) expect(segments[i].start).toBe(segments[i - 1].end);
  });

  it('supports actual DST day lengths rather than assuming 24 hours', () => {
    for (const date of ['2026-03-29', '2026-10-25']) {
      const next = date === '2026-03-29' ? '2026-03-30' : '2026-10-26';
      const start = localToInstant(`${date}T00:00`, 'Europe/London');
      const end = localToInstant(`${next}T00:00`, 'Europe/London');
      const segments = splitDaylight({ start, end }, date, 'Europe/London', london);
      expect(segments.map(segment => segment.feasibility)).toEqual(['indoor', 'daylight', 'indoor']);
      expect(segments.reduce((duration, segment) => duration + segment.end - segment.start, 0)).toBe(end - start);
    }
  });

  it('labels polar and unknown opportunities explicitly', () => {
    const coords = { latitude: 69.6492, longitude: 18.9553 };
    const start = localToInstant('2026-06-21T00:00', 'Europe/Oslo');
    const end = start + 12 * 60 * minute;
    expect(daylightFeasibility(start, end, '2026-06-21', 'Europe/Oslo', coords)).toBe('daylight');
    const winterStart = localToInstant('2026-12-21T12:00', 'Europe/Oslo');
    expect(daylightFeasibility(winterStart, winterStart + minute, '2026-12-21', 'Europe/Oslo', coords)).toBe('indoor');
    expect(daylightFeasibility(start, end, '2026-06-21', 'Europe/Oslo')).toBe('unknown');
    expect(daylightFeasibility(start, start, '2026-06-21', 'Europe/Oslo', coords)).toBe('unknown');
    expect(splitDaylight({ start, end: Infinity }, '2026-06-21', 'Europe/Oslo', coords)).toEqual([]);
  });
});
