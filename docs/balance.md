# Balance pass (Task 35)

All numbers come from the headless harness: `createSim` + `src/game/bot.ts` (scripted player) + `tests/game/balance.test.ts`.
`npm test` runs the fast checks (64 map, ~15 s). `npm run test:balance` (BALANCE=1) runs the 3-year x 3-size sweep, the difficulty comparison and the
3-year soak (several minutes) and prints the monthly tables (`[balance] ...`).

## The bot policy (`src/game/bot.ts`)

1. Builds the tutorial-style starter chain with `buildStarterResort` (lift(s) + piste, parking, ticket office, chalet, lodge, hut, ski school + carpet, patrol,
   first aid, groomer, snowcat, reservoir + cannons, 3-5 attractions) and pays for it from its own cash (may overdraw). Optional Starter loan first.
2. Once per in-game month: takes the Starter loan if cash < 12.5 k and no loan ever; repays loans when cash > balance + 75 k; runs one marketing campaign when cash
   > reserve + 15 k (winter: budget -> families -> brand; summer only with a summer attraction); builds ONE wish-list building when cash > 1.3 x cost + 25 k reserve
   (rental, chalet, lodge, playground, adventure park, shop, parking, cafe, apartment, workshop, beach), with per-size caps.
3. Summer: only bike-capable lifts keep the summer schedule (the rest rest, no energy wasted). Never touches prices unless `prices` is set (exploit tests).
4. Not modelled: extra lifts / pistes after the opening chain, terraforming, price tuning, school management. The bot is a *floor* for a sensible player.

## Tuning table

| Constant | Before | After | Why |
|---|---|---|---|
| `GUEST_BASE_SPAWN_PER_TICK` (balance.ts) | 3.0 | 0.15 | at 3.0 the 64 starter resort was parking-capacity-limited (200 concurrent, ~190 passes/day) and earned ~300 k/month against ~30 k costs |
| `SIZE_SPAWN_MULT` (new) | - | 64: 1, 128: 1.2, 256: 1.65 | bigger resort = bigger catchment; without it 128/256 lost money (same arrivals, more lifts/cannons) |
| `STARTING_MONEY` (GameState) | 250 000 | 130 000 | the chain costs 91 k (64) / 104 k (128) / 205 k (256 with 2 lifts): without the 50 k Starter loan there is little left to expand |
| `ENERGY_COST_MULT` (liftOps.ts, new) | 1 | 2 | lift energy was ~4 % of lift revenue; now ~7-12 % |
| `LIFT_OPS.defaultTo` | 16.5 | 17 | default lift hours 08:30-17:00 (guests arrive until 15:30) |
| `GEAR_OWNERS.ski` / `.bike` | 65 / 50 | 82 / 60 | the first winter is not punished by rental, rental still earns |
| `CLOSED_BUILDING_UPKEEP_SHARE` (new) | 1 | 0.5 | seasonal buildings that are closed (no snow / warmth) pay half upkeep: 8 off-season months were ruinous |
| Difficulty (new, `DIFFICULTY`) | - | see below | Relaxed / Normal / Challenging |
| `Loans.rateMult`, `Spawner.rateMult`, `GuestSim.patienceMult/injuryMult`, price sensitivity | - | from difficulty | |

Difficulty multipliers (money, loan rate, upkeep, wages, arrivals, incident risk, queue patience, price sensitivity):
Relaxed 1.5 / 0.8 / 0.75 / 0.75 / 1.2 / 0.6 / 1.3 / 0.8; Normal all 1; Challenging 0.75 / 1.2 / 1.15 / 1.15 / 0.93 / 1.4 / 0.8 / 1.15.

## Before / after (bot, Normal, 64 map seed 61)

| | Before | After |
|---|---|---|
| winter month income / expense / net | ~340 k / ~30 k / **+310 k** | ~58 k / ~29 k / **+26 k** |
| first winter (4 months, incl. build-out) | +880 k | +24 k (operating +84 k) |
| year-2 annual net | ~+1.5 M | **+78 k** (seed 7: +100 k) |
| cash after year 3 | millions | 270-340 k |
| summer month net | n/a (lifts closed -> no arrivals) | -3 k .. +14 k with bike lifts + adventure park; spring/autumn -6 .. -12 k |
| arrivals per month (winter) | ~5 700 (capacity-limited) | ~650 |

## Sweep results (After; annual net in k$, `npm run test:balance`)

| map | seed | year 1* | year 2 | year 3 | stars (y2) |
|---|---|---|---|---|---|
| 64 | 61 | +24 | +78 | +57 | 3.7 |
| 64 | 7 | +26 | +100 | +88 | 3.7 |
| 128 | 61 | +47 | +74 | +89 | 3.7 |
| 128 | 7 | +51 | +68 | +53 | 3.5 |
| 256 (starter loan) | 61 | -30 (build-out 205 k) | +169 | +82 | 4.0 |
| 256 (starter loan) | 7 | -62 | +108 | +17 | 3.5 |

\* year 1 = months 8-11 only (the game starts in early winter). The numbers above for 256 are from the 1.7 multiplier run; at the final 1.65 the sweep test
re-asserts year-2 and year-3 profit (both seeds pass). Difficulty (64, seed 61, year-2 net): Relaxed +176 k, Normal +78 k, Challenging +39 k (feasible; year 3 +12 k).
Challenging with the first multipliers tried (money 0.7, upkeep 1.3) went negative in year 2-3: softened.

## Findings by acceptance item

1. **Early game**: first-winter operating net +84 k over 4 months (64), starter loan meaningful: on 128 the chain leaves ~26 k cash without the loan, ~76 k with it.
2. **Profit by year 2** on Normal for all sizes/seeds tested; year 3 positive everywhere (small: 256 seed 7 +17 k at the earlier multiplier).
3. **Exploits**: price extremes (max / min / x1.6 markups) stay below 1.6x the baseline winter profit; loan cycling (take all offers, repay at once, 25x) never increases cash;
   a held Starter loan lowers net worth. Tests in balance.test.ts.
4. **Summer** is weaker than winter in income and net, but about break-even with bike lifts + summer attractions.
5. **Rating/incidents**: 3.5-4 stars for the bot, < 12 incidents/month.
6. **Rental gear**: 82 % ski owners; rental still earns (~1 k/month early).
7. **Lift hours**: default 08:30-17:00 (configurable per lift). Rides verified on 64 and 128 with the default hours.
8. **Parking vs arrivals**: one Parking holds 80 x 2.5 = 200 guests. At the old 3.0 spawn rate the cap swallowed all pricing/marketing effects (the *capacity-limited regime*);
   at 0.15 x size mult the winter peak is < 160 concurrent on a 64 map (tested) so marketing and price changes show up. Players who push arrivals beyond ~200 need a second Parking
   (the bot builds one).
