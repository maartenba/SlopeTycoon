# Rivers and springs (Phase 6, M6.2)

Developer notes for dug rivers and spring sites. Status: **data model + planner + saves + spring sites** (Tasks 13 and 44). The Landscape-drawer tool (Task 14), flow model (15), rendering (16) and ice (17) build on this; nothing here has a UI yet. Owner decisions: rivers are **1 tile wide**, carved **at most 6 half-steps per tile**, **no upkeep**; a spring costs **$250**.

## Model

- `src/world/Rivers.ts` — `Rivers` store: `rivers: RiverRec[]` (`path`, `level[]`, `source`, `sink`, `end`, `carved[]`, `cost`), `springs` (player-placed), `natural` (derived overlay), `version`, `onChange`. `createSim` builds it as `sim.rivers`; `sim.riverEnv()` returns the planner environment (lakes + ponds, network layers, lift clearance, construction multiplier, props).
- A river is a polyline of 4-connected tiles. Committed tiles become `TileType.Stream` + `OccFlag.Water`, exactly like natural streams, so everything that already treats streams as water works unchanged: buildings are refused (`Cannot build on a stream`), the hydro rule sees a stream bank, pistes are refused (`PISTE_WATER_MSG`), rail cannot cross, paths and trails bridge them.
- `waterways(natural, dug)` in `Streams.ts` is the one read model (`{ id: 'n0' | 'r1', kind, path, level, end }`). Flow `Q`, speed and the flow class are layered on it by Task 15.
- **Carved heights live in the saved `grid` module** (heights, tile types, occupancy). The `rivers` module keeps the records + the exact corner diff (`carved: { v, from, to }`) so a river can be filled back in. It is `omitWhenNull`: `serialize()` is `null` while there are no rivers and no player springs, so saves and `stateHash` of every world without them are byte-identical to before (no new flag needed; nothing exists until the player digs).

## RiverPlanner (`src/world/RiverPlanner.ts`, pure)

`planRiver(env, from, to?) -> RiverPlan` (the grid is unchanged on return), `applyRiver(env, rivers, plan)`, `planFillRiver` / `applyFillRiver`.

- **Source** (`from`, a dry tile): a spring (`env.isSpring`, natural site or placed spring) → the river starts on the spring tile; a tile 4-adjacent to a lake (outlet) or a stream (branch); otherwise `A river needs a source…`.
- **Sink** (`to`): a lake or pond tile, a stream / river tile (merge; the mouth must be at or above its level), a map-edge tile; omitted = the cheapest of any of them. A dry inland tile is refused.
- **Search**: A* over dry, free tiles; cost = 1 per tile + 3 per carved half-step (`RIVER.carveWeight`). A tile whose ground is above the running channel level is carved: ONE corner is lowered to the running level, never one that touches other water. Hard limits: carve ≤ 6 per tile (`RIVER.maxCarve`), ≤ 400 tiles, ≥ 3 tiles, 40 000 expansions. Tiles beside foreign water are only allowed as the mouth. Buildings, lifts, roads, rail, paths, pistes and decor (any occupancy / network layer) are never entered.
- **Preview** = the real `setCorners` terraform (edge ripple ≤ 2, lift clearance hook, water / occupancy veto) rolled back, then verified on the real heights: levels never rise, the mouth is not below the sink, per-tile cut ≤ 6, the lake rim invariant (`water ≤ level ≤ non-water neighbours`) still holds.
- **Output**: `path`, `level[]`, `carveDepth[]` (heat), `maxCarve`, `changed[]` (corners incl. ripple), `cost = earthCost + tiles x $30` (earthworks at the terrain price per half-step x construction multiplier), `rect` (changed bbox for undo), `reasons[]` (all found) and `reason` (first). Reasons: `Water can't flow uphill here`, `Too deep to dig (max 6 per tile)`, `Blocked by a building, lift, rail, path or other water`, `Digging here would break a lift cable clearance`, `…drain or break a lake bank`, plus endpoint messages (`REASON`). When the strict search fails the planner re-searches without the carve limit and without blockers to say *why*.
- Perf: a plan on a 256 map takes ~0.1 ms for a short river; the node cap bounds the worst case.
- `applyRiver` carves with `setCorners`, clears props in the channel (not counted as felled), marks tiles, records the diff. `applyFillRiver` raises corners back (only those still at their carved height), restores grass, refund 0; refused while another river flows into / branches off this one.
- **Undo**: `Undo.riverStroke(label).stamp(plan.rect, run)` — one step, snapshot style (heights, props, tile types, occupancy, the `Rivers` list), like landscaping strokes. Needs `rivers` in the `UndoEnv` (`sim` has it).

## Spring sites (`src/world/SpringSites.ts`) and player springs

- `deriveSpringSites(grid, { lakes, streams, villageAnchor }, seed)` runs in `createSim` right after `generateTerrain` (so on the pristine generated map, also when loading a save) with **its own RNG** (`new Rng(hash32(seed, 0x5052494e))`); it never writes heights, tile types, occupancy or streams, is **not saved and not in `stateHash`**, and returns 0-3 sites (`SPRING.naturalMin/Max`). `springSitesVersion = 1` (`SPRING.sitesVersion`) is written into the `rivers` module when it exists.
- Candidate: dry (not water / stream / ice), unoccupied, ≥ 2 strictly higher 4-neighbours (`springGroundOk`), 2-6 tiles from a lake tile or a stream head, ≥ 3 tiles from the edge, away from the village and the road / rail corridor; scored by height above the water (capped), ≥ 10 tiles apart. Measured: a site on 60/60 maps (seeds 1-30 x 64 / 128).
- A natural site gives **no water** until a river is dug from it; it stays a valid source while its tile is dry and free (building on it retires it for the planner).
- **Player springs**: `planSpring` / `applySpring` — dry, unoccupied, ≥ 2 higher neighbours; fee `SPRING.cost` ($250 x construction multiplier, **the caller charges it**, e.g. `economy.charge(plan.cost)` as the other Landscape tools do); the tile is marked `OccFlag.Decor` so nothing is built there; saved in `rivers.springs`; `planRemoveSpring` / `applyRemoveSpring` bulldoze it (refund 0), refused while a river starts there. A river from a spring converts the spring tile itself to stream; filling the river back in restores the marker.

## Tests

`tests/world/riverPlanner.test.ts` (synthetic slopes: fall line, ridge carve, deep refusal, uphill, blockers, detour, endpoints, merge, lake outlet / sink, branch, lift veto, fill-in; seeds 61 / 7 / 5 on 128: spring → lake; `[perf]` 256), `tests/world/springSites.test.ts` (determinism, no writes, rule, ≥ 90 % coverage, inert hash, player springs), `tests/world/terrainGolden.test.ts` (**byte-identical terrain for seeds 1-20 x 64 / 128 / 256**, recorded before this work, also after deriving sites), `tests/persist/rivers.test.ts` (save / load / in-place hash equality, old saves, undo / redo).

## Not yet (later tasks)

Tool + preview + spring placement UI (14), flow `Q` / speed (15), Water.ts rendering of dug rivers and spring markers (16), ice (17), river bridges + suspension footbridge (46), rafting / canyoning, snowmaking from rivers, sustainability bonus.
