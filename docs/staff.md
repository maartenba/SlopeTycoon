# Staff and staff upgrades (M5.4, Tasks 19-20, D6)

Light, mostly automatic. No named staff and no hiring screens. A compact **Staff** tab sits next to **Lifts** in the Operations drawer.

Code: `src/sim/staff/Staff.ts`, `src/sim/staff/Upgrades.ts`; data in `src/config/staff.ts` and `src/config/staffUpgrades.ts`; wiring in `src/game/createSim.ts` (`sim.staff`, `sim.staffUpgrades`); UI in `src/ui/components/StOperations.ts`; tests `tests/sim/staff.test.ts`, `tests/sim/staffUpgrades.test.ts`, `tests/ui-dom/staffTab.test.ts`.

## Four pools

| Pool | Auto headcount (= today's behaviour) | A shortage slows |
|---|---|---|
| Instructors | sum of `instructors` over the active Ski School HQs | ski-school lesson capacity (`SkiSchool.capacity`, via `Families.capacityFactor`) |
| Patrol | sum of sleds over the active Patrol Hubs (`Patrol.staffNeed`) | rescue sled speed (`Patrol.speedFactor`) |
| Groomers | snowcats of every active garage / outpost (`Grooming.fleetNeed`) | the night shift: a crew cap, trimmed from the highest station id (`Grooming.crewLimit`) |
| Lift operators | 1 per T-bar, 2 per chair, 3 per gondola / cable car / funicular (`STAFF.liftCrew`) | loading speed of every lift (`LiftQueues.crewFactor`) |

* **Auto (default)**: fill ratio is exactly 1, no extra wages, no slowdown. The simulation is **bit-identical to the pre-staff game**: `tests/sim/staff.test.ts` pins the `stateHash` parts of a starter run and a 200-day bot run recorded on the tree before Task 19 (only the two new save modules are excluded). Do not "fix" that test by re-recording unless a deliberate balance change is documented here.
* **Override** (untick Auto): the headcount starts at today's need, then the player edits it. `fill = clamp(count / need, 0.3, 1)`. Over-staffing never speeds anything up; each head above / below the need adds / saves `STAFF_WAGE_PER_DAY` per day (times the difficulty wage multiplier).
* **Wage level** low / normal / high: multiplies the staff bill (0.8 / 1 / 1.25) and sets the morale the crew settles at (0.4 / 0.7 / 0.9). `normal` is exactly 1, so Auto stays identical.
* **Morale** (0..1, moves 0.05 a day toward its target; understaffing pulls the target down by `0.3 x (1 - worst fill)`): below 0.5 lift breakdowns rise (`1 + (0.5 - m) x 1.2`), above 0.85 they fall to x0.9, in between exactly x1 (`Staff.breakdownFactor`, read by `LiftOps.breakdownPerHour`).

Save modules (`saveState.ts`): `staff` (pool states, wage, morale) and `staffUpgrades` (trained ids and the running course). Both are additive: old saves reset to Auto / nothing trained.

## Six upgrades

Exactly six (`STAFF_UPGRADES`, asserted by a config test). One-off, no tree, no tiers. Each has a cost, training days, a small upkeep (booked into the daily staff wages once trained) and one theme of effect. **One course trains at a time.** Effects are multipliers read only through `mod(sim, key)` (`src/config/balance.ts`); with nothing trained every key is exactly 1.

| Upgrade | Cost | Days | Upkeep/day | Level | Effect (mod keys) |
|---|---|---|---|---|---|
| Instructor training | $5,000 | 6 | $14 | 1 | ski-school capacity x1.25 (`instructorCapacity`) |
| Patrol training | $6,000 | 6 | $16 | 1 | rescue sleds x1.3 faster (`patrolSpeed`) |
| Snowcat efficiency | $7,000 | 8 | $12 | 2 | tiles per cat x1.3, fuel x0.75 (`groomCapacity`, `groomFuel`) |
| Lift mechanics | $8,000 | 8 | $16 | 2 | breakdowns x0.7, repair time x0.75 (`liftBreakdown`, `liftRepairTime`) |
| Rangers & wildlife | $8,000 | 10 | $18 | 3 | wildlife scare level x0.7 (`wildlifeScare`); sets `wildlifeProtection()` = 1 |
| Hospitality | $9,000 | 10 | $18 | 3 | food / bar / shop earnings x1.12 (`hospitalitySpend`) |

* **Level gates** use `minLevel` in the config and `Progression` (`open` = Sandbox / tutorial / builder bypass lets everything through; Career needs the level). Nothing a goal or the Advisor needs is gated (the Ranger Station itself is not gated).
* **Sustainability hook (Task 23, done)**: `sim.staffUpgrades.wildlifeProtection()` returns 0 / 1 (1 once the rangers are trained). `Sustainability` reads it as the habitat protection input: trained rangers take half of the habitat overlap off (docs/rating.md).
* **Bot**: `new Bot(sim, { staffUpgrades: true })` trains in `BOT_UPGRADE_ORDER` (lift mechanics, hospitality, snowcat, instructors, patrol, rangers), one at a time, only with cost x 1.5 + reserve in cash.
* **Balance** (64 / seed 61, Normal): all six cost ~$43k plus ~$94/day upkeep; year-2 net with all six was 81.4k vs 99.4k without (-18%, never more than 20% above: `tests/sim/staffUpgrades.test.ts`). An earlier tuning pass (slightly different costs, 2 seeds) put single upgrades within about +-$12k a year of break-even after upkeep (patrol and rangers best, snowcat and hospitality slightly negative; hospitality and snowcat upkeep were lowered and hospitality raised to +12% afterwards): they are meant to be convenience / safety investments, not profit engines.
