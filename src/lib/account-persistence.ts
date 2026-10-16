import { ApiError, deleteCloudState, getAccount, getCloudState, putCloudState } from './api';
import {
  clearAccountCache,
  loadAccountCache,
  saveAccountCache,
  type AccountCache,
  type CacheReceipt,
  type CacheSaveOptions,
} from './account-cache';
import { createInitialData, DEFAULT_PREFERENCES } from './defaults';
import {
  clearData,
  loadData,
  loadSyncSnapshot,
  saveData,
  saveLastAccount,
  type SyncSnapshot,
} from './store';
import { foldInFlightEdits, hasContentChanges, reconcileSync, sameData } from './sync';
import type { Account, AppData } from './types';

export const emptyAccountData = (): AppData => ({
  schemaVersion: 1,
  preferences: { ...DEFAULT_PREFERENCES },
  trips: [],
  selectedTripId: null,
});
/** Demo itineraries must not become personal account records during migration. */
function personalAccountData(data: AppData): AppData {
  const trips = data.trips.filter((trip) => !trip.id.startsWith('demo-'));
  return {
    ...data,
    trips,
    selectedTripId: trips.some((trip) => trip.id === data.selectedTripId)
      ? data.selectedTripId
      : (trips[0]?.id ?? null),
  };
}
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'The request could not be completed.';
export interface AccountConflict {
  cloud: SyncSnapshot;
  reasons: string[];
}
export interface PersistenceState {
  account: Account | null;
  data: AppData;
  accountReady: boolean;
  saveStatus: string;
  storageError: string | null;
  conflict: AccountConflict | null;
}
export interface PersistenceServices {
  getAccount: typeof getAccount;
  getCloudState: typeof getCloudState;
  putCloudState: typeof putCloudState;
  deleteCloudState: typeof deleteCloudState;
  loadCache: typeof loadAccountCache;
  saveCache: (
    id: string,
    entry: AccountCache,
    options?: CacheSaveOptions,
  ) => Promise<CacheReceipt | void>;
  clearCache: typeof clearAccountCache;
  loadLegacy: typeof loadData;
  loadLegacyBaseline: typeof loadSyncSnapshot;
  clearLegacy: typeof clearData;
  saveGuest: (data: AppData) => Promise<void>;
  loadGuest: () => Promise<AppData | null>;
  saveLastAccount: typeof saveLastAccount;
  debounceMs: number;
  retryMs: number;
}
const defaultServices: PersistenceServices = {
  getAccount,
  getCloudState,
  putCloudState,
  deleteCloudState,
  loadCache: loadAccountCache,
  saveCache: saveAccountCache,
  clearCache: clearAccountCache,
  loadLegacy: loadData,
  loadLegacyBaseline: loadSyncSnapshot,
  clearLegacy: clearData,
  saveGuest: (data) => saveData(null, data),
  loadGuest: () => loadData(null),
  saveLastAccount,
  debounceMs: 800,
  retryMs: 30_000,
};

/**
 * Signed-in documents are server authoritative. IndexedDB is an offline cache,
 * never an authentication source. Only new, explicitly marked edits are merged
 * back into an account; pre-existing local-first copies cannot replace it.
 */
export class AccountPersistence {
  private state: PersistenceState;
  private entry: AccountCache | null;
  private services: PersistenceServices;
  private listeners = new Set<(state: PersistenceState) => void>();
  private epoch = 0;
  private sequence = 0;
  private activeOperation = 0;
  private pendingRefresh = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private cacheBlocked = new Set<string>();
  private legacyCandidates = new Map<string, AppData>();

