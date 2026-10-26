# Performance (Task 28)

Everything here is measured **headless in Node** (sim only). Render-side numbers (FPS, draw calls, GPU) could **not** be measured by the
agents (no WebGL): use the in-browser benchmark below and paste your results into the "Browser results" section.

## Sim benchmark (headless)

Run: `BENCH=1 npx vitest run tests/perf/bench.test.ts` (prints one line per size + a `BENCH_JSON` line each; best of 2 runs).
Setup per size: real `createSim` + `buildStarterResort` (lodge, road, parking, ticket office, chalet, chairlift(s) + piste, restaurant, hut,
ski school + magic carpet, patrol + first aid, groomer garage + outpost, reservoir + cannons, ice rink, terrace, cafe, shop ...). Guests are
topped up to the **cap** (1,000 / 2,000 / 3,000) through `Spawner.benchFill` during daytime, then 2 in-game days (480 ticks) are timed with
every system timed individually. "at cap" = ticks with >= 90 % of the cap alive (the acceptance condition).

Machine: Apple-silicon Mac, Node 20, vitest (single worker for the bench). Numbers are ms per tick.

| size | generation | starter build | guests (peak/cap) | tick avg (at cap) | tick p95 (at cap) | tick max | heap | save size | target |
|------|-----------:|--------------:|------------------:|------------------:|------------------:|---------:|-----:|----------:|--------|
| 64   | 19 ms      | 51 ms         | 1000 / 1000       | **0.47**          | 0.70              | 1.5      | 33 MB | 273 KB | avg < 4 |
| 128  | 49 ms      | 14 ms         | 2000 / 2000       | **0.79**          | 1.05              | 2.2      | 32 MB | 582 KB | avg < 6 |
| 256  | 252 ms     | 344 ms        | 3000 / 3000       | **0.98**          | 1.26              | 2.5 (7.9 incl. night) | 58 MB | 1.1 MB | gen < 1.5 s, avg < 8, p95 < 16, heap < 450 MB |

All acceptance targets are met with 5-15x headroom. (Heap = `process.memoryUsage().heapUsed` after the run; save size = JSON of
`registry.serialize()` + buildings + lifts.)

### Per-system breakdown (avg / p95 / max ms per tick, guests at cap)

| system | 64 | 128 | 256 |
|--------|----|-----|-----|
| guests (movement, decisions, pathfinding queue, needs, lift queues) | 0.24 / 0.58 / 1.46 | 0.46 / 0.97 / 2.16 | 0.64 / 1.13 / 2.39 |
| ops (piste quality, grooming, snowmaking, safety) | 0.01 / 0.01 / 0.82 | 0.03 / 0.02 / 3.18 | 0.08 / 0.08 / 5.51 |
| attractions | 0.01 / 0.02 / 0.11 | 0.00 / 0.02 / 0.09 | 0.00 / 0.01 / 0.05 |
| weather (+ daily open-status evaluation) | 0.00 / 0.00 / 0.17 | 0.00 / 0.01 / 0.31 | 0.02 / 0.02 / 1.02 |
| rating | 0.00 / 0.00 / 0.11 | 0.00 / 0.00 / 0.23 | 0.00 / 0.00 / 0.53 |
| spawner / economy / clock / season | ~0 | ~0 | ~0 |

Notes
* No sim optimisation was necessary: the earlier tasks already time-slice the expensive work (NavGraph builds `NAV_MAX_BUILDS_PER_TICK`,
  path queries `NAV_MAX_QUERIES_PER_TICK`, snow / coverage / rating are incremental or daily, SpatialHash for neighbour queries).
* The only spikes are the once-per-day jobs (ops night grooming/avalanche check ~3-5 ms, weather day roll ~1 ms): they stay far below one
  frame budget even at speed 3 (up to 8 catch-up ticks per frame).
* `tests/perf/benchRegression.test.ts` is the always-on guard (best of 3, asserts the acceptance targets above with the real numbers
  5-15x lower, so it does not flake under parallel test load). `tests/perf/bench.ts` is the reusable harness.

## Render-side budgets (by code review; NOT measured)

Reviewed by reading; fixes below are covered by unit tests in `tests/render/renderOptimisations.test.ts` (no GPU needed).

