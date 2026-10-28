# Rival resorts, market share and the Green Resort (M5.4 Task 23)

Code: `src/sim/meta/Rivals.ts` (rivals, share, awards benchmark, year section), `src/sim/meta/Sustainability.ts` (the rating facet, see docs/rating.md), data and tuning in `src/config/rivals.ts`; wiring in `src/game/createSim.ts` (`sim.rivals`, `sim.sustain`); save module `rivals`; UI: the market-share line in the rating panel (`StRating`) and "The region" row of the year report (`StYearReport`); tests `tests/sim/rivals.test.ts`.

## Rivals

* **2 or 3** neighbours, from the map seed (`rivalCount`: one bit of a seed hash). Name = unused prefix (Silberhorn, Gletscher, Edelweiss...) + suffix (Ski Area, Resort, Peaks...). Each has a long-run star level (3.0 - 4.0, one decimal) and a day-pass price ratio (0.90 - 1.15, 1 = fair).
* They are not simulated resorts, just two numbers that move: every 15 game days a rival's stars step 25 % toward its goal plus noise (+-0.18); the goal rises by 0.1 stars a year up to 4.6, so a resort that stands still slowly loses ground. The price wobbles +-6 % around its base. All of it uses **one own Rng stream** (`seed ^ 'mark'`, state saved), advanced only by the monthly step; the sim RNG is never touched.
* **Market share** is a multinomial logit: utility = 0.9 x (stars - 3) - 1.2 x (price ratio - 1); your share = e^u / sum(e^u). Equal resorts share equally. You use your displayed stars and `pricing.ratioOf('dayPass')`.

## Arrival multiplier

`1 + ramp x (clamp(1 + 0.25 x (share / fair - 1), 0.9, 1.12) - 1)`, multiplied into the spawner attractiveness next to the wildlife and event factors.

* `ramp` = 0 for the first 30 days of a game, then linear to 1 over 150 days: a new resort is not judged before it exists.
* **Exactly 1** (a literal `1`, asserted) in scenarios (their thresholds are calibrated against fixed arrivals) and in the guided tutorial (`createSim({ rivalMarket: false })`, the only opt-out `main.ts` passes besides the demo ones); the share is still shown there. Also 1 when your share equals the fair share.
* Bounded by design: -10 % / +12 % at most, so price extremes and the existing demand elasticity (which already punishes high prices) cannot be compounded into an exploit. The price part only matters inside the share.

## News

Rare and quiet: one `milestone` (non-major, no toast spam) line when the market leader changes with a 3-point margin ("Your resort is now the most popular in the region" / "<rival> has overtaken you in the region"), at most once per 90 days, never in scenarios / tutorial, never in the first 105 days.

## Year report

`YearReport.rivals` (absent in older reports): your mean share, fair share, rank and each neighbour's mean stars / share over the year (`Rivals.section(year)`, from per-year accumulators saved in the module). The dialog shows "The region: you ranked k of n" with a bar per resort. **Awards**: `Rivals` is the `BaselineProvider` (`sim.yearReports.baselines`): the static regional table x q, q = 1 + 0.2 x (mean rival stars - 3.5) (incidents divided by q instead; `guestGrowth` and `profitMargin` stay static). At 3.5★ neighbours q = 1, so the table is unchanged. New award **Green Resort** (`green`, baseline 55): year-mean sustainability facet / baseline, tiers at the usual ratios (bronze 0.9 = 50, silver 1.2 = 66, gold 1.6 = 88; the bot is silver / gold, a resort that fells forest and covers habitat is not).

## Save

Module `rivals` v1 (additive; old saves get fresh rivals from the seed and a new 30-day grace): rivals, Rng state, start day, news timer, leader flag, per-year accumulators, the sustainability tracker (energy / guest EMAs) and the tree counters (`PropStore.treesFelled / treesPlanted`, which are not part of the quantised `props` module). Listed before `goals` (which stays last).

## Bot

`BotOptions.green` (default true): builds on open ground before forest habitat (tile footprint check, falls back to habitat when nothing else fits), replants conifer stamps ($12 a tree) each month until planted >= felled, and trains the rangers when habitat overlap > 6 % (otherwise never: they cost $18/day). With `staffUpgrades: true` the fixed `BOT_UPGRADE_ORDER` (rangers last) applies unchanged.

## Tuning

Everything is in `src/config/rivals.ts` (`RIVALS`, `SUSTAIN`). Check with `npx vite-node scripts/analysis/ratingDistribution.ts` (star distributions + facet parts + share, `UPG=1` adds the staff upgrades) and `npm run test:balance`.