  constructor(
    initial: {
      account: Account | null;
      data: AppData;
      cache?: AccountCache | null;
      storageError?: string | null;
    },
    services: Partial<PersistenceServices> = {},
  ) {
    this.services = { ...defaultServices, ...services };
    this.entry = initial.account
      ? (initial.cache ?? { version: 1, data: initial.data, baseline: null, pending: false })
      : null;
    this.state = {
      account: initial.account,
      data: initial.data,
      accountReady: false,
      saveStatus: initial.account ? 'Opening your account…' : 'Saved on this device',
      storageError: initial.storageError ?? null,
      conflict: initial.cache?.conflict ?? null,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: (state: PersistenceState) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<PersistenceState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
  private current(epoch: number) {
    return !this.disposed && this.epoch === epoch;
  }
  private cancelTimer() {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
  private schedule(delay = this.services.debounceMs) {
    this.cancelTimer();
    if (!this.state.accountReady || this.state.conflict) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, delay);
  }
  private storageFailure(error: unknown) {
    this.update({
      storageError: `An offline copy could not be saved in this browser. Online account saving remains available. ${errorMessage(error)}`,
    });
  }
  private async cache(id: string, entry: AccountCache, options?: CacheSaveOptions) {
    if (this.cacheBlocked.has(id)) return;
    try {
      const receipt = await this.services.saveCache(id, entry, options);
      if (receipt && this.state.account?.id === id && this.entry?.data === entry.data) {
        const observedDrafts = { ...this.entry.observedDrafts };
        if (receipt.generation) observedDrafts[receipt.writerId] = receipt.generation;
        else delete observedDrafts[receipt.writerId];
        this.entry = { ...this.entry, observedDrafts };
      }
    } catch (error) {
      this.storageFailure(error);
    }
  }
  private async accountCopy(account: Account) {
    try {
      const cached = await this.services.loadCache(account.id);
      if (cached) {
        this.legacyCandidates.delete(account.id);
        return cached;
      }
      // A legacy device copy is available offline, but is never treated as a
      // new unsaved change. A successful server read replaces it automatically.
      const [legacy, baseline] = await Promise.all([
        this.services.loadLegacy(account.id),
        this.services.loadLegacyBaseline(account.id),
      ]);
      if (legacy) this.legacyCandidates.set(account.id, legacy);
      return {
        version: 1 as const,
        data: legacy ?? emptyAccountData(),
        baseline,
        pending: Boolean(legacy && baseline?.data && hasContentChanges(legacy, baseline.data)),
      };
    } catch (error) {
      this.cacheBlocked.add(account.id);
      this.storageFailure(error);
      return { version: 1 as const, data: emptyAccountData(), baseline: null, pending: false };
    }
  }
  private async adoptAccount(account: Account, epoch: number) {
    const before = this.state;
    const entry = await this.accountCopy(account);
    if (!this.current(epoch)) return false;
    if (
      before.account?.id === account.id &&
      this.state.account?.id === account.id &&
      !sameData(before.data, this.state.data)
    ) {
      // A user can edit while IndexedDB is opening. Apply only those new edits
      // over the cache, keeping any already-pending account edits as well.
      entry.data = foldInFlightEdits(before.data, this.state.data, entry.data).data;
      entry.pending = true;
    }
    this.entry = entry;
    this.update({
      account,
      data: entry.data,
      accountReady: true,
      conflict: entry.conflict ?? null,
      saveStatus: entry.conflict
        ? 'A change from another device needs your choice'
        : 'Loading your saved account…',
    });
    await this.services.saveLastAccount(account).catch((error) => this.storageFailure(error));
    return this.current(epoch);
  }
  change = (data: AppData) => {
    const previous = this.state;
    this.update({ data });
    if (!previous.account) {
      this.update({ saveStatus: 'Saving on this device…' });
      void this.services
        .saveGuest(data)
        .then(() => {
          if (!this.state.account && this.state.data === data)
            this.update({ saveStatus: 'Saved on this device' });
        })
        .catch((error) =>
          this.update({
            storageError: `Device saving failed: ${errorMessage(error)}. Export a backup before closing this tab.`,
          }),
        );
      return;
    }
    this.entry = {
      ...this.entry,
      version: 1,
      data,
      baseline: this.entry?.baseline ?? null,
      pending: Boolean(this.entry?.pending || hasContentChanges(previous.data, data)),
      ...(previous.conflict ? { conflict: previous.conflict } : {}),
    };
    void this.cache(previous.account.id, this.entry);
    if (!this.entry.pending) return;
    this.update({
      saveStatus: this.state.accountReady
        ? 'Saving to your account…'
        : 'Sign in to save your changes',
    });
    this.schedule();
  };
  unavailable = () => {
    if (this.state.account)
      this.update({
        saveStatus: this.entry?.pending
          ? 'Offline · changes will save when you reconnect'
          : 'Offline · showing your saved account',
      });
  };
  signInError = (error: Error) => {
    this.update({ saveStatus: error.message });
  };
  /** Restore display metadata and an offline copy without authorizing any API request. */
  restoreCachedAccount = async (account: Account) => {
    const epoch = this.epoch,
      entry = await this.accountCopy(account);
    if (!this.current(epoch)) return;
    this.entry = entry;
    this.update({
      account,
      data: entry.data,
      accountReady: false,
      conflict: entry.conflict ?? null,
      saveStatus: entry.conflict
        ? 'A change from another device needs your choice'
        : 'Opening your account…',
    });
  };

  /** Called only with the account returned by the verified Google endpoint. */
  openAccount = async (account: Account) => {
    this.cancelTimer();
    const epoch = ++this.epoch;
    this.activeOperation = 0;
    this.pendingRefresh = false;
    if (this.state.account?.id !== account.id) {
      this.entry = null;
      this.update({
        account,
        data: emptyAccountData(),
        accountReady: false,
        conflict: null,
        saveStatus: 'Loading your account…',
      });
      await this.adoptAccount(account, epoch);
    } else
      this.update({
        account,
        accountReady: true,
        conflict: this.entry?.conflict ?? this.state.conflict,
      });
    if (this.current(epoch)) await this.refresh(account.id);
  };

  /** Reverify the session before every read/write; expected-account API headers remain mandatory. */
  refresh = async (expectedAccountId?: string) => {
    if (this.disposed) return;
    if (this.activeOperation) {
      this.pendingRefresh = true;
      return;
    }
    this.cancelTimer();
    const epoch = this.epoch,
      operation = ++this.sequence;
    this.activeOperation = operation;
    try {
      const verified = await this.services.getAccount();
      if (!this.current(epoch)) return;
      if (!verified || (expectedAccountId && verified.id !== expectedAccountId)) {
        this.update({
          accountReady: false,
          saveStatus: this.state.account
            ? this.entry?.pending
              ? 'Sign in to save your changes'
              : 'Sign in to open your account'
            : 'Saved on this device',
        });
        return;
      }
      if (this.state.account?.id !== verified.id) {
        if (!(await this.adoptAccount(verified, epoch))) return;
      } else {
        this.update({ account: verified, accountReady: true });
        await this.services.saveLastAccount(verified).catch((error) => this.storageFailure(error));
      }
      if (!this.current(epoch) || this.state.conflict) return;
      // Another tab may have committed an offline draft since this view opened.
      // Recover it before fetching or writing; its journal cannot be erased by
      // a clean background refresh from this tab.
      const beforeRead = this.state.data,
        beforeEntry = this.entry;
      try {
        const cached = await this.services.loadCache(verified.id);
        if (!this.current(epoch)) return;
        if (cached) {
          // A quota failure may leave genuine edits only in memory. Merge all
          // pending edits, not just those made during the asynchronous read.
          const recovered = beforeEntry?.pending
            ? beforeEntry.baseline
              ? foldInFlightEdits(
                  beforeEntry.baseline.data ?? emptyAccountData(),
                  beforeRead,
                  cached.data,
                )
              : {
                  data: beforeRead,
                  conflicts: sameData(beforeRead, cached.data)
                    ? []
                    : ['Unsaved changes have no common saved version'],
                }
            : { data: cached.data, conflicts: [] };
          const merged = foldInFlightEdits(beforeRead, this.state.data, recovered.data);
          const reasons = [...recovered.conflicts, ...merged.conflicts];
          const conflict =
            cached.conflict ??
            (reasons.length
              ? { cloud: cached.baseline ?? { data: null, revision: 0 }, reasons }
              : null);
          this.entry = {
            ...cached,
            data: merged.data,
            pending:
              cached.pending ||
              Boolean(beforeEntry?.pending) ||
              hasContentChanges(merged.data, cached.data),
            observedDrafts: { ...this.entry?.observedDrafts, ...cached.observedDrafts },
            ...(conflict ? { conflict } : {}),
          };
          this.update({
            data: merged.data,
            conflict,
            ...(conflict ? { saveStatus: 'A change from another device needs your choice' } : {}),
          });
          if (conflict) return;
        }
      } catch (error) {
        this.cacheBlocked.add(verified.id);
        this.storageFailure(error);
      }
      if (!this.current(epoch)) return;
      const id = verified.id,
        sent = this.state.data,
        wasPending = Boolean(this.entry?.pending),
        baseline = this.entry?.baseline ?? null;
      const firstCloud = await this.services.getCloudState(id);
      if (!this.current(epoch) || this.state.account?.id !== id) return;
      let snapshot = firstCloud,
        accepted = firstCloud.data ?? emptyAccountData();
      if (this.legacyCandidates.has(id) && firstCloud.data === null && firstCloud.revision === 0) {
        // Existing users may have personal trips only in their old signed-in
        // namespace. Migrate those once into a never-used account, while a
        // saved server record or deletion tombstone always remains authoritative.
        const migrated = personalAccountData(sent);
        if (hasContentChanges(migrated, emptyAccountData())) {
          try {
            const result = await this.services.putCloudState(migrated, 0, id);
            snapshot = { data: migrated, revision: result.revision };
            accepted = migrated;
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 409) throw error;
            snapshot = await this.services.getCloudState(id);
            accepted = snapshot.data ?? emptyAccountData();
          }
        }
      } else if (wasPending) {
        let first = true;
        const result = await reconcileSync(sent, baseline, {
          get: () => {
            if (first) {
              first = false;
              return Promise.resolve(firstCloud);
            }
            return this.services.getCloudState(id);
          },
          put: (data, revision) => this.services.putCloudState(data, revision, id),
        });
        if (!this.current(epoch) || this.state.account?.id !== id) return;
        if (result.kind === 'conflict') {
          const conflict = { cloud: result.cloud, reasons: result.conflicts };
          this.entry = {
            ...this.entry,
            version: 1,
            data: this.state.data,
            baseline,
            pending: true,
            conflict,
          };
          this.update({ conflict, saveStatus: 'A change from another device needs your choice' });
          await this.cache(id, this.entry);
          return;
        }
        snapshot = result.snapshot;
        accepted = result.kind === 'deleted' ? emptyAccountData() : result.data;
      }
      if (!this.current(epoch) || this.state.account?.id !== id) return;
      this.legacyCandidates.delete(id);
      const latest = this.state.data;
      const merged = foldInFlightEdits(sent, latest, accepted);
      if (merged.conflicts.length) {
        // The server baseline may already have advanced during a successful
        // upload. Keep the newer edits and expose only this exceptional clash.
        const conflict = { cloud: snapshot, reasons: merged.conflicts };
        this.entry = {
          ...this.entry,
          version: 1,
          data: latest,
          baseline: snapshot,
          pending: true,
          conflict,
        };
        this.update({ conflict, saveStatus: 'A change from another device needs your choice' });
        await this.cache(id, this.entry);
        return;
      }
      const data = sameData(merged.data, latest) ? latest : merged.data;
      const pending = hasContentChanges(data, snapshot.data ?? emptyAccountData());
      this.entry = { version: 1, data, baseline: structuredClone(snapshot), pending };
      this.update({
        data,
        accountReady: true,
        saveStatus: pending ? 'Saving to your account…' : '',
      });
      await this.cache(id, this.entry);
      if (this.current(epoch) && pending) this.pendingRefresh = true;
    } catch (error) {
      if (!this.current(epoch)) return;
      this.pendingRefresh = false;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        this.update({
          accountReady: false,
          saveStatus: this.entry?.pending
            ? 'Sign in to save your changes'
            : 'Sign in to open your account',
        });
      } else {
        this.unavailable();
        if (this.state.accountReady) this.schedule(this.services.retryMs);
      }
    } finally {
      if (this.activeOperation === operation) {
        this.activeOperation = 0;
        if (this.pendingRefresh && this.current(epoch)) {
          this.pendingRefresh = false;
          this.schedule();
        }
      }
    }
  };

