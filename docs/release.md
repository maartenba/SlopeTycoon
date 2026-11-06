# Release notes and checklist

Current release: **0.6.0 (pre-release, never call it 1.0 until the owner says so)**. Per-release details: `CHANGELOG.md`.

## 0.6.0 (2026-11-06, macOS, Node v22.23.4)

The Schirmbar (`docs/schirmbar.md`) and the resort name, plus the music (owner-provided Suno mp3 files: title / menu, game and apres-bar tracks), the recorded CC0 sound samples (88 mono mp3, synthesised sounds stay as the fallback), apres-ski notes over open bars, the church-bell honk fix, shadows on buildings / trees and in ride / photo / walk views, smoother shores / shrubs / rocks / cabins, a steadier title camera and the pylon footing (CHANGELOG). One golden part moved: the `progression` part of the staff golden (new level-2 unlock row; `docs/balance.md` "M7.8"); nothing since. The new save module `resort` is observer-only (no hash change, no format bump). Audio files are runtime-cached by the service worker, not precached: music 19 files, 35 MB; samples 88 files, 7.6 MB (`public/audio` is 43 MB on disk).

| Check | Command | Result |
|---|---|---|
| Gate (run twice) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | both runs pass: 457 files passed, 1 skipped; 4790 tests passed, 43 skipped |
| Balance | `npm run test:balance` | 48 passed (goldens unchanged since the Schirmbar re-record) |
| Perf | `npm run test:perf` | 28 files, 49 tests passed (alone) |
| Shots | `npm run shot:suite` | 0 errors in all 17 shots |
| Analytics / Offline | `npm run analytics:e2e`, `npm run offline:splash` | OK |
| Audio in a real page | `npm run music:e2e`, `npm run menu-music:e2e`, `npm run sfx:e2e` | OK |
| Sanity | `play`, `phase6`, `summer`, `winter`, `winter:tours`, `backcountry`, `sled`, `m74`, `schirmbar` | all OK (0 console errors, MaterialGuard 0) |
| Touch | `npm run touch:e2e -- --only camera,placement,drawers --viewport phone` | camera 11/11, placement 13/13, drawers 15/15 |
| Mobile | `npm run mobile:audit` | OK. The landscape inspector state first measured 49.5 % (< 50 %): a random "Powder day" event toast was floating over the map during the measurement (it appears since the Schirmbar commit shifted the event timing). The audit now hides event toasts for the inspector state (the toasts state still measures them); 52 % |
| Desktop | `npm run desktop:diff` (before = a92f5b8, after = this commit) | SAME on buildings drawer, HUD, landscape, pricing, statistics; **Settings differs 0.78 %** (the Music style selector is gone: expected) |
| Flicker | `npm run flicker -- --only 64-winter` | winter-day rotfine 0.66 (0.5.1: 0.65), zoomfine 0.15, no pops |
| Size | `npm run size` | 3048.7 kB raw / 1085.1 kB gzip (budget < 2048 kB gzip; precache 16 files; +16.4 kB gzip over 0.5.1: 1068.7) |
| Site | `site:og`, `docs:img`, `build:site`, `site:check`, `verify:site` | OK (57 pages, 272 URLs crawled on both bases) |

Not verified by agents: how the bar, the music and the recorded sounds sound and feel by hand (and whether the faint honk is really gone), real GPU fps and the look at real frame rates, a phone in the hand. Owner checklists: `docs/playtest-m78.md`, `docs/playtest-audio.md`, `docs/playtest-m8.md`.

## 0.5.1 (2026-11-03, macOS, Node v22.23.4)

Smoother bubble chairs / gondolas and more rounded buildings (lane D), the Ko-fi `/support/` page, and proximity audio (Apres-Ski Bar music, quieter nearby-only birds, stream / river / pond water; `docs/playtest-audio.md`). No sim, save or golden change. Release prep: version bump (package.json, lock, README, brand, AGENTS.md, deploy.md, the `whatsNew` test), CHANGELOG `[0.5.1]` with five Highlights, `whats-new`, `licenses`, a devlog entry, guide `settings.md` ambience wording. No new site screenshots this time.

| Check | Command | Result |
|---|---|---|
| Gate (run twice) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | both runs pass: 441 files passed, 1 skipped; 4664 tests passed, 43 skipped |
| Balance | `npm run test:balance` | 48 passed (goldens untouched) |
| Perf | `npm run test:perf` | 28 files, 49 tests passed (alone) |
| Shots | `npm run shot:suite` | 0 errors |
| Analytics / Offline | `npm run analytics:e2e`, `npm run offline:splash` | OK |
| Sanity | `play`, `phase6`, `summer`, `winter`, `winter:tours`, `backcountry`, `sled`, `m74` | all OK (0 console errors, MaterialGuard 0) |
| Touch | `npm run touch:e2e -- --only camera,placement,drawers --viewport phone` | camera 11/11, placement 13/13, drawers 15/15 |
| Flicker | `npm run flicker -- --only 64-winter` | winter rotfine 0.65 (0.5.0: 0.65), zoomfine 0.15, no pops |
| Audio in a real page | harness eval: real `AudioEngine` + `Ambience`, one `update` with a bar and rapids in range | state running, 19 layers built, no console errors (not heard) |
| Size | `npm run size` | 2992.8 kB raw / 1068.7 kB gzip (budget < 2048 kB gzip; +5.0 kB gzip over 0.5.0: 1063.7) |
| Site | `site:og`, `docs:img`, `build:site`, `site:check`, `verify:site` | OK (55 pages, 268 URLs crawled on both bases, screenshots 8.3 MB of the 8.5 MB budget) |

Not verified by agents: how the new sounds sound (`docs/playtest-audio.md`), real GPU fps, the final look of the new carriers on a real screen.

## 0.5.0 (2026-11-03, macOS, Node v22.23.4)

M8 graphics pass (render-only; `docs/graphics-audit.md`, `docs/graphics-m8.md`, `docs/shadows.md`): rounder buildings / lifts / vehicles / animals, per-family lift icons, conifer whorls, layered rock skirt, soft shorelines, High-tier sun shadows with contact shadows everywhere. No sim, save or golden change.

