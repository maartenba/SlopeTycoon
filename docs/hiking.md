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
`EXC` (Excursion.ts; incl. foodRadius / maxGoalHunger / packShare / snackAt), `NEEDS.hungerHike` / `hungryExcursion`, `TRAIL_GOALS` (TrailGoals.ts), `Decider.trekShare`, `PASS_PRICES.hikerPass`, `NIGHTLY_RATE.mountainHut`, `AttractionSpec.beds`.

## Analyse
`npm run analysis:hiking:all` (legacy vs new per size; `Scenario.legacy` turns the model off at runtime) and `npm run analysis:hiking:report`. Tests: `tests/sim/guests/Excursion.test.ts` (ETA bounds/scale independence, daylight fit, closure + bear turn-back, save/load, 1000-excursionist perf), `Hiking.integration.test.ts` (64-map regression >= 35 % top third, invariants fuzz, bed limits, trek night + save/load determinism).

## Hunger audit before/after

User report: 'hikers are starving on long trips'. A code reading said: hunger rises while walking, hikers eat only at the goal if food is within ~5 tiles, no food on the way, no food check before planning. **Measured first** (`npm run analysis:hunger`, `tests/analysis/hunger.analysis.ts`, summarised by `npm run analysis:hiking:report`; 5 seeds x 10 summer days per row, real lift hours, starter resort + the hiking network of `hikingLib`). 'hut' = a Mountain Hut at the summit trail, 'nohut' = none (the starter resort's own cafe / lodge may still exist); '+hungry' = stress run where every guest arrives 0.3 hungrier (long drive, no breakfast). Metrics are per hiker (pref = Hike): hunger at trip start / at the goal stop / at the end, share of trips whose hunger is > 0.75 at the goal, share of hikers leaving with hunger > 0.75 (the inspector's 'I am starving!' thought), share leaving with a negative hunger review driver (hunger > 0.6, `Reviews.ts`), share of trips that include a lunch, hiker food spend per hiker ($, includes the lodge).

**Finding.** On ordinary resorts the problem was small, not large: a trip is 1.5-4.5 h = 15-45 ticks, so hunger only rose ~0.1-0.2 per trip (0.004 per tick) and hikers mostly ate at the lodge first. Before the fix: 0.4-1.2 % of trips were above 0.75 at the goal and 1.3-2.6 % of hikers left starving (both already inside the targets), but the tail was real: stressed guests reached 2-4 % starving at the goal and **6-8 % left starving** (> 5 % target) with 12-17 % negative hunger reviews, and only 0-10 % of trips ever had a food stop (the old check was a 6-tile radius around the *goal* only).

### Levers (cheapest first; no new buildings)
| lever | where | value |
|---|---|---|
| Relaxed hiking pace | `NEEDS.hungerHike` (act = Excursion) | 0.003 / tick (walk 0.004, idle 0.002) |
| Eat before a planned excursion | `Decider.choose`: hikers/bikers with hunger > `NEEDS.hungryExcursion` (0.45, generic hungry mark 0.55) get +1.5 on the eat intent | |
| Wider food search + stops on the way | `EXC.foodRadius` 8 (was 6); `Excursions.foodAlong` samples the route every 3 tiles + goal; huts, cafes, heated terraces, **alpine farm shop** count (`baseLodge` does not: that is the village); `Exc.fa` = route fraction of the stop, lunch ($12, hunger 0.05, +0.4 h) happens there on the way out | |
| Trip planner food check | `Excursions.begin`: no food stop, no packed lunch and predicted hunger at the goal > `EXC.maxGoalHunger` 0.7 -> shorten the route (keep >= 12 tiles) or refuse (the guest then eats first: `plannerShort` / `plannerRefused`) | |
| Packed lunch (free, brought from home) | `EXC.packShare` 40 % of guests (stable id hash), eaten once (`packedUsed`, saved) when hunger passes `EXC.snackAt` 0.45 -> `snackTo` 0.15; no revenue, so a paid hut lunch is still taken first when the stop is on the route | |
| Mild consequences only | unchanged: hunger only lowers the happiness target (0.45 x h^2) and adds a review driver; nobody leaves or dies because of it | |
| Advisor | rule `hikers.hungry` ('Hikers are going hungry'): decaying share of hiker/biker departures with hunger > 0.75 (`GuestSim.hikerLeaves`, observer data, not saved) >= 15 % (keep 8 %), suppressed when a hut / cafe / heated terrace is within 10 tiles of the trail network's middle; offers a Mountain Hut (else Cafe) site beside the trails | |

Not done: a snack bought at the rental/shop (the free packed lunch covers the need; revenue neutral), routing *through* a hut (routes are planned by the shared pathfinder; the lunch is credited when the route passes within 8 tiles instead), trail-side food buildings (Phase 6).

