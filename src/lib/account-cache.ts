import { openDB } from 'idb';
import type { AppData } from './types';
import type { SyncSnapshot } from './store';
import { DEFAULT_PREFERENCES } from './defaults';
import { mergeAppData } from './merge';
import { hasContentChanges } from './sync';
import { isAppData } from './validation';

/** An offline document, its actual server baseline, and unsaved edits commit together. */
export interface AccountCache {
  version: 1;
  data: AppData;
  baseline: SyncSnapshot | null;
  pending: boolean;
  conflict?: { cloud: SyncSnapshot; reasons: string[] };
  /** Journal generations actually reviewed by this view, never authentication data. */
  observedDrafts?: Record<string, string>;
}
export interface CacheSaveOptions { resolvedDrafts?: Record<string, string> }
export interface CacheReceipt { writerId: string; generation: string | null }
interface Journal { generation: string; entry: AccountCache }
interface Envelope extends AccountCache { journals?: Record<string, Journal> }
const database = () => openDB('rephase-account-cache', 1, { upgrade(db) { db.createObjectStore('accounts'); } });
const emptyData = (): AppData => ({ schemaVersion: 1, preferences: { ...DEFAULT_PREFERENCES }, trips: [], selectedTripId: null });
const sameContent = (a: AppData, b: AppData) => !hasContentChanges(a, b);
const snapshotValid = (snapshot: SyncSnapshot | null | undefined) => snapshot === null || Boolean(snapshot && Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0 && (snapshot.data === null || isAppData(snapshot.data)));
function validCache(value: unknown): value is AccountCache {
  const entry = value as Partial<AccountCache> | null, conflict = entry?.conflict;
  return Boolean(entry && entry.version === 1 && typeof entry.pending === 'boolean' && isAppData(entry.data)
    && snapshotValid(entry.baseline) && (!conflict || (conflict.cloud && snapshotValid(conflict.cloud) && Array.isArray(conflict.reasons) && conflict.reasons.every(reason => typeof reason === 'string'))));
}
function documentOnly(entry: AccountCache): AccountCache {
  return { version: 1, data: entry.data, baseline: entry.baseline, pending: entry.pending, ...(entry.conflict ? { conflict: entry.conflict } : {}) };
}
function readEnvelope(value: unknown): { envelope: Envelope; journals: Record<string, Journal>; migrated: boolean } {
  if (!validCache(value)) throw new Error('The account’s offline copy has an unsupported format.');
  const envelope = value as Envelope;
  const journals = envelope.journals ?? {};
  if (typeof journals !== 'object' || journals === null || Array.isArray(journals)
    || Object.values(journals).some(journal => !journal || typeof journal.generation !== 'string' || !validCache(journal.entry) || !journal.entry.pending)) {
    throw new Error('The account’s offline drafts have an unsupported format.');
  }
  // Upgrade a previously saved single-writer draft without deleting its recovery copy.
  const migrated = envelope.journals === undefined && envelope.pending;
  if (migrated) journals.legacy = { generation: crypto.randomUUID(), entry: documentOnly(envelope) };
  return { envelope, journals, migrated };
}
function newestSnapshot(...snapshots: (SyncSnapshot | null | undefined)[]): SyncSnapshot | null {
  return snapshots.reduce<SyncSnapshot | null>((latest, snapshot) => snapshot && (!latest || snapshot.revision > latest.revision) ? snapshot : latest, null);
}
/** A server snapshot proves inclusion only when every draft change is already present. */
function included(journal: Journal, snapshot: SyncSnapshot | null): boolean {
  if (!snapshot?.data) return false;
  if (!journal.entry.baseline?.data) return sameContent(journal.entry.data, snapshot.data);
  const merged = mergeAppData(journal.entry.baseline.data, journal.entry.data, snapshot.data);
  return merged.conflicts.length === 0 && sameContent(merged.data, snapshot.data);
}
function aggregate(view: AccountCache, journals: Record<string, Journal>, writerId: string): AccountCache {
  const draftEntries = Object.entries(journals).sort(([a], [b]) => a === writerId ? 1 : b === writerId ? -1 : a.localeCompare(b));
  const baseline = newestSnapshot(view.baseline, ...draftEntries.map(([, journal]) => journal.entry.baseline));
  let data = baseline?.data ?? (baseline ? emptyData() : view.data);
  const reasons: string[] = [];
  for (const [, journal] of draftEntries) {
    const draft = journal.entry;
    if (draft.conflict) reasons.push(...draft.conflict.reasons);
    if (!draft.baseline?.data) {
      if (sameContent(data, draft.data)) continue;
      if (draft.baseline && draft.baseline.data === null && baseline?.data === null && draft.baseline.revision === baseline.revision) {
        const merged = mergeAppData(emptyData(), draft.data, data);
        data = merged.data; reasons.push(...merged.conflicts);
      } else if (draftEntries.length === 1 && !baseline) data = draft.data;
      else { data = draft.data; reasons.push('Unsaved changes in another tab have no common saved version'); }
    } else {
      if (baseline?.data === null && baseline.revision > draft.baseline.revision) reasons.push('Saved account data was deleted while another tab has unsaved changes');
      const merged = mergeAppData(draft.baseline.data, draft.data, data);
      data = merged.data; reasons.push(...merged.conflicts);
    }
  }
  const pending = draftEntries.length > 0;
  const observedDrafts = Object.fromEntries(draftEntries.map(([id, journal]) => [id, journal.generation]));
  const cloud = baseline ?? draftEntries.find(([, journal]) => journal.entry.conflict)?.[1].entry.conflict?.cloud ?? { data: null, revision: 0 };
  return { version: 1, data, baseline, pending, ...(reasons.length ? { conflict: { cloud, reasons: [...new Set(reasons)] } } : {}), ...(pending ? { observedDrafts } : {}) };
}

