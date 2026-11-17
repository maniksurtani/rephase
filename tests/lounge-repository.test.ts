import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { LoungeRepository, type LoungeCache } from '../src/lib/lounge-repository';
import { parseCatalog, parseGuide, loungeTripAirports, CATALOG_PATH, CATALOG_TTL } from '../src/lib/lounge-catalog';
import sfo from '../data/lounges/SFO.json';
import lax from '../data/lounges/LAX.json';
import october from './fixtures/itineraries/oct2026.json';
import type { Trip } from '../src/lib/types';

function memory(): LoungeCache {
  const values = new Map<string, unknown>();
  return { get: async key => values.get(key), set: async (key, value) => { values.set(key, structuredClone(value)); }, remove: async key => { values.delete(key); }, keys: async () => [...values.keys()] };
}
function server(guides = [sfo, lax]) {
  const files = new Map<string, string>();
  const catalog = { schemaVersion: 1, airports: guides.map(data => {
    const raw = JSON.stringify(data), version = createHash('sha256').update(raw).digest('hex');
    const path = `/lounge-data/v1/airports/${data.airport}.${version}.json`;
    files.set(path, raw);
    return { airport: data.airport, timeZone: data.timeZone, updatedAt: data.updatedAt, version, path };
  }) };
  files.set(CATALOG_PATH, JSON.stringify(catalog));
  const fetcher = vi.fn(async (url: RequestInfo | URL) => new Response(files.get(String(url)) ?? '{}', { status: files.has(String(url)) ? 200 : 404, headers: { 'Content-Type': 'application/json' } }));
  return { files, catalog, fetcher };
}

describe('downloaded public lounge guides', () => {
  it('deduplicates downloads, stores only the requested airport and reopens it offline after restart', async () => {
    const cache = memory(), remote = server();
    const start = Date.parse('2026-11-18T00:00Z');
    const repo = new LoungeRepository(cache, remote.fetcher, () => start);
    const results = await Promise.all([repo.load('SFO'), repo.load('SFO')]);
    expect(results[0].data).toEqual(sfo);
    expect(remote.fetcher.mock.calls.map(([url]) => url)).toEqual([CATALOG_PATH, remote.catalog.airports[0].path]);
    expect(await cache.keys()).toEqual(['catalog', 'SFO']);
    const offline = vi.fn().mockRejectedValue(new Error('offline'));
    const restarted = new LoungeRepository(cache, offline, () => start + CATALOG_TTL + 1);
    expect(await restarted.load('SFO')).toEqual({ status: 'cached', data: sfo });
    expect((await restarted.load('LAX')).status).toBe('unavailable');
  });

  it('refreshes guide content and newly covered airports without an app update', async () => {
    const cache = memory(), original = server([sfo]);
    let now = Date.parse('2026-11-18T00:00Z');
    const repo = new LoungeRepository(cache, original.fetcher, () => now);
    await repo.load('SFO');
    const updated = structuredClone(sfo);
    updated.lounges[0].name = 'Updated lounge';
    const next = server([updated, lax]);
    original.fetcher.mockImplementation(next.fetcher);
    now += CATALOG_TTL + 1;
    expect((await repo.load('SFO')).data?.lounges[0].name).toBe('Updated lounge');
    expect((await repo.load('LAX')).data).toEqual(lax);
  });

  it.each(['hash', 'schema', 'html'])('preserves the valid cached guide after a %s failure', async fault => {
    const cache = memory(), remote = server([sfo]);
    let now = Date.parse('2026-11-18T00:00Z');
    const repo = new LoungeRepository(cache, remote.fetcher, () => now);
    await repo.load('SFO');
    const updated = structuredClone(sfo);
    updated.lounges[0].name = 'Changed';
    if (fault === 'schema') updated.schemaVersion = 999;
    const next = server([updated]);
    if (fault === 'hash') next.files.set(next.catalog.airports[0].path, JSON.stringify(lax));
    remote.fetcher.mockImplementation(async url => fault === 'html' && String(url) !== CATALOG_PATH
      ? new Response('<html>SPA fallback</html>', { headers: { 'Content-Type': 'text/html' } }) : next.fetcher(url));
    now += CATALOG_TTL + 1;
    expect(await repo.load('SFO')).toEqual({ status: 'cached', data: sfo });
    expect((await cache.get('SFO') as { data: unknown }).data).toEqual(sfo);
  });

  it('refreshes an older manifest when a deployment has removed its hashed file', async () => {
    const cache = memory(), old = server([sfo]), updated = structuredClone(sfo);
    updated.lounges[0].name = 'New deployment';
    const next = server([updated]), now = Date.parse('2026-11-18T00:00Z');
    await cache.set('catalog', { catalog: old.catalog, checkedAt: now });
    const repo = new LoungeRepository(cache, next.fetcher, () => now);
    expect((await repo.load('SFO')).data?.lounges[0].name).toBe('New deployment');
    expect(next.fetcher.mock.calls.map(([url]) => url)).toEqual([old.catalog.airports[0].path, CATALOG_PATH, next.catalog.airports[0].path]);
  });

  it('prefetches saved trip airports, preserves pinned guides and distinguishes missing coverage', async () => {
    const cache = memory(), remote = server();
    const repo = new LoungeRepository(cache, remote.fetcher);
    for (let i = 0; i < 70; i++) await cache.set(`X${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}`, { usedAt: i });
    await repo.prefetch(['SFO', 'SFO', 'LAX', 'ZZZ']);
    expect(remote.fetcher).toHaveBeenCalledTimes(3);
    expect((await cache.keys()).filter(key => key !== 'catalog')).toHaveLength(66);
    expect((await repo.load('ZZZ')).status).toBe('unsupported');
    expect(loungeTripAirports([october.trip as Trip], Date.parse('2026-10-20T00:00Z'))).toEqual(['HNL', 'LAX', 'MEL', 'SFO', 'SYD']);
    expect(loungeTripAirports([october.trip as Trip], Date.parse('2026-11-18T00:00Z'))).toEqual([]);
  });

  it('rejects untrusted manifest paths, wrong-airport guides and unsafe external photo URLs', () => {
    const remote = server();
    remote.catalog.airports[0].path = 'https://example.com/guide.json';
    expect(() => parseCatalog(remote.catalog)).toThrow();
    expect(() => parseGuide(sfo, 'LAX')).toThrow();
    const bad = { ...sfo, lounges: [{ ...sfo.lounges[0], photoLinks: [{ label: 'Photos', url: 'javascript:alert(1)', checkedOn: '2026-11-18' }] }] };
    expect(() => parseGuide(bad, 'SFO')).toThrow();
  });
});