| Check | Command | Result |
|---|---|---|
| Gate (run twice) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | both runs pass: 437 files passed, 1 skipped; 4618 tests passed, 43 skipped |
| Balance | `npm run test:balance` | 48 passed (goldens untouched) |
| Perf | `npm run test:perf` | 28 files, 49 tests passed (alone) |
| Shots | `npm run shot:suite` | 0 errors |
| Analytics / Offline | `npm run analytics:e2e`, `npm run offline:splash` | OK |
| Sanity | `play`, `phase6`, `summer`, `winter`, `winter:tours`, `backcountry`, `sled`, `m74` | all OK (0 console errors, MaterialGuard 0 in play) |
| Touch | `npm run touch:e2e -- --only camera,placement,drawers --viewport phone` | camera 11/11, drawers 15/15, placement 12/13 on the first run ("long press cancels the placement tool", the known flake from 0.4.0) and 13/13 on the re-run |
| Desktop / phone | `npm run desktop:diff` (vs a clean `f23481f` worktree), `npm run mobile:audit` | SAME on all six screens (Buildings drawer 0.018 % of pixels: the new thumbnails); all thresholds met |
| Draw calls / triangles | `scripts/shots/m8-perf.ts`, `m8-share.ts`, `m8-calls.ts` vs `f23481f` | main-pass calls equal to baseline after one fix (a stray cannon material layer); Low triangles -1.2 .. -1.5 % (128 / 1.5), Medium +3 .. +5 %, High within +1 % on the same camera path; trees +0 %. Details: `docs/graphics-m8.md` |
| Flicker | `npm run flicker` (64 maps, low / med / high, atmosphere variants) | winter rotfine 0.56 -> 0.65 (+0.09 absolute, all tiers), everything else within +-0.01, no pops |
| Size | `npm run size` | 2974.4 kB raw / 1063.7 kB gzip (budget < 2048 kB gzip; +11.0 kB gzip over 0.4.0: 1052.7; cap was +60 kB) |
| Site | `whats-new`, `licenses`, `docs:img`, `site:og`, `build:site && site:check && verify:site` | OK (265 URLs crawled on both bases; screenshots 8.3 MB of the 8.5 MB budget; docs/img 16.4 MB) |

Not verified by agents: real GPU fps (High shadows), shadow shimmer while panning, phone heat, the final look (`docs/playtest-m8.md`).

## 0.4.0 (2026-11-02, macOS, Node v22.23.4)

M7.3 sled runs + Alpine Coaster + Sledder (`docs/sled-runs.md`) and M7.4 Pizzeria, Bakery, Tourist Office, grass strip with skydive / hang gliding / paragliding, and the Carnival (`docs/m74-buildings.md`, `docs/festivals.md`). Release prep: shared-file wiring committed, version bump (package.json, lock, README, AGENTS.md, deploy.md, the `whatsNew` test), CHANGELOG `[0.4.0]` with five Highlights, `whats-new`, `licenses`, a devlog entry, three new screenshots (`sled-run`, `village-sky`, `carnival-street`), `docs/playtest-m74.md`.

| Check | Command | Result |
|---|---|---|
| Gate (run twice) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | second run pass: 432 files passed, 1 skipped; 4575 tests passed, 43 skipped. The first run (same code, a long gated batch running right after) failed 3 timing tests, one of them `safetyPerf` (8.35 ms vs 7.5 ms); it passes alone and in the second run |
| Balance | `npm run test:balance` | 48 passed |
| Perf | `npm run test:perf` | 28 files, 49 tests passed (alone) |
| Shots | `npm run shot:suite` | 0 errors |
| Analytics / Offline | `npm run analytics:e2e`, `npm run offline:splash` | OK |
| Sanity | `play`, `phase6`, `summer`, `winter`, `winter:tours`, `backcountry`, `sled`, `m74` | all OK (m74 needed a script fix, see below) |
| Touch | `npm run touch:e2e -- --only camera,placement,drawers --viewport phone` | camera 11/11, drawers 15/15, placement 13/13 on two of four runs; the "long press cancels the placement tool" check failed intermittently (timing, passes on re-run) |
| Size | `npm run size` | 2942.1 kB raw / 1052.7 kB gzip (budget < 2048 kB gzip; +11.6 kB gzip over 0.3.3: 1041.1) |
| Site | `whats-new`, `licenses`, `docs:img`, `site:og`, `build:site && site:check && verify:site` | OK (52 pages, screenshots 8.3 MB of the 8.5 MB budget, 264 URLs crawled) |

Bug found: `m74:sanity` reported `lifts` differing after reload; the only field was a lift's `activeMode` ("foot" vs "ski"), because the script jumps the date to February by hand. It is treated as runtime in the script. Not verifiable by agents: `docs/playtest-m73.md`, `docs/playtest-m74.md`.

## 0.3.3 (2026-11-02, macOS, Node v22.23.4)

M7.5 Mobile UI (`docs/mobile-ui.md`): phones show the map. A new `st-sheet` bottom / side sheet (peek / half / full, 44 px grab bar, fling, keyboard + ARIA, remembered height, passthrough where it does not apply) holds the dock drawers, the five inspectors, Rudi's advice and the news panel; one-row top bar with an overflow, a one-line HUD strip, an icon speed row, one-at-a-time toasts, tool-first (cards step aside) and fade-while-dragging; tablets keep drawers capped at about 40 %; desktop is pixel-identical. Release prep: version bump (package.json, lock, README, AGENTS.md, deploy.md, the `whatsNew` test), CHANGELOG `[0.3.3]` with five Highlights, `whats-new`, `licenses`, a devlog entry, the guide page *Touch & tablets* (sheets, phone layout, four phone screenshots: `touch-phone-hud`, `touch-phone-place`, `touch-phone-ghost`, `touch-phone-land`; `touch-phone-inspector` and a re-shot `touch-tablet` are gallery shots), `docs/playtest-m75.md`.

