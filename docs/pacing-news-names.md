# Pacing, snow, news, names & rotation (Milestone 3 playtest fixes)

## Pacing (`src/config/balance.ts`, `src/core/pacing.ts`)
- (Superseded by the 'Update: 150 s day' section at the end.) 1 in-game day = 240 ticks (6 game minutes per tick). 1x = 10 ticks/s (day = 24 s), `SPEED_MULTIPLIERS = [0, 1, 2, 4]`; buttons 1x / 2x / 3x = day 24 s / 12 s / 6 s (the earlier 180 s/day pacing was reverted: a year took 18 h).
- **Fast nights** (setting, default ON, HUD moon button + debug panel checkbox, persisted in localStorage `slope.fastNights`): `nightWarp(hour)` multiplies the tick rate x1 -> x3: ease-in 20:30-21:30, x3 plateau 21:30-05:30, ease-out 05:30-06:30. It is pure and evaluated from the sim hour before every tick in `TickLoop` (acc = real seconds), so the sim stays tick-based and deterministic: only real seconds per tick change. Paused = nothing runs; catch-up cap unchanged. HUD shows `🌙»` / `🌙»»` while warping.
- Lighting (`Lighting.ts`) compresses the visual night: longer dusk/dawn golden hours, brighter moonlit blue night; calendar untouched.

## Summer snow (root cause)
The sim snow model was correct at the valley, but the upper 40 % of the relief stayed white deep into summer:
1. `SNOWLINE_KEYS` reached only 0.80 of the relief on day 60 (start of summer) and 0.95 on day 90; tiles above the snowline get no melt at all.
2. `MELT_M_PER_DEG_DAY` = 0.07 m/deg/day with the 16 degC/relief lapse left tiles at 0-4 degC melting 2 m of snow over weeks (measured, 256 map, seed 29: rel 0.6-0.8 still 100 % snowy on day 60, rel 0.8-1.0 12 % on day 120).
3. At the old 24 s/day pace a new game (starting day 240) needed ~60 real minutes at 1x to reach spring, so players never saw the thaw.
Fix: keys 0.95 on day 60, 1.05 on day 80, 1.3 mid-summer, snowline back to 1.0 on day 190; melt 0.16. Shader: depth drives snow (the altitude term is weighted 0.4) so white never outlives the sim.
Test: `tests/sim/SeasonalSnow.test.ts` (sizes 64/128/256 x 3 seeds).

## News
Tiers: critical / important / info / trivial. Feed model `src/ui/newsFeed.ts` (pure): trivial -> counters only; info -> only under the "All" filter (digests, sightings, openings);
important + critical -> rows (and toasts). Coalesce by key within an in-game day (xN, aggregated wording "3 pistes closed"), 30 rows max (lowest tier / oldest evicted),
daily digest ("Day 12: 34 guests arrived, 12 left"), weekly summary, "Today:" counters line, filter (All / Important / Critical) + Clear. Muted categories persist; default muted: weather, ops. Critical is never muted.
Toasts: only critical/important, max 4 visible, per-key cooldown 15 s (critical bypasses), single source = the news feed (`onItem` in main.ts).

## Names (`src/sim/Names.ts`)
Pistes 'Blue Run 3' (stable by tile sampling), lifts 'Chairlift 1', buildings 'Mountain Hut 2', otherwise 'the northern upper bowl'. `describeLocation(x, y)` returns `{kind, name, on, near}`
(nearest piste/lift/building within 4 tiles). Buildings are renamable in the inspector.

## Rotation
R / Shift+R rotate the ghost (tooltip hint, drawer header buttons, drawer info). Placed non-square buildings: inspector "Rotate" re-validates the rotated footprint (free tiles, slope, water, pistes, dependencies; never flattens, free of charge) and refuses with the reason.

## Fast nights follow the sun (update)
`nightWarp(hour, sun?)` now takes today's sunrise/sunset (`sim/Daylight.ts`): x3 plateau from sunset + 45 min to sunrise - 45 min (1 h eases), so summer nights (about 21:30-04:30) are short and winter nights (17:30-07:00) long, both warped; the fixed 20:30-06:30 constants remain as the no-argument fallback. See `docs/ski-exploration.md`.

## Update: 150 s day, [0, 1, 3, 8] speeds, 15-day months (time-flow change)

`REAL_SECONDS_PER_DAY_1X` = 150 (1.6 ticks/s at 1x), `SPEED_MULTIPLIERS = [0, 1, 3, 8]` (buttons 1x / 3x / 8x = day 150 s / 50 s / 18.75 s), calendar 15-day months / 180-day year (winter 60 days: 150 min at 1x, 50 min at 3x, 18.75 min at 8x). Fast nights stay x3, the ease windows are unchanged. The 24 s-day paragraphs above describe the previous pacing. Details, per-agent speeds and results: `docs/time-flow.md` section 8. Snowline keys / melt (this document's snow fix) are now keyed by year fraction: key days x0.5, `MELT_M_PER_DEG_DAY` 0.32.

## Update: 10x top speed, Skip to... fast-forward, sooner levels

`SPEED_MULTIPLIERS = [0, 1, 3, 10]` (buttons 1x / 3x / 10x = day 150 / 50 / 15 s; year about 33 min at 10x with fast nights). The speed control gained a `Skip to...` menu (Next month / Next season / Next event, key **K**): `core/FastForward.ts` runs fixed ticks in 11 ms batches per frame; it stops on important / critical events (the news categories that are `important` or `critical`, plus bankruptcy / debt warnings, level-ups, goal chapters, scenario end and the year report) and never skips them. Routine news (arrivals, weather, grooming, reviews) never stops it. The toast on stop says why. Details: `docs/time-flow.md` section 9. The Career levels were retuned about 30 % sooner (`docs/progression.md`).
