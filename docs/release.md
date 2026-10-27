# Release notes and checklist

Current release: **0.2.1 (pre-release, never call it 1.0 until the owner says so)**. Per-release details: `CHANGELOG.md`.

## 0.2.1 results (2026-10-27, macOS, Node v22.23.4)

| Check | Command | Result |
|---|---|---|
| Typecheck / Lint | `npm run typecheck`, `npm run lint` | pass / pass |
| Tests | `npm test` | 305 files passed, 1 skipped; 3082 tests passed, 31 skipped (perf/balance gated), ~156 s |
| Build | `npm run build` | pass (Vite warns the app chunk > 500 kB; not split further) |
| PWA | `npm run verify:pwa` | OK: 16 precached files, 2458 kB raw / 889 kB gzip (excl. sw.js) |
| Size | `npm run size` | total 2457.6 kB raw / 887.0 kB gzip (budget < 2048 kB gzip) |
| Perf | `npm run test:perf` | 21 files, 37 tests passed |
| Balance | `npm run test:balance` | 33 tests passed (~400 s) |
| Site | `npm run build:site && npm run site:check && npm run verify:site` | OK (131 URLs crawled at `/` and at `/slopetycoon/`) |
| Determinism | two consecutive `npm run build`, `shasum` of every dist file | identical (`a2febec5...`) |
| Repo/site tests | `npx vitest run tests/repo tests/site` | see Task report (run after this edit) |

`npm run release:check` = typecheck && lint && test && build && verify:pwa && size; its steps were run individually with the same commands (not as one chain). `shot:suite`, `touch:e2e`, `analytics:e2e`, `audio:render` were not re-run for this note.
Build and scripts use no network except the opt-in analytics (a runtime feature of the shipped game, `docs/analytics.md`; `npm run analytics:e2e` intercepts Google hosts).
Version flows: `package.json` -> `__APP_VERSION__` (About via `src/ui/version.ts`) and -> service-worker cache version `0.2.1-<content hash>` (`vite-plugins/precache.ts`).

### Dist size (gzip level 9, `scripts/report-size.ts`)

| File | Raw | gzip |
|---|---:|---:|
| assets/index-BSvhnYyW.js (app) | 1714.2 kB | 588.6 kB |
| assets/three-BnGC7Xq6.js | 567.7 kB | 142.3 kB |
| assets/uikit-BrJip8RW.js | 6.3 kB | 2.5 kB |
| assets/index-Dk_rm1cx.css | 4.4 kB | 1.3 kB |
| fonts/ (Nunito, Lilita One, OFL) | 93.6 kB | 86.9 kB |
| icons/ (6 files) | 64.4 kB | 62.7 kB |
| index.html + manifest | 7.0 kB | 2.6 kB |
| **Total (excl. sw.js)** | **2457.6 kB** | **887.0 kB** |
| sw.js (excluded) | 3.2 kB | 1.5 kB |

