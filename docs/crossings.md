# Rail level crossings and the rail footbridge

Phase 6 tasks 10 and 11. A footpath or road may cross a straight rail line at a right angle. Guests and cars wait for trains at a **level crossing**; a **footbridge over the rail** lets guests cross without ever waiting. Config: `src/config/crossings.ts`. Sim: `src/sim/RailCrossings.ts`. Data and placement: `src/world/Networks.ts`. Render: `src/render/RailCrossings.ts` (barriers, lamps, bell) and `src/render/meshes/Paths.ts` (`crossingDeck`) and `src/render/meshes/footbridge.ts` (the rail footbridge).

## Owner decisions
- Guests **always wait** at a closed crossing; **trains never stop**.
- The crossing closes shortly before a train arrives (barriers down, bell, blinking red lamps).
- No deaths and no collisions, ever (see "Safety").
- A footbridge over the rail is the alternative (path only, no waiting, a higher price).

## Data (`Networks`)
- `cross: Uint8Array` per tile: `0` none, `1` footpath / trail crossing, `2` road crossing, `3` footbridge over the rail, `4` MTB ramp bridge over the rail. The tile's `kind` stays **Rail** (so trains, `railComp` and rail stations are untouched); `crossCount` counts the tiles (0 = every crossing system is inert).
- Floods: `walkComp` includes a rail tile with `cross >= 1`, `roadComp` with `cross === 2`, `railComp` is unchanged. `pathDistance` walks across crossings.
- `conn` of the path / road tiles next to a crossing gets a bit towards it (`crossJoins`), so the approach arms are drawn into the deck.
- Save: networks module **v2**. `cross` is written only when a crossing exists, so a world without one saves and hashes exactly as before; old saves load with no crossings. `TileSnap.cross` keeps undo / redo exact.

## Placement rule
A path or road stroke over a rail tile (or a rail stroke over a path / road tile) becomes a crossing when:
- the line through the tile is **straight** (conn N-S or E-W exactly) and the stroke runs **perpendicular** to it, with a stroke tile on each side;
- the tile is not part of a building (a Train Station) and not on a bridge / stream;
- no other crossing is within `CROSSING.minSpacing` (2) tiles (Manhattan);
- the slope stays within the lower of the two network limits.

Reasons (exact strings, `CROSS_MSG`): *Paths can only cross a straight rail line at right angles*, *A crossing needs path or road on both sides of the rail*, *Crossings need more room: another crossing is too close*, *Cannot cross rail at a station*, *Cannot cross rail on a bridge*, *Roads cross rails at a level crossing or an overpass, not a footbridge* (`roadOnly`), *Only roads take an overpass* (`pathOnly`), *Cannot build rail under an overpass ramp* (`underRamp`). Every other "building on rail" rule stays; a building never stands on a crossing (`Cannot build on a level crossing`).

Cost: a level crossing is $150 (path) / $400 (road) on top of the new tiles, times the construction multiplier. `Networks.planSegment` returns `crossings[]` and the cost; the tool tooltip reads `Cost: $170 (1 tiles + level crossing: guests wait for trains)`. Bulldozing a crossing tile turns it back into plain rail (the path / road is cut); a second bulldoze removes the rail. Undo restores it.

## Sim (`RailCrossings`)
Pure and deterministic: it reads the train polylines (`Vehicle.pts/cum/dist/speed`) and the networks arrays, owns no saved state and uses no RNG. The Spawner calls `refresh(vehicles)` once per tick right after the vehicles advanced, so guests and cars (moved later in the same tick) see the exact post-advance state.

- **Closed** while a train's nose is within `speed x leadTicks` (4 ticks) tiles of the tile centre, or on / just past it (`nose - trainTailTiles (3) <= centre + 0.5`).
- **Guests** (`NavMovement`): a path step into a closed crossing makes the guest wait at the centre of the approach tile (a guest already past the centre steps back, so family kids glued +-0.25 tiles to the leader stay out too). Nobody picks a crossing tile as a standing goal. The expected wait is part of the path cost (`CROSSING.waitCost`).
- **Cars and buses** (`Spawner.advanceVehicles` -> `holdCar`): stop 0.55 tiles before a closed road crossing and carry on when it opens; arrival routes run over road crossings (`routeOnKind(..., cross)`).
- **Trains**: never slowed. A new train never *appears* inside a crossing's closing window: `spawnDist` shifts its start back (a negative distance = it waits at the rail entry), so the barriers always have `leadTicks` of warning.

### Safety argument
The slowest guest on a path moves 2 tiles/tick (0.5 tick per tile), cars at least 3.75, and `leadTicks` is 4: anyone who entered the tile before it closed has left it long before the nose arrives. The test `tests/sim/railCrossings.test.ts` runs 10 sim-days of a busy footpath crossing and a road crossing and asserts that no guest stands on the tile when a train sweeps it, at the start or the end of a tick (and that no car is on a closed road crossing with the train), non-vacuously (many train passes, waits recorded). Cheap and exact: one lookup per path step, no work at all while `crossCount` is 0.

