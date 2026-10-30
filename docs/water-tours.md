# Water tours: rafting and canyoning (Phase 6 Task 24)

Two catalogue tours on the generic tour system (`docs/tours.md`) that follow a **waterway** (a natural stream or a dug river, `waterways()` in `world/Streams.ts`, flow classes from `docs/rivers.md`) downstream instead of a road: the Rafting Base and the Canyoning Base.

| | Rafting Base | Canyoning Base |
|---|---|---|
| Building | `raftingBase`, 3x2, recreation, $5,500, upkeep $22 / day, 2 staff | `canyoningBase`, 2x2, recreation, $4,800, upkeep $18 / day, 2 staff |
| Unlock | Career level 3 (selective; no goal, tutorial step or Advisor `build` action needs it) | Career level 3 |
| Access | `road`, alt `path` | `trail`, alt `path` |
| Ticket | $30 (max $60; D-P8 range $15-60) | $35 (max $60) |
| Season / schedule | summer; 10:00-16:00 every 2 h; 2 riders minimum | summer; 10:00-15:00 every 3 h; 2 riders minimum |
| Seats | 8 per departure (2 rafts x 4) | 6 per departure (3 canyoners in the view) |
| Ride | 1.4 h downstream, then a shuttle brings the guests back (the ride is one way) | 1.8 h downstream |
| Route | 12-40 tiles, brisk (or rapids) flow on **6+ tiles** | 8-30 tiles, **5+ steep tiles** (drop >= 1 half-step per tile) and a **gorge** (6+ rock / steep-bank tiles within 2 tiles of the route) at **any** flow |
| Closures | out of season, wind > 0.7 (storm), river frozen, **late-summer low water**, route gone (river filled in) | same |
| Appeal | adventure 1.0, solo .5, couples .45, family .35, vip .3, budget .2 | adventure 1.0, solo .6, couples .35, vip .1, budget .25, family .05 |

## Route planner (`sim/attractions/WaterTour.ts`, pure)

`planWaterRoute(env, footprint, def, size, nominal?)`:

1. **Put-in**: every waterway tile within `water.putIn` (3) tiles (Chebyshev) of the footprint is a candidate.
2. **Slice**: from the put-in downstream (waterway paths run source to sink) up to `maxLen` tiles, trimmed to the **last qualifying tile + `tail`** (the take-out), extended to `minLen` when that is shorter. A candidate needs enough qualifying tiles (`flow.minTiles` tiles of class >= `minClass`; `steep.minTiles` tiles with drop >= `minDrop`) and, for canyoning, the gorge count.
3. **Best candidate**: most qualifying tiles, then most rapids tiles, then the closest, then the lowest waterway id / index. Deterministic, no Rng, nothing saved.
4. **Result**: `tiles` (tile indices, stored as the tour route), `info` (good / rapids / steep / gorge tiles, max class, a cumulative **ride clock** and the flow class per tile) or a `reason` + `detail` (`Needs a river or stream with brisk flow within 3 tiles` + `only 3 of 6 brisk tiles downstream`, ...).

`dropAt` = half-steps of drop per tile over a +-1 tile window (the same `level[]` the flow model uses). A gorge tile is a Rock tile or any dry tile whose four corners spread >= 2 half-steps (a steep bank).

### Nominal vs current flow

* **Placement** (`SiteRule.nearWaterway`, `PlacementEnv.waterSite`) judges the **nominal** flow (season factor 1, never frozen), so a base is never refused for a dry August or a winter. Reason: *Needs a river or stream with brisk flow within 3 tiles* (rafting) / *Needs a steep stream through rock within 3 tiles* (canyoning); hint: what is missing (`only N of M brisk tiles downstream`, `no river or stream within 3 tiles of the base`, `only N of 6 rock wall tiles ...`). A valid site says *Water in reach: 11 brisk tiles, 2 rapids over 12 tiles*.
* **Running** the tour uses the **current** flow table (`FlowModel.get`): Aug / Sep x0.7 can take the brisk tiles below the requirement. The tour then closes with *Closed: the water runs low right now: only 3 of 6 brisk tiles downstream* (the nominal plan would pass) and reopens when the month turns. The plan is re-made when `rivers.version`, the month or the ice change (`WaterEnv.version()`), not per tick.
* **Frozen** (`TourDeps.frozen`: air temperature at the base <= 0 or `flow.anyDugFrozen()`) is checked first (cached `TOURS.checkEvery` ticks): *Closed: the river is frozen*.

