# Viewpoint system (Phase 6, Task 6)

A reusable system, not a building. The suspension footbridge on a hiking trail is a viewpoint too, fed through `Decider.bridgeViews` (not a building; docs/bridges.md). Any catalog entry that sets `BuildingDef.viewpoint` (`ViewpointSpec`, `src/config/viewpoints.ts`) becomes a hiking destination, a short happiness boost and a photo-mode spot. The Viewpoint platform and the Treehouse (Task 21, see "Content" below) and the suspension footbridge (Task 46) only had to set that field. No per-id logic exists in placement or guest code (a test greps for it).

## View score (`src/sim/attractions/Viewpoint.ts`)
`viewScore` in 0..1 = (share of tiles in a disc of `VIEWPOINT.radius` = 12 tiles that lie at least `lowerMargin` below the site) x (relative altitude of the site on the map). A summit sees almost everything below it (0.8+), a ridge shoulder about half, a pit or flat ground scores 0. Pure and deterministic; `Viewpoints.refresh` caches it per nav epoch (and building set), so it costs nothing per tick. `openDirection` = the direction in which the ground falls away (photo spot look direction).

## Hiker goals (`TrailGoals`)
* `Decider.refresh` collects buildings with `def.viewpoint` (`viewSites`); `TrailGoals.build(..., views)` adds one POI (`kind 4`, `view` = score x `spec.weight`) per viewpoint on the nearest snow-free hike tile within `trailReach` (6) tiles, like huts. No trail near it = no POI.
* Goal score: `+ VIEWPOINT.poiBonus (0.55) x view` (hut +0.3, summit +0.35). The normal top-third pull still applies by altitude, so a **high** viewpoint on a ridge competes with the summit and a low or poor one hardly matters, as in reality.
* The POI cap (`TRAIL_GOALS.maxPois` 90) is kept: viewpoint POIs always survive the trimming (at most `maxKept` 8), the other POIs are sampled from the rest.
* Probe (`buildHikingResort(64, 11)`, 6 summer days, ridge viewpoint with score 0.79 at relative altitude 0.7-0.9): 47 of 143 goal picks (33%) and 9 completed visits; the same resort without it: 0. A mid-height viewpoint (score 0.4, rel 0.5) gets 0 picks: the summit pull wins. Place it high.

## Dwell, effect and counters
* Excursion stop at the goal grows by `dwellH (0.25 h) x min(1, 0.4 + score)` (`ExcHost.viewDwellH`; `Exc.S` is already saved, no save change).
* On arrival (`ExcHost.viewed`): happiness `+ 0.12 x score`, +1 visit; `Viewpoints.visits` per building (observer data, not saved, resets on load).
* Nothing changes when no viewpoint exists: all hooks are absent / return 0, goldens are untouched.

## Forest site rule (treehouse)
`SiteRule.forest = { minTrees, radius, keepTrees? }` (`PlaceBuilding.validatePlacement`, data-driven): at least `minTrees` real trees (`TREE_KINDS`, no shrubs) within `radius` tiles of the footprint, else the reason `Needs forest around it` with a hint ("pick a spot with at least N trees within R tiles (k here)"). `keepTrees` (default true): the footprint and its surroundings are **not** felled when placing and no "Trees will be cleared" note shows. Auto-flatten is a def choice (`autoFlatten: 'never'`). `FOREST_SITE` in the config has the proposed defaults (6 trees within 3 tiles). Without props in the env (old tests) the rule passes.

## Photo mode
`PhotoModeDeps.spots()` (main.ts `viewpointSpots`: active viewpoint buildings with `spec.photo !== false`) feeds `PhotoMode.nextSpot()` and the **Viewpoint** button in the Photo panel (only shown when there are spots): the camera stands just in front of the building (`reach`) and looks out over the falling ground (`viewpointState`). Harness: `__slope.view.photo.enter(); __slope.view.photo.spot()`.

## Knobs
`VIEWPOINT` (`radius`, `poiBonus`, `maxKept`, `dwellH`, `happiness`, `trailReach`, `lowerMargin`, `photoDist/Lift/Pitch`), `FOREST_SITE`, per building `ViewpointSpec` (`radius`, `weight`, `dwellH`, `photo`).

Tests: `tests/sim/attractions/viewpoint.test.ts`.

## Content (Phase 6 Task 21)
| | Viewpoint | Treehouse |
|---|---|---|
| Catalog | `viewpoint`, recreation, 2 x 2, $1,500, upkeep $2/day, no staff, **never gated** (level 1) | `treehouse`, recreation, 2 x 2, $2,500, upkeep $4/day, no staff, **level 2** (`UNLOCKS`) |
| Access | hiking trail, alt footpath, alt piste edge (`pisteRule edge`) | hiking trail, alt footpath |
| Site | slope <= 3, flatten optional, rock allowed; no forest rule: a ridge platform | slope <= 2, **never flattened**, `forest: { minTrees 6, radius 3, keepTrees }` (refused in a meadow with "Needs forest around it"; the trees stay) |
| `viewpoint` spec | `{}` (weight 1, photo spot) | `{ weight: 0.8 }` (a slightly weaker pull than a ridge platform, a hiker and family favourite) |
| Mesh | `render/meshes/viewpoint.ts`, about 530 triangles: footings, plank deck, railing on three sides, telescope on a pedestal, bench, VIEW signpost, flag, step | `render/meshes/treehouse.ts`, about 800 triangles: trunk with root flare, plank deck, timber cabin with a mossy gable roof + lit window (glass colour glows at night), rope ladder, sagging rope bridge to a second little platform, thin crowns; 1.97 tall, under the cable overfly limit |

Both are plain hiker destinations: no ticket, no attraction spec, no staff, no sustainability hook (a 2 x 2 building among thousands of habitat tiles moves the score by less than 0.05; a test measures it). They appear in the **Recreation** tab, as photo-mode spots (the **Viewpoint** button of the Photo panel) and in the hiker goal choice by view score. A one-shot hint (`view.photo`, info tier, respects the Hints setting) tells the player about the photo spot after the first one is placed.

### Bonus goal "A viewpoint on the heights"
`BONUS_GOALS` (`config/goals.ts`): optional goals that are **not part of the 20-goal chain**, never fill one of the three active slots and never block a chapter. The engine (`Goals`) checks them hourly; the first time one is met it pays its grant ($2,500) and shows a quiet milestone. They are saved as `bonus` in the goals module only once one is done, so a world without any hashes exactly as before. The goal is met by an active viewpoint whose centre is at least `VIEWPOINT_GOAL_ALT` (0.6) of the way up the mountain (`GoalWorld.altFrac`).
The plan asked for "above 2,000 m": that altitude does not exist (the highest ground is about 1,390 m on a 64 map, 1,500 m on 128 and 1,700 m on 256), so the threshold is relative.

Tests: `tests/sim/attractions/viewpointContent.test.ts` (catalog rows, meshes, the hint, meadow refusal / forest acceptance with trees kept, a real ridge viewpoint chosen by hikers and deterministic, the bonus goal in a fixture and in a real sim incl. save / load, sustainability neutral).

**Treehouse seat (visual fix)**: a sloped 2x2 used to be seated on the highest corner with a plain stone retaining skirt down to the lowest one (up to 2 units tall, grey). The mesh entry is now `rooted` (`BuilderEntry.rooted`): `rootedSeatOf` seats it at the middle of the footprint's corner range and the treehouse mesh grows its trunks down to the lowest corner (`depth` is passed to the builder); no stone layer. Other buildings keep the skirt. Test: `tests/render/treehouseSeat.test.ts`.