## Render and sound
- `crossingDeck`: planks (path) / asphalt with the centre line (road) across the rails, draped on `surfaceHeightAt`; approach arms reach into it.
- `RailCrossingsView`: per crossing two posts with a crossbuck, two lamps and a striped boom (about 18 tiny meshes, no lights, unlit lamp materials). Booms lerp over 1 s from the sim's closed state; lamps blink alternately every 0.5 s while closed. No `gl_FragCoord`.
- Bell (`crossingBell`, ambience bus): a quiet double ding about every 0.9 s while closed, gain falls with camera distance (silent beyond 70 tiles).

## Footbridge over rail (Task 11, redesigned 0.2.4)
The **Cross rails** segmented control (Paths & Roads; *Trails over rails* in Pistes & Trails; see bridges.md, Drawer UI) chooses what a stroke does where it meets a rail line: *Level crossing* (default, $150) or *Bridge*. `SegmentTool.crossMode` / `PisteTool.crossMode` (`'level' | 'bridge'`, `NetworkTools.setCrossMode`; the older `overRail` boolean still works), `Networks.planSegment(..., over)`. With the bridge option a footpath stroke across a straight rail tile makes a footbridge instead of a level crossing: the same placement rule and spacing, `cross = 3`, `CROSSING.footbridge.cost` ($900, level crossing $150). The tool tooltip reads `Cost: $920 (2 tiles + footbridge over the rail)`. The tile is walkable (`walkComp`, nav) at the normal walking cost with **no wait cost and no closing**; trains pass underneath. Roads cannot use it (`Roads need a level crossing, not a footbridge`); an underpass is not built (v1). Roads use the overpass instead (below).

- Render (`footbridge.ts`): a raised timber deck on the rail tile (`CROSSING.footbridge.deck` = 1.0 above the surface) with side and hand rails and four posts, plus 5 stairs on each approach tile (`Networks.rampDir`); ~25 flat-shaded boxes, ~300 triangles per bridge, in the chunk network mesh (no extra draw call).
- Guests climb: `Networks.footLift(x, y)` is the fraction of the deck height (1 on the deck, linear along the stairs); `createSim` adds it to `groundAt`, so guests really walk above the train (their z is part of the saved guest state only when such a bridge exists).
- Advisor: `crossing.waits` (info) *Guests wait long at the level crossing*: yesterday's guest-ticks waiting at the worst footpath crossing exceeded `CROSSING.advisorWaitTicksPerDay` (400, 70 % to keep showing); Show me = that crossing.

### Every walkable kind (0.2.4)
| Kind | Level crossing (default) | Bridge option |
|---|---|---|
| Footpath | `Cross.Path`, $150 | footbridge `Cross.Footbridge`, $900, stairs |
| Hiking trail | `Cross.Path`, $150 | the same footbridge, $900, stairs |
| MTB trail | `Cross.Path`, $150 | **MTB ramp bridge** `Cross.MtbBridge` (4), $1,100, `CROSSING.mtbBridge.steps` = 10 fine steps (a ramp; bikes cannot take stairs) |
| Road | `Cross.Road`, $400 | **road overpass** `Cross.Overpass` (5), $900 + $150 per tile (7 or 9 tiles), see *Road overpass* below |

Trail strokes go through `StrokePlan.planTrailStroke` and reuse `crossingCheck` (straight rail, right angle, tile on each side, not at a station / bridge, spacing 2). The rail tile carries the crossing, **not** a trail layer; the approach tiles carry the trail layer and `Networks.rampDir` finds the stairs / ramp direction for them (`crossAxisJoins`, since trail tiles have no connection mask). Before 0.2.4 a trail painted over rail with no crossing at all. A trail on a rail tile is refused with the same reasons as a path (*Paths can only cross a straight rail line at right angles*, ...). A trail crossing a footpath or road simply paints on it (it merges; nothing to build). Hiking trail on an existing footbridge reuses it (free); bulldozing a crossing reverts the tile to plain rail and cuts the trail on it. Level crossings close like path crossings for every guest mode (NavGraph `isCrossing`); footbridge / MTB bridge never close. `footLift` is 1 on both bridge kinds. Render: `footbridgeDeck` for both, `footbridgeStairs` with the step count per kind (`rampTile` in `meshes/Paths.ts`).

