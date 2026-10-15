import { describe, expect, it, vi } from 'vitest';
import { canonicalTimeZone, searchTimeZones } from '../src/lib/time-zones';

describe('time-zone search',()=> {
  it.each([
    ['new york','America/New_York'],
    ['San Francisco','America/Los_Angeles'],
    ['são paulo','America/Sao_Paulo'],
    ['new_york','America/New_York'],
  ])('finds %s as an IANA zone', (query,value)=> {
    expect(searchTimeZones(query).map(option=>option.value)).toContain(value);
  });

  it('matches all words within one city instead of combining unrelated cities in the same zone',()=> {
    const matches=searchTimeZones('New York',30).map(option=>option.value);
    expect(matches).toContain('America/New_York');
    expect(matches).not.toContain('Australia/Brisbane');
  });

  it('prioritizes an exact IANA name and accepts a partially typed identifier',()=> {
    expect(searchTimeZones('Europe/London')[0]?.value).toBe('Europe/London');
    expect(searchTimeZones('America/Los_Ang').map(option=>option.value)).toContain('America/Los_Angeles');
  });

  it('resolves a valid saved alias only when a suggestion is requested',()=> {
    expect(canonicalTimeZone('US/Eastern')).toBe('America/New_York');
    expect(searchTimeZones('US/Eastern')[0]?.value).toBe('America/New_York');
    expect(canonicalTimeZone('Mars/Olympus_Mons')).toBeNull();
    expect(searchTimeZones('Mars/Olympus_Mons')).toEqual([]);
  });

  it.each(['UTC','Etc/UTC','GMT'])('offers the UTC canonical suggestion for %s',query=> {
    expect(canonicalTimeZone(query)).toBe('UTC');
    expect(searchTimeZones(query)[0]?.value).toBe('UTC');
  });

  it('limits broad results without duplicate zones or invalid identifiers',()=> {
    const results=searchTimeZones('america',5);
    expect(results).toHaveLength(5);
    expect(new Set(results.map(option=>option.value)).size).toBe(results.length);
    for(const option of results)expect(()=>new Intl.DateTimeFormat('en',{timeZone:option.value})).not.toThrow();
  });

  it('retains UTC and bundled city choices when the runtime cannot enumerate time zones',async()=> {
    const enumeration=vi.spyOn(Intl,'supportedValuesOf').mockImplementation(()=>{throw new RangeError('Enumeration unavailable');});
    vi.resetModules();
    try {
      const fallback=await import('../src/lib/time-zones');
      expect(fallback.searchTimeZones('Sydney').map(option=>option.value)).toContain('Australia/Sydney');
      expect(fallback.searchTimeZones('UTC')[0]?.value).toBe('UTC');
      expect(fallback.searchTimeZones('New York').map(option=>option.value)).toContain('America/New_York');
    } finally {enumeration.mockRestore();vi.resetModules();}
  });
});
