import { describe,expect,it,vi } from 'vitest';
import { ApiError } from '../src/lib/api';
import { createInitialData } from '../src/lib/defaults';
import { foldInFlightEdits,hasContentChanges,reconcileSync } from '../src/lib/sync';
import type { AppData } from '../src/lib/types';
const copy=(data:AppData)=>structuredClone(data);

describe('bounded three-way cloud synchronization',()=> {
  it('merges independent device preferences and stable-ID trip edits before upload',async()=> {
    const base=createInitialData(),local=copy(base),remote=copy(base);
    local.preferences.caffeine=false;remote.preferences.sleepHours=9;
    local.trips[0].name='Local trip name';remote.trips[0].legs[0].lieFlat=false;
    const get=vi.fn(async()=>({data:remote,revision:8}));
    const put=vi.fn(async()=>({revision:9}));
    const result=await reconcileSync(local,{data:base,revision:7},{get,put});
    expect(result.kind).toBe('accepted');
    if(result.kind!=='accepted')throw new Error('Expected acceptance');
    expect(result.data.preferences.caffeine).toBe(false);
    expect(result.data.preferences.sleepHours).toBe(9);
    expect(result.data.trips[0].name).toBe('Local trip name');
    expect(result.data.trips[0].legs[0].lieFlat).toBe(false);
    expect(put).toHaveBeenCalledWith(result.data,8);
    expect(result.snapshot).toEqual({data:result.data,revision:9});
  });
  it('downloads a cloud-only change without unnecessary writes',async()=> {
    const base=createInitialData(),remote=copy(base);remote.preferences.sleepHours=9;
    const put=vi.fn(async()=>({revision:9}));
    const result=await reconcileSync(base,{data:base,revision:7},{get:async()=>({data:remote,revision:8}),put});
    expect(result.kind).toBe('accepted');expect(put).not.toHaveBeenCalled();
    if(result.kind==='accepted')expect(result.data.preferences.sleepHours).toBe(9);
  });
  it('preserves overlapping edits for manual choice and never overwrites without a common base',async()=> {
    const base=createInitialData(),local=copy(base),remote=copy(base);
    local.preferences.sleepHours=9;remote.preferences.sleepHours=10;
    const put=vi.fn(async()=>({revision:9}));
    const transport={get:async()=>({data:remote,revision:8}),put};
    expect((await reconcileSync(local,{data:base,revision:7},transport)).kind).toBe('conflict');
    expect((await reconcileSync(local,null,transport)).kind).toBe('conflict');
    expect(put).not.toHaveBeenCalled();
    expect(local.preferences.sleepHours).toBe(9);
  });
  it('retries one optimistic409 using refreshed remote edits',async()=> {
    const base=createInitialData(),local=copy(base),remote=copy(base),newRemote=copy(base);
    local.preferences.caffeine=false;remote.preferences.sleepHours=9;
    newRemote.preferences.sleepHours=9;newRemote.preferences.chronotype='late';
    const get=vi.fn().mockResolvedValueOnce({data:remote,revision:8}).mockResolvedValueOnce({data:newRemote,revision:9});
    const put=vi.fn().mockRejectedValueOnce(new ApiError('stale',409)).mockResolvedValueOnce({revision:10});
    const result=await reconcileSync(local,{data:base,revision:7},{get,put});
    expect(result.kind).toBe('accepted');expect(get).toHaveBeenCalledTimes(2);expect(put).toHaveBeenCalledTimes(2);
    if(result.kind==='accepted') {
      expect(result.data.preferences.chronotype).toBe('late');expect(result.data.preferences.caffeine).toBe(false);
    }
  });
  it('bounds repeated conflicts and makes no outage retry loop',async()=> {
    const base=createInitialData(),local=copy(base);local.preferences.caffeine=false;
    const get=vi.fn(async()=>({data:base,revision:8}));
    const put=vi.fn(async()=>{throw new ApiError('stale',409);});
    expect((await reconcileSync(local,{data:base,revision:7},{get,put})).kind).toBe('conflict');
    expect(get).toHaveBeenCalledTimes(3);expect(put).toHaveBeenCalledTimes(2);
    const offline=vi.fn(async()=>{throw new Error('offline');});
    await expect(reconcileSync(local,{data:base,revision:7},{get:offline,put})).rejects.toThrow('offline');
    expect(offline).toHaveBeenCalledTimes(1);
  });
  it('does not recreate a deleted cloud record during automatic sync',async()=> {
    const base=createInitialData();
    const put=vi.fn(async()=>({revision:13}));
    const transport={get:async()=>({data:null,revision:12}),put};
    expect((await reconcileSync(base,{data:base,revision:7},transport)).kind).toBe('deleted');
    expect(put).not.toHaveBeenCalled();
  });
  it('keeps edits made while an upload is in flight and flags overlapping late changes',()=> {
    const sent=createInitialData(),latest=copy(sent),accepted=copy(sent);
    latest.preferences.caffeine=false;accepted.preferences.sleepHours=9;
    const merged=foldInFlightEdits(sent,latest,accepted);
    expect(merged.conflicts).toEqual([]);
    expect(merged.data.preferences).toMatchObject({caffeine:false,sleepHours:9});
    latest.preferences.sleepHours=10;
    const conflict=foldInFlightEdits(sent,latest,accepted);
    expect(conflict.conflicts).toContain('preferences.sleepHours');
    expect(conflict.data.preferences.sleepHours).toBe(10);
  });
  it('rejects malformed remote revisions before committing any payload',async()=> {
    const data=createInitialData(),put=vi.fn(async()=>({revision:1}));
    await expect(reconcileSync(data,null,{get:async()=>({data:null,revision:NaN}),put})).rejects.toThrow('invalid');
    expect(put).not.toHaveBeenCalled();
  });
});

it('treats selecting another trip as device navigation, preserving deletion pause semantics',async()=> {
  const base=createInitialData(),selected=copy(base);selected.selectedTripId=null;
  expect(hasContentChanges(base,selected)).toBe(false);
  const put=vi.fn(async()=>({revision:2}));
  const existing=await reconcileSync(selected,{data:base,revision:1},{get:async()=>({data:base,revision:1}),put});
  expect(existing.kind).toBe('accepted');expect(put).not.toHaveBeenCalled();
  const deleted=await reconcileSync(selected,{data:base,revision:1},{get:async()=>({data:null,revision:2}),put});
  expect(deleted.kind).toBe('deleted');expect(put).not.toHaveBeenCalled();
  selected.preferences.caffeine=false;
  expect(hasContentChanges(base,selected)).toBe(true);
});