| Check | Command | Result |
|---|---|---|
| Gate (run twice, after all edits) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | pass: 424 files passed, 1 skipped; 4421 tests passed, 43 skipped (new: `tests/ui-dom/sheet.test.ts` 20, `phoneLayout.test.ts` 8, 2 in `touchWireDrawer.test.ts`, `tests/render/touchDrag.test.ts` 2) |
| Balance | `npm run test:balance` | 48 passed (no sim change) |
| Perf | `npm run test:perf` | 28 files, 49 tests passed (alone) |
| Shots | `npm run shot:suite` | 0 errors on all 17 shots |
| Analytics | `npm run analytics:e2e` | OK |
| Offline | `npm run offline:splash` | OK |
| Sanity play | `npm run play:sanity` | 0 console errors, MaterialGuard 0 |
| Stories | `phase6:sanity`, `summer:sanity`, `winter:sanity`, `winter:tours`, `backcountry:sanity` | all OK (save + reload identical, MaterialGuard 0, 0 console errors) |
| Map visible (new) | `npm run mobile:audit` | all thresholds met at 390x844, 844x390 and 768x1024: default states 51-78 %, drawer at peek + tool active 57-78 %; before / after table in `docs/mobile-ui.md` |
| Desktop unchanged (new) | `npm run desktop:diff` | 0 differing pixels in the six 1280x800 screens (HUD, Buildings / Landscape / Pricing drawers, Statistics, Settings) + the click check (a drawer's first card is the topmost element) |
| Touch | `npm run touch:e2e -- --viewport phone` (full) | **211 / 211** (camera 11, placement 13, walk 22, ride-photo 17, lift 10, strokes 44, trails 21, drawers 15, ui 31, title 9, page 18). Landscape and tablet: camera, placement, strokes, drawers, ui, page all pass (land drawers 14, tablet drawers 15, ui 31 each, page 18). Not re-run on land / tablet: walk, ride-photo, lift, trails, title (untouched) |
| Size | `npm run size` | 2907.0 kB raw / 1041.1 kB gzip (budget < 2048 kB gzip; +6.1 kB gzip over 0.3.2: 1035.0) |
| Site | `npm run whats-new`, `npm run licenses`, `npm run docs:img`, `npm run site:og`, `npm run build:site && npm run site:check && npm run verify:site` | OK (98 screenshots, 8.0 MB of the 8 MB budget; 255 URLs crawled) |

No goldens moved (UI only; no sim change). Bugs found by the new checks: the end-to-end run caught `pointer-events: none` on the sheet's passthrough layer, which the slotted content inherits (every desktop / tablet drawer was unclickable in the first draft; the pixel diff could not see it, so `desktop:diff` now also asserts a drawer's first card is the topmost element at its centre, and a unit test pins the CSS); the `page` touch group had been reading the sky canvas instead of the WebGL canvas since 0.3.2 (the scenario now uses `__slope.renderer.webgl.domElement`); `touch:e2e` kept its process alive for five minutes after printing the matrix (a pending timeout).

## 0.3.2 (2026-11-01, macOS, Node v22.23.4)

M7.0 Atmosphere (`docs/atmosphere.md`: valley fog + inversion mornings, special skies + alpenglow, stars + moon phases, cloud shadows, mist, frost, rainbow, photo-mode suggestions, Settings > Graphics > Atmosphere Off / Low / High) plus the M7.2 website work (five landing pages, devlog, redesign) and the owner's M7.1 decisions (Challenging ~30 % tighter, new Rudi tips). Release prep: version bump, CHANGELOG `[0.3.2]` with Highlights, devlog intro, `whats-new`, `licenses`, a new guide page *Atmosphere: fog, skies & the moon* (+ Settings, Photo mode, Day and night, glossary), four new screenshots (`atmos-alpenglow`, `atmos-valley-fog`, `atmos-moonlit-night`, `atmos-lake-mist`), `docs/playtest-m70.md`.

| Check | Command | Result |
|---|---|---|
| Gate (run twice, after all edits) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | pass: 421 files passed, 1 skipped; 4386 tests passed, 43 skipped |
| Balance | `npm run test:balance` | 48 passed |
| Perf | `npm run test:perf` | 28 files, 49 tests passed (alone) |
| Shots | `npm run shot:suite` | 0 errors on all 17 shots |
| Analytics | `npm run analytics:e2e` | OK |
| Offline | `npm run offline:splash` | OK |
| Sanity play | `npm run play:sanity` | 0 console errors, MaterialGuard 0 |
| Phase 6 / summer / winter / tours / backcountry stories | `npm run phase6:sanity`, `summer:sanity`, `winter:sanity`, `winter:tours`, `backcountry:sanity` | all OK (save + reload identical, MaterialGuard 0, 0 console errors) |
| Touch | `npm run touch:e2e -- --only camera,placement,drawers --viewport phone` | 39/39 passed |
| Flicker (atmosphere forced: fog, inversion, special, frost, mist, stars, cloud shadows) | `npm run flicker -- --only 64-summer-day --atmos off|high --atmos-force "..."` | Off: rot osc 751 px, zoom 253, 2 LOD flips; High: rot 628, zoom 157, 2 LOD flips; 0 pop events, still px 898 -> 489 (fog adds no shimmer on SwiftShader) |
| Comparison shots | `atm2-lvl-off / low / high`, `atm2-rainbow` (`.weave/shots/`) | looked at; see `docs/playtest-m70.md` |
| Size | `npm run size` | 2886.0 kB raw / 1035.0 kB gzip (budget < 2048 kB gzip; +9.7 kB gzip over 0.3.1: 1025.0) |
| Site | `npm run whats-new`, `npm run licenses`, `npm run docs:img`, `npm run site:og`, `npm run build:site && npm run site:check && npm run verify:site` | OK (95 screenshots, 7.8 MB of the 8 MB budget after `MAX_BYTES_1280` 58 -> 52 kB; 249 URLs crawled) |

