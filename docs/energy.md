# Energy grid and green buildings (item F)

User question that started it: *"other building types that may make sustainability better? A solar plant?"* Audit before this change: the sustainability facet is 40 % energy per guest (EMA, $2 per guest = 1.0, $12 = 0.0), 30 % trees, 30 % habitat, and the only energy in the game came from lifts and snowmaking; no building could offset it. This adds an **energy grid** with generators plus the other green buildings.

Code: `src/sim/Energy.ts` (grid + generator maths), `src/config/energy.ts` (all tuning), `src/render/meshes/buildings/energy.ts` (meshes), `src/ui/energyFormat.ts` (inspector lines). Wiring: `src/game/createSim.ts` (`sim.energy`), save module `energy` (`src/game/saveState.ts`).

## Model

* **Unit = energy dollars**: what the same energy would cost from the grid. The lift and snowmaking bills were already in dollars. The UI shows **kWh = $ / 0.20** and **kW = $/h / 0.20** (`ENERGY.gridPricePerKwh`; display only).
* **Demand** (per day) = lift energy line + snowmaking energy booked that day. No building base load: keeping it simple, existing cost units only.
* **Supply**: every active generator adds its output **hour by hour** (`time:hour`), so "output now", "today so far" and "yesterday" are real numbers. Biomass burns once a day.
* **Settlement** (inside the daily cost calculation, `Finance.costs()`): `applied = min(generated, 60 % x demand, lift energy line)`. That much comes **off the `energy` ledger line**; the rest is **wasted** (not sold; `ENERGY.surplusSoldShare = 0`: the valley grid is small, selling would add a second income line and a way to make energy "free" by overbuilding). Deficit is simply the bill that remains, at the existing price. So a resort with 20 panels pays at least 40 % of its energy bill.
* **The cap is the balance guarantee.** Energy is never free; panels beyond the cap are wasted money. The per-day cap also means summer surplus (long days, low lift demand) is mostly lost: that is why a solar array pays back in about 3 years, not 1.
* **Sustainability** reads `energyToday` from the ledger buckets, which are already net of the offset, so the facet uses **net grid purchase per guest** with no extra plumbing. Weights and the 100 cap are unchanged (`SUSTAIN.weights` untouched; the facet is clamped to 100 after the recycling bonus).
* **No generators = bit-identical to before.** `settleDay` returns exactly 0 and `costs()` passes `lo.energy` through untouched. Proof: the golden hashes in `tests/sim/staff.test.ts` only moved in `progression` (two new unlock rows); every other part (money, guests, economy, rating...) is byte-identical. The bot never builds generators unless `greenEnergy: true`.

## Buildings (Buildings drawer, tab "Energy")

All sit in category `energy`. Access follows the placement table (missing access never blocks placement; the building is "Not connected" and produces nothing).

| Building | Size | Cost | Upkeep/day | Access | Site | Unlock |
|---|---|---|---|---|---|---|
| Solar Array | 3x2 | $6,500 | $1.5 | path or road | gentle slope (<=2), auto-flatten optional | always (the Advisor suggests it) |
| Solar Plant | 5x4 | $16,000 | $4 | road or path | gentle slope, optional flatten | level 3 |
| Wind Turbine | 2x2 | $10,000 | $3 | path or road | slope <=3, **exposed ground only** (mean corner height >= 20 of 8..38: "Too low for this building"), rock ok | level 2 |
| Small Hydro | 3x2 | $11,000 | $3 | path or road | **must touch a stream tile** ("Must be next to a stream"; the stream itself is never built on), rock ok | always |
| Biomass Heating | 3x3 | $5,000 | $1.5 | road | flat | always |
| Tree Nursery | 3x3 | $3,000 | $2.5 | path or road | gentle slope | always |
| Recycling & Compost Centre | 3x2 | $2,500 | $2 | road or path | flat | always |

Only two items are gated (D2 selective: `tests/sim/progression.test.ts` allows at most four gated buildings). Hydro is self-limiting (needs a stream, $11k). Geothermal is out of scope.

### Output curves (`src/config/energy.ts`, `ENERGY` / `GENERATORS`)

* **Solar** (rated $4.2/h array, $17/h plant): `rated x sin(pi x (t - sunrise)/(sunset - sunrise))` between the real `Daylight` sunrise and sunset, x sun height (winter 0.72 -> summer 1.0 by `summerness`), x altitude (+12 % at the highest ground), x sky (clear 1, cloudy 0.55, rain/snow 0.3, heavy 0.2, storm 0.15, fog x0.8), x **snow derate** (0.35 while the tile carries snow, 0.12 while snow is falling). Panels under winter snow are the weak spot: winter days are $1-4 per array, summer days $20+.
* **Wind** (rated $2.4/h): speed index = 0.3 x exposure (0..1 over the terrain height range) + 1.0 x the day's wind (0..0.35, **1.0 in a storm**) with a +-10 % afternoon gust; nothing below 0.25, rated from 0.7, **feathered and shut above 1.0 (storm)**. The rotor mesh spins (`BuildingsView.spin`, 0.5..3 rad/s with output, stands still when shut). Small scenery cost: -0.03 of the 0..1 scenery score per turbine, cap -0.12 (that score is worth +2 rating points at most, so at most -0.24 points).
* **Hydro** (rated $1.5/h, all 24 h): flow by season (spring melt 1.0, summer 0.72, autumn 0.5, winter 0.35) +20 % in wet weather.
* **Biomass** (burns up to 3 timber units a day at $7 each): supply = 1 unit per tree felled since the last day + 1 unit/day forestry residue, store capped at 40. About $1,250 a year at typical clearing; a **small** offset by design.
* **Tree Nursery**: while active it credits 0.35 sapling/day (per nursery) as **planted trees, but only against the net deficit** (felled - planted - credit), never beyond it, and replanting with the Plant tool costs 60 % while one works. The credit lives in `Energy.nurseryCredit` (the tree counters in `PropStore` are untouched, so undo and the bot logic are unaffected).
* **Recycling & Compost Centre**: flat **+4 points** on the facet (0..100), one centre (more do not stack). Tiny upkeep.

