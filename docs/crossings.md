# Rail level crossings and the rail footbridge

Phase 6 task 10 (and 11, below once built). A footpath or road may cross a straight rail line at a right angle. Guests and cars wait for trains at a **level crossing**. Config: `src/config/crossings.ts`. Sim: `src/sim/RailCrossings.ts`. Data and placement: `src/world/Networks.ts`. Render: `src/render/RailCrossings.ts` (barriers, lamps, bell) and `src/render/meshes/Paths.ts` (`crossingDeck`).

## Owner decisions
- Guests **always wait** at a closed crossing; **trains never stop**.
- The crossing closes shortly before a train arrives (barriers down, bell, blinking red lamps).
- No deaths and no collisions, ever (see "Safety").

## Data (`Networks`)
- `cross: Uint8Array` per tile: `0` none, `1` footpath crossing, `2` road crossing, (`3` is reserved for the footbridge over rail). The tile's `kind` stays **Rail** (so trains, `railComp` and rail stations are untouched); `crossCount` counts the tiles (0 = every crossing system is inert).
- Floods: `walkComp` includes a rail tile with `cross >= 1`, `roadComp` with `cross === 2`, `railComp` is unchanged. `pathDistance` walks across crossings.
- `conn` of the path / road tiles next to a crossing gets a bit towards it (`crossJoins`), so the approach arms are drawn into the deck.
- Save: networks module **v2**. `cross` is written only when a crossing exists, so a world without one saves and hashes exactly as before; old saves load with no crossings. `TileSnap.cross` keeps undo / redo exact.

## Placement rule
A path or road stroke over a rail tile (or a rail stroke over a path / road tile) becomes a crossing when:
- the line through the tile is **straight** (conn N-S or E-W exactly) and the stroke runs **perpendicular** to it, with a stroke tile on each side;
- the tile is not part of a building (a Train Station) and not on a bridge / stream;
- no other crossing is within `CROSSING.minSpacing` (2) tiles (Manhattan);
- the slope stays within the lower of the two network limits.

Reasons (exact strings, `CROSS_MSG`): *Paths can only cross a straight rail line at right angles*, *A crossing needs path or road on both sides of the rail*, *Crossings need more room: another crossing is too close*, *Cannot cross rail at a station*, *Cannot cross rail on a bridge*, *Roads need a level crossing, not a footbridge*. Every other "building on rail" rule stays; a building never stands on a crossing (`Cannot build on a level crossing`).

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

## Out of scope / known limits
- A guest or car that spawns inside a crossing tile is outside the guarantee only for the single tick it takes to leave it; trains spawn with the lead (see above).
- The title-screen demo and tests build no crossings; every system above is a no-op there, so goldens are unchanged.