## Thrill, price tolerance, mishaps

* **Thrill** = rapids tiles on the route / `water.thrill.tiles` (6), capped at 1. A rapids run (rafting) adds up to **+0.12 happiness** on return on top of the base 0.16 (`TourSystem.thrillBonus`, applied in `AttractionSystem.release`; exactly +0 for every other attraction) and raises the price the guests find fair by up to **25 %** (`TourSystem.tolerance`, divides the elasticity ratio in `createSim.willBuy`; exactly 1 elsewhere). Canyoning: +0.08 / 15 %. The inspector shows "Flow: rapids, 2 rapids tiles · thrill 33 %" (rafting) or "Steep stream: 5 drop tiles, 44 rock wall tiles".
* **Mishaps**: like the crag, a finished ride rolls a **stateless hash** of (base, guest, tick) (`mishapRoll`; no Rng, nothing saved): 0.4 % guided / 1.2 % unguided for rafting, 0.5 % / 1.5 % for canyoning. A hit reports a **minor injury incident** (patrol / first aid answer; the unattended case follows the usual timeline and ends at worst in hospital); **nobody dies**. `stats.mishaps` is shown as "N minor mishaps so far (the patrol helps)". Skill gate: none (the appeal vector keeps families away from canyoning; every descent is guided).

## Sustainability

Neither tour is motorised: no wildlife scare (`noiseRadius` 0), no sustainability penalty (`sustainPerDeparture` 0, `motorPenalty()` stays 0); the water and its banks are untouched. Rafting is neutral for the score (a small note in the building description).

## View (view only: nothing here is read by the sim)

* **Rafts**: `TourVehicles` draws every raft as one instance (`raftGeometry`: four orange tubes, floor, thwart, four helmeted paddlers in coloured life jackets with paddles, ~320 triangles), two rafts per departure, one behind the other, **one way downstream**. Position follows the route's **ride clock** (time per tile ~ 1 / flow speed), so a raft is quick on fast water. A raft on a rapids tile is handed to the **existing `RapidsSplash`** (`TourVehicles.splashSpots`, at most 8): the total number of splash spots never exceeds `SPLASH.spots` and the puff cap `SPLASH.cap` is unchanged (rafts first, then the evenly spaced rapids tiles).
* **Canyoners**: one instanced mesh (`canyonerGeometry`: wetsuit body, helmet, harness, a rope trailing back up the slope, ~100 triangles), three per departure, pitched along the stream's slope: they appear to abseil / slide down the steep part.
* **Base meshes** (`render/meshes/buildings/waterTours.ts`): the Rafting Base is a timber boathouse with a green roof, a "RAFTING" sign, a raft rack, three coloured rafts on the bank, paddles and life jackets on rails, lamp; the Canyoning Base is a small stone-and-timber hut with a blue roof, a wetsuit rack, helmets, rope coils, dry bags, an anchor post, "CANYONING" sign. Both <= 4 mesh groups (no foundation: the auto-flatten pad is the plinth).

## Advisor

`tour.water` (info, summer, 30+ guests, a base lodge, Rafting Base unlocked and none built): *You have a river with rapids*; fires when any waterway has 6+ brisk-or-better tiles (nominal) and at least one rapids tile. It only opens the Buildings drawer (the item is career-gated; the player picks the spot).