## Payback (bot resort, 64 map, `scripts/analysis/energyPayback.ts`)

Method: bot played one year (day 180), the building is placed and connected, two more years are played; `applied` = energy dollars taken off the bill per year (`energy.totalApplied`), `net = applied - upkeep x 180`, payback = cost / net. Seeds 61 / 7, typical load $13k a year (lifts $11.5k + snowmaking $1.5k).

| Building | Cost | Upkeep/yr | Applied/yr | Wasted/yr | Net/yr | Payback (years) |
|---|---|---|---|---|---|---|
| Solar Array | $6,500 | $270 | 2,365 / 2,305 | 99 / 83 | 2,095 / 2,035 | **3.1 / 3.2** |
| Solar Plant | $16,000 | $720 | 4,729 / 4,791 | 5,241 / 4,870 | 4,009 / 4,071 | **4.0 / 3.9** (half of it is wasted at this load: it is for 128 / 256 resorts) |
| Wind Turbine | $10,000 | $540 | 4,258 / 4,394 | 533 / 436 | 3,718 / 3,854 | **2.7 / 2.6** |
| Small Hydro | $11,000 | $540 | 3,834 / 3,793 | 252 / 273 | 3,294 / 3,253 | **3.3 / 3.4** |
| Biomass Heating | $5,000 | $270 | 1,265 / 1,211 | 55 / 60 | 995 / 941 | **5.0 / 5.3** (deliberately the slow one) |
| Tree Nursery / Recycling | $3,000 / $2,500 | $450 / $360 | 0 | - | - | no energy income: a sustainability purchase |

128 map (seed 61): array 3.0 y, plant 5.0 y at the old $21k price (now ~3.8 y), wind 2.5 y. The first calibration had a $6.4/h turbine (1.4 y payback, $27k gross a year, dominant): rated, exposure and cut-in were lowered until it sat next to solar and hydro. Everything is in the 2-4 year window except biomass, which is small on purpose and gets better when you clear a lot of forest.

Sustainability effect of one array on the bot (`GREEN=1 npx vite-node scripts/analysis/ratingDistribution.ts`, see docs/rating.md): energy per guest p50 5.3 -> 3.6 ($/guest), facet mean 87 -> 92 (+5 points = **+0.4 rating points**), star split 4★ 44 % -> 35 %, 4.5★ 56 % -> 65 % (seed 61).

## Advisor, UI, saves

* Advisor rule `energy.green` (Ranger Rudi): fires when the **energy** part is the weakest sustainability part, below 0.5 (keep < 0.6), a rate is measurable and **no solar / wind / hydro unit works**; proposes a validated Solar Array site (Build action) and opens the Energy tab ("Show me"). The generic `rating.lowest` rule defers to it for the sustainability facet (no duplicate advice). The rating hint now reads "build solar, wind or hydro power, close idle lifts, fewer snow cannons".
* Inspector (all generators): output now (kW, % of rated, reason: Sunny / Cloudy / Panels under snow / Becalmed / Shut down: storm winds / Low winter flow...), today so far and yesterday (kWh), the share of the bill it took off yesterday, and the resort grid line (demand, generated, % of bill offset, unused). Nursery: saplings credited and the deficit left; recycling: the bonus. "Not connected" is explained.
* Stats screen (generation vs demand) is **not** added: the inspector grid line carries it. (Optional in the brief.)
* Drawer: the Buildings drawer got a seventh tab, "Energy". The tab strip scrolls sideways on narrow windows, so the chosen tab now scrolls into view.
* Icons: BUILDING_ICONS (sun, bright sun, wind, droplets, log, sprout, recycle) and the usual rendered thumbnails. Sounds: none.
* **Save module `energy` v1** (additive: today / yesterday per generator, applied shares, timber stock, nursery credit, last settled day, lifetime totals). Old saves load with an empty grid. It is part of `stateHash` (it can change money); `tests/sim/energy.test.ts` proves a mid-day save with generators continues identically to the control, and `tests/sim/staff.test.ts` excludes the new `energy` part like the other new modules.

## Meshes (docs/models.md style)

Procedural, within the budget (<3000 triangles for <= 6 tiles, else <9000). Triangles: Solar Array 740, Solar Plant 1,918, Wind Turbine 432 (+ rotor), Small Hydro 578, Biomass Heating 844, Tree Nursery 622, Recycling 590. Panels are a dark blue that is NOT the window-glass colour (so a solar field never glows at night); the control hut, the nursery's greenhouse and the biomass boiler house use `C.glass` windows that glow warm at night. The turbine is a tapered tower (432 triangles) plus a separate `rotor` group (hub + three blades) added by `BuildingMeshes.create` and spun by `BuildingsView.update`. Roof snow works on panels and blades through the usual snow uniform. Biomass has a chimney entry (winter smoke). Heights are in `config/buildingHeights.ts`. No part is thinner than `MIN_THIN` (flicker rules).

## Tuning cheat sheet

`ENERGY.maxOffsetShare` (0.6) is the one knob that keeps the economy honest; `GENERATORS[...].rated` scale each building; `ENERGY.solar.snowCovered` / `winterTilt` shape the seasonal curve; `ENERGY.nursery.saplingsPerDay` and `recycling.bonusPoints` are the sustainability side. Re-run `scripts/analysis/energyPayback.ts` after touching any of them.
