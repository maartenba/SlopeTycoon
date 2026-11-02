# M7.4: Pizzeria, Bakery, Tourist Office, the sky, and the Carnival

Five buildings plus a richer festival (owner decisions in `.weave/plans/slope-tycoon-phase7.md` "Owner decisions"). Everything ships ON, no flag; the plain bot builds none of it, so `npm run test:balance` is unchanged (it passes 48 / 48) and the only golden that moved is the `progression` part of the staff golden (new unlock rows, see "Balance").

Code: config `src/config/buildings.ts` (rows), `src/config/visitorServices.ts` (Tourist Office, Bakery), `src/config/sky.ts` (sky rules), `src/config/festivals.ts` (`CARNIVAL`); sim `src/sim/attractions/Restaurant.ts`, `Sky.ts`, `SkySites.ts`, `AttractionSystem.ts`; render `src/render/meshes/buildings/visitor.ts`, `src/render/SkyActivity.ts`; tests `tests/sim/m74Buildings.test.ts`, `tests/render/skyActivity.test.ts`, `tests/sim/carnival.test.ts`, `tests/render/carnivalRender.test.ts`, the contract test (`tests/repo/buildingContract.test.ts`).

## Rows

| Building | Tab | Size | Price / upkeep | Access | Level | What it does |
|---|---|---|---|---|---|---|
| Pizzeria | services | 2 x 2 | $4,800 / $16 | road or footpath | always | a real meal, **$9**, 20 places, 5 ticks, evening shift, family 0.9 / budget 0.9 / VIP 0.2; in `FOOD`; wood-oven flue (smoke kind `dining`) |
| Bakery | services | 1 x 2 | $2,200 / $7 | footpath or road | always | **06:00 - 12:00** only (`spec.hours`), $4, 6 places, 2 ticks, takes 0.3 off the hunger (a snack, in `SNACKS`, never the lunch); Facilities bonus (below) |
| Tourist Office | services | 2 x 2 | $3,500 / $12 | road or footpath | 2 | **ONE per resort** (`maxCount 1`), always **+6 % arrivals** (`TOURIST_OFFICE.arrivalMult`) while active; Rudi `tourist.office` |
| Grass Strip | transport | 7 x 2 | $6,000 / $10 | road or footpath | 3 | flat mown airfield, 1 per resort, windsock + hangar. Owner decision: a cheap strip, NOT the Altiport (which stays level 5, $15,000) |
| Skydive Centre | recreation | 3 x 2 | $7,000 / $25 | road or footpath, needs the Grass Strip | 3 | tandem jumps **$95** (max $220), 4 at a time (10 ticks a jump, about an hour with the climb), adventure 1.0 / VIP 0.7 / solo 0.6, families 0.1; 2 staff |
| Launch Ramp | recreation | 2 x 2 | $3,500 / $8 | trail, footpath or piste edge | 2 | high ground (`minAltitude 14`), $45 a flight (max $120), 4 at a time |
| Landing Field | recreation | 4 x 4 | $1,500 / $3 | footpath or road | 2 | flat meadow; the pair of the ramp |

## Pizzeria and Bakery

They reuse `RESTAURANT_SPECS`. The Pizzeria must not dominate the Lodge: it has 20 places (the Lodge 120), $9 (the Lodge $12), and the food-surplus advice (`food.surplus`) and the saturation test (`tests/balance`, "food buildings saturate") still apply: a bot that spams restaurants loses money. The Bakery is a `SNACKS` kiosk with opening hours: `AttractionSystem.servingNow` honours `spec.hours` and `Decider.refresh` only lists a snack kiosk while it serves, so nobody walks to a closed bakery.

**Breakfast bonus** (`BAKERY`): an active bakery within **9 tiles** of an active lodging (chalet, apartment, hotel, Base Lodge) adds **+4 points** to the Facilities facet score (0..100, capped, once: a second bakery adds nothing). Facilities weigh 6 % of the rating, so the best case is about +0.24 rating points.

## Tourist Office

`createSim` multiplies the spawner attractiveness by `TOURIST_OFFICE.arrivalMult` (1.06) while an active Tourist Office stands (a constant factor, never stacked, never time-limited; one per resort by `maxCount`). Measured (`tests/sim/m74Buildings.test.ts`, starter resort 64 / seed 61, 6x arrivals, 4 winter days): more arrivals with the office than without, ratio < 1.25 (the factor itself is 1.06). Rudi: `tourist.office` (15 guests, 2 stars, a Base Lodge, cash for it, not built). The "info need" touch from the plan was NOT built (see "Not built").

## The sky

* **Closed unless** it is **09:00 - 17:00**, the day is not rain / snow / storm, fog < 0.5 and wind <= 0.3 (`SKY`, `skyWeatherReason`); a Skydive Centre also needs an active Grass Strip (`Closed: no grass strip for the plane`), a Launch Ramp an active Landing Field within **45 tiles** and at least **3 units lower** (`landingFor`, `GLIDE`; `Closed: no Landing Field within 45 tiles and lower down`). The reason shows on the card. Placement is never blocked (the house rule: a missing partner makes the building closed, not unplaceable), so the "paired placement validation" of the plan is the closed reason plus the pure pairing test.
* **Sim**: ordinary attractions (`SKY_SPECS`, `spec.sky`); guests choose them as `ACTIVITY` goals; the jump / flight is the `serviceTicks` (8 / 6) and costs the price. No incidents, no deaths.
* **Render** (`SkyActivity`, 3 instanced draws, view only, deterministic in the tick, no RNG): a small plane per open busy centre (max 2) rolls out on the strip, climbs in a circle, at `JUMP_AT` canopies (up to 6 per plane, tinted) leave it and spiral down to the strip, the plane lands. Gliders (max 6 in all, 3 per ramp) leave the ramp, circle lazily over the middle third and land on the field. Hidden when the camera is far out (`activity.far`). No new audio (the plan: restrained).

## Carnival

See `docs/festivals.md` "Carnival" (the old 'Winter Carnival' entry upgraded, id `carnival` kept for old saves).

## Balance

* `npm run test:balance`: **48 passed** (including "content bot: every building id gets built", which now builds all seven new rows without breaking the books).
* Goldens: only the `progression` part of the staff golden moved (the unlock snapshot gained the five M7.4 rows at levels 2 and 3, the other worker's sled rows are in the same re-record; the Pizzeria and Bakery are always available and add nothing to it); money, guests, rating and every other part are byte-identical, which is the proof the plain bot is unaffected. The `carnival` campaign row and `masked` fact are data only.
* ROI (`npm run analysis:roi`): see `docs/economy-audit.md` "M7.4 rows".

## Not built (reported)

* The Tourist Office **info-need / rating touch** (only the arrival effect and the Rudi hint).
* **Hand-drawn decorated sledges and a separate brass band** in the Carnival parade: the revellers carry a small brass horn and a wooden mask instead (one merged figure, one draw call).
* The shop spend bonus is a flat +5 % on restaurant and shop income while the Carnival runs, not "near the street".
* No airborne audio; no hang-glider thermals beyond the lazy circle.
