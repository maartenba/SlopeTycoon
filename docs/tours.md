# Tour attractions (Phase 6 Task 5)

A **tour** is a guided ride or hike along a route: horse sleigh, snowshoe hike, snowscooter, quad, and later canyoning and rafting. The system is generic and config driven; the catalogue (`TOUR_DEFS` in `src/config/tours.ts`) grows with the content tasks. First row: the Quad Base (`docs/quads.md`). Without a tour base the system is inert.

## Pieces

| File | Role |
|---|---|
| `src/config/tours.ts` | `TourDef` rows keyed by the **base building id**, `TOURS` constants. |
| `src/sim/attractions/Tour.ts` | `planRoute` (pure), `TourSystem` (schedule, closures, counters, carriers, saves), `tourSpec(def)`. |
| `src/sim/attractions/AttractionSystem.ts` | Hooks: a spec with `tour` boards in departures (`boardTour`) instead of `admit`. |
| `src/render/TourVehicles.ts` | View-only instanced carriers (one `InstancedMesh` per vehicle kind, capped at `TOURS.maxCarriers` = 48). |
| `src/ui/attractionFormat.ts` | Inspector lines (`formatTourLines`). |
| `tests/sim/attractions/tour.test.ts` | Tests with a **test-only dummy tour** registered in `beforeAll`. |

## A tour def

`routes` (`road`, `path`, `trail` (+ `trailLayer`), `piste`, `water`), `motorised`, `minLen` / `maxLen` (tiles, one way), `durationTicks`, `intervalTicks` + `firstHour` / `lastHour` (fixed schedule), `seats` (per departure, scaled by staffing), `minRiders`, `seasons`, `maxWind`, `maxInstability`, `appeal`, `happiness`, `sustainPerDeparture`, `noiseRadius`, `vehicle` + `vehicles`. Ticket price, upkeep and staff come from the building / `PRICE_TABLE` rows like any attraction. To add a tour: add the building, a `PRICE_TABLE` row, a `TOUR_DEFS` row (the registry derives the attraction spec with `tourSpec`), a mesh.

## Guest flow

1. The base is an attraction (`spec.tour`). Guests arrive and queue as usual (queue patience, balking, ticket affordability and price elasticity all apply). Outside `firstHour - 1 .. lastHour` the base is not serving (guests are turned away, no news spam).
2. **Departures** happen on fixed slots (`firstHour + k * intervalTicks`, 10 ticks = 1 hour). A slot fires at most once (`lastKey`, saved) and only while it is fresh (younger than one interval), so a closed tour never leaves late. If fewer than `minRiders` are queued the slot is burnt.
3. Up to the **free seats** (capacity after staffing minus riders still out) board in queue order, pay the ticket (`recreation` ledger by default) and stay `Using` (off the nav graph) for `durationTicks`. Vehicles are the seats: a ride longer than the interval leaves fewer seats for the next departure.
4. Back at the base the guest gets the spec happiness gain, counts as served and is put down beside the base (the normal `release`).

## Route planner

`planRoute` runs a breadth-first search over tiles that `allow` the def (`TourDeps.allows`, wired to Networks in `createSim`), starting from the tiles touching the base footprint, depth <= `maxLen`. The route is the shortest path to the farthest reachable tile (lowest index on ties), at least `minLen` tiles; vehicles go out and come back along it. Motorised tours never use piste tiles. It is re-planned only when `networks.version` changes. The `'water'` kind is a stub ("Needs a river with enough flow: dig one in Landscape"), filled in by Task 24.

## Closures

Reason strings appear in the inspector and as `attraction:closed` news like every closure: *Closed for the season*, *Closed: Needs a connected route of a-b tiles starting at the base* (a removed route tile cancels the route; rebuilding it reopens), *Closed: too windy* (`weather.wind > maxWind`, a storm is 1), *Closed: avalanche danger on the route* (`Avalanche.inst` above `maxInstability` on any route tile), *Closed: the river is frozen* (water routes). Wind / instability are re-checked every `TOURS.checkEvery` ticks. A closure sends the **queue** home; rides in progress finish. Removing the base releases everyone. There are no deaths or injuries in this system.

## Wildlife and sustainability

Motorised departures scare animals within `noiseRadius` of the route (every `TOURS.noiseEvery` tiles, `Fauna` flee ticks). The sustainability facet loses `max(yesterday, today departures) x sustainPerDeparture` points per motorised tour, **capped at 3 points in total** (`TOURS.maxSustainPenalty`, D-P8); with no motorised tour it is exactly 0 and the score is bit-identical.

## Inspector and view

`AttractionInfo.tour` (`TourInfo`): departures today, riders, revenue today, riding now, next departure (`hour`, `tomorrow`), route length, lifetime totals. Carriers (`TourSystem.carriers(tick)`) are derived from the rides in progress and never read by the sim.

## Saves and determinism

Save module `tours` v1: per-tour counters, `lastKey`, day stats. **It serialises to `null` while no tour base exists and is then left out of `stateHash`** (`SaveModule.omitWhenNull`), so goldens recorded before any tour content stay identical. Riders in progress are not restored (they are released like every attraction user). No Rng is used: same seed + inputs = same `stateHash`.

## Flag

`createSim` always wires the system; it is inert until a tour base is built (no flag needed). The M6.x STOP tasks re-record goldens when content lands.

## Not done here

No route tool (the planner derives the route from the attached network, so the player just builds paths / roads / trails next to the base), no water validator (Task 24).
