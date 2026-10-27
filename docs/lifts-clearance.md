# Lift clearance over trees, buildings and other lifts

Lifts used to be validated against the **terrain only**; cables ran through forests and roofs. `validateLift` now also keeps every carrier clear of what really stands under the line. Code: `src/sim/LiftClearance.ts` (obstacle map, sampling, lane planning), `src/sim/Lift.ts` (solver + `liftPlantBlocker`), `src/world/TreeHeights.ts` (canopy data), `src/config/buildingHeights.ts` (roof heights). Tests: `tests/sim/LiftClearance.test.ts`, `tests/render/rideSeat.test.ts`.

## Rules (world units, 1 tile = 10 m)
| What | Value | Where |
|---|---|---|
| Free air under the carrier above trees / roofs / other lift structures | `OBSTACLE_MARGIN` **0.3** (solver adds 0.04 sampling slack) | LiftClearance |
| Carrier bottom below the cable (`LiftParams.drop`, measured from the carrier meshes) | T-bar 0.65, chairs 0.6, gondola6 0.95, gondola10 1.0, cable car 1.0 | Lift (`tests` keep it >= mesh bbox) |
| Terrain: cable >= max(old `minClearance`, `drop` + 0.05) above the highest ground under centre line **and both strands** (T-bar exempt: it drags on the snow) | `terrainClearance(kind)`, `TERRAIN_CARRIER_MARGIN` 0.05 | Lift |
| Carrier envelope: strands at +-0.3 (`STRAND_OFFSET`), carrier half width `CARRIER_HALF` 0.25 | | |
| Lane the clear-forest option may cut: trees within `LANE_HALF` **1.8** of the line (1.5 tiles of strand reach + the widest crown 1.15 + carrier) | | LiftClearance |
| Obstacles within `STATION_SKIP` 1.2 of a station centre are ignored (the footprint is cleared) | | |
| Station approach: trees under the first / last `STATION_APPROACH` **6** tiles are **always cut** (and charged), even with the lane option off - a cable cannot climb over a forest edge at a station | | |
| Buildings: roof must be below `BUILDING_OVERFLY_MAX` **2.0** above ground (chalet 1.9, shop 1.2, cafe 1.45 ok; lodge 2.8, apartment 2.95 never), then the usual margin applies. Reason: `Cable would hit Base Lodge` | | config/buildingHeights |
| Other lifts: a tower head (+0.3) or a station roof (head + 0.7) under the line is an obstacle: `Cable would hit a lift tower` | | |

### Canopy data
`CANOPY[kind] = { height, radius }` at scale 1 (conifer 2.35 / 0.55, pine 2.55 / 0.46, larch 2.4 / 0.38, birch 1.85 / 0.33, oak 1.4 / 0.75, deciduous 1.5 / 0.5, snag 1.75 / 0.37, shrub 0.46 / 0.34), times the prop's `scale` (0.7..1.5). Decisions always use the **mature** height (`matureCanopyHeight`): saplings are small today but would grow into the cable. `treeCanopyHeight(kind, scale, born, day)` is the growth-aware helper. Rocks are ignored (below the terrain clearance). A test asserts the table >= the full tree meshes' bounding boxes (and within 0.1); another asserts `BUILDING_HEIGHT` >= every building mesh bbox (within 0.15) and `drop` >= every carrier mesh bottom.

### Obstacle map
`TreeMap` (`treeMapFor(props)`): per tile the highest canopy top (absolute y), the ground height at build time (so terraforming under existing trees shifts it) and the widest crown. It is **lazily maintained**: `sync()` rebuilds only prop chunks whose `chunkVersion` / array identity changed. A query tests the tiles that could reach a point (a tree may stand anywhere in its tile, so it is conservative). `validateLift` costs ~0.8 ms on a forested 256 map (test: <= 6 ms).

## Solver
1. Try the line with terrain + trees + buildings (denser towers, taller heads up to the per-kind maximum; tower sites avoid tree tiles when possible).
2. If that fails: retry without trees. If it works the **trees** are the blocker: with `clearLane` (default ON) the final cable is checked tree by tree (`planLane`, exact geometry over both strands, 0.1 steps) and the trees it would hit are cut - **only** trees within `LANE_HALF` of the line; the preview shows `Clears 34 trees under the line ($X)` and the net cost (clearing $6 per tree, minus $5 timber for mature ones, times the construction multiplier) is part of the lift cost. With the option OFF: `Cable would pass through trees: raise towers or clear a lane (enable "Clear forest lane")`.
3. If it still fails without trees, the first building / lift structure under the line is named (`Cable would hit Chalet`); otherwise the old terrain reasons apply.
4. A solution whose steepest section exceeds the kind's local gradient limit retries with denser towers before giving up.

