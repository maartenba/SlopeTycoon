# Quad tours (Phase 6 Task 22)

The **Quad Base** is the first catalogue tour on the generic tour system (`docs/tours.md`): guided summer quad rides out and back along the roads and footpaths that touch the base.

| | |
|---|---|
| Building | `quadBase`, 3x2, recreation, $6,500, upkeep $25 / day, 2 staff (`config/buildings.ts`) |
| Unlock | Career level 2 (selective; no goal, advisor `build` action or tutorial step needs it) |
| Access | `road`, alt `path`; the building is inactive without it (like every attraction) |
| Ticket | $40 (`PRICE_TABLE.quadBase`, list range up to $60, D-P8 range $15-60) |
| Season | summer only (`needs: snowFree` for the placement drawer ordering, `seasons: ['summer']` for the tour) |
| Schedule | departures every 2 h from 10:00 to 16:00; guests may queue from 09:00; a departure needs 2 riders (`minRiders`) |
| Seats | 8 per departure (4 quads x 2 riders), scaled by staffing like any attraction; rides last 1.5 h |
| Route | `routes: ['road', 'path']`, 8-26 tiles one way, found by the planner from the tiles touching the base. **Never** a hiking / MTB trail tile and never a piste tile (motorised tours avoid pistes) |
| Closures | out of season, route broken (fewer than 8 attached tiles), wind > 0.7 ("Closed: too windy"), avalanche instability > 0.8 on a route tile |
| Appeal | adventure 1.0, couples 0.5, solo 0.35, family / VIP 0.3, budget 0.1 |

## Motorised: wildlife and sustainability

* Every departure scares animals within **9 tiles** of the route (checked every 6 route tiles, `FAUNA.fleeTicks`), the same hook as the other motorised tours.
* Each departure books **0.35** sustainability facet points (`sustainPerDeparture`): the larger of yesterday's and today's departures x 0.35, summed over tours, **capped at 3 points in total** for all motorised tours (`TOURS.maxSustainPenalty`). A full day (4 slots x 0.35 = 1.4 pts, 7 slots 2.45 pts) stays below the cap; without a quad base the penalty is exactly 0.
* The advisor (`tour.quad`, info, summer, 30+ guests, a base lodge and 8+ road tiles, level 2 unlocked) says so honestly: "the engines scare wildlife and cost a little sustainability". It only opens the Buildings drawer (no auto-site, because the item is gated).

## View and sound

* **Carriers**: `TourVehicles` draws every quad as one instanced mesh (about 230 triangles: body, cowl, seat, handlebars, 4 wheels, rider + passenger with helmets); one departure sends 4 quads in a convoy along the route and back. Up to `TOURS.maxCarriers` (48).
* **Dust**: a second instanced mesh (`tour:dust`, one draw call, at most 3 puffs per quad) trails behind a moving quad. Puffs never appear behind the start of the route (that is inside the base): `Carrier.back` is the route length behind the vehicle.
* **Engine**: ambience layer `quad` (`audio/Ambience.ts`): low-passed brown noise with a slow throb, ceiling `AMB.layerMax.quad = 0.045` (the quietest bed; snowcat .16). The probe (`worldProbe.ts`, optional `quads()` dep) raises it only when the camera is within ~40 tiles of a quad out on a ride, fades with zoom and in rain; silent without rides.
* **Base mesh** (`render/meshes/buildings/tours.ts`): timber garage with a roll-up door and "QUAD TOURS" sign, two parked quads on a gravel yard, fuel pump, tyre stack, helmet rack, lamp post.

## Inspector

Like every tour: departures today, riders, revenue, riding now, next departure, route length, lifetime totals (`docs/tours.md`).

## Tests

`tests/sim/attractions/quadTour.test.ts` (real starter resort, real road network): data (size, access, price in range, route kinds, unlock), route on road / footpath only and never over a painted hiking trail, riders pay $40 and come back happier, `minRiders`, 8 seats, schedule and closures (wind, winter), wildlife flees within the radius and not outside it, sustainability penalty > 0 and <= 3, inspector text, determinism, the advisor hint. `tests/render/tourVehicles.test.ts` covers the carriers and the dust.

## Re-recorded on purpose

Only the `progression` golden part of `tests/sim/staff.test.ts` moved (the unlock snapshot gained `building:quadBase` at level 2); every other part is byte-identical. The tour module serialises to `null` and stays out of `stateHash` until a tour base exists, so no sandbox / bot golden changes.
