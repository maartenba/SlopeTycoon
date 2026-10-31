# Winter tours (Phase 6 Task 31)

Three winter catalogue tours on the generic tour system (`docs/tours.md`), beside the summer Quad Base (`docs/quads.md`) and the water tours (`docs/water-tours.md`). All are **winter only** (`seasons: ['winter']`, closed with "Closed for the season" otherwise), career-gated selectively, and nothing in a goal, advisor `build` action or tutorial step needs them.

| | Sleigh Stable | Snowshoe Hut | Snowscooter Base |
|---|---|---|---|
| Building | `sleighStable`, 4x3, $5,500, upkeep $12 / day, 1 staff | `snowshoeHut`, 2x2, $2,800, upkeep $10 / day, 1 staff (the guide) | `snowscooterBase`, 3x2, $9,000, upkeep $30 / day, 2 staff |
| Access | `road`, alt `path` | `trail`, alt `path` | `road`, alt `path`, `trail` |
| Unlock | Career level 2 | Career level 2 | Career level 3 |
| Ticket | $25 (max $40) | $15 (max $30) | $45 (max $70) |
| Route | attached **road / footpath** tiles, 6-24 tiles out and back | painted **Hike trail** tiles (layer 4) touching the hut, 6-24 tiles | attached **road / footpath / Hike trail** tiles, 8-28 tiles; never a piste tile |
| Seats | 6 (one sleigh) | 8 (a line of 8 walkers) | 6 (6 scooters, one rider each) |
| Schedule | every 2 h, 10:00-16:00, ride 1.4 h | every 3 h, 10:00-15:00, ride 1.8 h | every 2 h, 10:00-16:00, ride 1.4 h |
| Min riders | 2 | 2 | 2 |
| Closures | winter only, route cut, storm (wind > 0.7), avalanche instability > 0.8 on a route tile | winter only, route cut, storm, **instability > 0.6 on any route tile** ("Closed: avalanche danger on the route") | winter only, route cut, storm, instability > 0.8 |
| Motorised | no | no | **yes**: wildlife scare + capped sustainability penalty |
| Appeal (solo, couple, family, VIP, budget, adventure) | 0.2 / 0.9 / 0.8 / 0.6 / 0.2 / 0.3 (couples, families, seniors) | 0.5 / 0.6 / 0.5 / 0.2 / 0.7 / 0.7 | 0.4 / 0.5 / 0.2 / 0.4 / 0.05 / 1.0 |

The route is out and back along the same tiles (the generic planner); a "loop" is the out-and-back drive, there is no loop planner.

## Rules and reasons

* Placement uses the normal access rules (an attraction without its network is inactive). The place tips say what to build beside the base.
* The route is re-planned when the network changes; a removed tile closes the tour with "Needs a connected route of a-b tiles starting at the base".
* **The Hike layer persists in winter**: nothing in `Networks` clears or hides painted trails in any season (`tests/sim/attractions/winterTours.test.ts` pushes the clock through a whole winter and the route is identical). The snowshoe tour needs a Hike trail that touches the hut; a footpath beside the hut gives it access (it is active) but no route.
* Unstable snow cancels the snowshoe walk: `Avalanche.inst` of any route tile above `maxInstability` (0.6, stricter than the motorised 0.8, scale: > 1 releases) closes it within `TOURS.checkEvery` ticks and reopens when it falls. Rides in progress finish; the queue goes home.

## Wildlife and sustainability

Only the scooter is `motorised`. Each departure scares animals within 9 tiles of the route (every 6 tiles, `FAUNA.fleeTicks`), and books 0.35 sustainability facet points: max(yesterday, today) departures x 0.35, summed over **all** motorised tours (Quad Base too) and capped at 3 points (`TOURS.maxSustainPenalty`, D-P8). The sleigh and the snowshoe tour are quiet: penalty exactly 0, no scare.

## View and sound

* **Sleigh** (`TourVehicles`, `sleighGeometry`): a horse with a bell collar and a red sleigh with three benches and six coloured guests, one instanced mesh (< 520 triangles).
* **Snowshoe** (`walkerGeometry`): a guide-led line of 8 walkers with big flat snowshoes, packs, hats and two poles each (< 200 triangles, spread along the route one behind the other).
* **Snowscooter** (`scooterGeometry`): six scooters with a rider and a helmet each, plus **snow spray** puffs (`tour:spray`, one draw call, at most 3 per scooter, never behind the route start).
* **Bases** (`render/meshes/buildings/tours.ts`): Sleigh Stable = timber stable with a snowy gable roof, stable doors, hay bales, hitching rail with trough, a parked sleigh, fence and lamp; Snowshoe Hut = log hut with a snowy roof, chimney, snowshoe rack with poles, signpost, bench; Snowscooter Base = steel workshop with a snowy roof, roll-up door, three parked scooters, fuel drums, helmet rack. Each is <= 4 meshes and draws its own white yard.
* **Sound** (`audio/Ambience.ts`): new layer `sleigh` (soft band-limited noise shimmer on two unrelated fast sines: bells without a tonal oscillator), ceiling `AMB.layerMax.sleigh = 0.03`, the quietest bed (quad 0.045). The probe (`worldProbe.ts`, optional `sleighs()` dep) raises it only while a sleigh is out on its ride and the camera is within ~30 tiles (the sleigh only exists while it is moving), fades with zoom and in rain; silent without a sleigh. Snowscooters feed the existing quiet `quad` engine layer (`quads()` now also lists scooters).

## Advisor

`tour.winter` (info, winter, 30+ guests, a base lodge, 6+ road tiles, none of the three built, sleigh unlocked): "Winter idea: off-piste fun". It only opens the Buildings drawer on the sleigh stable (the item is career-gated; no auto-site).

## Tests, shots

`tests/sim/attractions/winterTours.test.ts` (data, route planner per base, winter-only seasons, storm closure, summer closed, capacity / revenue, determinism, save module round-trip, inspector text, snowshoe Hike persistence + instability cancel, scooter wildlife + motor cap, advisor), `tests/render/tourVehicles.test.ts` (spray, triangle budgets), `tests/audio/ambience.test.ts` (sleigh mix + ceiling). `npm run winter:tours [-- --shots 1]` plays a real-page winter week with the three bases (`.weave/shots/p6q-*.png`: each base + a departure running).

## Goldens

The unlock rows move ONLY the `progression` part of the staff golden (`tests/sim/staff.test.ts`). Not re-recorded here: the M6.5 STOP does it. The tour module stays `null` (out of `stateHash`) until a tour base exists.
