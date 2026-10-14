import { Temporal } from '@js-temporal/polyfill';

/** Flight times need explicit local dates and an IANA zone; ambiguous clocks are rejected. */
export function localToInstant(local: string, zone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local)) {
    throw new RangeError('Use a local date and time without a UTC offset.');
  }
  return Temporal.PlainDateTime.from(local)
    .toZonedDateTime(zone, { disambiguation: 'reject' })
    .epochMilliseconds;
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
