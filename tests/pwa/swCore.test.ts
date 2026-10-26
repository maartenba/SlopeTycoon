import { describe, it, expect } from 'vitest';
import { installSW, matchPrecache, isNavigation, shouldCache, cacheName, isOurCache, type SwScope, type PrecacheEntry } from '../../sw/core';

const SCOPE = 'https://host.test/game/';
const MANIFEST: PrecacheEntry[] = [{ url: './index.html', revision: 'a' }, { url: './assets/app.js', revision: 'b' }, { url: './manifest.webmanifest', revision: 'c' }];
const reqOf = (url: string, mode = 'cors', method = 'GET') => ({ url, mode, method, headers: { get: () => null } });
const res = (body: string, ok = true) => ({ ok, status: ok ? 200 : 500, type: 'basic', body, clone() { return this; } });

function fake(opts: { active?: boolean; online?: boolean; existing?: string[] } = {}) {
  const stores = new Map<string, Map<string, ReturnType<typeof res>>>();
  for (const n of opts.existing ?? []) stores.set(n, new Map());
  const handlers: Record<string, (e: never) => void> = {};
  const net = { online: opts.online ?? true, hits: [] as string[] };
  const key = (r: unknown): string => (typeof r === 'string' ? r : (r as { url: string }).url);
  const cacheOf = (n: string) => {
    const s = stores.get(n) ?? new Map(); stores.set(n, s);
    return {
      async addAll(rs: unknown[]) { for (const r of rs) s.set(key(r), res('pre:' + key(r))); },
      async put(r: unknown, v: ReturnType<typeof res>) { s.set(key(r), v); },
      async match(r: unknown) { return s.get(key(r)); },
    };
  };
  const state = { skipped: 0, claimed: 0 };
  const self: SwScope = {
    registration: { scope: SCOPE, active: opts.active ? {} : undefined },
    clients: { async claim() { state.claimed++; } },
    skipWaiting() { state.skipped++; },
    caches: { async open(n) { return cacheOf(n); }, async keys() { return [...stores.keys()]; }, async delete(n) { return stores.delete(n); }, async match() { return undefined; } },
    async fetch(r) { net.hits.push(key(r)); if (!net.online) throw new Error('offline'); return res('net:' + key(r)); },
    addEventListener(t, fn) { handlers[t] = fn; },
    makeRequest: (url, init) => ({ url, ...init }),
  };
  installSW(self, MANIFEST, '0.1.0-abc');
  const waits: Promise<unknown>[] = [];
  const ev = (type: string, e: object) => handlers[type]!({ waitUntil: (p: Promise<unknown>) => waits.push(p), ...e } as never);
  const fetchEv = async (r: ReturnType<typeof reqOf>) => { let p: Promise<unknown> | null = null; ev('fetch', { request: r, respondWith: (x: Promise<unknown>) => { p = x; } }); return p ? ((await p) as ReturnType<typeof res>) : null; };
  return { stores, net, state, ev, waits, fetchEv };
}

describe('sw pure helpers', () => {
  it('cache names / prefix', () => { expect(cacheName('1')).toBe('slope-tycoon-1'); expect(isOurCache('slope-tycoon-x')).toBe(true); expect(isOurCache('other')).toBe(false); });
  it('matchPrecache ignores search/hash and maps scope root to index', () => {
    expect(matchPrecache(SCOPE + 'assets/app.js?v=1#x', SCOPE, MANIFEST)).toBe(SCOPE + 'assets/app.js');
    expect(matchPrecache(SCOPE + '?load=3', SCOPE, MANIFEST)).toBe(SCOPE + 'index.html');
    expect(matchPrecache(SCOPE + 'nope.js', SCOPE, MANIFEST)).toBeNull();
  });
  it('isNavigation / shouldCache', () => {
    expect(isNavigation(reqOf(SCOPE, 'navigate'))).toBe(true);
    expect(isNavigation(reqOf(SCOPE + 'a.js'))).toBe(false);
    expect(shouldCache(reqOf(SCOPE + 'a.js'), SCOPE)).toBe(true);
    expect(shouldCache(reqOf('https://cdn.test/a.js'), SCOPE)).toBe(false);
    expect(shouldCache(reqOf(SCOPE + 'a', 'cors', 'POST'), SCOPE)).toBe(false);
    expect(shouldCache(reqOf(SCOPE + 'sw.js'), SCOPE)).toBe(false);
  });
});

