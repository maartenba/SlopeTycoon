# Sled runs, Alpine Coaster and the Sledder (Phase 7, M7.3)

Player guide: `site/guide/sled-runs.md`. Tour system: `docs/tours.md`, `docs/winter-tours.md`. Guest types: `docs/guest-types.md` ("Sledder").

## 1. Audit: what "sled" meant before M7.3
| Where | What | Decision |
|---|---|---|
| `src/sim/ops/Patrol.ts`, `IncidentView`, `render/chase.ts` | the patrol **rescue sled** (akja) that carries an injured guest down | internals unchanged. Player text always says "rescue sled" / "the patrol brings the guest down", never "sled" alone |
| `sleighStable` (`config/tours.ts`) | a horse-drawn **sleigh** tour on road / footpath tiles | stays a "Sleigh". The word "sled" is reserved for the toboggan |
| `world/Runs.ts`, `sim/Runs.ts` | **pistes as runs** (named ski runs) | unrelated; sled runs are NOT `Runs` (no grooming, no per-run open state) |
| `Layer` bits (`world/Networks.ts`) | Ski 1, Mtb 2, Hike 4, Backcountry 8 | new bits `Sled` 16, `Coaster` 32 |
Naming in the UI: **Sled run** (the painted track, Pistes drawer), **Sled Rental** (the hut), **Alpine coaster** / **Alpine Coaster station**, **Sledder** (the guest type).

