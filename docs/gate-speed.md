# Gate speed: measurements and plan

Step one of the "speed up the release quality gate" item: **measure only**. Nothing in the gate changed. `npm run gate:timings` (`scripts/gate-timings.ts`, `--only a,b`, `--skip x`, `--dry`) runs every stage of the full release gate once, serially, and writes `.weave/gate/timings-<date>.{json,md}` plus a log per stage in `.weave/gate/logs/` (wall, user+sys CPU and peak RSS via `/usr/bin/time -l`, exit code, output tail).

Run: 2026-11-13, macOS, 14 cores, Node v24.22.3 (the 0.6.4 notes say v22.23.4), Chrome 157 with SwiftShader. Load average 3.3 at the start and 12.8 at the end (the gate itself; the machine also runs the owner's Chrome, so numbers are slightly noisy, CPU seconds are the steadier figure). Every stage was run once, no repeats.

## Measured (sorted by wall time)

| Stage | Wall s | CPU s | CPU/wall | RSS MB | Exit | Parallel-safe? |
|---|---:|---:|---:|---:|---|---|
| test-balance | 954.6 | 976 | 1.02 | 648 | ok | no; 1 thread, needs nothing, safe to run next to others |
| mobile:audit | 264.5 | 2778 | 10.5 | 754 | ok | yes (own vite+Chrome), but ~10 cores |
| test-2 | 232.3 | 1555 | 6.69 | 643 | ok | redundant repeat |
| test-1 | 227.8 | 1505 | 6.61 | 605 | ok | yes, uses all cores |
| touch:e2e | 213.8 | 2256 | 10.55 | 461 | ok | yes, ~10 cores |
| offline:splash | 183.3 | 2009 | 10.96 | 540 | FAIL | after build (dist, :port free); FAILED |
| shot-suite | 181.8 | 1515 | 8.34 | 726 | ok | yes, ~8 cores |
| sfx:e2e | 123.3 | 1397 | 11.33 | 547 | FAIL | after build (dist); FAILED |
| flicker | 121.1 | 1329 | 10.97 | 524 | ok | NO, frame timing |
| menu-music:e2e | 120.8 | 1233 | 10.2 | 545 | FAIL | after build (dist); FAILED |
| music:e2e | 82.7 | 760 | 9.19 | 529 | ok | yes (dev server) |
| visitor:sanity | 58.3 | 563 | 9.66 | 584 | ok | yes (own vite on a free port + own Chrome) |
| test-perf | 57.6 | 81 | 1.4 | 1101 | ok | NO, needs a quiet machine |
| analytics:e2e | 46 | 301 | 6.53 | 554 | FAIL | after build (dist); FAILED |
| desktop:diff | 34.5 | 335 | 9.72 | 555 | ok | yes |
| play:sanity | 31.8 | 224 | 7.03 | 589 | ok | yes (own vite on a free port + own Chrome) |
| winter:sanity | 28.9 | 127 | 4.38 | 594 | ok | yes (own vite on a free port + own Chrome) |
| backcountry:sanity | 23.9 | 147 | 6.14 | 581 | ok | yes (own vite on a free port + own Chrome) |
| summer:sanity | 23.8 | 112 | 4.72 | 560 | ok | yes (own vite on a free port + own Chrome) |
| sled:sanity | 21.9 | 124 | 5.68 | 625 | ok | yes (own vite on a free port + own Chrome) |
| m74:sanity | 21.3 | 126 | 5.92 | 528 | ok | yes (own vite on a free port + own Chrome) |
| phase6:sanity | 17 | 80 | 4.66 | 520 | ok | yes (own vite on a free port + own Chrome) |
| schirmbar:sanity | 16.4 | 74 | 4.5 | 519 | ok | yes (own vite on a free port + own Chrome) |
| photographer:sanity | 16 | 70 | 4.35 | 500 | ok | yes (own vite on a free port + own Chrome) |
| winter-tours:sanity | 10.7 | 35 | 3.29 | 478 | ok | yes (own vite on a free port + own Chrome) |
| site:og | 9.9 | 22 | 2.24 | 256 | ok | yes; writes site/assets/og |
| build:site | 9.6 | 17 | 1.78 | 1277 | ok | after site:og; writes dist-site/ |
| build | 8.4 | 16 | 1.92 | 1272 | ok | writes dist/ |
| lint | 6.9 | 12 | 1.75 | 852 | ok | yes |
| typecheck | 5.4 | 10 | 1.91 | 1284 | ok | yes |
| verify:site | 1.5 | 2 | 1.52 | 229 | ok | yes |
| verify-pwa | 0.4 | 1 | 1.52 | 208 | ok | after build |
| site:check | 0.4 | 1 | 1.68 | 156 | ok | yes |
| docs:img | 0.3 | 0 | 1.1 | 99 | ok | yes |
Total serial wall: **3157 s = 52.6 min** (2925 s without the second `npm test`). Total CPU: 18 236 s of CPU (without test-2) is 1300 s on 14 cores, so on this machine the browser stages (CPU/wall about 5 to 11 because SwiftShader renders on every core) are CPU bound, not idle. Sanity scripts themselves are short (10 to 60 s each, about 5 min together).

**Four stages failed in the run and again alone on a second try (same result, so not load):** `analytics:e2e` ("service worker active on the fake host: not active", no gtag request seen), `offline:splash` (puppeteer protocol timeout), `menu-music:e2e` and `sfx:e2e` (120 s wait, `locked` state). All four serve `dist/` on the fake host `slope.test` and need an activated service worker; `music:e2e` (same server) passed. They passed in the 0.6.4 gate, so the suspects are Chrome 157 or Node 24 on this machine. Not investigated (measure only); this needs fixing before any gate runner trusts them. Their times are those of a failing run (timeouts), so treat them as upper bounds.

Other facts: all servers listen on port 0 or a `freePort()`, so there are **no port clashes**; every sanity script starts its own `vite` dev server and its own Chrome (about 3 s of startup each, 11 times); `dist/` is only read by verify:pwa and the four dist e2e scripts; `.weave/shots` is shared but file names are per script. Order dependences: build, then verify:pwa and the dist e2e scripts; site:og, then build:site, then site:check and verify:site (build:site writes `dist-site`, not `dist`). Not parallel-safe: `test:perf` and `flicker` (timing thresholds), and anything next to them.

## Tests per file (`npm test`, 473 files, vitest JSON reporter)

Vitest wall 227 s (tests 1350 s summed, collect 133 s): already 14 threads; **one file sets the wall: `tests/game/summer.test.ts` 208 s** (24 tests). Slowest files (s): summer 207.8, demoTowns 73.7, advisorScenarios 61.9, game/balance 49.0 (the BALANCE-off part), scenarioBots 36.7, world/Water 36.7, rivals 33.3, meta/yearReport 32.3, perf/liftRates 31.9, staffUpgrades 29.3, advisor 28.0, liftMaintenance 27.0, events 26.0, achievements 25.4, stories 24.8, energyBot 23.6, game/smoke 23.6, LiftClearance 18.8, perf/liftHeights 17.9, almabtrieb 17.4. Over 20 s: 17 files; over 10 s: 31. Environments: 74 files use happy-dom (total 13 s), 399 run in node (1307 s): the environment is not the cost, simulation is. Timings are inflated by running 14 threads at once; summer.test.ts is one big serial file, so splitting it into 3 to 4 files is the cheapest way to take about 120 s off `npm test`.

## Fixed waits

Static sum of literal `waitForTimeout` / `sleep` / `setTimeout` / `wait:` values per script (a lower bound, loops are not multiplied): music:e2e 28 s, touch scenarios 46 s, visitor 14 s, mobile:audit 14 s, m74 13 s, sfx 10 s, backcountry 6 s, menu-music 6 s, winter 6 s, the rest under 5 s; harness 9.5 s of settle waits per shot. Scripts do not print phase timings. Total about 3 minutes in a 52 minute gate: **shortening waits is not worth it**; the time is SwiftShader CPU.

## Top 5 time sinks

1. `test:balance` 955 s (31 % of the gate): one test file, one thread (CPU/wall 1.0). Split by test (48 tests) over 4 to 8 workers: about 240 to 120 s.
2. `mobile:audit` 265 s, `touch:e2e` 214 s, `offline:splash` 183 s (partly a timeout), `shot:suite` 182 s, `flicker` 121 s: browser stages at 10 cores each.
3. `npm test` 228 s, run twice (232 s): 460 s.
4. `sfx:e2e` / `menu-music:e2e` 120 s each: both timeouts in this run.
5. `test:perf` 58 s: small but must run alone and quiet.

## Redundancy

- `npm test` twice: the second run is only a flake check. Replace by retrying only failing files (about 230 s saved).
- `shot:suite` (182 s, 0 console errors) overlaps the sanity scripts, which also screenshot and fail on shader/console errors; keep a smaller subset (shots that no sanity covers: night, photo, walk, ride) for the full tier.
- Sanity coverage overlaps: `winter`, `winter:tours`, `backcountry` and `schirmbar` all boot a winter 64-64 resort; `play:sanity` already covers boot, save and reload. They are cheap (10 to 30 s), so keep them, but share one vite server (about 3 s each, 30 s total).
- `docs:img`, `verify:pwa`, `site:check`, `verify:site` are under 2 s each: no point optimising.
- `build` and `build:site` both run `tsc --noEmit` (about 4 s each) after the separate `typecheck`.

## What to run by changed path

| Changed | Stages |
|---|---|
| docs only (`docs/`, `*.md`) | `npm test` repo tests (`tests/repo`), `site:check` if guide docs |
| `site/` only | site gate (site:og, docs:img, build:site, site:check, verify:site), `tests/site`, `tests/repo` |
| `src/render`, `src/ui`, shaders | typecheck, lint, tests, build, verify:pwa, shot:suite, desktop:diff, mobile:audit, flicker, a few sanities, perf |
| `src/sim`, `src/config`, `src/game` | typecheck, lint, tests, balance, perf, build, sanities, save/reload (play, phase6); no flicker / desktop:diff |
| `src/audio`, `public/audio` | tests, build, music / menu-music / sfx e2e, analytics e2e not needed |
| `src/persist` | tests, sanities (save and reload), no browser audits |
| `src/sw`, `src/pwa`, `vite.config` | build, verify:pwa, offline:splash, analytics:e2e |
| `scripts/promo`, `scripts/analysis`, `.github` | typecheck, lint, `tests/scripts` |
| anything touching the release | full gate |

## Estimated savings

| Idea | Saves | Notes |
|---|---:|---|
| Drop the second `npm test`, retry only failing files | 230 s | flaky files re-run alone |
| Split `summer.test.ts` | about 120 s of the 228 s test wall | one file is the critical path |
| Run `test:balance` per test in parallel (4 to 8 workers) | 700 to 830 s | biggest single win; needs a per-test split or `--shard` with several processes |
| Parallelism of independent stages | 4 workers: 52 to 19 min (schedule below) | CPU limits it, see below |
| One shared vite server for the sanity scripts | about 30 s | small; port is fine (ephemeral) |
| vitest `pool=threads` vs `forks`, `poolOptions` | not measured, probably under 10 % | the test CPU is simulation, not worker startup |
| Shorter fixed waits | under 100 s | not worth the risk |
| Path-based tiers | docs-only 52 to 1 min, render 52 to about 25 min | biggest win for the common case |

**Parallel schedule** (list scheduling from the measured wall times, test-2 dropped, test:perf and flicker kept serial at the end, build before its dependants, no CPU contention model): 1 worker 2925 s, 2 workers 1556 s, **4 workers 1133 s (18.9 min), 8 workers 1133 s**. The critical path is `test:balance` 955 s plus the serial perf and flicker (179 s) = 1133 s, so more than 4 workers does nothing until balance is split. The honest limit on this 14 core machine is CPU: 18 236 CPU seconds / 14 cores = 1300 s (about 22 min) even with perfect packing, because each SwiftShader stage already uses about 10 cores. So expect about 22 to 25 minutes full gate with 4 workers, and measure it, concurrent browsers also risk timeouts (the shared-load failure mode that the dist e2e scripts show). With balance split 4 ways the path-bound floor drops to about 420 s and the CPU bound (22 min) dominates.

## Proposed `npm run gate`

- A stage list (like `STAGES` in `scripts/gate-timings.ts`) as a DAG: `needs` (build, site:og, build:site), tags `browser`, `cpu-heavy`, `quiet`.
- Concurrency cap default 4 (`--jobs N`); CPU-heavy browser stages count as 3 slots on a 14 core box so only about 2 run at once; `quiet` stages (`test:perf`, `flicker`) run alone, last.
- Per-stage log in `.weave/gate/logs/<run>/<id>.log`, a live one-line status per stage, a final summary table (wall, cpu, exit, flaky) in the console, and `.weave/gate/<run>.json` + `.md` (same shape as the timings file; the release notes table can be pasted from it).
- Tiers: `--fast` (typecheck, lint, tests, build, verify:pwa: about 6 min), default = path-based stages from `--since <ref>` (git diff names mapped as in the table above), `--full` (everything, the release gate).
- Exit code: 0 only when every stage passed or passed on retry (flaky is reported, not hidden); 1 on any hard failure; the summary lists the failing stage and its log path.
- Flaky policy: a failed stage is retried once (test stages: only the failing files, via vitest `--changed`-like file list from the JSON reporter); a pass on retry is marked `flaky` in the table and counted in the summary; two failures is a failure. Never retry `test:perf` more than once alone.
- Must stay serial and alone: `test:perf`, `flicker`, `desktop:diff` before / after (needs a worktree of the before ref), and every timing check; the first stage is never run while another gate runs.

## CI plan

Current CI (pull requests, ubuntu-latest): typecheck, lint, test, build, verify:pwa, site gate; `extra-tests.yml` runs perf and balance by hand. Feasible on ubuntu-latest: the same plus a `balance` job (matrix over shards when balance is split), `shot:suite` and the sanity scripts as a matrix of one job per script (Chrome plus SwiftShader are available on the runners; 4 vCPU, so budget 2 to 3x the local times, about 1 to 3 min per sanity) and `analytics:e2e`, `offline:splash`, `music/sfx e2e` after fixing them. Keep local: `test:perf`, `flicker`, `desktop:diff`, `mobile:audit`, `touch:e2e` (shared-runner noise or very long), and the final `--full` release gate before tagging. Cache `node_modules` (already via setup-node) and the `dist` build artifact between the build and the dist e2e jobs.

## Recommended first step

Fix the four dist e2e failures first (they block any trustworthy gate, probably one cause: service worker activation on the fake host with this Chrome or Node), then build `npm run gate` with the DAG, concurrency 2 to 4, retry-once and the summary, and split `summer.test.ts` and `test:balance` as separate small changes. Re-run `npm run gate:timings` after each to confirm.
