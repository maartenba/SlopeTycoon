# Trail access and remote supply (Phase 6, Tasks 2-3)

## `trail` access kind
`AccessKind 'trail'` (`src/config/buildings.ts`): the footprint, or a tile 4-adjacent to it, is a Hike or MTB trail tile of an **attached** trail component.

* **Attached** (`Networks.trailMask()`, cached per network version): the 8-connected Hike|MTB component touches a footpath or road of the walk network from the road entry (4-neighbour or on it), or touches a lift. A trail island nobody can walk to serves nothing. Trail tiles over a stream (bridge) count as trail like any other.
* Backcountry layer (M6.5) is not in the game yet: add it to the `Hike | Mtb` mask in `trailMask()` when it lands.
* Reason text from `accessReason`: nouns in rule order, then **hiking trail**, then **piste** last: `Needs a footpath, road, hiking trail or piste next to it`. `isAccessReason` matches `trail`.
* Pathing: a hike-mode guest reaches the trail tile beside the building through the normal NavGraph (Hike mode over Hike tiles, snow-free); skiers reach a trail-served building only from an adjacent piste (`tests/sim/guests/TrailAccessNav.test.ts`).

## Remote-supply upkeep (D-P9)
`REMOTE_SUPPLY_MULT = 1.25` (`config/balance.ts`). A building pays +25% upkeep when its access holds **only** through `trail` / `pisteEdge`: no footpath or road touches the footprint (`PlacementRules.suppliedOnFootOnly`, `Networks.suppliedOnFootOnly(id)`). Remote types (`access: 'none'`), unserved (inactive) buildings and rail+path never qualify. Applied in `createSim` `finance.costs` on top of the closed / mothball share. The inspector shows `Supplied on foot: +25% upkeep`.
It is on by default (`createSim({ remoteSupply: false })` opts out; only the title demo does), so headless sims / tests / goldens see the same +25% as the game.

## Approved rows (Task 3)
| Building | access now |
|---|---|
| Mountain Hut | pisteEdge, path, **trail** |
| Café | path, pisteEdge |
| Ranger Station (stays ungated) | road, path, **trail** |
| Stunt Park | path, pisteEdge |
| Adventure Park | path, **trail** |
| Alpine Farm | path, road, **trail** |
| Shop / Chalet / Apartment | path (a road counts): unchanged (NEW-c) |
| Hotels, lodges, depots, parking, garages, Altiport | road only |

Tests: `tests/sim/trailAccess.test.ts`, `tests/sim/guests/TrailAccessNav.test.ts`.
