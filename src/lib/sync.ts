import { ApiError } from './auth';
import { mergeAppData } from './merge';
import type { AppData } from './types';
import type { SyncSnapshot } from './store';
import { isAppData } from './validation';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
export const sameData = (a: AppData | null, b: AppData | null) => canonical(a) === canonical(b);
/** Trip selection is device navigation, not a reason to resume uploads after deletion. */
export const hasContentChanges = (a:AppData,b:AppData) => !sameData({...a,selectedTripId:null},{...b,selectedTripId:null});
export type SyncResult =
  | { kind: 'accepted'; data: AppData; snapshot: SyncSnapshot }
  | { kind: 'deleted'; snapshot: SyncSnapshot }
  | { kind: 'conflict'; cloud: SyncSnapshot; conflicts: string[] };
export interface SyncTransport {
  get(): Promise<SyncSnapshot>;
  put(data: AppData, revision: number): Promise<{ revision: number }>;
}
/**
 * Fetch before uploading, merge only with a known baseline, and retry one
 * optimistic conflict. The caller verifies account identity before calling;
 * transport state requests must also carry the expected-account header.
 */
export async function reconcileSync(local: AppData, baseline: SyncSnapshot | null, transport: SyncTransport, explicit = false): Promise<SyncResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cloud = await transport.get();
    if (!cloud || !Number.isSafeInteger(cloud.revision) || cloud.revision < 0 || !(cloud.data === null || isAppData(cloud.data))) throw new Error('Cloud returned an invalid sync snapshot.');
    let merged = local;
    if (sameData(local, cloud.data)) return { kind: 'accepted', data: local, snapshot: cloud };
    if (cloud.data === null) {
      if (baseline?.data && !explicit) {
        if (hasContentChanges(local, baseline.data)) return { kind: 'conflict', cloud, conflicts: ['Cloud data was deleted while this device has edits'] };
        return { kind: 'deleted', snapshot: cloud };
      }
    } else if (!baseline?.data) {
      return { kind: 'conflict', cloud, conflicts: ['This device has no saved common sync history'] };
    } else {
      const result = mergeAppData(baseline.data, local, cloud.data);
      if (result.conflicts.length) return { kind: 'conflict', cloud, conflicts: result.conflicts };
      merged = result.data;
    }
    if (cloud.data && !hasContentChanges(merged,cloud.data)) return { kind: 'accepted', data: merged, snapshot: cloud };
    try {
      const uploaded = await transport.put(merged, cloud.revision);
      if (!Number.isSafeInteger(uploaded.revision) || uploaded.revision < 0) throw new Error('Cloud returned an invalid revision.');
      return { kind: 'accepted', data: merged, snapshot: { data: structuredClone(merged), revision: uploaded.revision } };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      if (attempt === 1) {
        return { kind: 'conflict', cloud: await transport.get(), conflicts: ['Cloud changed repeatedly; review the copies before syncing'] };
      }
    }
  }
  throw new Error('Unexpected sync state.');
}

/** Merge edits made during an upload without replacing them with its old payload. */
export function foldInFlightEdits(sentLocal:AppData, latestLocal:AppData, acceptedCloud:AppData) {
  return mergeAppData(sentLocal,latestLocal,acceptedCloud);
}
