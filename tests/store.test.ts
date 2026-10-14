import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialData } from '../src/lib/defaults';
import { clearData, loadData, loadLastAccount, loadRevision, saveData, saveLastAccount, saveRevision } from '../src/lib/store';

afterEach(async()=> { for(const id of [null,'alice','bob'])await clearData(id);await saveLastAccount(null); });
describe('account-scoped local storage',()=> {
  it('keeps guest and different Google accounts separate',async()=> {
    const guest=createInitialData();
    const alice={...createInitialData(),preferences:{...guest.preferences,sleepHours:9}};
    await saveData(null,guest);await saveData('alice',alice);
    expect(await loadData(null)).toEqual(guest);
    expect((await loadData('alice'))?.preferences.sleepHours).toBe(9);
    expect(await loadData('bob')).toBeNull();
    await clearData('alice');
    expect(await loadData('alice')).toBeNull();
    expect(await loadData(null)).toEqual(guest);
  });
  it('persists the sync base revision so reload does not bypass conflict detection',async()=> {
    await saveRevision('alice',7);await saveRevision('bob',3);
    expect(await loadRevision('alice')).toBe(7);
    await clearData('alice');
    expect(await loadRevision('alice')).toBeNull();
    expect(await loadRevision('bob')).toBe(3);
  });
  it('rejects unsupported stored schemas without deleting the original record',async()=> {
    const database=await openDB('rephase',1);
    await database.put('state',{schemaVersion:99},'account:alice');
    await expect(loadData('alice')).rejects.toThrow('unsupported format');
    expect(await database.get('state','account:alice')).toEqual({schemaVersion:99});
    database.close();
  });
  it('retains an offline namespace pointer without an authentication credential',async()=> {
    await saveLastAccount({id:'alice',name:'Alice',email:'alice@example.com'});
    expect((await loadLastAccount())?.id).toBe('alice');
    await saveLastAccount(null);
    expect(await loadLastAccount()).toBeNull();
  });
});

describe('atomic sync history and committed local writes',()=> {
  it('persists the actual common payload with its revision and removes both on clear',async()=> {
    const { loadSyncSnapshot,saveSyncSnapshot,loadSyncPaused }=await import('../src/lib/store');
    const data=createInitialData();
    await saveSyncSnapshot('alice',{data,revision:9});
    expect(await loadSyncSnapshot('alice')).toEqual({data,revision:9});
    expect(await loadRevision('alice')).toBe(9);
    expect(await loadSyncSnapshot('bob')).toBeNull();
    await clearData('alice');
    expect(await loadSyncSnapshot('alice')).toBeNull();
    expect(await loadRevision('alice')).toBeNull();
    expect(await loadSyncPaused('alice')).toBe(true);
  });
  it('captures payload at invocation and serializes writes so the newest commit wins',async()=> {
    const original=createInitialData();
    const first=saveData('alice',original);
    original.preferences.sleepHours=10;
    const second=saveData('alice',original);
    original.preferences.sleepHours=11;
    await Promise.all([first,second]);
    expect((await loadData('alice'))?.preferences.sleepHours).toBe(10);
  });
  it('keeps delete tombstones and paused-sync metadata account scoped',async()=> {
    const { loadSyncSnapshot,saveSyncSnapshot,loadSyncPaused,saveSyncPaused }=await import('../src/lib/store');
    await saveSyncSnapshot('alice',{data:null,revision:12});
    await saveSyncPaused('alice',true);
    await saveSyncPaused('bob',false);
    expect(await loadSyncSnapshot('alice')).toEqual({data:null,revision:12});
    expect(await loadSyncPaused('alice')).toBe(true);
    expect(await loadSyncPaused('bob')).toBe(false);
    await expect(saveSyncSnapshot('alice',{data:null,revision:NaN})).rejects.toThrow();
    await expect(saveRevision('alice',-1)).rejects.toThrow();
  });
  it('uses the shared validator for added model, adherence and flight-time fields',async()=> {
    const data=createInitialData();
    data.preferences.planningMode='model';data.preferences.autoSync=true;
    const leg=data.trips[0].legs[0];
    leg.taxiOutMinutes=20;leg.taxiInMinutes=10;
    leg.takeoffDateTime=leg.departureDateTime.replace('T','T');
    await saveData('alice',data);
    expect(await loadData('alice')).toEqual(data);
    await expect(saveData('alice',{...data,preferences:{...data.preferences,sleepHours:NaN}})).rejects.toThrow();
  });
});

  it('commits rebased local data and its accepted snapshot in one checkpoint',async()=> {
    const {saveSyncState,loadSyncSnapshot}=await import('../src/lib/store');
    const cloud=createInitialData(),local=structuredClone(cloud);local.preferences.caffeine=false;
    await saveSyncState('alice',local,{data:cloud,revision:17});
    expect(await loadData('alice')).toEqual(local);
    expect(await loadSyncSnapshot('alice')).toEqual({data:cloud,revision:17});
    expect(await loadRevision('alice')).toBe(17);
  });
