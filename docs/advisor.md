# Advisor: Ranger Rudi's "What should I do next?" (M5.1)

`src/sim/advisor/{Advisor,rules,strings}.ts`, UI in `src/ui/components/StAssistant.ts` (Advice mode), save module `advisor`.

* **Voice (D4)**: plain, factual warnings. Rudi only adds a short friendly line on positive notes (nothing-to-do state, "close to a goal"). All strings live in `strings.ts`.
* **Evaluation**: EVERY rule runs every in-game hour (`time:hour`) and at `day:changed`. Pure reads of `Sim`; nothing is ever built or spent. A rule that stops firing is dropped at once (rules are state-based and carry their own keep thresholds); only a rule created with `instant = false` keeps the 2-evaluation hold, and an hourly evaluation after any building/path/piste/lift/loan/campaign/weather change never holds.
* **Hysteresis**: a firing rule is live at once; while live it uses its looser *keep* threshold (e.g. queue: enter > 20 ticks, keep > 12). The shown set is sticky (x1.15).
* **Ranking**: severity (info 1 / warn 2 / urgent 3) x rule impact (1..3) x recency (up to x1.5 for 3 days), ties by id. Top 3 shown, the badge counts all live advice.
* **Show me**: camera focus + the ping marker ring (`goTo` in main.ts). **Dismiss**: snoozes that advice for 30 in-game days (`advisor` save module: `{ snooze: [[id, absoluteDay]], dismissed }`; old saves load with nothing snoozed).
* **State, not tile**: advice is satisfied by the STATE of the resort, never by the suggested site (`action.site`/`target` are only a hint). A building of the right type that works (active) anywhere clears the rule; one that was placed but is inactive turns the advice into a specific one about the real building (`TEXT.notWorking`: names it, its coordinates, the sim's reason and, for road access, the nearest road end), with 'Show me' focusing that building. Rules about a missing building (`grooming.none`, `patrol.none`, `school.none`, `arrival.parking`, `storm.signs`) are `instant`: no 2-evaluation hold. Any building/road/lift change marks the advisor dirty and the next hourly evaluation runs every rule.
* **Placement honesty**: a rule that suggests a building asks `RuleCtx.site`, which uses `tutorial/suggest.findSite/findAlongPiste` (real `validatePlacement`, docs/placement-rules.md) and re-validates the cached site on every evaluation; with no valid site only the building type is named.
* **UI**: an SVG-icon `Advice (n)` badge beside the avatar (Ranger Rudi: flat-vector park ranger bust, `src/ui/components/rudiAvatar.ts`, expressions idle/point/cheer/worried/think/wave, ~2.7 kB inline SVG, blink + bob unless reduced motion; sheet at `/?uikit=rudi`; bottom-left, zone `left-assist`) opens a 340 px wide card showing the full advice text (max-height, the list scrolls). Hidden and paused while the tutorial runs.

| Rule | Cadence | Notes |
|---|---|---|
| `queue.long` | hourly | worst open lift, target = its bottom station |
| `lift.idle` | daily | open lift with almost no riders while others are used |
| `grooming.none` / `grooming.gap` / `piste.icy` | daily | groomer garage, snowcat outpost near the uncovered piste, icy share |
| `patrol.none` / `aid.gap` | daily | no patrol hub; piste share outside patrol and first-aid cover |
| `bear.threat` | daily | awake bear, no ranger station |
| `storm.signs` | hourly | storm, no warning sign |
| `school.none` | daily | many families, no ski school |
| `rental.boards` | hourly | 3+ guests turned away today for lack of rental skis / boards (1 keeps it up); Show me opens the Rental, Build suggests another (`docs/rental.md`) |
| `arrival.parking` | daily | lodge but no parking / rail / shuttle / altiport |
| `cash.debt` / `cash.runway` | hourly | in debt (lists loan / price / rest-lifts options); cash under ~5 days of upkeep |
| `cash.tips` | hourly | first two years, cash between $0 and ~$6k: build order, Starter loan, price check (docs/money-tips.md) |
| `price.fair` | daily | day pass far from fair value |
| `marketing.ready` | daily | a campaign meets its prerequisites, none run yet |
| `cash.summerBuffer` | hourly | last 20 days of spring and cash < 30 days of upkeep: amount to save, summer attractions, rest lifts; `cash.debt` also mentions the open support loan |
| `snow.gaps` | hourly | winter, reservoir present, >= 24 piste tiles in pipe range but out of every cannon's reach: place a cannon (valid site) |
| `season.winter` / `season.summer` | daily | 30 days ahead: reservoir / cannons; bike or hike trails |
| `piste.disconnected` / `building.inactive` | daily | structure problems |
| `lift.service` | hourly | last weeks of autumn with a lift overdue for its yearly service (state overdue / critical); names the lift, closure days and total cost |
| `lift.worn` | daily | condition under 45 %; suggests a workshop when missing |
| `rating.lowest` | daily | weakest rating component (reuses the Rating hint) |
| `goal.next` | daily | the current goal's next step (does not duplicate the Goals card) |

## Audit rules (tests/sim/advisorScenarios.test.ts)

Every rule has a scenario: it fires, and 2-3 different valid fixes each clear it at the next hourly tick; incomplete fixes give specific advice; every proposed `action.site` passes `validatePlacement` and, for road/path types, has a routable link (20 seeds x 3 sizes).
* One root cause, one advice: `piste.icy` is silent without any grooming (`grooming.none` says it); `building.inactive` skips buildings another live rule already names (or whose prerequisite does); `rating.lowest` skips good-news hints (`POSITIVE_HINTS`) and the safety/value areas while patrol/bear/price advice is live; `goal.next` skips a goal whose building advice is live.
* Remote types (access `none`: first aid, snowcat outpost, cannon, sign, helipad, reservoir) never get road/footpath advice; a connection problem names the type's own requirement (`Needs a road next to it` / `Needs a footpath or road next to it`).
* Grooming coverage comes from outposts only (a garage alone covers nothing): `grooming.none` says to build the garage AND an outpost.
* `queue.long` ignores closed lifts; `lift.idle` needs other lifts to be busy (nothing is "barely used" at night); `cash.*` follow the cash, not the midnight finance flag.

## 0.2.2 additions
| Rule | Cadence | Fires when |
|---|---|---|
| `piste.icy` | daily | now names the worst **run** ("Black Run 2 is icy") with a map target (docs/runs.md) |
| `crossing.waits` | daily | guests spent a lot of time waiting at a footpath level crossing yesterday: suggest the footbridge over rail (docs/crossings.md); Show me = that crossing |
| `hikers.hungry` | daily | decaying share of hiker / biker departures that ended hungry is high: add a hut / cafe near the trails (docs/hiking.md) |
| `farm.almabtrieb` | daily | no Alpine Farm in autumn (suggest one) or 3 days before the Almabtrieb ("Show me" = base station) |
| `snow.mode` | hourly | cannons burn while the snowline is above the pistes (suggest Auto / Off) or Auto is waiting for cold |
| `lift.service` | hourly | a lift is overdue for its annual service (Operations > Maintenance) |
| `energy.green` | daily | energy is the weakest sustainability part: suggests a Solar Array (docs/energy.md) |
