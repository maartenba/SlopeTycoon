# Hiking: excursion model, appeal goals, foot lift first, hut beds

Why: see `docs/hiking-analysis.md` (a trail tile costs 100x real time, so hikers on bigger maps never got high; 11 / 17 / 1 % reached the top third on 64 / 128 / 256).

## Design

* **Excursion** (`src/sim/guests/Excursion.ts`). When a hike/bike path has no lift hop left and >= `EXC.minTiles` (12) tiles remain, `GuestSim.tryExcursion` converts the guest to `Act.Excursion` and hands the remaining path (planned by the normal NavMovement/pathfinder, so it respects snow, closures, bridges) to `Excursions`. The planned active time is `D = clamp(0.5 h + 0.035 h * tiles/(mapSize/64), 1.5, 4.5) / fitness` (bikers x0.65, min 1 h), i.e. **independent of map size**; plus a stop at the goal (0.25 h, +0.4 h hut lunch: hunger reset + $12 food). Progress is `elapsed / D`; position = linear interpolation along the route polyline (renderer interpolates px->x as usual, poses unchanged). Cost is O(1) per tick (no pathfinding, spatial hash relinks only on cell change); every 4th tick a 5-tile look-ahead checks closure (`hikeOk`, trail removed), bear field (`avoid > 0.35`) and dusk.
* **Guards**: closure/bear/dusk on the way out -> `turnBack` mirrors the position onto the return leg (no teleport); on the return leg or a one-way route the excursion ends in place. `begin` refuses (guest picks something else) when the plan cannot finish before `dayGuestLeaveHour - 0.25 h`, and shortens a route that only half fits. Day guests whose excursion is running are not sent home at `leaveHour` (they turn back); needs tick at the normal per-tick rates over the game time consumed.
* **Routes** are shared between guests through a table keyed `(start, goal, mode, network version)`; a guest keeps its own array snapshot. Save: compact list per excursion + the route table (each route once). Guests with `act = Excursion` and no record on load go idle.
* **Appeal goals** (`TrailGoals.ts`, knobs in `TRAIL_GOALS`): POIs per nav epoch = highest tile per 8x8 cell, the 3 summits, trail tiles beside a Mountain Hut, lift tops (<= 90). Score = 0.3 + 0.9 rel^1.2 (+ hut 0.3, summit 0.35) + **top-third pull** (`pullHiker` 1.3 for hikers/adventure, `pullOther` 0.5) - daylight excess - bear field/warning signs - storm (rel > 0.3) - beginner at rel > 0.7 + noise. The best 5 are checked for a hike path (cached/budgeted pathfinder queries; unreachable ones are remembered until the next epoch). Bikers choose descents (lowest MTB tiles below the start).
* **Foot lift first**: if a foot/mixed lift is open, its top is >= 8 % relief above the guest, queue < 80 ticks (90 % of such hikers), the guest rides it up (goal = lift top, then the real goal via `Excursions.pending`). Foot passengers pay the new **hikerPass** price (`PASS_PRICES.hikerPass`, $15, one per day; `Ticketing.onBoard(id, foot)`), skiers still pay the day pass.
* **Mountain Hut beds / treks**: `AttractionSpec.beds` (hut = 12) + `AttractionSystem.beds` (RoomBook); price key `night:mountainHut` ($45, max 120; bed + half-board, ledger `lodging`). `Decider` offers a trek (score 2.5) to ~15 % (`trekShare`) of solo/couple/adventure guests with budget > 60 who have not trekked, when a hut with a free bed is on a snow-free trail and the walk fits the daylight. The bed is reserved when the route is committed (so no race), released on abort/leave. Arrival: paid check-in, guest sleeps indoors (`Sleeping`, not rendered), next morning (>= 06:30) walks the same route down compressed, then leaves. A full hut is simply not offered. Trek state is saved (`trek`, `trekDone`, beds in the attractions module).
* Inspectors: guest 'On excursion: ... (pct · ETA)', hut 'Trekker beds: used/total booked tonight · nights sold'.

## Results (docs/hiking-analysis.md, 10 summer days, 5 seeds, real lift hours)

Top third 19 / 13 / 1 % -> 53 / 54 / 34 %, mid 35 / 21 / 3 -> 67 / 59 / 41 %, completion 57 / 34 / 14 -> 57 / 72 / 72 %, per-tick cost unchanged (0.05 / 0.10 / 0.28 ms).

## Tuning knobs
`EXC` (Excursion.ts), `TRAIL_GOALS` (TrailGoals.ts), `Decider.trekShare`, `PASS_PRICES.hikerPass`, `NIGHTLY_RATE.mountainHut`, `AttractionSpec.beds`.

## Analyse
`npm run analysis:hiking:all` (legacy vs new per size; `Scenario.legacy` turns the model off at runtime) and `npm run analysis:hiking:report`. Tests: `tests/sim/guests/Excursion.test.ts` (ETA bounds/scale independence, daylight fit, closure + bear turn-back, save/load, 1000-excursionist perf), `Hiking.integration.test.ts` (64-map regression >= 35 % top third, invariants fuzz, bed limits, trek night + save/load determinism).

## Not done
Alpine Refuge variant (needs a mesh), hut resupply surcharge, 'Trail popularity' overlay, 'first trekkers' news item, summit-sunrise cosmetic, lift-first for treks, visual QA of hikers in 3D (the headless harness could not stage a trail scene in time).
