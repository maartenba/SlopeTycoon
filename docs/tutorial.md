# Interactive tutorial & assistant (Task 34a)

A completion-driven guided tour with an on-screen ranger ("Ranger Robin") that teaches a new player to build a minimal resort, plus contextual one-shot hints that work for everybody (also players who skip the tutorial).

Start it with **`?tutorial=1`** (boots the fixed 64×64 *gentle valley* scenario, winter, $400,000) or **Settings ⚙ → Replay tutorial** / **Help (?) → Replay tutorial** (both navigate to `?tutorial=1`). The main-menu entry arrives with Task 35.

## Architecture

| File | Role |
|---|---|
| `src/tutorial/strings.ts` | **All** user-facing text (flat i18n-ready key → text, `{name}` placeholders, mini markup `**bold**`, `` `key` ``, `*em*`). Step keys derive from the id: `step.<id>.title/text/show`; hints `hint.<id>.text`. |
| `src/tutorial/queries.ts` | Read-only world-state queries for predicates (building counts/active, path/road/piste tiles, lifts, piste↔lift service, money, speed, season, guests, rating, loans, price changed, campaigns, goals…). Built on public sim APIs only. |
| `src/tutorial/suggest.ts` | Valid-location suggestions **and** the performers behind *Do it for me*: `findSite` (spiral search with the real placement rules + optional road/footpath routability), `planLift` (lift line via LiftAssist `snapLift`, bottom near the village / top uphill, room for a clean piste), `planPiste`, `planTrail`, road/footpath planners, `placeSite`/`buildNetwork`/`buildLift`/`paintPiste` (real `placeBuilding`/`Networks`/`placeLift`, emitting the normal events). |
| `src/tutorial/steps.ts` | The lessons (data). |
| `src/tutorial/TutorialEngine.ts` | State machine, event subscriptions, poll, persistence (`TutorialStore`, key `slope.tutorial.v1`), Show me / Do it for me / skip / back / exit / replay, view model for the UI. |
| `src/tutorial/hints.ts` | One-shot contextual hints (`HintEngine`). |
| `src/tutorial/scenario.ts` | Tutorial map options, seed scoring, `?tutorial=1`. |
| `src/tutorial/ui-targets.ts` | Logical UI target ids → selectors, shadow-DOM-walking resolver. |
| `src/ui/components/StAssistant.ts` (`st-assistant`), `StSpotlight.ts` (`st-spotlight`) | Avatar (Ranger Rudi, `rudiAvatar.ts`) + bubble + goals panel; pulsing highlight ring. |
| `src/render/TutorialMarker.ts` | Ring/route/arrow draped on the terrain, one mesh = one draw call. |
| `src/tutorial/index.ts` | `createTutorial()` wiring (engine + hints) used by `main.ts`. |

## How progress works

* `Step.isComplete(q)` is evaluated from **world state** on typed events (`building:placed|removed`, `path:drawn`, `piste:painted`, `lift:built|opened`, `speed:changed`, `loan:taken`, `season:changed`, `rating:changed`, `day:changed`, `marketing:started`, `finance:monthClosed`; `guest:arrived`, `money:changed`, `time:hour` only mark the engine dirty) and on a 500 ms real-time poll (camera facts + dirty re-evaluation). No timers gate progress.
* The current step is the first applicable, un-skipped step whose predicate is false. Satisfied steps are completed automatically (**auto-advance**). A step marked `structural` is re-checked after completion: delete the parking lot, the road, the lift… and the tutorial **steps back** to that lesson with a gentle message. Non-structural facts (speed set, price changed, loan taken, season visited) stay done once achieved.
* UI-only facts are latched flags: `camera:rotate|pan|zoom` (host camera poll), `select:building`, `overlay:cycled`, `game:saved`, `speed:N`, `season:X`, `guests:arrived`, `ack:<id>`.
* The player is never locked: every lesson can be done by hand, skipped, or ignored. *Got it* only exists on information steps (`ack`). Skipping a lesson makes lessons that depend on it (e.g. Magic Carpet without a Ski School) not applicable.
* After the last lesson the tutorial is `finished` (no more stepping back); the **goals panel** (200 guests, 4★, a profitable month) stays on screen until all three are reached.
* State: `{enabled, finished, current, completed, skipped, flags, hints, hintsEnabled, assisted, minimised}` in LocalStorage `slope.tutorial.v1`. It is **not** part of the save file (adding a save module would change the determinism hash and every save; kept out on purpose).

