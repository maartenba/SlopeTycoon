# Small Hotel and Luxury Hotel (Phase 6, Task 27)

Two rows on the **Lodging v2** framework (`docs/lodging.md`): a mid-range hotel with a restaurant, and a luxury hotel with a heated outdoor pool that steams in the cold. Both take guests all year, both need a **road** (no footpath alternative), both are Career unlocks.

| | Small Hotel | Luxury Hotel |
|---|---|---|
| Catalog | `smallHotel`, category lodging, 5 x 4, $24,000, upkeep $55/day, staff 2, capacity 40 | `luxuryHotel`, category lodging, 6 x 6, $48,000, upkeep $90/day, staff 4, capacity 30 |
| Unlock | level 3 (Regional name) | level 4 (Alpine destination) |
| Access | road ("Needs a road next to it"); `placeTip` asks for flat ground beside a road | same |
| Spec | `RESTAURANT_SPECS.smallHotel`: `kind 'restaurant'` (a lobby restaurant, 24 places, $12 a meal, evening shift, restaurants ledger) + `rooms 40`, `tier 'standard'` | `LODGING_SPECS.luxuryHotel`: `kind 'lodging'`, overnight guests only, `rooms 30`, `tier 'luxury'`, `amenity 'pool'`, `poolSlots 14`, `poolHappiness 0.08` |
| Nightly rate | `NIGHTLY_RATE.smallHotel` = tiered standard x1: **$40**, cap $150 | `NIGHTLY_RATE.luxuryHotel` = tiered luxury x2.5: **$100**, cap $375 (Pricing key `night:luxuryHotel`) |
| Appeal | `tierAppeal([0.5, 0.55, 0.6, 0.55, 0.4, 0.4], 'standard')` | `tierAppeal([0.25, 0.5, 0.4, 0.55, 0.1, 0.2], 'luxury')` = solo 0.25, couple 0.6, family 0.4, **VIP 0.95**, budget 0 (never), adventure 0.2 |

## Who sleeps where
Nothing new in the check-in: `AttractionSystem.byPreference` (campground framework) puts a tiered house a guest type likes (appeal >= 0.65) first, untiered houses next, lukewarm tiered houses last, and a type with appeal 0 never. So **VIPs fill the 30 suites first** (then spill over to the chalets / apartments / small hotel; a VIP who cannot pay $100 goes elsewhere), budget guests never take a suite, couples and everybody else prefer the cheaper houses. The Small Hotel (standard tier, neutral shift) is just a bigger chalet with a restaurant. Both are in `REST` (guests walk there to rest), the Small Hotel is also in `FOOD` (day guests dine in its lobby) and counts as an evening venue.

The VIP campaign's lodging prerequisite (`vipAccess`) now accepts **an active Luxury Hotel** (or an altiport, or `VIP_LODGING_MIN` chalets + apartments + small hotels); the `luxury` facility likewise. Advisor rule `hotel.vip` ("VIPs need luxury lodging", info, no build action: the hotel is a level-4 unlock, and a rule may not build gated items): fires when the Luxury Hotel is unlocked, >= 40 guests (30 while shown), 3+ stars, and neither a Luxury Hotel nor an Altiport stands; "Show me" opens the Buildings drawer on it. (The first draft of the plan said this rule already existed; it did not, so it was added.)

## The pool
* **Slots**: `amenity 'pool'`: `Attraction.baseCapacity` adds `poolSlots` (14) to the 6 rest places = **20 simultaneous `Using` places**, overnight guests only (`canUse`). More guests queue (balk / renege as everywhere).
* **Happiness**: each finished visit adds the rest effect (+0.08) plus `poolHappiness` (+0.08), see `AttractionSystem.release`. Wellness & Views (Phase 6 Task 52) reads the same `amenity === 'pool'` as its "hotel pool" prerequisite.
* **Inspector**: `Rooms: 12/30 tonight · $100 a night`, `Pool: 3/20 in the water`, `Pool heating: $12.50/day of energy (solar, wind and hydro offset it) · steaming in the cold` (`AttractionSystem.hotelInfo` + `formatHotelLines`; the page adds the heating cost and the steam flag from the weather).