No goldens moved (the atmosphere is render-only; a test compares `stateHash` on and off). Bugs found: none in the game. Harness notes: `--walk-at lake` returns no position when the map has no lake; `atmos.force` bypasses the level for stars / special skies (QA only, so an Off shot with `stars:1` still shows stars). Not verifiable by agents: `docs/playtest-m70.md`.

## 0.3.1 (2026-10-31, macOS, Node v22.23.4)

M7.1 economy + rules consistency pass (`docs/economy-audit.md`): the building contract test, the generated rules table, the per-building ROI sandbox, `Bot` option `content: 'all'`, difficulty bands, and four economy fixes (Shop, Shuttle Bus Depot, Après-Ski Bar, Wind Turbine), version bump, CHANGELOG `[0.3.1]` with Highlights, `docs/playtest-m71.md`.

| Check | Command | Result |
|---|---|---|
| Gate (run twice, after all edits) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | pass both times: 415 files passed, 1 skipped; 4275 tests passed, 37 skipped |
| Balance | `npm run test:balance` | 42 passed (incl. the content bot and the difficulty bands) |
| Perf | `npm run test:perf` | 28 files, 49 tests passed (alone) |
| Shots | `npm run shot:suite` | 0 errors on every shot |
| Analytics | `npm run analytics:e2e` | OK |
| Offline | `npm run offline:splash` | OK |
| Sanity play | `npm run play:sanity` | 0 console errors, MaterialGuard 0 |
| Phase 6 story | `npm run phase6:sanity` | OK |
| Summer story | `npm run summer:sanity` | OK |
| Winter story | `npm run winter:sanity` | OK after the script learned to wait for a class, a senior and a cup (the shop stop moved the draw: the old 12-day window saw 0 seniors) |
| Winter tours | `npm run winter:tours` | OK |
| Backcountry story | `npm run backcountry:sanity` | OK |
| Size | `npm run size` | 2858.5 kB raw / 1025.0 kB gzip (budget < 2048 kB gzip) |
| Site | `npm run whats-new`, `npm run licenses`, `npm run docs:img`, `npm run site:og`, `npm run build:site && npm run site:check && npm run verify:site` | OK (28 pages, 91 screenshots, 7.8 MB of the 8 MB budget) |
| Not run | `npm run flicker`, `npm run touch:e2e` | no render, camera or touch change in this milestone |

Goldens re-recorded (shop stop 0.2 -> 0.45): `GOLDEN_BOT` money 233115.57 -> 234121.49 and the `yearReport` snapshot; bot economy within -2.6 % .. +3.1 % of `8720715` (`docs/balance.md` "M7.1 re-record"). Not verifiable by agents: `docs/playtest-m71.md`.

## 0.3.0 (2026-10-31, macOS, Node v22.23.4)

M6.7 final Phase 6 STOP batch: Mountain Concert (1-10 September) + Snow Concert (1-15 March), the Phase 6 wrap-up (`docs/phase6-status.md`), version bump, CHANGELOG `[0.3.0]` with Highlights, Events guide page with two new night screenshots (`concert-summer-night`, `concert-winter-night`; the page now shows events-calendar, festival-market and the two concerts, `story-inspector` and `ui-rating` moved to the landing page only), glossary / calendar / landing updates, a read-through of the guide and landing for stale statements (the lift count, season dates, crossings wording and unlock tables were all still right), `docs/playtest-m66.md`.

| Check | Command | Result |
|---|---|---|
| Gate (run twice, after all edits) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | pass both times: 410 files passed, 1 skipped; 4229 tests passed, 32 skipped (HEAD b3e64b1 before the docs batch: the same) |
| Balance | `npm run test:balance` | 36 passed (goldens unchanged) |
| Perf | `npm run test:perf` | 28 files, 49 tests passed (alone) |
| Shots | `npm run shot:suite` | exit 0, 0 errors |
| Analytics | `npm run analytics:e2e` | OK |
| Offline | `npm run offline:splash` | OK |
| Sanity play | `npm run play:sanity` | 0 console errors, MaterialGuard 0 |
| Phase 6 story | `npm run phase6:sanity` | OK |
| Summer story | `npm run summer:sanity` | OK (save + reload identical, MaterialGuard 0) |
| Winter story | `npm run winter:sanity` | OK |
| Winter tours | `npm run winter:tours` | OK |
| Backcountry story | `npm run backcountry:sanity` | OK |
| Flicker | `npm run flicker -- --only 64-winter-day,64-summer-day` | 0 pop events, 0 / 2 LOD flips (rot / zoom sweeps); still px 2401 winter / 832 summer; the concert dressing is not a building, so no `flicker:building` run |
| Touch, full phone portrait matrix | `npm run touch:e2e -- --viewport phone` | 211/211 checks passed: camera 11, placement 13, walk 22, ride-photo 17, lift 10, strokes 44, trails 21, drawers 15, ui 31, title 9, page 18 (about 25 min). The landscape and tablet viewports were NOT run this time |
| Size | `npm run size` | 2841.6 kB raw / 1019.3 kB gzip (budget < 2048 kB gzip) |
| Site | `npm run whats-new`, `npm run licenses`, `npm run docs:img`, `npm run site:og`, `npm run build:site && npm run site:check && npm run verify:site` | OK (28 pages, 91 screenshots, 7.8 MB of the 8 MB budget, 220 URLs crawled) |

Goldens unchanged (festivals run only with `autoEvents`; the plain bot books none). Bugs found by the STOP checks: none in the game. Not verifiable by agents (in `docs/playtest-m66.md`): real GPU frame rate, concert sound by ear, light-cone look on a real GPU, a real touch device.

## 0.2.9 (2026-10-31, macOS, Node v22.23.4)

M6.5 milestone STOP batch (Phase 6 content wave 5): Sleigh Stable, Snowshoe Hut, Snowscooter Base, Backcountry routes with avalanche danger 1-5, Snowboarder + Ski tourer guests, Powder Hounds + Snowboard Park Jam retarget. Version bump, CHANGELOG `[0.2.9]` with Highlights, two new guide pages (Sleighs, snowshoes & snowscooters; Backcountry & avalanche danger), updates to Guests & seasons, Operations, Money, the glossary and the landing page, seven new screenshots, `docs/playtest-m65.md`.

