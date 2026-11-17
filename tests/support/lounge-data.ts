import type { AirportLoungeData } from '../../src/lib/lounge-types';
// Tests inspect the complete source catalog; production only includes its index.
const records = import.meta.glob('../../data/lounges/[A-Z][A-Z][A-Z].json', { eager: true, import: 'default' });
export const LOUNGE_DATA = Object.entries(records).sort(([a], [b]) => a.localeCompare(b)).map(([,data]) => data) as AirportLoungeData[];
export const loungeDataFor = (airport: string) => LOUNGE_DATA.find(data => data.airport === airport.trim().toUpperCase());
