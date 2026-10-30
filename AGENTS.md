# AGENTS.md — Slope Tycoon

Read this first. Canonical instructions for AI agents (CLAUDE.md just points here).

## Project
**Slope Tycoon**: a browser PWA, 3D isometric ski-resort tycoon (three.js + TypeScript + Vite). Everything is procedural: terrain, models, textures, icons, logo, sound effects, ambience and music (no asset files except self-hosted fonts Nunito + Lilita One in `public/fonts`). Works offline (service worker), saves locally (IndexedDB + localStorage fallback).
- Version is **0.2.7** (pre-release). **Never call it 1.0** until the user says so.
- Repo `maartenba/SlopeTycoon`; **not yet published**. `LICENSE` is a copyright notice only (no open-source grant; the owner decides later, see `docs/deploy.md`); do not add or change a licence. Third-party: `THIRD_PARTY_NOTICES.md` (`npm run licenses`).
- **Privacy (owner decision, supersedes the earlier "no tracking" rule)**: no ads, no accounts, saves stay on the device, **anonymous opt-in statistics** via Google Analytics (`G-NX37ERE0S9`). Consent first: nothing loads or is sent until `localStorage['slope.consent.analytics'] === 'granted'` (shared by the website and the game); never on localhost / headless. The only allowed external hosts are `googletagmanager.com` / `google-analytics.com` (injected after consent), plus the GitHub and Wikipedia LINKS on the website (plain links, nothing requested until clicked). A **Sponsor link** to exactly `https://github.com/sponsors/maartenba` (see `.github/FUNDING.yml`) is allowed in the website header/footer/About/landing and the game's About dialog / menu footer: wording 'Support the game' / 'Sponsor on GitHub' (a support link, NOT a sharing feature), `target=_blank rel=noopener`, never a popup/toast/gate. No other external requests. See `site/pages/privacy.md`, `docs/deploy.md`.

