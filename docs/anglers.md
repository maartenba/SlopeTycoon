# Anglers: Tackle & bait hut, fishing piers, fish stock, Angler guests

Phase 6, Tasks 49 + 42 (R2-1). Developer notes. Player text lives in the guide at the end of the milestone.

## What the player gets
| Piece | Rules |
|---|---|
| **Tackle & Bait Hut** (`tackleHut`) | 2x2, $1,800, upkeep $6/day, 1 staff, Career level 2, footpath / trail access. Day ticket $12 (price slider, max $30), rod hire $8 (only guests without their own rod: 40 % bring one), bait $3. Place it within **3 tiles of water** (otherwise it is closed: "no lake, pond or river within 3 tiles"). Serves every water body within **20 tiles**. |
| **Fishing Pier** (`fishingPier`) | 1x2, $400, upkeep $1, needs a hut first (`requires`), dry footprint touching a lake or pond (same rule as the boat rental). **4 fishing places** for every hut within 20 tiles. Not used on the ice. |
| **Bank spots** | implicit, no building: a shore tile of a reachable water with a footpath / hiking / MTB tile as 4-neighbour, 1 place each, at most 8 per hut (nearest first). |
| **Fish stock** | per water body, 0..1 (`FishStock`). Lakes `l<i>`, player ponds `p<id>`, natural streams `n<i>`, dug rivers `r<id>` (the flow model's waterway ids). Created lazily at 0.85 the first time somebody fishes there. |
| **Catch & release / Keep** | `st-select` in the hut inspector (default Catch & release). Keep sells each kept fish for $2 at the cafe (ledger `restaurants`) but takes 15x more stock per catch. |
| **Overfished** | stock < 30 %: the visit mood drops and the Advisor warns "Overfished" (`fish.overfished`, 40 % while shown); fix = Catch & release or another water. |
| **Ice fishing** | `ICE_FISHING = true` (`config/balance.ts`, owner: "ice fishing cool"). While the water at the hut is frozen (temperature at the hut <= 0, the same test as the beach / boat rental) only **frozen lakes and ponds** are fished, from **places on the ice** (any shore tile, no path needed; hole + stool + rod drawn there). Rivers and streams are never fished on ice; a frozen dug river is skipped even in a mild winter. Piers are not used in winter. |

## Sim
- `src/sim/nature/FishStock.ts`: stock map + pure helpers (`reachable`, `nearWater`, `spotsFor`, `sizeFactor`, `bodySize`). `FishWaters.fishBodies` builds the body list from lakes / ponds / streams / rivers (cached in `createSim` by `rivers.version` and `landscape.version`).
- Regrowth runs once a day (`day:changed`): `s += r s (1 - s) + floor (1 - s)`, r = 0.08, rivers / streams with discharge >= 1 x1.5, **frozen water: none**. Defaults in `FISH` (`config/balance.ts`).
- Catches: a visit makes `FISH.casts` (4) casts at the water chosen by `guestId % reachable waters`; each cast bites with `0.12 + 0.78 stock` (sim `state.rng`, drawn only when a visit ends). Each catch costs `depleteKeep` 0.012 (Keep) or `depleteRelease` 0.0008, x `sizeFactor` (25 / water size, clamped 0.25..2: small ponds deplete faster; rivers count 2.5 per path tile).
- `Angling.ts`: the hut spec (`kind: 'angling'`, `serviceTicks: 70` = about 7 game hours, capacity = fishing places, at least 2) and `AnglingPlanner` (per-hut plan: waters in reach, places, pier share, ice, noise; cached until the world stamp or the ice state changes). `AttractionSystem` charges the extras on entry (`rental` rod, `shops` bait), rolls the catches on release and sets the mood (`visitMood`: fish +, a pier x1.2, empty / overfished -, a motorised tour base within 14 tiles -).
- Save: module **`fishStock`** v1 (`omitWhenNull`: `null` and out of `stateHash` until somebody has fished, so worlds without a hut keep their hashes); the hut's Keep flag is saved in the attraction instance only when true; catches live in `AttractionStats.catches`.
- Sustainability: `SustainRaw.fish` = `(mean stock - 0.6) x 5` clamped to **+/- 2** facet points (only written while non-zero).
- Advisor: `fish.overfished` (warn, hourly).

## Render
`meshes/tackleHut.ts` (about 400 triangles: cabin, rod rack, drying fish, porch, bait crate) and `meshes/fishingPier.ts` (about 260: deck on piles, rope rails, bollard, bench). Anglers are **view only**: `AttractionActivity` seats up to 12 figures per hut at the places from the plan, each with a slanted rod (instanced), a red bobber that bobs on the water, and on the ice a dark hole and a stool (4 extra instanced draws, only while anglers fish; hidden when zoomed far out like the other activity props).

## Angler guest type (Task 42, index 7)
See `docs/guest-types.md`. Weight 0.10 in summer, 0.05 in spring / autumn, 0.06 in winter only with ice fishing; level 2; `requires: ['@fishing']` = an **open** hut with fishable water in reach that still has fish (`Spawner.flagsFn`). Fallback / segment `solo`, budget $100-200, group 1-2, teal jacket + cap, appeal: tackle hut 1.5, beach .7, boats .6, restaurant .7, hates the stunt park / tours. Their visit is the hut service time (~7 h), low spend but steady ($12 + $3 + $8 rod hire + $2 per kept fish).

## Not done / decisions
- The hut is **not refused** by the placement tool when water is more than 3 tiles away; it is placed and closed with the reason above (a placement-env water query would touch `PlacementRules`; the inspector and the closed reason say it clearly).
- Anglers' "reviews about stock and noise" are the hut inspector lines (stock % per water, "noisy tour base within earshot") and the Advisor warning; there is no per-guest review system in the game.
- Guests do not walk to the pier tile: they are "using" the hut and drawn at its places (the same view-only approach as the boat rental / rink).

## Tests
`tests/sim/nature/fishStock.test.ts` (dynamics, regrowth, bodies, reach, places, save), `tests/sim/attractions/angling.test.ts` (open / closed, capacity, extras, keep vs release, ice, noise), `tests/sim/guests/angler.test.ts` (type gating and season shares), `tests/game/angling.test.ts` (a real resort: tracking, save / load vs control, ice, anglers arrive only with a hut).
