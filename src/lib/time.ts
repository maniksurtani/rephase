import { Temporal } from '@js-temporal/polyfill';

/** Flight times need an explicit local date and zone. A fold needs an explicit choice; gaps are never valid. */
export function localToInstant(local: string, zone: string, choice?: 'earlier' | 'later'): number {
  if (choice !== undefined && choice !== 'earlier' && choice !== 'later') {
    throw new RangeError('Choose the earlier or later occurrence of an ambiguous local time.');
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local)) {
    throw new RangeError('Use a local date and time without a UTC offset.');
  }
  const clock = Temporal.PlainDateTime.from(local, { overflow: 'reject' });
  const earlier = clock.toZonedDateTime(zone, { disambiguation: 'earlier' });
  const later = clock.toZonedDateTime(zone, { disambiguation: 'later' });
  // Temporal's earlier/later options also move nonexistent clocks across the gap.
  // A user's fold choice must not silently invent a flight time in that gap.
  if (!earlier.toPlainDateTime().equals(clock) || !later.toPlainDateTime().equals(clock)) {
    throw new RangeError('This local time does not exist because the clock changes.');
  }
  if (earlier.epochMilliseconds !== later.epochMilliseconds && choice === undefined) {
    throw new RangeError('This local time occurs twice; choose its earlier or later occurrence.');
  }
  return (choice === 'later' ? later : earlier).epochMilliseconds;
}

function zoned(instant: string | number, zone: string) {
  return (typeof instant === 'number'
    ? Temporal.Instant.fromEpochMilliseconds(instant)
    : Temporal.Instant.from(instant)).toZonedDateTimeISO(zone);
}

export function dateInZone(instant: string | number, zone: string): string {
  return zoned(instant, zone).toPlainDate().toString();
}

export function formatTime(instant: string | number, zone: string): string {
  return zoned(instant, zone).toPlainTime().toString({ smallestUnit: 'minute' });
}
