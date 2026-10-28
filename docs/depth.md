# M5.4 depth: staff, upgrades, festivals, story guests, rivals, sustainability, build depth

Summary for the milestone playtest. Details live in the per-feature docs; this page says what the systems are, how they fit together, which switches turn them on, and what to check by hand.

## What is in

| System | What it does | Default | Doc |
|---|---|---|---|
| **Staff** (4 pools: instructors, patrol, groomers, lift operators) | A compact Staff tab; fill ratio slows services when you under-staff; wage level + morale | **Auto** = bit-identical to the pre-staff game (no extra wages, no slowdown) | `docs/staff.md` |
| **Six staff upgrades** | One-off courses (instructors, patrol, snowcat, lift mechanics, rangers, hospitality); cost + days + daily upkeep; one at a time; Career level gates 1 / 2 / 3 | nothing trained | `docs/staff.md` |
| **Events and festivals** | Booked: Christmas Market, Winter Carnival, Summer Music Festival, World Cup. Automatic: Almabtrieb, New Year, critic visit (announced 3 days ahead), powder day. Visible **set dressing** (bunting, banners, stalls, procession, World Cup grandstand), restrained fireworks | automatic events only in the real game (`autoEvents`), booked ones everywhere | `docs/festivals.md` |
| **Story guests** | ~1.5 % of arrivals are named guests with one wish ("Marta from Graz wants a black run"); outcomes feed news / the year report; observer only, never steers a guest | real game only (`stories`) | `docs/stories.md` |
| **Rivals** | 2-3 seeded neighbour resorts; multinomial-logit market share -> arrival multiplier 0.9-1.12 (1.0 in the 30-day grace, scenarios, tutorial); rival comparisons + the **Green Resort** award in the year report | on in Career / Sandbox, off in scenarios and the tutorial | `docs/rivals.md` |
| **Sustainability** | A rating facet (8 % of the stars): energy per guest, trees felled vs planted, habitat overlap (rangers halve it) | always part of the rating | `docs/rating.md`, `docs/rivals.md` |
| **Build depth** | One undo / redo stack for every build action (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y), slope profile chart for piste and lift ghosts, snowline-aware run suggestion. No blueprints (D8) | always on | `docs/build-depth.md` |

How they connect: festivals and rivals both multiply arrivals (events x1.1-1.35 during the event; rivals 0.9-1.12), the rating (incl. sustainability) drives the rival share and the critic's score, the staff upgrades feed hospitality revenue, wildlife protection (rangers) and lift breakdowns, story wishes only resolve if the resort is actually good at the thing, and the year report collects all of it (rival comparisons, Green Resort, event highlights).

Switches: staff Auto, events (`autoEvents`), stories (`stories`) and rivals (`rivalMarket`) are `createSim` options that default ON (= the real game); only the title demo (events / stories) and the guided tutorial (rivals) opt out. Goldens and balance tests run with them on (docs/balance.md).

## Balance (closing sweep with everything on)

`npm run test:balance`: **33 / 33 pass** (27 older cases + 6 new `[balance] everything on` cases). The new cases run the bot with `autoEvents`, `stories`, rivals, **all six staff upgrades** and the green rules for 3 years (annual net in $; y2 stars; rival share at the end):

| map / seed | y1 | y2 | y3 | y2 stars | share |
|---|---|---|---|---|---|
| 64 / 61 | -13.3 k | +89.3 k | +106.1 k | 4.25 | 42 % |
| 64 / 7 | -27.7 k | +136.8 k | +132.5 k | 4.25 | 36 % |
| 128 / 61 | -0.4 k | +139.6 k | +168.9 k | 4.17 | 54 % |
| 128 / 7 | -15.6 k | +150.9 k | +148.3 k | 4.33 | 36 % |
| 256 / 61 (loan) | -81.6 k | +181.2 k | +127.1 k | 4.17 | 42 % |
| 256 / 7 (loan) | -103.4 k | +97.1 k | +57.8 k | 3.42 | 18 % |

