import { installSW, type PrecacheEntry, type SwScope } from './core';

declare const __PRECACHE_MANIFEST__: PrecacheEntry[];
declare const __CACHE_VERSION__: string;

// ServiceWorkerGlobalScope already has registration/clients/skipWaiting/caches/fetch/addEventListener.
installSW(self as unknown as SwScope, __PRECACHE_MANIFEST__, __CACHE_VERSION__);
