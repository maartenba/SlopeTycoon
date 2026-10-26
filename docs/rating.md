# Resort rating, news & closures (Task 27)

**Rating** (`src/sim/Rating.ts`, inputs in `RatingInputs.ts`): evaluated once per in-game day (`rating` system). Score 0–100 → stars = score/20 in half-star steps.
Components (weight, since Task 23 / M5.4): happiness 23% (avg guest happiness + recent 'satisfied' leavers), safety 18% (incident penalty, response time, unresolved; capped at 60 without a Ski Patrol Hub),
variety 14% (attraction types, lift kinds, green/blue/red/black coverage, seasonal offer), piste quality 11%, queues 11%, crowding 4%, value 11% (day-pass price vs fair), **sustainability 8%** (see below),
plus bonuses (restaurants, lodging vs demand, up to +6). Unresolved incidents also multiply the total (−7% each, max −35%). Components are smoothed per day (α=0.35).
`Rating.breakdown()` returns component scores + hints ('Too few green runs', 'Long queues at Chairlift 1', 'Add a Ski Patrol Hub').
`rating:changed {stars, previous, reason, score}` is emitted only on star-level change, with hysteresis, max once per day.
Spawn: `Spawner.setAttractiveness(fn)`; `Rating.attractiveness(openLifts)` = 0.3 + 1.2·score/100 (×0.15 with no open lift).

**Closures**: `OpenStatus.closeTiles` now maintains `closedMask` (NavWorld.closed): all tiles of a closed piste + swept tiles are non-traversable/non-standable for skiers; flips are journaled
(`takeClosureFlips`, merged into `NavWorld.consumeFlips`) so paths revalidate; lifts are re-evaluated (a lift with no open descent closes); guests on closed tiles walk to the nearest standable tile (radius 10) or leave.

**News/toasts**: `ui/newsFormat.ts` (pure, one entry per GameEvent or explicit 'ignored'), `StNews` (bottom-right collapsible feed, click = focus camera, category mute checkboxes persisted in localStorage),
`ui/toastLimiter.ts` (coalesce ×N, max 4 visible, severity priority, mutes). `StGuestInspector` + `ui/guestInfo.ts`; HUD `st-rating` (stars + smiley, tooltip, click for bars/hints). No dock drawer was added.

## Sustainability facet and the rebalance (M5.4 Task 23, D7)

`WEIGHTS` (src/sim/Rating.ts) is now the old table x 0.92 rounded to hundredths, plus `sustainability` 0.08 (sum exactly 1):

| component | old | new |
|---|---|---|
| happiness | 0.25 | 0.23 |
| safety | 0.20 | 0.18 |
| variety | 0.15 | 0.14 |
| pisteQuality | 0.12 | 0.11 |
| queues | 0.12 | 0.11 |
| crowding | 0.04 | 0.04 |
| value | 0.12 | 0.11 |
| **sustainability** | - | **0.08** |

`RatingInput.sustainability` is optional: an input without it (older tests, snapshots) leaves the facet out and `weightedSum` renormalises the other weights, so those scores move by < 1 point (asserted in `tests/sim/Rating.test.ts`). A facet equal to the weighted mean of the other components is exactly neutral, so the rebalance only moves a resort that is clearly greener or browner than it is good.

**Facet** (`src/sim/meta/Sustainability.ts`, tuning in `src/config/rivals.ts` `SUSTAIN`, score 0..100 = 40 % energy + 30 % trees + 30 % habitat, each part 0..1):

* **Energy per guest**: rolling (EMA 0.06/day) dollars of lift energy + snowmaking per guest (guests = the larger of the day's arrivals and the guests present at noon). 1 at <= $2, 0 at >= $12. Bot / starter sit at $5-6 per guest (median) -> 0.6-0.7. Unknown (no guests yet) = 0.7.
* **Trees felled vs planted**: `PropStore.treesFelled / treesPlanted` count real trees (`TREE_KINDS`) removed (building, lift lane, terraform, clearing) and planted (saplings). Net loss share of the original forest `(felled - planted) / (live + felled - planted)`; the first 3 % is free (everybody has to build somewhere), 0 at 21 %.
* **Habitat overlap**: share of the original forest-habitat tiles (`forestDensity >= 64`) that now carry a piste / trail / path / road / building / lift. The first 6 % is free, 0 at 26 %. **`staffUpgrades.wildlifeProtection()` (trained rangers) takes half of the overlap off** (`SUSTAIN.habitat.protection`).
* Hint = the weakest part ('Plant trees to make up for the forest you cleared', 'Pistes and buildings crowd the wildlife: train rangers or keep to open ground', 'Energy use per guest is high: close idle lifts, fewer snow cannons'); at >= 75 the hint is the positive 'Gentle on the mountain' (never an advisor to-do).
* The HUD rating panel lists it with the other bars and a line "Market share N% (#k of m nearby resorts)"; the details panel is now `position:fixed` under the stars (the HUD box clips absolutely positioned children, so the panel was cut off before).

### Star distributions before / after (daily samples after day 10, 64 map, `scripts/analysis/ratingDistribution.ts`)

Same resorts, same seeds; "after" includes the facet, the new weights, the rival market share (from day 30) and the green bot. Mean = mean 0..100 score.

| resort (64) | seed | before: mean, stars | after: mean, stars |
|---|---|---|---|
| starter (sandbox gift, 350 d) | 61 | 86.5; 4★ 49 %, 4.5★ 51 % | 87.3; 4★ 43 %, 4.5★ 57 % |
| starter | 7 | 87.6; 3.5★ 0, 4★ 41, 4.5★ 58 | 87.9; 4★ 38, 4.5★ 62 |
| demo starter | 61 | 86.8; 4★ 28, 4.5★ 71 | 85.8; 3.5★ 1, 4★ 48, 4.5★ 51 |
| demo starter | 7 | 87.7; 4★ 29, 4.5★ 71 | 88.0; 4★ 27, 4.5★ 73 |
| demo large | 61 | 92.1; 4★ 5, 4.5★ 59, **5★ 37** | 88.4; 4★ 30, 4.5★ 69, 5★ 1 |
| demo large | 7 | 93.1; 4★ 2, 4.5★ 54, 5★ 44 | 88.6; 4★ 30, 4.5★ 70 |
| bot (2 years) | 61 | 86.3; 4★ 51, 4.5★ 49 | 86.9; 4★ 52, 4.5★ 48 |
| bot | 7 | 87.1; 4★ 48, 4.5★ 53 | 88.0; 4★ 44, 4.5★ 55 |
| bot + all six upgrades | 61 / 7 | 86.3 / 87.4 | 86.8 / 87.8 |

* **Starter, demo starter and bot keep the same star count** (4 - 4.5★ band; mean score within +-1.0 except demo starter 61: -1.0). The tutorial resort is additionally exactly neutral for arrivals (`rivalMarket: false`).
* **The large demo drops from 4.5 / 5★ to 4.5★ (mean -3.7 to -4.5 points) on purpose, not by accident**: it is a deliberately maxed-out build that fells 10-11 % of the forest and covers 14-16 % of the habitat, and its injected crowd (no arrivals through the spawner) makes energy per guest look 5x worse ($33 vs $5). Its facet is 32-38 against 86+ for the others. The title-screen demo never shows the rating, and `tests/game/demoResort.test.ts` / `demoTowns.test.ts` still pass unchanged.
* Component means after, bot 64/61: happiness 92, safety 96, variety 40, piste quality 69, queues 99, crowding 100, value 54, **sustainability 88** (raw values on the last sampled day: energy $9.8 per guest -> 0.22, net tree loss 0 %, habitat overlap 5 %).