  useConflictCopy = async (source: 'account' | 'device') => {
    const account = this.state.account,
      conflict = this.state.conflict;
    if (!account || !conflict || this.activeOperation) return;
    const epoch = this.epoch,
      operation = ++this.sequence,
      sent = this.state.data,
      reviewedDrafts = { ...this.entry?.observedDrafts };
    this.activeOperation = operation;
    try {
      const verified = await this.services.getAccount();
      if (!this.current(epoch)) return;
      if (verified?.id !== account.id) throw new ApiError('Sign in to open this account.', 401);
      let snapshot: SyncSnapshot;
      if (source === 'account') {
        snapshot = await this.services.getCloudState(account.id);
        if (!this.current(epoch)) return;
        if (!sameData(sent, this.state.data)) {
          this.update({
            conflict: {
              cloud: snapshot,
              reasons: ['You edited this account while it was loading. Please choose again.'],
            },
          });
          return;
        }
      } else {
        const result = await this.services.putCloudState(sent, conflict.cloud.revision, account.id);
        snapshot = { data: sent, revision: result.revision };
      }
      if (!this.current(epoch)) return;
      const data = source === 'account' ? (snapshot.data ?? emptyAccountData()) : this.state.data;
      const pending = hasContentChanges(data, snapshot.data ?? emptyAccountData());
      this.entry = { version: 1, data, baseline: snapshot, pending };
      this.update({
        data,
        accountReady: true,
        conflict: null,
        saveStatus: pending ? 'Saving to your account…' : '',
      });
      await this.cache(account.id, this.entry, { resolvedDrafts: reviewedDrafts });
      if (pending) this.pendingRefresh = true;
    } catch (error) {
      if (!this.current(epoch)) return;
      if (error instanceof ApiError && error.status === 409) {
        try {
          const cloud = await this.services.getCloudState(account.id);
          if (this.current(epoch))
            this.update({
              conflict: {
                cloud,
                reasons: ['Your account changed again. Please choose which version to keep.'],
              },
            });
        } catch {
          this.unavailable();
        }
      } else if (error instanceof ApiError && (error.status === 401 || error.status === 403))
        this.update({ accountReady: false, saveStatus: 'Sign in to open your account' });
      else this.unavailable();
    } finally {
      if (this.activeOperation === operation) {
        this.activeOperation = 0;
        if (this.pendingRefresh && this.current(epoch)) {
          this.pendingRefresh = false;
          this.schedule();
        }
      }
    }
  };
  deleteAccountData = async () => {
    const account = this.state.account;
    if (!account) throw new Error('Sign in to delete your saved account data.');
    if (this.activeOperation)
      throw new Error('Your account is still saving. Please wait a moment and try again.');
    this.cancelTimer();
    const epoch = this.epoch,
      operation = ++this.sequence,
      sent = this.state.data;
    this.activeOperation = operation;
    this.update({ saveStatus: 'Deleting your saved data…' });
    try {
      // Review the generations present when deletion starts. Later edits from
      // this or another tab remain independently recoverable.
      const cached = await this.services.loadCache(account.id);
      if (!this.current(epoch)) return;
      const reviewedDrafts = { ...cached?.observedDrafts };
      const verified = await this.services.getAccount();
      if (!this.current(epoch)) return;
      if (verified?.id !== account.id)
        throw new ApiError('Sign in to delete this account’s saved data.', 401);
      const result = await this.services.deleteCloudState(account.id);
      if (!this.current(epoch)) return;
      // The deletion removes the pre-confirmation document. Any edits made
      // during the request belong to the new empty account and remain unsaved.
      const data = foldInFlightEdits(sent, this.state.data, emptyAccountData()).data;
      const pending = hasContentChanges(data, emptyAccountData());
      this.entry = {
        version: 1,
        data,
        baseline: { data: null, revision: result.revision },
        pending,
      };
      this.update({
        data,
        conflict: null,
        saveStatus: pending ? 'Saving to your account…' : 'Your saved account data was deleted',
      });
      await this.cache(account.id, this.entry, { resolvedDrafts: reviewedDrafts });
      await this.services.clearLegacy(account.id).catch((error) => this.storageFailure(error));
      if (pending) this.pendingRefresh = true;
    } catch (error) {
      if (!this.current(epoch)) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403))
        this.update({
          accountReady: false,
          saveStatus: 'Sign in to delete your saved account data',
        });
      else
        this.update({
          saveStatus: `Your account data could not be deleted. ${errorMessage(error)}`,
        });
      throw error;
    } finally {
      if (this.activeOperation === operation) {
        this.activeOperation = 0;
        if (this.pendingRefresh && this.current(epoch)) {
          this.pendingRefresh = false;
          this.schedule();
        }
      }
    }
  };
  clearLocal = async () => {
    if (this.activeOperation)
      throw new Error('Your account is still saving. Please wait a moment and try again.');
    const account = this.state.account,
      sent = this.state.data,
      epoch = this.epoch;
    try {
      if (account) {
        if (this.entry?.pending)
          throw new Error(
            'This browser has unsaved changes. Reconnect and save them before clearing the offline copy.',
          );
        await this.services.clearCache(account.id);
        if (!this.current(epoch) || this.state.account?.id !== account.id) return;
        await this.services.clearLegacy(account.id);
        if (!this.current(epoch) || this.state.account?.id !== account.id) return;
        this.cacheBlocked.delete(account.id);
        this.update({ storageError: null });
        // Keep the current view; a successful read repopulates the cache.
        await this.refresh(account.id);
      } else {
        await this.services.clearLegacy(null);
        if (!this.current(epoch) || this.state.account !== null) return;
        if (!sameData(sent, this.state.data)) await this.services.saveGuest(this.state.data);
        else
          this.update({
            data: emptyAccountData(),
            storageError: null,
            saveStatus: 'Device data cleared',
          });
      }
    } catch (error) {
      this.update({ storageError: errorMessage(error) });
      throw error;
    }
  };
  signedOut = async () => {
    this.cancelTimer();
    const epoch = ++this.epoch;
    this.activeOperation = 0;
    this.pendingRefresh = false;
    this.entry = null;
    const opening = emptyAccountData();
    this.update({
      account: null,
      accountReady: false,
      data: opening,
      conflict: null,
      saveStatus: 'Opening your device data…',
    });
    await this.services.saveLastAccount(null).catch((error) => this.storageFailure(error));
    let guest: AppData;
    try {
      guest = (await this.services.loadGuest()) ?? createInitialData();
    } catch (error) {
      guest = createInitialData();
      this.storageFailure(error);
    }
    if (this.current(epoch)) {
      const data = foldInFlightEdits(opening, this.state.data, guest).data;
      this.update({ data, saveStatus: 'Saved on this device' });
      if (!sameData(data, guest))
        await this.services.saveGuest(data).catch((error) => this.storageFailure(error));
    }
  };
  dispose = () => {
    this.disposed = true;
    this.cancelTimer();
    this.listeners.clear();
    ++this.epoch;
  };
}
