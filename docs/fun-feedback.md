# Fun and feedback layer (M5.1)

Design goal: the resort should feel alive and rewarding **without noise**. Everything here is read-only with respect to the simulation (no sim RNG, `stateHash` unchanged with the layer on or off). Subtle is the default.

## Feedback intensity (`src/render/fx/feedbackPolicy.ts`)
Setting: Settings > Gameplay > *Feedback intensity* (Off / Subtle / Lively), persisted in localStorage `slope.fx.v1`.

| Field | Off | Subtle (default) | Lively |
|---|---|---|---|
| `$` popup minimum | none | $500 or 5 % of the rolling daily revenue average (larger wins) | $250 or 2.5 % |
| Max popups at once | 0 | 6 | 12 |
| Aggregation window / life | - | 2 s / 1 s | 2 s / 1 s |
| Build puff scale / thunk gain | 0 / 0 | .6 / .25 | 1 / .4 |
| Emotes per guest per day / max alive | 0 / 0 | 1 / 12 | 2 / 24 |
| Confetti | never | major milestones only | major milestones only |
| Camera kick | no | no | yes (small) |
| Min gap between popup ka-chings | - | 3 s | 3 s |

*Reduced motion* (Settings > Accessibility, or the OS preference) clamps Lively to Subtle and disables confetti, camera kick and emote rise. Tune: edit the `SUBTLE` / `LIVELY` objects; `tests/render/feedbackPolicy*.test.ts` document the relations (Lively is never more than 2x Subtle).

## Seasonal closure toasts (`src/ui/closureGrouper.ts`)
Attraction closures whose reason is seasonal (`seasonalKind`: *no snow*, *too warm*, *closed for the season*, frozen lake) are expected, not news. `NEWS_FORMATTERS['attraction:closed']` tags them (`NewsItem.seasonal`) and gives them one shared news key per kind and day (the row reads *3 attractions closed: too warm*). `StNews` hands every one of them to `SeasonalClosureGrouper`, which collects closures for 4 s and then emits ONE toast (*3 winter attractions closed for summer: A, B, C*, more than 4 names: *A, B, C and N more*; *Go to* focuses the first). Each attraction toasts once per season (the set resets when the season changes), so a closure that repeats the next day stays silent. Staff, breakdown, storm, avalanche and other reasons are not seasonal and keep their own toast. Tests: `tests/ui/closureGrouper.test.ts`, `tests/ui-dom/goto.test.ts`.

## Money popups
`MoneyAggregator` sums sales per building for 2 s, then shows one floating `+$` text if the sum clears the threshold above. Pooled DOM elements (`FloatText`), nothing per tick. Small sales never pop; they only count towards the daily average.

## Guest emotes (`emotePick.ts`, `Emotes.ts`)
One instanced mesh, six vector glyphs (hungry, cold, tired, happy, angry, scared). Rules:
* Edge-triggered: an emote fires when a need **crosses** a strong threshold (queue >= 12 min, coldness >= .75 (-4 to -14 C), hunger >= .85, fatigue >= .85, a finished run with happiness >= .85).
* Priority scared > angry > cold > hungry > tired > happy. Per-guest per-day cap from the policy; one representative per ~queue-cluster cell; only on-screen guests; none when guests are drawn as far impostors.
* Scan once per sim tick, per-frame cost is only matrix updates. The HUD rating shows a small star-delta chip (e.g. +0.7★) when the rating moves by at least 0.1★.
* Wildlife: a green paw glyph (cell 7 of the 4x2 atlas) for a bear within 7 tiles / deer within 3.5 tiles (`WildlifeSight`, wired in main.ts); extra gate: 35 % chance + 160-tick global cooldown (`wildlifeAllowed`). The *scared* emote is still not wired to a source (the paw is the calm sighting reaction).
Tune: `EMOTE_T` (thresholds), `EMOTE_LIFE_S`, `EMOTE_CELL`, the policy caps.

## Goals chain and grants (`docs/goals.md`)
20 goals in 4 chapters, 3 active at a time, evaluated hourly. A finished goal pays a small grant (ledger category `grant`); chapters end with a major milestone (confetti allowed, news row). Whole chain is about $67.5k. Balance bot: grants are 3 to 5 % of year-1 revenue (test limit 10 %), 0 in year 2. Tune rewards and targets in `src/config/goals.ts`; day-guest goals are 30 / 80 / 200 because the bot peaks near 40 guests a day on 64.

## Advisor "Ranger Rudi" (`docs/advisor.md`)
Hourly cheap rules, daily full pass, hysteresis, severity x impact x recency ranking, top three shown, dismiss = 30-day snooze. Plain factual voice; friendly lines only on positive notes. Add a rule in `rules.ts` and a string in `strings.ts`.

## Guest reviews (`sim/guests/Reviews.ts`, `config/reviewTemplates.ts`)
* A leaving guest has a 5 % chance (`REVIEW_RATE`) of writing one, max 6 per day (`REVIEWS_PER_DAY`); they appear only in the news panel's **Reviews** tab (unread count on the tab), never as toasts.
* Text = 1 to 2 clauses from the guest's strongest drivers (queue, piste, price, hunger, tired, weather, crowd, injury, general), positive or negative as the guest really felt, so a review is information first.
* Tone mix: plain by default; a light-humour template is picked with weight .15 (`LIGHT_WEIGHT`, hard cap 20 %), never for the second clause, never about the player. No repeat of a template within 12 reviews. Own RNG seeded by guest id and day.
Tune: `REVIEW_RATE`, `REVIEWS_PER_DAY`, `LIGHT_WEIGHT`, add templates (keep sentences short, plain first).

## Recap and month-end summary (`src/ui/recap.ts`)
* **Welcome back** card after Continue / Load (never on a new game, the title demo or in the tutorial): cash, rating trend, since-month-start and last-month net, goals progress, up to a few Rudi lines, open issues.
* **Month card** on `finance:monthClosed`: income, expenses, net, guests, best earner, Details button. Setting: Settings > Gameplay > *Month-end summary* (default on).

## Audio mix (`docs/audio.md`, Mix levels)
Defaults: master .7, music .5, sfx .8, ambience .45. Ambience layers lowered: wind `layerMax` .2 (was .5), snow bed .175, rain .245. Targets are pure and tested (`src/audio/mixLevels.ts`, `tests/audio/mixLevels.test.ts`): wind <= -12 dB vs sfx, ambience-only still >= .15 effective. Tune by editing `AMB.layerMax` and the bus defaults, then run that test. Not verified by ear in automated work: the playtest checks it.

## Cost (headless, 256 map, 3,000 guests; `tests/perf/feedbackLayer.test.ts`)
Goals 0.001 ms per hour; advisor 0.46 ms per day (0.004 ms hourly); review check 1.9 us per leaver; emote scan 0.56 ms per tick; emotes 0.003 ms per frame; particles (40 bursts) 0.016 ms per frame. No allocation in per-frame loops. These are Node numbers on the dev machine; the WebGL draw cost (emotes = 1 draw call, particles = 1) was not measured on a GPU.

## Achievement unlocks (M5.3 Task 16)
One small iconed toast per unlock with the quiet `chimeImportant` (gain .35), at most one per 10 s, held while the tutorial runs. Confetti only for rare (tier 3) unlocks and only through `confettiAllowed` (Off / reduced motion: none). See `docs/achievements.md`.
