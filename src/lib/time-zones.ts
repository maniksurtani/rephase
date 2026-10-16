import { AIRPORTS } from './airports';

export interface TimeZoneOption {
  value: string;
  city: string;
}
interface IndexedTimeZone extends TimeZoneOption {
  terms: string[];
  cities: string[];
}

function searchable(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s_/-]+/g, ' ')
    .trim();
}

/** Resolve valid IANA aliases without changing the user's controlled input. */
export function canonicalTimeZone(value: string): string | null {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

let index: IndexedTimeZone[] | undefined;
function timeZoneIndex() {
  if (index) return index;
  const zones = new Map<string, { city: string; names: Set<string>; cities: Set<string> }>();
  const aliases = new Map<string, string | null>();
  function add(value: string) {
    if (!zones.has(value)) {
      const city =
        value === 'UTC' ? 'Universal time' : value.split('/').at(-1)!.replaceAll('_', ' ');
      zones.set(value, {
        city,
        names: new Set([value, city]),
        cities: new Set([searchable(city)]),
      });
    }
    return zones.get(value)!;
  }
  try {
    if (typeof Intl.supportedValuesOf === 'function')
      for (const zone of Intl.supportedValuesOf('timeZone')) add(zone);
  } catch {
    /* The bundled airport zones support browsers without this Intl API. */
  }
  add('UTC').names.add('Coordinated Universal Time GMT');
  for (const airport of AIRPORTS) {
    if (!aliases.has(airport.timeZone))
      aliases.set(
        airport.timeZone,
        zones.has(airport.timeZone) ? airport.timeZone : canonicalTimeZone(airport.timeZone),
      );
    const canonical = aliases.get(airport.timeZone);
    if (!canonical) continue;
    const zone = add(canonical);
    zone.names.add(airport.timeZone);
    zone.names.add(airport.city);
    zone.cities.add(searchable(airport.city));
  }
  index = [...zones.entries()].map(([value, zone]) => ({
    value,
    city: zone.city,
    terms: [...zone.names].map(searchable),
    cities: [...zone.cities],
  }));
  return index;
}

/** Search airport cities and IANA names locally; keep each canonical zone once. */
export function searchTimeZones(query: string, limit = 8): TimeZoneOption[] {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.min(30, Math.floor(limit))) : 8;
  if (!cap) return [];
  const zones = timeZoneIndex();
  const input = searchable(query);
  if (!input) {
    const popular = [
      'UTC',
      'America/Los_Angeles',
      'America/New_York',
      'Europe/London',
      'Asia/Singapore',
      'Australia/Sydney',
      'Asia/Tokyo',
      'Asia/Dubai',
    ];
    return [...zones]
      .sort((a, b) => {
        const aRank = popular.indexOf(a.value),
          bRank = popular.indexOf(b.value);
        return (
          (aRank < 0 ? popular.length : aRank) - (bRank < 0 ? popular.length : bRank) ||
          a.city.localeCompare(b.city)
        );
      })
      .slice(0, cap)
      .map(({ value, city }) => ({ value, city }));
  }
  const words = input.split(' ');
  const ranked = zones.flatMap((zone) => {
    if (!zone.terms.some((term) => words.every((word) => term.includes(word)))) return [];
    const city = searchable(zone.city),
      name = searchable(zone.value);
    const rank =
      name === input
        ? 0
        : city === input
          ? 1
          : city.startsWith(input)
            ? 2
            : zone.cities.includes(input)
              ? 3
              : name.startsWith(input)
                ? 4
                : 5;
    return [{ zone, rank }];
  });
  // Older preference values such as US/Pacific need not appear in supportedValuesOf.
  const canonical = canonicalTimeZone(query);
  if (canonical) {
    const exact = zones.find((zone) => zone.value === canonical) ?? {
      value: canonical,
      city: canonical.split('/').at(-1)!.replaceAll('_', ' '),
      terms: [],
      cities: [],
    };
    const match = ranked.find((entry) => entry.zone.value === canonical);
    if (match) match.rank = -1;
    else ranked.push({ zone: exact, rank: -1 });
  }
  return ranked
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.zone.city.localeCompare(b.zone.city) ||
        a.zone.value.localeCompare(b.zone.value),
    )
    .slice(0, cap)
    .map(({ zone: { value, city } }) => ({ value, city }));
}