| Check | Command | Result |
|---|---|---|
| Gate (run twice) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | pass both times: 407 files passed, 1 skipped; 4198 tests passed, 32 skipped |
| Balance | `npm run test:balance` | 36 passed |
| Perf | `npm run test:perf` | 28 files, 49 tests passed (alone) |
| Shots | `npm run shot:suite` | 0 errors on every shot (17) |
| Analytics | `npm run analytics:e2e` | OK |
| Offline | `npm run offline:splash` | OK |
| Sanity play | `npm run play:sanity` | 0 console errors |
| Phase 6 story | `npm run phase6:sanity` | OK |
| Summer story | `npm run summer:sanity` | OK |
| Winter story | `npm run winter:sanity` | OK (the December run now continues until a school class has arrived) |
| Winter tours | `npm run winter:tours` | OK: all three bases served guests, a sleigh, a walker line and a scooter convoy seen, scooter penalty within the cap, MaterialGuard 0 |
| Backcountry story | `npm run backcountry:sanity` (new) | OK: route painted, Snowboarders + a tourer arrived, a storm lifts the danger to 4, the route closes, nobody on it, override asks for a confirm, blast / settling reopens it, save + reload identical, MaterialGuard 0, 0 console errors |
| Flicker | `npm run flicker:building -- --place sleighStable` / `snowscooterBase` | 73.7 / 69.9 oscillating px per window (hotel 155.2, demo lodge 849.3); the full `npm run flicker` was started and stopped (it takes too long here) |
| Touch | `npm run touch:e2e -- --only camera,placement,drawers --viewport phone` | 39/39 passed |
| Size | `npm run size` | 2828.7 kB raw / 1014.7 kB gzip (budget < 2048 kB gzip) |
| Site | `npm run site:og`, `npm run docs:img`, `npm run build:site && npm run site:check && npm run verify:site` | OK (28 pages, 89 screenshots, 7.6 MB of the 8 MB budget: `MAX_BYTES_1280` 70 -> 58 kB and a new 30 kB cap for the 640 px files; 216 URLs crawled) |

