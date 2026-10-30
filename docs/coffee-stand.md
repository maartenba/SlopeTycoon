# Coffee Stand (Phase 6, Task 28)

A 1 x 1 kiosk for a quick cup and a bite: cheap, all year, food only (the **toilets** stay the only comfort source, `docs/comfort.md`).

| | |
|---|---|
| Catalog | `coffeeStand`, category services, 1 x 1, $1,200, upkeep $4/day, staff 1, capacity 4, season all, never gated |
| Access | `pisteEdge`, alt footpath or hiking trail (`pisteRule 'edge'`: beside a piste, not on one; same site rule as the Mountain Hut); "Needs a footpath, road, hiking trail or piste next to it"; supplied only by trail / piste edge = the +25 % remote upkeep (`docs/trails-access.md`) |
| Spec | `RESTAURANT_SPECS.coffeeStand`: `kind 'restaurant'`, **2 ticks** a visit (cafe 4), **4 places** (cafe 30), price **$4** (cafe $6, cap $12), effects `hungerBy 0.3` (takes 0.3 off the hunger, floor 0.05) + 0.04 mood, **no `urgeTo`** (the cafe relieves the comfort urge a little; the stand does not), no evening shift |
| Look | `render/meshes/coffeeStand.ts` (390 triangles): timber kiosk, red gable roof, glass hatch with a striped awning and a counter with two cups, COFFEE board, stool, an espresso flue |
| Wisp | `Smoke.ts` kind `coffee`: 08:00 - 17:30 only, intensity 0.3 (warm) .. 0.85 (cold), puff size x0.45 (`SMOKE.wispWide`); the catalog `chimney` is the flue top |

## Behaviour
* **Snack stop** (`Decision.snackFor`, `SNACK`): a guest with hunger in [0.3, 0.7] weighs the nearest open kiosk as an `eat` candidate with score `1.75 - hunger - 0.15 x tiles + 0.3 x (1 - tiles / 7)`. The pull **falls with hunger** (a snack-sized appetite stops for a coffee; the real meal scores `2 x hunger` and wins from about 0.6, and at lunch the bonus is the cafe's) and with the detour, so it never replaces the lodge / cafe. No RNG is drawn (guests without a kiosk keep their stream: worlds without one are identical). The kiosk is in `SNACKS`, not `FOOD`: never the lunch destination, not an evening venue, does not satisfy the "a place to eat" prerequisites, never a wandering target.
* **Where "mid-run" is**: guests take decisions when they are idle (at the lift bottom, at a building), not while skiing a run, so a stand works wherever the guests' decision points are, like the Mountain Hut (`nearest(food)` from the current position). A stand beside the piste end / lift bottom serves skiers coming off the slope (the real-resort test places it there and it sold cups within three days). There is **no "stop in the middle of a descent" mechanism, by decision at the M6.4 STOP**: the plan's acceptance wording "skiers stop mid-run" is NOT met literally. A skier passing a stand in the run does not stop; adding that would put a new decision point into the movement code, and the ski-exploration / determinism goldens would need re-recording for a snack-sized effect. Stands work where guests decide: lift bottoms, the end of a piste, outside buildings and along footpaths. The guide (`site/guide/hotels.md`) says exactly that ("put stands where people stand around"). Revisit only if the human playtest says stands feel dead.
* **Hikers and bikers**: a stand within `EXC.foodRadius` counts as food in reach for the excursion planner (`foodNear`); at the stop `lunch()` is a cup if a stand is the ONLY food in reach (0.3 off the hunger, $4, `SNACK.by` / `SNACK.spend`) and the usual lunch ($12, hunger 0.05) otherwise. Hunger rises 0.04 an hour while moving, so a cup buys about seven hours.

## Balance
* The bot does not build it: goldens unchanged (the unlock-free row adds nothing to `progression`).
* Why it is not "free money" nor a cafe killer: $4 a cup, 4 places, 2-tick service (about 2 guests per tick), 0.3 off the hunger only, and only for guests with hunger 0.3 - 0.7 within about 7 tiles of the decision point.
* `npm run test:balance` is unchanged (see the report in the task notes).

## Tests
`tests/sim/attractions/coffeeStand.test.ts`: catalog row, quick-service numbers vs the cafe (no `urgeTo`, `hungerBy`, not in FOOD), access (bare / footpath / trail / piste, remote-supply flag), service ($4 into the restaurants ledger, hunger 0.8 -> 0.5, comfort urge untouched while the cafe lowers it), capacity 4 and a queue of 10 clearing, snack decisions near a stand (a good share at hunger 0.5, none when starving or full, far stands matter less, meals still sold), hiker stop (cup vs lunch), wisp hours / size, mesh size, a real starter resort with a stand beside the piste end (active, served, revenue, the lodges keep selling >= 60 % of their meals).