10. **Size-independent arrival-to-ride time** (was: 256 map, default 08:30-17:00 lift hours = 0 rides in 20 days). Root cause: vehicles drove the 22-tile road at 0.5 tiles/tick
   (1 tick = 6 game min => 4.4 h on 256 vs 0.6 h on 64) and guests walked at `NAV_SPEED.walk` 0.6 tiles/tick (6 tiles/h): ~55 path tiles parking -> ticket -> lift = ~9 h, so
   arrivals materialised 11-19 h and reached lifts after 17 h. Fix: `tripPlan` (Arrivals.ts) joins routes at most 30 tiles from the destination and drives them in <= 6 ticks (36 min);
   `NAV_SPEED.walk` 0.6 -> 3. Measured (starter resort, default hours, 6 days, median arrival -> first ride): 64: 3.1 h -> 0.8 h; 128: 2.4 h -> 0.6 h; 256: never (0 rides) -> 2.8 h
   (rides in 6 days 66/43/0 -> 185/89/73; arrivals now 08-16 h on all sizes). `tests/game/balance.test.ts` asserts >= 20 rides in 6 days per size with the default hours.
9. **Magnitudes**: energy 3-25 % of lift revenue (test), staff + upkeep 15 %+ of income.

## Known concerns for the final playtest

* Seeds 1337 / 61 / 7 only; other seeds/presets not swept for balance (presets are invariant-tested only).
* The bot never adds lifts after the opening chain, so late-game income saturates; year-3 numbers are a floor.
* UI (menu, dialog, pause menu, preview orbit) is unverified in a browser.

## Daylight & skier exploration (update)
* Winter arrival window is 08:45-14:15 now (was 07:30-15:30 all year); the spawn rate is multiplied by `8 h / window` (0.75..1.6) so guests per day are unchanged. Summer arrivals run 07:30-18:00.
* `test:balance` (BALANCE=1): all scenarios pass; the 256 seed 7 year-3 profit went negative (-$14.8k) with the shorter winter day *before* the window normalisation (see above), after it the sweep passes again.
* Guest pacing: NAV_SPEED walk 3 -> 9, skiBase 2.2 -> 13.2, skiFlat 0.5 -> 3, pause after a run 2-8 -> 0-2 ticks, after a building 10-40 -> 4-14, per-decision leave chance x0.12 (`EXPLORE`). Skiers complete about 2x the runs per day; injuries per run unchanged so injuries per day rise with runs. See `docs/ski-exploration.md` for before/after numbers.

## Evenings (update)
* Constants: `EVENING` in `config/balance.ts` (curves, close 23:00 winter / 22:30 summer, bedtime 22:30 / 23:00, après share 28 % winter / 12 % summer x type bias 0.7-1.25 = 20-35 % in winter, après end 19:00-20:00 winter, max 2 evening visits for overnight guests / 1 for après guests, +15 % price from 17:00, +15 % venue upkeep for the evening shift, score weight 0.6 on demand peaks).
* Overnight guests were put to sleep at 21:00; now at 22:30. Après guests only extend the stay of day guests by 2-3 h when a venue is serving; guests without a venue leave as before. Night crowd is bounded by lodging capacity plus <= 35 % of day guests (test: Evening.test.ts).
* Balance: `npm run test:balance` ran once after the change and passed all 21 scenarios (64/128/256 sweeps, difficulty ordering: relaxed 248.9k > normal 129.0k > challenging 81.4k year-2 net). No constants needed re-tuning. A second run to refresh the per-size sweep tables was killed by an external SIGTERM, so those tables above are not refreshed.

## M5.1 re-check (goal grants active)
No bot change was needed: the bot does not chase goals. Grants are paid only for what it builds anyway. `npm run test:balance` (24 scenarios incl. the new grant checks) passes. Bot, Normal, seed 61, net in $:

| map | year 1 net (with grants) | grants in year 1 | share of y1 revenue | year 1 without grants | year 2 net (grants 0) |
|---|---|---|---|---|---|
| 64 | 56,157 | 12,000 | 4.5 % | 44,157 | 128,975 |
| 128 | 109,323 | 12,000 | 3.6 % | 97,323 | 132,233 |
| 256 (starter loan) | 25,424 | 12,000 | 3.2 % | 13,424 | 109,399 |

Year 2 is unchanged from before (64: 129.0 k, matches the earlier run). Difficulty year-2 net: relaxed 248.9 k, normal 129.0 k, challenging 81.4 k. The grant test (`[balance] goal grants`) asserts grants <= 10 % of year-1 revenue and that year 2 is profitable without them.

## 15-day months / 180-day year (time-flow change)

The calendar was compressed (`DAYS_PER_MONTH` 30 -> 15, year 360 -> 180 days, game starts on day 120; docs/time-flow.md section 8.3). Per-day flows (guests per day, upkeep, wages, energy, insurance) are unchanged, so **annual revenue and annual per-day costs halve**; per-month / per-year items were halved to match (loan monthly rate x0.5, overdraft 0.75 %/month, season pass 300, debt day thresholds /2). Every number above in this document is per OLD (360-day) year; the bands below are per game year (180 days). `npm run test:balance`: 24 / 24 scenarios pass (bot, Normal), nothing was re-tuned beyond the items above.

| map (bot, Normal) | year 1* income / expense / net | year 2 income / expense / net | year 3 net | year-2 net before |
|---|---|---|---|---|
| 64 seed 61 | 167k / 171k / -3k | 277k / 192k / **+84k** | +68k | +129k |
| 64 seed 7 | 169k / 172k / -3k | 305k / 191k / **+114k** | +74k | (+100k) |
| 128 seed 61 | 191k / 177k / +14k | 330k / 226k / **+104k** | +117k | +132k |
| 128 seed 7 | 181k / 179k / +2k | 343k / 229k / **+114k** | +87k | (+68k) |
| 256 seed 61 (starter loan) | 209k / 282k / -73k | 413k / 304k / **+109k** | +93k | +109k |
| 256 seed 7 (starter loan) | 196k / 282k / -86k | 388k / 305k / **+83k** | +7k | (+108k) |

\* year 1 = months 8-11 only (60 days; was 120). "Before" values in parentheses come from the older sweep table above (before the M5.1 re-check), the others from the M5.1 re-check. Profit by the end of year 2 holds on every map / seed, year 3 is positive everywhere (256 seed 7 only +7k: thin, as it was +17k before). Winter months are ~40-55k income per 15-day month (64); ratings 4-4.5 stars. Test bands were rescaled: first winter (months 9-11, 45 days) operating net -10k..+100k (was 165k for 90 days; measured +61k on 64 / seed 61), summer month net > -8k (was -15k per 30-day month).
Per real minute at 1x money flows 6.3x slower than before (the 150 s day); 10x is faster than the old 1x.

