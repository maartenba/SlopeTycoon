# Playtest checklist: Milestone M5.3 (Career, scenarios, year report, achievements)

Build: `npm run dev` (or `npm run build && npm run preview`). Use **8x** for anything slow (a game day is 150 s at 1x, 50 s at 3x, 18.75 s at 8x). Everything below was verified headless (bots, unit tests, screenshots); **nothing was played by a human yet**.

## Time model at the three speeds

| | 1x | 3x | 8x |
|---|---|---|---|
| one game day | 150 s | 50 s | 18.75 s |
| one month (15 days) | 37.5 min | 12.5 min | 4.7 min |
| spring / autumn (30 days) | 75 min | 25 min | 9.4 min |
| summer / winter (60 days) | 150 min | 50 min | 18.75 min |
| a year (180 days) | 7.5 h | 2.5 h | **56 min** |

The game starts on day 120 (first winter), so the first year ends after 60 days: 19 min at 8x (that first report is "partial" and capped at Bronze).

## 1. Career from scratch to level 3-4

1. Main menu > **New game** > Career is preselected (recommended). 64 map is quickest; Start. (Alternatively `?mode=career`.)
2. Play the tutorial or build the chain yourself (lift + piste + parking + ticket office + lodge). Watch the **Goals card**: click the level chip (`L1`) to see the level panel (missing criteria, next unlocks).
3. Expected pacing (balance bot; a human may differ): **L2 within the first week** (150 guests, 15 in a day, 2 stars): the 6-seat chair and 6-person gondola unlock. **L3 at the end of the first winter** (about play day 45-60: 1,500 guests, 3 stars, 2 profitable months, goal chapter 1): funicular. **L4 late in year 2** (play day ~150-215, i.e. 47-67 min at 8x): helipad, 10-person gondola, 8-seat bubble chair. L5 / L6 need goal chapters 2 / 4 and profit.
4. Check: gold **L2** badge on locked lifts in the Lifts drawer, popover "Unlocks at level N", the **level-up card** (one confetti burst, "Show me" buttons), the news row. Debug shortcut: `__slope.progression.setLevel(4)` in the console.
5. **Pacing question (please answer)**: does L2 in the first week / L3 at the end of the first winter / L4 late in year 2 feel right, given that only 9 items are gated? Too slow? Too fast? Should anything else be gated, or less?

## 2. One scenario to a medal

1. Main menu > **Scenarios** (or New game > Scenarios tab) > **First Tracks** > Play. 64 map, 1 year (180 days = 56 min at 8x), required: 500 guests and 3 stars; bonus: ski school, a $20k-profit month, 3,000 guests, a $30k month.
2. Check the **scenario card** (deadline in the game calendar, objective bars, **Finish now** once the mandatory part is met).
3. Finish (or let the deadline pass): result dialog with medal, score, breakdown, *Continue playing (sandbox mode)* / Retry / Back to menu. The bot gets **bronze** on all six, never silver / gold: silver needs more than the bot's play.
4. Is a medal attainable in a reasonable time? Is the deadline too long / short at 3x and 8x? (Summer Escape is 90 days = 28 min at 8x; Alpine Giant 540 days = 2 h 49 min at 8x.)

## 3. Year report

1. Let the first year end (day 180: ~19 min at 8x from a fresh game) or run `__slope.stats.demoYear()` then `__slope.yearReport.show()`.
2. Check: it opens once, pauses the game, **Continue** restores your speed; **Remind me later** / Esc keep it in Finance > Reports (dot on the tab); **Save image** downloads a PNG (nothing else: no share). Settings > Gameplay > **Year-end report** off = no dialog.
3. Cover photo shows the resort (a gradient is drawn when WebGL capture is skipped).

## 4. Trophies, cosmetics

1. Main menu / pause menu > **Trophies**: shelf, filters, progress bars, `???` hidden ones. Unlock toasts are small and rate-limited.
2. Settings > Cosmetics: apply a building palette, bunting, a lift chair colour (live), a premium photo frame (Photo mode panel). Locked ones say which achievement unlocks them. Settings > Cosmetics > **Reset profile** (confirms; never touches saves).

## 5. Mode toggle and old saves

* New game: Career vs Sandbox radio. Sandbox = everything unlocked, no level. HUD tooltip shows "Career · Level N · name".
* Load an **old save** (pre-M5.3): loads as Sandbox (no level chip: "Sandbox").
* Title demo, "Populate demo resort" (debug) and the tutorial still work in Career (they bypass the gate).

## 6. Time model feel

* Speeds 1x / 3x / 10x (Space pauses, `+` / `-`). Does 1x feel calm, 10x fast but readable (guests are points at 10x)? Do seasons pass in reasonable time (docs/time-flow.md 9.1)? Does a winter at 10x (about 11 min with fast nights) feel right?
* The year report arrives every ~33 min at 10x (7.5 h at 1x): still too rare? Is a half-year check wanted (not built)?
* **Skip to...** (button next to the speed buttons, key K): does Next month / Next season feel fast enough (target ~10 s per season on 128)? Does it stop at the right moments (level-up, chapter, critical incident, stranded guests, bankruptcy / debt, year report)? Is Esc / Space / click to cancel obvious? Does the view look acceptable while skipping (10 fps, point guests, no sound)? Is the pill readable and not in the way (bottom centre)? Does the tab-hidden pause behave?
* **Level pacing**: L2 first week, L3 ~30 days in, L4 end of year 1: too fast / about right?
* Scenario cards: do the real-time deadline tooltips (hover the deadline chip) match your experience?

## Known gaps and concerns

* Never played by a human; the Career pacing numbers come from a bot that never builds past the starter chain, so a human is likely faster at L2-L4 and the bot never reaches L5 / L6 (not calibrated).
* Year 1 is only 60 days (the game starts on day 120): its report is partial.
* First-winter 256 runs are in the red (-73k..-86k with the starter loan) before recovering in year 2; year 3 on 256 / seed 7 is thin (+7k).
* Scenario deadlines are in game days (First Tracks 180 days = 2.5 h at 3x, about 33 min at 10x with fast nights, or a few minutes of Skip to...): long at the slow speeds; "Finish now" ends early once the mandatory goals are met.
* Scenarios + `?tutorial=1` together: the tutorial wins and the scenario is ignored (the picker never combines them).
* Lifts drawer: the bike badge overlaps the price line of some cards (pre-existing). The Buildings drawer tab strip scrolls sideways at 1280 and below (now with a fade at the edge; use the wheel / drag).
* The cover capture and PNG compositor are verified in SwiftShader only; the cover cost on a real GPU is expected to be small.
* Achievement counters are profile-wide: a headless browser profile used for screenshots shows unlocked trophies; on your machine start from 0 (or Reset profile).