Compared with the same bot without the depth systems (`docs/balance.md`, Task 23 table): year-2 profit is 0-23 % lower with all six upgrades (their upkeep + training: 64/61 -23 %, 64/7 -7 %, 128/61 -14 %, 128/7 -21 %, 256/61 -6 %, 256/7 0 %), still clearly positive everywhere, never bankrupt, stars 3.4-4.3. Nothing was retuned in Task 26.

`npm run test:perf` (run alone): 19 files / 35 tests pass; guests at the cap 0.48 / 0.90 / 1.67 ms per tick (64 / 128 / 256, budgets 6 / 6 / 8 ms), navigation tick at the 256 cap avg 2.9 ms (budget 8), ops 0.12 ms, wildlife 0.05 ms, snow / weather 0.03 ms. No budget moved. Draw calls / frame rate of the festival dressing are **not** measured headless (`docs/perf.md`).

## Human playtest checklist (STOP: the user approves M5.4)

1. **Staff**: leave all four pools on Auto and check nothing changed (no new wages); then untick Auto on ONE pool, drop the headcount and watch the effect (lessons / sleds / night grooming / lift loading) and the wage line.
2. **Upgrades**: buy three (e.g. Lift mechanics, Hospitality, Snowcat); the course takes days, costs show in the wages; check the Career level gate hint on a locked one.
3. **Festivals**: book **Almabtrieb** (needs an Alpine Farm in autumn) and a **Christmas market**; check the **dressing is visible** (banner with the name, bunting along the road, stalls, procession), the News items, fireworks only at the finale.
4. **Story guest**: pin / follow a story guest and see if the wish gets granted and the outcome reads well in the news / year report.
5. **Rivals**: read the rival news and the year-report comparison; check the **Green Resort** award appears after a green year.
6. **Sustainability**: fell a lot of forest, then plant; watch the rating facet and the star change (Rating panel).
7. **Build depth**: undo / redo a lift, a stroke of piste, a terraform drag and a tree-planting drag (Ctrl+Z, Ctrl+Shift+Z); wait a day and check the refusal message; open the profile chart on a piste drag and a lift ghost; press **Suggest a run** in winter and in summer.
8. Ask the user: **are touch basics (Task 31) wanted?**

## Observations: "make it auto by default"

Recorded during Task 24 / 26 work; none were requested by the user yet (the plan asks us to log such requests at the playtest):

* **Staff** is already Auto by default; the playtest should say whether overriding a pool is worth the friction (the lift operators pool is the one a player is most likely to forget).
* **Staff upgrades** are manual. A hands-off option ("let the ranger advise: train the next useful upgrade when cash > 1.5 x cost + reserve") is what the bot does (`BOT_UPGRADE_ORDER`); it could become an Advisor suggestion rather than an auto-spend.
* **Festivals** booking is manual by design; candidate for an "Auto-book the seasonal festival" toggle if the playtest finds the calendar chore-like.
* **Suggest a run** only highlights; "auto-paint the suggestion" was deliberately not built (it charges money).
* **Undo window** is the same in-game day (150 s real at 1x): if a playtester loses something to a day change we might widen it to the last N minutes of game time; today it is refused with a clear message.

## Since this milestone

Trees (plant / clear, species, density) moved to **Landscape > Nature** and the Terrain drawer is terraforming only (`docs/landscaping.md`); the Terrain and View drawers use the shared card grid, icons and hover cards (`docs/ui-kit.md`); undo / redo, Statistics (`docs/stats.md`) and touch (`docs/touch.md`) build on the same stack. Placement works in every season (no season locks).

## Not verified by agents

Real GPU frame rate / draw calls of the festival dressing and the new profile card, audio by ear (festival ambience / fireworks), pointer-driven drags (terraform / planting / piste strokes were verified through the same recorder in unit tests and the Suggest button in a shot, not by mouse), and how the day-boundary refusal feels at 10x speed.