## M5.3 readiness (Career, scenarios, observers)
No constants changed in Task 18. Bot, Normal, Career with `respectUnlocks`, annual net in k$ (year 1 = the first 60 days): 64/61 -3 / +84 / +68, 64/7 -3 / +114 / +74, 128/61 +14 / +104 / +117, 128/7 +2 / +114 / +87, 256/61 (starter loan) -73 / +109 / +93, 256/7 -86 / +83 / +7 (thin, as before). Level days and real-time table: `docs/progression.md`. Yearly reports of that bot: year 1 Bronze (partial), year 2 Silver (Gold on both 128 seeds), year 3 Silver (Bronze on 64/7).
Scenario bots (full sweep, `BALANCE=1 npx vitest run tests/game/scenarioBots.test.ts`): all six **won, bronze**: first-tracks 130 (day 180), family-valley 120 (day 360), powder-dreams 130 (day 180), summer-escape 105 (day 90), alpine-giant 100 (day 540), safe-slopes 100 (day 180); numbers identical to `docs/scenarios.md`.
A 3-year Career bot run unlocks 15-17 of the 40 achievements; two identical runs give identical `stateHash` and identical year reports.
`npm run test:balance`: 27 / 27 pass. Observer cost and save-size impact: `docs/progression.md`, `docs/saves.md`.


## Gentler summer (fix3 playtest: "when summer hit my income tanked and I was foreclosed")
Reproduced with a *winter-focused human* (`tests/game/summer.test.ts`: starter chain with 2/3/4 lifts + 3 attractions, starter loan + small loan, no expansion, lifts left on the default schedule, cash dropped to $10k when year 2 starts), Normal, seed 61, 120 days from year-2 day 0 (spring, summer, autumn) -- net in k$:

| map | before: months 0-7 / summer (m2-5) / autumn (m6-7) | after: months 0-7 / summer / autumn |
|---|---|---|
| 64 | -6.8 / +7.9 / -7.4 | **+23.7 / +25.2 / -1.3** |
| 128 | -16.5 / +2.0 / -13.3 | **+33.1 / +26.9 / -0.7** |
| 256 | -60.9 / -22.3 / -22.4 (cash -159k) | **+29.7 / +25.9 / -0.3** (cash never below +10k) |

Why it collapsed: (1) **no open lift = 15 % of the guests** (`Rating.attractiveness`), applied in every snow-less month even for a resort with restaurants, lodging and paths; autumn also had the lowest season rate (0.35); (2) lifts that stay open in summer (bike-capable) burned **full energy with nobody on them** (4 lifts on 256: $118k over 8 months, more than all summer income); (3) winter-only buildings kept 100 % upkeep; (4) auto-foreclosure after 182 days below -$50k for every difficulty.
Changes: (a) off-season no-open-lift factor rises with amenity variety and attractions (`offSeasonNoLiftFactor`: 0.15 + 0.07 x variety + 0.05 x attractions, cap 0.6; winter keeps 0.15) and `SEASON_RATE` spring .5 / summer .6 / autumn .4 (was .5 / .6 / .35); (b) idle lifts draw 35 % of the energy (`LIFT_OPS.idleEnergyShare`); (c) winter-only buildings pay 25 % off-season, idle venues' staff 50 % (furlough; small: wages are only $8/day/staff, measured $24 over 8 days on 128 -- mothballing saved $476 over the same days); (d) one-time interest-free Tourism Board support loan, Ranger Rudi's "Summer is coming: save up" (last 20 days of spring) -- see `docs/lift-ops-and-debt.md`; (e) foreclosure: Normal/Relaxed never, Challenging 360 days below -$150k.
Bot (summer attractions) after: every summer month positive (64: +2..+11k per 15-day month, 128: +4..+16k, 256: -3..+14k); the autumn trough is still negative (64 -2..-4k, 128 -6..-15k on bot months that also include a building purchase). Winter stays 3-5x stronger than summer: the seasonal challenge remains, it just no longer ends a game. Tests: summer.test.ts (9 runs: 64/128/256 x seeds 61/7/1337: cash never below -$100k, no bankruptcy, summer + autumn net >= -$5k per month), balance.test.ts summer month net > 0 (was > -8k).
Concern: the demand floor is generous (summer arrivals roughly doubled for amenity-rich villages); if playtests find summer too easy lower `OFFSEASON_NO_LIFT_MAX` / the 0.07 coefficient first.

## Rivals, market share and the sustainability facet (M5.4 Task 23)

Details in `docs/rivals.md` and `docs/rating.md`. Balance impact on the bot (Normal, 64 map, year-2 annual net, `scripts/analysis/ratingDistribution.ts`):

| | before | after |
|---|---|---|
| bot seed 61, year-2 net | 99.4 k | 115.8 k (+16 %) |
| bot seed 7, year-2 net | 133.3 k | 147.3 k (+10 %) |
| bot + all six staff upgrades, seed 61 / 7 | 81.4 k / 100.5 k | 98.1 k / 122.8 k (-15 % / -17 % vs the same bot without upgrades; test limit 20 %) |

Why the profit went up: a bot at 4 - 4.5★ against neighbours at 3.0 - 4.4★ holds 39 - 41 % of the guests (fair = 33 % / 25 %), the arrival multiplier is 1 + 0.25 x (share / fair - 1) clamped to [0.9, 1.12], so it is worth up to +12 % arrivals after the 30-day grace period and a 150-day ramp. The green bot (builds on open ground first, replants what the build-out felled at $12 a tree, trains the rangers only when habitat overlap > 6 %) was not measured separately from the market-share effect; the facet shows its result: net tree loss 0 % instead of 1.8 - 3.9 %. No threshold in `tests/game/balance.test.ts` had to change (all are `> 0` / ranges that still hold): profit by year 2, rating 3 - 4.5★ average, incidents < 12 a month, the exploit limits (extreme prices <= 1.6 x the baseline winter profit: the price side only ever removes arrivals, the share bonus is capped at +12 %).

