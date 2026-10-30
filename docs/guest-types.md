# Guest types (framework)

Phase 6, Task 9. Six **core** types (solo, couple, family, vip, budget, adventure; indices 0-5) keep their hand-tuned tables. **Extra** types (index 6+) are data rows in `src/config/guestTypes.ts` (`GUEST_TYPE_DEFS`), so Snowboarder, Mountain biker, Senior, Ski tourer, School group and Angler arrive as data plus a few hooks. The shipped list is `SHIPPED_TYPES` (never reorder, append only): **6 = Mountain biker** (Task 25), **7 = Angler** (Task 42). Types that become active move the golden hashes (re-recorded at the milestone STOP).

## A type row (`GuestTypeDef`)
| Field | Meaning |
|---|---|
| `id`, `label` | stable key, inspector / legend name |
| `seasons` | relative arrival weight per season, same units as `TYPE_MIX` (core weights sum to 1); missing = never |
| `minLevel` | Career resort level (Sandbox counts as max) |
| `requires` | any-of building ids that must be placed **and active** |
| `fallback` | core type it behaves like (`coreOf`: hiking preference, evening bias, patience, trail goals, skill, appeal column) |
| `segment` | marketing segment (campaign weights, price elasticity, arrival log); default = `fallback` |
| `weather` | arrival multiplier per weather kind |
| `appeal` | appeal per attraction `kind` or building id; wins over the fallback column |
| `group`, `budget`, `overnight`, `skill` | numbers that default to the fallback type's |
| `look` | `top` cloth colour index, `colour` (impostor / legend), `gear` (`ski` / `board`, replaces the ~30 % boarder cosmetic), `outfit` (forced) |

## Spawning
`Spawner.typesV2` is **always on** in `createSim` (the `guestTypesV2` option was removed; unit tests may toggle `sim.guestSim.spawner.typesV2` directly) and enables extras. The spawner **always** makes the core draw first, so `state.rng` stays aligned. Then a separate hash stream (day, tick, group counter: no state, nothing to save) decides whether the arrival is an extra type: `P(extra i) = w_i / (coreTotal + sum w)`, where `w_i` = season share x weather x scenario `mixBias` x marketing segment weight x price elasticity of the segment, and 0 when the level or required building is missing. Extras therefore take part of the mix and do not raise the arrival rate. Old saves load unchanged (types >= 6 appear only after load).

## Appeal
`appealFor(spec, buildingId, type)`: core types read `spec.appeal[type]` exactly as before. Extras read their `appeal[buildingId]`, then `appeal[spec.kind]`, then the fallback core column. The 6-tuples in the attraction specs are not touched.

## UI and render
- Inspector: core types keep their lower-case key, extras show their label.
- Statistics (`I`): a "Guests by type" card (live count, share, happiness; extras are always listed once defined, core types only when present). `guestTypeBreakdown(store)`.
- Render: `typeGearOf`, `typeOutfitOf`, `top` and `colour` hooks in `guestAppearance.ts` / `GuestRenderer`.

## Adding a type later
1. Append a row to `GUEST_TYPE_DEFS` (index = 6 + position; **never reorder**: the saved SoA stores the index).
2. Add specific attraction appeal under `appeal` if the fallback column is not right.
3. If behaviour differs from the fallback (e.g. snowboarders and flats), add a `coreOf`-style hook at that single decision site.
4. Re-record goldens in that milestone's STOP task (the framework is already live; the list is empty today so it is a no-op), add tests.

## Shipped extra types
| Index | Id | Seasons | Gate | Notes |
|---|---|---|---|---|
| 6 | `mtb` Mountain biker | summer 0.18 (~15 % of the summer arrivals) | level 1; `requires: ['@mtbBikeLift']` | segment adventure (Hike & Bike Weekends, Summer Adventure); `pref: [5, 88]` (hike %, bike %: nearly always the MTB trails); appeal adventure park 1.3, rental 0.9, bars / restaurants 0.7-0.8; look: lime top, helmet in every season, forced summer outfit; rain x0.4 |

| 7 | `angler` Angler | summer 0.10, spring / autumn 0.05, winter 0.06 only with `ICE_FISHING` | level 2; `requires: ['@fishing']` | segment solo; calm, low spend, long dwell at the Tackle & bait hut (`docs/anglers.md`); appeal tackle hut 1.5, beach .7, boats .6, restaurant .7; cap + teal jacket; hates noise (a motorised tour base within 14 tiles of the hut spoils the visit) |

`requires` also accepts **pseudo ids** computed by the spawner from the world (`Spawner.flagsFn`, wired in `createSim`): `@mtbBikeLift` = the decider knows a rideable MTB trail tile AND at least one open lift that `carriesBikes`; `@fishing` = an open Tackle & bait hut with a fishable water in reach that still has fish (> 5 % stock). `GuestTypeDef.pref` overrides the hike / bike activity split in `prefFor`; `look.helmet` / `look.hat` / `look.rod` are the head-wear and prop hooks.