describe('sw handlers (fake self + Cache API)', () => {
  it('install precaches everything with absolute scope-relative URLs and cache:reload', async () => {
    const f = fake(); f.ev('install', {}); await Promise.all(f.waits);
    const s = f.stores.get('slope-tycoon-0.1.0-abc')!;
    expect([...s.keys()].sort()).toEqual([SCOPE + 'assets/app.js', SCOPE + 'index.html', SCOPE + 'manifest.webmanifest']);
  });
  it('first install skips waiting; an update install does NOT', async () => {
    const a = fake(); a.ev('install', {}); await Promise.all(a.waits); expect(a.state.skipped).toBe(1);
    const b = fake({ active: true }); b.ev('install', {}); await Promise.all(b.waits); expect(b.state.skipped).toBe(0);
  });
  it('skipWaiting only on SKIP_WAITING message; GET_VERSION replies', async () => {
    const f = fake({ active: true });
    f.ev('message', { data: { type: 'nothing' } }); expect(f.state.skipped).toBe(0);
    f.ev('message', { data: { type: 'SKIP_WAITING' } }); expect(f.state.skipped).toBe(1);
    const got: unknown[] = []; f.ev('message', { data: { type: 'GET_VERSION' }, ports: [{ postMessage: (m: unknown) => got.push(m) }] });
    expect(got).toEqual([{ type: 'VERSION', version: '0.1.0-abc' }]);
  });
  it('activate deletes only old slope-tycoon caches and claims clients', async () => {
    const f = fake({ existing: ['slope-tycoon-old', 'slope-tycoon-0.1.0-abc', 'unrelated'] });
    f.ev('activate', {}); await Promise.all(f.waits);
    expect([...f.stores.keys()].sort()).toEqual(['slope-tycoon-0.1.0-abc', 'unrelated']); expect(f.state.claimed).toBe(1);
  });
  it('fetch: cache-first hit does not touch network (offline works)', async () => {
    const f = fake({ online: false }); f.ev('install', {}); await Promise.all(f.waits);
    const r = await f.fetchEv(reqOf(SCOPE + 'assets/app.js?x=1'));
    expect((r as { body: string }).body).toBe('pre:' + SCOPE + 'assets/app.js'); expect(f.net.hits).toEqual([]);
  });
  it.each(['', '?load=3', '?continue=1', '?seed=7&size=128&start=summer'])('offline navigation %j returns app shell', async (q) => {
    const f = fake({ online: false }); f.ev('install', {}); await Promise.all(f.waits);
    const r = await f.fetchEv(reqOf(SCOPE + q, 'navigate'));
    expect((r as { body: string }).body).toBe('pre:' + SCOPE + 'index.html'); expect(f.net.hits).toEqual([]);
  });
  it('cross-origin and non-GET are not intercepted; sw.js not intercepted', async () => {
    const f = fake();
    expect(await f.fetchEv(reqOf('https://cdn.test/x.js'))).toBeNull();
    expect(await f.fetchEv(reqOf(SCOPE + 'assets/app.js', 'cors', 'POST'))).toBeNull();
    expect(await f.fetchEv(reqOf(SCOPE + 'sw.js'))).toBeNull();
  });
  it('manifest is network-first with cache fallback offline', async () => {
    const f = fake(); f.ev('install', {}); await Promise.all(f.waits);
    expect(((await f.fetchEv(reqOf(SCOPE + 'manifest.webmanifest'))) as { body: string }).body).toBe('net:' + SCOPE + 'manifest.webmanifest');
    f.net.online = false;
    expect(((await f.fetchEv(reqOf(SCOPE + 'manifest.webmanifest'))) as { body: string }).body).toContain('net:');
  });
  it('unknown same-origin asset: network, runtime-cached, then served offline', async () => {
    const f = fake(); f.ev('install', {}); await Promise.all(f.waits);
    await f.fetchEv(reqOf(SCOPE + 'extra.json')); f.net.online = false;
    expect(((await f.fetchEv(reqOf(SCOPE + 'extra.json'))) as { body: string }).body).toBe('net:' + SCOPE + 'extra.json');
    expect(((await f.fetchEv(reqOf(SCOPE + 'other.json'))) as { status: number }).status).toBe(503);
  });
});
