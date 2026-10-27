# Saves (Task 33)

Everything below was verified **headless in Node** (vitest + `fake-indexeddb` + happy-dom). **Not verified (no browser here):** real IndexedDB in
Chrome/Safari/Firefox, the look of the Save/Load modal, the page-reload boot (`?load=` / `?continue=1`) in a real tab, the WebGL thumbnail capture,
CompressionStream in the target browsers, and the renderer showing the loaded world (terrain/props/lifts/guests meshes are built from the restored
sim exactly as for a new game, but nobody has looked at it).

## Architecture

| file | role |
|------|------|
| `src/game/saveState.ts` | **SaveRegistry**: `SAVE_MODULES` = ordered `{key, version, serialize, load, reset?}` for every stateful module; `collectSave`, `applySave` (+ `finishLoad` rebuilds derived state), `stateHash` (FNV over every module's saved form, per-module parts for debugging). |
| `src/game/createSim.ts` | `createSim({ size, seed, fromSave })`: same composition, but skips lodge / road stubs / snow seeding / fauna population / prop generation and calls `applySave`. Terrain is still *re-derived from the seed* (≈250 ms at 256) because lakes/streams/forest density are generation-time data; the grid arrays are then overwritten by the save. |
| `src/game/restore.ts` | boot glue: `openBackend()` (IndexedDB → LocalStorage → none), `resolveBootSave()` (`?load=<slot>`, `?continue=1` with corrupt-slot fallback), `stripBootParams()`. |
| `src/persist/codec.ts` | typed array ⇄ base64 with **sparse** (≥80 % zeros: snow, quality, occupancy, closures), **delta** (Int16/Int32: heights) and raw encodings; long numeric arrays are packed automatically; CRC32; gzip via `CompressionStream` (pluggable `setCompressor`, plain fallback); `yieldNow()` (`scheduler.yield` or `setTimeout 0`). |
| `src/persist/Serializer.ts` | envelope `{magic:'SLOPETYCOON-SAVE', version, createdAt, seed, mapSize, meta, modules:{key:{v, crc, d}}}`; `encodeSave` (yields between modules) / `decodeSave` (validates magic, version, CRC per module, runs migrations). `SaveError` codes: `invalid`, `corrupt`, `newer`, `tooLarge`, `migration`. |
| `src/persist/migrations.ts` | `SAVE_FORMAT_VERSION = 2` (1 -> 2: calendar compression), `MIGRATIONS[n]` = n→n+1 (pure envelope transforms), `migrate()`. Tests use an example v1→v2→v3 ladder (module rename, default added). |
| `src/persist/IdbStore.ts` | IndexedDB wrapper: stores `saves` (bytes), `meta` (listing rows, so the slot list never loads payloads), `settings`; one transaction per write; strictly increasing `updatedAt`; quota → `StorageError('quota')`. |
| `src/persist/LocalFallback.ts` | same `SaveBackend` over `localStorage` (base64, ≤ 1.5 MB per save, warns in the UI). Used only when IndexedDB is missing. |
| `src/persist/SaveManager.ts` | slots, quick save (`quick`), rolling autosave (`auto-1..3`), export/import, error toasts, corrupt recovery. |
| `src/ui/components/StSaveLoad.ts` | the modal; top bar gets 💾 and a hidden-until-needed **▶ Continue** button. |

### Save file / slot format
Gzip'd JSON text (`1f 8b` magic → gunzip; otherwise plain JSON, used when the browser has no CompressionStream). The `.slope` export is byte-identical to the
IndexedDB blob. Imports are validated (magic, version, CRC of every module, 64 MB sanity limit) **before** a new `import-…` slot is written; nothing is overwritten.

### Module list (load order)
`core` (seed/size, date, money, rng, id counter, loop tick+speed, headless sim tick, economy lock) · `grid` (heights, tileType, snow, flags, occupancy id+flags) ·
`props` (kind/tile/growth exact, jitter/scale/rotation quantised) · `networks` (kind, conn, bridge, layers, difficulty, quality, entries, version) ·
`buildings` / `lifts` (stores incl. rotation, active, names live in `names`, staff/prices live in attractions, lift ops/modes/schedules/condition live on the lift data) ·
`cond` (ski/hike hysteresis) · `names` · `nature` (fauna, livestock, growth tracker, scenery counters) · `leavers` · registry systems `clock, season, weather (+snow row cursor), spawner (vehicles), guests (SoA store + lift boarding windows), attractions (prices, staff, counters, open/reported), ops (piste quality/wear/traffic, grooming, snowmaking, reservoirs, safety: incidents, avalanche, wildlife animals, patrol agents + staff, heli), economy (finance, ledger, loans, tickets, lift ops, marketing, pricing), rating` · `families` · `openStatus` (temporary closures).
`energy` v1 (item F, docs/energy.md: per-generator generation today / yesterday, applied shares, biomass timber stock, nursery credit, last settled day; old saves load empty) · `stats` v1 (daily stats ring: 360 days of typed arrays + the day's accumulators; old saves load empty) · `yearReports` v1 (the last 10 Resort of the Year reports as compact JSON, each with an optional <= 30 kB JPEG cover; old saves load with none). Both are read-only observers of the sim (`docs/year-report.md`).
**Derived and rebuilt, not saved:** coverage maps, spatial hash, nav graph / paths / decision caches, piste index, forest cover, open/closed verdicts (`OpenStatus.evaluate`, silently), remote-forest map.
Settings (graphics quality, audio) stay in their own storage. Missing module in an older save → `reset()` + warning; a module saved by a *newer* build → refuse.

## Boot / load flow (decision: reload, not in-place)
Loading a slot **validates it first** (CRC, version) and then reloads the page with `?load=<slot>`; boot reads the slot *before* the renderer exists, takes map size + seed from the
save, builds the sim with `createSim({fromSave})` and restores the camera (`meta.camera`: x, z, yaw, zoom). `stripBootParams` removes the parameter so a manual refresh starts a normal new game.
Why not tear down and rebuild in place: `main.ts` wires hundreds of module-level views/tools to one sim; an in-place rebuild risks leaking GPU resources and stale references, a reload is a guaranteed clean slate.
`?continue=1` loads the newest loadable save (skipping corrupt ones with a warning) — Task 35's main menu can simply navigate to it. When the page is a fresh game and any save exists the top bar shows **▶ Continue**.
Lift meshes for existing lifts are created in `registerLiftTools` (`for (const l of lifts.all()) view.add(l)`); buildings/props/nature/guests views already built from the store at boot; terrain/network chunks are all marked dirty on load.

## Autosave
`month:changed` (every in-game month) → rolling `auto-1 → auto-2 → auto-3 → auto-1…` (oldest overwritten), quiet info toast "Autosaved" (news is not touched). `visibilitychange` (hidden) / `pagehide` / `beforeunload` start an
async IndexedDB write (silent, best effort: a synchronous snapshot of a big game is not possible, so a very fast tab close can lose it). Toggle in the modal (persisted in the `settings` store). Nothing is autosaved after bankruptcy.
Keys: **F5** quicksave, **F9** quickload (ignored while typing in a field).

## Determinism & documented demotions
`tests/game/saveLoad.test.ts`: for 64 (winter, spring, summer, autumn, with an open incident + a temporary closure), 128 and 256 maps with guests present: save through the **full byte format** →
load into a fresh `createSim({fromSave})` → run N ticks; **every registered module's state hash is compared every 40 ticks** against a *control* (the same save applied in place to the live sim).
The control exists because these state is intentionally reset on load (identically in both runs):
* guests **Queueing / Riding** a lift → `Idle` (lift queues start empty; the rolling boardings-per-hour windows *are* saved);
* guests **Using** an attraction stay `Using` but the attraction's queue/slots are empty → released by the existing membership check next tick; overnight room bookings (`RoomBook`) cleared;
* nav graph, guest paths, decision caches, spatial-hash list order restart from the restored world;
* `networks.version` is bumped by one (cache invalidation);
* prop jitter/rotation/scale are quantised (idempotent), kind/tile/growth exact;
* `OpenStatus`/wildlife derived maps are recomputed on the first update.
Making in-transit guests fully restorable was judged not worth it (lift cable positions, queue slots and nav paths would all need serialising); the demotion costs the player a few seconds of queueing.
`restored sim equals saved sim` test: all modules except `sys.guests`, `sys.attractions`, `networks` (version) are identical right after load.
Things the determinism test found and that were fixed: Rating's per-day guard + last breakdown, lift boarding windows, piste traffic counters, patrol/heli agents + staff, wildlife animals, families (phases, schools' lesson queues), attraction open/reported flags, Spatial hash not cleared on in-place load.
Test-only caveat: `PisteTraffic.sink` is a process-wide static (the last created sim receives traffic); the test re-attaches it before every tick of each sim. Irrelevant in the game (one sim per page).

## Budgets (`tests/persist/saveBudget.test.ts`, `[perf]`-tagged; starter resort + guests at ≥ 90 % of the cap; Apple-silicon Mac, Node 20)
| map | guests | props | gzip save | plain JSON | save | load (decode + createSim) | longest event-loop gap save / load | budget |
|-----|-------:|------:|----------:|-----------:|-----:|--------------------------:|-----------------------------------:|--------|
| 64  | 902    | 2.3 k | **71 KB**  | 359 KB  | 46 ms  | 58 ms  | 5 / 4 ms   | < 0.5 MB |
| 128 | 1,806  | 24 k  | **275 KB** | 1.2 MB  | 67 ms  | 119 ms | 10 / 5 ms  | < 1 MB |
| 256 | 2,709  | 95 k  | **861 KB** | 3.8 MB  | 149 ms | 291 ms | 37 / 14 ms | < 3 MB, < 2 s, no freeze > 200 ms |
All met with a wide margin. First version stored props as float64 (256: 3.08 MB gzip, over budget); quantising + typed columns cut it to 0.86 MB. Real browsers: gzip in `CompressionStream` is typically 2–3× slower than Node's zlib, still far below 2 s; the base64/JSON work is sliced per module with an event-loop yield between modules (the biggest single slice at 256 is `props`).

## Tests
`tests/persist/{codec,migrations,stores,saveManager,saveBudget}.test.ts`, `tests/game/saveLoad.test.ts`, `tests/ui-dom/saveload.test.ts`. They cover: encodings, CRC, gzip (native, injected zlib, plain fallback), migration ladder + newer-version refusal, IdbStore contract on `fake-indexeddb` and the LocalStorage fallback (quota, size limit, corrupt index), the "reload restores the autosave" flow (fresh IdbStore instance on the same factory → `?continue=1` → identical state), rolling autosaves (1,2,3, oldest overwritten, quiet toast), hidden-tab autosave, corrupt newest save → fallback to the older one with a warning and the slot kept, export/import through the `.slope` format (valid / garbage / truncated / > 64 MB), quota errors, and the modal's DOM behaviour (closed = `display:none`, rows, every action, vetoed confirms, errors, Escape/backdrop, relative times).

## Format version 2: 15-day months

`SAVE_FORMAT_VERSION` is 2. `MIGRATIONS[1]` (`v1to2` in `persist/migrations.ts`) converts the 30-day-month calendar to the 15-day-month calendar: `day' = floor(day/30)*15 + floor((day%30)/2)`, every stored absolute-day stamp (`year*360+day` -> `year*180+day'`) and the `year*1000+day` weather keys; month-indexed data and durations are untouched; snow depth is kept, weather / season are recomputed from the date. Field list and tests: `docs/time-flow.md` section 8.3, `tests/persist/calendarMigration.test.ts`.

## `progression` module (M5.3)

`{ mode: 'career' | 'sandbox', level, unlocked: ['lift:gondola6', ...], history: [{ level, year, day }] }`, version 1, listed after `goals`. `unlocked` is a snapshot of every gated item opened by the latched level, so changing `src/config/unlocks.ts` later never re-locks an item in an existing save. Not saved: `unlockAll` (tutorial) and the builders' bypass. A save **without** this module (and without `config.mode`) loads as **Sandbox** (`SaveModule.reset`; `createSim` sets `config.mode = 'sandbox'`), so old resorts keep everything unlocked. `docs/progression.md`.


## `scenario` module (M5.3, Task 15)

`{ v, id, startAbs, family, summer, openDays, belowDays, happy, famHappy, sandbox, states: {objectiveId: {met, failed, hold, metDay, value, progress}}, finished: {result, medal, score, days, reason} | null }`, version 1, listed last. `null` for games that are not scenarios. The rules (modifiers) are NOT in the module: `createSim` re-applies them from `config.scenario` (the `config` module). A save without the module (all older saves) has no `config.scenario` and loads as a normal game; a module whose `id` or `v` does not match restarts the scenario clock. The local profile (medals, best scores) is NOT part of a save: it lives in the IndexedDB database `slope-profile` (`docs/scenarios.md`). 

## M5.3 additions: save-size impact
New modules: `stats` (daily ring buffer, 360 days, ~50 kB raw), `yearReports` (last 10 reports, ~3 kB each + a cover of <= 30 kB each), `achievementsRun`, `progression`, `scenario` (tiny). Measured (`tests/perf/m53Observers.test.ts`, starter resort at the guest cap, 2 years of demo stats, two year reports with 30 kB covers): gzip 64: 73 -> 96 KB, 128: 275 -> 299 KB, 256: 858 -> 883 KB, i.e. about **+24 KB** on every size (covers are JPEG base64, so the real delta with 10 full covers is at most about +250 KB gz in a long game: still far inside the < 0.5 / 1 / 3 MB budgets). No change was needed.
