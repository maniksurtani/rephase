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