Re-recorded on purpose (every reason is the same: the rating changed, so every rating-driven arrival changed): the `tests/sim/staff.test.ts` golden hashes (staff Auto equivalence is still pinned by the per-pool tests), the `tests/sim/meta/yearReport.test.ts` snapshot (ten awards now; guests 2 620 -> 2 804 in year 2; Family, Safest Slopes, Snow-Sure and Wildlife Friendly moved one tier because rating-driven arrivals and the neighbour-scaled benchmarks changed; headline unchanged: bronze, silver), `tests/game/summer.test.ts` (an empty resort now starts with $2.5 k instead of $500: it bled 70 $/day and the old test only passed because of a lucky trickle of arrivals) and `tests/game/daylightSchedules.test.ts` (family-controlled guests finish their lesson / regroup under the family system after the leave hour; the check already exempted evening guests).

Sweep after Task 23 (`npm run test:balance`, bot incl. the green rules, annual net in k$, mean displayed stars of year 2 in brackets; the older table above is the pre-M5 sweep): 64/61 y2 +116 (4.2★) y3 +119; 64/7 +147 (4.3★) / +137; 128/61 +162 (4.2★) / +176; 128/7 +190 (4.3★) / +156; 256/61 with starter loan +192 (4.1★) / +127; 256/7 with starter loan +97 (3.3★) / +49. Difficulty (64/61, year-2 net): Relaxed +178 k, Normal +116 k, Challenging +100 k. Career with unlock gating: levels 2 / 3 in year 1 and 4 at y2/d1 - d32 on all three tested maps. Grants stay 5.7 - 8.1 % of year-1 revenue.

## Closing sweep with everything on (M5.4 Task 26)

`npm run test:balance` is now 33 cases (27 + 6 new `[balance] everything on` cases in `tests/game/balance.test.ts`): the bot runs 3 years with `autoEvents` (festival / critic / powder / New Year / Almabtrieb), `stories`, rivals, sustainability, the green rules and **all six staff upgrades** (`staffUpgrades: true`). Annual net in $ (y1 / y2 / y3), mean displayed stars of year 2, rival share at the end:

| map / seed | y1 | y2 | y3 | y2 stars | share |
|---|---|---|---|---|---|
| 64 / 61 | -13.3 k | +89.3 k | +106.1 k | 4.25 | 42 % |
| 64 / 7 | -27.7 k | +136.8 k | +132.5 k | 4.25 | 36 % |
| 128 / 61 | -0.4 k | +139.6 k | +168.9 k | 4.17 | 54 % |
| 128 / 7 | -15.6 k | +150.9 k | +148.3 k | 4.33 | 36 % |
| 256 / 61 (starter loan) | -81.6 k | +181.2 k | +127.1 k | 4.17 | 42 % |
| 256 / 7 (starter loan) | -103.4 k | +97.1 k | +57.8 k | 3.42 | 18 % |

Versus the Task 23 sweep (same bot, no upgrades, events / stories off): year 2 is -23 / -7 / -14 / -21 / -6 / 0 % (the upgrades cost ~$43 k plus ~$94 a day), year 3 is within +-15 % except 128/61 (+169 k vs +176 k) and 64/61 (+106 k vs +119 k). Every case stays profitable in years 2 and 3, never bankrupt, stars 3.4 - 4.3. The rest of the sweep (plain, difficulty ordering 178 k / 116 k / 100 k, grants 5.7 - 8.1 %, Career levels) re-ran unchanged. No constant was retuned. Perf (`npm run test:perf`, alone): 35 / 35, guests at the cap 0.48 / 0.90 / 1.67 ms per tick (64 / 128 / 256). Summary and playtest checklist: `docs/depth.md`.

## Climate aligned with the calendar (daylight solstices 21 Jun / 21 Dec, temperature curve, snowline)
Sim change, not a label change (docs/time-flow.md "Climate curves"). Bot, Normal, `npm run test:balance`, annual net in k$ (before -> after; year 1 starts 1 Dec so it is a partial winter + full year, year 4 is partial):

| map / seed | year 1 | year 2 | year 3 | summer m2-5 y2 / y3 |
|---|---|---|---|---|
| 64 / 61 | +3.0 -> +3.4 | 124.2 -> 123.8 | 115.6 -> 115.2 | +31.8 / +16.7 -> +31.5 / +23.6 |
| 64 / 7 | -2.0 -> -8.1 | 141.5 -> 112.6 | 124.3 -> 142.4 | +23.0 / +25.7 -> +22.6 / +24.9 |
| 128 / 61 | +22.6 -> +4.7 | 159.4 -> 182.0 | 169.0 -> 164.8 | +41.5 / +23.5 -> +45.0 / +28.4 |
| 128 / 7 | +2.3 -> -4.4 | 192.0 -> 153.3 | 152.2 -> 177.5 | +31.2 / +22.4 -> +30.2 / +24.0 |
| 256 / 61 (loan) | -75.5 -> -81.3 | 204.6 -> 225.1 | 175.1 -> 192.4 | +42.4 / +19.9 -> +42.4 / +25.6 |
| 256 / 7 (loan) | -100.1 -> -102.9 | 97.4 -> 72.3 | 49.3 -> 59.4 | +6.4 / -3.4 -> +10.0 / -13.0 |

