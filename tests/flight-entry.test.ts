import { describe, expect, it } from 'vitest';
import { departureTimeEdit, minuteDateTimeValue } from '../src/lib/flight-entry';
import { localToInstant } from '../src/lib/time';

describe('flight date and time entry', () => {
  it('starts an empty arrival at the same local date and time without interpreting time zones', () => {
    const edit = departureTimeEdit({ arrivalDateTime: '' }, '2027-02-16T23:45');
    expect(edit.patch).toEqual({ departureDateTime: '2027-02-16T23:45', arrivalDateTime: '2027-02-16T23:45' });
    // Flights across the date line can arrive on a different calendar day; no duration is invented here.
    expect(edit.state).toEqual({ mode: 'automatic', value: '2027-02-16T23:45' });
  });

  it('keeps the default arrival in step while the departure date and time are being entered', () => {
    const first = departureTimeEdit({ arrivalDateTime: '' }, '2027-02-16T09:00');
    const next = departureTimeEdit({ arrivalDateTime: first.patch.arrivalDateTime! }, '2027-02-17T10:30', first.state);
    expect(next.patch.arrivalDateTime).toBe('2027-02-17T10:30');
  });

  it('preserves an existing booked arrival even if its wall clock equals the old departure', () => {
    const edit = departureTimeEdit({ arrivalDateTime: '2027-02-16T09:00' }, '2027-02-17T10:30');
    expect(edit.patch).toEqual({ departureDateTime: '2027-02-17T10:30' });
  });

  it('stops defaulting after any explicit arrival edit, including clearing or keeping the same value', () => {
    for (const arrivalDateTime of ['', '2027-02-16T09:00', '2027-02-17T11:45']) {
      const edit = departureTimeEdit({ arrivalDateTime }, '2027-02-18T10:30', { mode: 'manual' });
      expect(edit.patch).toEqual({ departureDateTime: '2027-02-18T10:30' });
    }
  });

  it('preserves provider arrivals and any arrival changed outside the defaulting flow', () => {
    const automatic = { mode: 'automatic' as const, value: '2027-02-16T09:00' };
    const provider = departureTimeEdit({ arrivalDateTime: '2027-02-16T09:00:45', flightSource: 'aerodatabox' }, '2027-02-18T10:30', automatic);
    const changed = departureTimeEdit({ arrivalDateTime: '2027-02-17T11:45' }, '2027-02-18T10:30', automatic);
    expect(provider.patch).not.toHaveProperty('arrivalDateTime');
    expect(changed.patch).not.toHaveProperty('arrivalDateTime');
  });

  it('displays minute clocks while preserving untouched provider instants with seconds', () => {
    const departure = '2027-02-16T09:00:45';
    expect(minuteDateTimeValue(departure)).toBe('2027-02-16T09:00');
    expect(minuteDateTimeValue()).toBe('');
    expect(localToInstant(departure, 'UTC')).toBe(Date.parse('2027-02-16T09:00:45Z'));
    expect(localToInstant(departure, 'UTC') - localToInstant(minuteDateTimeValue(departure), 'UTC')).toBe(45_000);
  });
});
