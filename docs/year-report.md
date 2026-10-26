# Resort of the Year report (M5.3, Task 17)

At the end of every in-game year (180 days, 12 months of 15 days) the game stores a **year report** and, unless switched off, shows it in a dialog. Decision D8: no sharing anywhere. The only output is a local PNG download.

## Pieces

| file | role |
|------|------|
| `src/sim/meta/StatsHistory.ts` | daily ring buffer (360 days), query helpers, save module `stats` v1 |
| `src/sim/meta/YearReport.ts` | `computeYearReport` (pure) + `YearReports` store (last 10, save module `yearReports` v1) |
| `src/sim/meta/demoStats.ts` | debug generator `__slope.stats.demoYear()` (two plausible years) |
| `src/config/yearAwards.ts` | award definitions, tier / headline thresholds, `BaselineProvider`, static regional table |
| `src/ui/components/StYearReport.ts` | the dialog (`st-year-report`, shared `Modal`, width `lg`) |
| `src/ui/yearReportFormat.ts` | pure view helpers: tiles, highlights, SVG charts, medals, `YearReportGate` (auto-pause) |
| `src/render/view/yearCompose.ts` | PNG compositor (pure layout ops + canvas replay) |
| `src/render/view/PhotoMode.ts` `captureCover()` | the small cover shot |
| `src/ui/components/StFinance.ts` | the **Reports** tab |

## Data flow

`Economy.closeDay()` (called by `Finance.endDay` after upkeep and wages are booked) -> `StatsHistory.captureDay()` writes the entry for the day that just ended. When that day is the last of a year, `YearReports.generate(year)` computes the report from the ring and emits `year:report`. Everything is a read-only observer: no RNG, no sim writes, so `stateHash` of two identical runs matches (the two modules are part of the hash, `tests/sim/meta/yearReport.test.ts`). Capture costs < 0.2 ms (asserted with fake sources: ~0.004 ms; real sim measured 0.014 ms on a 64 map and 0.065 ms on a 256 map, dominated by the strided piste-tile sample).

## Metrics (per day, `StatsHistory`)

`arrivals`, `family` (family-type arrivals), `peak` (max guests seen at hourly samples), `income` / `expense` and `inc:<category>` / `exp:<category>`, `rating` (stars), `happiness` (mean), `incCreated` / `incResolved` / `hospitalised`, `runs`, `snow` (mean depth on piste tiles, strided sample), `skiable` (share of piste tiles open for skiing), `quality` (mean piste surface score), `weather` (code, see `WEATHER_CODES`), `temp` (valley C), `queue` (mean lift wait in minutes, 09:00-16:00 hourly samples), `wildlife` (sightings), `attacks`.
Queries: `series(metric, {from,to})`, `summary` (n, sum, mean, min, max), `monthly(metric, agg)` (15-day months), `yearAgg(metric, year, agg)`, `at`, `hasYear`. Types: Uint16 for counts, Float32 otherwise.

## Awards

Ratio `r` = your value / benchmark (or benchmark / value when fewer is better), capped at 3. `r >= 0.9` bronze, `>= 1.2` silver, `>= 1.6` gold (`TIER_RATIO`, inclusive). An award that cannot be judged (e.g. Rising Star in the first year, Snow-Sure without 15 winter days) is skipped and does not count towards the maximum.

| award | value | benchmark (128 map) | direction |
|-------|-------|---------------------|-----------|
| Best Family Resort | family arrival share x mean happiness | 0.34 | more |
| Safest Slopes | incidents per 1,000 guests | 4 | fewer |
| Best Piste Quality | mean piste surface score (powder / groomed 1, packed .6, bumpy .35, slush .3, icy .2) | 0.66 | more |
| Snow-Sure Resort | share of piste tiles open on winter days | 0.6 | more |
| Gourmet Mountain | restaurant + bar income per arriving guest | $12 | more |
| Summer Star | income over the summer months | $70,000, x sqrt(size / 128) (0.5..2) | more |
| Efficient Operator | profit / income | 0.28 | more |
| Wildlife Friendly | 0.95 with no attack, +0.65 x min(1, sightings / 6); any attack = 0 | 6 sightings | more |
| Rising Star | arrivals this year / last year (needs a previous report) | 1.08 | more |