/** Each browser tab owns a journal; IndexedDB serializes read/modify/write across clients. */
export function createAccountCacheClient(writerId = crypto.randomUUID()) {
  const writes = new Map<string, Promise<unknown>>();
  const write = <T,>(id: string, operation: () => Promise<T>): Promise<T> => {
    const next = (writes.get(id) ?? Promise.resolve()).catch(() => {}).then(operation);
    writes.set(id, next);
    void next.finally(() => { if (writes.get(id) === next) writes.delete(id); }).catch(() => {});
    return next;
  };
  return {
    async load(id: string): Promise<AccountCache | null> {
      await writes.get(id)?.catch(() => {});
      const db = await database();
      try {
        const tx = db.transaction('accounts', 'readwrite');
        const value: unknown = await tx.store.get(id);
        if (value === undefined) { await tx.done; return null; }
        const { envelope, journals, migrated } = readEnvelope(value);
        if (migrated) await tx.store.put({ ...envelope, journals }, id);
        await tx.done;
        return aggregate(envelope, journals, writerId);
      } finally { db.close(); }
    },
    save(id: string, entry: AccountCache, options: CacheSaveOptions = {}): Promise<CacheReceipt> {
      if (!validCache(entry)) return Promise.reject(new Error('The offline account copy is invalid.'));
      const copy = structuredClone(documentOnly(entry)), resolved = structuredClone(options.resolvedDrafts ?? {});
      return write(id, async () => {
        const db = await database();
        try {
          const tx = db.transaction('accounts', 'readwrite');
          const value: unknown = await tx.store.get(id);
          const stored = value === undefined ? null : readEnvelope(value);
          const journals = stored?.journals ?? {};
          for (const [id, generation] of Object.entries(resolved)) if (journals[id]?.generation === generation) delete journals[id];
          if (copy.pending) journals[writerId] = { generation: crypto.randomUUID(), entry: copy };
          const baseline = newestSnapshot(stored?.envelope.baseline, copy.baseline, ...Object.values(journals).map(journal => journal.entry.baseline));
          for (const [id, journal] of Object.entries(journals)) if (included(journal, baseline)) delete journals[id];
          // Keep the newest accepted snapshot even when a slower tab finishes an old read later.
          const view: AccountCache = { version: 1, data: baseline?.data ?? (baseline ? emptyData() : copy.data), baseline, pending: false };
          await tx.store.put({ ...aggregate(view, journals, writerId), journals }, id);
          await tx.done;
          return { writerId, generation: journals[writerId]?.generation ?? null };
        } finally { db.close(); }
      });
    },
    clear(id: string, options: { discardPending?: boolean } = {}): Promise<void> {
      return write(id, async () => {
        const db = await database();
        try {
          const tx = db.transaction('accounts', 'readwrite');
          const value: unknown = await tx.store.get(id);
          if (value !== undefined && !options.discardPending) {
            const { journals } = readEnvelope(value);
            if (Object.keys(journals).length) { await tx.done; throw new Error('Another tab has unsaved changes. Save them before clearing the offline copy.'); }
          }
          await tx.store.delete(id); await tx.done;
        } finally { db.close(); }
      });
    },
  };
}
const client = createAccountCacheClient();
export const loadAccountCache = client.load;
export const saveAccountCache = client.save;
export const clearAccountCache = client.clear;
