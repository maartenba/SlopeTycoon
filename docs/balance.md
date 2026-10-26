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