## Road overpass (0.3.x)
With **Cross rails = Bridge** a road stroke over a straight rail line builds an overpass instead of a level crossing (`overFor('road', 'bridge') = Cross.Overpass`); the level crossing stays the default. Config `CROSSING.overpass` (`src/config/crossings.ts`): `base` $900, `perTile` $150, `deck` 1.1 world units above the rail surface (a train is ~0.6 tall: 0.5 margin), `ramps` [3, 4] tiles each side (7 or 9 tiles in all), `maxGrade` 0.4 (units of rise per tile, about 1 tile of height over 3-4 tiles).

- **Data**: the rail tile keeps `kind = Rail` and gets `cross = 5` (so `railComp`, trains and stations are untouched; `roadComp`, `crossJoins`, `routeOnKind`, `townPaths` treat 5 like a road crossing). Ramp tiles are ordinary road tiles. `Networks.oid` (Uint16 per tile, 0 none) marks the rail tile and the ramp tiles with the overpass id, `overpassTiles` counts them (0 = every overpass system is inert), records `Overpass { id, x, y, axis, n, top, endA, endB, cost }` in `Networks` (never deleted, so redo can bring one back; live = the rail tile still carries the id, `liveOverpasses()`, `overpassAt(x, y)`). `TileSnap.oid` keeps undo / redo exact. Save: networks module writes `oid` + `overpasses` only when one exists, so a world without one saves and hashes as before.
- **Planner** (`world/Overpasses.ts`, `planOverpass`, called by `planStroke` for every `Cross.Overpass` crossing): the stroke must run straight for `n` tiles on each side of the rail (else *No room for the ramps*); ramp tiles must be free (new road tile or an old plain road; no rail, path, building, water, bridge, other crossing / overpass). It tries 3, then 4 tiles: the first where the gradient to the ground at the ramp ends is <= `maxGrade` and no ground pokes above the ramp (*Too steep* otherwise). Price: `overpassPrice(n) = 900 + 150 x (2n + 1)` x construction multiplier on top of the new road tiles (the base $900 is charged by `crossCost`, the planner adds the rest). Same rules as any crossing: straight rail, right angle, no station, spacing 2.
- **Profile** (`world/OverpassProfile.ts`, `overpassAlong`): flat at `top` over the rail tile (+-0.5), then linear down each ramp to the ground at the far edge of the last ramp tile. `Networks.deckY` returns it, so cars (main's vehicle height), guests and the walk-mode ground use the deck; trains stay on the ground, no collision is possible (different heights; the crossing never closes: `RailCrossings` only closes `Cross.Path` / `Cross.Road`, `holdCar` ignores 5).
- **Tool / UI**: `SegmentTool` (road) passes the Crossings toggle through; the ghost (`Ghost.overpasses`) draws every tile of the overpass at the deck profile (blue ramps, gold rail tile); tooltip `Cost: $3,100 (… + road overpass over the rail: 9 tiles with ramps, $2250)`; refusal tooltips show the exact reason. The Crossings section text mentions the overpass price and room. Undo / redo are one step with the stroke. Bulldozing any overpass tile removes the whole overpass (ramps removed, rail tile plain rail again) and refunds half of its record cost; one undo step.
- **Mesh** (`render/meshes/overpass.ts`): per tile a stone embankment block (solid down to the ground on the ramps, a thin girder over the rail), an asphalt deck with a yellow centre line and low barrier rails on both sides; deck tops carry the winter snow tint (`BRIDGE_SNOW_U`). Boxes in the chunk network mesh, no extra draw call.
- **Advisor**: `crossing.waits` now also watches road crossings (a car held at the line counts per tick); for a road it suggests the overpass.
- Tests: `tests/sim/roadOverpass.test.ts`. Shots (`.weave/shots`, not committed): `ovp-ghost-summer`, `ovp-built-summer`, `ovp-built-winter`.
- Limits: no side road may join a ramp (not blocked in the tool, such a branch would sit on the ground next to the ramp); ride-along does not climb the ramps; an existing level crossing is not upgraded in place (bulldoze it, then draw the road again with Bridge).

## Out of scope / known limits
- Walk mode / ride-along use their own ground sampling and do not climb the footbridge stairs.
- A guest or car that spawns inside a crossing tile is outside the guarantee only for the single tick it takes to leave it; trains spawn with the lead (see above).
- The title-screen demo and tests build no crossings; every system above is a no-op there, so goldens are unchanged.


## One Crossings section (0.2.4)
The toggle is no longer 'rail only' wording: the dock's **Crossings** section (both drawers) covers every crossing a stroke makes. Over **rail** the player picks level crossing / bridge (`CrossMode`, hiking trail and footpath footbridge $900, MTB ramp $1,100, roads always level); over **water or a gap** the stroke always gets the matching bridge (automatic, docs/bridges.md); over another **path or road** it merges or crosses. Ski pistes cannot cross water or rail: the stroke stops there with *PISTE_RAIL_MSG* / *PISTE_WATER_MSG*.