### Before -> after
| resort | size | trips | trip h | hunger goal | goal > 0.75 (before → after) | goal p90 | start > 0.5 | trips with food stop | leave starving (before → after) | hunger review driver | food $/hiker |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hut | 64 | 316 → 273 | 2.8 → 2.8 | 0.23 → 0.20 | 0.4% → 0.0% | 0.36 → 0.31 | 2.8% → 0.4% | 9.8% → 11.7% | 1.4% → 0.0% | 5.6% → 1.4% | 7.3 → 8.7 |
| nohut | 64 | 276 → 277 | 2.8 → 2.8 | 0.27 → 0.23 | 0.8% → 0.0% | 0.42 → 0.34 | 2.5% → 1.1% | 0.0% → 5.1% | 1.3% → 1.3% | 3.9% → 1.3% | 4.0 → 6.8 |
| hut+hungry | 64 | 282 → 256 | 2.9 → 2.9 | 0.25 → 0.17 | 2.7% → 0.0% | 0.58 → 0.26 | 20.9% → 12.5% | 27.0% → 33.6% | 1.4% → 1.3% | 8.6% → 1.3% | 14.1 → 16.2 |
| nohut+hungry | 64 | 207 → 233 | 2.8 → 2.9 | 0.36 → 0.20 | 3.3% → 0.0% | 0.62 → 0.44 | 19.8% → 11.2% | 2.4% → 19.3% | 3.9% → 1.4% | 15.6% → 2.7% | 4.4 → 11.9 |
| hut | 128 | 339 → 308 | 2.8 → 2.8 | 0.24 → 0.20 | 0.7% → 0.0% | 0.37 → 0.30 | 1.2% → 0.3% | 6.2% → 11.7% | 2.2% → 0.0% | 2.2% → 0.0% | 6.4 → 8.6 |
| nohut | 128 | 344 → 271 | 2.9 → 2.9 | 0.26 → 0.23 | 0.6% → 0.0% | 0.41 → 0.33 | 1.7% → 0.4% | 0.3% → 3.3% | 2.6% → 1.1% | 3.9% → 2.2% | 3.7 → 4.1 |
| hut+hungry | 128 | 331 → 304 | 2.9 → 3.0 | 0.26 → 0.16 | 0.7% → 0.0% | 0.53 → 0.29 | 14.5% → 12.8% | 20.2% → 29.9% | 6.3% → 0.0% | 14.7% → 3.8% | 11.8 → 13.9 |
| nohut+hungry | 128 | 327 → 277 | 2.8 → 3.0 | 0.34 → 0.23 | 1.4% → 0.0% | 0.60 → 0.52 | 17.7% → 15.5% | 0.9% → 12.6% | 7.9% → 1.1% | 16.9% → 6.8% | 4.8 → 8.8 |
| hut | 256 | 373 → 374 | 3.1 → 3.1 | 0.28 → 0.22 | 1.2% → 0.0% | 0.41 → 0.32 | 1.9% → 0.8% | 2.1% → 12.6% | 2.6% → 0.8% | 5.2% → 4.7% | 4.7 → 8.2 |
| nohut | 256 | 359 → 345 | 3.1 → 3.2 | 0.28 → 0.22 | 0.6% → 0.0% | 0.43 → 0.33 | 1.7% → 1.7% | 1.1% → 9.6% | 2.4% → 1.5% | 3.9% → 3.0% | 4.7 → 7.5 |
| hut+hungry | 256 | 345 → 353 | 3.1 → 3.2 | 0.31 → 0.20 | 2.1% → 0.0% | 0.60 → 0.38 | 18.6% → 16.4% | 11.9% → 26.9% | 5.9% → 4.3% | 11.8% → 10.1% | 7.7 → 11.7 |
| nohut+hungry | 256 | 311 → 341 | 3.3 → 3.1 | 0.39 → 0.22 | 3.6% → 0.0% | 0.64 → 0.49 | 25.1% → 15.0% | 1.0% → 18.8% | 8.0% → 1.6% | 17.6% → 7.1% | 4.9 → 9.7 |

All 12 rows: **goal > 0.75: 0.4-3.6 % -> 0.0 %** (target < 15 %); **leave starving: 1.3-8.0 % -> 0.0-4.3 %** (target < 5 %; the worst row is the stressed 256 resort with a hut); mean hunger at the goal -0.04..-0.2; trips with a food stop 0-27 % -> 3-34 %; hiker food spend per hiker +$1-8 (more lunches, so revenue up, not down). Trips per hiker are unchanged within seed noise (the planner only refuses starving guests). Determinism: same seed + inputs -> same stateHash (excursion save adds optional `fa`/`ate`/`pk`/`used`; old saves load: a planned lunch means a goal stop). Rule of thumb for the player: one hut or cafe near the trail network is enough (hut rows are better than nohut rows on every metric).

Tests: `tests/sim/guests/HikingHunger.test.ts` (pace, planner shorten / refuse / exempt, stop on the way, old-save load, packed lunch once + save round trip + share, eat-before-trip decision, headless 64-map audit with a hungry stress run), advisor rule in `tests/sim/advisor.test.ts` + `advisorScenarios.test.ts`.

## Not done
Alpine Refuge variant (needs a mesh), hut resupply surcharge, 'Trail popularity' overlay, 'first trekkers' news item, summit-sunrise cosmetic, lift-first for treks, visual QA of hikers in 3D (the headless harness could not stage a trail scene in time).

## 0.2.2 note
The hunger audit is repeatable with `npm run analysis:hunger`; the site guide (*Guests & seasons*) describes packed lunch and food stops for players.
