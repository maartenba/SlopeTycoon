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
* **Mid-run coffee break** (M6.4 owner decision, `GuestSim.coffeeBreak`, `Decider.snackWithin`, `SNACK.passRadius/passMin/passMax/tired/oneIn`): while a skier is moving in `Act.SkiDown` and the resort has an open stand, each tick it checks (only then) whether it is within **2 tiles** of the nearest open stand, with hunger in [0.3, 0.7] **or** fatigue >= 0.6 (tired), budget >= $6. If so, a **stateless hash** of (guest id, completed runs) picks 1 pass in 3; the skier then re-targets the stand (`Act.ToBuilding`, normal arrival / 2-tick quick service, 4 places, $4, hunger -0.3, +0.04 mood) and afterwards simply takes its next decision (lift bottom or another run): no stuck state, because the stop is an ordinary ToBuilding walk (timeouts / unreachable abort as ever). No RNG is drawn, nothing new is stored: the per-guest cap is structural, a cup takes 0.3 off the hunger so the guest is back in the window only after hours (1-2 stops a day), and 2 of 3 passes are skipped. Worlds without a stand never enter the code (`snacks.length` 0): bit-identical. Measured (starter resort 64 / seed 61, stand 3 tiles from the lift bottom, 6x arrivals, three winter days): **11 mid-run stops in 351 completed runs (3 % of runs), 14 cups sold in all**, test `mid-run coffee break`. Perf: one distance check against the (few) stands per skiing guest per tick.
* **Decision-point stops** still work as before: guests decide when idle (lift bottom, end of piste, outside buildings), so a stand there sells too.
* **Hikers and bikers**: a stand within `EXC.foodRadius` counts as food in reach for the excursion planner (`foodNear`); at the stop `lunch()` is a cup if a stand is the ONLY food in reach (0.3 off the hunger, $4, `SNACK.by` / `SNACK.spend`) and the usual lunch ($12, hunger 0.05) otherwise. Hunger rises 0.04 an hour while moving, so a cup buys about seven hours.

## Balance
* The bot does not build it: goldens unchanged (the unlock-free row adds nothing to `progression`).
* Why it is not "free money" nor a cafe killer: $4 a cup, 4 places, 2-tick service (about 2 guests per tick), 0.3 off the hunger only, and only for guests with hunger 0.3 - 0.7 within about 7 tiles of the decision point.
* `npm run test:balance` is unchanged (see the report in the task notes).

## Tests
`tests/sim/attractions/coffeeStand.test.ts`: catalog row, quick-service numbers vs the cafe (no `urgeTo`, `hungerBy`, not in FOOD), access (bare / footpath / trail / piste, remote-supply flag), service ($4 into the restaurants ledger, hunger 0.8 -> 0.5, comfort urge untouched while the cafe lowers it), capacity 4 and a queue of 10 clearing, snack decisions near a stand (a good share at hunger 0.5, none when starving or full, far stands matter less, meals still sold), hiker stop (cup vs lunch), wisp hours / size, mesh size, a real starter resort with a stand beside the piste end (active, served, revenue, the lodges keep selling >= 60 % of their meals).
