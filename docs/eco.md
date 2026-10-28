# Eco Centre and the Eco programme

Owner request: *"can we add something that improves sustainability by a lot?"* The green buildings of item F (docs/energy.md) are small: one solar array is about +5 facet points (+0.4 rating score points). This adds a mid / late-game investment that can lift the facet by up to **+29 points**, costs real money every day and is never a free win.

Code: `src/config/eco.ts` (all tuning), `src/sim/meta/Eco.ts` (the programme), `src/sim/meta/Sustainability.ts` (the new bounded `eco` input), `src/ui/ecoFormat.ts` + `src/ui/ecoPanel.ts` (dialog), `src/render/meshes/buildings/energy.ts` (`ecoCentre` mesh). Wiring: `src/game/createSim.ts` (`sim.eco`), save module `eco` (`src/game/saveState.ts`). Balance script: `scripts/analysis/ecoBalance.ts`. Tests: `tests/sim/eco.test.ts`, `tests/ui-dom/eco.test.ts`, `tests/game/balance.test.ts` ("Eco programme").

## The building

**Eco Centre**: 4x3, **$20,000**, upkeep **$18/day**, access road or footpath (an unconnected centre is "Not connected" and every policy pauses), **one per resort**, level-gated at **resort level 4** (Alpine destination; the fifth gated building, so the unlock table limit moved 12 -> 13 items and gated buildings 4 -> 5). Category `energy` (Buildings drawer, Energy tab). Mesh (878 triangles, budget 9,000 for 12 tiles): paved forecourt, timber hall with a glass front that glows at night, a thick **grass roof** with shrubs, a **solar canopy** on four posts, a small static turbine and a rain-water tank, sign "ECO CENTRE". Height 2.1 (LiftClearance table).

Select it: the inspector shows the state (policies running, points, running cost, certificate) and an **Open the Eco programme** button (44 px). The dialog does not pause the game.

## The programme

Five policies. Each has a one-off **start fee**, a **running cost per day** while on, a real **trade-off** and a bounded **sustainability payoff** (facet points). Switching off keeps no refund; switching on again pays the fee again. Policies only work, cost and count while the centre works (so demolishing it pauses everything and costs nothing).

| Policy | Fee | $/day | Points | Effect | Trade-off |
|---|---|---|---|---|---|
| Electric snowcats & groomers | 3,500 | 14 | +4 | Grooming fuel use x0.5 (`ops.grooming.fuelMod`) | running cost; fuel saved is the only money back |
| Car-free village | 4,000 | 12 | +5 | Arrivals x0.96 (x0.985 with an active Train Station or Shuttle Depot) | fewer guests, shuttle subsidy |
| Habitat corridors & wildlife protection | 3,000 | 12 | +7 | 1.2 saplings a day credited as planted trees, **only against the net deficit** (like the nursery); feeds the trees part | forestry crew, fencing |
| Local produce & zero-waste kitchens | 2,500 | 8 | +4 | Restaurant income x1.03 | supplier and composting cost |
| Smart snowmaking & dimmed lifts | 3,000 | 8 | +5 | Snowmaking energy x0.88, lift energy x0.92 | sensors and controls: the saving is smaller than the running cost at first |

