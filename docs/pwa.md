# PWA / offline (Task 34)

Installable, fully offline: hand-written service worker (no Workbox, no CDN), procedurally generated icons.

## Pieces
| File | Role |
|---|---|
| `public/manifest.webmanifest` | name, `start_url`/`scope` `./`, standalone, icons 192/512/maskable-512/apple 180 |
| `scripts/gen-icons.ts`, `scripts/lib/png.ts` | pure-Node PNG encoder + procedural logo → `public/icons/*` (committed). `npm run gen:icons`; `prebuild` regenerates only if missing |
| `vite-plugins/precache.ts` | after the bundle: lists every file in `dist` with a content hash, compiles `sw/sw.ts` (esbuild, ES2019 IIFE) with `__PRECACHE_MANIFEST__` + `__CACHE_VERSION__` (`<package version>-<hash of list>`) → `dist/sw.js` |
| `sw/core.ts`, `sw/sw.ts` | SW logic (pure + injectable) and entry |
| `src/pwa/registerSW.ts` | production-only registration, update flow, online/offline + install-prompt watchers |

## Behaviour
- **install**: precache all (`cache: 'reload'`). First ever install activates immediately; an *update* waits (no automatic skipWaiting).
- **activate**: deletes other `slope-tycoon-*` caches, claims clients.
- **fetch**: same-origin GET only. Navigations → cached `index.html` (query string ignored, so `?load=3`, `?continue=1`, `?seed=..&size=..&start=..` work offline). Precached assets cache-first; `*.webmanifest` network-first; unknown same-origin GETs network then runtime-cached. Cross-origin and `sw.js` are never touched: in particular the opt-in Google Analytics script (`www.googletagmanager.com`) and its beacons are never precached, intercepted or cached by the service worker (`shouldCache` rejects other origins; `tests/repo/analytics.test.ts` also asserts `dist/sw.js` names no analytics host). Offline guarantee for analytics: `docs/analytics.md`.
- **update**: new SW installed while one controls the page → toast "Update available — reload" (Reload button, stays ~10 min). Click → autosave (`?continue=1` after reload so the game resumes; if autosave is off/fails the update is paused with a warning) → `SKIP_WAITING` → one reload on `controllerchange` (never reloads on first-install claim).
- **dev**: no SW; stale registrations and `slope-tycoon-*` caches are removed on load.
- **UI**: top bar shows an *Offline* pill and a *⤓ Install* button (only while `beforeinstallprompt` is available); Help lists iOS "Add to Home Screen".
- Saves live in IndexedDB (local), so save/load works offline. Needs http(s)/localhost (not `file://`, which shows the existing message). All URLs are relative (`base './'`) so any static subpath works.

## Verification
- `npm test` → `tests/pwa/*` (plugin on a temp dist, SW handlers against a fake `self`/Cache, register/update decisions, manifest + PNG IHDR).
- `npm run build && npm run verify:pwa`: serves `dist/` and checks index/manifest/icons/`sw.js`, every precache entry → 200 with the right content-type, relative URLs, no duplicates.

## Analytics and offline
`npm run build && npm run analytics:e2e` (Chrome, https on the fake host `slope.test`, Google hosts intercepted and never really contacted) checks: no consent / denied / headless / `?analytics=0` => zero Google requests; Allow => one gtag script request; Google blocked => the game boots and the simulation runs; service worker active, origin shut down and `navigator.onLine === false` => the game boots from the cache with no Google request and no page error. Details in `docs/analytics.md`.

## Manual checklist (not automatable here; **unverified in a real browser**)
1. `npm run build && npm run preview`, open the printed URL in Chrome.
2. DevTools → Application → Manifest: no errors, installability "Installable" (the Lighthouse PWA category was removed in newer Lighthouse; use this panel). Icons render; maskable preview OK.
3. Application → Service Workers: `sw.js` activated; Cache Storage has `slope-tycoon-<version>` with all files.
4. Network → Offline, reload (also with `?continue=1`): game loads, Offline pill shows; save (F5), reload, load works.
5. Update flow: change something, `npm run build` again (served by preview), reload the old tab → toast appears → Reload → new version active (Application shows the new cache, old one gone), game resumed.
6. Install via ⤓ Install / browser menu; Safari iOS: Share → Add to Home Screen.

## Size (`npm run build`, three.js split into its own chunk)
| file | raw | gzip |
|---|---|---|
| `assets/three-*.js` | 579.5 kB | 145.6 kB |
| `assets/index-*.js` | 756.2 kB | 263.3 kB |
| css + html + icons + manifest | ~30 kB | ~25 kB |
| **precache total (10 files, excl. sw.js)** | **1336 kB** | **427 kB** (target < 2 MB gzip ✔) |

`sw.js` ≈ 2.9 kB. Both JS chunks still exceed Vite's 500 kB warning (three.js itself is ~580 kB; the game is 756 kB); further splitting was not attempted.

## Subpath hosting (GitHub Pages project sites)
- `base: './'`, manifest `start_url`/`scope` `./`, `register('./sw.js', { scope: './' })` and the SW's `new URL(rel, registration.scope)` are all relative, so `https://slopetycoon.com/` works unchanged (no `src/` edit needed; checked by `npm run verify:pwa -- --base /SlopeTycoon/`).
- `dist/404.html` (created by `scripts/post-build.ts`) and `.nojekyll`/`CNAME` are excluded from the precache list; they are not needed offline.
- The SW scope is the app folder; other sites on the same origin (`/<other-repo>/`) are not affected.
- `npm run preview:pages` serves dist under `/slopetycoon/` (`PAGES_BASE`, `PORT` env) for a manual browser check (unverified in a real browser).


## Fonts & icons

* Fonts are self-hosted in `public/fonts/` (Nunito + Lilita One, OFL, see `docs/fonts.md`): copied to `dist/fonts/`, listed by `precache.ts` like every emitted file and served cache-first, so the UI looks the same offline. `npm run verify:pwa` requires all four woff2 files + `OFL.txt` in the precache list and no reference to Google Fonts in `index.html`. `index.html` preloads the two latin files.
* Icons (`public/icons/*`) are generated by `npm run gen:icons` from `src/ui/logo.ts` (`logoSvg({variant:'mark'})`): the favicon is the SVG itself, the PNGs are rasterised with the installed Chrome through puppeteer-core (the old procedural drawing in `scripts/lib/png.ts` is the fallback when no Chrome is found). The boot splash in `index.html` embeds the same mark.
