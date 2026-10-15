import { describe,expect,it } from 'vitest';
import { createInitialData } from '../src/lib/defaults';
import { mergeAppData } from '../src/lib/merge';

describe('three-way account merge',()=> {
  it('merges disjoint edits to preferences and different flight legs',()=> {
    const base=createInitialData(),local=structuredClone(base),remote=structuredClone(base);
    local.preferences.sleepHours=9;remote.preferences.caffeine=false;
    local.trips[0].legs[0].lieFlat=false;remote.trips[0].legs[1].travelClass='economy';
    local.trips[0].updatedAt='2026-10-15T00:00:00Z';remote.trips[0].updatedAt='2026-10-16T00:00:00Z';
    const result=mergeAppData(base,local,remote);
    expect(result.conflicts).toEqual([]);
    expect(result.data.preferences).toMatchObject({sleepHours:9,caffeine:false});
    expect(result.data.trips[0].legs[0].lieFlat).toBe(false);
    expect(result.data.trips[0].legs[1].travelClass).toBe('economy');
  });
  it('merges aircraft refreshes with cabin edits but keeps aircraft tied to flight identity',()=> {
    const base=createInitialData();base.trips[0].legs[0].aircraft={model:'Boeing 777-300ER'};
    const local=structuredClone(base),remote=structuredClone(base);
    local.trips[0].legs[0].travelClass='economy';
    remote.trips[0].legs[0].aircraft={model:'Boeing 787-9'};
    const refreshed=mergeAppData(base,local,remote);
    expect(refreshed.conflicts).toEqual([]);
    expect(refreshed.data.trips[0].legs[0]).toMatchObject({aircraft:{model:'Boeing 787-9'},travelClass:'economy'});
    local.trips[0].legs[0].flightNumber='BA123';delete local.trips[0].legs[0].aircraft;
    const changed=mergeAppData(base,local,remote);
    expect(changed.conflicts.some(path=>path.includes('flightDetails'))).toBe(true);
    expect(changed.data.trips[0].legs[0].flightNumber).toBe('BA123');
    expect(changed.data.trips[0].legs[0].aircraft).toBeUndefined();
  });
  it('detects delete-versus-edit instead of silently losing a trip',()=> {
    const base=createInitialData(),local=structuredClone(base),remote=structuredClone(base);
    local.trips=[];local.selectedTripId=null;remote.trips[0].name='Changed on another device';
    expect(mergeAppData(base,local,remote).conflicts.some(path=>path.startsWith('trips.'))).toBe(true);
  });
  it('requires a choice for contradictory sleep settings',()=> {
    const base=createInitialData(),local=structuredClone(base),remote=structuredClone(base);
    local.preferences.sleepHours=9;remote.preferences.sleepHours=7;
    expect(mergeAppData(base,local,remote).conflicts).toContain('preferences.sleepHours');
  });
  it('does not combine independently changed timing and airport fields on one flight',()=> {
    const base=createInitialData(),local=structuredClone(base),remote=structuredClone(base);
    local.trips[0].legs[0].departureTimeZone='America/New_York';
    remote.trips[0].legs[0].departureDateTime=remote.trips[0].legs[0].departureDateTime.replace('18:30','17:30');
    expect(mergeAppData(base,local,remote).conflicts.some(path=>path.includes('flightDetails'))).toBe(true);
  });
});
