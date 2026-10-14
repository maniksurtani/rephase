import { describe, expect, it } from 'vitest';
import { dateInZone, formatTime, localToInstant } from '../src/lib/time';

describe('time conversion', () => {
  it('rejects both ambiguous and nonexistent daylight-saving clocks', () => {
    expect(() => localToInstant('2026-11-01T01:30', 'America/New_York')).toThrow();
    expect(() => localToInstant('2026-03-08T02:30', 'America/New_York')).toThrow();
    expect(localToInstant('2026-11-01T03:30', 'America/New_York')).toBe(Date.parse('2026-11-01T08:30:00Z'));
  });
  it('accepts an explicit occurrence of a repeated clock', () => {
    expect(localToInstant('2026-11-01T01:30', 'America/New_York', 'earlier')).toBe(Date.parse('2026-11-01T05:30:00Z'));
    expect(localToInstant('2026-11-01T01:30', 'America/New_York', 'later')).toBe(Date.parse('2026-11-01T06:30:00Z'));
    expect(localToInstant('2026-11-01T03:30', 'America/New_York', 'later')).toBe(Date.parse('2026-11-01T08:30:00Z'));
  });
  it('does not turn a fold preference into permission to shift a nonexistent clock', () => {
    for (const choice of ['earlier', 'later'] as const) {
      expect(() => localToInstant('2026-03-08T02:30', 'America/New_York', choice)).toThrow(/does not exist/);
      expect(() => localToInstant('2011-12-30T12:00', 'Pacific/Apia', choice)).toThrow(/does not exist/);
    }
  });
  it('preserves half-hour changes in Lord Howe Island', () => {
    const earlier = localToInstant('2026-04-05T01:45', 'Australia/Lord_Howe', 'earlier');
    const later = localToInstant('2026-04-05T01:45', 'Australia/Lord_Howe', 'later');
    expect(earlier).toBe(Date.parse('2026-04-04T14:45:00Z'));
    expect(later - earlier).toBe(30 * 60_000);
    expect(() => localToInstant('2026-10-04T02:15', 'Australia/Lord_Howe', 'earlier')).toThrow(/does not exist/);
  });
  it('rejects invalid runtime occurrence choices and invalid calendar fields', () => {
    expect(() => localToInstant('2026-10-14T10:00', 'UTC', 'first' as 'earlier')).toThrow(/earlier or later/);
    expect(() => localToInstant('2026-02-30T10:00', 'UTC', 'earlier')).toThrow();
    expect(() => localToInstant('2026-10-14T25:00', 'UTC', 'earlier')).toThrow();
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
