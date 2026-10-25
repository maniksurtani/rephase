import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountPersistence, emptyAccountData } from '../src/lib/account-persistence';
import { ApiError } from '../src/lib/api';
import { createInitialData } from '../src/lib/defaults';
import { createAccountCacheClient, type AccountCache } from '../src/lib/account-cache';
import type { Account, AppData } from '../src/lib/types';
import type { SyncSnapshot } from '../src/lib/store';

const alice: Account = { id: 'alice', name: 'Alice', email: 'alice@example.com' };
const bob: Account = { id: 'bob', name: 'Bob', email: 'bob@example.com' };
const copy = <T,>(value: T): T => structuredClone(value);
const instances: AccountPersistence[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
function harness(options: { initial?: AppData; account?: Account | null; cache?: AccountCache; cloud?: SyncSnapshot } = {}) {
  const initial = options.initial ?? emptyAccountData();
  let cloud = copy(options.cloud ?? { data: initial, revision: 1 });
  let session: Account | null = alice;
  const caches = new Map<string, AccountCache>();
  const guest = createInitialData();
  const services = {
    getAccount: vi.fn(async () => session),
    getCloudState: vi.fn(async (_id: string) => copy(cloud)),
    putCloudState: vi.fn(async (data: AppData, revision: number, _id: string) => {
      if (revision !== cloud.revision) throw new ApiError('stale revision', 409);
      cloud = { data: copy(data), revision: revision + 1 };
      return { revision: cloud.revision };
    }),
    deleteCloudState: vi.fn(async (_id: string) => { cloud = { data: null, revision: cloud.revision + 1 }; return { revision: cloud.revision }; }),
    loadCache: vi.fn(async (id: string) => copy(caches.get(id) ?? null)),
    saveCache: vi.fn(async (id: string, entry: AccountCache) => { caches.set(id, copy(entry)); }),
    clearCache: vi.fn(async (id: string) => { caches.delete(id); }),
    loadLegacy: vi.fn(async (_id: string | null): Promise<AppData | null> => null),
    loadLegacyBaseline: vi.fn(async (_id: string): Promise<SyncSnapshot | null> => null),
    clearLegacy: vi.fn(async (_id: string | null) => {}),
    saveGuest: vi.fn(async (_data: AppData) => {}),
    loadGuest: vi.fn(async (): Promise<AppData | null> => guest),
    saveLastAccount: vi.fn(async (_account: Account | null) => {}),
    debounceMs: 800,
    retryMs: 30_000,
  };
  const controller = new AccountPersistence({ account: options.account === undefined ? alice : options.account, data: initial, cache: options.cache }, services);
  instances.push(controller);
  return { controller, services, caches, guest, getCloud: () => cloud, setCloud: (value: SyncSnapshot) => { cloud = copy(value); }, setSession: (value: Account | null) => { session = value; } };
}
afterEach(() => { for (const controller of instances.splice(0)) controller.dispose(); vi.useRealTimers(); });

describe('server authoritative account persistence', () => {
  it('loads the server copy automatically instead of uploading a clean legacy device document', async () => {
    const old = emptyAccountData(); old.preferences.sleepHours = 9;
    const remote = emptyAccountData(); remote.preferences.sleepHours = 7;
    const h = harness({ initial: old, cloud: { data: remote, revision: 6 } });
    await h.controller.refresh();
    expect(h.controller.getSnapshot()).toMatchObject({ data: remote, accountReady: true, saveStatus: '', conflict: null });
    expect(h.services.putCloudState).not.toHaveBeenCalled();
    expect(h.caches.get('alice')).toMatchObject({ data: remote, baseline: { data: remote, revision: 6 }, pending: false });
  });
  it('migrates personal legacy account trips once into a never-saved account, excluding demo trips', async () => {
    const legacy = createInitialData(), personal = copy(legacy.trips[0]);
    personal.id = 'personal-trip'; personal.name = 'My real itinerary';
    legacy.trips.push(personal); legacy.selectedTripId = personal.id; legacy.preferences.sleepHours = 9;
    const h = harness({ account: null, cloud: { data: null, revision: 0 } });
    h.services.loadLegacy.mockResolvedValue(legacy);
    await h.controller.restoreCachedAccount(alice);
    await h.controller.refresh();
    expect(h.services.putCloudState).toHaveBeenCalledTimes(1);
    expect(h.getCloud().data?.trips.map(trip => trip.id)).toEqual(['personal-trip']);
    expect(h.getCloud().data?.preferences.sleepHours).toBe(9);
    expect(h.services.saveGuest).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().conflict).toBeNull();
  });
  it.each([{ data: emptyAccountData(), revision: 4 }, { data: null, revision: 5 }])('never migrates old account data over saved records or deletion tombstones: %j', async cloud => {
    const legacy = createInitialData(); legacy.trips[0].id = 'personal-trip'; legacy.preferences.sleepHours = 10;
    const h = harness({ account: null, cloud });
    h.services.loadLegacy.mockResolvedValue(legacy);
    await h.controller.restoreCachedAccount(alice);
    await h.controller.refresh();
    expect(h.services.putCloudState).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().data).toEqual(cloud.data ?? emptyAccountData());
  });
  it('starts new Google accounts empty and preserves the separate guest document', async () => {
    const guest = createInitialData(); guest.preferences.sleepHours = 10;
    const h = harness({ account: null, initial: guest, cloud: { data: null, revision: 0 } });
    await h.controller.openAccount(alice);
    expect(h.controller.getSnapshot()).toMatchObject({ account: alice, accountReady: true, data: emptyAccountData(), conflict: null });
    expect(h.services.putCloudState).not.toHaveBeenCalled();
    expect(h.services.saveGuest).not.toHaveBeenCalled();
    expect(guest.preferences.sleepHours).toBe(10);
  });
  it('never treats a cached identity as authentication', async () => {
    const h = harness(); h.setSession(null);
    await h.controller.refresh();
    expect(h.controller.getSnapshot().accountReady).toBe(false);
    expect(h.services.getCloudState).not.toHaveBeenCalled();
    expect(h.services.putCloudState).not.toHaveBeenCalled();
    const changed = copy(h.controller.getSnapshot().data); changed.preferences.sleepHours = 9;
    h.controller.change(changed);
    expect(h.caches.get('alice')?.pending).toBe(true);
    expect(h.services.putCloudState).not.toHaveBeenCalled();
  });
  it('opens the verified account namespace when a shared cookie changed accounts', async () => {
    const h = harness(); h.setSession(bob);
    const bobsCopy = emptyAccountData(); bobsCopy.preferences.sleepHours = 9;
    h.caches.set('bob', { version: 1, data: bobsCopy, baseline: null, pending: false });
    h.setCloud({ data: bobsCopy, revision: 5 });
    await h.controller.refresh();
    expect(h.controller.getSnapshot()).toMatchObject({ account: bob, data: bobsCopy, accountReady: true });
    expect(h.services.getCloudState).toHaveBeenCalledWith('bob');
    expect(h.services.putCloudState).not.toHaveBeenCalled();
  });
  it('debounces automatic saving even when the old autoSync preference is false', async () => {
    vi.useFakeTimers();
    const h = harness(); await h.controller.refresh();
    const first = copy(h.controller.getSnapshot().data); first.preferences.sleepHours = 9; first.preferences.autoSync = false;
    h.controller.change(first);
    await vi.advanceTimersByTimeAsync(500);
    const second = copy(first); second.preferences.sleepHours = 10;
    h.controller.change(second);
    await vi.advanceTimersByTimeAsync(799);
    expect(h.services.putCloudState).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.services.putCloudState).toHaveBeenCalledTimes(1);
    expect(h.services.putCloudState).toHaveBeenCalledWith(second, 1, 'alice');
    expect(h.caches.get('alice')?.pending).toBe(false);
  });
  it('refreshes another device’s change without an unnecessary write', async () => {
    const h = harness(); await h.controller.refresh();
    const remote = emptyAccountData(); remote.preferences.chronotype = 'late';
    h.setCloud({ data: remote, revision: 2 });
    await h.controller.refresh();
    expect(h.controller.getSnapshot().data).toEqual(remote);
    expect(h.services.putCloudState).not.toHaveBeenCalled();
  });
  it('keeps failed edits in the atomic offline cache and retries automatically', async () => {
    vi.useFakeTimers();
    const h = harness(); await h.controller.refresh();
    const edited = copy(h.controller.getSnapshot().data); edited.preferences.sleepHours = 9;
    h.services.getCloudState.mockRejectedValueOnce(new TypeError('offline'));
    h.controller.change(edited);
    await vi.advanceTimersByTimeAsync(800);
    expect(h.controller.getSnapshot().saveStatus).toContain('Offline');
    expect(h.caches.get('alice')).toMatchObject({ data: edited, pending: true });
    expect(h.services.putCloudState).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.getCloud().data).toEqual(edited);
    expect(h.caches.get('alice')?.pending).toBe(false);
  });
  it('reconciles marked offline edits after reload while retaining independent server edits', async () => {
    const base = emptyAccountData(), local = copy(base), remote = copy(base);
    local.preferences.sleepHours = 9; remote.preferences.caffeine = false;
    const h = harness({ initial: local, cache: { version: 1, data: local, baseline: { data: base, revision: 1 }, pending: true }, cloud: { data: remote, revision: 2 } });
    await h.controller.refresh();
    expect(h.getCloud().data?.preferences).toMatchObject({ sleepHours: 9, caffeine: false });
    expect(h.controller.getSnapshot().conflict).toBeNull();
    expect(h.caches.get('alice')?.pending).toBe(false);
  });
  it('preserves overlapping changes for an exceptional explicit choice', async () => {
    const base = emptyAccountData(), local = copy(base), remote = copy(base);
    local.preferences.sleepHours = 9; remote.preferences.sleepHours = 10;
    const h = harness({ initial: local, cache: { version: 1, data: local, baseline: { data: base, revision: 1 }, pending: true }, cloud: { data: remote, revision: 2 } });
    await h.controller.refresh();
    expect(h.controller.getSnapshot().conflict?.reasons).toContain('preferences.sleepHours');
    expect(h.services.putCloudState).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().data).toEqual(local);
    await h.controller.useConflictCopy('account');
    expect(h.controller.getSnapshot()).toMatchObject({ data: remote, conflict: null });
  });
  it('retries an optimistic revision race with fresh independent server changes', async () => {
    const base = emptyAccountData(), local = copy(base), remote = copy(base);
    local.preferences.sleepHours = 9;
    const h = harness({ initial: local, cache: { version: 1, data: local, baseline: { data: base, revision: 1 }, pending: true }, cloud: { data: base, revision: 1 } });
    h.services.putCloudState.mockImplementationOnce(async () => {
      remote.preferences.caffeine = false; h.setCloud({ data: remote, revision: 2 });
      throw new ApiError('stale', 409);
    });
    await h.controller.refresh();
    expect(h.services.putCloudState).toHaveBeenCalledTimes(2);
    expect(h.getCloud().data?.preferences).toMatchObject({ sleepHours: 9, caffeine: false });
  });
  it('preserves edits made while an upload is in flight and saves them next', async () => {
    vi.useFakeTimers();
    const h = harness(); await h.controller.refresh();
    const first = copy(h.controller.getSnapshot().data); first.preferences.sleepHours = 9;
    h.controller.change(first);
    const started = deferred<void>(), upload = deferred<{ revision: number }>();
    h.services.putCloudState.mockImplementationOnce(async (data, revision) => {
      started.resolve(); const result = await upload.promise;
      h.setCloud({ data, revision: result.revision }); return result;
    });
    const saving = h.controller.refresh(); await started.promise;
    const newer = copy(first); newer.preferences.caffeine = false;
    h.controller.change(newer);
    upload.resolve({ revision: 2 }); await saving;
    expect(h.controller.getSnapshot().data).toEqual(newer);
    expect(h.caches.get('alice')?.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(h.getCloud().data).toEqual(newer);
    expect(h.services.putCloudState).toHaveBeenCalledTimes(2);
  });
  it('preserves edits made while a clean startup server fetch is in flight', async () => {
    vi.useFakeTimers();
    const cached = emptyAccountData(), server = copy(cached); server.preferences.caffeine = false;
    const h = harness({ initial: cached });
    const started = deferred<void>(), response = deferred<SyncSnapshot>();
    h.services.getCloudState.mockImplementationOnce(async () => { started.resolve(); return response.promise; });
    const opening = h.controller.refresh(); await started.promise;
    const edited = copy(cached); edited.preferences.sleepHours = 9;
    h.controller.change(edited);
    response.resolve({ data: server, revision: 1 }); h.setCloud({ data: server, revision: 1 }); await opening;
    expect(h.controller.getSnapshot().data.preferences).toMatchObject({ sleepHours: 9, caffeine: false });
    await vi.advanceTimersByTimeAsync(800);
    expect(h.getCloud().data?.preferences).toMatchObject({ sleepHours: 9, caffeine: false });
  });
  it.each([401, 403])('keeps unsaved edits and stops automatic requests after session failure %i', async status => {
    vi.useFakeTimers();
    const h = harness(); await h.controller.refresh();
    const edited = copy(h.controller.getSnapshot().data); edited.preferences.sleepHours = 9;
    h.controller.change(edited);
    h.services.getCloudState.mockRejectedValueOnce(new ApiError('account changed', status));
    await h.controller.refresh();
    expect(h.controller.getSnapshot()).toMatchObject({ data: edited, accountReady: false, requiresSignIn: true, saveStatus: 'Your session has ended. Reconnect to save account changes.' });
    const calls = h.services.getAccount.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.services.getAccount).toHaveBeenCalledTimes(calls);
    expect(h.services.putCloudState).not.toHaveBeenCalled();
  });
  it('clears a stale session message after verification even while a saved conflict awaits a choice', async () => {
    const data = emptyAccountData();
    const conflict = { cloud: { data, revision: 2 }, reasons: ['preferences.sleepHours'] };
    const h = harness({ cache: { version: 1, data, baseline: { data, revision: 1 }, pending: true, conflict } });
    h.setSession(null);
    await h.controller.refresh();
    expect(h.controller.getSnapshot().accountReady).toBe(false);
    h.setSession(alice);
    await h.controller.refresh();
    expect(h.controller.getSnapshot()).toMatchObject({ accountReady: true, requiresSignIn: false, conflict, saveStatus: 'A change from another device needs your choice' });
    expect(h.services.putCloudState).not.toHaveBeenCalled();
  });
  it('retries a temporary startup failure without asking a cached account to sign in', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.services.getAccount.mockRejectedValueOnce(new ApiError('Account services are unavailable.', 403, true));
    await h.controller.refresh();
    expect(h.controller.getSnapshot()).toMatchObject({ account: alice, accountReady: false, requiresSignIn: false, saveStatus: 'Offline · showing your saved account' });
    expect(h.services.putCloudState).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(h.services.retryMs);
    expect(h.controller.getSnapshot()).toMatchObject({ accountReady: true, requiresSignIn: false, saveStatus: '' });
    expect(h.services.getAccount).toHaveBeenCalledTimes(2);
  });
  it('ignores a previous account response after switching accounts', async () => {
    const h = harness();
    const started = deferred<void>(), response = deferred<SyncSnapshot>();
    h.services.getCloudState.mockImplementationOnce(async () => { started.resolve(); return response.promise; });
    const old = h.controller.refresh(); await started.promise;
    const remoteBob = emptyAccountData(); remoteBob.preferences.sleepHours = 10;
    h.setSession(bob); h.setCloud({ data: remoteBob, revision: 2 });
    await h.controller.openAccount(bob);
    response.resolve({ data: emptyAccountData(), revision: 1 }); await old;
    expect(h.controller.getSnapshot()).toMatchObject({ account: bob, data: remoteBob });
    expect(h.caches.get('bob')?.data).toEqual(remoteBob);
  });
  it('deletes saved data with a tombstone and never recreates it without a new edit', async () => {
    vi.useFakeTimers();
    const initial = createInitialData(); initial.trips[0].id = 'personal-trip';
    const h = harness({ initial }); await h.controller.refresh();
    await h.controller.deleteAccountData();
    expect(h.getCloud().data).toBeNull();
    expect(h.controller.getSnapshot().data).toEqual(emptyAccountData());
    expect(h.caches.get('alice')).toMatchObject({ baseline: { data: null, revision: 2 }, pending: false });
    await vi.advanceTimersByTimeAsync(60_000); await h.controller.refresh();
    expect(h.services.putCloudState).not.toHaveBeenCalled();
    const newData = emptyAccountData(); newData.preferences.sleepHours = 9;
    h.controller.change(newData); await h.controller.refresh();
    expect(h.getCloud().data).toEqual(newData);
  });
  it('keeps online account saving available when browser cache writes fail', async () => {
    const h = harness(); await h.controller.refresh();
    h.services.saveCache.mockRejectedValue(new Error('quota exceeded'));
    const edited = emptyAccountData(); edited.preferences.sleepHours = 9;
    h.controller.change(edited); await h.controller.refresh();
    expect(h.getCloud().data).toEqual(edited);
    expect(h.controller.getSnapshot().storageError).toContain('Online account saving remains available');
  });
  it('refuses to clear an offline copy that still contains unsaved edits', async () => {
    const h = harness(); await h.controller.refresh();
    const edited = emptyAccountData(); edited.preferences.sleepHours = 9;
    h.controller.change(edited); await expect(h.controller.clearLocal()).rejects.toThrow('unsaved changes');
    expect(h.services.clearCache).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().storageError).toContain('unsaved changes');
  });
  it('signs out into the untouched guest namespace and invalidates an account fetch', async () => {
    const h = harness();
    const started = deferred<void>(), response = deferred<SyncSnapshot>();
    h.services.getCloudState.mockImplementationOnce(async () => { started.resolve(); return response.promise; });
    const old = h.controller.refresh(); await started.promise;
    await h.controller.signedOut();
    response.resolve({ data: emptyAccountData(), revision: 1 }); await old;
    expect(h.controller.getSnapshot()).toMatchObject({ account: null, data: h.guest, accountReady: false });
    expect(h.services.saveLastAccount).toHaveBeenLastCalledWith(null);
    expect(h.services.putCloudState).not.toHaveBeenCalled();
  });
  it('persists an in-flight overlapping conflict across reload and reauthentication', async () => {
    const base = emptyAccountData(), remote = copy(base); remote.preferences.sleepHours = 10;
    const h = harness({ initial: base });
    const started = deferred<void>(), response = deferred<SyncSnapshot>();
    h.services.getCloudState.mockImplementationOnce(async () => { started.resolve(); return response.promise; });
    const opening = h.controller.refresh(); await started.promise;
    const local = copy(base); local.preferences.sleepHours = 9; h.controller.change(local);
    response.resolve({ data: remote, revision: 2 }); await opening;
    const cache = h.caches.get('alice');
    expect(cache?.conflict?.reasons).toContain('preferences.sleepHours');
    expect(cache?.data).toEqual(local);
    const reloaded = harness({ initial: local, cache, cloud: { data: remote, revision: 2 } });
    await reloaded.controller.refresh();
    await reloaded.controller.openAccount(alice);
    expect(reloaded.controller.getSnapshot().conflict?.reasons).toContain('preferences.sleepHours');
    expect(reloaded.services.putCloudState).not.toHaveBeenCalled();
    expect(reloaded.controller.getSnapshot().data).toEqual(local);
  });
  it('rejects destructive operations during a read instead of silently dismissing confirmation', async () => {
    const h = harness();
    const started = deferred<void>(), response = deferred<SyncSnapshot>();
    h.services.getCloudState.mockImplementationOnce(async () => { started.resolve(); return response.promise; });
    const reading = h.controller.refresh(); await started.promise;
    await expect(h.controller.deleteAccountData()).rejects.toThrow('Please wait');
    await expect(h.controller.clearLocal()).rejects.toThrow('Please wait');
    expect(h.services.deleteCloudState).not.toHaveBeenCalled();
    expect(h.services.clearCache).not.toHaveBeenCalled();
    response.resolve({ data: emptyAccountData(), revision: 1 }); await reading;
  });
  it('reports a failed account deletion without changing either saved document', async () => {
    const original = emptyAccountData(); original.preferences.sleepHours = 9;
    const h = harness({ initial: original }); await h.controller.refresh();
    h.services.deleteCloudState.mockRejectedValueOnce(new Error('offline'));
    await expect(h.controller.deleteAccountData()).rejects.toThrow('offline');
    expect(h.controller.getSnapshot().data).toEqual(original);
    expect(h.getCloud().data).toEqual(original);
    expect(h.controller.getSnapshot().saveStatus).toContain('could not be deleted');
  });
  it('preserves new edits made during an account deletion without restoring old trips', async () => {
    vi.useFakeTimers();
    const original = createInitialData(); original.trips[0].id = 'personal-trip';
    const h = harness({ initial: original }); await h.controller.refresh();
    const started = deferred<void>(), response = deferred<{ revision: number }>();
    h.services.deleteCloudState.mockImplementationOnce(async () => { started.resolve(); const result = await response.promise; h.setCloud({ data: null, revision: result.revision }); return result; });
    const deleting = h.controller.deleteAccountData(); await started.promise;
    const edited = copy(original); edited.preferences.sleepHours = 9; h.controller.change(edited);
    response.resolve({ revision: 2 }); await deleting;
    expect(h.controller.getSnapshot().data.trips).toEqual([]);
    expect(h.controller.getSnapshot().data.preferences.sleepHours).toBe(9);
    expect(h.caches.get('alice')?.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(h.getCloud().data?.trips).toEqual([]);
    expect(h.getCloud().data?.preferences.sleepHours).toBe(9);
  });
  it('keeps edits made while the offline account cache is opening', async () => {
    vi.useFakeTimers();
    const h = harness({ account: null, cloud: { data: null, revision: 0 } });
    const started = deferred<void>(), response = deferred<AccountCache | null>();
    h.services.loadCache.mockImplementationOnce(async () => { started.resolve(); return response.promise; });
    const opening = h.controller.openAccount(alice); await started.promise;
    const edited = emptyAccountData(); edited.preferences.sleepHours = 9; h.controller.change(edited);
    response.resolve(null); await opening;
    expect(h.controller.getSnapshot().data.preferences.sleepHours).toBe(9);
    expect(h.getCloud().data?.preferences.sleepHours).toBe(9);
  });

  it('never carries a previous account baseline into edits made while opening another account', async () => {
    vi.useFakeTimers();
    const alicesData = createInitialData(); alicesData.trips[0].id = 'alice-private-trip';
    const h = harness({ initial: alicesData }); await h.controller.refresh();
    const started = deferred<void>(), response = deferred<AccountCache | null>();
    h.services.loadCache.mockImplementationOnce(async () => { started.resolve(); return response.promise; });
    h.setSession(bob); h.setCloud({ data: null, revision: 0 });
    const opening = h.controller.openAccount(bob); await started.promise;
    const bobsEdit = emptyAccountData(); bobsEdit.preferences.sleepHours = 9; h.controller.change(bobsEdit);
    expect(h.caches.get('bob')?.baseline).toBeNull();
    expect(JSON.stringify(h.caches.get('bob'))).not.toContain('alice-private-trip');
    response.resolve(null); await opening;
    expect(h.getCloud().data).toEqual(bobsEdit);
  });

  it('does not copy account data into guest storage when a delayed guest clear finishes after login', async () => {
    const h = harness({ account: null, initial: createInitialData() });
    const started = deferred<void>(), cleared = deferred<void>();
    h.services.clearLegacy.mockImplementationOnce(async () => { started.resolve(); await cleared.promise; });
    const clearing = h.controller.clearLocal(); await started.promise;
    const bobsData = emptyAccountData(); bobsData.preferences.sleepHours = 9;
    h.setSession(bob); h.setCloud({ data: bobsData, revision: 2 });
    await h.controller.openAccount(bob);
    cleared.resolve(); await clearing;
    expect(h.controller.getSnapshot()).toMatchObject({ account: bob, data: bobsData });
    expect(h.services.saveGuest).not.toHaveBeenCalled();
  });

  it('merges real legacy unsaved account edits when a genuine common server baseline exists', async () => {
    const base = emptyAccountData(), legacy = copy(base), remote = copy(base);
    legacy.preferences.sleepHours = 9; remote.preferences.caffeine = false;
    const h = harness({ account: null, cloud: { data: remote, revision: 2 } });
    h.services.loadLegacy.mockResolvedValue(legacy);
    h.services.loadLegacyBaseline.mockResolvedValue({ data: base, revision: 1 });
    await h.controller.restoreCachedAccount(alice); await h.controller.refresh();
    expect(h.getCloud().data?.preferences).toMatchObject({ sleepHours: 9, caffeine: false });
    expect(h.controller.getSnapshot().conflict).toBeNull();
  });

  it('deletes pre-existing real cache journals with the account while retaining the tombstone', async () => {
    const h = harness(), cache = createAccountCacheClient('delete-tab');
    await cache.clear('alice', { discardPending: true });
    const controller = new AccountPersistence({ account: alice, data: emptyAccountData() }, { ...h.services, loadCache: cache.load, saveCache: cache.save, clearCache: cache.clear });
    instances.push(controller);
    await controller.refresh();
    const edited = emptyAccountData(); edited.preferences.sleepHours = 9;
    controller.change(edited); expect((await cache.load('alice'))?.pending).toBe(true);
    await controller.deleteAccountData();
    expect(await cache.load('alice')).toMatchObject({ pending: false, data: emptyAccountData(), baseline: { data: null, revision: 2 } });
    await controller.refresh();
    expect(controller.getSnapshot().conflict).toBeNull();
    expect(h.services.putCloudState).not.toHaveBeenCalled();
    await cache.clear('alice', { discardPending: true });
  });
  it.each([false, true])('deletes another tab’s pre-existing journal but retains any later generation: later edit %s', async laterEdit => {
    const base = createInitialData(); base.trips[0].id = 'personal-trip'; base.selectedTripId = 'personal-trip';
    const h = harness({ initial: base }), deleting = createAccountCacheClient('deleting-tab'), other = createAccountCacheClient('other-tab');
    await deleting.clear('alice', { discardPending: true });
    try {
      const controller = new AccountPersistence({ account: alice, data: base }, { ...h.services, loadCache: deleting.load, saveCache: deleting.save, clearCache: deleting.clear });
      instances.push(controller); await controller.refresh();
      const oldDraft = copy(base); oldDraft.trips[0].name = 'Draft before deletion';
      await other.save('alice', { version: 1, data: oldDraft, baseline: { data: base, revision: 1 }, pending: true });

      const started = deferred<void>(), response = deferred<void>();
      h.services.deleteCloudState.mockImplementationOnce(async () => {
        started.resolve(); await response.promise;
        h.setCloud({ data: null, revision: 2 });
        return { revision: 2 };
      });
      const deletion = controller.deleteAccountData(); await started.promise;
      if (laterEdit) {
        const laterDraft = copy(oldDraft); laterDraft.trips[0].name = 'Edit during deletion';
        await other.save('alice', { version: 1, data: laterDraft, baseline: { data: base, revision: 1 }, pending: true });
      }
      response.resolve(); await deletion;

      expect(h.getCloud()).toEqual({ data: null, revision: 2 });
      const cached = await deleting.load('alice');
      expect(cached).toMatchObject({ pending: laterEdit, baseline: { data: null, revision: 2 } });
      await controller.refresh();
      if (laterEdit) {
        expect(cached?.data.trips[0].name).toBe('Edit during deletion');
        expect(controller.getSnapshot().conflict?.reasons).toContain('Saved account data was deleted while another tab has unsaved changes');
      } else {
        expect(cached?.data).toEqual(emptyAccountData());
        expect(controller.getSnapshot()).toMatchObject({ data: emptyAccountData(), conflict: null });
      }
      expect(h.services.putCloudState).not.toHaveBeenCalled();
    } finally { await deleting.clear('alice', { discardPending: true }); }
  });
  it('automatically recovers and uploads independent drafts from other cache clients during refresh', async () => {
    const h = harness(), a = createAccountCacheClient('recover-a'), b = createAccountCacheClient('recover-b'), c = createAccountCacheClient('recover-c');
    await a.clear('alice', { discardPending: true });
    const base = emptyAccountData(), first = copy(base), second = copy(base);
    first.preferences.sleepHours = 9; second.preferences.caffeine = false;
    await a.save('alice', { version: 1, data: first, baseline: { data: base, revision: 1 }, pending: true });
    await b.save('alice', { version: 1, data: second, baseline: { data: base, revision: 1 }, pending: true });
    const controller = new AccountPersistence({ account: alice, data: base }, { ...h.services, loadCache: c.load, saveCache: c.save, clearCache: c.clear });
    instances.push(controller); await controller.refresh();
    expect(h.getCloud().data?.preferences).toMatchObject({ sleepHours: 9, caffeine: false });
    expect((await a.load('alice'))?.pending).toBe(false);
    expect((await b.load('alice'))?.pending).toBe(false);
    await a.clear('alice', { discardPending: true });
  });

});
