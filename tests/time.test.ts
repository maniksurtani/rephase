import { describe, expect, it } from 'vitest';
import { dateInZone, formatTime, localToInstant } from '../src/lib/time';

describe('time conversion', () => {
  it('rejects both ambiguous and nonexistent daylight-saving clocks', () => {
    expect(() => localToInstant('2026-11-01T01:30', 'America/New_York')).toThrow();
    expect(() => localToInstant('2026-03-08T02:30', 'America/New_York')).toThrow();
    expect(localToInstant('2026-11-01T03:30', 'America/New_York')).toBe(Date.parse('2026-11-01T08:30:00Z'));
  });
  it('handles fractional offsets without rounding', () => {
    const instant = localToInstant('2026-10-14T09:15', 'Asia/Kathmandu');
    expect(instant).toBe(Date.parse('2026-10-14T03:30:00Z'));
    expect(formatTime(instant, 'Asia/Kathmandu')).toBe('09:15');
  });
  it('handles the date line and dates in each display zone', () => {
    const instant = localToInstant('2026-10-15T08:00', 'Pacific/Kiritimati');
    expect(dateInZone(instant, 'Pacific/Honolulu')).toBe('2026-10-14');
    expect(formatTime(instant, 'Pacific/Honolulu')).toBe('08:00');
  });
  it('requires offset-free local date/time and a valid zone', () => {
    expect(() => localToInstant('2026-10-14T10:00Z', 'UTC')).toThrow();
    expect(() => localToInstant('2026-10-14T10:00', 'Invalid/Zone')).toThrow();
  });
});