| area | finding | change |
|------|---------|--------|
| GuestRenderer | instanced capsules, but **every** alive guest (up to 3,000) got its matrix written and was submitted even when off-screen; full update ran even when paused | CPU view-culling against the camera (generic ortho/perspective, 12 % margin) and the whole update is skipped when tick, alpha and camera are unchanged (paused). Impostor switch height now scales with the graphics preset |
| Trees / Rocks | already instanced per cell + LOD (full / low-poly / billboard) with frustum culling and a rebuild budget; but each of the 9 species layers re-ran its cell loops **every frame** | per-frame pass is skipped when camera, LOD level and stale-cell state are unchanged. New `lodScale` and `density` (deterministic per-instance thinning) for the quality presets |
| TerrainMesh | chunk rebuild already budgeted (`TERRAIN_BUILD_BUDGET`), far macro LOD, snow attribute-only updates throttled to 2 Hz in `main` | none needed |
| Water | uniform-only per frame | none needed |
| Precipitation | GPU-side particle pool, uniforms only | density multiplier for the quality presets |
| CoverageOverlay | repainted the N x N texture and re-uploaded it on **every** invalidation (snow overlay invalidates every 0.5 s, quality/network versions more often) | repaints coalesced to at most one per 250 ms; still immediate when the mode changes; nothing happens while hidden (already the case) |
| AttractionActivity | recomputed every pose every frame, plus `activityViews()` allocated a fresh array and object per attraction each frame | skipped while the (fractional) tick is unchanged, i.e. paused; views are reused objects in `main.ts` |
| IncidentView | avalanche debris (up to 2,048 matrix composes) rewritten every frame | rewritten only when the set of slides changes |
| GroomingView / Snowcat fleet, HeliView, animals | tiny counts, instanced | none needed |
| Thumbnails prewarm | already deferred (500 ms after start, idle batches, dock refresh coalesced to one rAF) | none needed |
| Shadows | `Renderer.setShadows` existed but nothing used it; terrain/props use custom shaders that do not sample a shadow map | now driven by the graphics preset (`high` only, default never on). Effectively a no-op until casters opt in (**unverified**) |

### Graphics quality (top bar "Graphics: low / med / high", stored in `localStorage["slope.quality"]`)

| preset | pixel ratio cap | shadows | LOD scale | tree density | particles | impostor/hide zoom |
|--------|----------------:|:-------:|----------:|-------------:|----------:|-------------------:|
| low    | 1.0 | off | 0.7  | 55 % | 35 % | x0.7 |
| med    | 1.5 | off | 1.0  | 85 % | 70 % | x1.0 |
| high   | 2.0 | on (no-op for now) | 1.25 | 100 % | 100 % | x1.25 |

Default (`defaultQuality`): 256 -> low, 64 / 128 -> med, one step lower on devices with devicePixelRatio > 2.5. Never `high` by default.

## In-browser benchmark (how to run)

1. `npm run dev`, open `http://localhost:5173/?size=256&seed=1337` (try 64 / 128 too), build a resort (or just use the starting lodge).
2. Open the debug panel (F3 or "Debug" button, bottom-left) -> **Perf** section. It shows live FPS (avg / 1 % low), frame ms, draw calls,
   triangles, geometries, textures, sim tick avg / p95, the 5 most expensive systems, JS heap and guest count.
3. Press **Run benchmark** (keep "fill guests" ticked for the worst case: it tops the resort up to its guest cap during daytime). It scripts a
   camera flythrough: zoomed in (36 tiles tall) -> mid (96) -> fully zoomed out, ~6.7 s each, once at speed 1 and once at speed 3 (~40 s
   total, restores speed + camera afterwards). Do not touch mouse/keyboard meanwhile. Change **Graphics** in the top bar between runs.
4. A summary table is shown in the panel, printed to the console together with a JSON blob, and written to
   `localStorage["slope.perf.last"]` (last) and `["slope.perf.history"]` (last 10 runs). **Copy JSON** puts it on the clipboard.
   Also available as `__slope.perf` in the console.
5. Paste the table below.

### Browser results

_Not measured yet (agents cannot run WebGL). Paste the table + machine / browser / graphics preset here._

| map | graphics | view | speed | fps | 1 % low | ms avg | calls | tris(k) | tick ms | guests |
|-----|----------|------|------:|----:|--------:|-------:|------:|--------:|--------:|-------:|
|     |          |      |       |     |         |        |       |         |         |        |

## What remains unverified

* All FPS / frame-time / GPU / memory numbers in the browser (draw-call and triangle counts of the instanced layers are only unit-tested).
* That `high` shadows look right (nothing casts shadows yet), and the visual quality of `low` (55 % trees, LOD x0.7) on a real screen.
* CPU culling margin of `GuestRenderer` during fast camera pans (it uses the camera matrices of the same frame, 12 % margin).

## Perf tests vs. default tests

Timing assertions are flaky under parallel vitest workers, so they are split by mode (`tests/perfMode.ts`):

- `npm test` (default, parallel): every `[perf]`-tagged test still runs, but only as a **coarse guard** (budgets x5, speedup ratios /5) that CPU contention cannot trip. All logic assertions (spatial hash == brute force, path cost vs A*, determinism, invariants) run here at full strength.
- `npm run test:perf` (`vitest.perf.config.ts`): runs only tests whose name contains `[perf]`, with `PERF=1` (original strict thresholds), single forked worker, no file parallelism. Use it on a quiet machine.
- `npm run test:all`: default run, then the perf run.

