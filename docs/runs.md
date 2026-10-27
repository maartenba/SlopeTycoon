# Pistes as runs

A *piste* the player sees (name, difficulty, length, grooming, open / closed) is a **run**: the stretch of painted tiles between two nodes. Before 0.2.2 the game treated every 8-connected blob of ski tiles as ONE piste, so several strokes that happen to touch were one "Black Run 1" with a single majority difficulty.

## Phase 1: split + stats (`src/world/Runs.ts`, `src/sim/Runs.ts`)
- **Nodes**: junctions (3+ branches), lift stations (forced: the centre-line tile nearest each station footprint), dead ends (absorbed into their run).
- **Runs**: tile chains between nodes, oriented downhill (`from` = upstream/higher node). Each has its own length (centre line), vertical drop, average / max slope, difficulty (majority of ITS OWN tiles, stored 0..3 -> 1..4), tile list, loop flag.
- **Wide pistes**: Zhang-Suen thinning gives a centre line; thinning spurs shorter than the local half width are pruned, pseudo nodes (degree 2, not a station) dissolve; every other tile is handed to the nearest run by a deterministic multi-source flood fill. A 6-wide slope is one run, a blob / 2x2 is one synthetic run, a closed ring is one loop run.
- **Invariant** (property-tested): every piste tile is owned by exactly one run (`runOf`) or is a skeleton tile of a node (`nodeOf`, `runOf = -1`).
- **Lazy + deterministic**: `RunIndex.network()` rebuilds when `Networks.version` or the station positions change (no RNG, nothing saved). Terraforming under a piste does not bump the version: slope figures refresh on the next network edit.
- **Identity**: `Names` already keeps persistent piste ids by tile-sample overlap, so it is fed runs instead of components. Ids / auto names ('Blue Run 3', ordinal per difficulty) / custom names persist when runs grow, split or merge; an old component name goes to the largest overlapping run.
- **Still components**: "not connected to a lift" warnings (`disconnected`), the tutorial's connected-piste counts. A run is disconnected when its component is.
- Goals count runs (per run, per difficulty tile counts). Inspector shows slope. New **Runs** overlay (`O` cycles, Terrain/View drawer): each run in its own colour, junction / station tiles white, label per run. The *Piste difficulty* overlay is unchanged (tile level).

## Phase 2: independence
- **Open / closed per run** (`OpenStatus.evalPistes` over runs): a run needs its own connected skiable snow, a lift connection (component level) and no closure. Player toggle (inspector button / Runs tab) = `RunSettings.closed`, reason "Closed by you"; avalanche / wind / control closures act on tiles, so they close exactly the runs they touch. Manually closed runs are also in the navigation closed mask (guests avoid them). A junction / station tile answers with an open incident run when one exists.
- **Persistent ids**: `RunSettings` is keyed by `Names.pisteId(run)`; ids survive growing / splitting / merging (largest overlap keeps it), settings of runs that vanish are pruned.
- **Grooming per run**: tile quality stays per tile. `Grooming.tileOrder(tile)`: 0 auto, 1 *Groom first* (+10 priority), 2 *Do not groom* (excluded from the nightly plan). Runs tab / inspector cycle the mode.
- **Traffic**: passes today = busiest centre-line tile of the run; this week = sum of the last 7 daily peaks (`runStats`, observer). *Groomed ago* = last day a snowcat touched any tile of the run (observer).
- **Rename** per run (inspector input), advisor `piste.icy` names the worst run ("Black Run 2 is icy") with a map target, **Runs tab** in Operations (name click = camera + highlight, level, length, drop, traffic, surface, groomed, grooming, status).
- **Saves**: new module `runs` v1 (closed ids, grooming modes; part of `stateHash`) and observer module `runStats`. Old saves have neither: nothing closed, all Auto; the old component names/ids (`names` module) are matched to the largest overlapping run on load. No `SAVE_FORMAT_VERSION` bump (additive modules).

## Phase 3: routing
At a lift top the skier already picks a *via* tile (`Exploration.pickVia`: top -> via -> bottom). The candidate tiles are now scored through `runChoice(tile, skill)` (createSim): difficulty fit uses the **run's** difficulty, plus whole-run crowding (log of mean passes on the centre line, cached per sim hour), the surface the skier likes on that tile, and mood (unhappy guests lean towards the easier run). Closed runs are skipped; if every candidate is closed `pickVia` returns 0 (cheapest path as before), so nobody gets stuck. Weights: `EXPLORE.runCrowdWeight / runQualityWeight / moodEase`.

## Determinism / goldens
`tests/sim/staff.test.ts` goldens were re-recorded on purpose (names now hold run identities; open / closed per run changes the bot's 200 days: money 180221.69 -> see the test; see docs/balance.md).