## Architecture (`src/`)
- `core/` EventBus, EventLog, TickLoop, FastForward, GameState, Rng (seeded), pacing, ids, safe.
- `sim/` pure simulation (no three.js/DOM): Clock, Economy, Finance, Loans, Lift, guests/, nature/, ops/ (LiftOps = planned lift maintenance, Snowmaking switch), advisor/, goals/, progression/, scenario/, meta/ (achievements), attractions/, Rating, Marketing, Pricing, Daylight, Season, **Runs** (pistes as runs, `world/Runs.ts` + `sim/Runs.ts`, `docs/runs.md`), **Energy** (generators, capped offset, `docs/energy.md`), calendar…
- `world/` terrain generation, water/streams, skiable stats, tiles/occupancy.
- `render/` three.js: Renderer, TerrainMesh, props, lod, view/ (ride-along, photo, walk), fx, MaterialGuard, DemoScene (title-screen live demo)…
- `ui/` custom-element panels (`StElement` base, shared `KIT_CSS`), `modal.ts`, fonts.css.
- `build/` ToolManager + tools (piste, lift, path, road, terraform, plant, bulldoze), undo.
- `game/` createSim (headless sim factory), starterResort, demoResort, demoTowns, bot, difficulty, save/restore.
- `config/` data tables (balance, buildings, lifts, prices, goals, achievements, unlocks, scenarios/*.json…).
- `persist/` Serializer, SaveManager, migrations, IdbStore, ProfileStore (own IDB `slope-profile`), PhotoStore.
- `analytics/` opt-in Google Analytics for the game (consent first, observer only, whitelisted events; `docs/analytics.md`, `npm run analytics:e2e`). The ONLY code allowed to name Google hosts (`tests/repo/analytics.test.ts`).
- `audio/` WebAudio synth/music/ambience; `tutorial/`; `pwa/`; `sw/` (service worker), `vite-plugins/`, `scripts/` (tooling), `site/` (marketing site + player guide), `docs/` (developer docs).
- **Sim vs render separation**: sim never imports render/ui; render/UI read sim state and listen to events. The sim is **deterministic** (seeded Rng, fixed ticks); same seed + inputs ⇒ same `stateHash`. Observer-only modules (`observer: true`, e.g. `achievementsRun`) are skipped by stateHash.
- **Save format v2** (`SAVE_FORMAT_VERSION` in `src/persist/migrations.ts`): `MIGRATIONS[n]` upgrades n→n+1; bump the version, add a migration and a test in `tests/persist/migrations.test.ts`. Per-module versions (`SaveModule.version`) cover module-local changes; `SAVE_MODULES` order matters (goals, scenario are last; Goals is NOT a registry system).
- **Calendar (label-only, `src/sim/calendar.ts`)**: sim day 0 = 1 April; winter Dec-Mar, spring Apr-May, summer Jun-Sep, autumn Oct-Nov; new games start 1 Dec; `formatGameDate()` is the one date formatter (`docs/time-flow.md` §10). Index month names by SIM month (`SIM_MONTHS`).
- **Time model**: a day = 150 s at 1x; speeds 1 / 3 / 10 (+ pause); 15-day months, 12 months = 180-day year; fast-forward / fast-night warp in `core/pacing.ts` + `FastForward.ts`. Title demo runs at timeScale 1.5. See `docs/time-flow.md` (verify numbers there/in `src/core` before relying on them).
- Progression gate is an optional `env.gate`; only `createSim` wires it. Builders that place gated things (starter/demo resort, bots without `respectUnlocks`) must use `sim.progression.withBypass`. Never gate something a goal or Advisor rule requires (e.g. Ranger Station) — chapter chain can deadlock (test greps for it).

## Commands
```
npm run dev                # vite (?size=64|128|256&seed=N&start=summer&scenario=<id>&hints=0)
npm run typecheck | lint | test
npm run test:balance       # BALANCE=1 bot economy check
npm run test:perf          # timing tests (flaky under load: run alone); test:all = both
npm run build              # tsc + vite build;  npm run verify:pwa
npm run build:site | site:check | verify:site | site:shots | site:dev
npm run docs:img           # optimise docs/img (WebP)
npm run shot -- --size 64 --seed 61 --out NAME   # real-game screenshot via Chrome SwiftShader
npm run touch:e2e [-- --only camera,walk --viewport phone|land|tablet]   # real emulated-touch end-to-end (gated, ~55 min for all; docs/touch.md)
npm run summer:sanity [-- --shots 1]   # real-page summer story: river + pond, campground, petting zoo, tackle hut + pier, rafting base, quad base, a summer fortnight, save + reload identical (128 / seed 5, ~3 min)
npm run phase6:sanity [-- --shots 1]   # real-page story: river from a natural spring, bridges (foot / hike / suspension), gondola with a mid-station ridden, save + reload identical (seed 5, ~2 min)
npm run shot:suite | ui:suite | ui2:suite | demo:shots | town:shots | recap:shot
npm run flicker            # camera shimmer / LOD pop measurement (docs/flicker.md)
npm run analysis:ski|timeflow|hiking|hunger|towns   # analysis reports
npm run boot:shots         # loading-splash screenshots (.weave/shots/load-*.png)
npm run build:pages / deploy:check / release:check / size / licenses
```
**Standard gate**: `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pwa`. When `site/` or docs are touched also: `npm run build:site && npm run site:check && npm run verify:site`.

Tests live in `tests/` mirroring `src/` (sim, world, render, ui, ui-dom (happy-dom), persist, game, audio, tutorial, pwa, site, repo, scripts, perf, analysis, smoke.test.ts).

## Conventions
- **Tests are required** for new behaviour. Use `createSim` (headless) for sim changes. Perf tests are tagged `[perf]`; make timing assertions best-of-N/relaxed.
- happy-dom localStorage persists between tests in a file: clear in `afterEach` when a component remembers UI state.
- **UI**: custom element constructors must NOT set attributes (breaks DOM test). Dialogs use `src/ui/modal.ts` (Modal + modalStack): fixed `.layer`s inside each component's shadow root, z>=100, no transforms. Never add full-screen children to `#ui` (it has `pointer-events` rules and z-index 22; a full-size child blocks all clicks). No native `<select>`: use `st-select`. `[hidden]` must not be overridden by `display:flex`. HUD rows are nowrap; check overlaps with `--overlap 1`.
- **Rendering**: all materials go through **MaterialGuard** (detects failed shader programs, falls back; F3 shows "Render problems: N"). In three r186 `vColor` is vec4: use `.rgb` in patched shaders. Respect triangle / draw-call budgets (instanced layers, LOD with hysteresis, rebuild budgets; see `docs/perf.md`). Road/decal meshes must use `surfaceHeightAt`.
- **Flicker-safe**: world-space noise only; **no `gl_FragCoord` noise/stipple in iso views** (crawls under camera motion); no sub-pixel features in terrain shader; LOD changes need hysteresis. Check with `npm run flicker`.
- **createSim defaults == the real game; options only opt out.** `autoEvents`, `stories`, `remoteSupply`, `campaignsV2`, `rivalMarket` default ON (guest types v2 is always on). `main.ts` passes only opt-outs (`DEMO`: events/stories/remoteSupply/campaignsV2; `TUTORIAL_MODE`: rivalMarket false; scenarios are always rival-neutral inside createSim). A headless test / bot / analysis script must NOT pass these to get a different game; pass `false` only for a test that needs a neutral baseline, with a comment. A new gameplay flag ships default ON and goldens are re-recorded in the same commit (docs/balance.md, "Defaults == the real game").
- Config tables in `src/config/*` are the source of truth; generated doc tables come from them (don't hand-edit generated blocks).
- macOS: `sed -i ''`; zsh doesn't word-split `$var`.
- Lift/tree changes must refresh renderer chunks + ForestCover (stale cover broke save/load determinism).
- Re-check `src/main.ts` after big edits; wiring there has been overwritten before.

## Product rules (user decisions)
- **Career** is the default mode; some unlocks gated by resort level (selective), not everything.
- Tone: light humour, **used sparingly**. Feedback **restrained** (no fireworks/confetti spam); ambience **quiet**.
- **NO sharing features**: no share buttons/codes/links/leaderboards; Photo mode exports only a local PNG.
- No land purchase. Desktop first; touch support exists (`docs/touch.md`, `npm run touch:e2e`), keep new UI usable at 44 px targets and never fork tools by pointer type (the TouchController feeds tools synthetic mouse-style events).
- Sizes 64/128/256 (512 dropped). New game opens a fresh random seed unless `?seed=`.

## Images
`docs/img` holds **WebP only**, each ≤ 400 kB, folder ≤ 25 MB; run `npm run docs:img` after adding images. Stage raw screenshots in `.weave/shots/` (not committed to docs).

## Screenshot harness tips (`docs/visual-qa.md`)
- Agents have no GPU; the harness runs installed Chrome with SwiftShader and prints every console/shader error. Exit 2 = shader/WebGL error.
- Use a **new `--out` name every time**; the image read tool caches by path.
- "4 errors" per shot are filtered GPU-stall driver warnings, not bugs.
- Useful: `--eval "js"`, `--steps "click:..;key:F3;wait:ms"`, `--view ride|lift|walk|photo`, `--ticks N`, `--bare 1` (title screen), `__slope.*` debug handle. Harness dev server runs with `SLOPE_NO_HMR=1`.
- Harness cannot verify: pointer lock, real GPU FPS, audio by ear.

## Safety rules
- **NEVER kill the user's browser** or use broad kills (`pkill -f chrome|vite`, `killall`). Only stop processes you spawned, by PID / own process group.
- **Never bypass git commit signing** (no `--no-gpg-sign`, no config overrides). On failure retry; otherwise leave changes staged and tell the user.
- Don't rewrite git history (amend/rebase/force-push/reset --hard) unless asked. Don't commit unless asked.
- Never read/expose secrets or env files.

## Workflow & docs
- **Canonical site domain**: https://slopetycoon.com/ (site at root, game `/play/`, guide `/guide/`; CNAME via `SITE_CNAME` in the Pages workflow). Never reintroduce `maartenba.github.io` URLs.
- **RULE: ANY website/site/guide change (and any screenshot change feeding a page) requires, at the end of the session: `npm run site:og` (regenerate the committed social cards; CI does not build them), `npm run docs:img`, and `npm run build:site && npm run site:check && npm run verify:site`.** `site:check` fails on stale cards (`site/assets/og/manifest.json`).
- Plans (local only, `.weave/` is git-ignored and not in the repo): `.weave/plans/` (current: `slope-tycoon-hook.md`, Phase 5 / milestones M5.1–M5.5, each ends with a human playtest STOP). Learnings: `.weave/learnings/slope-tycoon.md` (append short lessons; read it before large work).
- **Each CHANGELOG release section needs 3-6 player-facing `### Highlights`** (feeds the update card + What's new card; `npm run whats-new` regenerates `src/config/whatsNew.generated.ts`, a test fails when stale; `docs/pwa.md`, `docs/release.md`).
- `docs/*.md` = **developer docs** (one per feature: saves, time-flow, perf, balance, ui-kit, visual-qa, deploy, release…). **Player docs** = `site/guide/*.md` (generated site, `site/README.md`); `CHANGELOG.md` and `README.md` at root.
- **IMPORTANT user expectation**: the website (`site/`) and docs (player guide, developer docs, CHANGELOG, README) must reflect changes, but update them **only at the END of a work session** (batch; not after every small change). Then: re-run `npm run site:shots` for changed visuals, and `npm run build:site && npm run site:check && npm run verify:site`.

## Known gaps / open items
- Done (0.2.0): touch, colour-blind palette, Statistics (`I`, `docs/stats.md`), named regions, Landscape drawer, redesigned Terrain / View drawers, M5.4 depth, M5.5. Remaining: human playtest STOP of Task 32.
- Done in 0.2.7 (CHANGELOG): summer content (M6.3): campground (campfire, night glow, `docs/campground.md`), petting zoo (`docs/petting-zoo.md`), viewpoint + treehouse (`docs/viewpoints.md`), quad base (`docs/quads.md`), climbing crag (`docs/climbing.md`), rafting + canyoning bases (`docs/water-tours.md`), tackle hut + piers + fish stock + ice fishing + Angler guests (`docs/anglers.md`), Mountain biker guests (`docs/guest-types.md`), Family Summer Camp + Angler's Paradise (`docs/marketing-pricing.md`). All player-driven, ON with no flag (no `tours` flag exists; the tour system is inert without a base); the standard `Bot` builds none of them, so only the staff golden `progression` part moved (`docs/balance.md` "M6.3 STOP check"). `Bot` option `summer` (default false), `npm run summer:sanity`, `scripts/analysis/summerBot.ts`. Open: the plan's summer >= 25 % revenue share is not met by the bot (21-25 %), owner question in `docs/playtest-m63.md`; human playtest STOP of Task 26 remaining.
- Done in 0.2.6 (CHANGELOG): rivers (Dig river / Place spring / Fill in river, natural springs, flow classes, winter ice; `docs/rivers.md`), suspension footbridge + bridges over rivers (`docs/bridges.md`), mid-stations + `chair6d` (`docs/mid-stations.md`), touch drawers tuck away on every touch screen. Rivers and mid-stations ship ON (player-driven, no flag; goldens unchanged, `docs/balance.md` "M6.2 + M6.6 STOP check"). Remaining: human playtest STOPs of Tasks 18 and 40 (`docs/playtest-m62.md`).
- Done in 0.2.3 (CHANGELOG): comfort need + Toilets + Facilities rating facet (`docs/comfort.md`), rail level crossings + footbridge over rail (`docs/crossings.md`), bridges (`docs/bridges.md`), trail access + remote supply (`docs/trails-access.md`), campaigns v2 (Come by Train, Snowboard Park Jam, Hike & Bike Weekends, Festival Season), inert frameworks: tours (`docs/tours.md`), viewpoints (`docs/viewpoints.md`), lodging tiers (`docs/lodging.md`), guest types (`docs/guest-types.md`). Goldens re-recorded in `docs/balance.md` "M6.1 re-record". Remaining: human playtest STOP (`docs/playtest-m61.md`).
- Done in 0.2.2 (CHANGELOG): real calendar + date chip + Events strip + climate curves (`docs/time-flow.md` §10-11), pistes as runs (Runs overlay / tab, per-run open / groom / rename, run-aware routing), planned lift maintenance (Operations > Maintenance), snowmaking On / Off / Auto + per-cannon switch, energy grid and green buildings (Energy tab), hiker hunger fixes (`npm run analysis:hunger`), Almabtrieb announcements, train station on rail end, footpath access for shops / chalets / apartments, loading indicator on the splash (`npm run boot:shots`). Guide + site + dev docs updated for all of it.
- Done in 0.2.1 (CHANGELOG): audio rewrite (nine procedural tracks, Music style + Next track, ambience default 0.28; `docs/audio.md`), lift tower height caps + thicker tall towers (`docs/lifts-clearance.md`).
- Done: M5.1 goals/advisor/audio, M5.2 ride-along + photo + walk mode, M5.3 progression, scenarios, achievements (verify in the learnings file for current state).
- Unverified by agents: pointer lock (walk mode), real GPU frame rate / draw calls, audio by ear; open bug noted earlier: pistes paintable over streams.