## 2. Design (what shipped)
* **A track is two new paintable layers** in the existing `Networks.layers` byte array (`Layer.Sled = 16`, `Layer.Coaster = 32`). That gives painting, undo / redo, bulldoze, erase, the dirty / version epoch and the save for free. **No save-format bump and no migration**: `layers` is saved byte for byte, and an old save simply has neither bit (`tests/sim/attractions/sledRuns.test.ts` "Layer bits survive a save"; `SAVE_FORMAT_VERSION` unchanged).
* A run is an **8-connected component** of the layer (`world/SledRuns.ts`, `sledRuns()`; derived, nothing extra saved). Verdict (`judgeTiles`): any tile steeper than `SLED.maxSteep` (sled 2.0 half-steps / tile = a red piste, coaster 2.6) = unsafe ("Too steep for sleds"); a run of 8+ tiles whose mean steepness is under `SLED.minMeanSteep` (sled 0.3, coaster 0) = "Too flat: sleds stop". Steepness is `Grid.steepness`, so "downhill only / monotone descent" is not enforced tile by tile: the guard is the gradient band (a hill with a dip still works; documented choice, the plan's "monotone descent" was dropped because the ride is out and back and the player draws it up from the hut).
* **Painting rules** (`Networks.canPaint`, `PisteTool`): one tile wide, must be anchored (hut, path, road, lift station or an existing run: `strokeAnchored`), never on water / streams / buildings, never on a **piste, MTB / hike trail or backcountry route, and vice versa** (`A sled run cannot cross a piste or a trail` / `A sled run is in the way`). Footpaths and roads may cross a sled tile (the tile keeps both). A stroke with a too-steep tile is refused in the tool with the reason. Cost: sled $22 / tile, coaster $85 / tile (`config/sled.ts`; `multiplier` applies). Dock: the two items sit in the **Pistes** drawer next to the trails (a separate Recreation entry was not worth a new drawer).
* **The hut / station is a tour base** (`config/tours.ts`: `sledRental`, `alpineCoaster`; route kinds `'sled'` / `'coaster'`). The generic planner finds the route = the shortest path along the layer tiles touching the base to the farthest tile. So queues, departure slots, seats, ticket, revenue, closures, the inspector, the `tours` save module and the carrier render are all the existing, tested tour machinery.

| | Sled Rental | Alpine Coaster |
|---|---|---|
| Building | `sledRental` 3x2, $4,200, upkeep $14 / day, 1 staff | `alpineCoaster` 4x3, $38,000, upkeep $60 / day, 2 staff |
| Access | path (alt road) | road (alt path) |
| Unlock (Career) | level 2 | level 3 |
| Track | `Layer.Sled`, 8-60 tiles, $22 / tile | `Layer.Coaster`, 10-70 tiles, $85 / tile |
| Season | winter, needs snow (`needs: ['snow']`) | summer |
| Ticket | $12 (max $25) | $18 (max $35) |
| Schedule | every 1 h, 10:00-16:00, ride 1.2 h, 8 seats, leaves with 1 rider | every 1 h, 10:00-17:00, ride 1.0 h, 12 seats |
| Closures | out of season, route cut / run unsafe ("Closed: Too steep for sleds ..."), wind > 0.7, instability > 0.8 | out of season, route cut / unsafe, wind > 0.6 |
| Vehicle | `sledGeometry` (4 per departure) | `coasterGeometry` (4 per departure, on the rail at `COASTER_RAIL` = 0.34) |
| Appeal (solo, couple, family, vip, budget, adventure) | .45 / .8 / 1.0 / .25 / .9 / .5 | .7 / .7 / .8 / .45 / .5 / 1.0 |

* **Lifts that carry sleds** (`LiftDef.carriesSleds`, derived in `mk()`): gondolas, cable cars and detachable chairs (`midStations` rule). When an **open** such lift has its bottom station within `SLED.liftReach` (3) tiles of one end of the route and its top station within 3 tiles of the other end, `TourSystem.duration()` shortens a sled ride to `SLED.liftTimeMult` (0.5) of the base (`TourSystem.liftServed()`; inspector line). Without one the ride includes the walk up (the full 1.2 h): less throughput, so less revenue, but the hut works. The plan's "lower appeal without a lift" was NOT implemented (appeal stays a static spec number); the throughput halving is the penalty. The Lift info card shows `Sleds: yes / no`.
* **Safety**: only minor mishaps (`mishap` 0.4 % / 0.3 % per rider, the existing climbing-crag mechanism: a patrol call-out, a minor injury incident, nobody dies).
* **Night**: the schedule stops at 16:00 / 17:00 and there is no floodlight, so nothing runs at night. The optional "Floodlights" upgrade from the plan is **deferred** (backlog).
* **Render** (`render/SledRunView.ts`): one merged lit mesh for all runs and rails (one draw call), rebuilt only when `networks.version` or the terrain changes, heights from `surfaceHeightAt` (+0.03 bank, +0.05 lane), orange marker stakes every 3 tiles; the coaster is two steel rails + cross-ties + posts at `COASTER_RAIL`. No terrain-shader change (flicker-safe, no new material kind). Huts: `render/meshes/buildings/sled.ts`.
* **Advisor** `tour.sled` (info, winter, 40+ guests, a base lodge, none built; a Buildings-drawer hint). Coaster: `OPTIONAL_EXTRAS` in the contract test (nothing requires it).

## 3. Guest types
**Sledder** (type index 12, appended last): winter 0.06 / summer 0.04 arrival weight, level 2, gate by the pseudo conditions `@sledRun` (an OPEN Sled Rental: season, snow, wind and route all pass) in winter and `@coaster` in summer (computed in `Spawner.flagsFn`), segment `budget`, fallback `couple`, group 2-5, budget $90-190, beginners, appeal sled hut / coaster 1.5, terrace / cafe 0.8, restaurant 0.7, no rental / stunt, orange jackets + bobble hats. **Everybody else rides too** through the tour appeal columns (the family column is the highest of the core types, solo .45, couple .8, budget .9, adventure .5; seniors read `tour` 1.3, school groups and boarders their fallback columns); `tests/sim/attractions/sledRuns.test.ts` asserts the appeal for each type. The Sledder is an ADDITION to the arrival mix (like the Senior), see "Goldens" below.

## 4. Decisions (owner, 2026-10-31) and open items
* D7-5 resolved: a NEW Sledder type AND the other types also use it. D7-6 resolved: the alpine coaster ships in M7.3.
* Deferred: floodlights, a separate parallel walk-up footpath, "lower appeal without a lift", marked crossings of pistes (a sled run simply may not cross a piste or trail), monotone-descent validation, a Recreation-tab dock entry for the tracks.
* Open for the human playtest (`docs/playtest-m73.md`): is the gentle band (0.3-2.0 half-steps) right on real hills, is $12 / $18 a good ticket, do the sleds read in the iso view, do runs behave at the village.

## 5. Tests and tools
`tests/sim/attractions/sledRuns.test.ts` (data, layers, validation, route, revenue, closures, the lift, determinism, save, coaster, Sledder, advisor), `tests/build/sledTool.test.ts`, `tests/render/sledRunView.test.ts`, `tests/render/tourVehicles.test.ts`, `tests/repo/buildingContract.test.ts` (both buildings + the Sledder row pass). Real-page story: `npm run sled:sanity [-- --shots 1]`.
