import { openDB } from 'idb';
import type { Account, AppData, Preferences, Trip } from './types';

const validTime = (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const validZone = (v: unknown) => {
  if (typeof v !== 'string' || v.length > 100) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: v }).format(); return true; } catch { return false; }
};
function isPreferences(v: unknown): v is Preferences {
  if (!v || typeof v !== 'object') return false;
  const p = v as Preferences;
  return validZone(p.homeTimeZone) && ['early','intermediate','late','unsure'].includes(p.chronotype)
    && [p.usualBedtime,p.usualWakeTime,p.preferredBedtime,p.preferredWakeTime].every(validTime)
    && Number.isFinite(p.sleepHours) && p.sleepHours >= 4 && p.sleepHours <= 12
    && ['bed','wake'].includes(p.sleepAnchor)
    && [p.caffeine,p.melatonin,p.melatoninAcknowledged].every(x => typeof x === 'boolean')
    && Number.isInteger(p.preparationDays) && p.preparationDays >= 0 && p.preparationDays <= 7;
}
function isTrip(v: unknown): v is Trip {
  if (!v || typeof v !== 'object') return false;
  const t = v as Trip;
  return typeof t.id === 'string' && t.id.length > 0 && t.id.length <= 128
    && typeof t.name === 'string' && t.name.length <= 200
    && typeof t.createdAt === 'string' && Number.isFinite(Date.parse(t.createdAt))
    && typeof t.updatedAt === 'string' && Number.isFinite(Date.parse(t.updatedAt))
    && Array.isArray(t.legs) && t.legs.length >= 1 && t.legs.length <= 40
    && new Set(t.legs.map(l => l?.id)).size === t.legs.length
    && t.legs.every(l => l && typeof l.id === 'string' && l.id.length > 0 && l.id.length <= 128
      && typeof l.flightNumber === 'string' && l.flightNumber.length <= 30
      && [l.departureAirport,l.arrivalAirport].every(a => typeof a === 'string' && (a === '' || /^[A-Z0-9]{3,4}$/.test(a)))
      && [l.departureDateTime,l.arrivalDateTime].every(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d))
      && validZone(l.departureTimeZone) && validZone(l.arrivalTimeZone)
      && (l.travelClass===undefined || ['economy','premium-economy','business','first'].includes(l.travelClass))
      && (l.lieFlat===undefined || typeof l.lieFlat==='boolean')
      && ['connection','destination'].includes(l.stayAfter) && ['adapt','partial','home'].includes(l.strategy));
}
export function isAppData(v: unknown): v is AppData {
  if (!v || typeof v !== 'object') return false;
  const d = v as AppData;
  return d.schemaVersion === 1 && isPreferences(d.preferences)
    && Array.isArray(d.trips) && d.trips.length <= 100 && d.trips.every(isTrip)
    && new Set(d.trips.map(t => t.id)).size === d.trips.length
    && (d.selectedTripId === null || d.trips.some(t => t.id === d.selectedTripId));
}
const keyFor = (accountId: string | null) => accountId ? `account:${accountId}` : 'guest';
const db = () => openDB('rephase', 1, { upgrade(database) { database.createObjectStore('state'); } });
export async function loadData(accountId: string | null): Promise<AppData | null> {
  const database = await db();
  try {
    const data: unknown = await database.get('state', keyFor(accountId));
    if (data === undefined) return null;
    if (!isAppData(data)) throw new Error('Saved data has an unsupported format. Export or clear this device’s data before starting again.');
    return data;
  } finally { database.close(); }
}
export async function saveData(accountId: string | null, data: AppData): Promise<void> {
  if (!isAppData(data)) throw new Error('The data could not be saved because it has an invalid format.');
  const database = await db();
  try { await database.put('state', data, keyFor(accountId)); } finally { database.close(); }
}
export async function clearData(accountId: string | null): Promise<void> {
  const database = await db();
  try {
    await database.delete('state', keyFor(accountId));
    await database.delete('state', `revision:${keyFor(accountId)}`);
  } finally { database.close(); }
}
export async function loadRevision(accountId: string): Promise<number | null> {
  const database = await db();
  try {
    const revision: unknown = await database.get('state', `revision:${keyFor(accountId)}`);
    return typeof revision === 'number' && Number.isInteger(revision) && revision >= 0 ? revision : null;
  } finally { database.close(); }
}
export async function saveRevision(accountId: string, revision: number): Promise<void> {
  const database = await db();
  try { await database.put('state', revision, `revision:${keyFor(accountId)}`); } finally { database.close(); }
}
// A local display/namespace pointer only. This is never used to authorize the API.
export async function loadLastAccount(): Promise<Account | null> {
  const database=await db();
  try {
    const account=await database.get('state','lastAccount') as Account|undefined;
    return account && typeof account.id==='string' && account.id.length>0 && account.id.length<=255
      && typeof account.name==='string' && typeof account.email==='string' ? account : null;
  } finally {database.close();}
}
export async function saveLastAccount(account: Account|null): Promise<void> {
  const database=await db();
  try {
    if(account)await database.put('state',account,'lastAccount');
    else await database.delete('state','lastAccount');
  } finally {database.close();}
}