**Headline**: points = sum of tiers (1 / 2 / 3); share = points / (3 x judged awards). `>= 0.22` Bronze, `>= 0.40` Silver, `>= 0.62` Gold, else "A year on the mountain". A first year with fewer than 90 recorded days is *partial*: its headline is capped at Bronze and the dialog says so. The blurbs are one short plain line each; a few carry a light joke (D4).

### How to tune

* Change a benchmark in `REGIONAL_BASELINES`; check with `tests/sim/meta/yearReport.test.ts` (snapshot of the starter + bot run on the 64 map: first year partial, second a full year, Silver with 14/27 points) and update the snapshot deliberately.
* Change the tier or headline cuts in `TIER_RATIO` / `HEADLINE_SHARE`. The bot (a "reasonable, not clever" player) should land around Silver, a careless resort at nothing, only an excellent one at Gold.
* Rivals (Task 23): implement `BaselineProvider { baseline(metric, {mapSize, year}) }` and assign it to `sim.yearReports.baselines`.

## Report contents

`YearReport` (compact JSON, ~3 kB + cover): year, name ("Your resort" until resorts can be named), days recorded, totals, 12 monthly rows, best / worst month, busiest day, best season, top income categories, top 3 venues (revenue earned this year), safety record, snowiest 7-day window, longest run of days with valley temperature >= 10 C, wildlife sightings / attacks, goals completed, resort level (`sim.progression?.level`), awards, headline, delta chips against the previous report (guests, income, profit, rating) and the optional cover.

## Dialog behaviour

* Opens through `YearReportGate` (`src/ui/yearReportFormat.ts`, pure and tested): never during the tutorial, the title demo or after bankruptcy; waits behind other open dialogs (polled every second); pauses the game and restores the previous speed on close **only if** the clock is still paused (a speed the player picked meanwhile wins; an already paused game stays paused; a game that ended is not resumed).
* **Continue** acknowledges. **Remind me later**, Esc and the X leave the report unseen (a dot on the Reports tab). Focus is trapped by the shared modal system.
* Settings > Gameplay > **Year-end report** (default on, `localStorage slopetycoon.yearReport`): off = no dialog and no pause; the report is still stored and listed in Finance > Reports. The last month's card (Settings > month summary) says "Year report ready".
* **Save image** composes 1200x675 (cover, headline, tiles, medals) and downloads `slope-tycoon-year-<n>-report.png` through a normal `<a download>`. No network, no clipboard, no share button, no code.

## Cover

`PhotoMode.captureCover()` renders the current iso view once at ~480 px (restoring the WebGL canvas right after), paints the sky behind transparent pixels with the photo export code (`compositeExport`), centre-crops to 16:9 and encodes a JPEG, lowering quality until it is <= 30,000 characters (stored inline in the report, last 10 reports). It is skipped outside the iso view, in the title demo and without WebGL / 2D canvas (the dialog then draws a gradient cover). Measured in the SwiftShader harness: first capture ~1.2 s (software GL, includes first-use setup), later ones ~0.2 s; real GPUs are expected to be far below the 300 ms goal. It runs in a `requestAnimationFrame` after the year changes, before the dialog opens.

## Debug / QA

`__slope.stats.demoYear(endYear?)` fills the history with two demo years and (re)generates their reports without opening the dialog; `__slope.yearReport.show(year?, cover = true)` opens one. Shots: `npm run shot -- --size 64 --seed 61 --start winter --hour 12 --zoom 3 --extra "starter=1" --ticks 2400 --viewport 1280x800 --eval "__slope.stats.demoYear(); __slope.yearReport.show(undefined,true)" --out year-report-m53-x` (`.weave/shots/year-report-m53*.png`, `year-reports-list-m53e.png` for the Finance > Reports tab).