**Carbon-neutral certification** (the audit): fee 5,000, 5 $/day while the audit runs, +4 points while held, and a lasting **x1.06 arrivals** (eco-tourists). Requirements, all checked daily: **3 policies running**, **renewables take >= 20 % of the energy demand** (rolling average of yesterday's `applied / demand`, decay 0.08/day, so one sunny day is not enough) and the two **held for 10 days in a row**. A one-time milestone ("Carbon-neutral certificate earned") fires the first time. If the conditions break (a policy off, the share falls, the centre goes) the hold counter resets and the certificate lapses; it can be re-earned. The year report lists the programme (policies running, points, certified) and the **Green Resort** award reads the year-mean facet as before, so a green year gets it.

### Sustainability facet

`score = min(100, 100 x (0.4 energy + 0.3 trees + 0.3 habitat) + recycling + train + eco - motor tours)`. `SUSTAIN.weights` and the rating `WEIGHTS` are **unchanged**. The new `eco` term is `min(ECO.maxPoints = 30, policy points + certificate points)`; the total is clamped to 100 as before. Indirect effects come through the existing parts: energy per guest falls with smart snowmaking and with the arrivals-neutral energy savings; the trees part rises with the sapling credit.

The dialog shows each part with its points and maximum (energy 40, trees 30, habitat 30, recycling & rail 7, eco programme 30) and a tooltip on every row on how to raise it (solar and wind, replant, build on open ground, rangers, a recycling centre, trains).

## Numbers

* **Maximum uplift: +29 facet points** (25 from the five policies + 4 from the certificate; ceiling 30). On a poor resort (energy $9 per guest, 12 % of the forest lost, 14 % habitat overlap) the facet goes **45 -> 74** (`tests/sim/eco.test.ts` prints it). A resort already at 90+ gains little because the facet is capped at 100: the bot's resort sits at 96 before the programme and reaches 100.
* **Rating effect: +29 x 0.08 = +2.3 score points = +0.12 stars** at the very top. Honest note: the brief asked for ~0.6-1.2 stars, which is impossible while `WEIGHTS.sustainability` stays 0.08 (even 0 -> 100 of the whole facet is only +0.4 stars). The real, felt payoffs are the **arrivals** (+6 % with the certificate), the Green Resort award and the score itself; the facet weight was deliberately not touched.
* **Cost**: setup **$20,000** (centre) + **$16,000** (five fees) + **$5,000** (audit) = **$41,000**; running **$77/day = $13,860 a year** (centre 18 + policies 54 + audit 5). Per point: **about $1,410 of setup and $480 a year of running cost per facet point**.
* **Balance (bot, Normal, `npx vite-node scripts/analysis/ecoBalance.ts`)**, year-3 net profit, `plain` = the golden bot, `build` = same bot with the centre + two solar arrays but no policy (the fair control: the buildings take space and money), `eco` = all policies + the certificate:

| Map / seed | plain | buildings only | all policies | vs buildings-only | vs plain | facet | stars (y3 mean) |
|---|---|---|---|---|---|---|---|
| 64 / 61 | 141,598 | 124,949 | 124,840 | -0.1 % | -11.8 % | 96 -> 100 | 4.29 -> 4.42 |
| 64 / 7 | 153,794 | 139,728 | 138,532 | -0.9 % | -9.9 % | 96 -> 100 | 4.38 -> 4.42 |
| 64 / 3 | 159,411 | 147,023 | 134,403 | -8.6 % | -15.7 % | 96 -> 100 (cert lost: renewable share 16 % < 20 %) | 4.29 -> 4.46 |
| 128 / 61 | 182,724 | 187,657 | 184,375 | -1.7 % | +0.9 % | 97 -> 100 | 4.33 -> 4.50 |

  Reading it: **the policies themselves are roughly profit-neutral over a year** (running costs ~$14k are paid back by fuel, energy and restaurant savings, the certificate's +6 % arrivals and the car-free dip); the one-off $41k is therefore **not** paid back in three years by money alone: the payback is 4+ years or never on a small map, and the choice is strategic (a lasting score, the Green Resort award, a safety margin against rivals). The seed that lost its certificate (renewable share under 20 %) shows the intended trade-off: without real renewable power the arrivals boost is gone and the programme is a net cost. The y3 gap to the plain bot (-10 to -16 % on 64 maps, +1 % on 128) is mostly the centre and two arrays' cost and space; `tests/game/balance.test.ts` (BALANCE=1) checks the programme stays within 15 % of the buildings-only control. Never dominant: a bot with everything on earns <= ~12 % less and at most ~1 % more than the plain bot.

## Advisor

`eco.centre` (Ranger Rudi): fires when sustainability is the weakest rating component and below 65 (keep 72), the Eco Centre is **unlocked** (the rule never proposes a locked item) and not built, and `energy.green` is not firing (solar first). Title *Sustainability is your weakest area*; text names the Eco Centre and warns that policies cost money every day. **Show me** opens the Buildings drawer on the Eco Centre. `rating.lowest` defers to it for the sustainability facet.

## Saves and determinism

Module `eco` v1 (`omitWhenNull`: left out of `stateHash` and of the save until the player touches the programme). Contents: policies on, audit on, hold counter, certificate ever earned, rolling renewable share, sapling credit. Old saves load with nothing on. Every effect is exactly neutral (x1, +0) without a working centre, so a game that never builds one is bit-identical: the only golden that moved is the `progression` part of `tests/sim/staff.test.ts` (the unlock snapshot gained `building:ecoCentre` at level 4: `71be28b7 -> 8e20e249`); money, guests, rating and every other part are byte-identical. The bot option `eco` (default false; `'build'` = buildings only, the A/B control) builds two solar arrays and the centre when rich, funds the policies one a month and starts the audit.

## Tuning cheat sheet

`ECO_POLICIES[...].fee / perDay / points`, `ECO.cert.*` (holdDays, renewableShare, arrivals), `ECO.carFreeArrivals*`, `ECO.maxPoints`. Re-run `scripts/analysis/ecoBalance.ts` (SIZE, SEEDS env) after touching any of them; the arrivals multipliers and running costs are the two knobs that move the year-3 net.
