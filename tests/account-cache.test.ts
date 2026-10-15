import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { clearAccountCache, createAccountCacheClient, loadAccountCache, saveAccountCache, type AccountCache } from '../src/lib/account-cache';
import { emptyAccountData } from '../src/lib/account-persistence';

afterEach(async () => { await clearAccountCache('alice', { discardPending: true }); await clearAccountCache('bob', { discardPending: true }); });
describe('atomic offline account cache', () => {
  it('keeps account namespaces separate and commits document, baseline, pending together', async () => {
    const data = emptyAccountData(), baseline = structuredClone(data); data.preferences.sleepHours = 9;
    const entry: AccountCache = { version: 1, data, baseline: { data: baseline, revision: 3 }, pending: true };
    await saveAccountCache('alice', entry);
    expect(await loadAccountCache('alice')).toMatchObject(entry);
    expect(await loadAccountCache('bob')).toBeNull();
    await clearAccountCache('alice', { discardPending: true }); expect(await loadAccountCache('alice')).toBeNull();
  });
  it('captures writes immediately and serializes them so the latest edit wins', async () => {
    const entry: AccountCache = { version: 1, data: emptyAccountData(), baseline: null, pending: true };
    const first = saveAccountCache('alice', entry);
    entry.data.preferences.sleepHours = 9;
    const second = saveAccountCache('alice', entry);
    entry.data.preferences.sleepHours = 10;
    await Promise.all([first, second]);
    expect((await loadAccountCache('alice'))?.data.preferences.sleepHours).toBe(9);
  });
  it('preserves unsupported cache data instead of overwriting it during reads', async () => {
    const db = await openDB('rephase-account-cache', 1, { upgrade(database) { database.createObjectStore('accounts'); } });
    await db.put('accounts', { version: 99 }, 'alice');
    await expect(loadAccountCache('alice')).rejects.toThrow('unsupported format');
    expect(await db.get('accounts', 'alice')).toEqual({ version: 99 }); db.close();
  });
  it('rejects malformed baselines before persisting a document', async () => {
    await expect(saveAccountCache('alice', { version: 1, data: emptyAccountData(), baseline: { data: null, revision: -1 }, pending: false })).rejects.toThrow('invalid');
    expect(await loadAccountCache('alice')).toBeNull();
  });
});

