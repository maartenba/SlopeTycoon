# N-station lifts (mid-stations)

Phase 6, M6.6, Tasks 36-39 and 47 (model, validation, guests, tool UX, mesh, walk-mode ride, `chair6d`). **Decision (M6.6 STOP, 0.2.6): mid-stations ship ON, with no createSim flag.** The tool is player-driven and the bot never builds a mid-station, so goldens do not move (verified: bot games before / after the milestone differ only in the `progression` part, `docs/balance.md` "M6.2 + M6.6 STOP check"). Player guide: *Lifts & pistes* > Mid-stations.

A lift can have **1 or 2 intermediate stations** (3 or 4 stations in all), where guests board and alight. Only **gondolas, cable cars and detachable chairs** may have them (`LiftDef.midStations`, derived in `src/config/lifts.ts`: family gondola / cablecar, or chair with `detachable`). T-bars, fixed-grip chairs and funiculars refuse.

## Model (`src/sim/Lift.ts`)

- `LiftData.stations?: StationRef[]`: **all** stations bottom to top (`{ x, y, ground, node, board?, alight? }`; `node` indexes the support point in `nodes`; `board` / `alight` default true). It is **absent for ordinary 2-station lifts**: their records, saves and `stateHash` are unchanged, and every consumer derives `[bottom, top]` through `liftStations(l)`.
- Helpers: `liftStations`, `stationCount`, `isMultiStation`, `midCount`, `stationIndexAt(l, x, y)`, `liftSegments`, `stationDistances` (cable distance bottom to each station), `midStationsAllowed(kind)`.
- Mid-stations lie on the straight line between the terminals (v1: no angle stations; `LIFT_MID_LINE_TOL` = 0.75 tiles). Their 2x2 footprint is lift-occupied; `tiles` is the union of all segments.
- `computeStats(kind, nodes, speed, mids)`: each mid-station adds a dwell to the ride time (`LIFT_MID_STATION_DWELL_S` for detachables, `LIFT_DWELL_S` for the reversible cable car, which stops at every station). Loop lifts keep their carrier spacing, so throughput is unchanged; the cable car's cycle gets longer.

## Validation (`validateLift(env, kind, bottom, top, { mids })`, `placeLift(..., mids)`)

Every segment (station k to k + 1) goes through the ordinary validator on its own (length, gradient, tower spacing and height caps, clearance, trees, roofs, other lifts, slope). Results are merged:

- reasons name the station (`Mid-station site occupied`, ...) or the segment (`Segment 2: ...`);
- the mid-station needs the same **flat pad** as a terminal (auto-flatten; the shared pad is levelled and charged **once**; if the two segments disagree on the pad height the route is refused);
- **towers keep at least `LIFT_MID_TOWER_GAP` (2) tiles from the mid-station footprint** (per-segment end margin plus a final check on all towers);
- at most 2 mid-stations; mids must lie between the terminals and at least `LIFT_MIN_LENGTH` apart;
- cost = sum of the segments (cable + towers) + one station price per station (a mid-station costs as much as a terminal); funds are checked once;
- `liftClearanceViolations` (terraform guard) tapers the required clearance to 0 at each mid-station too.

## Guests (`src/sim/guests`)

- **Queues** (`LiftQueue.ts`): 2-station lifts keep the original single-queue model, **untouched**. N-station lifts use a `Line` per direction with a waiting list per station and real carriers (`Batch`es) travelling station to station. A carrier leaves the origin at the lift's cadence (empty carriers too); at a mid-station the riders whose destination it is alight, the others stay seated (*through riders*), and waiting guests board into the **free seats only**. So no carrier ever holds more than its capacity and no segment more than capacity x cadence (`maxCarrierLoad`, `segmentLoads`, `segmentCarriers`, tests). Breakdown freeze, evacuation, closing, demolition and cancel behave as before.
- `join(liftId, dir, slot, kind, tick, patience, from?, to?)`; `done(slot, liftId, dir, station?)` reports the alighting station; `waitTicks` / `queueLength` take an optional station.
- **NavGraph**: every ordered pair of stations is a link (up for everybody, down only where the lift carries foot passengers today). Link cost = distance + `MID_STOP_COST` per intermediate stop + the queue wait at the boarding station. The movement layer remembers the station tiles of the requested ride (`liftFrom` / `liftTo`), so a guest boards at the right station and alights at the one nearest its goal (hikers / bikers route through the graph; `Pathfinder` needed no change).
- **Skiers** who just want a lift ride get off at a mid-station about a third of the time (stateless hash of guest id and runs, no RNG, nothing saved) and ski the plain way down.

