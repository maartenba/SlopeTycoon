# Resort goals (M5.1, Task 3)

A short career of a resort director: **4 chapters, 19 goals** (plus optional bonus goals) (`src/config/goals.ts`), engine in `src/sim/goals/Goals.ts`, card in `src/ui/components/StGoals.ts`.

| Chapter | Goals |
|---|---|
| Season 1: Open for business | first lift open · green run · Ski Patrol Hub · 30 guests in a day |
| Local favourite | 3★ · green+blue+red runs · 80 guests in a day · a profitable month · ski school |
| Regional name | groom a night · 4★ · complete a rescue · debt-free with $50k |
| Alpine destination | 200 guests in a day · 4.5★ · summer attraction · three lift kinds · Ranger Station · 5,000 guests in total |

* Three goals are active at a time: the first three unfinished goals **of the current chapter** (the last goals of a chapter may be fewer). A later chapter unlocks when the earlier one is complete.
* Evaluated once per in-game hour (`time:hour`). Checks read a small `GoalWorld` view (built in `createSim`) plus latched event facts (`arrivalsToday`, `bestDay`, `lifetime`, `groomedNights`, `rescues`, `profitMonths`). No RNG, no per-tick work.
* Only goals reachable by normal play: no luck goals (avalanche / bear) because a chapter ends only when all its goals are done.
* Reward = small grant booked as income `grant` (new ledger category; old saves get the missing bucket filled with 0 on load). Whole chain ≈ $67.5k over several years; the balance bot gets ≈ 4.5 % of its year-1 revenue from grants (test limit 10 %).
* Events: goal done → `milestone{id:'goal:<id>', title, major:false}` (quiet news row); chapter done → `milestone{id:'chapter:<id>', title:'<Chapter> complete. <career line>', major:true}` (confetti + important news row, see Task 1).
* Save: module `goals` v1 (`done`, `chapters`, `facts`, `granted`), registered LAST. An old save without it starts a fresh chain and **silently** completes what the loaded resort already satisfies (no grants, no events). A pre-built sandbox starter resort does the same at game start.
* UI: `st-goals` is a child of `#right-col` (order 1, under the HUD block); anchor zone `right-goals` (260×140). Collapsible (remembered in localStorage), progress bars, reward, **Show me** (camera focus on the relevant building / lift / piste; a toast when nothing exists yet). Hidden and paused while the tutorial runs.
* Tone (D4): career voice, a light line now and then; flavour ≤ 90 characters (test).

## Optional bonus goals (Phase 6)

`BONUS_GOALS` (`config/goals.ts`) are side goals outside the chain: never in a chapter, never in the three active slots, so `GOALS` (19), `TOTAL_REWARDS` and the bot's grant share are untouched. The engine checks them each hour and, the first time one is met, pays its grant and shows one quiet milestone (`goal:<id>`, `major: false`); `bonus` is saved only once one is done. They read only what the player builds (`GoalWorld.buildings()`, `lifts()` with the optional `stations` count, `altFrac`), so the plain bot never earns them and nothing gates a chapter. Goals never name a **gated** item (the progression test greps `goals.ts`; hotels and the treehouse are gated, so no goal asks for them).

| Id | Title | What | Grant |
|---|---|---|---|
| `blackRun` | Open a black run | a connected black piste (8 tiles). **Moved out of the chain in 0.3.2** (it was the 3rd Regional name goal; it worked against early progress) | $3,000 |
| `viewpointHigh` | A viewpoint on the heights | Viewpoint on the upper 40 % of the relief (`docs/viewpoints.md`) | $2,500 |
| `littleFarmers` | Open a petting zoo | a Petting Zoo (kids buy feed there) | $1,500 |
| `summerFamilies` | A summer for families | Campground + Petting Zoo + Playground | $2,500 |
| `threeViews` | Three viewpoints | three Viewpoints | $2,000 |
| `midStop` | A stop on the way up | a lift with a mid-station (3+ stations) | $3,000 |
| `boardCrowd` | Boards for the park crowd | Stunt Park + Rental | $1,500 |

Tests: `tests/sim/phase6Polish.test.ts` (fixture world, each goal, quiet milestones, paid once, save / load).

**Old saves (0.3.2)**: `Goals.load` keeps a `blackRun` found in `done` as a bonus goal (stays done, no second grant) and marks every chapter whose goals are all done as complete, so a save that was only missing the black run no longer gets stuck. Chain grants fell by $3,000 (`TOTAL_REWARDS` 69.5k -> 66.5k).
