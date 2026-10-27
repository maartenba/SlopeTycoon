# Guest types (framework)

Phase 6, Task 9. Six **core** types (solo, couple, family, vip, budget, adventure; indices 0-5) keep their hand-tuned tables. **Extra** types (index 6+) are data rows in `src/config/guestTypes.ts` (`GUEST_TYPE_DEFS`), so Snowboarder, Mountain biker, Senior, Ski tourer, School group and Angler arrive as data plus a few hooks. The table is **empty today**: no new type is active, and the golden hashes are unchanged.

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
`Spawner.typesV2` (`createSim({ guestTypesV2: true })`, default **off**) enables extras. The spawner **always** makes the core draw first, so `state.rng` stays aligned. Then a separate hash stream (day, tick, group counter: no state, nothing to save) decides whether the arrival is an extra type: `P(extra i) = w_i / (coreTotal + sum w)`, where `w_i` = season share x weather x scenario `mixBias` x marketing segment weight x price elasticity of the segment, and 0 when the level or required building is missing. Extras therefore take part of the mix and do not raise the arrival rate. Old saves load unchanged (types >= 6 appear only after load).

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
4. Turn `guestTypesV2` on for the game (`main.ts` option), re-record goldens in that milestone's STOP task, add tests.