## Saves

`SAVE_FORMAT_VERSION` 3, `lifts` module version 3. Migration 2 to 3 keeps every old lift as a 2-station lift WITHOUT the field (byte-identical) and drops a malformed `stations` list. Queues are not saved (as before).

## Ticketing (resolved risk from Tasks 36-38)

There are **no per-ride tickets**: `Ticketing` sells a **day pass once per guest per day** (at the entrance with a Ticket Office, else on the first boarding), a **hiker / biker ticket once per day**, and season-pass holders ride free. The queue's `boarded` hook calls `Ticketing.onBoard` for **every boarding**, so terminal to mid and mid to top are two boardings: the second finds the pass already sold and charges nothing (`hasDayPass` / `hasHikerTicket`). Rule: **revenue per segment is zero beyond the pass; a pass is never sold twice a day; a through rider boards once.** What counts per boarding (not per guest): `Ticketing.rides`, `holderRides`, `LiftData.riders.total` / `perHour` (the lift's own counter, equal to `Ticketing.rides` on a single lift) and the NavGraph queue statistics. A guest who cannot afford the pass is gated by `canRide` before joining, so the `refusals` counter (once per refused boarding) is practically never hit twice for one guest. Tests: `tests/sim/Ticketing.test.ts` (N-station case), `tests/sim/MidStationTool.test.ts` (a real day).

## Tool UX (`src/build/LiftTool.ts`, `registerLiftTools.ts`, `StLiftInspector`)

- Inspector (gondola / cable car / detachable chairs only): *Stations: 3 (1 mid-station)*, **Add mid-station** (disabled at 2, toggles to *Cancel mid-station* while picking) and **Remove mid-station [k]**.
- **Pick mode** (`LiftTool.startMid(id)`): the hovered point is projected on the straight terminal line and snapped to the 2x2 grid; if that spot is invalid the tool tries the line at +-1..4 tiles and takes the nearest valid one (amber ghost, "Snapped to the nearest valid spot"). The ghost is the whole planned lift (so every segment, tower and station is drawn; green valid / red invalid), the tip shows the price (`previewMids(...).charge`), the number of stations and the ride time, or the first three per-segment reasons (`Mid-station site occupied`, `Segment 2: ...`). Click (or the touch confirm) builds; Esc / right-click cancels; the mode stays on a refused click so the player can aim again. Touch uses the same synthetic events (`touchHint` / `confirm`).
- **Sim** (`src/sim/Lift.ts`): `setMidStations(env, props, id, mids)` re-plans the lift between its unchanged terminals with the new list (`[]` = back to a plain lift): same id and store position, ops / speed / mode / counters kept, all-or-nothing (the old record is put back on any failure). Adding charges the difference to the new total (`max(total, old cost) - old cost`) and the lift's `cost` becomes that total; removing refunds half the difference and `cost` becomes the new total (a later demolish still refunds 50%). `previewMids` is the dry run (removes the lift from the store for the duration, then `attach`es the SAME object back). `Undo.setLiftMids` = one undo step (terrain delta for the pad + lane trees, exact old record back, money back); add / remove / undo / redo are **refused while any guest queues for or rides the lift** (close it and wait: `Undo.guestsAtLift`).
- After a change `registerLiftTools` re-adds the mesh (`LiftView.add` replaces by id; `syncView` compares `LiftView.dataOf(id)` with the store record so an undo brings the right meshes back) and `onMidChanged` marks the forest cover dirty. NavGraph notices the new station list through its lift signature; `RunIndex` splits runs at every station (`createSim` stations callback).

