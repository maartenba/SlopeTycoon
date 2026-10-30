# Guest types (framework)

Phase 6, Task 9. Six **core** types (solo, couple, family, vip, budget, adventure; indices 0-5) keep their hand-tuned tables. **Extra** types (index 6+) are data rows in `src/config/guestTypes.ts` (`GUEST_TYPE_DEFS`), so Snowboarder, Mountain biker, Senior, Ski tourer, School group and Angler arrive as data plus a few hooks. The shipped list is `SHIPPED_TYPES` (never reorder, append only): **6 = Mountain biker** (Task 25), **7 = Angler** (Task 42), **8 = Senior**, **9 = School group** (Task 29). Types that become active move the golden hashes (re-recorded at the milestone STOP).

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
| `when`, `dayMult`, `requiresIn` | calendar gate (function of `ActiveCtx`: weekday 0 = Monday, real month, day of month, holiday), arrival multiplier on weekdays / weekends, and a per-season `requires` (Task 29) |
| `needs`, `maxSkill`, `viewBonus`, `foodPrefer`, `eatBonus` | behaviour hooks of the extra types: need growth multipliers (`fatigue`, `urge`), skill cap, viewpoint goal bonus multiplier, preferred venues for a meal and an extra 'eat' score (Task 29) |
| `kidGroup` | arrives as a supervised kids group (`adults` + children) run by the Families system (School group) |
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

`requires` also accepts **pseudo ids** computed by the spawner from the world (`Spawner.flagsFn`, wired in `createSim`): `@mtbBikeLift` = the decider knows a rideable MTB trail tile AND at least one open lift that `carriesBikes`; `@fishing` = an open Tackle & bait hut with a fishable water in reach that still has fish (> 5 % stock). `GuestTypeDef.pref` overrides the hike / bike activity split in `prefFor`; `look.helmet` / `look.hat` / `look.rod` are the head-wear and prop hooks; `look.age` (+ `ageShare`) forces an age class (Senior = grey / white hair).

**Look share** (`TypeLook.topShare`, default 0.45 like the core types): the share of a type's guests that wear its `top` colour. Mountain bikers use 0.85 (lime + always a helmet) and anglers 0.8 (teal + cap) so the small niche types read in a crowd (`tests/render/nicheTypeLook.test.ts`).

## Senior and School group (Phase 6 Task 29)
| Index | Id | Seasons | Gate | Notes |
|---|---|---|---|---|
| 8 | `senior` Senior | winter 0.05, spring 0.05, summer 0.04, autumn 0.06; weekdays x1.4, weekends x0.7 | level 2; `requires: ['heatedTerrace', 'cafe', 'toilets']` (any-of: somewhere to sit or relieve themselves) | segment **couple**; 1-2 people, budget $350-650, overnight 55 %; fatigue grows x1.5 and the comfort urge x2 (`needs`, `Needs.tickNeeds`; core types read exactly the old numbers); skill cap intermediate (`maxSkill` 1: `Skill.recordRun` / `addLessonXp` stop at 1, so `maxDifficultyFor` <= 2 = red, **never a black run**); hikes only 25 % of the time and then loves a view (`viewBonus` 1.5 on the viewpoint goal bonus); a meal goes to a **Heated Terrace or Café** when one is open (`foodPrefer`, even if a restaurant is closer) and a coffee stop even without hunger (`eatBonus` 0.35); appeal terrace 1.5, café 1.4, restaurant 1.0, **`pool` 1.5** (any lodging with the pool amenity, read through `AttractionSpec.amenity` in `appealFor`), lodging 0.9, tour 1.3 (sleigh / tours, M6.5), kids venues, adventure and stunt parks near 0; look: grey / white hair (`look.age` 3 for 90 %), brown cardigans (60 %) |
| 9 | `school` School group | winter 0.02, summer 0.015 (per arrival; a class is 9-16 people, so ~5-6 % of the guests) | level 2; winter `requiresIn`: Ski School HQ, Kids Ground or Magic Carpet; summer: Playground, Petting Zoo or Campground | segment **budget**; **weekdays only, never on a public holiday** (`HOLIDAYS`), only **1-8 December and January** in winter plus summer weekdays (`when`; the real 7-day week of `weekdayOf`); 1 teacher + 8-15 children, arrive by **coach** (`VehicleKind.Bus`, or by train), budget $70-130 per head, no overnight; matching **orange bibs** on everybody (`topShare` 1) |

**School groups use the Families path.** `Families.register` treats a `kidGroup` type like a family with `adults` parents (the lowest id is the teacher) and every other member a child (no `maxKids` of 3; the kids' skill is reset to beginner like family kids). The leader walks the class to a kids venue (Ski School HQ, Kids Ground, Playground, **Petting Zoo** (new kids venue kind, summer, capacity 20, also used by ordinary families), childcare), the kids are glued to the teacher otherwise, lunch together, home together. A big class is enrolled in **batches of 6** (`LESSON_BATCH`) so a Ski School with its default two instructors (8 places) can teach it; the family counts a lesson as done when the last batch finishes (`SkiSchool.pending`). Groups are guests like any others: they take guest slots, so the `store.capacity` cap throttles a coach that does not fit (its riders become `overflow`), and the perf test `tests/sim/guests/seniorSchoolPerf.test.ts` runs the cap with a third of the crowd as classes / seniors (about 1 ms/tick at 64-256).
**Gotchas**: `Spawner.maybeExtra` now passes the calendar (`weekday`, `month`, `dom`, `holiday`) in `ActiveCtx`; a context without it fails a `when` gate. `weekdayOf` depends on the game year (`(year x 180 + day) % 7`), so tests must set `date.year` before picking a weekday. Seniors count under the `couple` segment, classes under `budget` (docs/marketing-pricing.md). Campaigns: Wellness & Views, School Trips (and Come by Train / Family Summer Camp reach them through `extraTargets`).
**Golden tests that move** (types ship ON, only a resort with the gates changes arrivals): see the Task 29 note in `docs/balance.md` (the M6.4 STOP re-records them).