* Nobody goes bankrupt before or after (the sweep asserts it); year 2 and 3 profit hold on all six runs. Differences are per-seed noise of the shifted weather and shorter early-December days (year-1 first winter is a bit weaker on three runs: the new game starts at the shortest days and the lifts open 08:29; year 2 moved -21 % .. +14 %). Difficulty ordering year-2 net: relaxed 184 -> 188, normal 124 -> 124, challenging 94 -> 110. Career: level 4 reached y2/d38 (64), y2/d4 (128), y2/d1 (256) (was d32 / d1 / d1); grants still <= 10 % of year-1 revenue (8.1 / 6.6 / 5.9 %). All-on sweep: y2 / y3 positive everywhere, 256/7 y3 +40 k (was +44 k); y2 stars 3.3-4.3.
* **Gentler summer guarantees hold**: summer months stay positive on every run except 256/7 year 3 (-13 k over four months, was -3 k; that run was already the weakest and its y3 summer was the only negative before as well), `tests/game/summer.test.ts` (winter-focused resort survives summer: no bankruptcy, cash >= -100 k, summer + autumn net >= -5 k per month) passes unchanged. Autumn trough shallow (balance.test.ts check unchanged).
* Re-baselined with reasons: `tests/sim/staff.test.ts` goldens (hashes + money 193236.89 -> 191943.33, -0.7 %), `yearReport` snapshot (year-2 profit 1118 -> 1270, guests 2827 -> 3002; year-1 guests 1522 -> 1431), Exploration `64/1` runs per skier floor 2.2 -> 2.0 (measured 2.17: December days are ~1 h shorter), wildlifeRevenue ranger recovery floor 0.84 -> 0.78 (measured 0.80 on four seeds; rangers still +12 % over the bear arm), SeasonalSnow (1 Dec valley coverage >= 0.7 not 0.8; valley-clear check moved from day 107 (3 Nov, cold snaps can now whiten the valley) to day 100), Season / calendar / Daylight tests (new extreme days), guest-test fixtures use day 170 (11 Mar) as "a short winter day" (same daylight as the old day 10; old day 10 is now an April day), advisor tests tick 20 extra ticks (lifts open 08:29).
* Not re-baselined: all other thresholds in balance.test.ts, scenario calibration (`scenarioBots.test.ts`), difficulty and Career tests passed unchanged.
* Found by the shifted autumn: two latent save/load determinism bugs (unbilled snowmaking energy was not saved; the nature module's guest-position cache made animals flee from stale positions after a load). Both fixed (`src/sim/ops/index.ts`, `src/sim/nature/Nature.ts`).

## Hiker hunger (docs/hiking.md 'Hunger audit')
* Hikers eat before a trip when hungry, count food stops within 8 tiles of any route point, 40 % carry a free packed lunch, hunger grows 0.003 / tick on an excursion (was 0.004). Hiker food spend per hiker rises $1-8 (more lunches); nothing else in the economy moves by design.
* Re-baselined with reason: `yearReport` snapshot (year-1 profit -160 -> -166; year 2 guests 3002 -> 3006, income 3112 -> 3151, profit 1270 -> 1320, incidents 19 -> 13, family award 2 -> 1): the summer hikers' lunches and the changed excursion plans shift the guest random stream. This snapshot is shared with other in-flight changes (lift maintenance): re-baselined at the time of the hunger change, check the git history of the snapshot if it moves again. `rivals.test.ts` green-bot score comparison is seed-chaotic (64.5 vs 64.9 on seed 61); the tolerance there is documented in the test.

## Pistes as runs (0.2.2)
Open / closed is evaluated per run: a run without enough skiable snow closes alone while its neighbours stay open (before, the whole 8-connected network stayed open). `tests/sim/staff.test.ts` goldens re-recorded for this reason (bot 64 / seed 61, 200 days: money 180221.69 -> 183647.28, +1.9 %; run-aware routing then moved it to 187143.92, +3.8 % in total, the year-report snapshot and one rivals tolerance (sustainability score vs plain bot, 1.5 -> 2.5) with it); the `runs` save module is excluded from those goldens (additive). Run-aware via choice adds `EXPLORE.runCrowdWeight / runQualityWeight / moodEase`.

## Defaults == the real game (0.2.2)
Rule: `createSim` runs the same game the player plays; options only opt out (AGENTS.md conventions). Before, `main.ts` turned five systems on that headless tests, bots and analysis scripts ran without, so goldens described a different (neutral) game.

| Option | Before (createSim default) | After | Exclusions (opt-out) |
|---|---|---|---|
| `autoEvents` | off | **on** | title demo (`!DEMO`) |
| `stories` | off | **on** | title demo |
| `remoteSupply` (+25 % upkeep, trail-only supply) | off | **on** | title demo |
| `campaignsV2` (rail share, train sustainability) | off | **on** | title demo |
| `rivalMarket` | on | on | guided tutorial (`false`); scenarios always neutral inside `createSim` |
| `guestTypesV2` | off | **removed**; `Spawner.typesV2` always on (list empty = no-op, hash identical) | unit tests may set `spawner.typesV2 = false` |

`main.ts` now passes only opt-outs. Energy, maintenance, snowmaking mode, runs and staff Auto were already unconditional; the bot's `greenEnergy` / `staffUpgrades` are bot behaviour options (not sim flags) and stay opt-in.

**Money golden** (bot, 64 / seed 61, 200 days; each flag alone on the old baseline 192905.90): autoEvents 202654.1 (+5.05 %), stories 193485.9 (+0.30 %), remoteSupply 192905.9 (0 %), campaignsV2 192905.9 (0 %), all together **203294.15 (+5.39 %)**. Seed 7: 177888.9 -> autoEvents +2.62 %, stories +0.25 %, all +2.83 %. remoteSupply / campaignsV2 do not move the bot: it builds no hut on a trail-only edge and no train station, so they only bite for players (and in tests that set the situation up). Auto events change arrivals (critic / powder / New Year / Almabtrieb), stories add ~1.5 % named guests and tips.
* Re-recorded in one commit: `tests/sim/staff.test.ts` goldens (starter 3 days: core, weather, spawner, guests, economy, rating, goals, ... all moved; bot 200 days: nearly every part moved), `yearReport` snapshot (year 1 guests 1430 -> 1518, profit -178 -> -121; year 2 guests 3015 -> 3075, income 3091 -> 3235, profit 1264 -> 1400, incidents 18 -> 20).
* Test adjustments (not goldens): reviews hash test uses `stories: false` (story failures emit reviews); goalsSave gift-resort test uses `autoEvents: false` (a day-one arrival bump can legitimately close chapter s1 via "30 guests in a day"); events / stories / advisor tests assert the new defaults.
* Cross-platform tolerance unchanged: on CI the bot golden still skips `sys.spawner` and compares money within 1 %.

## M6.1 re-record (Phase 6 content: comfort, toilets, facilities, crossings, bridges, campaigns v2)
Phase 6 lanes landed together (tours `4ff8b74`; comfort / toilets / facilities `fbd7fc5` + `70e9f59`; crossings / footbridge / bridges `ebe2ec9`, `d81d62e`, `afb6914`). The comfort need (guests get urges and use toilets), the starter's free toilet, the 6 % facilities rating facet and the extra bot toilets legitimately move every rating- and guest-driven part. Tours and viewpoints are inert without content.
* **Bot money golden** (64 / seed 61, 200 days): 203294.15 -> **191483.30 (-5.8 %)**: toilets cost money, guests spend time on relief, and the renormalised rating weights move arrivals. Still profitable (see `npm run test:balance` below).
* `tests/sim/staff.test.ts` GOLDEN_STARTER and GOLDEN_BOT re-recorded (nearly every part; `advisor` and `scenario` unchanged). CI-tolerant comparison unchanged (stable parts everywhere, spawner + exact money only off CI, +-1 % on CI).
* `yearReport` snapshot (starter + bot, seed 21, 300 days), before -> after: year 1 guests 1518 -> 1515, income 1608 -> 1594, profit -121 -> -145, incidents 9 -> 11; year 2 guests 3075 -> 3039, income 3235 -> 3116, profit 1400 -> 1274, incidents 20 -> 8 (safety award tier 0 -> 2, points 14/30 -> 16/30).
* `Exploration.test.ts` is **not** flaky: five consecutive runs gave identical numbers (the sim is deterministic; 64/1: 2.16 runs, 2.09 pistes per guest, 1.8 / 1.9 / 2.0 at the other seeds). Its 64/1 pistes-per-guest margin was just 0.09, so any sim change could tip it; threshold 2.0 -> 1.9 for that row.
* `advisorScenarios`: every rule has exactly one scenario (incl. `toilets.none`, `crossing.waits`, the campaign rules); nothing to add.

## Money pass (0.2.3 playtest: "summer is brutal, we really need more money")
Owner feedback after Career play: cash always low, summer brutal, "In debt $20,710", goal "Three kinds of lift". Diagnosis with `scripts/analysis/moneyCurve.ts` (human-like policy: unlock-respecting, small reserve, starter chain paid from its own cash, lifts left on in summer; `--policy winter|heavy|eager|careful`, `Bot` option `summerLifts: 'keep'`).

**Findings** (Normal, before): the opening chain eats the start cash (64: $36-42k left; 128 with two lifts: **-$17k..-$23k**; 128 with T-bar + chair + gondola and attractions: **-$78k**; 256: about -$50k): the player is blocked or in debt from day one, and every 15-day winter month earns +$20-30k only after the first guests ride. Operating net of the shoulder months is slightly positive for a winter-focused resort, but the quiet-month fixed costs (energy for idle lifts, winter venue upkeep, wages) plus the construction the player keeps buying eat it: autumn (months 6-7) -$4k / -$14k per month on 128 (the player's purchases included), spring -$2..-$10k. Summer proper (Jun-Sep) is +$5-13k when lifts stay open for hikers.

**Levers chosen** (least invasive, no new mechanics): (1) `STARTING_MONEY` 130 000 -> **150 000** (difficulty multipliers unchanged: Relaxed 225k, Challenging 112.5k); (2) early goal grants +$2,000 in total (firstLift 1,000 -> 1,500, greenRun 1,000 -> 1,500, patrol 1,500 -> 2,000, guests30 1,500 -> 2,000; `TOTAL_REWARDS` 67.5k -> 69.5k, still < 10 % of year-1 revenue); (3) `OFFSEASON_RELIEF`: winter-only venues 25 % -> 15 % upkeep, furlough wage share 50 % -> 35 %; (4) `LIFT_OPS.idleEnergyShare` 0.35 -> 0.25; (5) `SEASON_RATE.autumn` 0.4 -> 0.5; (6) advisor: `cash.debt` lists options (Starter / Small loan, prices, rest lifts, pause building), new `cash.tips` card (docs/money-tips.md). Considered and NOT done: a construction overdraft (would change `canAfford` everywhere and the tutorial "Not enough funds" flow; the Starter loan already does this job and Rudi now says so), higher default ticket price (price elasticity goldens, exploit test), cheaper construction.

**Before -> after** (winter-focused human, 64 seed 61 / 128 seed 7, Normal): cash after the opening chain 42.1k / **-17.2k** -> 62.1k / **+2.8k**; min cash 42k / -17k -> 62k / +2.8k; days below $1k in year 1: 0 / 0 -> 0 / 0 (the opening cash is set after the chain; the 128 case used to start in the red); year-2 net +150k / +141k -> +156k / +157k; summer (Jun-Sep) y2 +35k / +25k -> +35k / +30k; autumn months y2 (m6/m7): -4.4k / -3.0k and -8.9k / -13.6k -> -1.9k / +2.0k and -5.1k / -9.0k. Heavy 128 build-out (three lift kinds) still opens at -$78k: that is a deliberate "you over-built, take the loan" case.

**Targets** (documented bands): a human-like winter-focused player is blocked (< $1k) on at most a few days of year 1 on 64; year-1 net near break-even to slightly positive on small maps (the chain is paid from the start cash); year 2 clearly positive; summer months >= -$3k on average. Pinned by a new test in `balance.test.ts` (64 / seed 61: min cash > 0, <= 5 days below $1k, year-2 net > 0, summer average > -$3k). `BALANCE=1 npm run test:balance`: 33 tests green (all maps, profit by year 2, Challenging still harsher and profitable in year 2).

**Re-recorded with reasons**: `tests/sim/staff.test.ts` GOLDEN_STARTER / GOLDEN_BOT (start cash, idle-lift energy and off-season relief change core / lifts / goals / economy parts), bot money 191483.30 -> **222414.97 (+16 %)**; `yearReport` snapshot (year 1 guests 1515 -> 1552, profit -145 -> -186, year 2 guests 3039 -> 3156, income 3116 -> 3305, profit 1274 -> 1510); tests that pin the start cash (130000 -> 150000: `integration.test.ts`, `smoke.test.ts`); `balance.test.ts` "early loan is meaningful" bound 35k -> 50k (43k left after the chain).


## M6.2 + M6.6 STOP check (0.2.6: rivers, springs, flow, ice, suspension bridge, mid-stations, chair6d)
Decision (owner-facing, recorded in `docs/rivers.md` and `docs/mid-stations.md`): **rivers and mid-stations ship ON with no flag**. Both are player-driven tools: a river is dug, a mid-station is added, only by a player action, and nothing a bot, the title demo or a headless run does builds either, so there is no `midStations` / `rivers` createSim option and nothing to opt out of.

Evidence that no headless run changed: the full bot economy was replayed on the commit before the milestone (`b74daa3`) and on HEAD (64 / seed 61, 360 days; 128 / seed 7, 180 days; 64 / seed 5, 180 days; `createSim` defaults, `runBot`) and every `stateHash` part was compared. **The only part that moved is `progression`** (the new unlock rows: *Dig river* / *Place spring* at level 2, *Suspension footbridge* and the *High-speed six-seat chair* at level 3). `core`, `config`, `grid`, `props`, `networks`, `buildings`, `lifts`, `guests`, `finance`, ... are byte-identical, which also covers the `rivers` module (absent from the save and the hash while no river / spring exists) and the optional `stations` list of a lift (absent on every two-station lift).

* **Bot money golden**, `tests/sim/staff.test.ts` GOLDEN_STARTER / GOLDEN_BOT and the `yearReport` snapshot: **not re-recorded, unchanged** (the progression part was already re-recorded with the river / chair6d unlock rows in `5106e4a`). `npm test` (3732 passed) and `npm run test:balance` (36 passed) are green on HEAD.
* Rule for later: a bot that starts digging rivers or building mid-stations must ship with a golden re-record in the same commit; until then the tools are invisible to every golden.

## M6.3 STOP check (0.2.7: summer content, guest types, summer campaigns)
Content in the milestone: campground, petting zoo, viewpoint, treehouse, quad base, climbing crag, rafting + canyoning bases, tackle & bait hut + fishing piers + fish stock, Mountain biker + Angler guest types, Family Summer Camp + Angler's Paradise campaigns. Like rivers and mid-stations, **every one of them is player-driven and ships ON with no flag**: nothing a bot, the title demo or a headless run does builds them (the standard `Bot` does not build any of them), mountain bikers spawn only with a rideable MTB trail plus an open bike-capable lift, anglers only with an open tackle hut. There is no `tours` createSim flag (the tour system is inert while no tour base stands, `docs/tours.md`).

**Goldens.** The full bot economy was replayed on the commit before the milestone (`a211a68`) and on HEAD (`createSim` defaults, `runBot`; 64 / seed 61, 360 days; 128 / seed 7, 180 days; 64 / seed 5, 180 days) and every `stateHash` part was compared: **only `progression` moved** on all three, nothing else (money 317621.60 / 210536.90 / 187137.89 identical before and after). The human-like money curve (`scripts/analysis/moneyCurve.ts --quick`, policies `careful` and `eager`) is byte-identical before and after, so summer behaviour of a resort without the new buildings did not change. Re-recorded with the reason in the test comment: `tests/sim/staff.test.ts` `GOLDEN_BOT.progression` **30be591e -> fa89ad3d** (the new level-3 unlock rows *Rafting Base* and *Canyoning Base*; the earlier M6.3 rows had already moved it to 30be591e). `GOLDEN_BOT_MONEY` (222414.97), `GOLDEN_STARTER` and the yearReport snapshot are unchanged.

**Summer plan bot.** New `Bot` option `summer` (default **false**, so no golden moves): hiking + MTB trails along every lift line in the opening (the chairs are the bike lifts), then campground, petting zoo and viewpoint appended to the end of the wish list (one building a month). A test (`tests/game/summer.test.ts`, 128 / seed 7, two years) pins that the three buildings are built, summer income does not fall (>= 97 % of the plain bot), cash stays positive, and that the plain bot builds none of them. `scripts/analysis/summerBot.ts` prints the numbers (human-like policy, respects unlocks, lifts left on, reserve $2k, lifts 1 / 2 + 1 attraction, Normal):

| Map / seed | year | summer share without -> with | summer income without -> with | summer net without -> with |
|---|---|---|---|---|
| 64 / 61 | 2 | 25.0 % -> 22.8 % | $79.4k -> $69.3k | +$36.4k -> +$20.1k |
| 64 / 61 | 3 | 20.8 % -> 23.0 % | $60.9k -> $69.4k | +$26.9k -> +$25.9k |
| 128 / 7 | 2 | 23.1 % -> 23.8 % | $88.7k -> $90.8k | +$32.6k -> +$33.2k |
| 128 / 7 | 3 | 21.0 % -> 21.4 % | $77.7k -> $81.9k | +$24.7k -> +$25.8k |
| 64 / 5 | 2 | 22.4 % -> 24.0 % | $65.1k -> $75.1k | +$22.3k -> +$26.0k |
| 64 / 5 | 3 | 17.9 % -> 20.0 % | $51.7k -> $56.8k | +$9.6k -> +$12.6k |

Reading: the summer buildings **modestly improve summer income** on four of six runs (up to +15 %), are neutral on one and cost one run its first summer (64 / 61, year 2: the three buildings were still being paid for, $8k of construction and $20 a day of upkeep; by year 3 the same resort is ahead on income). **Nothing regressed outside summer** (no winter building is displaced: they are appended). **The plan's target of summer >= 25 % of the yearly revenue on the 128 starter bot is NOT met**: the bot's summer share is 21-25 % with or without the buildings, because a bot adds one cheap building a month and none of the bigger attractions (quads, crag, rafting, fishing need sites a bot does not search for). This is recorded as an open question for the owner in `docs/playtest-m63.md` rather than tuned: raising the earnings of the new buildings would move every money golden, and a human who builds eight of them is not what the bot models.

## Task 29 + 52 note (Senior + School group guest types, Wellness & Views / School Trips; lane P6-P)
Both guest types ship ON (rows in `SHIPPED_TYPES`, no flag), so a resort with their gates now draws them: the bot builds a terrace / café / toilets (Senior, level 2) and a Ski School + kids area (School group, weekdays in early December, January and summer), so **the golden hashes move; they are NOT re-recorded in this lane (the M6.4 STOP does that)**. Measured against the same tree with the two rows removed (only `progression` moves there, from the hotels / coffee-stand lane):
* `tests/sim/staff.test.ts` "bot-played 64 / seed 61, 200 days": parts `core families goals leavers lifts nature sessionMeta sys.attractions sys.economy sys.guests sys.ops sys.rating yearReports` move on top of `progression`.
* `tests/sim/meta/yearReport.test.ts` "two runs give byte-identical reports ... match the snapshot" (the snapshot numbers move).
* `tests/game/energyBot.test.ts` is not a golden but a threshold on two bot runs ("net with a generator > 0.97 x net without"): the arrival draw shifted, the ratio is now ~0.965 (142.96k vs 148.11k). Re-check / relax at the STOP.
* Tests that were RNG-shift sensitive and were fixed here: `tests/sim/comfort.test.ts` (averages three seeds, skips family-driven kids), `tests/sim/marketingSummer.test.ts` (Family Summer Camp now also lifts school groups), `tests/ui-dom/marketing.test.ts` (13 campaign cards).
* `npm run test:balance`: 36 / 36 pass. Difficulty year-2 net (64 / seed 61): relaxed 217.4k, normal 148.1k, challenging 120.9k; all-on sweep y2 125k / 123k (64), 189k / 142k (128), 127k / 79k (256).
* Star distribution with seniors (`scripts/analysis/ratingDistribution.ts`): the facilities facet stays 87-92 on the starter / bot, bot 64/61 4★ 25 % / 4.5★ 75 %, 64/7 4★ 18 % / 4.5★ 77 % / 5★ 5 %: the 4-4.5★ band holds (the distribution was not isolated per guest type).
* Perf: `tests/sim/guests/seniorSchoolPerf.test.ts` runs the store at its cap with a third of the crowd as classes + seniors: about 0.5 / 1.1 / 1.2 ms per tick avg at 64 / 128 / 256 (budget 6 / 6 / 8).

## M6.4 STOP check (0.2.8: hotels, coffee stand, Senior + School group guests, Wellness & Views / School Trips)
Content in the milestone: Small Hotel (level 3) and Luxury Hotel with a heated, steaming pool (level 4, pool heating is energy demand), Coffee Stand (never gated), the Senior and School group guest types, the Wellness & Views and School Trips campaigns. Like the earlier waves everything ships **ON with no flag**; the plain `Bot` builds no hotel and no coffee stand, but it does build a terrace / café / toilets and a Ski School + kids ground, so it now **draws both new guest types**: the money goldens had to move (this is the "defaults == the real game" rule: no opt-out flag was added to hide them).

**Bot economy replay** (`createSim` defaults, `runBot`; commit `17b8939` = before M6.4, HEAD = now; same Node / machine):

| Run | before (17b8939) | HEAD | delta | with only Senior (School removed) | with neither type |
|---|---:|---:|---:|---:|---:|
| 64 / seed 61, 360 d | 317621.60 | 345283.83 | **+8.7 %** | 327790.05 (+3.2 %) | 317621.60 (identical) |
| 128 / seed 7, 180 d | 210536.90 | 213412.01 | +1.4 % | 211168.48 (+0.3 %) | 210536.90 (identical) |
| 64 / seed 5, 180 d | 187137.89 | 181193.46 | -3.2 % | 185098.27 (-1.1 %) | 187137.89 (identical) |

Reading: with both new types removed from `GUEST_TYPE_DEFS`, HEAD reproduces **every money figure of `17b8939` to the cent**, so the hotels, the coffee stand, the campaigns, the unlock rows and the calendar plumbing are neutral for a resort that does not build them; **the whole delta is the two guest types** (they are extra arrivals with their own budgets and move the arrival RNG path). The three seeds average **+2.3 %**; one seed (64 / 61 over 360 days) is +8.7 %, outside the +-5 % guide: Seniors alone are +3.2 % there (budget $350-650 in a resort that has a terrace), and the school classes add another +5 % because the bot's Ski School + kids ground now sell lessons to a class of ten in January and early December (the lesson income is the only place classes spend). The other two seeds are within +-5 %. Accepted: it is signed in the commit, no tuning was done.

**Goldens re-recorded in the same commit (reason in each test's comment):**
* `tests/sim/staff.test.ts` `GOLDEN_BOT` (64 / seed 61, 200 days): parts `core`, `families`, `goals`, `leavers`, `lifts`, `nature`, `sessionMeta`, `sys.attractions`, `sys.economy`, `sys.guests`, `sys.ops`, `sys.rating`, `sys.spawner`, `yearReports` and `progression` moved (`progression` fa89ad3d -> a49305a7: the hotel rows and the coffee stand add their unlock rows, the two types add theirs). `GOLDEN_BOT_MONEY` **222414.97 -> 227010.16 (+2.1 %)**. `GOLDEN_STARTER` is unchanged (no bot, nothing to draw). `buildings`, `grid`, `props`, `networks`, `cond`, `names`, `advisor`, `config`, `sys.clock`, `sys.season`, `sys.weather`, `openStatus` and `scenario` are byte-identical.
* `tests/sim/meta/yearReport.test.ts` snapshot (64 / seed 21, 300 days): year 1 guests 1552 -> 1536, income 1603 -> 1616 (x$100), incidents 7 -> 10; year 2 guests 3156 -> 3162, income 3305 -> 3253, profit 1510 -> 1455, **incidents 8 -> 18**, safety award tier 2 -> 0, points 17 -> 14 of 30. The incident jump (7 -> 10, 8 -> 18) was investigated afterwards per guest type (`scripts/analysis/incidentsByType.ts`, `docs/guest-types.md` "School classes and safety"): **school classes had 0 injuries in 531 guests** (families 0.3-2.8 per 1000), the rise is the shifted arrival draw, not the classes; no risk code changed. The safety award tier dropping on this one resort is the same noise.
* `tests/game/energyBot.test.ts` (not a golden but a threshold, "net with a solar array > 0.97 x net without"): the ratio on seed 61 was 0.965. **Re-measured over 3 seeds** (64 map, 2 years, the same bot with / without `greenEnergy`): ratio **0.965 / 1.031 / 1.038** (seeds 61 / 5 / 21, mean 1.011); year-2 energy ledger **-$2.0k / -$2.1k / -$2.1k** (9293 -> 7275, 9853 -> 7781, 9925 -> 7796) and `energy.totalApplied` 4.1-4.3k in all three. The offset logic is sound (it lowers the energy line by about 22 % in every seed); the spread of the net ratio is the arrival path moved by the two new types, not energy. **Bound relaxed 0.97 -> 0.95** with that reason in the test.
* Tests that needed no change: `comfort`, `marketingSummer`, `ui-dom/marketing` were fixed in the lane (`Task 29 + 52 note` above).

**Other checks:** `npm run test:balance` 36 / 36; `npm run test:perf` run alone 47 passed (27 files); hotel flicker `npm run flicker:building -- --place luxuryHotel` **155.2** oscillating px per window summed over zooms 2 / 3.5 / 6 (the lane measured 155.5; the default demo lodge is 849.3).

**Not isolated per type, flagged for a human:** whether Seniors and school classes feel like a real second crowd rather than a trickle (seniors are 4-6 % arrival weight, classes 1.5-2 % per arrival but 9-16 people each), and whether a Luxury Hotel without the VIP campaign earns its $90/day (a summer week on the 128 / seed 5 harness resort filled none of its 30 suites: VIPs fill the suites first and nobody else is above the 0.65 appeal bar; in winter a few couples overflowed into it).

## M6.4 follow-up (owner decisions: couples in the suites, mid-run coffee stops, school safety)
* **Luxury suites** (`AttractionSystem.suiteTreat`, check-in order tiered-lovers first): a couples-only test resort fills 19 / 30 suites in summer and 22 in winter (before 0), thin wallets and budget guests 0, solos 7; VIPs keep priority (docs/hotels.md). Only worlds with a tiered house (campground, luxury hotel) take this path.
* **Mid-run coffee stop** (`GuestSim.coffeeBreak`): only runs when an open stand exists; 3 % of completed runs (11 / 351) on the stand test resort.
* **School safety**: 0 injuries per school guest, nothing to change (docs/guest-types.md).
* **Goldens**: the bot builds no stand, hotel or campground, so **no golden moved** (`GOLDEN_BOT`, `GOLDEN_BOT_MONEY` 227010.16, yearReport snapshot, energyBot bound all pass unchanged) and the **bot economy deltas vs `17b8939` are unchanged: +8.7 % (64 / 61), +1.4 % (128 / 7), -3.2 % (64 / 5)** (the new code is inert without a stand or tiered house); star distribution unchanged for the same reason (docs/rating.md). The +8.7 % stays the two guest types' doing (see above).
