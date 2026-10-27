# Slope Tycoon

A browser ski-resort tycoon: carve a procedurally generated alpine valley, build lifts, pistes and a village, keep guests, families and the bank happy
through winter *and* summer. Three.js + TypeScript, no backend, no external assets (every model, texture, sound and music piece is generated in code).

**Version 0.2.0** (pre-release)

Status: pre-release (0.2.0) — playtest feedback welcome.

## Features

- **Terrain**: seeded procedural valleys (presets, 64 / 128 / 256 map sizes), lakes and streams, forests, rocks; raise / lower / flatten terraforming; a Landscape drawer for ponds, boulders and garden decor; named seeds (`Alpine-Fox-1234`).
- **Seasons & snow**: full year cycle (15-day months, 180-day year: winter and summer 60 days, spring and autumn 30) with weather, altitude snowline (high-altitude skiing alongside valley hiking in shoulder seasons), snow cover that builds and melts, day/night with optional fast nights, 50 % summer construction cost.
- **Lifts**: magic carpets, T-bars, chairlifts, gondolas, funicular and more, with variants, auto-placed towers, visible cables and moving carriers, breakdowns, operating hours and energy cost.
- **Pistes & paths**: paint pistes (difficulty from slope), paths, roads, rail; piste naming and inspector; quality, wear and traffic.
- **Guests & families**: individual guests with needs and decisions, navigation on lifts / pistes / paths, arrivals by road, rail and altiport, families with ski school and childcare.
- **Attractions & buildings**: lodging, restaurants, rental, shops, ski school, playgrounds, adventure park, beach, bike lifts and the rest of the winter and summer catalogue, with dependency rules (see `docs/placement-rules.md`).
- **Operations**: nightly grooming and snowmaking (snowcats, reservoirs), ski patrol with sled rescues, first aid, helicopter, avalanches, wildlife (bears, wolves) with warning-sign mitigation, fauna, farms and livestock, tree planting, chimney smoke.
- **Economy**: monthly books, ticket and per-service pricing (seasonal menus), bank loans (starter loan, interest, debt), staff wages, upkeep, difficulty (Relaxed / Normal / Challenging), resort rating.
- **Career & Sandbox**: new games start in **Career**: your resort has a level (1-6) that grows with stars, guests and profit, and nine big items (6-seat chair, gondolas, funicular, helipad, cable car, altiport, VIP campaign) unlock along the way; the basics, safety and the tutorial are never locked. **Sandbox** (New Game dialog or `?mode=sandbox`, and every old save) has everything from the start (`docs/progression.md`).
- **Staff, festivals and the region**: four automatic crews with an optional Staff tab and six training courses; bookable festivals (Christmas Market, Winter Carnival, Summer Music Festival, World Cup) plus the Almabtrieb, critic visits and powder days that visibly dress the village; story guests with a wish; two or three rival resorts, a sustainability rating facet and the Green Resort award (`docs/staff.md`, `docs/festivals.md`, `docs/stories.md`, `docs/rivals.md`).
- **Build depth**: undo / redo for every build action, a slope-profile card with snowline while you draw, and *Suggest a run* (`docs/build-depth.md`).
- **Marketing & pricing**: campaigns (Families, Budget, VIP, Summer Adventure, ...) and price elasticity that guests visibly react to.
- **Audio**: ambience, sound effects and generative music, all synthesized live with the Web Audio API (no audio files).
- **PWA / offline / saves**: installable, plays fully offline after the first load; IndexedDB saves with slots, quick save, rolling autosave, `.slope` export / import.
- **Fun & feedback**: a quiet feedback layer (Off / Subtle / Lively), guest emotes, a 20-goal career with small grants, advisor Ranger Rudi, guest reviews, welcome-back recap, undo / redo, text size and reduced motion (`docs/fun-feedback.md`).
- **Ride-along**: follow any guest in first person (skier, boarder, hiker, biker, chairlift / gondola / cable car / funicular rider) with look-around, FOV, slow motion (optional) and a close-up level of detail; Esc returns to the exact iso view. Graphics quality scales the near detail. See `docs/ground-level.md`.
- **Demo towns**: the title screen shows a random themed town (ten archetypes from a cosy hut hamlet to the 256 Big Mountain; Space shuffles) and the F3 debug menu can build any of them on any map (`docs/demo-towns.md`).
- **Walk mode**: press V (or the walking-man button, or Walk here in a building's inspector) to explore your resort on foot in first person: terrain following, collisions, footsteps, E to inspect and to ride a lift (desktop; `docs/walk-mode.md`).
- **Photo mode**: press P for a free orbit camera (FOV, time of day, filters, vignette, frames, aspect presets, hero shot), export a PNG as a local download and keep the last 30 in an on-device gallery. No sharing (`docs/photo-mode.md`).
- **Scenarios**: six hand-made challenges (First Tracks, Family Valley, Powder Dreams, Summer Escape, Alpine Giant, Safe Slopes) with deadlines, objectives and bronze / silver / gold medals; your best results are kept on this device. Main menu > Scenarios (`docs/scenarios.md`). No sharing.
- **Achievements & trophies**: 40 profile-wide achievements in three tiers with a trophy shelf (main menu / pause menu), quiet unlock toasts and 13 purely visual cosmetic rewards (building palettes, village bunting, photo frames, lift chair colours) chosen in Settings > Cosmetics. Kept on this device; no sharing (`docs/achievements.md`).
- **Resort of the Year**: at the end of every in-game year a report shows your stats, awards (bronze / silver / gold against regional baselines), charts and a cover photo; past reports live in Finance > Reports and the image can be saved locally. No sharing (`docs/year-report.md`).
- **Touch & tablets**: one-finger pan, pinch zoom, two-finger twist, a pan / paint toggle, two-step placement (tap, then tap again or Place), long-press cancel, two-finger-tap undo, on-screen controls for walk / ride / photo, 44 px targets and a compact layout; Settings > Accessibility > Touch controls Auto / On / Off (`docs/touch.md`).
- **Statistics, regions and accessibility**: press **I** for charts of guests, cash, rating and revenue (`docs/stats.md`); every seed has a region name and peaks; a colour-blind-safe (Okabe-Ito) palette; reduced motion and text size.
- **Landscape & drawers**: the Landscape drawer (ponds, trees, boulders, decor; `docs/landscaping.md`) and redesigned Terrain / View drawers with cards and hover info; everything can be built in any season.
- **Tutorial**: an interactive guided tour with an on-screen ranger, "Show me" / "Do it for me", contextual hints.

## Requirements

- A modern desktop browser (or a tablet / phone, see Touch) with **WebGL2** (current Chrome, Edge, Firefox, Safari) and **IndexedDB** (for saves).
- Node.js 20+ and npm to build from source.

## Run, build, deploy

```bash
npm ci            # or npm install; no network needed afterwards
npm run dev       # dev server (no service worker)
npm run build     # type-check + production bundle in dist/ (+ dist/sw.js)
npm run preview   # serve dist/ locally (http://localhost:4173)
```

`dist/` is a static site: copy it to any static host (GitHub Pages, Netlify, S3, nginx, a sub-folder of an existing site). All URLs are relative (`base: './'`),
so a sub-path works without configuration.

- **Do not open `dist/index.html` from `file://`**: browsers block module scripts there (the game shows a message).
- The service worker (offline / install) needs **https** or `localhost`.
- Caching hints: serve `sw.js` and `index.html` with `Cache-Control: no-cache` (so updates are discovered); `assets/*` are content-hashed and can be cached `immutable` for a year.
  The service worker cache name includes the package version plus a content hash, so a new release always replaces old caches.
- Size budget: < 2 MB gzip total (see `docs/release.md`; `npm run size`).

## Website and player guide

The repo also holds the **one-page website + player guide** (`site/`, no separate project). On GitHub Pages the deployed layout is: **`/` = website**, **`/play/` = the game (PWA)**, **`/guide/` = the guide**.

```bash
npm run build:site     # game -> dist-site/play, website + guide -> dist-site/   (defaults: SITE_REPO=maartenba/SlopeTycoon SITE_URL=https://maartenba.github.io/SlopeTycoon/)
npm run site:check     # links, images, alt text, heading order, size budgets
npm run site:dev       # serve dist-site/ at http://localhost:4190/
npm run site:shots     # re-shoot every screenshot through the QA harness (needs Chrome), then optimise to site/assets/shots/
```

`npm run build` still builds the game standalone into `dist/`. Editing the guide, regenerating screenshots and the key/level/scenario tables: [`site/README.md`](site/README.md).

## Deploying to GitHub Pages

[![Deploy](https://github.com/maartenba/SlopeTycoon/actions/workflows/pages.yml/badge.svg)](https://github.com/maartenba/SlopeTycoon/actions/workflows/pages.yml)

Pushing to `main` builds, tests and publishes `dist-site/` (website at `/`, game at `/play/`: <https://maartenba.github.io/SlopeTycoon/> and `.../SlopeTycoon/play/`) via `.github/workflows/pages.yml`. One-time setup: see the publishing checklist in `docs/deploy.md`;
`git push -u origin main`, then Settings → Pages → Source: **GitHub Actions**. Local checks: `npm run build:pages`, `npm run preview:pages` (simulates a repo subpath).
Details, custom domain and troubleshooting: [`docs/deploy.md`](docs/deploy.md).

## Controls

WASD / arrows pan, Q / E rotate, wheel zoom, Space pause, `+` / `-` speed (1× / 3× / 10×: a game day is 150 s / 50 s / 15 s, a 180-day year about 7.5 h / 2.5 h / 33 min with fast nights; nights run 3× faster); **K** or the ⏭ button skips to the next month / season / important event (fast-forward; Esc, Space or a click cancels; see `docs/time-flow.md`), dock buttons open build drawers, R rotates the ghost, X bulldozes, O cycles overlays,
M mutes, **I** statistics, Ctrl+Z / Ctrl+Y undo / redo, F5 / F9 quick save / load, **Esc** cancels the current tool or drawer (and opens the pause menu if nothing is active).
On touch: drag pans, pinch zooms, twist rotates, two-finger tap undoes, tap-then-tap places (`docs/touch.md`). Full list: press `?` / `H` in game (Help), and `docs/tutorial.md`, `docs/placement-rules.md`.

## How to play

The game opens on the **title screen**: *Continue* (newest save), *New game*, *Load game*, *Tutorial*, *Settings*, *Help / Keys*, *About*.
New game lets you pick the map size (64 small & quick / 128 recommended / 256 for powerful devices), a seed (type a number or a name like
`Alpine-Fox-1234`, or press 🎲), terrain preset, start season, difficulty (Relaxed / Normal / Challenging), starting money, the starter loan and
a few advanced options. Every choice is stored in the save. Links work too: `?size=128&seed=42&preset=lakeland&difficulty=relaxed&start=summer&money=150000&radius=14&loan=1&starter=1&hints=0`.

A first winter: build a **lift**, paint a **piste** beside it, connect everything with **paths and a road**, add **parking**, a **ticket office** and a
**restaurant / lodging**, then press play. The bank's starter loan helps in the first weeks. Watch rating, guests and the monthly books; summer
needs its own attractions (adventure park, beach, bike lifts). The *Tutorial* walks through all of this.

The ⌂ button (top bar) autosaves and returns to the title screen.

## Saving, export, import

**Save** in the top bar (or Ctrl+S; F5 / F9 quick save / load): Save and Load tabs, save slots, quick save, three rolling autosaves (every in-game month and when the tab is hidden), **Export** to a `.slope` file and **Import** back
(validated before anything is written, never overwrites a slot). Saves live in your browser's IndexedDB; export regularly if the game matters to you. Details: `docs/saves.md`.

## Project structure

```
src/
  main.ts       boot + wiring of the renderer, sim, UI, audio, tutorial, saves
  core/         EventBus, seeded Rng, GameState, pacing (fast nights)
  config/       data tables: balance, buildings, lifts, prices, marketing, lift ops
  world/        Grid (heights, tiles, occupancy), terrain generation, streams, props, networks, pathfinding
  sim/          headless simulation: clock, seasons/weather/snow, guests, families, attractions, economy, ops, safety, rating
  build/        placement / lift / piste / path tools, bulldoze, planting
  render/       Three.js views: terrain, props, buildings, lifts, guests, lighting, overlays
  ui/           custom-element UI (HUD, dock, menus, dialogs), formatters
  audio/        Web Audio engine, ambience, sfx, generative music
  persist/      save codec, serializer + migrations, IndexedDB / LocalStorage backends, SaveManager
  game/         createSim (headless composition), starter resort, balance bot, boot-from-save, difficulty
  tutorial/     tutorial engine, steps, hints, scenario
  pwa/          service-worker registration + update flow
sw/             service worker source (compiled by vite-plugins/precache.ts)
scripts/        icon generator, PWA verifier, size report
tests/          vitest suites (core, world, sim, game, persist, pwa, audio, ui, ui-dom, tutorial, perf)
docs/           design / tuning notes per subsystem, release notes (docs/release.md)
```

## Testing

```bash
npm test               # all default tests (~30 s), perf tests only as coarse guards
npm run typecheck && npm run lint
npm run test:perf      # strict timing tests, single worker (quiet machine)
npm run test:balance   # 3-year x 3-size economy sweep (BALANCE=1, ~4 min)
npm run build && npm run verify:pwa   # PWA asset check on dist/
npm run size           # raw + gzip size report of dist/
npm run release:check  # typecheck, lint, test, build, verify:pwa, size
```

## Troubleshooting

- **"WebGL unavailable" message**: enable hardware acceleration, update the browser / GPU driver, or try another browser. WebGL2 is mandatory.
- **No sound**: browsers block audio until the first click or key press; click anywhere (🔇 icon bottom-left disappears). Check ⚙ settings and the M mute key.
- **Stale version after deploy**: DevTools → Application → Service Workers → Unregister, and Storage → *Clear site data* (this also deletes saves; export first). Normally the "Update available — reload" toast handles it.
- **Private / restricted browsing**: if IndexedDB is unavailable the game falls back to LocalStorage (≤ 1.5 MB per save, a warning is shown; big 256 maps may not fit). Export `.slope` files to keep them.
- **Blank page on `file://`**: serve over http (`npm run preview`).

## Known limitations

Honest list; the full one is in `docs/release.md`.

- Rendering (terrain/water shaders, models, lighting), audio levels and music were developed without a GPU or audio device in the automated environment: they are tuned only partially, by playtest feedback, and may need further adjustment.
- Guests queueing / riding a lift when a save is loaded become idle (lift queues start empty); guests using an attraction are re-queued. Overnight room bookings are cleared.
- Balance was swept with a scripted bot on seeds 1337 / 61 / 7 only; other seeds and presets are only invariant-tested. Late-game income can saturate.
- Arrivals are capacity-limited by parking / road in the starter resort; very large crowds need a second car park.
- Loading a save reloads the page (by design); a very fast tab close can lose the last autosave.
- Some HUD / news panels can overlap at very small window widths.

## Privacy

No ads, no accounts, and saves stay on your device (IndexedDB / localStorage, `.slope` export). The only thing that can be sent is **anonymous, opt-in usage statistics** (Google Analytics, measurement ID `G-NX37ERE0S9`): nothing is loaded or sent until you click "Allow" on the website's consent bar or in the game (Settings > Privacy); never names, saves or free text; never on localhost or in headless browsers; the choice is shared (`localStorage['slope.consent.analytics']`) and can be changed any time. Offline play is unaffected. Details: [`site/pages/privacy.md`](site/pages/privacy.md) (published at `/privacy/`).

## Credits & licence

All assets (geometry, textures, icons, logo, sound, music) are procedurally generated by the game's own code. Uses [three.js](https://threejs.org) (MIT licence).

Fonts (self-hosted, no font requests to Google): **Nunito** (© The Nunito Project Authors) and **Lilita One** (© Juan Montoreano), both under the [SIL Open Font License 1.1](public/fonts/OFL.txt); see [docs/fonts.md](docs/fonts.md). UI controls and dialogs: [docs/ui-kit.md](docs/ui-kit.md) (dev page `/?uikit=1`).
License: see [`LICENSE`](LICENSE) (copyright notice only, no open-source grant; the owner may choose a licence later, see `docs/deploy.md`). Third-party components: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) (`npm run licenses`).