(Vite's own report: app 1,754 / 603.7 kB gzip, three 581 / 146 kB, decimal kB, default gzip level.)

## Previous releases

- **0.2.0** (2026-10-26): `build:pages` green (290 files / 2971 tests, PWA at `/` and `/slopetycoon/`), `release:check`, `shot:suite` 0 shader errors, `test:all` 37 tests; game bundle ~880 kB gzip; site 49 screenshots, 19 pages.
- **0.1.0** (baseline): 135 files / 1238 tests, total 457.6 kB gzip, 27 perf + 21 balance tests.

## How to cut a release

1. Bump the version: `npm run release -- patch|minor|major [--dry-run]` (`scripts/release.ts`: bumps `package.json`, adds a CHANGELOG heading, runs `build:pages`, commits `Release vX.Y.Z`, tags `vX.Y.Z`; `package-lock.json`'s version is not touched, update by hand). Or by hand.
2. Write the `CHANGELOG.md` entry; update README, docs, AGENTS.md version lines.
3. `npm run licenses` (refreshes `THIRD_PARTY_NOTICES.md`).
4. Site rule (any site/guide/screenshot change): `npm run site:og` (cards are committed; CI does not build them), `npm run docs:img`, then `npm run build:site && npm run site:check && npm run verify:site`.
5. Standard gate: `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` (plus `test:perf` alone and `test:balance`).
6. Tag: `git tag vX.Y.Z` (done by the release script); push with `git push origin main vX.Y.Z`.
7. Pages deploy: `.github/workflows/pages.yml` (canonical domain https://slopetycoon.com/, game `/play/`); see `docs/deploy.md`.
8. Analytics/consent: GA4 `G-NX37ERE0S9` loads only after `localStorage['slope.consent.analytics'] === 'granted'`; if anything changes, update `site/pages/privacy.md` and run `npm run analytics:e2e`.

## Housekeeping

- No stray debug files (`tests/dbg*`, temp scripts) found on 2026-10-27. `.gitignore` ignores `node_modules`, `dist`, `.DS_Store`, `*.log`; it does **not** ignore `.weave` or `public/icons`.
- `TODO` / `FIXME` grep over `src sw scripts vite-plugins tests`: **no TODO / FIXME markers** (re-checked 2026-10-27).
- `console.log` (2026-10-27): the `[demo]` title-scene build line and the two `[perf]` benchmark dumps (debug-panel button) in `src/main.ts`; the pointer diagnostic `console.debug` is gated by `import.meta.env.DEV`. `console.warn` / `console.error` remain for real failures.
- LICENSE is a copyright notice only (no open-source grant); the owner may choose a licence later.

## Manual playtest checklist (human-only; nothing below was verified by an agent)

- [ ] New game at each map size (64 / 128 / 256); save / load a 256 map; export / import a `.slope` file; autosave rotation; corrupt-save fallback.
- [ ] Complete the tutorial from the main menu and replay it from Help.
- [ ] Career, each scenario and campaign; change prices and watch guest reaction; goals, Advisor, level-up "Show me".
- [ ] Music by ear: every track, Music style selector (Auto / each track / Off), Next track, crossfades, seasons and weather. (Owner approved music and ambience by listening on 2026-10-27; re-check after any audio change.)
- [ ] Ambience quiet at the 0.28 default; volume sliders persist across reloads.
- [ ] Festivals, staff crews and training courses, rivals, stories.
- [ ] Statistics dialog (`I`): ranges, readout, colour-blind palette.
- [ ] Landscape drawer: ponds (winter freeze), boulders, trees, decor; Terrain / View drawers.
- [ ] Ride-along, photo mode (local PNG export), walk mode (pointer lock).
- [ ] Touch on a real phone and tablet: pan / pinch / twist, two-step placement, joystick, 44 px targets, no page zoom or pull-to-refresh.
- [ ] Consent flow on the live domain: card in the game, bar on the site, Settings > Privacy toggle, nothing sent before "Allow" (check the network tab), shared key between site and game.
- [ ] Install the PWA from slopetycoon.com; go offline, reload, continue from autosave; update toast after a new deploy; iOS Add to Home Screen.
- [ ] WebGL visuals on real GPUs: terrain / water / snow shaders, lighting at night / dawn, `low` vs `high` graphics, F3 shows "Render problems: 0".
- [ ] FPS on 256 maps with a full guest cap on real hardware; 30-minute session with a clean console.
- [ ] IndexedDB, CompressionStream, thumbnails in Chrome / Safari / Firefox; LocalStorage fallback in private mode.

## Known issues / unverified

- Real GPU frame rate, draw calls and memory, and pointer lock (walk mode) are unmeasured by agents (no GPU); audio is only measured offline (`audio:render`), plus the owner's listening approval of music / ambience (2026-10-27).
- `high` shadows: only `Renderer.ts` toggles `sun.castShadow`; whether anything visibly casts shadows is unverified.
- Funicular car looks unverified on a real slope.
- `GuestRenderer` CPU culling margin (12 %) may pop guests during fast camera pans.
- News / HUD / assistant layout may overlap at small widths.
- Guests queueing / riding at save time become idle on load; attraction queues and overnight bookings reset (docs/saves.md). A very fast tab close can lose the last autosave. Terrain is regenerated from the seed on load.
- Tutorial progress and settings live in LocalStorage, not in save files.
- Balance: only a few seeds swept (1337 / 61 / 7); the bot never adds lifts after the opening chain (docs/balance.md).
- Most streams end "dead"; pistes could be painted over streams (reported earlier, not re-verified).
- `NavWorld.terrainVersion` not wired in `main.ts`; impact unverified.
- The app JS chunk (1.7 MB raw) exceeds Vite's 500 kB warning; not split further. Total 887 kB gzip is under the 2 MB budget.
- `muteMusicInMenus` audio setting exists in `AudioSettings` but is unused.
- Licence not chosen (`LICENSE` is a copyright notice only; the owner decides later).
- Human playtest STOP of Task 32 still open.
