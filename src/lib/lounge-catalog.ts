import seedCatalog from 'virtual:lounge-catalog';
import validate from 'virtual:lounge-validator';
import type { AirportLoungeData } from './lounge-types';
import type { Trip } from './types';

export interface LoungeCatalogEntry {
  airport: string;
  timeZone: string;
  updatedAt: string;
  version: string;
  path: string;
}
export interface LoungeCatalog {
  schemaVersion: 1;
  airports: LoungeCatalogEntry[];
}
export const LOUNGE_CATALOG = seedCatalog;
export const CATALOG_PATH = '/lounge-data/v1/manifest.json';
export const GUIDE_LIMIT = 1024 * 1024;
export const CATALOG_LIMIT = 2 * 1024 * 1024;
export const CATALOG_TTL = 24 * 60 * 60 * 1000;
export const safeHttps = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};
export function parseCatalog(value: unknown): LoungeCatalog {
  const catalog = value as LoungeCatalog;
  if (
    !catalog ||
    catalog.schemaVersion !== 1 ||
    !Array.isArray(catalog.airports) ||
    catalog.airports.length > 10000
  )
    throw new Error('Unsupported lounge catalog.');
  const codes = new Set<string>();
  for (const item of catalog.airports) {
    if (
      !item ||
      !/^[A-Z]{3}$/.test(item.airport) ||
      codes.has(item.airport) ||
      typeof item.timeZone !== 'string' ||
      item.timeZone.length > 100 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(item.updatedAt) ||
      !/^[a-f0-9]{64}$/.test(item.version) ||
      item.path !== `/lounge-data/v1/airports/${item.airport}.${item.version}.json`
    )
      throw new Error('Invalid lounge catalog.');
    codes.add(item.airport);
  }
  return catalog;
}
export function parseGuide(value: unknown, airport: string): AirportLoungeData {
  if (!validate(value)) throw new Error('Unsupported lounge guide.');
  const data = value as AirportLoungeData;
  if (data.airport !== airport) throw new Error('Guide belongs to another airport.');
  try {
    new Intl.DateTimeFormat('en', { timeZone: data.timeZone });
  } catch {
    throw new Error('Invalid guide timezone.');
  }
  for (const lounge of data.lounges) {
    const links = [
      ...lounge.sources,
      ...(lounge.qualityRating?.sources ?? []),
      ...(lounge.photoLinks ?? []),
    ];
    if (
      !lounge.id.startsWith(`${airport.toLowerCase()}-`) ||
      links.some((link) => !safeHttps(link.url)) ||
      lounge.photos.some(
        (photo) =>
          !photo.path.startsWith(`/lounges/${lounge.id}/`) ||
          /\.\.|[\\%]/.test(photo.path) ||
          !safeHttps(photo.sourceUrl),
      )
    )
      throw new Error('Invalid guide links.');
  }
  return data;
}
/** Prefetch all airports of upcoming/in-progress saved trips, not historical travel. */
export function loungeTripAirports(trips: readonly Trip[], now = Date.now()): string[] {
  const cutoff = new Date(now - 2 * 86400000).toISOString().slice(0, 10);
  return [
    ...new Set(
      trips
        .filter((trip) => trip.legs.some((leg) => leg.arrivalDateTime.slice(0, 10) >= cutoff))
        .flatMap((trip) => trip.legs.flatMap((leg) => [leg.departureAirport, leg.arrivalAirport])),
    ),
  ]
    .filter((code) => /^[A-Z]{3}$/.test(code))
    .sort();
}