## Never a softlock

Every lesson has **Show me** (UI chain highlight + a validated map spot with the explanation) and, where something can be done, **Do it for me** (first use free, later ones add a $150 fee; the real construction cost is charged through the economy). If no valid site exists the assistant says so; **Skip** is always available, loans stay reachable, and the fuzz test (`tests/tutorial/fuzz.test.ts`) proves that after random player chaos (place/bulldoze incl. the Base Lodge, draw/erase, paint, lifts, closing lifts, speed changes, loans, money below zero, time jumps) the engine always has a current step (or *complete*/*blocked*), Show me names a known UI target and a map mark inside the map, and *Do it for me*/skip/next can always finish the tutorial.

* **Tutorial funding** (tutorial mode only): when cash is short, *Do it for me* tops the balance up to the price (+$2,000 buffer) and tells the player (`msg.funding`). Outside the tutorial scenario (engine created with `fundingTopUp:false`) it answers with a hint to take a loan or skip.
* **Base Lodge**: it *can* be demolished (no rule prevents it). The `lodge` lesson is structural: it steps back to "Your Base Lodge" and *Do it for me* rebuilds it near the village anchor.
* Bankruptcy (game over) → engine status `blocked`; it still answers without throwing.
* **Pause**: nothing here changes the game speed unless *Do it for me* is pressed on a time lesson (`speed`, `guests`). Building lessons work at speed 0; the *guests* lesson reminds the player to press Space while paused.

## The lessons (in order)

`camera` (rotate once) → `lodge` (structural) → `select` (click a building) → `parking` → `parkingRoad` → `footpath` (parking↔lodge) → `ticket` → `lift` (auto-flatten, valid kinds) → `piste` (continuity, difficulty colours, disconnected) → `namePiste` → `school` → `carpet` (dependency lock) → `patrol` → `firstAid` → `overlay` (O) → `restaurant` → `rental` → `speed` (3× and pause) → `guests` → `daynight` (info) → `seasons` (info) → `pricing` → `loan` → `groomer` → `snowmaking` (reservoir + cannon) → `marketing` → `summer` (tutorial-only *Jump to summer*) → `trails` (hiking/MTB) → `save` → `goals` (info) → `finish` (info).

## Adding a step

1. Add `step.<id>.title|text|show` to `strings.ts` (the strings test fails when a key is missing or unused).
2. Add an object to `STEPS` in `steps.ts` (position = order): `ui` target chain (see `ui-targets.ts`), `isComplete(q)` (use/extend `Queries`; prefer world state, latch UI facts with `ctx.notify(flag)` + `q.flag()`), optional `isApplicable`, `structural`, `ack`, `showMe(ctx)` (UI chain + map mark from `suggest.ts`), `doItForMe(ctx)` → `{cost, perform}` (use the performers in `suggest.ts`; they emit the normal events). Building lessons are one line with `siteStep({...})`.
3. `tests/tutorial/steps.test.ts` automatically covers the predicate, auto-advance, persisted resume (and step-back if you add a remover to `REMOVERS`); the bot and fuzz tests run the new lesson too.

To expose a new UI element add `data-tutorial-id="x"` (or reuse `data-drawer` / `data-id` / `data-tab`) **inside the rendered shadow DOM** (never on the host in the constructor) and register it in `ui-targets.ts`.

## Hints (`hints.ts`)

First occurrence of: first guest without rental, a lift queue ≥ 25, icy pistes, avalanche, wildlife, injury without a Patrol Hub, debt, bankruptcy warning, lift breakdown, season changes (autumn *“Winter is coming: build snowmaking”*, winter, spring, summer), rating drop to ≤2★, a family arriving without a Ski School, storm. At most one hint per ~2 in-game days (waiting hints queue, *important* first, released on `day:changed`), each only once; the dismissed set persists; **Settings → Toggle hints** turns them off. Delivery: the assistant's small hint bubble.

## Scenario

`TUTORIAL_SCENARIO = {size: 64, seed: 61, winter, $400,000}`. The seed was chosen by scanning seeds 1–120 with `scoreTerrain` (skiable fraction ×2 + vertical drop + lakes) **and** by running the *Do it for me* bot on each (all 120 complete with zero failures; 61 has the best skiable fraction, three lakes and a cheap chain). `tests/tutorial/scenario.test.ts` re-checks both. The engine itself is map-size independent: `tests/tutorial/maps.test.ts` runs the full lesson chain on 64, 128 and 256 maps.

## UI notes

* `st-assistant`: bottom-left (`left:8px; bottom:56px`, width ≤ `50vw − 230px`, min 200 px) to stay clear of the top bar (top-left), HUD/inspectors/news (right column), the dock + drawer (bottom-centre, ≥ 420 px) and the debug/settings stubs (very bottom-left). Avatar badge (click = minimise/restore), speech bubble (bold/keys), progress dots, **Show me / Do it for me (≈ price) / Got it / Skip step / Back / Hide / Exit tutorial** (Exit asks for confirmation). Typewriter text is not implemented (off); animations respect `prefers-reduced-motion`; everything is a native `<button>` (keyboard accessible).
* **Click-through is a hard rule** (an earlier full-screen help overlay swallowed every click): `st-spotlight` and `st-assistant` hosts are `pointer-events:none` (inline style + `#ui > st-spotlight, #ui > st-assistant` rule, because the outer `#ui > *{pointer-events:auto}` would otherwise win); the spotlight host is zero-sized and its ring is a bordered box with a glow; optional dimming (`dim`) is only a huge `box-shadow` on the ring. Only the bubble, the avatar badge and the hint bubble accept clicks. Tests: `tests/ui-dom/assistant.test.ts`.
* Spotlight target ids (`ui-targets.ts`): `dock:<drawer>`, `drawer:tab:<tab>`, `drawer:item:<id>`, `topbar:rotate|save`, `hud:speed|season|guests|rating`, `panel:pricing|loans|marketing`, `tool:status`. A chain such as `dock:buildings → drawer:tab:transport → drawer:item:parking` highlights the deepest visible element, walking the player through the menus.
* `TutorialMarker` (render): outline ring + route ribbon + downward arrow draped on the terrain heights, pulsing opacity, depth-test off, 1 draw call.

## Verified / not verified

Verified headlessly: predicates, auto-advance, step-back, persistence, engine events, funding, pause behaviour, both bots (Do it for me; Show me suggestions placed by hand), fuzz, 64/128/256 maps, hints (rate limit, one-shot, persistence), strings, UI-target registry against the real `st-dock`, assistant/spotlight DOM + pointer-events contracts, marker geometry.
**Not verified (no browser/WebGL here):** assistant placement and look, SVG avatar appearance, spotlight alignment on real layouts, marker appearance/z-order on the terrain, camera-change detection with the real `CameraController`, and the `main.ts` wiring (assisted changes are mirrored via `buildingsView.sync`, `refreshProps(chunks)`, `liftToolsRef.view.add`).


## Suggestions are hints (Ranger Rudi fix)

* Step predicates are state-based (`count('parking') >= 1`, ...): a parking / ticket office / ... placed anywhere satisfies the step; the 'Show me' marker is re-validated whenever a building, road, lift or piste changes.
* Lift line (`suggest.planLift`): validated by `validateLift` (auto-flatten on) and `stationSiteFree` (2x2 station + 1 tile margin free of buildings, lifts, roads, paths; outside the lodge's village zone: 4 tiles, 6 east for the decor parking). No valid line -> the step shows 'No valid lift line found near the base: try terraforming or a different map area.' (`msg.noLift`).
