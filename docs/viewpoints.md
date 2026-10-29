# Viewpoint system (Phase 6, Task 6)

A reusable system, not a building. The suspension footbridge on a hiking trail is a viewpoint too, fed through `Decider.bridgeViews` (not a building; docs/bridges.md). Any catalog entry that sets `BuildingDef.viewpoint` (`ViewpointSpec`, `src/config/viewpoints.ts`) becomes a hiking destination, a short happiness boost and a photo-mode spot. The Viewpoint platform, the Treehouse (M6.3 Task 22) and the suspension footbridge (Task 46) only have to set that field. **No building is in the catalog yet** (the tests inject temporary defs); no per-id logic exists in placement or guest code (a test greps for it).

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
