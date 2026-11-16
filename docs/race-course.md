# Race course and Racers (0.8.0)

A **race course** is a property of a run (`docs/runs.md`): the player marks a red or black run, puts a **Start Hut** beside its top and a **Timing Hut** beside its foot, and **Racers** come to train on it in winter. Ships ON with no flag; the plain `Bot` builds no hut, so no racer ever spawns in a balance run. Owner decisions (2026-11-16): the huts unlock at **level 3** (the World Cup stays at level 4), gates are placed **automatically only** (no drag tool), a course run **stays open to other skiers** on training days.

Source: `src/config/race.ts` (every number), `src/sim/race/RaceCourse.ts` (system), `src/render/race/RaceCourseView.ts`, `src/render/meshes/buildings/raceHuts.ts`, the Racer row in `src/config/guestTypes.ts`.

## Buildings
| Building | Size | Cost / upkeep | Unlock | Notes |
|---|---|---|---|---|
| Start Hut (`startHut`) | 1 x 1 | $6,000 / $12 a day | level 3 | beside a piste, footpath or trail (`access: pisteEdge`, never ON a piste tile); no smoke, no power |
| Timing Hut (`timingHut`) | 2 x 1 | $14,000 / $30 a day | level 3 | same rules; carries the live board (two posts above the roof) |

Upkeep is lower than the plan's first guess ($40 / $90): the first year of `npm run analysis:race` put the course $20k a year in the red; see "Economy" below.

## Course validity (`RaceCourse.reasonFor`)
A run can be a course when it is a single clear run (not a loop, not a blob), **red or black** (`difficulty >= 3`), has a drop of at least **60 m**, has a Start Hut within **2 tiles** (footprint gap) of one of the first 3 centre-line tiles and a Timing Hut within 2 tiles of one of the last 3. At most **3** courses. The reasons are plain text (`RACE.reasons`): *Needs a red or black run*, *Needs a drop of at least 60 m*, *Needs a single clear run, not a loop*, *Needs a Start Hut at the top*, *Needs a Timing Hut at the foot*, *Three courses is the limit*.

A marked course whose hut is bulldozed (or whose run is edited below the rules) goes **inactive** and says why; it is never dropped silently. Run ids persist (`Names.pisteId`), so the flag survives growing / splitting / merging a run (settings of vanished runs are pruned).

## Gates (auto)
`courseGates(run, size)` is a pure function of the run: every N centre-line tiles (**red 2, black 1**: the plan said 3 / 2, but a run on a 64-tile map is only ~10-20 tiles long), alternating sides (+-0.6 tile from the line) and alternating red / blue flags. Not saved, not obstacles for skiers. Rendered by `RaceCourseView`: ONE `InstancedMesh` of poles and ONE of flags for all courses (14 triangles a gate), plus ONE board mesh (an atlas of 3 slots, two back-to-back quads each): **3 draw calls** in total, about 4,000 triangles with three black courses. The board ("BLACK RUN 2 / BEST 1:12.4 / RACERS 7") redraws at most once per sim hour or when a lap lands; the best time is cosmetic (`RACE.boardBaseS` + length / `boardMps` with a seeded jitter), the sim never reads it.

## Racers (guest type index 14)
- Winter only (`winter: 0.06`), level 3, `requires ['@raceCourse']` (pseudo id from `Spawner.flagsFn`: at least one open, valid course), segment `adventure`, fallback `adventure`, group 1-3, budget $180-360, expert skills, yellow bibs and helmets.
- **Demand** = the arrival weight times `RaceCourse.demand(racersAlive)`: the summed **quality** of up to 3 open courses (groomed within a day 1.0, two days 0.7, otherwise 0.4; times 0.8 for red, 1.0 for black); **0** without an open course or once `maxRacersPerCourse` (12) racers per course are alive. A closed course (by you, the weather or no snow) gives quality 0: racers stop coming and the ones already there ski normally.
- **Behaviour**: at a lift top `Exploration.pickVia` is restricted to the tiles of the open courses (`racerTiles`), the descent is ~1.4 x faster (`NavGraph.speed` `skiMul`), reaching the via tile is a **lap** (`GuestSim.raceLap` -> `RaceCourse.onLap`); the **first lap of a day pays the course fee** ($20, income category `recreation`); after 3-6 laps (stable per guest id: `lapQuota`) the racer leaves when the run ends (`raceDone`, stateless: read from the saved lap record). Racers never stop for a coffee (`coffeeBreak`) or a Schirmbar drink (`slopeStop`), but eat at lodges as every guest does.
- Course on a **black** run is worth more: quality 1.0 against 0.8, so more racers, laps and fees. (The World Cup bonus for black courses lands in 0.8.1, plan Task 14.)

## Saves
The flag lives in the `runs` module (**v2**, optional `course` array of run ids; absent while there is none, so hashes of resorts without a course are unchanged; v1 saves load with no courses). Lap records, the day's racer count and the board times are the `raceCourse` module (v1, `omitWhenNull`, part of `stateHash` because the laps decide when a racer leaves). `tests/persist/raceSave.test.ts` saves in the middle of the training, reloads and runs on for two days identically to the control. `SAVE_FORMAT_VERSION` is unchanged.

## UI
Run inspector: a **Make a race course** / **Not a race course** button (44 px, `data-role="run-course"`) with the one-line status under it (the reason when it cannot be marked, *Race course · 4 racers today · best 1:02.3* when it is). **Operations -> Runs** has a *Course* column (a flag toggle per run, the reason as tooltip). Placing the huts uses the normal building drawer (Recreation). Phones: the toggle lives in the run inspector sheet; no new floating card.

## Advisor, achievement
Rudi: `race.course.available` (Start Hut unlocked, a red / black run with 60 m of drop exists, no course yet, a settled resort with the money for both huts) and `race.course.ungroomed` (an open course with a quality below 0.5). No goal or chapter depends on a course. Achievement **Through the gates** (`through-the-gates`, fact `racerLaps`: 100 laps in one game).

## Economy
`npm run analysis:race` (`scripts/analysis/raceRoi.ts`) runs the starter resort for a 180-day year with and without a course on the main run (same seed). Result of the shipped numbers (64 maps, seeds where the starter run can be a course: 61, 5): a **black** course nets about **+$1,000 a year** (income +$8,200 from fees and the racers' meals, upkeep +$7,300), a **red** one about **-$6,800 a year**: the huts are a cost centre that pays back (slowly) only for a groomed black run. Against the 59-row generic table in `docs/economy-audit.md` that is mid-to-low (ranks 26-35 of 59), well below lifts, lodgings and hotels, never in the top third. The first draft (upkeep $40 + $90, share 0.03, fee $14) was -$19k to -$23k a year.

## Tests
`tests/sim/race/*` (validity, gates, racers, determinism), `tests/persist/raceSave.test.ts`, `tests/render/raceCourseView.test.ts`, `tests/ui-dom/raceCourse.test.ts`, advisor rows in `tests/sim/advisor*.test.ts`, the building contract. `npm run race:sanity [-- --shots 1 --out NAME]` is the real-page story (64 / seed 61: locked at level 1, refusals, huts, gates, racers lap for two days and pay, save + reload identical).

## Out of scope (0.8.0)
Race days with spectators and sponsors (0.8.1), the World Cup on the course (0.8.1), a mountain-bike downhill race on the same huts (0.8.2), player-controlled racing, leaderboards (never: no sharing features).
