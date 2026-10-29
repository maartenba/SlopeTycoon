# Petting zoo (Phase 6, Task 20)

A **standalone** (decision D-P6: no farm needed) 3 x 3 summer family attraction: a fenced pen with a shed, a trough and a feed station; goats, sheep, rabbits and a donkey wander inside it.

| | |
|---|---|
| Catalog | `pettingZoo`, category recreation, 3 x 3, $3,000, upkeep $10/day, 1 keeper, capacity 20, level 1 |
| Access | footpath (or road), nothing else (families with strollers); reason "Needs a footpath or road next to it" |
| Site | gentle slope (<= 2), flatten optional, not on pistes |
| Spec | `PETTING_ZOO_SPECS` (`sim/attractions/PettingZoo.ts`): kind `zoo`, 20 slots, service 6 ticks (36 min), +0.12 mood, `seasonOpen ['summer']`; the catalog need `snowFree` closes it under snow |
| Ticket | **$8** (`PRICE_TABLE.pettingZoo`, cap $25, per use, ledger recreation); the price slider and the Pricing panel work like any attraction |
| Appeal | family **0.8**, couple 0.55, budget 0.4, solo / VIP 0.3, adventure 0.1 |

Closed with "Closed for the season" outside summer and "Closed: no staff" without its keeper (understaffed = reduced capacity, as for every attraction).

## The animals (display only)
`render/PettingZooView.ts` draws `ZOO_ANIMALS` = 2 goats, 2 sheep, 3 rabbits, 1 donkey per **open** pen (4 instanced draw calls for all pens; cap 64 per kind), only between 07:00 and 20:00 (they sleep in the shed) and only below a view height of 70 tiles. Goat and sheep reuse the nature meshes (`NATURE_GEOMETRY`); `createRabbitGeometry` and `createDonkeyGeometry` (`meshes/Animals.ts`) are new and used by the zoo only (not nature species, so Livestock / Fauna are untouched).
`zooPose(seed, i, t)` is a **pure function**: every animal walks to a seeded waypoint (smoothstep) and then stands / grazes, always inside `ZOO_PEN`; nothing is stored, nothing is saved or hashed, no RNG is drawn. The pen's world mapping uses the building group's matrix, so rotation and terrain height are right.

Not done (kept simple on purpose): a feeding mechanic (feed bucket is scenery), a petting-zoo advisor rule, animals reacting to guests.

## Tests
`tests/sim/attractions/pettingZoo.test.ts`: catalog row and access, family appeal 0.8, summer service and revenue ($8 into recreation), winter closure, no keeper, determinism, a real summer resort (opens, serves, determinism, save / load), poses inside the pen over 10 minutes, the view (8 animals, none when closed / night / far, cap), mesh budget.
