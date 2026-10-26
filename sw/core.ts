/**
 * Service-worker logic (Task 34). Pure/injectable so tests can run it against a fake `self` + Cache API.
 * Strategy: precache everything at install; cache-first with network fallback; navigations resolve to the cached app shell
 * (index.html, query string ignored so ?load=3 / ?continue=1 / ?seed=.. work offline); manifest network-first; never cross-origin.
 */
export interface PrecacheEntry { url: string; revision: string }
export const CACHE_PREFIX = 'slope-tycoon-';
export const cacheName = (version: string): string => `${CACHE_PREFIX}${version}`;
export const isOurCache = (name: string): boolean => name.startsWith(CACHE_PREFIX);
export const absUrl = (rel: string, scope: string): string => new URL(rel, scope).href;
export const stripSearch = (url: string): string => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; };

export interface ReqLike { url: string; method: string; mode?: string; headers?: { get(n: string): string | null } }
export const isNavigation = (r: ReqLike): boolean => r.mode === 'navigate' || (r.method === 'GET' && (r.headers?.get('accept') ?? '').includes('text/html'));

/** Returns the precached absolute URL a request maps to (search/hash ignored; directory URL -> index.html), or null. */
export function matchPrecache(url: string, scope: string, manifest: readonly PrecacheEntry[]): string | null {
  const bare = stripSearch(url);
  const index = absUrl('index.html', scope);
  const target = bare === scope || bare === index ? index : bare;
  return manifest.some((e) => absUrl(e.url, scope) === target) ? target : null;
}
/** Runtime caching is only for same-origin GET requests; sw.js itself is never cached. */
export function shouldCache(r: ReqLike, scope: string): boolean {
  if (r.method !== 'GET') return false;
  const u = new URL(r.url), s = new URL(scope);
  if (u.origin !== s.origin || !/^https?:$/.test(u.protocol)) return false;
  return !u.pathname.endsWith('/sw.js');
}
export const isManifestRequest = (url: string): boolean => new URL(url).pathname.endsWith('.webmanifest');

// ---- minimal structural types so the module needs neither the DOM nor WebWorker libs ----
export interface CacheLike { addAll(reqs: unknown[]): Promise<void>; put(r: unknown, res: ResponseLike): Promise<void>; match(r: unknown, o?: { ignoreSearch?: boolean }): Promise<ResponseLike | undefined> }
export interface ResponseLike { ok: boolean; status: number; type?: string; clone(): ResponseLike }
export interface CachesLike { open(n: string): Promise<CacheLike>; keys(): Promise<string[]>; delete(n: string): Promise<boolean>; match(r: unknown): Promise<ResponseLike | undefined> }
export interface FetchEventLike { request: ReqLike; respondWith(p: Promise<ResponseLike>): void }
export interface SwScope {
  registration: { scope: string; active?: unknown };
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void> | void;
  caches: CachesLike;
  fetch(r: unknown, init?: unknown): Promise<ResponseLike>;
  addEventListener(type: string, fn: (e: never) => void): void;
  makeRequest?(url: string, init?: Record<string, unknown>): unknown;
}

export function installSW(sw: SwScope, manifest: readonly PrecacheEntry[], version: string): void {
  const scope = sw.registration.scope, name = cacheName(version), indexUrl = absUrl('index.html', scope);
  const mk = sw.makeRequest ?? ((u: string, i?: Record<string, unknown>) => new Request(u, i));
  const offline = (): ResponseLike => new Response('Offline and not cached', { status: 503, headers: { 'content-type': 'text/plain' } }) as unknown as ResponseLike;

  sw.addEventListener('install', ((e: { waitUntil(p: Promise<unknown>): void }) => {
    e.waitUntil((async () => {
      const cache = await sw.caches.open(name);
      await cache.addAll(manifest.map((m) => mk(absUrl(m.url, scope), { cache: 'reload' })));
      // First ever install: nothing to disturb, activate at once. Updates wait for the user's SKIP_WAITING message.
      if (!sw.registration.active) await sw.skipWaiting();
    })());
  }) as never);

  sw.addEventListener('activate', ((e: { waitUntil(p: Promise<unknown>): void }) => {
    e.waitUntil((async () => {
      for (const k of await sw.caches.keys()) if (isOurCache(k) && k !== name) await sw.caches.delete(k);
      await sw.clients.claim();
    })());
  }) as never);

  sw.addEventListener('message', ((e: { data?: { type?: string }; ports?: Array<{ postMessage(m: unknown): void }>; source?: { postMessage(m: unknown): void } | null }) => {
    const t = e.data?.type;
    if (t === 'SKIP_WAITING') void sw.skipWaiting();
    else if (t === 'GET_VERSION') { const m = { type: 'VERSION', version }; (e.ports?.[0] ?? e.source)?.postMessage(m); }
  }) as never);

  sw.addEventListener('fetch', ((e: FetchEventLike) => {
    const r = e.request;
    if (!shouldCache(r, scope)) return; // cross-origin / non-GET / sw.js: browser default
    if (isManifestRequest(r.url)) { e.respondWith(networkFirst(r)); return; }
    const hit = isNavigation(r) ? indexUrl : matchPrecache(r.url, scope, manifest);
    if (hit) { e.respondWith(cacheFirst(hit, r)); return; }
    e.respondWith(runtime(r));
  }) as never);

  async function cacheFirst(key: string, r: ReqLike): Promise<ResponseLike> {
    const cache = await sw.caches.open(name);
    const c = await cache.match(key);
    if (c) return c;
    try { return await sw.fetch(r); } catch { return offline(); }
  }
  async function networkFirst(r: ReqLike): Promise<ResponseLike> {
    const cache = await sw.caches.open(name);
    try { const res = await sw.fetch(r); if (res.ok) await cache.put(r, res.clone()); return res; }
    catch { return (await cache.match(stripSearch(r.url))) ?? (await cache.match(r)) ?? offline(); }
  }
  async function runtime(r: ReqLike): Promise<ResponseLike> {
    const cache = await sw.caches.open(name);
    const c = await cache.match(r);
    if (c) return c;
    try {
      const res = await sw.fetch(r);
      if (res.ok && res.type !== 'opaque') await cache.put(r, res.clone());
      return res;
    } catch { return offline(); }
  }
}