## Availability scan

`npx vite-node scripts/analysis/raftingScan.ts [seeds] [sizes]` counts the **natural** streams (length, drop, brisk and rapids tiles at nominal flow) and the tiles where each base would be **valid** by the real placement rules (no access check). Natural streams are mostly gentle: small maps often have **no** valid rafting site, which is why digging a river matters ("Needs a river with enough flow: dig one in Landscape").

| size | seed | streams (length, drop, brisk+ tiles, rapids) | valid raft spots | valid canyoning spots |
|---|---|---|---|---|
| 64 | 61 | 11t d2 b2 · 16t d0 · 9t d3 b3 · 8t d0 | **0** | 0 |
| 64 | 7 | 9t d1 · 23t d3 b3 · 16t d3 b1 · 8t d0 | **0** | 0 |
| 64 | 5 | 12t d8 b8 r1 · 17t d0 | 5 | 10 |
| 128 | 61 | 21 / 10 / 13 / 21 / 29t, best d7 b1 | **0** | 0 |
| 128 | 7 | 42t d12 b0 · 39t · 14t d4 b3 | **0** | 0 |
| 128 | 5 | 16t d9 b11 · 17t d12 b11 | 94 | 48 |
| 256 | 61 | 5 streams, best 51t d16 b9 | 157 | 115 |
| 256 | 7 | best 107t d30 b21 | 347 | 242 |
| 256 | 5 | 7 streams, best 131t d38 b34 r1 | 382 | 330 |

**On a dug river** (Rafting works on seed 61 / 64, test `waterTour.test.ts`): a spring at (20, 21) with the cheapest outlet gives a 42-tile river (drop 9) with 6 brisk tiles in June / July (just enough), 11 in the April-May snowmelt and 3 in the Aug / Sep low (so the base closes for those two months and reopens), and 5 steep tiles + a 44-tile gorge for canyoning. A spring-fed river on a gentle hillside is borderline for rafting: dig it steeper or from a lake outlet. Spring-fed rivers have Q 1; a lake outlet has Q 2 (sqrt(2) faster) and reaches rapids easily.

## Files

`src/config/tours.ts` (`WaterReq`, `TOUR_DEFS.raftingBase / canyoningBase`), `src/sim/attractions/WaterTour.ts` (planner, env), `Tour.ts` (water routes, frozen / low-water closures, one-way carriers with the ride clock, thrill / tolerance), `AttractionSystem.ts` (thrill hook), `src/sim/PlaceBuilding.ts` + `config/buildings.ts` (`SiteRule.nearWaterway`, `PlacementEnv.waterSite`), `src/game/createSim.ts` (`waterEnv`, `env.waterSite`, tolerance), `src/render/TourVehicles.ts`, `render/Smoke.ts` (splash extras), `render/meshes/buildings/waterTours.ts`, `src/sim/advisor/*`, `scripts/analysis/raftingScan.ts`.

## Tests

`tests/sim/attractions/waterTour.test.ts` (data; pure planner: downstream order, trimming, flow / steep / gorge requirements, put-in reach, length limits, ride clock, determinism; real sim on a dug river on seed 61: placement reason and info, route follows the river, $30 fares / 8 seats / queue, closures for wind, season, ice, low water and a filled-in river, canyoning, thrill and tolerance, carriers one way with splash only on rapids, forced mishap = minor incident and deterministic, save round trip, same-seed hash, advisor), `tests/render/waterTourVehicles.test.ts` (geometry budgets, carriers, splash cap), `tests/sim/advisor*.test.ts` (rule + scenario).

## Re-recorded on purpose

Nothing was re-recorded. Two unlock rows (`building:raftingBase`, `building:canyoningBase`, level 3) move the **`progression` part of the staff golden** in `tests/sim/staff.test.ts` (it moves with every unlock row; left for the milestone STOP). The tours module stays `null` / out of `stateHash` until a tour base exists.
