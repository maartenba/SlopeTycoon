# Hiking analysis: why hikers never get high up the mountain

Analysis only: nothing in `src/` was changed. Headless measurements through the real `createSim` / `buildStarterResort` / placement and network APIs.

## Reproduce

```
npm run analysis:hiking:all          # full sweep in chunks (3 sizes x 11 scenarios x 5 seeds, ~8 min), prints the merged tables
npm run analysis:hiking              # one process; env: HIKING_SIZES=64,128,256 HIKING_SEEDS=11,23,37 HIKING_DAYS=10 HIKING_SCENARIOS=baseline,speed10 HIKING_OUT=path.json
npm run analysis:hiking:report       # merge scripts/analysis/out/*.json into the markdown tables below
```
Files: `scripts/analysis/hikingLib.ts` (resort builder, probe, scenarios, aggregation), `scripts/analysis/hikingReport.ts`, `scripts/analysis/hiking-all.sh`,
`tests/analysis/hiking.analysis.ts` (vitest entry; named `*.analysis.ts` and run with `vitest.analysis.config.ts`, so `npm test` never picks it up).
What-ifs mutate runtime values only (`NAV_SPEED.hike`, `GUEST_DUSK_HOUR` through a vitest module mock, lift hours via `liftOps.setHours`, a wrapper around `Decider.choose`, a per-tick post-step for the excursion / overnight emulation); nothing is committed.
Tip: a single long (> ~2.5 min) vitest process was SIGTERMed several times in this environment (exit 143, probably a sibling agent's cleanup), hence the chunked script with retries.

## Method

* Resort: `createSim({startSeason:'summer'})` (day = summer start + 20), starter resort with ONE 4-seat chairlift (carries foot/bike passengers; `activeMode` = `foot` in summer), then a **village -> summit hiking trail** (Dijkstra over free tiles, cost 1 + 6 |dAlt|, painted as `Layer.Hike`), a **lift-top -> summit trail**, a **lift-top -> village bike trail** (`Layer.Mtb`) and a Mountain Hut near the summit. Summit = the highest tile reachable from the village.
* Lift hours are the **real defaults 08:30-17:00** (the test harness' 06:00-22:00 override is NOT used). Guests: real spawner (arrival window 07:30-15:30, summer rate 0.6), real needs, real decider.
* 10 in-game days (2400 ticks) at the real tick/clock (240 ticks/day, 6 game-min/tick). Sizes 64/128/256, 5-6 seeds each (6 for the tables below), ~100-180 hikers (guests whose `prefFor` = Hike, 15-30 % of guests) per cell.
* Altitude % = (tile altitude - map min) / (map max - map min), i.e. share of terrain relief. Relief is 150 / 260 / 455 m on 64 / 128 / 256 (10 m per world unit); the village sits at 0 %, the starter lift top at 23-41 %.
* Per hiker: arrival hour, first tile on a trail layer, every hike attempt (goal altitude, planned path length incl. lift hops, start/end hour, outcome), max altitude, time above 50 / 67 %, time per activity, lift rides by movement mode, leave reason and leaving duration. Aggregated heatmaps by hour x altitude band.
* "Top third" = reached >= 67 % relief at any time; "summit" = came within 4 tiles of the summit tile (only meaningful on 64; the summit tile is often snowbound on 128/256); "mid" = >= 50 %.
* Noise: runs are not bit-identical between processes (other agents' systems, e.g. wildlife, use unseeded randomness; same-seed re-runs gave +-7 points on top-third share at n ~ 100). Read effects below ~5 points as noise.
* Income column = sum of `economy.ledger` deltas over the run (all income categories, not only hiking); at 5-8 k the hiking-specific part is far smaller than the noise, so it only shows "no side effects".

## Key findings (WHY hikers stay low)

**1. Speed scale: a trail tile costs 100x real time.** `NAV_SPEED.hike` = 0.4 tiles/tick on trail tiles = 4 tiles/h = **40 m/h (0.04 km/h)**; on footpaths (`walk` = 3) = 30 tiles/h = 0.3 km/h. A real hiker (4 km/h) would do 400 tiles/h, 100x ours on trails and 13x on paths. The summit trail from the village is **51 / 113 / 250 tiles** on 64 / 128 / 256 (lift-top -> summit 31 / 56 / 164): that is **13 / 28 / 62 hours of walking** (real: 8 / 17 / 38 minutes), against a lift/guest day of 8.5 h. Share of planned hike attempts that cannot be finished before 17:00 even if started on the spot: **64 % / 84 % / 96 %**. Completed attempts: 59 % / 30 % / 15 %. This is why the same map-scale fraction (top-third) gets worse as maps grow: 11 % / 17 % / 1 % of hikers reach the top third, mean max altitude 28 % / 21 % / 8 %, median 20 % / 0 % / 0 %.

**2. The day window is mostly gone before the first step.** Arrivals are uniform 08-16 (mean 12.1 h) but guests leave at 17:00 (`GUEST_DUSK_HOUR`), so the mean guest has **4.9 h** left. Arrival -> first trail tile takes **3.4 / 3.4 / 4.0 h** (70-80 % of that window) and the mean hike attempt starts at 12.4-12.6 h. Why: new guests idle 5 ticks, the decider runs only when the idle `timer` expires, and every finished activity parks the guest for `rng.int(10,40)` ticks (building: 1-4 h) or `rng.int(20,50)` ticks after a trail (**2-5 h**). Hikers are **idle 46-54 % of their time** and on a trail only 14-15 %; queues, lift riding, eating and attractions together are < 8 % (queue 0 %, ride 0 %, using 1-2 %, walking to buildings 3-4 %). Only 54-58 % of hikers make even one hike attempt (2.4-3.2 attempts each). So queues/eating are NOT the problem; idle timers and the day window are.

**3. Dusk-leave at 17:00 plus a leave walk at trail speed strands hikers on the mountain overnight.** 24-31 % of hikers (33-37 % of all guests) leave by "closing"; they keep their hike movement mode and walk out at 0.4 tiles/tick on trail tiles. Time spent in the Leaving state is **11 % / 21 % / 20 %** of alive time; hikers who start leaving above 30 % relief need on average **5.5 / 17.6 / 10.7 h** to get out (p90 9 / 46 / 12 h; n is small: 21 / 8 / 3 at these seeds), vs 1.0 / 2.8 / 3.7 h for guests who start low. Day-guest stay length is p10 / p50 / p90 = 2.4 / 6.8 / 27.7 h on 64 (2.0 / 6.4 / 29.6 on 128, 2.7 / 6.4 / 26.4 on 256): the p90 is guests still walking out the next day. 9 % / 20 % / 24 % of hike attempts (64 / 128 / 256) end as "aborted by dusk".

**4. The decision logic has no distance penalty, but it also has no reason to go high.** `Decider.choose` (hike): `score = (pref Hike ? 1.2 : skiLifts ? 0.08 : 0.6) - 0.6 fatigue - hikePenalty(0.3 near warning signs) + noise(0..0.25)`, goal = uniformly random one of <= 48 sampled snow-free trail tiles. No term depends on distance or altitude, so the **mean goal altitude is 42-48 % of relief regardless of map size** and (because the speed makes distant goals unreachable) most attempts to far goals are abandoned: no-path/unreachable/timeout aborts are 27 % / 40 % / 54 % of attempts (`unreachable` = goal tile cut off by a snowy tile on the trail, see below; `ACT_TIMEOUT` = 700 ticks = 2.9 days). The only brakes on the trip count are `rng.chance(visits*0.04 + runs*0.004)` -> leave (every trail visit adds 4 % per decision) and the 'home' candidate (0.03).
 Secondary causes:
 * **Lift use is marginal.** Only 16 % / 18 % / 10 % of hikers ever ride the foot lift (0.1-0.2 rides per hiker; 98 / 96 / 82 foot rides vs 8 / 17 / 4 bike rides in 10 days), because the path planner uses the lift only when it is cheaper for a random goal (22-29 % of planned paths contain a lift hop), the lift runs 08:30-17:00 and the starter lift tops out at 23-41 % of the relief (the "high" half of the mountain is 160+ tiles of trail beyond it on 256).
 * **Early-summer snow cuts routes.** At summer start + 20 days only 53-69 % of the trail tiles in the top third are snow-free (`hikeOk`); one snowy tile severs everything above it for hike mode (67-76 % by day 30).
 * **No lodging that helps hikers.** Overnight guests sleep wherever they stand (Sleeping state, 13-16 % of hiker time) and resume at 06:30, but only chalet guests (a minority) are flagged overnight, and nothing gives a hiker a reason to stay at a high hut.

## Baseline numbers


### Speeds

| movement | tiles/tick | tiles/hour | km/h (10 m tiles) |
|---|---|---|---|
| walk on path | 3 | 30 | 0.30 |
| hike on trail (off-path) | 0.4 | 4 | 0.04 |
| bike off-path downhill | 1.4 | 14 | 0.14 |
| bike on path | 0.84 | 8.4 | 0.08 |
| ski base | 2.2 | 22 | 0.22 |

### Trail geometry (mean of seeds)

| size | seeds | lift top rel. alt | trail lodge->summit (tiles) | lift top->summit | lift length | trail tiles | snow-free |
|---|---|---|---|---|---|---|---|
| 64 | 6 | 41% | 51.0 | 30.5 | 12.9 | 77.3 | 88% |
| 128 | 6 | 23% | 113.0 | 55.8 | 25.9 | 164.7 | 90% |
| 256 | 6 | 37% | 249.8 | 164.2 | 51.0 | 401.5 | 83% |

### Baseline per size

| metric | 64 | 128 | 256 |
|---|---|---|---|
| guests / hikers (pref=Hike) sampled | 434 / 98 | 534 / 125 | 710 / 177 |
| mean arrival hour | 12.1 | 12.2 | 12.2 |
| day-guest stay h (p10/p50/p90) | 2.4 / 6.8 / 27.7 | 2.0 / 6.4 / 29.6 | 2.7 / 6.4 / 26.4 |
| hikers with >=1 hike attempt | 57% | 58% | 54% |
| arrival -> first trail tile (h) | 3.5 | 3.4 | 4.0 |
| hike attempts / hiker | 3.2 | 3.0 | 2.4 |
| mean attempt start hour | 12.6 | 12.6 | 12.4 |
| mean path length (tiles) / goal rel. altitude | 25.6 / 43% | 56.7 / 42% | 128.7 / 45% |
| path includes a lift ride | 29% | 24% | 22% |
| attempts that cannot finish before 17:00 (path/hike-speed) | 64% | 84% | 96% |
| attempts completed | 59% | 30% | 15% |
| aborted: dusk / needs / random-satisfied / no-path|unreachable | 9% / 0% / 4% / 27% | 20% / 0% / 8% / 40% | 24% / 0% / 6% / 54% |
| hikers reaching mid (>=50 %) / top third (>=67 %) / summit | 23% / 11% / 5% | 20% / 17% / 4% | 4% / 1% / 0% |
| mean / median max altitude % | 28% / 20% | 21% / 0% | 8% / 0% |
| hours above 50 % / 67 % per hiker | 3.0 / 1.7 | 4.1 / 2.5 | 0.8 / 0.2 |
| hikers that rode the lift (share) / rides per hiker | 16% / 0.2 | 18% / 0.2 | 10% / 0.1 |
| lift rides by mode hike/bike/ski | 98/8/0 | 96/17/0 | 82/4/0 |
| leaving walk h for hikers who started leaving >=30 % up (mean / p90 / n) | 5.5 / 9.3 / 21 | 17.6 / 45.6 / 8 | 10.7 / 12.0 / 3 |
| leaving walk h for everyone below 30 % (mean / p90 / n) | 1.0 / 2.1 / 318 | 2.8 / 5.0 / 428 | 3.7 / 6.6 / 630 |
| left via dusk (all guests / hikers) | 33% / 24% | 34% / 29% | 37% / 31% |
| top-third trail tiles snow-free (start->end of run) | 57% -> 76% | 69% -> 75% | 53% -> 67% |
| abort reasons on trail goals | unreachable:35 wait22:3 | unreachable:19 | unreachable:42 wait22:3 |

### Hiker time budget (share of alive ticks, baseline)

| activity | 64 | 128 | 256 |
|---|---|---|---|
| trail | 14% | 14% | 15% |
| toBuilding | 3% | 4% | 4% |
| toLift | 0% | 0% | 0% |
| queue | 0% | 0% | 0% |
| ride | 0% | 0% | 0% |
| using | 2% | 1% | 1% |
| idle | 54% | 46% | 47% |
| leaving | 11% | 21% | 20% |
| sleeping | 16% | 14% | 13% |

### Heatmap: baseline hiker-ticks by hour x altitude band (share of the hour; bands 0-20 / 20-40 / 40-60 / 60-80 / 80-100 % of relief)

size 64: hour: band shares

| hour | 0-20 | 20-40 | 40-60 | 60-80 | 80-100 | hiker-ticks |
|---|---|---|---|---|---|---|
| 6:00 | 50% | 23% | 12% | 8% | 6% | 630 |
| 7:00 | 49% | 23% | 11% | 13% | 5% | 590 |
| 8:00 | 60% | 10% | 15% | 10% | 5% | 604 |
| 9:00 | 70% | 6% | 15% | 6% | 2% | 681 |
| 10:00 | 74% | 12% | 8% | 5% | 1% | 865 |
| 11:00 | 68% | 19% | 6% | 5% | 2% | 854 |
| 12:00 | 74% | 14% | 4% | 5% | 3% | 944 |
| 13:00 | 76% | 13% | 3% | 5% | 3% | 1076 |
| 14:00 | 75% | 11% | 6% | 5% | 3% | 1160 |
| 15:00 | 77% | 9% | 5% | 7% | 2% | 1215 |
| 16:00 | 77% | 7% | 6% | 7% | 3% | 1204 |
| 17:00 | 72% | 11% | 6% | 5% | 5% | 1020 |
| 18:00 | 67% | 14% | 6% | 8% | 5% | 809 |
| 19:00 | 65% | 15% | 5% | 8% | 7% | 738 |
| 20:00 | 59% | 18% | 8% | 10% | 6% | 718 |
| 21:00 | 54% | 19% | 10% | 9% | 7% | 672 |

size 128: hour: band shares

| hour | 0-20 | 20-40 | 40-60 | 60-80 | 80-100 | hiker-ticks |
|---|---|---|---|---|---|---|
| 6:00 | 58% | 13% | 13% | 12% | 4% | 1093 |
| 7:00 | 59% | 11% | 15% | 12% | 4% | 1078 |
| 8:00 | 64% | 10% | 12% | 11% | 2% | 970 |
| 9:00 | 68% | 12% | 10% | 9% | 2% | 1078 |
| 10:00 | 69% | 13% | 6% | 9% | 3% | 1161 |
| 11:00 | 69% | 14% | 5% | 9% | 3% | 1242 |
| 12:00 | 70% | 13% | 6% | 7% | 4% | 1357 |
| 13:00 | 71% | 13% | 4% | 7% | 5% | 1458 |
| 14:00 | 70% | 13% | 6% | 7% | 4% | 1516 |
| 15:00 | 72% | 11% | 6% | 7% | 4% | 1630 |
| 16:00 | 73% | 10% | 8% | 6% | 3% | 1713 |
| 17:00 | 71% | 12% | 8% | 5% | 3% | 1619 |
| 18:00 | 65% | 14% | 8% | 9% | 4% | 1369 |
| 19:00 | 61% | 20% | 4% | 11% | 4% | 1309 |
| 20:00 | 59% | 19% | 7% | 10% | 5% | 1250 |
| 21:00 | 58% | 17% | 10% | 9% | 6% | 1211 |

size 256: hour: band shares

| hour | 0-20 | 20-40 | 40-60 | 60-80 | 80-100 | hiker-ticks |
|---|---|---|---|---|---|---|
| 6:00 | 74% | 18% | 3% | 4% | 1% | 1420 |
| 7:00 | 76% | 17% | 4% | 4% | 1% | 1411 |
| 8:00 | 78% | 15% | 3% | 3% | 0% | 1326 |
| 9:00 | 83% | 12% | 3% | 2% | 0% | 1515 |
| 10:00 | 84% | 12% | 1% | 1% | 1% | 1705 |
| 11:00 | 86% | 10% | 2% | 1% | 1% | 1842 |
| 12:00 | 86% | 11% | 3% | 0% | 1% | 1956 |
| 13:00 | 86% | 11% | 3% | 0% | 0% | 2078 |
| 14:00 | 84% | 13% | 3% | 0% | 0% | 2222 |
| 15:00 | 84% | 13% | 3% | 0% | 0% | 2472 |
| 16:00 | 84% | 14% | 2% | 1% | 0% | 2541 |
| 17:00 | 85% | 12% | 2% | 1% | 0% | 2444 |
| 18:00 | 82% | 14% | 1% | 2% | 0% | 2080 |
| 19:00 | 78% | 18% | 1% | 3% | 1% | 1675 |
| 20:00 | 76% | 18% | 2% | 3% | 1% | 1591 |
| 21:00 | 75% | 18% | 3% | 3% | 1% | 1574 |

### Arrival hour histogram (baseline, share of arrivals)

| hour | 64 | 128 | 256 |
|---|---|---|---|
| 7 | 0% | 0% | 0% |
| 8 | 11% | 11% | 9% |
| 9 | 18% | 13% | 14% |
| 10 | 11% | 13% | 12% |
| 11 | 7% | 11% | 9% |
| 12 | 16% | 13% | 14% |
| 13 | 10% | 12% | 12% |
| 14 | 12% | 12% | 11% |
| 15 | 12% | 12% | 17% |
| 16 | 3% | 4% | 2% |

### What-if scenarios, size 64

| scenario | hikers | mid | top third | summit | mean max alt | completed | ms/tick | income/run | queue min/guest |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 98 | 23% | 11% | 5% | 28% | 59% | 0.05 | 5954 | 1.5 |
| speed3 | 102 | 33% | 17% | 9% | 36% | 72% | 0.04 | 6005 | 1.1 |
| speed10 | 101 | 45% | 27% | 15% | 40% | 78% | 0.04 | 5654 | 1.6 |
| dusk1930 | 112 | 30% | 18% | 7% | 34% | 61% | 0.04 | 6069 | 1.7 |
| summit | 90 | 48% | 41% | 11% | 46% | 33% | 0.05 | 6581 | 1.9 |
| overnight | 98 | 29% | 19% | 10% | 33% | 60% | 0.04 | 6719 | 1.3 |
| excursion | 106 | 25% | 12% | 4% | 28% | 67% | 0.04 | 5920 | 1.4 |
| speed10summit | 100 | 73% | 66% | 24% | 60% | 75% | 0.05 | 5987 | 1.8 |
| excSummit | 103 | 45% | 41% | 17% | 44% | 53% | 0.04 | 6009 | 1.6 |
| excSummitLate | 97 | 69% | 59% | 25% | 59% | 64% | 0.04 | 6380 | 2.1 |
| combo | 101 | 64% | 56% | 21% | 58% | 68% | 0.04 | 6298 | 2.0 |

### What-if scenarios, size 128

| scenario | hikers | mid | top third | summit | mean max alt | completed | ms/tick | income/run | queue min/guest |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 125 | 20% | 17% | 4% | 21% | 30% | 0.10 | 7986 | 1.3 |
| speed3 | 129 | 26% | 19% | 4% | 29% | 54% | 0.09 | 6884 | 1.2 |
| speed10 | 118 | 49% | 42% | 3% | 44% | 79% | 0.09 | 7157 | 1.5 |
| dusk1930 | 126 | 20% | 17% | 2% | 25% | 34% | 0.09 | 7898 | 1.8 |
| summit | 118 | 30% | 25% | 3% | 28% | 9% | 0.10 | 8211 | 1.8 |
| overnight | 122 | 30% | 24% | 4% | 30% | 32% | 0.09 | 8755 | 1.3 |
| excursion | 126 | 31% | 24% | 2% | 32% | 56% | 0.09 | 8026 | 1.1 |
| speed10summit | 117 | 70% | 64% | 8% | 58% | 72% | 0.10 | 7535 | 1.8 |
| excSummit | 122 | 46% | 42% | 7% | 43% | 47% | 0.10 | 7739 | 1.5 |
| excSummitLate | 119 | 70% | 66% | 4% | 60% | 61% | 0.10 | 8084 | 2.1 |
| combo | 106 | 50% | 42% | 5% | 44% | 47% | 0.09 | 7405 | 2.2 |

### What-if scenarios, size 256

| scenario | hikers | mid | top third | summit | mean max alt | completed | ms/tick | income/run | queue min/guest |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 177 | 4% | 1% | 0% | 8% | 15% | 0.28 | 10415 | 0.7 |
| speed3 | 178 | 15% | 10% | 1% | 15% | 28% | 0.26 | 10471 | 0.6 |
| speed10 | 168 | 28% | 13% | 3% | 27% | 50% | 0.26 | 10035 | 1.0 |
| dusk1930 | 155 | 9% | 4% | 1% | 13% | 15% | 0.26 | 10567 | 1.1 |
| summit | 163 | 8% | 3% | 1% | 11% | 1% | 0.28 | 10276 | 0.9 |
| overnight | 169 | 7% | 1% | 0% | 12% | 16% | 0.26 | 11435 | 0.6 |
| excursion | 182 | 28% | 15% | 2% | 28% | 45% | 0.26 | 10457 | 0.8 |
| speed10summit | 171 | 37% | 36% | 4% | 33% | 37% | 0.27 | 10025 | 0.7 |
| excSummit | 158 | 46% | 39% | 3% | 42% | 45% | 0.27 | 10232 | 0.9 |
| excSummitLate | 159 | 60% | 55% | 4% | 52% | 61% | 0.43 | 10270 | 1.1 |
| combo | 164 | 24% | 22% | 2% | 26% | 10% | 0.26 | 10266 | 1.0 |


## Candidate fixes (ranked by measured effect; share of hikers reaching the top third, 64 / 128 / 256; baseline 11 / 17 / 1 %, mean max altitude 28 / 21 / 8 %)

| # | fix | top third | mean max alt | completed hikes | perf | risk / complexity |
|---|---|---|---|---|---|---|
| 1 | **(e + c + b) Excursion + top-third goals + dusk 19:30 / lift hours 08:00-19:30** (`excSummitLate`) | **59 / 66 / 55 %** | 59 / 60 / 52 % | 64 / 61 / 61 % | 0.04 / 0.10 / 0.43 ms/tick (baseline 0.05 / 0.10 / 0.28; the 256 spike is the longer day with more guests alive, not the excursion) | Medium: new per-hiker excursion state + seasonal daylight table; touches Decision, GuestSim dusk, LiftOps defaults. Scale-independent. |
| 2 | **(e + c) Excursion abstraction + top-third goals** (`excSummit`): hiker commits to a loop, progress along the path is time-compressed to ~3 game hours (~30 ticks) whatever the map size | **41 / 42 / 39 %** | 44 / 43 / 42 % | 53 / 47 / 45 % | no measurable cost (0.04-0.27 ms/tick), but it makes many guests re-path (cap 7 nodes/tick in this emulation) | Medium: ETA-driven progress, still render along the path; fixes the scale problem (works equally at 256) and the "leaving walk" if reused for the way home. |
| 3 | **(a + c) Hike speed x10 + top-third goals** (`speed10summit`) | 66 / 64 / **36 %** | 60 / 58 / 33 % | 75 / 72 / 37 % | none | Low (one constant + a goal bias) but **does not scale**: x10 still needs 6.2 h for the 256 summit; x25-x100 would be needed (real-world 4 km/h = x100), which makes trail walkers faster than skiers and breaks the shared nav speed table (needs per-tick need growth tuned too). |
| 4 | (a) Hike speed x10 alone | 27 / 42 / 13 % | 40 / 44 / 27 % | 78 / 79 / 50 % | none | Low; best "cheap" knob but still scale dependent and no summit bias. x3: 17 / 19 / 10 % (+6 / +2 / +9 points). |
| 5 | (e) Excursion alone | 12 / 24 / 15 % | 28 / 32 / 28 % | 67 / 56 / 45 % | none | goal bias missing: guests still pick random trail tiles (mean goal altitude 42-48 %). |
| 6 | (c) Top-third goals alone (hikers ride the lift when the planner finds it cheaper) | 41 / 25 / 3 % | 46 / 28 / 11 % | **33 / 9 / 1 %** | none | Works on 64 only; on 256 attempts die by timeout (0-1 % complete) and just add idle ticks; needs (a)/(e). |
| 7 | (b) Longer summer day alone (dusk 19:30, lifts 08:00-19:30) | 18 / 17 / 4 % (+7 / 0 / +3) | 34 / 25 / 13 % | 61 / 34 / 15 % | none | Low; but arrival window (07:30-15:30) was NOT stretched here (`SPAWN_*` are module constants); stretching arrivals to 17:00 would add a few points. Worth doing together with #1/#2 (+18 / +24 / +16 points over #2), not alone. Lighting (sunrise 06:00 / sunset 18:00 fixed) would need a season table. |
| 8 | (d) Multi-day stays: hikers flagged overnight (sleep out where they stand, resume 06:30, leave on day +2) | 19 / 24 / 1 % | 33 / 30 / 12 % | 60 / 32 / 16 % | none | The emulation ignores a hut as lodging; it just removes the dusk leave and the second morning start. Weak alone because the speed is still 0.04 km/h; real Mountain-Hut lodging needs a decision rule ("walk to hut by 18:00") and capacity. |
| 9 | (f) time-compress activity clock while on trails | = (a) (speed xN while on trail tiles; same numbers) | | | none | Only differs from (a) in also slowing hunger/fatigue growth; not run separately. |
| 10 | (g) change TICKS_PER_DAY / minutes per tick and scale speeds | = (a) x k (and all per-tick needs, timers, lift throughput, snow, finance would have to be rescaled) | | | **k x ticks per game day = k x CPU per day** (measured baseline 0.05-0.3 ms/tick); the real tick rate would need k x more steps for the same wall-clock day | Highest risk (saves, every `TICKS_PER_DAY` consumer, balance); not run (no way to override the constant without editing `src/`). |

Cross-cutting notes
* Nothing in the what-ifs changed queue length materially: mean queue time per guest stays 0.6-2.3 min (baseline 0.7-1.5; the summit-biased scenarios 1.7-2.3 min on 64/128, more people riding the foot lift) and ledger income per run stays within noise of baseline (5.7-6.7 k / 7.4-8.8 k / 9.8-11.4 k for 64 / 128 / 256). The only revenue lever is the trail fee (`hikeFee`) per completed trail visit; more completed hikes (+25-60 points) mean proportionally more trail fees.
* Combining #2 with the **leave walk fix** (departing hikers should ride the lift down or be "teleported" by the same excursion ETA rather than walk 0.4 tiles/tick) would remove the 5-18 h leave walks (finding 3) at no gameplay cost; not measured separately.
* The idle timers (finding 2) are the cheapest improvement not in the list: halving `rng.int(20,50)` after a trail visit would roughly double attempts per hiker; not run because it changes all guests' pacing, not only hikers.
* Hikers per cell are 90-180; differences under ~5-7 points between two scenarios are noise.

## Recommendation (for brainstorming, not implemented)
1. Decouple hiking from map-scale speed: represent a hike as an **excursion** with an ETA of 2-4 game hours (time-compressed progress along the real path, rendered along it), chosen from the whole trail network with a deliberate bias to the high trail tiles.
2. Make hikers' way home use the same abstraction (or the lift).
3. Add a seasonal daylight window (summer dusk 19:30-20:00, arrivals until ~17:00; lift summer hours default 08:00-19:30) and cut the 20-50 tick idle after trails.
4. Optionally give the Mountain Hut real overnight capacity so a second-day summit becomes a feature.
# Hiking analysis: why hikers never get high up the mountain

Analysis only: nothing in `src/` was changed. Headless measurements through the real `createSim` / `buildStarterResort` / placement and network APIs.

## Reproduce

```
npm run analysis:hiking:all          # full sweep in chunks (3 sizes x 11 scenarios x 5 seeds, ~8 min), prints the merged tables
npm run analysis:hiking              # one process; env: HIKING_SIZES=64,128,256 HIKING_SEEDS=11,23,37 HIKING_DAYS=10 HIKING_SCENARIOS=baseline,speed10 HIKING_OUT=path.json
npm run analysis:hiking:report       # merge scripts/analysis/out/*.json into the markdown tables below
```
Files: `scripts/analysis/hikingLib.ts` (resort builder, probe, scenarios, aggregation), `scripts/analysis/hikingReport.ts`, `scripts/analysis/hiking-all.sh`,
`tests/analysis/hiking.analysis.ts` (vitest entry; named `*.analysis.ts` and run with `vitest.analysis.config.ts`, so `npm test` never picks it up).
What-ifs mutate runtime values only (`NAV_SPEED.hike`, `GUEST_DUSK_HOUR` through a vitest module mock, lift hours via `liftOps.setHours`, a wrapper around `Decider.choose`, a per-tick post-step for the excursion / overnight emulation); nothing is committed.
Tip: a single long (> ~2.5 min) vitest process was SIGTERMed several times in this environment (exit 143, probably a sibling agent's cleanup), hence the chunked script with retries.

## Method

* Resort: `createSim({startSeason:'summer'})` (day = summer start + 20), starter resort with ONE 4-seat chairlift (carries foot/bike passengers; `activeMode` = `foot` in summer), then a **village -> summit hiking trail** (Dijkstra over free tiles, cost 1 + 6 |dAlt|, painted as `Layer.Hike`), a **lift-top -> summit trail**, a **lift-top -> village bike trail** (`Layer.Mtb`) and a Mountain Hut near the summit. Summit = the highest tile reachable from the village.
* Lift hours are the **real defaults 08:30-17:00** (the test harness' 06:00-22:00 override is NOT used). Guests: real spawner (arrival window 07:30-15:30, summer rate 0.6), real needs, real decider.
* 10 in-game days (2400 ticks) at the real tick/clock (240 ticks/day, 6 game-min/tick). Sizes 64/128/256, 5-6 seeds each (6 for the tables below), ~100-180 hikers (guests whose `prefFor` = Hike, 15-30 % of guests) per cell.
* Altitude % = (tile altitude - map min) / (map max - map min), i.e. share of terrain relief. Relief is 150 / 260 / 455 m on 64 / 128 / 256 (10 m per world unit); the village sits at 0 %, the starter lift top at 23-41 %.
* Per hiker: arrival hour, first tile on a trail layer, every hike attempt (goal altitude, planned path length incl. lift hops, start/end hour, outcome), max altitude, time above 50 / 67 %, time per activity, lift rides by movement mode, leave reason and leaving duration. Aggregated heatmaps by hour x altitude band.
* "Top third" = reached >= 67 % relief at any time; "summit" = came within 4 tiles of the summit tile (only meaningful on 64; the summit tile is often snowbound on 128/256); "mid" = >= 50 %.
* Noise: runs are not bit-identical between processes (other agents' systems, e.g. wildlife, use unseeded randomness; same-seed re-runs gave +-7 points on top-third share at n ~ 100). Read effects below ~5 points as noise.
* Income column = sum of `economy.ledger` deltas over the run (all income categories, not only hiking); at 5-8 k the hiking-specific part is far smaller than the noise, so it only shows "no side effects".

## Key findings (WHY hikers stay low)

**1. Speed scale: a trail tile costs 100x real time.** `NAV_SPEED.hike` = 0.4 tiles/tick on trail tiles = 4 tiles/h = **40 m/h (0.04 km/h)**; on footpaths (`walk` = 3) = 30 tiles/h = 0.3 km/h. A real hiker (4 km/h) would do 400 tiles/h, 100x ours on trails and 13x on paths. The summit trail from the village is **51 / 113 / 250 tiles** on 64 / 128 / 256 (lift-top -> summit 31 / 56 / 164): that is **13 / 28 / 62 hours of walking** (real: 8 / 17 / 38 minutes), against a lift/guest day of 8.5 h. Share of planned hike attempts that cannot be finished before 17:00 even if started on the spot: **64 % / 84 % / 96 %**. Completed attempts: 59 % / 30 % / 15 %. This is why the same map-scale fraction (top-third) gets worse as maps grow: 11 % / 17 % / 1 % of hikers reach the top third, mean max altitude 28 % / 21 % / 8 %, median 20 % / 0 % / 0 %.

**2. The day window is mostly gone before the first step.** Arrivals are uniform 08-16 (mean 12.1 h) but guests leave at 17:00 (`GUEST_DUSK_HOUR`), so the mean guest has **4.9 h** left. Arrival -> first trail tile takes **3.4 / 3.4 / 4.0 h** (70-80 % of that window) and the mean hike attempt starts at 12.4-12.6 h. Why: new guests idle 5 ticks, the decider runs only when the idle `timer` expires, and every finished activity parks the guest for `rng.int(10,40)` ticks (building: 1-4 h) or `rng.int(20,50)` ticks after a trail (**2-5 h**). Hikers are **idle 46-54 % of their time** and on a trail only 14-15 %; queues, lift riding, eating and attractions together are < 8 % (queue 0 %, ride 0 %, using 1-2 %, walking to buildings 3-4 %). Only 54-58 % of hikers make even one hike attempt (2.4-3.2 attempts each). So queues/eating are NOT the problem; idle timers and the day window are.

**3. Dusk-leave at 17:00 plus a leave walk at trail speed strands hikers on the mountain overnight.** 24-31 % of hikers (33-37 % of all guests) leave by "closing"; they keep their hike movement mode and walk out at 0.4 tiles/tick on trail tiles. Time spent in the Leaving state is **11 % / 21 % / 20 %** of alive time; hikers who start leaving above 30 % relief need on average **5.5 / 17.6 / 10.7 h** to get out (p90 9 / 46 / 12 h; n is small: 21 / 8 / 3 at these seeds), vs 1.0 / 2.8 / 3.7 h for guests who start low. Day-guest stay length is p10 / p50 / p90 = 2.4 / 6.8 / 27.7 h on 64 (2.0 / 6.4 / 29.6 on 128, 2.7 / 6.4 / 26.4 on 256): the p90 is guests still walking out the next day. 9 % / 20 % / 24 % of hike attempts (64 / 128 / 256) end as "aborted by dusk".

**4. The decision logic has no distance penalty, but it also has no reason to go high.** `Decider.choose` (hike): `score = (pref Hike ? 1.2 : skiLifts ? 0.08 : 0.6) - 0.6 fatigue - hikePenalty(0.3 near warning signs) + noise(0..0.25)`, goal = uniformly random one of <= 48 sampled snow-free trail tiles. No term depends on distance or altitude, so the **mean goal altitude is 42-48 % of relief regardless of map size** and (because the speed makes distant goals unreachable) most attempts to far goals are abandoned: no-path/unreachable/timeout aborts are 27 % / 40 % / 54 % of attempts (`unreachable` = goal tile cut off by a snowy tile on the trail, see below; `ACT_TIMEOUT` = 700 ticks = 2.9 days). The only brakes on the trip count are `rng.chance(visits*0.04 + runs*0.004)` -> leave (every trail visit adds 4 % per decision) and the 'home' candidate (0.03).
 Secondary causes:
 * **Lift use is marginal.** Only 16 % / 18 % / 10 % of hikers ever ride the foot lift (0.1-0.2 rides per hiker; 98 / 96 / 82 foot rides vs 8 / 17 / 4 bike rides in 10 days), because the path planner uses the lift only when it is cheaper for a random goal (22-29 % of planned paths contain a lift hop), the lift runs 08:30-17:00 and the starter lift tops out at 23-41 % of the relief (the "high" half of the mountain is 160+ tiles of trail beyond it on 256).
 * **Early-summer snow cuts routes.** At summer start + 20 days only 53-69 % of the trail tiles in the top third are snow-free (`hikeOk`); one snowy tile severs everything above it for hike mode (67-76 % by day 30).
 * **No lodging that helps hikers.** Overnight guests sleep wherever they stand (Sleeping state, 13-16 % of hiker time) and resume at 06:30, but only chalet guests (a minority) are flagged overnight, and nothing gives a hiker a reason to stay at a high hut.

## Baseline numbers


### Speeds

| movement | tiles/tick | tiles/hour | km/h (10 m tiles) |
|---|---|---|---|
| walk on path | 3 | 30 | 0.30 |
| hike on trail (off-path) | 0.4 | 4 | 0.04 |
| bike off-path downhill | 1.4 | 14 | 0.14 |
| bike on path | 0.84 | 8.4 | 0.08 |
| ski base | 2.2 | 22 | 0.22 |

### Trail geometry (mean of seeds)

| size | seeds | lift top rel. alt | trail lodge->summit (tiles) | lift top->summit | lift length | trail tiles | snow-free |
|---|---|---|---|---|---|---|---|
| 64 | 6 | 41% | 51.0 | 30.5 | 12.9 | 77.3 | 88% |
| 128 | 6 | 23% | 113.0 | 55.8 | 25.9 | 164.7 | 90% |
| 256 | 6 | 37% | 249.8 | 164.2 | 51.0 | 401.5 | 83% |

### Baseline per size

| metric | 64 | 128 | 256 |
|---|---|---|---|
| guests / hikers (pref=Hike) sampled | 434 / 98 | 534 / 125 | 710 / 177 |
| mean arrival hour | 12.1 | 12.2 | 12.2 |
| day-guest stay h (p10/p50/p90) | 2.4 / 6.8 / 27.7 | 2.0 / 6.4 / 29.6 | 2.7 / 6.4 / 26.4 |
| hikers with >=1 hike attempt | 57% | 58% | 54% |
| arrival -> first trail tile (h) | 3.5 | 3.4 | 4.0 |
| hike attempts / hiker | 3.2 | 3.0 | 2.4 |
| mean attempt start hour | 12.6 | 12.6 | 12.4 |
| mean path length (tiles) / goal rel. altitude | 25.6 / 43% | 56.7 / 42% | 128.7 / 45% |
| path includes a lift ride | 29% | 24% | 22% |
| attempts that cannot finish before 17:00 (path/hike-speed) | 64% | 84% | 96% |
| attempts completed | 59% | 30% | 15% |
| aborted: dusk / needs / random-satisfied / no-path|unreachable | 9% / 0% / 4% / 27% | 20% / 0% / 8% / 40% | 24% / 0% / 6% / 54% |
| hikers reaching mid (>=50 %) / top third (>=67 %) / summit | 23% / 11% / 5% | 20% / 17% / 4% | 4% / 1% / 0% |
| mean / median max altitude % | 28% / 20% | 21% / 0% | 8% / 0% |
| hours above 50 % / 67 % per hiker | 3.0 / 1.7 | 4.1 / 2.5 | 0.8 / 0.2 |
| hikers that rode the lift (share) / rides per hiker | 16% / 0.2 | 18% / 0.2 | 10% / 0.1 |
| lift rides by mode hike/bike/ski | 98/8/0 | 96/17/0 | 82/4/0 |
| leaving walk h for hikers who started leaving >=30 % up (mean / p90 / n) | 5.5 / 9.3 / 21 | 17.6 / 45.6 / 8 | 10.7 / 12.0 / 3 |
| leaving walk h for everyone below 30 % (mean / p90 / n) | 1.0 / 2.1 / 318 | 2.8 / 5.0 / 428 | 3.7 / 6.6 / 630 |
| left via dusk (all guests / hikers) | 33% / 24% | 34% / 29% | 37% / 31% |
| top-third trail tiles snow-free (start->end of run) | 57% -> 76% | 69% -> 75% | 53% -> 67% |
| abort reasons on trail goals | unreachable:35 wait22:3 | unreachable:19 | unreachable:42 wait22:3 |

### Hiker time budget (share of alive ticks, baseline)

| activity | 64 | 128 | 256 |
|---|---|---|---|
| trail | 14% | 14% | 15% |
| toBuilding | 3% | 4% | 4% |
| toLift | 0% | 0% | 0% |
| queue | 0% | 0% | 0% |
| ride | 0% | 0% | 0% |
| using | 2% | 1% | 1% |
| idle | 54% | 46% | 47% |
| leaving | 11% | 21% | 20% |
| sleeping | 16% | 14% | 13% |

### Heatmap: baseline hiker-ticks by hour x altitude band (share of the hour; bands 0-20 / 20-40 / 40-60 / 60-80 / 80-100 % of relief)

size 64: hour: band shares

| hour | 0-20 | 20-40 | 40-60 | 60-80 | 80-100 | hiker-ticks |
|---|---|---|---|---|---|---|
| 6:00 | 50% | 23% | 12% | 8% | 6% | 630 |
| 7:00 | 49% | 23% | 11% | 13% | 5% | 590 |
| 8:00 | 60% | 10% | 15% | 10% | 5% | 604 |
| 9:00 | 70% | 6% | 15% | 6% | 2% | 681 |
| 10:00 | 74% | 12% | 8% | 5% | 1% | 865 |
| 11:00 | 68% | 19% | 6% | 5% | 2% | 854 |
| 12:00 | 74% | 14% | 4% | 5% | 3% | 944 |
| 13:00 | 76% | 13% | 3% | 5% | 3% | 1076 |
| 14:00 | 75% | 11% | 6% | 5% | 3% | 1160 |
| 15:00 | 77% | 9% | 5% | 7% | 2% | 1215 |
| 16:00 | 77% | 7% | 6% | 7% | 3% | 1204 |
| 17:00 | 72% | 11% | 6% | 5% | 5% | 1020 |
| 18:00 | 67% | 14% | 6% | 8% | 5% | 809 |
| 19:00 | 65% | 15% | 5% | 8% | 7% | 738 |
| 20:00 | 59% | 18% | 8% | 10% | 6% | 718 |
| 21:00 | 54% | 19% | 10% | 9% | 7% | 672 |

size 128: hour: band shares

| hour | 0-20 | 20-40 | 40-60 | 60-80 | 80-100 | hiker-ticks |
|---|---|---|---|---|---|---|
| 6:00 | 58% | 13% | 13% | 12% | 4% | 1093 |
| 7:00 | 59% | 11% | 15% | 12% | 4% | 1078 |
| 8:00 | 64% | 10% | 12% | 11% | 2% | 970 |
| 9:00 | 68% | 12% | 10% | 9% | 2% | 1078 |
| 10:00 | 69% | 13% | 6% | 9% | 3% | 1161 |
| 11:00 | 69% | 14% | 5% | 9% | 3% | 1242 |
| 12:00 | 70% | 13% | 6% | 7% | 4% | 1357 |
| 13:00 | 71% | 13% | 4% | 7% | 5% | 1458 |
| 14:00 | 70% | 13% | 6% | 7% | 4% | 1516 |
| 15:00 | 72% | 11% | 6% | 7% | 4% | 1630 |
| 16:00 | 73% | 10% | 8% | 6% | 3% | 1713 |
| 17:00 | 71% | 12% | 8% | 5% | 3% | 1619 |
| 18:00 | 65% | 14% | 8% | 9% | 4% | 1369 |
| 19:00 | 61% | 20% | 4% | 11% | 4% | 1309 |
| 20:00 | 59% | 19% | 7% | 10% | 5% | 1250 |
| 21:00 | 58% | 17% | 10% | 9% | 6% | 1211 |

size 256: hour: band shares

| hour | 0-20 | 20-40 | 40-60 | 60-80 | 80-100 | hiker-ticks |
|---|---|---|---|---|---|---|
| 6:00 | 74% | 18% | 3% | 4% | 1% | 1420 |
| 7:00 | 76% | 17% | 4% | 4% | 1% | 1411 |
| 8:00 | 78% | 15% | 3% | 3% | 0% | 1326 |
| 9:00 | 83% | 12% | 3% | 2% | 0% | 1515 |
| 10:00 | 84% | 12% | 1% | 1% | 1% | 1705 |
| 11:00 | 86% | 10% | 2% | 1% | 1% | 1842 |
| 12:00 | 86% | 11% | 3% | 0% | 1% | 1956 |
| 13:00 | 86% | 11% | 3% | 0% | 0% | 2078 |
| 14:00 | 84% | 13% | 3% | 0% | 0% | 2222 |
| 15:00 | 84% | 13% | 3% | 0% | 0% | 2472 |
| 16:00 | 84% | 14% | 2% | 1% | 0% | 2541 |
| 17:00 | 85% | 12% | 2% | 1% | 0% | 2444 |
| 18:00 | 82% | 14% | 1% | 2% | 0% | 2080 |
| 19:00 | 78% | 18% | 1% | 3% | 1% | 1675 |
| 20:00 | 76% | 18% | 2% | 3% | 1% | 1591 |
| 21:00 | 75% | 18% | 3% | 3% | 1% | 1574 |

### Arrival hour histogram (baseline, share of arrivals)

| hour | 64 | 128 | 256 |
|---|---|---|---|
| 7 | 0% | 0% | 0% |
| 8 | 11% | 11% | 9% |
| 9 | 18% | 13% | 14% |
| 10 | 11% | 13% | 12% |
| 11 | 7% | 11% | 9% |
| 12 | 16% | 13% | 14% |
| 13 | 10% | 12% | 12% |
| 14 | 12% | 12% | 11% |
| 15 | 12% | 12% | 17% |
| 16 | 3% | 4% | 2% |

### What-if scenarios, size 64

| scenario | hikers | mid | top third | summit | mean max alt | completed | ms/tick | income/run | queue min/guest |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 98 | 23% | 11% | 5% | 28% | 59% | 0.05 | 5954 | 1.5 |
| speed3 | 102 | 33% | 17% | 9% | 36% | 72% | 0.04 | 6005 | 1.1 |
| speed10 | 101 | 45% | 27% | 15% | 40% | 78% | 0.04 | 5654 | 1.6 |
| dusk1930 | 112 | 30% | 18% | 7% | 34% | 61% | 0.04 | 6069 | 1.7 |
| summit | 90 | 48% | 41% | 11% | 46% | 33% | 0.05 | 6581 | 1.9 |
| overnight | 98 | 29% | 19% | 10% | 33% | 60% | 0.04 | 6719 | 1.3 |
| excursion | 106 | 25% | 12% | 4% | 28% | 67% | 0.04 | 5920 | 1.4 |
| speed10summit | 100 | 73% | 66% | 24% | 60% | 75% | 0.05 | 5987 | 1.8 |
| excSummit | 103 | 45% | 41% | 17% | 44% | 53% | 0.04 | 6009 | 1.6 |
| excSummitLate | 97 | 69% | 59% | 25% | 59% | 64% | 0.04 | 6380 | 2.1 |
| combo | 101 | 64% | 56% | 21% | 58% | 68% | 0.04 | 6298 | 2.0 |

### What-if scenarios, size 128

| scenario | hikers | mid | top third | summit | mean max alt | completed | ms/tick | income/run | queue min/guest |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 125 | 20% | 17% | 4% | 21% | 30% | 0.10 | 7986 | 1.3 |
| speed3 | 129 | 26% | 19% | 4% | 29% | 54% | 0.09 | 6884 | 1.2 |
| speed10 | 118 | 49% | 42% | 3% | 44% | 79% | 0.09 | 7157 | 1.5 |
| dusk1930 | 126 | 20% | 17% | 2% | 25% | 34% | 0.09 | 7898 | 1.8 |
| summit | 118 | 30% | 25% | 3% | 28% | 9% | 0.10 | 8211 | 1.8 |
| overnight | 122 | 30% | 24% | 4% | 30% | 32% | 0.09 | 8755 | 1.3 |
| excursion | 126 | 31% | 24% | 2% | 32% | 56% | 0.09 | 8026 | 1.1 |
| speed10summit | 117 | 70% | 64% | 8% | 58% | 72% | 0.10 | 7535 | 1.8 |
| excSummit | 122 | 46% | 42% | 7% | 43% | 47% | 0.10 | 7739 | 1.5 |
| excSummitLate | 119 | 70% | 66% | 4% | 60% | 61% | 0.10 | 8084 | 2.1 |
| combo | 106 | 50% | 42% | 5% | 44% | 47% | 0.09 | 7405 | 2.2 |

### What-if scenarios, size 256

| scenario | hikers | mid | top third | summit | mean max alt | completed | ms/tick | income/run | queue min/guest |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 177 | 4% | 1% | 0% | 8% | 15% | 0.28 | 10415 | 0.7 |
| speed3 | 178 | 15% | 10% | 1% | 15% | 28% | 0.26 | 10471 | 0.6 |
| speed10 | 168 | 28% | 13% | 3% | 27% | 50% | 0.26 | 10035 | 1.0 |
| dusk1930 | 155 | 9% | 4% | 1% | 13% | 15% | 0.26 | 10567 | 1.1 |
| summit | 163 | 8% | 3% | 1% | 11% | 1% | 0.28 | 10276 | 0.9 |
| overnight | 169 | 7% | 1% | 0% | 12% | 16% | 0.26 | 11435 | 0.6 |
| excursion | 182 | 28% | 15% | 2% | 28% | 45% | 0.26 | 10457 | 0.8 |
| speed10summit | 171 | 37% | 36% | 4% | 33% | 37% | 0.27 | 10025 | 0.7 |
| excSummit | 158 | 46% | 39% | 3% | 42% | 45% | 0.27 | 10232 | 0.9 |
| excSummitLate | 159 | 60% | 55% | 4% | 52% | 61% | 0.43 | 10270 | 1.1 |
| combo | 164 | 24% | 22% | 2% | 26% | 10% | 0.26 | 10266 | 1.0 |


## Candidate fixes (ranked by measured effect; share of hikers reaching the top third, 64 / 128 / 256; baseline 11 / 17 / 1 %, mean max altitude 28 / 21 / 8 %)

| # | fix | top third | mean max alt | completed hikes | perf | risk / complexity |
|---|---|---|---|---|---|---|
| 1 | **(e + c + b) Excursion + top-third goals + dusk 19:30 / lift hours 08:00-19:30** (`excSummitLate`) | **59 / 66 / 55 %** | 59 / 60 / 52 % | 64 / 61 / 61 % | 0.04 / 0.10 / 0.43 ms/tick (baseline 0.05 / 0.10 / 0.28; the 256 spike is the longer day with more guests alive, not the excursion) | Medium: new per-hiker excursion state + seasonal daylight table; touches Decision, GuestSim dusk, LiftOps defaults. Scale-independent. |
| 2 | **(e + c) Excursion abstraction + top-third goals** (`excSummit`): hiker commits to a loop, progress along the path is time-compressed to ~3 game hours (~30 ticks) whatever the map size | **41 / 42 / 39 %** | 44 / 43 / 42 % | 53 / 47 / 45 % | no measurable cost (0.04-0.27 ms/tick), but it makes many guests re-path (cap 7 nodes/tick in this emulation) | Medium: ETA-driven progress, still render along the path; fixes the scale problem (works equally at 256) and the "leaving walk" if reused for the way home. |
| 3 | **(a + c) Hike speed x10 + top-third goals** (`speed10summit`) | 66 / 64 / **36 %** | 60 / 58 / 33 % | 75 / 72 / 37 % | none | Low (one constant + a goal bias) but **does not scale**: x10 still needs 6.2 h for the 256 summit; x25-x100 would be needed (real-world 4 km/h = x100), which makes trail walkers faster than skiers and breaks the shared nav speed table (needs per-tick need growth tuned too). |
| 4 | (a) Hike speed x10 alone | 27 / 42 / 13 % | 40 / 44 / 27 % | 78 / 79 / 50 % | none | Low; best "cheap" knob but still scale dependent and no summit bias. x3: 17 / 19 / 10 % (+6 / +2 / +9 points). |
| 5 | (e) Excursion alone | 12 / 24 / 15 % | 28 / 32 / 28 % | 67 / 56 / 45 % | none | goal bias missing: guests still pick random trail tiles (mean goal altitude 42-48 %). |
| 6 | (c) Top-third goals alone (hikers ride the lift when the planner finds it cheaper) | 41 / 25 / 3 % | 46 / 28 / 11 % | **33 / 9 / 1 %** | none | Works on 64 only; on 256 attempts die by timeout (0-1 % complete) and just add idle ticks; needs (a)/(e). |
| 7 | (b) Longer summer day alone (dusk 19:30, lifts 08:00-19:30) | 18 / 17 / 4 % (+7 / 0 / +3) | 34 / 25 / 13 % | 61 / 34 / 15 % | none | Low; but arrival window (07:30-15:30) was NOT stretched here (`SPAWN_*` are module constants); stretching arrivals to 17:00 would add a few points. Worth doing together with #1/#2 (+18 / +24 / +16 points over #2), not alone. Lighting (sunrise 06:00 / sunset 18:00 fixed) would need a season table. |
| 8 | (d) Multi-day stays: hikers flagged overnight (sleep out where they stand, resume 06:30, leave on day +2) | 19 / 24 / 1 % | 33 / 30 / 12 % | 60 / 32 / 16 % | none | The emulation ignores a hut as lodging; it just removes the dusk leave and the second morning start. Weak alone because the speed is still 0.04 km/h; real Mountain-Hut lodging needs a decision rule ("walk to hut by 18:00") and capacity. |
| 9 | (f) time-compress activity clock while on trails | = (a) (speed xN while on trail tiles; same numbers) | | | none | Only differs from (a) in also slowing hunger/fatigue growth; not run separately. |
| 10 | (g) change TICKS_PER_DAY / minutes per tick and scale speeds | = (a) x k (and all per-tick needs, timers, lift throughput, snow, finance would have to be rescaled) | | | **k x ticks per game day = k x CPU per day** (measured baseline 0.05-0.3 ms/tick); the real tick rate would need k x more steps for the same wall-clock day | Highest risk (saves, every `TICKS_PER_DAY` consumer, balance); not run (no way to override the constant without editing `src/`). |

Cross-cutting notes
* Nothing in the what-ifs changed queue length materially: mean queue time per guest stays 0.6-2.3 min (baseline 0.7-1.5; the summit-biased scenarios 1.7-2.3 min on 64/128, more people riding the foot lift) and ledger income per run stays within noise of baseline (5.7-6.7 k / 7.4-8.8 k / 9.8-11.4 k for 64 / 128 / 256). The only revenue lever is the trail fee (`hikeFee`) per completed trail visit; more completed hikes (+25-60 points) mean proportionally more trail fees.
* Combining #2 with the **leave walk fix** (departing hikers should ride the lift down or be "teleported" by the same excursion ETA rather than walk 0.4 tiles/tick) would remove the 5-18 h leave walks (finding 3) at no gameplay cost; not measured separately.
* The idle timers (finding 2) are the cheapest improvement not in the list: halving `rng.int(20,50)` after a trail visit would roughly double attempts per hiker; not run because it changes all guests' pacing, not only hikers.
* Hikers per cell are 90-180; differences under ~5-7 points between two scenarios are noise.

## Recommendation (for brainstorming, not implemented)
1. Decouple hiking from map-scale speed: represent a hike as an **excursion** with an ETA of 2-4 game hours (time-compressed progress along the real path, rendered along it), chosen from the whole trail network with a deliberate bias to the high trail tiles.
2. Make hikers' way home use the same abstraction (or the lift).
3. Add a seasonal daylight window (summer dusk 19:30-20:00, arrivals until ~17:00; lift summer hours default 08:00-19:30) and cut the 20-50 tick idle after trails.
4. Optionally give the Mountain Hut real overnight capacity so a second-day summit becomes a feature.


## After: excursion model + appeal goals + foot lift first (docs/hiking.md)

Same resort/harness; `scripts/analysis/hiking-all.sh` now runs `legacy` (model off at runtime) vs `new`; 5 seeds x 10 summer days, real lift hours. The 'legacy' column re-measures the old behaviour with the new harness, so it differs slightly from the baseline tables above (noise, different seeds).

### Before (legacy) / after (excursion model + appeal goals + foot lift first)

| metric | 64 before | 64 after | 128 before | 128 after | 256 before | 256 after |
|---|---|---|---|---|---|---|
| hikers sampled | 89 | 78 | 96 | 90 | 140 | 128 |
| top third (>=67 %) | 19% | 53% | 13% | 54% | 1% | 34% |
| mid (>=50 %) | 35% | 67% | 21% | 59% | 3% | 41% |
| mean max altitude | 38% | 57% | 28% | 55% | 12% | 41% |
| attempts completed | 57% | 57% | 34% | 72% | 14% | 72% |
| hikers that rode a lift | 28% | 53% | 29% | 50% | 14% | 38% |
| excursions starting with a lift ride | - | 76% | - | 72% | - | 82% |
| arrival -> first trail (h) | 3.1 | 5.5 | 4.0 | 5.4 | 3.3 | 5.4 |
| income / run | 6875 | 6344 | 8304 | 7797 | 10868 | 10226 |
| queue min / guest | 3.1 | 4.9 | 3.0 | 4.3 | 1.7 | 3.7 |
| ms / tick | 0.06 | 0.05 | 0.11 | 0.10 | 0.29 | 0.28 |
| excursions started / aborted | - | 241 / 14 | - | 297 / 18 | - | 303 / 8 |
| trek nights / completed / bed revenue | 0 / 0 / 99 | 8 / 4 / 450 | 0 / 0 / 126 | 10 / 6 / 522 | 0 / 0 / 198 | 5 / 3 / 369 |


Reading: top-third target (>= 50 %) is met on 64 / 128 and missed on 256 (34 %): there the top third is ~160+ trail tiles above the 37 % lift top, 47 % of those tiles are still snow-bound early in summer and late arrivals cannot fit the 1.5 h minimum, so the share of hikers with a feasible high goal is lower. 'Hikers that rode a lift' is per hiker (38-53 %); per excursion 72-82 % started with the foot lift. Queue minutes per guest rose 3.1 -> 4.9 (one 4-seat chair now carries the hikers). Arrival -> first trail rose to ~5.4 h because hikers now skip goals that do not fit the daylight and wait for the lift. Overnight: 5-10 trek nights per run (64/128/256), $370-520 bed revenue.

## Update: speeds after the time-flow change

All tiles/tick figures above are the 24 s-day values. Now `NAV_SPEED.hike` = 1.9 tiles/tick (3 tiles/s on screen at 1x), walk 2.5 / 3.4 / 5.0 by map size; excursion progress is still per game hour. Re-measured with `npm run analysis:timeflow` (summer, 4 seeds, models M0 vs I): completed 67 / 77 / 59 % (was 71 / 72 / 74 %), top-third share 68 / 44 / 46 % (was 54 / 62 / 44 %), within the +-8 pp noise except 64 (better) and 256 (worse completion). `docs/time-flow.md` section 8.5.