Goldens: `GOLDEN_STARTER` and `GOLDEN_BOT` (both moved: guests arrive in the starter too) + `GOLDEN_BOT_MONEY` 227010.16 -> 232186.60, the `yearReport` snapshot, the `summer` income bound (0.97 -> 0.9, chaotic +-7 %); plain-bot replay on three seeds before / after (-5.0 % / +1.1 % / +1.3 %), boarder injury rate, and star distribution in `docs/balance.md` "M6.5 STOP check". Bugs found by the STOP checks: the `winter:sanity` school-class check was a 6-day coin flip; the guide-page related-links test needed the two new guide pages registered; the screenshot budget needed a lower per-file cap (above). Known cosmetic gaps (not fixed, in `docs/playtest-m65.md`): thin snowshoe poles at the default zoom, lavender-looking shaded snow roofs (the game's snow shading, not a bug).

### Dist size 0.2.9 (gzip level 9)

| File | Raw | gzip |
|---|---:|---:|
| assets/index-WEqv5lL_.js (app) | 2079.2 kB | 714.0 kB |
| assets/three-iTBe2s16.js | 568.4 kB | 142.5 kB |
| assets/uikit-Dkb3nSkr.js | 6.3 kB | 2.5 kB |
| assets/index-Dk_rm1cx.css | 4.4 kB | 1.3 kB |
| fonts/ | 93.6 kB | 86.9 kB |
| icons/ | 64.4 kB | 62.7 kB |
| html / manifest / whats-new.json / other | 106.0 kB | 91.7 kB |
| **Total (excl. sw.js)** | **2828.7 kB** | **1014.7 kB** |

## 0.2.8 (2026-10-30, macOS, Node v22.23.4)

M6.4 milestone STOP batch (Phase 6 content wave 4): Small Hotel + Luxury Hotel with a steaming heated pool, Coffee Stand, Senior + School group guests, Wellness & Views + School Trips campaigns. Version bump, CHANGELOG `[0.2.8]` with Highlights, two new guide pages (Hotels & the coffee stand; Seniors & school trips) and updates to Guests & seasons, Money, Operations (pool heating), Building, Career, glossary, landing (guest types fact, hotels line), 5 new screenshots (`hotel-luxury-steam`, `hotel-luxury-night`, `hotel-small`, `coffee-stand`, `guests-seniors-school`) + 1 re-shot (`ui-marketing-campaigns`), `docs/playtest-m64.md`. Decisions: everything ships ON with no flag; the bot's money moves with the two guest types (goldens re-recorded, `docs/balance.md` "M6.4 STOP check"); coffee-stand "skiers stop mid-run" not implemented (decision points only, documented); energyBot bound relaxed 0.97 -> 0.95 after a 3-seed re-measure.

| Check | Command | Result |
|---|---|---|
| Gate (run twice) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | pass both times: 397 files passed, 1 skipped; 4063 tests passed, 32 skipped |
| Balance | `npm run test:balance` | 36 passed |
| Perf | `npm run test:perf` | 27 files, 47 tests passed (alone) |
| Shots | `npm run shot:suite` | 0 errors on every shot (17) |
| Analytics | `npm run analytics:e2e` | OK |
| Offline | `npm run offline:splash` | OK |
| Sanity play | `npm run play:sanity` | 0 console errors, MaterialGuard 0 |
| Phase 6 story | `npm run phase6:sanity` | OK |
| Summer story | `npm run summer:sanity` | OK |
| Winter story | `npm run winter:sanity` (new) | OK: both hotels active on a road, pool steam 0.88 at -3.9 C, coffee stand, Seniors and a school class on a December weekday, save + reload identical, MaterialGuard 0, 0 console errors; `-- --start summer` OK (Luxury Hotel idle without VIPs, see `docs/hotels.md`) |
| Flicker | `npm run flicker:building -- --place luxuryHotel --out hotel64` | 155.2 oscillating px per window (the demo lodge: 849.3) |
| Touch | `npm run touch:e2e -- --only camera,placement,drawers --viewport phone` | 39/39 passed |
| Size | `npm run size` | 2792.6 kB raw / 1003.8 kB gzip (budget < 2048 kB gzip) |
| Site | `npm run site:og`, `npm run docs:img`, `npm run build:site && npm run site:check && npm run verify:site` | OK (26 pages, 82 screenshots, 8.0 MB of the 8 MB budget: `MAX_BYTES_1280` lowered 88 -> 70 kB and all shots re-encoded; 200 URLs crawled) |

Goldens: `GOLDEN_BOT` (10+ parts) + `GOLDEN_BOT_MONEY` 222414.97 -> 227010.16, the `yearReport` snapshot and the `energyBot` bound; plain-bot replay on three seeds before / after in `docs/balance.md`. Bugs found by the STOP checks: the `.gitignore` test (`node_modules/x`) failed in any checkout where `node_modules` is a symlink (git refuses a path beyond a symlink): fixed by checking `node_modules`; the VIP campaign label did not name hotels: fixed; the Marketing drawer in a paused headless page shows stale requirement states until a `money:changed` event (harness artefact, a running game refreshes it).

### Dist size 0.2.8 (gzip level 9)

| File | Raw | gzip |
|---|---:|---:|
| assets/index-CmOOUrEp.js (app) | 2043.2 kB | 703.1 kB |
| assets/three-iTBe2s16.js | 568.4 kB | 142.5 kB |
| assets/uikit-DhcMvu7R.js | 6.3 kB | 2.5 kB |
| assets/index-Dk_rm1cx.css | 4.4 kB | 1.3 kB |
| fonts/ | 93.6 kB | 86.9 kB |
| icons/ | 64.4 kB | 62.7 kB |
| html / manifest / whats-new.json / other | 105.9 kB | 91.7 kB |
| **Total (excl. sw.js)** | **2792.6 kB** | **1003.8 kB** |

## 0.2.7 (2026-10-30, macOS, Node v22.23.4)

M6.3 milestone STOP batch (Phase 6 content wave 3, summer): campground, petting zoo, viewpoint, treehouse, quad base, climbing crag, rafting + canyoning bases, tackle hut + piers + fish stock + ice fishing, Mountain biker + Angler guests, Family Summer Camp + Angler's Paradise. Version bump, CHANGELOG `[0.2.7]` with Highlights, two new guide pages (Summer; Quads, climbing, rafting & fishing) and updates to Guests, Money, Operations, Building, Career, glossary, landing (summer attractions fact), 9 new screenshots + 2 re-shot (`ui-marketing-campaigns`, `ui-update-card`), `docs/playtest-m63.md`. Decisions: all content ships ON with no flag (there is no `tours` flag); only the staff golden `progression` part moved (30be591e -> fa89ad3d, rafting + canyoning unlock rows). Open: the bot's summer revenue share is 21-25 %, below the plan's 25 % target (`docs/balance.md` "M6.3 STOP check").

| Check | Command | Result |
|---|---|---|
| Gate (run twice) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | pass both times: 390 files passed, 1 skipped; 3964 tests passed, 32 skipped |
| Balance | `npm run test:balance` | 36 passed (run before the docs batch; only a bot option and tests were added afterwards); bot money golden unchanged |
| Perf | `npm run test:perf` | 26 files, 44 tests passed (alone) |
| Shots | `npm run shot:suite` | 0 errors on every shot |
| Analytics | `npm run analytics:e2e` | OK |
| Offline | `npm run offline:splash` | OK |
| Sanity play | `npm run play:sanity` | 0 console errors, MaterialGuard 0 |
| Phase 6 story | `npm run phase6:sanity` | OK |
| Summer story | `npm run summer:sanity` | OK (river + pond, campground, petting zoo, hut + pier, rafting base, quad base all active and serving, convoy + raft ride seen, anglers arrive, fish stock created, save + reload identical, MaterialGuard 0, 0 console errors) |
| Flicker | `npm run flicker -- --only 64-summer-content --kinds rotfine,zoompop,jitter,still` | 0 pops; 2 LOD flips equal to the plain summer baseline (`docs/flicker.md`). The full default scenario list was started and stopped after ~27 min (too slow); not re-run in full |
| Touch | `npm run touch:e2e -- --only camera,placement,drawers --viewport phone` | 39/39 passed |
| Size | `npm run size` | 2774.2 kB raw / 997.5 kB gzip (budget < 2048 kB gzip) |
| Site | `npm run site:og`, `npm run docs:img`, `npm run build:site && npm run site:check && npm run verify:site` | OK (24 pages, 77 screenshots, 8.0 MB of the 8 MB budget: `MAX_BYTES_1280` lowered 100 -> 88 kB and all shots re-encoded; 188 URLs crawled) |

Goldens: `GOLDEN_BOT.progression` re-recorded, nothing else. Bugs found by the STOP checks: none in the game; a harness gotcha (`sim.game.date.tick`, not `sim.game.tick`) and a hut that is closed unless water is within 3 tiles were found while writing the sanity script.

### Dist size 0.2.7 (gzip level 9)

| File | Raw | gzip |
|---|---:|---:|
| assets/index-PejMoxCf.js (app) | 2024.9 kB | 696.9 kB |
| assets/three-iTBe2s16.js | 568.4 kB | 142.5 kB |
| assets/uikit-ChtGzdTN.js | 6.3 kB | 2.5 kB |
| assets/index-Dk_rm1cx.css | 4.4 kB | 1.3 kB |
| fonts/ | 93.6 kB | 86.9 kB |
| icons/ | 64.4 kB | 62.7 kB |
| html / manifest / whats-new.json / other | 105.8 kB | 91.6 kB |
| **Total (excl. sw.js)** | **2774.2 kB** | **997.5 kB** |

## 0.2.6 (2026-10-29, macOS, Node v22.23.4)

M6.2 + M6.6 milestone STOP batch (Phase 6 content wave 2): rivers (Dig river / Place spring / Fill in river, natural springs, flow classes, winter ice), the suspension footbridge and bridges over rivers, N-station lifts (mid-stations) and the six-seat high-speed chair, quiet seasonal closures, touch drawers that tuck away on every touch screen. Version bump, CHANGELOG `[0.2.6]` with Highlights, guide (Building > Rivers and springs, Lifts & pistes > Mid-stations, Rails, crossings & bridges > suspension, Guests & seasons, glossary, career), landing page, 5 new screenshots (river-rapids, river-frozen, ui-river-tool, bridge-suspension, lift-midstation) + 8 re-shot, `docs/playtest-m62.md`. Decisions: rivers and mid-stations ship ON with no flag (player-driven; every golden unchanged, only the `progression` part of the hash moved, `docs/balance.md` "M6.2 + M6.6 STOP check").

| Check | Command | Result |
|---|---|---|
| Gate (run twice) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | pass both times: 370 files passed, 1 skipped; 3733 tests passed, 32 skipped |
| Balance | `npm run test:balance` | 36 passed (~590 s); bot money golden unchanged |
| Perf | `npm run test:perf` | 26 files, 44 tests passed (alone) |
| Shots | `npm run shot:suite` | 17 shots, 0 errors on every shot |
| Analytics | `npm run analytics:e2e` | OK |
| Offline | `npm run offline:splash` | OK (splash stages offline, no page errors, no failed requests) |
| Sanity play | `npm run play:sanity` | 0 console errors, MaterialGuard 0 |
| Phase 6 story | `npm run phase6:sanity` | OK (natural spring river, footpath + hiking trail bridges over a dug river, suspension footbridge over a gorge, gondola with a mid-station ridden in ride-along, save + reload: every saved part identical, MaterialGuard 0, 0 console errors) |
| Flicker | `npm run flicker -- --only 64-summer-river,64-winter-mid` | 0 pop events, 0 LOD flips in both new scenes (`docs/flicker.md`) |
| Touch | `npm run touch:e2e -- --only camera,placement,drawers,strokes,lift,trails,ui --viewport phone` (+ tablet, land for strokes / drawers / placement / camera) | all pass after the drawer fix (strokes 44/44, ui 31/31 on phone and tablet); the four stroke failures on clean HEAD were a real bug, fixed |
| Not run | full `touch:e2e` matrix (walk, ride-photo, title, page, `lift` / `trails` / `ui` on land) | ~55 min; the walk physics change is covered by `tests/render/walkPhysics.test.ts` and the harness walk over the suspension bridge |
| Size | `npm run size` | 2710.2 kB raw / 975.7 kB gzip (budget < 2048 kB gzip) |
| Site | `npm run site:og`, `npm run docs:img`, `npm run build:site && npm run site:check && npm run verify:site` | OK (22 pages, 69 screenshots, 7.7 MB of the 8 MB budget: the 1280 px files over 100 kB are re-encoded at lower quality, `MAX_BYTES_1280`, 170 URLs crawled at `/slopetycoon/`) |

Goldens: none re-recorded (see `docs/balance.md`). Bugs found by the STOP checks and fixed: phone / tablet portrait strokes (drawer covered the map), 44 px targets (menu footer sponsor link, New game *Advanced*), the walker could not climb a steep bridge deck ramp (suspension bridge), `populateDemo('Medium')` in the flicker scripts built nothing.

### Dist size 0.2.6 (gzip level 9)

| File | Raw | gzip |
|---|---:|---:|
| assets/index-nDn6ORo8.js (app) | 1961.4 kB | 675.3 kB |
| assets/three-Zm3xuFxa.js | 568.4 kB | 142.5 kB |
| assets/uikit-RggTVibx.js | 6.3 kB | 2.5 kB |
| assets/index-Dk_rm1cx.css | 4.4 kB | 1.3 kB |
| fonts/ | 93.6 kB | 86.9 kB |
| icons/ | 64.4 kB | 62.7 kB |
| html / manifest / whats-new.json / other | 105.3 kB | 91.4 kB |
| **Total (excl. sw.js)** | **2710.2 kB** | **975.7 kB** |

## 0.2.5 (2026-10-29, macOS, Node v22.23.4)

0.2.4 was skipped (never released). Money pass, tidy town footpaths, bridges as part of drawing, Crossings section, stream bridges, Eco Centre + Eco programme, update card + What's new, Sponsor links, website footer, `createSim` defaults == the real game. Version bump, CHANGELOG `[0.2.5]` with Highlights, guide (Money, Operations Eco section, Interface, Saves, Rails/crossings, Lifts & pistes, glossary), landing line, 3 new shots (`ui-eco-programme`, `ui-crossings`, `ui-update-card`) and 5 re-shot (`ui-pistes-drawer`, `bridges-stream`, `ui-hud`, `ui-buildings-drawer`).

| Check | Command | Result |
|---|---|---|
| Gate (run twice) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | pass both times: 353 files passed, 1 skipped; 3581 tests passed, 32 skipped |
| Balance | `npm run test:balance` | 36 passed (~550 s) |
| Perf | `npm run test:perf` | 24 files, 42 tests passed (alone) |
| Shots | `npm run shot:suite` | 17 shots, 0 errors on every shot |
| Analytics | `npm run analytics:e2e` | OK |
| Offline | `npm run offline:splash` | OK (splash stages offline, no page errors, no failed requests) |
| Sanity play | `npm run play:sanity` | 0 console errors, MaterialGuard 0 |
| Size | `npm run size` | 2636.6 kB raw / 951.4 kB gzip (budget < 2048 kB gzip) |
| Site | `npm run site:og`, `npm run docs:img`, `npm run build:site && npm run site:check && npm run verify:site` | OK (22 pages, 64 screenshots, 7.6 MB of the 8 MB budget, 160 URLs crawled at `/slopetycoon/`) |
| Not run | `touch:e2e` | the full matrix takes ~55 min; no touch code changed except drawer text |

### Dist size 0.2.5 (gzip level 9)

| File | Raw | gzip |
|---|---:|---:|
| assets/index-CRWO51Z9.js (app) | 1888.6 kB | 651.2 kB |
| assets/three-CWI5RsfT.js | 567.7 kB | 142.3 kB |
| assets/uikit-D4bozi_t.js | 6.3 kB | 2.5 kB |
| assets/index-Dk_rm1cx.css | 4.4 kB | 1.3 kB |
| fonts/ | 93.6 kB | 86.9 kB |
| icons/ | 64.4 kB | 62.7 kB |
| html / manifest / whats-new.json / other | 105.3 kB | 91.4 kB |
| **Total (excl. sw.js)** | **2636.6 kB** | **951.4 kB** |

## 0.2.3 (2026-10-28)

M6.1 milestone batch (Phase 6 content wave 1): toilets / comfort / facilities, level crossings, footbridge, bridges, trail access, four campaigns, inert tour / viewpoint / lodging / guest-type frameworks. Version bump, CHANGELOG `[0.2.3]`, guide (Guests, Money, Building "Rails, crossings & bridges", events Facilities, glossary), landing mention, six screenshots, goldens re-recorded (`docs/balance.md`).

| Check | Command | Result |
|---|---|---|
| Gate (run twice) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | pass both times: 342 files passed, 1 skipped; 3462 tests passed, 31 skipped |
| Balance | `npm run test:balance` | 33 passed (~520 s); bot money golden 191483.30 |
| Perf | `npm run test:perf` | 24 files, 42 tests passed (alone) |
| Shots | `npm run shot:suite` | 0 errors on every shot |
| Analytics | `npm run analytics:e2e` | OK |
| Touch | `npm run touch:e2e -- --only camera,placement,drawers --viewport phone` | 39/39 |
| Sanity play | `npm run play:sanity` | 0 console errors, MaterialGuard 0 |
| Site | `npm run site:og`, `npm run docs:img`, `npm run build:site && npm run site:check && npm run verify:site` | OK (22 pages, 61 screenshots, 7.2 MB of 8 MB: the 1280 px files over 100 kB were re-encoded from raw at quality 68 to make room for 5 new shots; new guide page *Rails, crossings & bridges*) |
| Audio | crossing bell offline render (`tests/audio/offline.test.ts`) | peak < 0.15, no DC, no clicks |

## 0.2.2 (2026-10-27)

Release-prep batch: version bump, CHANGELOG `[0.2.2]`, player guide (Calendar & seasons, Runs, Maintenance, Snowmaking, Energy), landing page and FAQ, 7 new screenshots + full re-shoot (57), regenerated OG cards, developer docs.

| Check | Command | Result |
|---|---|---|
| Gate (run twice) | `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa` | pass both times: 323 files passed, 1 skipped; 3279 tests passed, 31 skipped |
| Perf | `npm run test:perf` | 21 files, 37 tests passed |
| Site | `npm run site:og`, `npm run docs:img`, `npm run build:site && npm run site:check && npm run verify:site` | OK (21 pages, 134 images, screenshots 7.8 MB of the 8 MB budget (energy tab + events calendar re-shot: 8,192,904 B of 8,388,608); 145 URLs crawled at `/` and `/slopetycoon/`) |
| Size | `npm run size` | 2529.1 kB raw / 912.0 kB gzip (budget < 2048 kB gzip) |
| Not run | full `touch:e2e` (only phone camera + placement: 24/24) | the full matrix takes ~55 min |

### Hardening pass after the prep batch (same day)

| Check | Command | Result |
|---|---|---|
| Gate (twice) | typecheck, lint, test, build, verify:pwa | pass both times: 325 files, 3286 tests passed, 31 skipped |
| Balance | `npm run test:balance` | 33 passed (~440 s); re-run after the nav change |
| Perf | `npm run test:perf` | 23 files, 41 tests passed (alone) |
| Analytics / offline | `npm run analytics:e2e`, `npm run offline:splash` | OK; the game boots offline from the service worker, splash stages recorded (`Loading the mountain...` .. `Ready`), no page errors, no failed requests |
| Audio | `npm run audio:render` | no clipping (max peak 0.54), no DC offset |
| Flicker | `npm run flicker:building` | 308 osc px/window (documented ~296: noise) |
| Shots | `npm run shot:suite` | 17 shots, 0 errors |
| Touch | `npm run touch:e2e -- --only camera,placement --viewport phone` | 24/24 |
| Sanity play | `npm run play:sanity -- --size 64 --seed 5 --years 2` | 0 console errors / warnings, MaterialGuard 0 |
| Commit signatures | `git log --format='%h %G?'` | all show `N` only because `gpg.ssh.allowedSignersFile` is not configured; every commit carries a `gpgsig` header |


Note: the site screenshot budget (8 MB) is nearly used; the next new shot needs another one trimmed or a lower quality.

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
Version flows: `package.json` -> `__APP_VERSION__` (About via `src/ui/version.ts`) and -> service-worker cache version `0.2.3-<content hash>` (`vite-plugins/precache.ts`).

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

0. **Write 3-6 player-facing Highlights** (`### Highlights`, short plain sentences, light tone, no doc paths) at the top of the new CHANGELOG release section (the technical bullets go under `### Changes`). They feed the in-game update card and the one-time *What's new* card (`docs/pwa.md`). Run `npm run whats-new` and commit `src/config/whatsNew.generated.ts`; `npm test` fails when it is stale.

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
- LICENSE is proprietary, all rights reserved (source available, not open source); do not change without the owner.

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
- Human playtest STOP of Task 32 still open.


## Music (unreleased, Nov 2026)
All music is now owner-provided Suno mp3 files (19, 37.0 MB after one re-encode; title / menu, game, apres-bar), replacing the procedural music. They are runtime-cached by the service worker as they play, not precached: the precache total and the 2048 kB gzip budget are unchanged (`npm run size` excludes `audio/`); the Pages artifact grows by 37 MB (`dist-site/play/audio`). Every committed mp3 stays in git history. Owner playtest: `docs/playtest-audio.md` (nobody has heard the new music in the game). See `docs/audio.md`.
