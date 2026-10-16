import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialData } from '../src/lib/defaults';
import { clearData, loadData, loadLastAccount, loadSyncSnapshot, saveData, saveLastAccount } from '../src/lib/store';

afterEach(async () => {
  for (const id of [null, 'alice', 'bob']) await clearData(id);
  await saveLastAccount(null);
});

describe('account-scoped local storage and legacy migration', () => {
  it('keeps guest and different Google accounts separate', async () => {
    const guest = createInitialData();
    const alice = { ...createInitialData(), preferences: { ...guest.preferences, sleepHours: 9 } };
    await saveData(null, guest);
    await saveData('alice', alice);
    expect(await loadData(null)).toEqual(guest);
    expect((await loadData('alice'))?.preferences.sleepHours).toBe(9);
    expect(await loadData('bob')).toBeNull();
    await clearData('alice');
    expect(await loadData('alice')).toBeNull();
    expect(await loadData(null)).toEqual(guest);
  });

  it('reads legacy documents, common snapshots and tombstones, clearing only the chosen account', async () => {
    const data = createInitialData();
    const snapshot = { data, revision: 9 };
    const tombstone = { data: null, revision: 12 };
    const database = await openDB('rephase', 1, {
      upgrade(db) { db.createObjectStore('state'); },
    });
    try {
      // Seed the retired storage layout directly: migration remains supported
      // without retaining obsolete production writers solely for these tests.
      const tx = database.transaction('state', 'readwrite');
      await tx.store.put(data, 'account:alice');
      await tx.store.put(snapshot, 'snapshot:account:alice');
      await tx.store.put(9, 'revision:account:alice');
      await tx.store.put(tombstone, 'snapshot:account:bob');
      await tx.done;

      expect(await loadData('alice')).toEqual(data);
      expect(await loadSyncSnapshot('alice')).toEqual(snapshot);
      expect(await loadSyncSnapshot('bob')).toEqual(tombstone);
      await clearData('alice');
      expect(await loadData('alice')).toBeNull();
      expect(await loadSyncSnapshot('alice')).toBeNull();
      expect(await database.get('state', 'revision:account:alice')).toBeUndefined();
      expect(await loadSyncSnapshot('bob')).toEqual(tombstone);
    } finally { database.close(); }
  });

  it('rejects unsupported stored schemas without deleting the original record', async () => {
    const database = await openDB('rephase', 1);
    try {
      await database.put('state', { schemaVersion: 99 }, 'account:alice');
      await expect(loadData('alice')).rejects.toThrow('unsupported format');
      expect(await database.get('state', 'account:alice')).toEqual({ schemaVersion: 99 });
      await database.put('state', { data: null, revision: NaN }, 'snapshot:account:alice');
      await expect(loadSyncSnapshot('alice')).rejects.toThrow('unsupported format');
      expect(await database.get('state', 'snapshot:account:alice')).toEqual({ data: null, revision: NaN });
    } finally { database.close(); }
  });

  it('retains an offline namespace pointer without an authentication credential', async () => {
    await saveLastAccount({ id: 'alice', name: 'Alice', email: 'alice@example.com' });
    expect((await loadLastAccount())?.id).toBe('alice');
    await saveLastAccount(null);
    expect(await loadLastAccount()).toBeNull();
  });

  it('captures payload at invocation and serializes writes so the newest commit wins', async () => {
    const original = createInitialData();
    const first = saveData('alice', original);
    original.preferences.sleepHours = 10;
    const second = saveData('alice', original);
    original.preferences.sleepHours = 11;
    await Promise.all([first, second]);
    expect((await loadData('alice'))?.preferences.sleepHours).toBe(10);
  });

  it('uses the shared validator for added model, adherence and flight-time fields', async () => {
    const data = createInitialData();
    data.preferences.planningMode = 'model';
    data.preferences.autoSync = true;
    const leg = data.trips[0].legs[0];
    leg.taxiOutMinutes = 20;
    leg.taxiInMinutes = 10;
    leg.takeoffDateTime = leg.departureDateTime;
    await saveData('alice', data);
    expect(await loadData('alice')).toEqual(data);
    await expect(saveData('alice', { ...data, preferences: { ...data.preferences, sleepHours: NaN } })).rejects.toThrow();
  });
});
