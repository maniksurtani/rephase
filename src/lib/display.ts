import { findAirport } from './airports';

export function time(iso: string, zone: string) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: zone,
    }).format(new Date(iso));
  } catch {
    return '—';
  }
}
export function dateLabel(date: string, style: 'long' | 'short' = 'short') {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: style === 'long' ? 'long' : 'short',
      day: 'numeric',
      month: style === 'long' ? 'long' : 'short',
      timeZone: 'UTC',
    }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
  } catch {
    return date;
  }
}
export function localDate(iso: string | Date, zone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: zone,
    }).formatToParts(new Date(iso));
    return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}-${parts.find((p) => p.type === 'day')?.value}`;
  } catch {
    return '';
  }
}
export function zoneName(zone: string, at?: string) {
  try {
    return (
      new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'short' })
        .formatToParts(at ? new Date(at) : new Date())
        .find((p) => p.type === 'timeZoneName')?.value ?? zone
    );
  } catch {
    return zone;
  }
}
export function airportCity(code: string) {
  return findAirport(code)?.city ?? code;
}
export function plural(value: number, text: string) {
  return `${value} ${text}${value === 1 ? '' : 's'}`;
}
export function phaseChangeLabel(hours: number) {
  if (!Number.isFinite(hours)) return 'Unavailable';
  if (hours === 0) return 'Nearly steady';
  const minutes = Math.abs(hours) * 60;
  const amount =
    minutes < 5
      ? 'Under 5 min'
      : minutes < 60
        ? `About ${Math.round(minutes / 5) * 5} min`
        : `About ${Math.round(Math.abs(hours) * 10) / 10} h`;
  return `${amount} ${hours > 0 ? 'earlier' : 'later'}`;
}
export function remainingAdjustmentLabel(hours: number) {
  if (!Number.isFinite(hours) || hours < 0) return 'Unavailable';
  if (hours < 0.25) return 'Under 15 min';
  return hours < 1
    ? `About ${Math.round(hours * 12) * 5} min`
    : `About ${Math.round(hours * 10) / 10} h`;
}
export function sleepSpan(bed: string, wake: string) {
  const toMins = (v: string) => {
    const [h, m] = v.split(':').map(Number);
    return h * 60 + m;
  };
  return ((toMins(wake) - toMins(bed) + 1440) % 1440) / 60;
}
