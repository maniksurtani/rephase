import { describe, expect, it } from 'vitest';
import { dateLabel, localDate, time } from '../src/lib/display';

describe('recorded history local date and time', () => {
  it.each([
    ['2026-10-18T07:00:00Z', 'Pacific/Honolulu', '2026-10-17', 'Sat 17 Oct', '21:00'],
    ['2026-10-17T15:00:00Z', 'Australia/Sydney', '2026-10-18', 'Sun 18 Oct', '02:00'],
  ])('keeps %s in the calendar date of %s', (instant, zone, date, label, clock) => {
    expect(localDate(instant, zone)).toBe(date);
    expect(dateLabel(localDate(instant, zone))).toBe(label);
    expect(time(instant, zone)).toBe(clock);
  });
});
