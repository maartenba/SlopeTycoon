# Statistics (M5.5, Task 30)

A read-only history of the resort plus a charts dialog. Nothing here can change a simulation outcome.

## Data: `src/sim/meta/StatsHistory.ts`
- **Daily ring**: one entry per closed in-game day (`Economy.onDayClosed`), last `STATS_DAYS` = 360 days (2 years) in typed arrays. Metrics: arrivals, family, busiest hour, income / expense (and every ledger / expense category), rating, happiness, **cash**, **sustain** (the sustainability facet 0..100), incidents, runs, snow, weather, queue, wildlife.
- **Monthly archive**: every closed 15-day month is folded into one row (`ARCHIVE_METRICS`: arrivals sum, busiest hour max, happiness / rating / sustain mean, cash at month end, income / expense and income categories summed). Kept for the whole game (capped at 40 years = 480 rows), so "All time" survives the daily window.
- **Observer-only**: the `stats` save module is flagged `observer: true`, so it is skipped by `stateHash`. Capturing only reads aggregates and never touches the sim RNG.

## Save size
`serialize()` writes the ring chronologically as quantised integers (counts / dollars whole, ratios in hundredths) in zigzag-varint base64 (`statsCodec.ts`); all-zero series are left out; `cash` is delta coded. Worst case (every series noisy) is ~40 KB raw after 5 years and ~25 KB gzipped; tests assert < 50 KB raw (`tests/sim/meta/statsArchive.test.ts`). Old saves (daily arrays, no archive) load and the archive is rebuilt from the kept days; saves without stats load empty.

## UI: `st-stats` (`src/ui/components/StStats.ts`, `src/ui/statsFormat.ts`)
- Open with **I**, the chart button in the top bar, or Statistics in the pause menu. It is a shared `lg` modal and pauses the game like the other dialogs.
- Ranges: 30 days, Year, 2 years (daily, bucketed to at most 36 points) and All time (monthly archive).
- Four canvas charts: Guests (arrivals + busiest hour), Cash, Rating (stars + sustainability on a 0..100 right axis), Revenue by category (stacked bars: top 5 + "Everything else").
- Accessibility: Okabe-Ito palette; the second line of a chart is dashed with square markers, bars have a legend with totals; every canvas has an `aria-label`, is focusable (left / right arrow keys read a bucket, hover too, via the tooltip), and "Show the numbers as a table" repeats all values as text. Nothing animates, so reduced motion needs no special case; charts redraw only while open (on open, range change, hover, resize).

## Testing / screenshots
`__slope.stats.demoYear(3)` fills three years of demo data; then press `I`. Shot: `npm run shot -- --size 64 --seed 61 --out NAME --eval "__slope.stats.demoYear(3)" --steps "key:i;wait:600"`.
