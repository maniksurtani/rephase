import type { AirportLoungeData } from './lounge-types';

/** Curated first-party research, checked against schema.json and semantic tests in CI. */
const records = import.meta.glob('../../data/lounges/[A-Z][A-Z][A-Z].json', {
  eager: true,
  import: 'default',
});
export const LOUNGE_DATA = Object.entries(records)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, data]) => data) as readonly AirportLoungeData[];
export const loungeDataFor = (airport: string) =>
  LOUNGE_DATA.find((data) => data.airport === airport.trim().toUpperCase());

export const LOUNGE_AIRLINES = [
  ['QF', 'Qantas'],
  ['AS', 'Alaska Airlines'],
  ['HA', 'Hawaiian Airlines'],
  ['AA', 'American Airlines'],
  ['BA', 'British Airways'],
  ['CX', 'Cathay Pacific'],
  ['JL', 'Japan Airlines'],
  ['QR', 'Qatar Airways'],
  ['FJ', 'Fiji Airways'],
  ['AY', 'Finnair'],
  ['IB', 'Iberia'],
  ['MH', 'Malaysia Airlines'],
  ['UL', 'SriLankan Airlines'],
  ['UA', 'United Airlines'],
  ['NZ', 'Air New Zealand'],
  ['NH', 'ANA'],
  ['SQ', 'Singapore Airlines'],
  ['LH', 'Lufthansa'],
  ['AC', 'Air Canada'],
  ['DL', 'Delta Air Lines'],
  ['AF', 'Air France'],
  ['KL', 'KLM'],
  ['VS', 'Virgin Atlantic'],
  ['JQ', 'Jetstar'],
  ['EK', 'Emirates'],
] as const;