function clean(data = emptyAccountData(), revision = 1): AccountCache {
  return { version: 1, data, baseline: { data: structuredClone(data), revision }, pending: false };
}
function draft(edit: (data: ReturnType<typeof emptyAccountData>) => void): AccountCache {
  const base = emptyAccountData(), data = structuredClone(base); edit(data);
  return { version: 1, data, baseline: { data: base, revision: 1 }, pending: true };
}
describe('independent browser tab recovery journals', () => {
  it('retains one tab’s pending changes when another tab writes a clean refresh', async () => {
    const a = createAccountCacheClient('tab-a'), b = createAccountCacheClient('tab-b');
    await a.save('alice', draft(data => { data.preferences.sleepHours = 9; }));
    await b.save('alice', clean());
    expect(await a.load('alice')).toMatchObject({ pending: true, data: { preferences: { sleepHours: 9 } } });
  });
  it('merges independent pending edits from two independent clients after reload', async () => {
    const a = createAccountCacheClient('tab-a'), b = createAccountCacheClient('tab-b'), reloaded = createAccountCacheClient('tab-c');
    await Promise.all([
      a.save('alice', draft(data => { data.preferences.sleepHours = 9; })),
      b.save('alice', draft(data => { data.preferences.caffeine = false; })),
    ]);
    const recovered = await reloaded.load('alice');
    expect(recovered).toMatchObject({ pending: true, data: { preferences: { sleepHours: 9, caffeine: false } } });
    expect(recovered?.conflict).toBeUndefined();
    expect(Object.keys(recovered?.observedDrafts ?? {})).toHaveLength(2);
  });
  it('keeps both overlapping drafts until an explicit reviewed resolution', async () => {
    const a = createAccountCacheClient('tab-a'), b = createAccountCacheClient('tab-b');
    await a.save('alice', draft(data => { data.preferences.sleepHours = 9; }));
    await b.save('alice', draft(data => { data.preferences.sleepHours = 10; }));
    const reviewed = await a.load('alice');
    expect(reviewed?.data.preferences.sleepHours).toBe(9);
    expect(reviewed?.conflict?.reasons).toContain('preferences.sleepHours');
    expect(Object.keys(reviewed?.observedDrafts ?? {})).toHaveLength(2);
    await a.save('alice', clean(), { resolvedDrafts: reviewed?.observedDrafts });
    expect(await b.load('alice')).toMatchObject({ pending: false, data: { preferences: { sleepHours: 8 } } });
  });
  it('does not discard a newer generation written after a conflict was reviewed', async () => {
    const a = createAccountCacheClient('tab-a'), b = createAccountCacheClient('tab-b');
    await a.save('alice', draft(data => { data.preferences.sleepHours = 9; }));
    const reviewed = await b.load('alice');
    await a.save('alice', draft(data => { data.preferences.sleepHours = 10; }));
    await b.save('alice', clean(), { resolvedDrafts: reviewed?.observedDrafts });
    expect(await b.load('alice')).toMatchObject({ pending: true, data: { preferences: { sleepHours: 10 } } });
  });
  it('does not let a delayed clean acknowledgement erase the same writer’s newer draft', async () => {
    const a = createAccountCacheClient('same-tab'), delayed = createAccountCacheClient('same-tab');
    await a.save('alice', draft(data => { data.preferences.sleepHours = 9; }));
    const oldReview = await delayed.load('alice');
    await a.save('alice', draft(data => { data.preferences.sleepHours = 10; }));
    await delayed.save('alice', clean());
    expect(await a.load('alice')).toMatchObject({ pending: true, data: { preferences: { sleepHours: 10 } } });
    expect((await a.load('alice'))?.observedDrafts?.['same-tab']).not.toBe(oldReview?.observedDrafts?.['same-tab']);
  });
  it('proves merged drafts are included before clearing them and preserves the newest server revision', async () => {
    const a = createAccountCacheClient('tab-a'), b = createAccountCacheClient('tab-b');
    await a.save('alice', draft(data => { data.preferences.sleepHours = 9; }));
    const accepted = emptyAccountData(); accepted.preferences.sleepHours = 9; accepted.preferences.caffeine = false;
    await b.save('alice', clean(accepted, 2));
    expect(await a.load('alice')).toMatchObject({ pending: false, baseline: { revision: 2 }, data: accepted });
    await a.save('alice', clean(emptyAccountData(), 1));
    expect(await b.load('alice')).toMatchObject({ pending: false, baseline: { revision: 2 }, data: accepted });
  });
  it('refuses a clean tab’s cache clear when a different tab has outstanding drafts', async () => {
    const a = createAccountCacheClient('tab-a'), b = createAccountCacheClient('tab-b');
    await b.save('alice', clean());
    await a.save('alice', draft(data => { data.preferences.sleepHours = 9; }));
    await expect(b.clear('alice')).rejects.toThrow('Another tab has unsaved changes');
    expect((await a.load('alice'))?.data.preferences.sleepHours).toBe(9);
  });
  it('does not infer inclusion for baseline-free drafts from an invented empty baseline', async () => {
    const a = createAccountCacheClient('tab-a'), b = createAccountCacheClient('tab-b');
    const data = emptyAccountData(); data.preferences.sleepHours = 9;
    await a.save('alice', { version: 1, data, baseline: null, pending: true });
    const remote = structuredClone(data); remote.preferences.caffeine = false;
    await b.save('alice', clean(remote, 2));
    const recovered = await a.load('alice');
    expect(recovered?.pending).toBe(true);
    expect(recovered?.conflict?.reasons).toContain('Unsaved changes in another tab have no common saved version');
  });
  it('retains pending drafts across a newer server deletion as a conflict', async () => {
    const a = createAccountCacheClient('tab-a'), b = createAccountCacheClient('tab-b');
    await a.save('alice', draft(data => { data.preferences.sleepHours = 9; }));
    await b.save('alice', { version: 1, data: emptyAccountData(), baseline: { data: null, revision: 2 }, pending: false });
    const recovered = await a.load('alice');
    expect(recovered?.baseline).toEqual({ data: null, revision: 2 });
    expect(recovered?.pending).toBe(true);
    expect(recovered?.conflict?.reasons).toContain('Saved account data was deleted while another tab has unsaved changes');
  });
});
