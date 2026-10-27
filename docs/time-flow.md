# Time flow: speeds, day length and the "everything is too fast" problem

**Status: IMPLEMENTED (phase 1 + calendar compression, see section 8 "Implemented").** Sections 1-7 are the analysis and proposal as written before the change ("today" = the old 24 s-day game). Reproduce: `npm run analysis:timeflow` (about 3 min; env `TIMEFLOW_SIZES`, `TIMEFLOW_SEEDS`, `TIMEFLOW_DAYS`,
`TIMEFLOW_HIKE_DAYS`, `TIMEFLOW_HIKE_SEEDS`, `TIMEFLOW_MODELS`) then `npm run analysis:timeflow:report` (Markdown tables, `scripts/analysis/out/timeflow.md`).
Code: `scripts/analysis/timeflowLib.ts` (+ `timeflowReport.ts`), `tests/analysis/timeflow.analysis.ts` (gated, not part of `npm test`), pure-part unit test `tests/scripts/timeflowLib.test.ts`.

## 1. Summary (one page)

**Finding.** On screen at 1x a guest walks **90 tiles/s = 900 m/s** (9 tiles/tick x 10 ticks/s), a skier **60-130 tiles/s** (measured mean 55-70, p95 100-130),
a car arriving on a 256 map **32 tiles/s**, the rescue helicopter 120, a patrol sled 40. Comfortable viewing at 40-60 px/tile is **1.5-2 tiles/s for walkers**, up to
6-8 tiles/s for fast things; above ~8 tiles/s the eye reads "teleport". Walkers are **45x** too fast, skiers **16-19x**, vehicles **2.5-8x**, hikers 2.7x, bikers 2-3.5x.
Only animals (1.1 tiles/s) and **lift carriers** (2.5-7 tiles/s, animated in real time, independent of the game speed) are already in the comfortable band.
At the "3x" button (the 4x tick rate) everything is x4 again (walk 360 tiles/s, 6 tiles per rendered frame).

**Root conflict.** Agent speed on screen = `tiles/tick x ticks/s`; the game-time cost of a trip = `tiles / (tiles/tick)` ticks. A 24 s day compresses game time 3600:1
(1 game hour = 1 real second), so an honest walker would need **504 tiles/s** and an honest skier 3600. The existing speeds were *already* inflated 5.6x (walk) and 28x (ski)
*in game time* only to keep a day's worth of activity inside the 24 s day: a guest walks 0.25 m/s and skis 0.36 m/s of **game** time. The visible speed is therefore not a
tuning slip but the price of three things we want at once: (a) a guest day with several runs, (b) a year that passes at a playable tempo, (c) 64-256 tile maps. At a comfortable
2 tiles/s a 75-tile walk (the 256-map guest) costs **37 real seconds = 1.5 whole days** at D=24 s; it fits only if a day lasts >= ~150 s.

**Recommendation: model Es ("slow the clock, keep the sim, decouple speeds per map").** No change to the tick sim or `TICKS_PER_DAY` (240): only real-time pacing, per-tick
agent speeds and a few render fixes.

