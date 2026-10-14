import { describe, expect, it } from 'vitest';
import { AIRPORTS, findAirport } from '../src/lib/airports';

const offsetMinutes = (code: string, date: string) => {
  const timeZone = findAirport(code)?.timeZone;
  if (!timeZone) throw new Error(`Missing airport: ${code}`);
  const parts = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(date));
  const offset = parts.find(part => part.type === 'timeZoneName')!.value;
  if (offset === 'GMT') return 0;
  const match = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/)!;
  return (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]));
};

describe('bundled worldwide airport data', () => {
  it('contains unique, alphabetically sorted IATA airports with valid coordinates and IANA zones', () => {
    expect(AIRPORTS.length).toBeGreaterThan(7_000);
    expect(new Set(AIRPORTS.map(airport => airport.code)).size).toBe(AIRPORTS.length);
    expect(AIRPORTS.map(airport => airport.code)).toEqual(AIRPORTS.map(airport => airport.code).sort());
    const invalidRecords = AIRPORTS.filter(airport =>
      !/^[A-Z]{3}$/.test(airport.code) || !airport.name ||
      !/^[A-Za-z_]+\/[A-Za-z_\-/]+$/.test(airport.timeZone) ||
      !Number.isFinite(airport.latitude) || !Number.isFinite(airport.longitude) ||
      Math.abs(airport.latitude!) > 90 || Math.abs(airport.longitude!) > 180);
    expect(invalidRecords).toEqual([]);
    const invalidZones: string[] = [];
    for (const timeZone of new Set(AIRPORTS.map(airport => airport.timeZone))) {
      try { new Intl.DateTimeFormat('en', { timeZone }).format(0); }
      catch { invalidZones.push(timeZone); }
    }
    expect(invalidZones).toEqual([]);
  }, 20_000);

  it('preserves tolerant code lookup and returns the bundled airport object', () => {
    expect(findAirport('  sfo  ')).toBe(AIRPORTS.find(airport => airport.code === 'SFO'));
    expect(findAirport('SFO')?.timeZone).toBe('America/Los_Angeles');
    expect(findAirport('---')).toBeUndefined();
    expect(findAirport('')).toBeUndefined();
  });

  it('handles half-hour, quarter-hour, and previously unlisted destination zones', () => {
    expect(findAirport('PBH')?.timeZone).toBe('Asia/Thimphu');
    expect(findAirport('PBH')?.city).toBe('Paro');
    expect(findAirport('CHT')?.timeZone).toBe('Pacific/Chatham');
    expect(findAirport('KTM')?.timeZone).toBe('Asia/Kathmandu');
    expect(findAirport('TAS')).toBeDefined();
    expect(findAirport('MHT')).toBeDefined();
    expect(offsetMinutes('KTM', '2026-07-01T12:00:00Z')).toBe(345);
    expect(offsetMinutes('COK', '2026-07-01T12:00:00Z')).toBe(330);
    expect(offsetMinutes('CHT', '2026-07-01T12:00:00Z')).toBe(765);
    expect(offsetMinutes('CHT', '2026-01-01T12:00:00Z')).toBe(825);
  });

  it('uses local DST rules and opposite sides of the international date line', () => {
    expect(offsetMinutes('LHR', '2026-01-01T12:00:00Z')).toBe(0);
    expect(offsetMinutes('LHR', '2026-07-01T12:00:00Z')).toBe(60);
    expect(offsetMinutes('LDH', '2026-07-01T12:00:00Z')).toBe(630);
    expect(offsetMinutes('LDH', '2026-01-01T12:00:00Z')).toBe(660);
    expect(offsetMinutes('APW', '2026-07-01T12:00:00Z')).toBe(780);
    expect(offsetMinutes('PPG', '2026-07-01T12:00:00Z')).toBe(-660);
  });
});