`placeLift(env, props, kind, bottom, top, autoFlatten, clearLane)` applies the lane first (indices refer to the validated store), then clears the station / tower footprints, re-validating after the levelling. Lane trees are removed from the `PropStore` (renderer refresh through `touchedChunks`; forest cover is recomputed). Undo restores them (the undo delta already covers the bounding box of the line). UI: **Clear forest lane (L)** checkbox next to Auto-flatten in the Lifts drawer (`LiftTool.clearLane`).

## Tower height caps
Tower height = head - ground at its foot (world units, 1 = 10 m). `LIFT_PARAMS`: `maxTowerHeight` (hard), `softTowerHeight`, `spanRatio`.
| kind | hard cap | soft | span ratio (x longer adjacent span, floor `minTowerHeight + 0.6`) | was |
|---|---|---|---|---|
| T-bar | 3.5 | 2.2 | 1.0 | 4 |
| chairs | 5 | 3 | 1.0 | 6 |
| gondolas | 6 | 3.8 | 1.0 | 7 |
| cable car | 10 | 7 | 0.7 | 12 |
`solve()` walks `TOWER_DENSITY_STEPS` and stops at the first layout whose tallest tower is <= soft; otherwise it keeps the feasible layout with the lowest tallest tower (ties: fewer towers). A layout over a hard cap is a failed attempt and the next denser step is tried; when all fail: `Towers would need to be N m tall (max M m): shorten the span, clear the forest lane or pick another route` (with trees in the way the usual tree fallback / lane clearing applies first). Tower meshes: `towerThickness(h)` thickens poles / legs / braces above 24 m (x1.0..1.7). Visual check (real screenshots, 128 map, forest): the 100 m cable-car lattice, the 60 m gondola mast, chair poles and T-bar poles read as sturdy, correctly proportioned towers at default and close zoom (no needles, crossarms / sheaves in scale, footing sits on the slope) and from the ride-along seat; no mesh change was needed. Tests: `tests/sim/LiftTowerHeight.test.ts`; measure with `npx vitest run tests/perf/liftHeights.test.ts` and `tests/perf/liftRates.test.ts`.

Measured (20 seeds x 64/128/256, forest): tower height p50 / p90 / max, before -> after (lane ON): T-bar 1.45/3.42/4.0 -> 1.39/2.88/3.5; chair4 2.40/5.65/6.0 -> 2.11/4.14/5.0; gondola6 4.06/6.69/7.0 -> 3.12/4.86/6.0; cable car 9.43/11.48/12 -> 5.85/8.75/10. Success (2400 routes/kind) before -> after: no props / lane ON / lane OFF: T-bar 88.4/88.0/16.6 -> 85.9/85.9/13.5; chair4 93.3/92.8/29.2 -> 90.2/90.2/16.5; gondola6 92.9/92.8/35.8 -> 90.8/90.8/19.7; cable car 91.4/91.4/79.4 -> 89.7/89.7/44.0 (funicular unchanged). Lane OFF drops most because forests needed the tall heads; that mode is mostly refused by design and now says why.

## Planting near a line
`liftPlantBlocker(lifts, grid)` -> `PlantEnv.liftBlocks`: the Plant tool skips any tree whose **mature** crown would reach a carrier of an existing lift (tooltip `Blocked: trees would grow into a lift cable`). Trees that already exist next to old lifts are not touched.

## Old saves
Lift records are unchanged; nothing is re-validated on load. Terraforming near a lift still uses the old terrain-only `liftClearanceViolations` (old `minClearance`), so lifts built before this change stay editable around. Not done: a "Trees touching the cable" warning in the inspector, and terraforming-under-forest checks.

## Success rates (tests/perf/liftSampler, 20 seeds x 64/128/256, 40 routes per kind, 2400 routes/kind)
| kind | before (terrain only, HEAD) | after, no props | forest, lane ON | forest, lane OFF |
|---|---|---|---|---|
| T-bar | 91.7 % | 91.9 % | 91.3 % | 18.3 % |
| Chair 4 | 95.0 % | 94.9 % | 94.5 % | 31.3 % |
| Gondola 6 | 95.9 % | 95.7 % | 95.5 % | 38.7 % |
| Cable car | 95.5 % | 95.2 % | 95.3 % | 83.5 % |
| Funicular | 96.6 % | 96.6 % | 96.6 % | 96.6 % (ground track, unchanged) |

Lane ON keeps the previous thresholds (`tests/sim/LiftSuccess.test.ts` is unchanged and still terrain-only). Lane OFF is mostly refused in dense forest by design: a chair would need heads of tree height + 0.9 along the whole line.

## Tuning
Margins / lane width / approach length are the constants above. Raise `OBSTACLE_MARGIN` for more air, `STATION_APPROACH` to cut more at stations, `BUILDING_OVERFLY_MAX` to let cables over taller roofs. Keep `CANOPY` / `BUILDING_HEIGHT` / `drop` in sync with the meshes (tests fail otherwise).