| Constant | Today | Proposed |
|---|---|---|
| `REAL_SECONDS_PER_DAY_1X` | 24 s (10 ticks/s) | **150 s** (1.6 ticks/s); effective day with fast nights ~100 s |
| `SPEED_MULTIPLIERS` (buttons) | [0,1,2,4] = day 24/12/6 s | **[0,1,3,8]** = day **150 / 50 / 19 s** (1.6 / 4.8 / 12.8 ticks/s; max tick rate drops from 40 to ~13) |
| `NAV_SPEED.walk` (tiles/tick -> t/s @1x) | 9 (90) | **2.5 / 3.4 / 5.0 for 64 / 128 / 256 maps (4 / 5.5 / 8 t/s)** per map size (constant on-screen px/s at the zoom each map is played at) |
| `NAV_SPEED.hike` / `bike` | 0.4 (4) / 1.4 (14) | **1.9 (3) / 3.1 (5)** |
| `NAV_SPEED.skiBase` / `skiFlat` | 13.2 (132) / 3 (30) | **6.25 (10) / 1.4 (4.5)**: blue runs ~5-8 t/s measured |
| `VEHICLE_SPEED` (car, bus, train, plane) | 0.5, 0.4, 0.8, 1.5 (5-15 t/s base, 50 t/s at the 6-tick cap) | **5, 3.75, 7.5, 12.5** tiles/tick = 8 / 6 / 12 / 20 t/s; `VEHICLE_MAX_TRIP_TICKS` 6 and route cap 30 tiles unchanged (30 tiles = 3.75 s) |
| Patrol sled / walker / heli / snowcat groom / drive | 4 / 2 / 12 / 1.5 / 4 | 5 / 1.25 / 9.4 / 1.9 / 3.75 (8 / 2 / 15 / 3 / 6 t/s) |
| Fauna + livestock speed | 0.06-0.13 | x6.25 (keep today's on-screen 0.4-1.4 t/s; everything NOT listed above must be rescaled x6.25 to look the same) |
| Lifts (`LIFT_SECONDS_PER_TICK` 6, `LIFTS[].speed` carrier t/s, service times) | unchanged | **unchanged** (carriers are real-time 2.5-7 t/s; sim ride 3 ticks stays) |
| Fast-nights warp | x3 | x3 (unchanged) |
| `RIDE_TIME_SCALE` (ride-along slow-mo) | 0.15 | **1.0 / default Off**: the new 1x skier already reads ~8 t/s, the speed the 0.15 slow-mo produced (9.5 t/s) |
| Calendar (360 d, 30-day months, 2/4/2/4) | unchanged | phase 1 unchanged; **phase 2 optional**: 15-day months (180-day year), per-month rates /2 |

**Effect (headless, 6 game days x 3 seeds, winter starter resorts, M0 = today vs Es):**
guests/day identical (21 / 26 / 36 on 64 / 128 / 256); income per game day 2.8k / 3.4k / 3.9k vs 3.1k / 3.4k / 4.0k (-10 % / 0 / -1 %); runs per skier 2.7 / 1.8 / 1.2 vs
4.5 / 2.7 / 1.4 (-40 % / -33 % / -15 %), lift rides/day 31 / 27 / 18 vs 50 / 41 / 25; queue minutes lower (8.8 / 6.1 / 3.1 vs 14.3 / 9.1 / 4.3); rating 4.5 stars in all; stay 10-12 h in
all; hiking (summer, 4 seeds) completion 72 / 76 / 69 % vs 66 / 70 / 67 %, top-third share 56 / 59 / 44 % vs 50 / 58 / 53 % (noise +-8 pp). On-screen at 1x: walk 4-8 t/s (p95), ski-blue p95 8-9 t/s, cars 8 t/s
(was 50), a 20-tile walk 2.5-5 s (was 0.2 s); a guest stay lasts ~66-75 s of real time at 1x (was 10 s). Money per real minute at 1x drops 6.25x (7.7-9.9 k -> 1.1-1.6 k), but the new **8x equals today's 1x** (income/real-min 9-13 k)
and 3x ~ 3.3-4.7 k. Per-tick CPU cost is unchanged, the tick rate at the highest speed drops 3x (40 -> 13 ticks/s): more headroom.

**What it breaks / needs.** (1) Ski-run count falls 15-40 % because walking takes more game time; the 256 map stays walking-bound (36 % of presence walking) - open decision: shuttle /
closer village or even higher walk speed there. (2) Everything animated by `tick + alpha` (guest gait, bobbing) runs 6.25x slower at 1x: make the gait phase distance- or real-time based. (3) 1.6 ticks/s is coarse:
the linear tick-to-tick interpolation cuts path corners (by up to ~1 tile at 2.5 tiles/tick, estimated, not measured), HUD/hover latency up to 0.6 s. (4) A year takes 6x longer at 1x (15 h; winter 5 h) - the 8x button (winter 37 min,
year 112 min) and the optional 15-day months (winter 19 min at 8x) keep the tempo. (5) Tutorial/news/goals "per real minute" expectations need a pass. No save-format change in phase 1.

**Open decisions for you:** (a) day length 150 s (alternatives measured: 96 s breaks the 256 map: rides/guest 0.1; 300 s is the most faithful but a year is 30 h); (b) speed buttons [1,3,8] vs keep labels 1/2/3; (c) per-size walk
speeds (Es) vs one global speed; (d) calendar compression yes/no; (e) whether to hide/crowd-render agents above 3x (they will be 12-100 t/s again); (f) shuttle for 256 maps.

---

## 2. Measurements (current game, model M0)

Method: headless `createSim` winter starter resort (1 lift on 64, 2 on 128/256), 6 days, 3 seeds; per tick, per guest in the Walking/Leaving state, displacement `hypot(x - px, y - py)`
(the renderer's interpolation endpoints), excluding lift jumps. Vehicles from `spawner.vehicles`. Static speeds from the constants. Lift carriers from `LIFTS[].speed` (render real time).

### 2.1 On-screen speeds from the constants (1x = 10 ticks/s, "3x" = 40 ticks/s)

| Agent | tiles/tick | tiles/s 1x | m/s 1x | tiles/s "3x" | m/s "3x" | realistic | comfortable t/s | x too fast |
|---|---|---|---|---|---|---|---|---|
| Guest walking (paths) | 9.00 | 90.0 | 900 | 360.0 | 3600 | 1.4 m/s | 2 | 45.0x |
| Guest on piste, no slope (walk 0.8x) | 7.20 | 72.0 | 720 | 288.0 | 2880 | 1.4 m/s | 2 | 36.0x |
| Hiker off path (trail) | 0.40 | 4.0 | 40 | 16.0 | 160 | 1.1 m/s | 1.5 | 2.7x |
| Biker downhill (off path) | 1.40 | 14.0 | 140 | 56.0 | 560 | 5 m/s | 4 | 3.5x |
| Biker on path | 0.84 | 8.4 | 84 | 33.6 | 336 | 5 m/s | 4 | 2.1x |
| Skier on flat | 3.00 | 30.0 | 300 | 120.0 | 1200 | 1-3 m/s | 4 | 7.5x |
| Skier beginner, gentle slope (green) | 7.60 | 76.0 | 760 | 304.1 | 3041 | 5-15 m/s | 4 | 19.0x |
| Skier intermediate, medium slope (blue) | 10.20 | 102.0 | 1020 | 407.9 | 4079 | 5-15 m/s | 6 | 17.0x |
| Skier advanced, steep (red) | 13.40 | 134.0 | 1340 | 536.0 | 5360 | 5-15 m/s | 8 | 16.8x |
| Skier expert, very steep (black) | 16.00 | 160.0 | 1600 | 639.9 | 6399 | 5-15 m/s | 10 | 16.0x |
| Car base speed (never used on long routes) | 0.50 | 5.0 | 50 | 20.0 | 200 | 10-20 m/s | 8 | 0.6x |
| Car actual, 30-tile approach in 6 ticks | 5.00 | 50.0 | 500 | 200.0 | 2000 | 10-20 m/s | 8 | 6.3x |
| Bus base speed (never used on long routes) | 0.40 | 4.0 | 40 | 16.0 | 160 | 12 m/s | 6 | 0.7x |
| Bus actual, 30-tile approach in 6 ticks | 5.00 | 50.0 | 500 | 200.0 | 2000 | 12 m/s | 6 | 8.3x |
| Train base speed (never used on long routes) | 0.80 | 8.0 | 80 | 32.0 | 320 | 20-30 m/s | 12 | 0.7x |
| Train actual, 30-tile approach in 6 ticks | 5.00 | 50.0 | 500 | 200.0 | 2000 | 20-30 m/s | 12 | 4.2x |
| Plane base speed (never used on long routes) | 1.50 | 15.0 | 150 | 60.0 | 600 | 70 m/s | 20 | 0.8x |
| Plane actual, 30-tile approach in 6 ticks | 5.00 | 50.0 | 500 | 200.0 | 2000 | 70 m/s | 20 | 2.5x |
| Patrol sled (piste) | 4.00 | 40.0 | 400 | 160.0 | 1600 | 12 m/s | 8 | 5.0x |
| Patrol walker | 2.00 | 20.0 | 200 | 80.0 | 800 | 1.4 m/s | 2 | 10.0x |
| Rescue helicopter | 12.00 | 120.0 | 1200 | 480.0 | 4800 | 60 m/s | 15 | 8.0x |
| Snowcat grooming | 1.50 | 15.0 | 150 | 60.0 | 600 | 4 m/s | 3 | 5.0x |
| Snowcat driving | 4.00 | 40.0 | 400 | 160.0 | 1600 | 8 m/s | 6 | 6.7x |
| Deer walking (fauna) | 0.11 | 1.1 | 11 | 4.4 | 44 | 1.5 m/s | 1.5 | 0.7x |
| Deer fleeing | 0.24 | 2.4 | 24 | 9.7 | 97 | 10 m/s | 4.5 | 0.5x |
| Lift carrier tbar (render, real time) | - | 2.5 | 25 | 2.5 | 25 | 10 m/s | 6 | 0.4x |
| Lift carrier chair2 (render, real time) | - | 3.0 | 30 | 3.0 | 30 | 10 m/s | 6 | 0.5x |
| Lift carrier chair4 (render, real time) | - | 4.0 | 40 | 4.0 | 40 | 10 m/s | 6 | 0.7x |
| Lift carrier chair4d (render, real time) | - | 5.0 | 50 | 5.0 | 50 | 10 m/s | 6 | 0.8x |
| Lift carrier chair6 (render, real time) | - | 5.5 | 55 | 5.5 | 55 | 10 m/s | 6 | 0.9x |
| Lift carrier chair6b (render, real time) | - | 5.5 | 55 | 5.5 | 55 | 10 m/s | 6 | 0.9x |
| Lift carrier chair8b (render, real time) | - | 6.0 | 60 | 6.0 | 60 | 10 m/s | 6 | 1.0x |
| Lift carrier gondola6 (render, real time) | - | 6.0 | 60 | 6.0 | 60 | 10 m/s | 6 | 1.0x |
| Lift carrier gondola10 (render, real time) | - | 6.5 | 65 | 6.5 | 65 | 10 m/s | 6 | 1.1x |
| Lift carrier cablecar (render, real time) | - | 7.0 | 70 | 7.0 | 70 | 10 m/s | 6 | 1.2x |
| Lift carrier funicular (render, real time) | - | 5.0 | 50 | 5.0 | 50 | 10 m/s | 6 | 0.8x |

Realistic references: walk 1.4 m/s, hike 1.1, bike 5, ski 5-15, chairlift 1.2-2.5, gondola 6, cable car 10, car 10-20, train 20-30. Comfortable targets (`COMFORT` in `timeflowLib.ts`): walk 2, hike 1.5, bike 4,
ski 4/6/8/10 t/s by colour, car 8, bus 6, train 12, plane 20, sled 8, heli 15, snowcat 3. Note the lift **sim** side: a 60-tile chair4 ride is `ceil(15 s / LIFT_SECONDS_PER_TICK 6)` = 3 ticks = 0.3 s of real time at
1x, while the carriers (hidden riders) are animated at 4 t/s real time = 15 s: two time bases that never agree (50x apart today, 8x with Es).

### 2.2 Measured in the sim (M0)

| map | mode | samples | mean t/tick | p95 | max | mean t/s @1x | p95 t/s @1x |
|---|---|---|---|---|---|---|---|
| 64 | walk | 1927 | 4.64 | 8.36 | 9.00 | 46 | 84 |
| 64 | ski-blue | 263 | 6.11 | 10.27 | 11.23 | 61 | 103 |
| 64 | ski-red | 417 | 6.63 | 11.09 | 11.98 | 66 | 111 |
| 64 | ski-black | 476 | 6.85 | 11.41 | 12.35 | 69 | 114 |
| 64 | ski-off | 18 | 6.39 | 6.60 | 6.89 | 64 | 66 |
| 128 | walk | 2684 | 6.18 | 9.00 | 11.85 | 62 | 90 |
| 128 | ski-blue | 1371 | 5.46 | 10.51 | 13.94 | 55 | 105 |
| 128 | ski-red | 1202 | 5.63 | 11.79 | 14.36 | 56 | 118 |
| 128 | ski-black | 1579 | 5.73 | 12.95 | 16.03 | 57 | 129 |
| 128 | ski-off | 184 | 5.16 | 8.17 | 9.08 | 52 | 82 |
| 256 | walk | 7275 | 6.79 | 9.00 | 10.26 | 68 | 90 |
| 256 | ski-blue | 2875 | 6.67 | 11.39 | 13.94 | 67 | 114 |
| 256 | ski-red | 2982 | 6.74 | 12.18 | 15.16 | 67 | 122 |
| 256 | ski-black | 2930 | 6.78 | 13.12 | 17.60 | 68 | 131 |
| 256 | ski-off | 199 | 7.76 | 14.47 | 17.60 | 78 | 145 |

(Mean < theoretical because a path's last/first tick is partial; p95 is the cruising speed. Skiers on `ski-off` / flat are slower; max 17.5 tiles/tick.)

| map | kind | n | tiles/tick | tiles/s @1x | mean trip ticks | trip real s @1x |
|---|---|---|---|---|---|---|
| 64 | car | 156 | 0.50 | 5 | 6.0 | 0.6 |
| 128 | car | 185 | 1.33 | 13 | 7.0 | 0.7 |
| 256 | car | 272 | 3.17 | 32 | 6.0 | 0.6 |

Only cars occur in the starter resorts; bus/train/plane use the same `tripPlan` (30-tile cap, <= 6 ticks): up to 5 tiles/tick = **50 tiles/s at 1x**. A car on a 256 map crosses its 19-tile approach
in 6 ticks = 0.6 s.

### 2.3 Time budget of a guest day at 1x (the game day is 24 s long)

| map | guests/day | presence h | ticks walking share | tiles walked/guest | walk ticks now | walk ticks @ comfortable | walk h now | walk h @ comfortable (D=24) | real s walking @1x now | real s @ 2 t/s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 | 21.1 | 12.3 | 7% | 23 | 2.6 | 116 | 0.3 | 12 | 0.3 | 12 |
| 128 | 26.3 | 9.9 | 15% | 35 | 3.9 | 175 | 0.4 | 18 | 0.4 | 18 |
| 256 | 35.8 | 9.8 | 26% | 78 | 8.7 | 389 | 0.9 | 39 | 0.9 | 39 |

The "walk h @ comfortable" columns assume the same tiles at 2 t/s on the current 24 s day: a 64-map guest would spend **11 game hours** walking (the whole stay), a 256-map guest **37** (1.5 days). "Whole stay"
below is real seconds on screen:

| map | model | sec/tick | whole stay s | walking s | ski-mode moving s (runs + walk to lift) | queueing s | runs/skier | one 20-tile walk s |
|---|---|---|---|---|---|---|---|---|
| 64 | M0 | 0.10 | 12 | 0.5 | 0.3 | 0.2 | 4.5 | 0.2 |
| 64 | A | 1.25 | 157 | 18.4 | 12.3 | 1.7 | 2.2 | 10.0 |
| 64 | E | 0.63 | 66 | 8.8 | 7.2 | 0.9 | 2.7 | 5.0 |
| 128 | M0 | 0.10 | 10 | 0.6 | 0.9 | 0.2 | 2.7 | 0.2 |
| 128 | A | 1.25 | 143 | 24.8 | 20.3 | 1.0 | 1.6 | 10.0 |
| 128 | E | 0.63 | 75 | 11.3 | 10.8 | 0.5 | 1.7 | 5.0 |
| 256 | M0 | 0.10 | 10 | 1.2 | 1.4 | 0.1 | 1.4 | 0.2 |
| 256 | A | 1.25 | 136 | 39.1 | 22.9 | 0.4 | 1.2 | 10.0 |
| 256 | E | 0.63 | 66 | 19.0 | 14.3 | 0.2 | 1.1 | 5.0 |

Today a whole guest day (arrival -> lunch -> N runs -> leave) is **10-12 real seconds**; a queue of 14 game minutes lasts 0.2 s; one ski run 0.1-0.6 s. Nothing in a guest's day can be watched.

### 2.4 Frame-to-frame interpolation (what the player really sees)

`TickLoop.alpha` = fraction of the current tick; `GuestRenderer` lerps `px -> x` linearly (`s.px + (s.x - s.px) * alpha`), vehicles extrapolate `dist + speed * alpha`. At 60 fps and 10 ticks/s a frame is 1/6 of a tick:
a walker (9 tiles/tick) moves **1.5 tiles = 75 px per frame** and is drawn on a straight chord between two sim positions up to 9 tiles apart (it cuts every corner of the path, over buildings and water). The ski speed 13 tiles/tick
is 2.2 tiles per frame. At the 4x tick rate (40 ticks/s) the interpolation window is 25 ms (1.5 frames): a walker covers 6 tiles per frame, interpolation is meaningless and agents "blink" between ticks.
Interpolation is therefore not what saves us - it only hides the 10 Hz staircase of motions that are already 20-50x too fast. With 2.5-5 tiles/tick at 1.6 ticks/s (Es) the chord/path deviation is about a tile at most (estimate) and a frame moves 3-6 px.

## 3. The trade-off in numbers

Let `D` = real seconds per game day at 1x, `T` = 240 ticks/day, `v` = agent speed in tiles/tick, `L` = trip length in tiles.

* on-screen speed `s = v T / D` tiles/s; real seconds of a trip `L / s`; share of the 24 game hours it eats = `L / (s D)`;
* honest clock: `s_honest = v_real(m/s) x (86400 / D) / 10 m`: walk 504 / 202 / 101 / 50 / 40 tiles/s for D = 24 / 60 / 120 / 240 / 300 s; ski (10 m/s) 3600 -> 288 tiles/s.

| day at 1x (s) | game h per real s | walk 1.4 m/s => tiles/s | ski 10 m/s => tiles/s | chair 2 m/s => tiles/s |
|---|---|---|---|---|
| 24 | 1.00 | 504.0 | 3600.0 | 720.0 |
| 60 | 0.40 | 201.6 | 1440.0 | 288.0 |
| 120 | 0.20 | 100.8 | 720.0 | 144.0 |
| 240 | 0.10 | 50.4 | 360.0 | 72.0 |
| 300 | 0.08 | 40.3 | 288.0 | 57.6 |

Walking-only costs: with the measured tiles walked per guest (22 / 33 / 75 on 64 / 128 / 256; ski-mode approach walking comes on top) the share of the day spent walking is `tiles / (s x D)`:

| s (t/s) \ D | 24 s | 60 s | 150 s | 300 s |
|---|---|---|---|---|
| 2 | 46 / 69 / 156 % | 18 / 28 / 63 % | 7 / 11 / 25 % | 4 / 5.5 / 12.5 % |
| 4 | 23 / 34 / 78 % | 9 / 14 / 31 % | 3.7 / 5.5 / 12.5 % | 1.8 / 2.8 / 6 % |
| 8 | 11 / 17 / 39 % | 4.6 / 7 / 16 % | 1.8 / 2.8 / 6 % | 0.9 / 1.4 / 3 % |

(64 / 128 / 256 maps.) Comfortable walking (2 t/s) is only compatible with the day structure when D >= ~150-300 s; the 24 s day can only ever show walkers at >= 20 t/s. Conversely, a longer day makes the
**calendar** the problem: a 360-day year at D = 150 s is 15 h at 1x (today 2.4 h); at D = 300 s 30 h.

Why the speeds were inflated (from the pacing history in `docs/pacing-news-names.md`, `NAV_SPEED_LEGACY`): at the original 180 s day (1.33 ticks/s) a walk of 0.6 tiles/tick was 0.8 tiles/s - comfortable.
Shortening the day to 24 s (a year at 3 min/day = 18 h was rejected) multiplied every per-tick speed by 7.5 (walk 6 t/s), and the later scale-ups (walk 0.6 -> 3 -> 9, ski 2.2 -> 13.2, vehicle trips compressed to <= 6 ticks;
needed because a 60 m-drop run took 3 game hours and walking 30 tiles took 10 ticks, and 256-map distances) took it to 90 t/s. Each step was a rational fix of the game-time budget and each made the picture worse.

## 4. Models

All prototypes run the same 240-tick sim. A model is `{D, speed multipliers on NAV_SPEED, lift seconds/tick, vehicle trip cap}`; models that change `TICKS_PER_DAY` are equivalent in game time to scaling the speeds in
tiles/tick (`timeflowLib.ts` header), so the prototype covers them. Chaser/lag numbers come from the same traces (sim untouched).

| Model | What | Fixes | Breaks / costs |
|---|---|---|---|
| **M0** current | D = 24 s, walk 9, ski 13 t/tick | day structure, year tempo (2.4 h/yr at 1x) | everything 16-45x too fast; a guest day = 10 s |
| **A** slow day | D = 300 s (5 min), comfortable speeds (walk 2, hike 1.5, bike 4, ski 6 t/s), honest lift time (1.25 s per tick); **A2** same with arcade lifts (6 s/tick); **A3** D = 120 s | speeds comfortable, a guest stay is 2-3 real minutes, queues/runs watchable | year 30 h at 1x (needs calendar compression x6-12 and a rebalance of every per-day/month constant); honest lifts halve runs; A3 on 256: **0.8 runs/skier, 0 lift rides/guest, 33 % hike completion** (guests never reach the lift) |
| **B** decoupled activity time | sim cost of a trip is abstract (cap like `VEHICLE_MAX_TRIP_TICKS`/excursion ETA), drawn agent moves at a comfortable speed | keeps today's day structure exactly | sim position and picture disagree: see C |
| **C** visual dilation / chaser | drawn position follows the sim path at <= comfortable speed | no sim change | measured lag (below): mean 4.6 / 17 / 41 s, p95 15 / 58 / 137 s on 64 / 128 / 256 (50-95 % of moving agent-ticks > 3 s behind): the picture is permanently minutes behind, queues/lifts/needs do not match what is drawn. Only viable as a *small* correction on top of a slower sim speed (E: lag p95 4 / 7 / 15 s against the 2 t/s walker chaser) |
| **D** smaller tile (3-4 m) | `TILE_METRES` 10 -> 3.5 | m/s labels become believable (4 t/s = 14 m/s...) | zero effect on tiles/s on screen and on game-time budgets; relief/lift lengths/costs/slope limits are defined in tiles x metres (a 90-tile chair becomes 315 m) - a full retune. Rejected |
| **E / Es** hybrid (recommended) | A-like pacing with the calendar kept: D = 150 s, [1,3,8] buttons, speeds at the "acceptable" tier, walk speed per map size, arcade lifts, vehicles at the existing 6-tick cap | measured below | see summary |

### 4.1 Prototype results (headless)

| map | model | day s | walk p95 t/s | ski blue p95 t/s | guests/day | runs/skier | lift rides/guest | lift rides/day | income/day | income / real min | queue min | stars | walk share | ms/tick | hikers / done % / top3 % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 64 | M0 | 24 | 83.6 | 102.7 | 21.1 | 4.5 | 2.4 | 50 | 3082 | 7704 | 14.3 | 4.5 | 7% | 0.11 | 15 / 66% / 50% |
| 64 | A | 300 | 2.0 | 4.3 | 21.1 | 2.2 | 1.1 | 24 | 3014 | 603 | 8.0 | 4.5 | 20% | 0.07 | 15 / 60% / 48% |
| 64 | A2 | 300 | 2.0 | 4.3 | 21.2 | 2.8 | 1.3 | 28 | 2943 | 589 | 7.8 | 4.5 | 21% | 0.07 | 14 / 66% / 47% |
| 64 | A3 | 120 | 2.0 | 5.0 | 21.2 | 1.9 | 0.7 | 16 | 3013 | 1507 | 4.4 | 4.5 | 39% | 0.06 | 13 / 48% / 39% |
| 64 | E | 150 | 4.0 | 8.1 | 21.3 | 2.7 | 1.4 | 31 | 2767 | 1107 | 8.8 | 4.5 | 24% | 0.08 | 15 / 62% / 49% |
| 64 | Eh | 150 | 4.0 | 8.1 | 21.3 | 2.7 | 1.4 | 31 | 2767 | 1107 | 8.8 | 4.5 | 24% | 0.09 | 14 / 67% / 45% |
| 64 | Es | 150 | 4.0 | 8.1 | 21.3 | 2.7 | 1.4 | 31 | 2767 | 1107 | 8.8 | 4.5 | 24% | 0.07 | 15 / 72% / 56% |
| 64 | E96 | 96 | 4.0 | 8.6 | 21.2 | 2.1 | 1.0 | 20 | 2801 | 1751 | 5.8 | 4.5 | 27% | 0.06 | 16 / 69% / 44% |
| 128 | M0 | 24 | 90.0 | 105.1 | 26.3 | 2.7 | 1.5 | 41 | 3385 | 8463 | 9.1 | 4.5 | 15% | 0.14 | 17 / 70% / 58% |
| 128 | A | 300 | 2.0 | 4.8 | 25.8 | 1.6 | 0.8 | 20 | 3369 | 674 | 5.0 | 4.5 | 32% | 0.17 | 17 / 65% / 38% |
| 128 | A2 | 300 | 2.0 | 4.9 | 25.7 | 1.8 | 0.8 | 21 | 3322 | 664 | 4.8 | 4.5 | 32% | 0.12 | 16 / 76% / 49% |
| 128 | A3 | 120 | 2.0 | 5.1 | 25.2 | 1.4 | 0.5 | 12 | 3168 | 1584 | 2.8 | 4.5 | 51% | 0.12 | 17 / 61% / 49% |
| 128 | E | 150 | 4.0 | 8.3 | 26.0 | 1.7 | 0.8 | 22 | 3347 | 1339 | 5.1 | 4.5 | 30% | 0.13 | 17 / 79% / 50% |
| 128 | Eh | 150 | 4.0 | 8.3 | 26.0 | 1.7 | 0.8 | 22 | 3347 | 1339 | 5.1 | 4.5 | 30% | 0.13 | 17 / 65% / 39% |
| 128 | Es | 150 | 5.5 | 8.5 | 26.3 | 1.8 | 0.9 | 27 | 3373 | 1349 | 6.1 | 4.5 | 28% | 0.13 | 19 / 76% / 59% |
| 128 | E96 | 96 | 4.0 | 8.5 | 26.4 | 1.5 | 0.6 | 17 | 3326 | 2079 | 3.8 | 4.5 | 43% | 0.13 | 17 / 66% / 50% |
| 256 | M0 | 24 | 90.0 | 113.9 | 35.8 | 1.4 | 0.7 | 25 | 3959 | 9898 | 4.3 | 4.5 | 26% | 0.42 | 23 / 67% / 53% |
| 256 | A | 300 | 2.0 | 4.5 | 35.4 | 1.2 | 0.3 | 10 | 3733 | 747 | 1.9 | 4.5 | 46% | 0.40 | 21 / 48% / 31% |
| 256 | A2 | 300 | 2.0 | 4.9 | 35.8 | 1.1 | 0.3 | 10 | 3808 | 762 | 1.8 | 4.5 | 44% | 0.37 | 21 / 59% / 48% |
| 256 | A3 | 120 | 2.0 | 2.8 | 34.7 | 0.8 | 0.0 | 2 | 3532 | 1766 | 0.3 | 4.5 | 62% | 0.34 | 22 / 33% / 10% |
| 256 | E | 150 | 4.0 | 8.5 | 35.5 | 1.1 | 0.3 | 11 | 3778 | 1511 | 2.0 | 4.5 | 50% | 0.39 | 19 / 57% / 33% |
| 256 | Eh | 150 | 4.0 | 8.5 | 35.5 | 1.1 | 0.3 | 11 | 3778 | 1511 | 2.0 | 4.5 | 50% | 1.31 | 24 / 51% / 39% |
| 256 | Es | 150 | 8.0 | 9.0 | 35.5 | 1.2 | 0.5 | 18 | 3906 | 1563 | 3.1 | 4.5 | 36% | 1.03 | 22 / 69% / 44% |
| 256 | E96 | 96 | 4.0 | 7.1 | 34.3 | 1.3 | 0.1 | 5 | 3655 | 2284 | 0.8 | 4.3 | 56% | 0.42 | 25 / 50% / 27% |

Model key: **E** D=150 s, walk 4 / hike 2 / bike 5 / ski 10 t/s; **Eh** E with 4 t/s hikers (same ski numbers; hiking column differs); **Es** E with walk 4 / 5.5 / 8 t/s on 64 / 128 / 256 and hike 3 t/s; **E96** E at a
96 s day. Walk/ski columns are the p95 on-screen speed at 1x. Noise: ski numbers +-0.1 runs, hiking +-8 pp (7-23 hikers per run).

Reading the table: slower per-tick speeds cost runs on every map (A: -51 %, -41 %, -14 % runs per skier on 64 / 128 / 256), the 256 map is the fragile one (E96 / A3 collapse), and income per game day barely moves because arrivals, food and tickets dominate
- the bot/balance shape (per game month) is preserved while income per **real** minute scales with `1/D` (the "income / real min" column).

### 4.2 Visual-chaser lag (model C)

| map | model | mean lag s | p95 lag s | moving-agent-ticks with lag > 3 s | with lag > 10 tiles |
|---|---|---|---|---|---|
| 64 | M0 | 4.6 | 14.5 | 49% | 46% |
| 64 | E | 1.2 | 3.9 | 12% | 1% |
| 128 | M0 | 16.8 | 58.0 | 84% | 86% |
| 128 | E | 1.8 | 6.6 | 26% | 11% |
| 256 | M0 | 40.6 | 136.5 | 95% | 93% |
| 256 | E | 4.1 | 14.9 | 44% | 31% |

### 4.3 Pacing (real minutes)

| model | speed | day s | ticks/s | 360-day year min | 120-day winter min |
|---|---|---|---|---|---|
| M0 | 1x | 24 | 10.0 | 144 | 48 |
| M0 | 2x | 12 | 20.0 | 72 | 24 |
| M0 | 3x(=4x rate) | 6 | 40.0 | 36 | 12 |
| A | 1x | 300 | 0.8 | 1800 | 600 |
| A | 2x | 150 | 1.6 | 900 | 300 |
| A | 3x(=4x rate) | 75 | 3.2 | 450 | 150 |
| A2 | 1x | 300 | 0.8 | 1800 | 600 |
| A2 | 2x | 150 | 1.6 | 900 | 300 |
| A2 | 3x(=4x rate) | 75 | 3.2 | 450 | 150 |
| A3 | 1x | 120 | 2.0 | 720 | 240 |
| A3 | 2x | 60 | 4.0 | 360 | 120 |
| A3 | 3x(=4x rate) | 30 | 8.0 | 180 | 60 |
| E | 1x | 150 | 1.6 | 900 | 300 |
| E | 2x | 75 | 3.2 | 450 | 150 |
| E | 3x(=4x rate) | 38 | 6.4 | 225 | 75 |
| Eh | 1x | 150 | 1.6 | 900 | 300 |
| Eh | 2x | 75 | 3.2 | 450 | 150 |
| Eh | 3x(=4x rate) | 38 | 6.4 | 225 | 75 |
| Es | 1x | 150 | 1.6 | 900 | 300 |
| Es | 2x | 75 | 3.2 | 450 | 150 |
| Es | 3x(=4x rate) | 38 | 6.4 | 225 | 75 |
| E96 | 1x | 96 | 2.5 | 576 | 192 |
| E96 | 2x | 48 | 5.0 | 288 | 96 |
| E96 | 3x(=4x rate) | 24 | 10.0 | 144 | 48 |

Fast nights: x3 between ~sunset+45 min and ~sunrise-45 min (about 11-12 h in winter): the effective day at 1x is ~100 s for D = 150 s (~0.68 D), and a winter night passes in ~4 s.

## 5. Effects of the recommendation (Es)

* **Balance.** Sim ticks identical -> per-game-day economy unchanged within the measured -10..0 %. Fewer ski runs/day per guest (-15..-40 %) is the visible change: tune by walk speed per map size / lift capacity
  (queue minutes are already lower, so lifts are less stressed) or accept. Loan interest, wages, upkeep are per game day/month: **identical per game time, 6.25x lower per real minute at 1x** (same as 1x -> 8x is the old 1x).
  Bot results (`test:balance`) are in game time and need no re-baselining in phase 1.
* **Arrivals / day structure.** Arrival window 08:30-15:30, leave hours, dusk, lift hours in game hours: unchanged; the stay lasts 66-75 s real at 1x (guest rows in the inspector change by 1 hour/6 s).
* **Day/night.** Visual: 8:00-17:00 (daylight, the part players watch) lasts ~56 s at 1x instead of 9 s; dusk/dawn golden hours become watchable. Fast nights stay.
* **Audio/music.** Not tied to the sim (real-time). Only tick-driven cadences (queue chatter, ambience events per tick) become 6.25x sparser at 1x: use game-hour events or real time.
* **Ride-along / walk mode.** Ride-along slow-mo (`RIDE_TIME_SCALE` 0.15, ~9.5 t/s) becomes unnecessary: Es at 1x already gives 8-9 t/s p95; set 1.0 and default the setting Off (keep the setting for 3x/8x). Walk mode is real time: unaffected.
* **Tutorial.** Steps use speed indices (`setSpeed(2|3)`, `fastForward(240)`) -> keep 4 states; waiting for the first guest takes ~6 real seconds per game hour at 1x -> the tutorial should switch to 3x when idle (it already does for `anyGuests`).
* **Hiking excursions.** Excursion ETA is in ticks: hikers at 3 t/s (1.9 tiles/tick) cover 3.4x more per tick than today; measured completion/top-third within noise (see 4.1; with walk 4 t/s and hike 2 t/s the top-third share on 256 fell to 33 % - the walk to the trailhead is what costs time).
* **Queues / services.** `serviceTicks` (5-15 ticks) = 3-9 s real at 1x (was 0.5-1.5 s): meals and rentals become visible events; queue patience (ticks) unchanged = game minutes unchanged.
* **Perf.** ms/tick unchanged; ticks/s at 1x 10 -> 1.6; max 40 -> ~13 (x3 warp: 38). `MAX_CATCHUP_STEPS` 8 is fine.
* **Saves.** Phase 1: no format change (pacing and speeds are not persisted; guests mid-path continue; `Excursions` state is in ticks). Phase 2 (calendar): `date.day`, `leaveDay`, news/goal day stamps, snow day, finance month buckets
  need a migration (`day' = floor(day / 2)`, bump `SAVE_FORMAT_VERSION`, see `persist/migrations.ts`).

## 6. Implementation plan

Phase 1 (pacing + speeds, no sim logic change; ~1 day of work + playtest)
1. `src/config/balance.ts`: `REAL_SECONDS_PER_DAY_1X` 24 -> 150; `SPEED_MULTIPLIERS` -> [0,1,3,8]; `NAV_SPEED` becomes a per-map-size profile (`navSpeedFor(size)`: walk 2.5/3.4/5.0, hike 1.9, bike 3.1, skiBase 6.25, skiFlat 1.4);
   keep `NAV_SPEED_LEGACY`. `NavGraph.speed()` reads the profile for its map size (mutable object so the analysis harness keeps working).
2. `src/sim/guests/Arrivals.ts`: `VEHICLE_SPEED = [5, 3.75, 7.5, 12.5]`; `Patrol.ts`, `Heli.ts`, `Grooming.ts` speeds per table; `Fauna.ts` / `Livestock.ts` speeds x6.25.
3. Render: `GuestRenderer.ts` gait/bob phase from distance travelled (or real `clock`), not `tick + alpha`; `NatureView`, `Vehicles.ts` wheel/bob (already distance based: check), `GroomingView`; optional path-following interpolation (record the
   sub-tick polyline) if corner cutting is visible.
4. `RideAlong.ts` `RIDE_TIME_SCALE` -> 1.0 (setting default Off); `DemoScene.ts` `DEMO_DAY_SECONDS` 100 -> 150 (scale 1) or keep 100 with `timeScale` 1.5.
5. Tests to update: `tests/core/pacing.test.ts`, `tests/core/TickLoop.test.ts` (24 s / [0,1,2,4] assertions), `tests/sim/guests/Exploration.test.ts` (NAV_SPEED), `tests/sim/Weather.test.ts`; add `tests/sim/guests/ScreenSpeed.test.ts`
   (headless trace: walk/ski/vehicle p95 on-screen tiles/s <= caps at 64/128/256; guests/day and runs/skier within +-15 % of the recorded baseline).
6. Docs: `docs/pacing-news-names.md`, `docs/ground-level.md`, `docs/hiking-analysis.md` pointers; `docs/balance.md` (per-real-minute note).
7. Verify: `npm run analysis:timeflow` (E vs M0 table), `npm run test:balance`, shot/visual QA of walkers at 1x (`npm run shot`), perf test.

Phase 2 (optional, after playtest): calendar 15-day months (`DAYS_PER_MONTH` 15, 65 call sites reference the calendar constants; per-month wages/interest/upkeep x0.5, per-day snow/melt/season curves keyed by `seasonYear`), save migration,
goals/news day counts (goals use "days"), Daylight year curve. Phase 3 (optional): hide/crowd-render above 3x, shuttle for 256, sub-tick path interpolation.

## 7. Risks

* The 256 map is walking-bound (36 % of presence even at 8 t/s): further walk speed or a layout/shuttle change is needed; below ~D = 150 s (or walk < 4 tiles/s) it collapses (E96/A3 rows).
* Per-size walk speeds make the same guest faster on bigger maps (justified by zoom: 256 maps are played at ~half the px/tile) but differ from `RIDE`/walk-mode expectations; if the zoom range changes the mapping must too.
* 1.6 Hz ticks: sim-driven UI (money counter, queue labels, hover cards) feels laggier at 1x; consider interpolating displayed values or running the HUD from a render-time clock.
* Hiking: the top-third share is sensitive to walk speed (trailhead walk); keep `hike` >= 3 t/s and re-run `analysis:hiking`.
* Balance per real minute drops 6.25x at 1x: players used to the 24 s day will think the game is slow until they use 3x/8x; consider defaulting new games to 3x.
* Tutorial text mentions speeds/real time in places; check `tutorial/strings.ts`.
* Measurement noise: hiking runs have 7-23 hikers; the table averages 4 seeds; do not read differences < 8 pp.

## 8. Implemented (final constants, measured results)

User decisions: recommendation **Es**, and "make sure we still get to see seasons in a reasonable game time" -> calendar compressed to **15-day months (180-day year)**.
Reproduce: `npm run analysis:timeflow` (set `TIMEFLOW_MODELS=M0,I` for the before/after pair; `I` = the game as implemented, `M0` = the old 24 s-day speeds on the same sim), `npm run test:balance`, `tests/core/timeModel.test.ts`, `tests/sim/guests/ScreenSpeed.test.ts`.

### 8.1 Pacing and speeds (src/config/balance.ts unless noted)

| Constant | Before | After |
|---|---|---|
| `REAL_SECONDS_PER_DAY_1X` | 24 s (10 ticks/s) | **150 s (1.6 ticks/s)** |
| `SPEED_MULTIPLIERS` / labels | [0,1,2,4] = 1x/2x/3x, day 24/12/6 s | **[0,1,3,8] = 1x/3x/8x, day 150/50/18.75 s** (ticks/s 1.6 / 4.8 / 12.8); keys unchanged: Space pause, `+`/`.` faster, `-`/`,` slower (clamped to the three speeds) |
| `NAV_SPEED.walk` (tiles/tick) | 9 | **3.4 (the 128 value) x `walkSizeScale(size)`: 2.5 / 3.4 / 5.0 on 64 / 128 / 256** (`WALK_SPEED_BY_SIZE`, `walkSpeedFor`, applied in `NavGraph.speed`; = 4 / 5.5 / 8 tiles/s at 1x) |
| `NAV_SPEED.hike` / `bike` | 0.4 / 1.4 | **1.9 / 3.1** |
| `NAV_SPEED.skiBase` / `skiFlat` | 13.2 / 3 | **6.25 / 1.4** |
| `GUEST_WALK_SPEED` (simple BFS movement) | 0.15 | 0.9375 (x `ANIMAL_SPEED_K` = 6.25) |
| `VEHICLE_SPEED` (car, bus, train, plane) | 0.5, 0.4, 0.8, 1.5 | **5, 3.75, 7.5, 12.5** (`VEHICLE_MAX_TRIP_TICKS` 6 / route cap 30 tiles unchanged: a 30-tile approach is 3.75 s) |
| Patrol sled / walker | 4 / 2 | 5 / 1.25 |
| Rescue helicopter | 12 | 9.4 |
| Snowcat groom / drive | 1.5 / 4 | 1.9 / 3.75 |
| Fauna speeds (deer .11, ibex .09, chamois .10, marmot .06, fox .09, eagle .08) | as left | x `ANIMAL_SPEED_K` (150/24 = 6.25) in code (same on-screen 0.4-1.4 tiles/s) |
| Livestock `speed` / `travelSpeed` | 0.07 / 0.13 | x 6.25 |
| Wildlife (bear / wolf walk .1 / .14, stalk .3) | as left | x 6.25 (same on-screen speed); ranger ATV 2.5 -> 5 (8 tiles/s) |
| Lifts (`LIFT_SECONDS_PER_TICK` 6, carrier speeds, service times), excursions (game-hour based), fast nights (x3) | - | unchanged (excursion progress is time based: its on-screen speed is 6.25x slower per game hour, now 1-2 tiles/s) |
| `RIDE_TIME_SCALE` 0.15 | fixed | **removed: target-speed slow motion** (8.2) |
| Demo (title screen) | `DEMO_DAY_SECONDS` 100 -> timeScale 0.24 | same 100 s day -> `demoTimeScale()` = 1.5 (the title screen skiers move 1.5x the 1x speed: lively, still under 13 tiles/s) |

`TICKS_PER_DAY` (240), the sim logic and the per-tick economy are untouched.

### 8.2 Render changes

* **Ride-along slow motion is target-speed based** (`render/view/RideAlong.ts`: `rideTimeFactor(tilesPerTick, ticksPerSecond, target = 9)`, `easeRideFactor`; main.ts applies it every frame to `TickLoop.timeScale`, setting "Ride-along slow motion" stays ON by default): factor = min(1, 9 tiles/s / apparent tiles/s), floor 0.1. A blue-run skier is ~8 tiles/s at 1x (factor 1.0, no slow motion), at 3x the factor is ~0.4 and at 8x ~0.15; lift riders (~20 tiles per tick) are slowed at every speed (HUD says "slow-mo" only when the factor < 0.97). Sim untouched (`stateHash` identical).
* **Guest gait**: the vertex-shader phase (`iC.x`) advances in REAL seconds (`GAIT_RATE` 1.6 x capped 0.5 tile/tick = 0.8 phase units/s x freq 20 = 2.5 strides/s for walkers, independent of the game speed); frozen while the sim clock does not advance (paused); sit/idle poses use `STILL_RATE` 0.5/s. Vehicles: the suspension bob is distance based (`sin(3 d)`, was 18 d which aliased); the helicopter rotor / bear and animal poses are frame-time based already (`NatureView`, `IncidentView.clock`); snowcat / sled / helicopter / ranger display smoothing now chases at the tick rate (`render/chase.ts`: `chaseK(dt, ticksPerSecond)`, time constant ~1 tick) instead of a fixed 0.25 per frame (that was stop-and-go at 1.6 Hz). Attraction props (`AttractionActivity`) stay a function of sim tick + fraction on purpose: their cycles are `serviceTicks`, so they are 6x slower in real time together with the service itself.
* **Path-following interpolation**: `NavMovement.moveTo` records the tile centres a guest passes in a tick (`GuestStore.wpN / wp`, WP_MAX 12 per guest, render-only, not saved, not hashed, reset each guest update); `GuestRenderer` (and the emote anchor) draw the guest at fraction `alpha` of the polyline px,py -> waypoints -> x,y (`render/guestPath.ts`, arc-length parametrised, no allocation) instead of the chord. Measured (starter resorts, 2-3 days, 7-point samples per moving guest): **0 samples on building / water tiles along the path vs 94-303 on the chord**, max deviation from the chord 1.3-1.8 tiles.
* **Impostors at 8x**: in the iso view guests are drawn as the cheap coloured points when the speed is >= 8x (`GUEST_IMPOSTOR_MIN_SPEED`, `useGuestImpostor`) as well as when zoomed out; perspective (ride / walk) views keep figures. Vehicles and animals stay full models (their extrapolation `dist + speed*alpha` is bounded by the 6-tick trip cap).

### 8.3 Calendar compression (15-day months)

Seasons keep their 2 / 4 / 2 / 4 month layout: **spring 30 d, summer 60 d, autumn 30 d, winter 60 d; year 180 d** (`DAYS_PER_MONTH` 15, `DAYS_PER_YEAR` 180, `CAL` = 0.5, `oldDays(n)`). New games start at month 9 = day 120 (winter; was 240). Day-keyed curves are authored in "old days" and scaled by `CAL`, so every curve keeps its shape by YEAR FRACTION.

| Constant | Before | After |
|---|---|---|
| `DAYS_PER_MONTH` / `DAYS_PER_YEAR` / `START_DAY_OF_YEAR` | 30 / 360 / 240 | 15 / 180 / 120 |
| `SNOWLINE_KEYS` day keys | 0..360 | x `CAL` (0..180), same values |
| `DAYLIGHT.winterSolsticeDay` / `summerSolsticeDay` | 300 / 120 | 150 / 60 (`oldDays`) |
| `MELT_M_PER_DEG_DAY` | 0.16 | 0.32 (the temperature swing takes half the days; seasonal melt/snowline lag per season unchanged) |
| `SNOWFALL_M`, snowmaking per day, reservoir refill per day, weather (1-5 day spells, `SEASON_WET`) | - | unchanged (per-day stochastic events / per-day consumption) |
| `SETTLE_LEAD_DAYS` (date-jump settle) | 24 | 12 |
| Tree growth `GROWTH.youngDay / matureDay` | 30 / 120 | 15 / 60 |
| `HOLIDAYS` [start, length] | [[350,10],[0,5],[285,7],[150,30]] | scaled by `CAL` (rounded, min 1 d) |
| Loans: monthly rate (= annual % / 12) | /12 | x `CAL` (per 15-day month; term in months unchanged); `annuityPayment`, `amortisationSchedule`, `monthly()`, `monthlyObligation` |
| `DEBT.overdraftRateMonthly` | 1.5 % | 0.75 % |
| `DEBT.autoBankruptcyDays` / `ratingPenaltyDays` / `warnEveryDays`, deep-debt level 3, `LOAN_RULES.bankruptcyGraceDays` | 365 / 90 / 30 / 30 / 30 | 182 / 45 / 15 / 15 / 15 (same fraction of a year) |
| `PASS_PRICES.seasonPass` price / max | 600 / 1500 | 300 / 750 ("roughly 7 day passes": the season holds half the days) |
| `Avalanche.winterGapDays` | 100 | 50 |
| `Wildlife` station month / `Livestock` day math | 30 | `DAYS_PER_MONTH` / `DAYS_PER_YEAR` |
| Per-DAY economy (upkeep, wages, energy, insurance, guests/day, per-day rating smoothing), marketing campaign durations and cooldowns, advisor snooze (30 d), startup grace 14 d, lift ageing, avalanche cool-downs, tutorial hints | - | **unchanged in days** (a campaign / snooze is now 2x longer relative to a season; accepted: cost and boost per day are unchanged so campaigns keep their per-campaign profitability) |

Economics: per-day flows are unchanged, so annual revenue and annual per-day costs halve; per-month and per-year items were halved to match (loan rate, overdraft rate, season pass price, debt day thresholds). Balance results in `docs/balance.md`.

Saves: `SAVE_FORMAT_VERSION` 1 -> 2, `persist/migrations.ts` `v1to2`: `day' = floor(day/30)*15 + floor((day%30)/2)` (month index and season kept), absolute day stamps (`year*360+day` -> `year*180+day'`: guests' `leaveDay` and trek arrival, ticketing pass / hiker days, marketing log / runs / cooldowns / `cur`, finance `lastDay`/`firstDay`, rating `lastDay` / `lastEmitDay`, attractions `last`, ski-school day, ops `lastDay` / `lastStamp` / grooming `nightKey`, avalanche stamps (sentinels kept), wildlife `lastDay` + station month x2, lift `lastInspection` and `liftOps.absDay`, weather / snow `year*1000+day` keys, nature `now`, prop `born` and `now`, planting refresh, advisor snoozes) are remapped; month-indexed data (ledger months, loan month counters, season) and durations (debt day counters, lift age) stay; the snow depth is kept and weather / season are recomputed from the date on the next tick. Tree ages halve with the calendar. Tests: `tests/persist/calendarMigration.test.ts` (synthetic v1 blob field by field + a real save downgraded and re-migrated that keeps ticking).

### 8.4 Real minutes per season at each speed button (no fast nights = worst case; fast nights make everything ~30 % shorter)

| speed | day | ticks/s | spring (30 d) | summer (60 d) | autumn (30 d) | winter (60 d) | year (180 d) |
|---|---|---|---|---|---|---|---|
| 1x | 150 s | 1.6 | 75 min | 150 min | 75 min | 150 min | 7.5 h |
| 3x | 50 s | 4.8 | 25 min | 50 min | 25 min | 50 min | 150 min |
| 8x | 18.75 s | 12.8 | 9.4 min | 18.75 min | 9.4 min | **18.75 min** | 56 min |

(Before: 1x year 144 min, winter 48 min; the 6x slower day alone would have meant 15 h per year.) A month is 37.5 min at 1x, 4.7 min at 8x. `tests/core/timeModel.test.ts` asserts winter <= 25 min at 8x.

### 8.5 After-numbers

On-screen speeds at 1x, headless `ScreenSpeed.test.ts` (starter resorts, p95 of per-tick displacement x 1.6; browser check over 1 s windows on a 128 starter resort: walkers p95 6.8 / max 9.0, skiers p95 8.9):

| map | walk p95 (tiles/s) | skiers easy (green/blue) p95 | skiers red/black p95 | vehicle (30-tile approach) |
|---|---|---|---|---|
| 64 | 4.0 | 8.6 | 10.0 | 8.0 |
| 128 | 5.4 | 8.6 | 9.7 | 8.0 |
| 256 | 8.0 | 10.2 | 11.9 | 8.0 |

(Before: walk 84-90, skiers 103-134, cars 32-50 tiles/s.) Caps in the test: walkers <= 9, easy skiers <= 10.5, hard skiers <= 13, vehicles <= 12.

Analysis harness, M0 (old speeds on the same sim, 24 s day) vs I (implemented), headless winter starter resorts, 6 days x 3 seeds (`npm run analysis:timeflow` with `TIMEFLOW_MODELS=M0,I`):

| map | model | walk p95 t/s | ski blue p95 t/s | guests/day | runs/skier | lift rides/guest | lift rides/day | income/day | income / real min | queue min | walk share |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 64 | I | 4.0 | 8.0 | 21.0 | 2.9 | 1.7 | 36 | 3492 | 1397 | 10.2 | 21 % |
| 64 | M0 | 80.6 | 105.0 | 21.5 | 4.0 | 2.3 | 48 | 3501 | 8752 | 13.2 | 10 % |
| 128 | I | 5.4 | 8.6 | 26.0 | 2.2 | 1.0 | 27 | 3930 | 1572 | 6.2 | 28 % |
| 128 | M0 | 90.0 | 112.6 | 27.5 | 2.9 | 1.8 | 46 | 4066 | 10166 | 10.0 | 15 % |
| 256 | I | 8.0 | 8.6 | 35.5 | 1.1 | 0.4 | 15 | 4511 | 1804 | 2.5 | 31 % |
| 256 | M0 | 90.0 | 110.7 | 36.3 | 1.3 | 0.6 | 20 | 4689 | 11722 | 3.4 | 23 % |

Guests/day and income per game day are within -4 % of M0, runs per skier fall 28 % / 24 % / 15 % (64 / 128 / 256), money per real minute at 1x is 6.3x lower (the new 8x equals the old 1x). Hiking (summer, 4 seeds): 67 / 77 / 59 % completed, top-third 68 / 44 / 46 % (noise +-8 pp).

### 8.6 Known limits / follow-ups

* The 256 map is still walking-bound (31 % of presence walking at 8 tiles/s, 0.4 lift rides per guest): a shuttle / closer village is open.
* Lift riders in ride mode are slowed at every speed (the sim moves them ~20 tiles per tick).
* Campaign / advisor / startup-grace day counts were deliberately not rescaled (8.3).
* Exploration test thresholds were relaxed to the measured values (docs/ski-exploration.md).

## 9. Update: top speed 10x and fast-forward ("Skip to...")

User feedback after M5.3: "1 year at 8x takes 56 minutes - seems long". Two changes, the simulation itself is untouched.

| Constant | Before | After |
|---|---|---|
| `SPEED_MULTIPLIERS` / labels | [0,1,3,8] = 1x/3x/8x, day 150 / 50 / 18.75 s | **[0,1,3,10] = 1x/3x/10x, day 150 / 50 / 15 s** (ticks/s 1.6 / 4.8 / 16) |
| `GUEST_IMPOSTOR_MIN_SPEED` | 8 | **10** (figures below 10x are still readable at 3 x 1.6 ticks/s) |
| Music tempo cap, ambience, screen-speed caps | speed index 3 = x1.25 | unchanged (index based) |
| Ride slow-mo | target-speed factor | unchanged, still correct (< 0.2 at 10x) |
| Fast nights | x3 | unchanged: a day averages 0.735 of its length (`fastNightsFactor()`, mean 1/warp over 12 days of the year) |

### 9.1 Real time per season / year (`core/pacing.ts`: `seasonRealMinutes`, `realMinutesWithNights`)

| speed | day | spring (30 d) | summer (60 d) | autumn (30 d) | winter (60 d) | year (180 d) | year with fast nights |
|---|---|---|---|---|---|---|---|
| 1x | 150 s | 75 min | 150 min | 75 min | 150 min | 7.5 h | 5.5 h |
| 3x | 50 s | 25 min | 50 min | 25 min | 50 min | 2.5 h | 110 min |
| 10x | 15 s | 7.5 min | 15 min | 7.5 min | 15 min | 45 min | **33 min** (winter 11 min) |

### 9.2 Fast-forward (`core/FastForward.ts`, wired in `main.ts`)

* **What**: `Skip to...` menu in the speed control (aria `menu`, arrow keys, Esc) with Next month / Next season / Next event, hotkey **K** (= next month; unused elsewhere, in `KEY_BINDINGS`). `Next event` ends at the first stop-class event or after one game year.
* **How**: each animation frame the main loop calls `FastForward.frame()` instead of `TickLoop.advance(dt)`: it runs `TickLoop.stepOnce()` (the same `onTick` path: all systems tick in order) until 11 ms are used (minimum 4 ticks). Determinism is unchanged: `tests/game/fastForward.test.ts` hashes N ticks via fast-forward (with an `encodeSave` in between) against N ticks via `advance` (identical `stateHash`).
* **Stop conditions** (`EVENT_STOPS`, a mapped type over every `GameEvent`, so a new event cannot be forgotten): target reached (toast), `year:report`, `scenario:finished`, major `milestone` (level-up, goal chapter), `finance:bankruptcyWarning` / `debtWarning` / `bankrupt` / `declaredBankrupt`, `incident:created` severity 2, `incident:escalated`, `incident:stranded`, `lift:broken` with stranded guests, avalanche with burials, wildlife attack. Routine events (arrivals, money, weather, month / season changes, grooming ...) never stop it. Also: Esc / Space / any click, a dialog opening, ride / walk / photo / drop mode, tutorial, title demo, game over, 25 consecutive frames whose 4-tick minimum alone takes > 80 ms ("too heavy"). A hidden tab pauses it (no catch-up). Refused to start in those contexts (toast with the reason) and while already running.
* **Rendering while skipping**: drawing is dropped to every 6th frame (`Renderer.preSim` returns true = skip draw), guests are impostor points (`speedMul` 1000), the feedback layer is suspended (`Feedback.suspend`, nothing persisted), audio is ducked (`AudioSettings.setDucked`: reads as muted, never persisted), month autosaves are held and collapse into one when the run ends (`SaveManager.holdAutosave`). A "Fast-forwarding to next season..." pill (bottom centre above the dock, `role=status`) shows days to go, ETA and a Cancel button.
* **Throughput** (headless sim only, bot-built resort, mid-winter of year 2, `npx vite-node scripts/analysis/ffThroughput.ts`; WARM=200 DAYS=15): 64 map **107 days/s** (0.04 ms/tick), 128 map **53 days/s** (0.08 ms/tick), 256 map **14 days/s** (0.30 ms/tick). The browser gets about 11 ms of every 16.7 ms frame minus the 1-in-6 draw, i.e. roughly 40-50 % of that: expect ~6 days/s on 256, tens of days/s on 64 / 128, so a 60-day winter takes ~10 s (256) and a year ~30 s. Not measured in a real GPU browser (the harness has SwiftShader at ~3 fps).


## 10. Calendar: real month names (northern hemisphere, Alps)

**Labels, plus an aligned climate.** The sim year is unchanged (180 days = 12 x 15-day months, `date.day` 0..179, seasons 60/30/60/30 days from sim day 0 = first day of spring). `src/sim/calendar.ts` lays the real calendar over it with `CALENDAR_OFFSET_MONTHS = 3`: **sim day 0 = 1 April**. Nothing stored is month-indexed by name (finance reports keep the sim month index 0..11, now labelled through `SIM_MONTHS`), so the calendar labels need no save migration. The climate alignment below DID change sim state (daylight, temperature, snow), see "Re-baseline".

| Real month | Season | Sim days | | Real month | Season | Sim days |
|---|---|---|---|---|---|---|
| January | winter | 135-149 | | July | summer | 45-59 |
| February | winter | 150-164 | | August | summer | 60-74 |
| March | winter | 165-179 | | September | summer | 75-89 |
| April | spring | 0-14 | | October | autumn | 90-104 |
| May | spring | 15-29 | | November | autumn | 105-119 |
| June | summer | 30-44 | | December | winter | 120-134 |

* Winter Dec-Mar (60 d, the ski season), spring Apr-May (30), summer Jun-Sep (60), autumn Oct-Nov (30). A new game starts 1 December (sim day 120). Day of month is 1..15; New Year's Eve is the last day of December ("Dec 15", sim day 134).
* **Game year** (`date.year`, "Year 1") rolls on 1 April with the year report; a new game is Year 1 from December until the first April. The label never invents a second year number.
* Weekdays exist (7-day weeks from the absolute day, used by Pricing) and appear in the chip: `Sat 14 Feb · Winter · Year 1`. `formatGameDate()` (`src/sim/calendar.ts`) is the single formatter (HUD chip with tooltip = day of year + time, speed panel line `Y1 · Sat 14 Feb · 23:18`, news stamp, daily digest, year report, month cards, save list and default save name, Events panel).
* **Climate is aligned with the calendar** (see "Climate curves" below; this replaced the earlier "known offsets": daylight extremes 1 Feb / 1 Aug and temperature extremes 1 Feb / 5 Aug). Daylight: longest day **21 Jun = sim day 40**, shortest **21 Dec = sim day 130** (`DAYLIGHT.summerSolsticeDay/winterSolsticeDay` = `oldDays(80)/oldDays(260)`). Temperature: coldest **mid-January (sim day 142)**, warmest **mid-July (day 52)**.
* Event dates: Christmas Market starts 1-9 Dec, World Cup 6 Jan-15 Feb, Carnival 1-11 Feb, Music Festival 1 Jun-11 Aug, Almabtrieb 1-10 Oct, New Year 15 Dec (eve) / 1 Jan. Tests: `tests/sim/calendar.test.ts`.

### Climate curves (calendar fix 2)

Authored in `src/config/balance.ts` (`SNOWLINE_KEYS`, `DAYLIGHT`); regenerate the numbers with `npx vite-node scripts/analysis/yearCurve.ts` (temperature, snowline, daylight) and `npx vite-node scripts/analysis/snowYear.ts <size> <seeds...>` (whole-year snow depth by altitude band, 2nd game year, no guests).

* **Daylight**: sinusoid, sunrise 07:45 / sunset 16:45 (9.0 h) on 21 Dec and 05:15 / 20:45 (15.5 h) on 21 Jun; equinoxes at sim days 85 / 175. Everything daylight-driven (lighting, night warp, arrival window, day-guest leave hour, `Auto (daylight)` lift hours, snowmaking night window, guest evening mode, music/ambience) follows the functions in `sim/Daylight.ts`, so it moved with the solstice. Early December (the new-game start) is now shorter than before (sunrise 07:44, lifts open 08:29, was 07:22 / 08:07): a new game starts at 08:00 with the lifts opening half an hour later.
* **Snowline / temperature**: `SNOWLINE_KEYS` are now authored directly in real-calendar sim days (one key per mid-month; `SNOWLINE_LEAD_DAYS` stays 0). Valley temperature = `TEMP_PER_RELIEF` (16) x snowline fraction, so one curve drives temperature, snowline, rain/snow, melt, slush and the freeze. Fractions (share of the relief above the valley floor): Jan -0.34, Feb -0.25, Mar -0.06, Apr 0.28, May 0.7, Jun 0.98, Jul 1.34, Aug 1.3, Sep 1.15, Oct 0.55, Nov 0.18, Dec -0.22 (cyclic, smoothstep between keys).
* **Alpine sanity check.** Real snowline per month (Jan ~800 m, Mar ~1,200, Apr ~1,700, Jun ~2,800, Aug high, Oct ~2,000, Nov ~1,300, Dec ~900) mapped onto a ~1,600 m relief gives fractions Jan -0.25, Mar 0, Apr 0.3, Jun 1.0, Oct 0.5, Nov 0.06, Dec -0.19: the keys follow them. The game's maps are far smaller than the Alps (a 128 map has ~330 m relief), so the snowline in **metres** cannot match (it spans ~1,160-1,580 m on 128); the **fractions** and the temperature do. Deliberate deviations: the Jan mean is -5 C at 1,200 m (real ~-3), and summer is hotter than real (valley +21 C vs ~+16): the game guarantees a snow-free summer on the summits (hiking, biking, `tests/sim/SeasonalSnow.test.ts`) and a summit at fraction 1.0 stays above the snowline whenever the curve is above 1.0 (21 Jun to mid Sep).
* **What you see**: late March is spring skiing (valley mean -0.6 C in March, +1 to +2 C by the end; slush starts at +2 C afternoons, see `PQ.slushStartTemp`; low pistes melt out in early April, snow stays at altitude until June); first snow on the peaks in October, the valley whitens in the second half of November, a new game starting 1 December has snow on the ground (mean valley temperature ~0 C that day).

| Month | Valley mean T, 1,200 m (before → after) | Daylight h (before → after) | Sunrise-sunset (after) | Snowline, 128 map, m (before → after) | Mean snow depth m, low / mid / high band (after; before in brackets) |
|---|---|---|---|---|---|
| Jan | -5.3 → **-5.1** | 9.1 → **9.3** | 07:37-16:57 | 1154 → 1157 | 1.82 / 2.00 / 2.00 (1.80 / 2.00 / 2.00) |
| Feb | -5.6 → **-3.8** | 9.1 → **10.4** | 07:13-17:37 | 1149 → 1179 | 2.00 / 2.00 / 2.00 (2.00 / 2.00 / 2.00) |
| Mar | -3.2 → **-0.6** | 10.0 → **12.0** | 06:36-18:35 | 1188 → 1230 | 1.95 / 2.00 / 2.00 (2.00 / 2.00 / 2.00) |
| Apr | 3.6 → **4.8** | 11.4 → **13.6** | 05:59-19:35 | 1299 → 1318 | 0.57 / 2.00 / 2.00 (1.05 / 2.00 / 2.00) |
| May | 11.6 → **11.2** | 13.1 → **14.9** | 05:29-20:22 | 1429 → 1422 | 0.00 / 0.59 / 2.00 (0.00 / 0.86 / 1.95) |
| Jun | 16.4 → **16.0** | 14.5 → **15.5** | 05:16-20:43 | 1507 → 1500 | 0.00 / 0.03 / 1.34 (0.00 / 0.00 / 0.95) |
| Jul | 19.4 → **20.9** | 15.4 → **15.2** | 05:23-20:33 | 1555 → 1580 | 0.00 / 0.00 / 0.03 (0.00 / 0.00 / 0.11) |
| Aug | 20.6 → **20.6** | 15.4 → **14.1** | 05:47-19:53 | 1575 → 1574 | 0.00 / 0.00 / 0.00 (0.00 / 0.00 / 0.00) |
| Sep | 19.2 → **17.5** | 14.5 → **12.5** | 06:24-18:55 | 1553 → 1525 | 0.00 / 0.00 / 0.01 (0.00 / 0.00 / 0.00) |
| Oct | 14.5 → **8.9** | 13.1 → **10.9** | 07:01-17:55 | 1475 → 1384 | 0.00 / 0.31 / 0.93 (0.00 / 0.06 / 0.68) |
| Nov | 5.6 → **2.6** | 11.4 → **9.6** | 07:31-17:08 | 1332 → 1283 | 0.22 / 1.76 / 2.00 (0.11 / 1.05 / 1.93) |
| Dec | -2.2 → **-3.2** | 10.0 → **9.0** | 07:44-16:47 | 1204 → 1187 | 0.95 / 1.90 / 2.00 (0.81 / 1.85 / 2.00) |

(Snow depth: mean over land tiles of the band, bands = fraction of the relief: low < 0.15, mid 0.4-0.6, high > 0.85; max depth is 2 m. Seeds 3 / 11 / 29, 128 map; 64 and 256 are within 0.05 m except the snowline in metres.)

Low-band skiable season (mean depth >= 30 cm), 128 map, seeds 3 / 11 / 29: **before** ends 12 / 5 / 11 Apr and the next one starts 8 / 4 / 3 Dec; **after** ends 7 / 2 / 9 Apr and starts 2 / 3 / 2 Dec (about 4.2 months either way).

### Re-baseline (calendar fix 2)
Bot year 1 / 2 / 3 net, ski-season length, summer profitability and bankruptcies before and after: see `docs/balance.md` "Climate aligned with the calendar". Short version: no bankruptcies, years 2-3 profitable on 64 / 128 / 256 (two seeds each), the low-altitude ski season is still ~4.2 months (ends 2-9 Apr instead of 5-12 Apr, starts 2-3 Dec instead of 3-8 Dec), summer stays profitable (one 256-map year-3 summer is -13 k, was -3 k). Two latent save/load determinism bugs surfaced and were fixed.
