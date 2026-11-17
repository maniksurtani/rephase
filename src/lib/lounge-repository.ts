import { openDB } from 'idb';
import {
  CATALOG_PATH,
  CATALOG_LIMIT,
  GUIDE_LIMIT,
  CATALOG_TTL,
  LOUNGE_CATALOG,
  parseCatalog,
  parseGuide,
  type LoungeCatalog,
} from './lounge-catalog';
import type { AirportLoungeData } from './lounge-types';

interface CachedGuide {
  version: string;
  data: AirportLoungeData;
  usedAt: number;
}
export interface LoungeCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}
function browserCache(): LoungeCache {
  // Separate from private account data; public guides can be reused after sign-out.
  let pending: ReturnType<typeof openDB> | undefined;
  const db = () =>
    (pending ??= openDB('rephase-lounges', 1, {
      upgrade(db) {
        db.createObjectStore('guides');
      },
    }));
  return {
    get: async (key) => (await db()).get('guides', key),
    set: async (key, value) => {
      await (await db()).put('guides', value, key);
    },
    remove: async (key) => {
      await (await db()).delete('guides', key);
    },
    keys: async () => (await (await db()).getAllKeys('guides')).map(String),
  };
}
export interface LoungeGuideResult {
  data?: AirportLoungeData;
  status: 'ready' | 'cached' | 'unavailable' | 'unsupported';
}
/** Public static downloads only. Access evaluation and private preferences remain local. */
export class LoungeRepository {
  catalog: LoungeCatalog = LOUNGE_CATALOG;
  private checkedAt = 0;
  private attemptedAt = -Infinity;
  private hydrated = false;
  private catalogRequest?: Promise<void>;
  private requests = new Map<string, Promise<LoungeGuideResult>>();
  private memory = new Map<string, CachedGuide>();
  private pinned = new Set<string>();
  private prefetching?: Promise<void>;
  private prefetchKey = '';
  constructor(
    private cache: LoungeCache = browserCache(),
    private fetcher: typeof fetch = (...args) => fetch(...args),
    private clock: () => number = Date.now,
  ) {}
  private async read(key: string) {
    try {
      return await this.cache.get(key);
    } catch {
      return undefined;
    }
  }
  private async save(key: string, value: unknown) {
    try {
      await this.cache.set(key, value);
    } catch {
      /* Memory fallback when storage is unavailable/full. */
    }
  }
  private async download(path: string, limit: number): Promise<string> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Offline.');
    const response = await this.fetcher(path, {
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-cache',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json'))
      throw new Error('Guide unavailable.');
    if (Number(response.headers.get('Content-Length')) > limit) throw new Error('Guide too large.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty guide.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error('Guide too large.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  async refreshCatalog(force = false): Promise<void> {
    if (this.catalogRequest) return this.catalogRequest;
    this.catalogRequest = (async () => {
      if (!this.hydrated) {
        const saved = (await this.read('catalog')) as
          { catalog: unknown; checkedAt: number } | undefined;
        try {
          if (saved) {
            this.catalog = parseCatalog(saved.catalog);
            this.checkedAt = Number(saved.checkedAt) || 0;
          }
        } catch {
          /* Ignore an incompatible/corrupt cache. */
        }
        this.hydrated = true;
      }
      const now = this.clock();
      if (!force && (now - this.checkedAt < CATALOG_TTL || now - this.attemptedAt < 60000)) return;
      this.attemptedAt = now;
      try {
        const catalog = parseCatalog(JSON.parse(await this.download(CATALOG_PATH, CATALOG_LIMIT)));
        this.catalog = catalog;
        this.checkedAt = now;
        await this.save('catalog', { catalog, checkedAt: now });
      } catch {
        /* Keep the last index (or small bundled seed) when offline. */
      }
    })();
    try {
      await this.catalogRequest;
    } finally {
      this.catalogRequest = undefined;
    }
  }
  async load(airport: string): Promise<LoungeGuideResult> {
    if (!/^[A-Z]{3}$/.test(airport)) return { status: 'unsupported' };
    const pending = this.requests.get(airport);
    if (pending) return pending;
    const request = this.loadGuide(airport);
    this.requests.set(airport, request);
    try {
      return await request;
    } finally {
      this.requests.delete(airport);
    }
  }
  private async loadGuide(airport: string): Promise<LoungeGuideResult> {
    let cached = this.memory.get(airport);
    if (!cached) {
      try {
        const value = (await this.read(airport)) as CachedGuide | undefined;
        if (value && /^[a-f0-9]{64}$/.test(value.version))
          cached = { ...value, data: parseGuide(value.data, airport) };
      } catch {
        /* A bad cache cannot replace a validated download. */
      }
    }
    await this.refreshCatalog();
    let entry = this.catalog.airports.find((item) => item.airport === airport);
    if (!entry)
      return {
        status: this.clock() - this.checkedAt < CATALOG_TTL ? 'unsupported' : 'unavailable',
      };
    try {
      let changed = !cached || cached.version !== entry.version;
      if (!cached || changed) {
        let raw: string;
        try {
          raw = await this.download(entry.path, GUIDE_LIMIT);
        } catch {
          // An older index may point at a file removed by a newer deployment.
          const previous = entry.version;
          await this.refreshCatalog(true);
          entry = this.catalog.airports.find((item) => item.airport === airport);
          if (!entry || entry.version === previous) throw new Error('Guide unavailable.');
          raw = await this.download(entry.path, GUIDE_LIMIT);
        }
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
        const version = [...new Uint8Array(hash)]
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('');
        if (version !== entry.version) throw new Error('Guide version mismatch.');
        cached = { version, data: parseGuide(JSON.parse(raw), airport), usedAt: this.clock() };
      }
      changed ||= this.clock() - cached.usedAt > 3_600_000;
      this.memory.set(airport, cached);
      if (changed) {
        cached.usedAt = this.clock();
        await this.save(airport, cached);
        await this.trim();
      }
      return {
        data: cached.data,
        status: this.clock() - this.checkedAt < CATALOG_TTL ? 'ready' : 'cached',
      };
    } catch {
      if (cached) {
        this.memory.set(airport, cached);
        return { data: cached.data, status: 'cached' };
      }
      return { status: 'unavailable' };
    }
  }
  async prefetch(airports: readonly string[]): Promise<void> {
    this.pinned = new Set(airports);
    const key = [...this.pinned].sort().join(',');
    if (this.prefetching) {
      if (key === this.prefetchKey) return this.prefetching;
      await this.prefetching;
      return this.prefetch([...this.pinned]);
    }
    this.prefetchKey = key;
    this.prefetching = (async () => {
      await this.refreshCatalog();
      const queue = [...this.pinned].filter((code) =>
        this.catalog.airports.some((entry) => entry.airport === code),
      );
      const run = async () => {
        for (let code = queue.shift(); code; code = queue.shift()) await this.load(code);
      };
      await Promise.all([run(), run()]);
      await this.trim();
    })();
    try {
      await this.prefetching;
    } finally {
      this.prefetching = undefined;
    }
  }
  private async trim() {
    try {
      const keys = (await this.cache.keys()).filter(
        (key) => /^[A-Z]{3}$/.test(key) && !this.pinned.has(key) && !this.requests.has(key),
      );
      if (keys.length <= 64) return;
      const oldest = await Promise.all(
        keys.map(async (key) => ({
          key,
          used: Number(((await this.read(key)) as CachedGuide)?.usedAt) || 0,
        })),
      );
      oldest.sort((a, b) => b.used - a.used);
      for (const { key } of oldest.slice(64)) {
        await this.cache.remove(key);
        this.memory.delete(key);
      }
    } catch {
      /* Storage cleanup must not block the guide. */
    }
  }
}
export const loungeRepository = new LoungeRepository();