## Pool heating = energy demand
`config/energy.ts`: `POOL = { perDay 18, fullBelow -5, warmAbove 22, minShare 0.25, steamBelow 5 }`; `poolHeatFactor(temp)` = 1 at -5 C and colder, linear to 0.25 at 22 C and warmer (the pool is never off); `poolHeatCost(temp)` = $18 x factor (noon temperature at the hotel's altitude). In `createSim` the finance daily cost calls `poolHeatToday()` (sum over active Luxury Hotels; **exactly 0 without one, so a game without a hotel is bit-identical**) and:

* books it on the **energy** expense line (so the sustainability facet's net energy per guest sees it, no extra plumbing),
* adds it to the day's **demand** *and* to the lift energy line the offset comes off: `energy.settleDay(lo.energy + pool + snowmaking, lo.energy + pool)`. The generators' offset keeps its 60 % cap, so solar / wind / hydro / biomass pay for up to 60 % of the demand, pool included. Energy is still never free.

At a typical -3 C winter noon a pool costs about $17 a day (about $3,000 a year), a few percent of a 64-map bill; the hotel's upkeep ($90/day) is the bigger line.

## Steam (`render/Smoke.ts`)
The pool steam reuses the chimney smoke renderer: **one instanced draw call, the same 16-emitter cap**, plus:
* `BuildingDef.steam` (the vent above the pool centre, building-local) instead of `chimney`; `emitterSpecOf(type)` = chimney ?? steam.
* kind `pool`: intensity 0 from 5 C up, 0.55 .. 1 below (denser in the cold), any hour. At most `SMOKE.steamMax` (3) steaming pools at once.
* New per-puff attribute `aWide` (0 for ordinary smoke and the rapids splash): size x (1 + 1.4), whiter (mixed 60 % toward white, no warm night tint), slower rise, less wind drift, higher alpha, and the origin is scattered over the basin (deterministic, from the puff ring counter). Soft round sprite as always (`1 - d^2` falloff, `discard` outside the unit circle).
* The Small Hotel has an ordinary kitchen chimney (kind `dining`).

## Look (`render/meshes/hotelSmall.ts`, `hotelLuxury.ts`)
* **Small Hotel** (2,800 triangles): two-floor cream block under a red gable roof, framed windows (shutters, flower boxes), balconies, a glazed lobby / restaurant wing with an awning, a HOTEL sign, a parasol terrace, a chimney, flag and lamp.
* **Luxury Hotel** (3,760 triangles): three-floor wing under a slate roof, a corner tower with a pyramid roof, an entrance pavilion with a columned canopy and a GRAND sign, balconies, flag, lamps; in front the **pool deck**: surround slabs round a recessed basin (floor y 0.03, deck top 0.10), white coping, six loungers with towels, two parasols, pool lamps.
* **Water** (`BuildingMeshes.create`): ONE flat grid mesh named `poolWater` (about 80 triangles, shared by every hotel) at y 0.065, **between** the basin floor and the deck top (no coplanar faces), **static vertex colours** (lighter in the middle, deeper blue at the rim: no noise, no time term), a stock `MeshBasicMaterial` (nothing custom to compile; `MaterialGuard` scans it like every mesh, the shot harness printed no shader error), tone a little darker at night (pool lights stay bright). Group = wood / roof / sign + the water = 4 meshes (the deck is in the wood layer and `doorway` is not used, so there is no stone layer).
* Windows are `C.glass` vertex colours: warm glow at night. Roofs are the snow layer. The luxury hotel keeps its box count under the anti z-fight growth cap (`BOX_GROW_MAX` is reached at 200 boxes; `tests/render/snowFlicker.test.ts` caught the first draft with 266): panes on the back and side walls are plain slabs, no shutters.

## Flicker check
`npm run flicker:building -- --place luxuryHotel --out hotel2` (new `--place <type>` option: first free spot, trees cleared, centred): **155.5 oscillating px per window summed over zooms 2 / 3.5 / 6** (100.6 / 37.8 / 17.1; region 300 x 220, 8 yaws), against **849.3** for the default demo lodge in the same harness today; the heatmap shows the few hot pixels on the trees below the building, none on the pool or the roofs.

## Balance
The bot never builds a hotel (no wish), so goldens only move in the `progression` part of `tests/sim/staff.test.ts` (two unlock rows: not re-recorded here, M6.4 STOP). Economics for a player: the Small Hotel is a 40-room chalet-rate house plus a restaurant for about 2.7 apartments of money; the Luxury Hotel earns $100 x 30 = $3,000 a night when full against $90 upkeep, $72 wages and about $17 of pool energy, but only VIPs / couples fill it, and the overnight guest cap (`Spawner`) still limits it.

## Tests
`tests/sim/attractions/hotels.test.ts` (catalog rows, room counts and rates in winter and summer, VIP preference and overflow, thin-wallet VIP, pool slots / queue / day guests, pool happiness, inspector data, determinism and no new save key, steam trigger below 5 C and at any hour, steam cap and `wide`, kitchen chimney, heating curve, real resort: pool demand and energy bill, solar offset with the 60 % cap, VIP prerequisite, save / load + same-seed hash, mesh budget / glass / roof, water geometry inside the basin and between floor and deck, `BuildingMeshes` pool mesh + night tone), `tests/sim/advisorScenarios.test.ts` + `advisor.test.ts` (`hotel.vip`), `tests/ui-dom/progression.test.ts` (the level-4 card now lists five unlocks: `UNLOCK_ROWS` 5, `UNLOCK_H` 190).
