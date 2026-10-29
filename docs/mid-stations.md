# N-station lifts (mid-stations)

Phase 6, M6.6, Tasks 36-38 (model, validation, guests). The tool, mesh and ride-along come with Task 39; nothing in the UI creates a mid-station yet.

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

## Not yet (Task 39+)

Tool UX (add / remove mid-station on a placed lift, preview), the mid-station mesh and slowing carriers in the station zone, ride-along per segment, `chair6d` (Task 47), the `midStations` createSim flag and goldens (Task 40).