## Mesh and carriers (`src/render/meshes/lifts`, `Lift.ts`)

- `midStation.ts`: one pass-through hall per family (chair: open canopy, red posts; gondola: glazed side walls; cable car: stone walls), two platforms with a hazard edge, guide rails at the strand height with the cable running straight through, snow cap, two lamp posts (warm-coloured lamp heads: lift materials do not glow, the game has no per-station night emissive), a *MID STATION* sign on both ends. Symmetric along the line, <= 600 triangles (`tests/render/midStation.test.ts`). `LiftView.build` draws one per intermediate station; LOD / near roof fade follow the existing station material.
- **Carriers dwell visually**: loop lifts map the rope coordinate to the cable distance (`ropeToPath` / `pathToRope`): in a `MID_SLOW_ZONE` (4 tiles) around every mid-station the carriers run at 1/10 of the line speed (`MID_SLOW_EXTRA` rope tiles are added per station), so they bunch up like in a real detachable station and spread out again; at the nominal speed the zone costs ~6.7 s (the sim books 8 s per mid-station: the rest is the platform). The reversible cable car stops `LIFT_DWELL_S` at every station, both ways (`carrierStates`). Two-station lifts are untouched (identity mapping).
- **Walk mode**: the footprint is lift-occupied, so collision is unchanged. A walker can board at **any station but the top** (`nearestBoardable` returns `station`); the cosmetic ride follows the same rope mapping (the camera crawls through each mid-station); while crawling through one the prompt says *E: Get off here (or stay seated)* and `E` alights there (`WalkMode.interact()` returns `'alight'`), otherwise the ride goes on.
- **Ride-along (guests)** follows the guest's own position: the sim moves a rider segment by segment, the guest alights at its destination station (a third of ski riders at a mid-station) and the follow continues as a skier. The rider is NOT asked (the followed guest decides); the player-driven choice is the walk-mode ride above.

## Guests and trails from a mid-station

- Skiers who get off at a mid-station now pick a **run from there** (`Exploration.pickVia(..., fromStation)`: corridor, candidate tiles and flood fills use the mid-station as the start and the bottom as the end; cached per station), not only the plain way down.
- Hikers and bikers (`TrailGoals.pick`) choose, for a lift-first excursion on an N-station lift, the **station nearest to the goal** as the alighting point and route from there; mid-stations are also lift points of interest (kind 3). Two-station lifts keep their old code path (same numbers).
- Runs split at every station, so a piste starting at a mid-station is its own run.

## `chair6d` (Task 47)

`LIFTS.chair6d` 'Chairlift (6-seat, high-speed)': family chair, detachable (so mid-stations are allowed), 6 seats, speed 5, **carrier spacing 13** (the attach / detach cycle: fewer carriers per hour at a station than the quad's 8 tile spacing and than chair6's 9), load time 3 s, $140 / m, $16 000 per station, comfort 0.66, wind tolerance 0.74, level 3. Per hour on a 60 tile line the 6d carries more than a chair4 (6 seats) but boards about 23% fewer carriers per hour (1385 vs 1800 at a station; tests in `tests/render/midStation.test.ts`). It is deliberately not dominant over the plain detachable `chair6` (wider spacing and slower loading, shorter reach, no bubble). Own look: teal chairs with a wind visor (372 triangles, the base six-seat is 324) and a teal-accent station labelled *HSC 6*. Same clearance / tower caps as every chair (`docs/lifts-clearance.md`). No goal or Advisor rule requires it.

## Not yet

An angle (non-straight) mid-station. Night lighting of the mid-station is lamp-coloured geometry only.