Tagged tests: terrainGeometry (chunk rebuild, textures), TerrainGen benchmark, Water stream gen, Props placement, Pathfinding query time, Queues time slicing, Weather snow tick, safetyPerf, ops per-tick, SpatialHash speedup, GuestPerf, navTick, benchRegression. Add new timing tests with a `[perf]` name prefix and `budget()`/`minRatio()` from `tests/perfMode.ts`.

## Save / load budgets (Task 33)

Measured headless by `tests/persist/saveBudget.test.ts` (starter resort, guests at cap, gzip). Full details in `docs/saves.md`.

| size | gzip save | save | load | longest event-loop gap | budget |
|------|----------:|-----:|-----:|-----------------------:|--------|
| 64   | 71 KB     | 46 ms  | 58 ms  | 5 ms  | < 0.5 MB |
| 128  | 275 KB    | 67 ms  | 119 ms | 10 ms | < 1 MB |
| 256  | 861 KB    | 149 ms | 291 ms | 37 ms | < 3 MB, < 2 s each, no freeze > 200 ms |

## Ground level (ride / photo, M5.2 Task 13)

`npm run perf:ground` (scripts/perf-ground.ts): winter 128/64/256 demo resort (`populateDemo('medium')`), ~400-620 skiers spawned, camera in ride-along (auto guest / chairlift rider) or photo hero shot, then 60 calls of `renderer.onFrame(1/60)` (the whole JS update path: sim advance, guests, trees, rocks, terrain, lifts, buildings; NOT the GPU submit) and `renderer.info.render` of the last frame. Headless Chrome with SwiftShader (software GL) on an Apple-silicon Mac: **frame rates there are not representative and are not reported**; draw calls, triangles and the CPU update time are real. Exit code 2 when a 'med' ride frame on 128 exceeds `RIDE_DRAW_BUDGET_128` = 350 draw calls (`src/render/lod/nearLod.ts`).

| size | mode | quality | guests | draw calls | triangles | JS update ms/frame |
|---|---|---|---|---|---|---|
| 64 | ride | med | 417 | 143 | 1.33 M | 0.14 |
| 64 | photo | med | 419 | 179 | 1.74 M | 0.26 |
| 128 | ride | med | 432 | 102 | 1.34 M | 0.10 |
| 128 | photo | med | 427 | 225 | 1.74 M | 0.30 |
| 256 | ride | med | 622 | 214 | 1.69 M | 0.20 |
| 256 | photo | med | 636 | 209 | 1.15 M | 0.42 |
| 128 | chairlift | med | 431 | 127 | 2.53 M | 0.11 |
| 128 | ride | low | 433 | 206 | 1.05 M | 0.15 |
| 128 | ride | high | 432 | 194 | 1.74 M | 0.19 |
| 128 | photo | low | 432 | 217 | 1.17 M | 0.31 |
| 128 | photo | high | 433 | 226 | 2.00 M | 0.30 |

Walk mode (Task 12, 128, `npm run perf:ground`): med 178 draw calls / 2.77 M triangles / 0.28 ms, low 161 / 1.75 M / 0.27, high 182 / 3.24 M / 0.28 (budget <= 350 on med; the harness fails above it). The walk update is allocation free except a 5 Hz probe.

Reading: draw calls (102-226) depend mostly on where the camera looks (frustum-culled cells), not on quality or map size, and are far under the 350 budget; the JS update path is < 0.5 ms/frame (the guest loop is O(guests) with view culling). Triangles are the cost driver: low saves ~20-40 % against med/high. The first number to watch on a real GPU is triangles x fill (fog + detail shaders), which could not be measured here: please report fps from F3 in the playtest.

Quality caps (Settings > Graphics, `src/config/balance.ts` `QUALITY_PRESETS[q].ground`):

| cap | low | med | high |
|---|---|---|---|
| near-LOD radius (figures, lifts) | off | 6 tiles | 8 tiles |
| near trees / rocks per 16-tile cell | 0 / 0 (standard meshes from distance 0) | 70 / 40 | 90 / 50 |
| detailed figures at once | 0 | 40 | 40 |
| fog range | x0.7 | x1 | x1.15 |
| terrain detail texture | off | on | on |

Regression guard: `tests/render/groundQuality.test.ts` (preset ordering, low disables the heavy near features, `nearLod` honours the caps, eye / figure scale, a bounded-draw budget calculation) and `tests/world/Props.test.ts` (nearest-first cap, cap 0 handover); the draw-call number itself is checked by `npm run perf:ground`.


## Flicker / LOD switching (docs/flicker.md)
Iso tree / rock LOD levels now cross-fade (outgoing + incoming level both drawn for ~0.4 s) and cells are built for a 28 %-enlarged view: while a fade runs a layer draws at most 2 levels (about 2x the cells of one level for 0.4 s); steady-state draw calls are unchanged (terrain < 60, props < 40 tests green). The terrain far-LOD swap keeps a macro or its chunks for the transition frames (a few extra draw calls for ~10 frames on 256 maps). Hysteresis +-6 % on every LOD threshold. Measure with `npm run flicker`.
