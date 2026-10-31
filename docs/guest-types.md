# Guest types (framework)

Phase 6, Task 9. Six **core** types (solo, couple, family, vip, budget, adventure; indices 0-5) keep their hand-tuned tables. **Extra** types (index 6+) are data rows in `src/config/guestTypes.ts` (`GUEST_TYPE_DEFS`), so Snowboarder, Mountain biker, Senior, Ski tourer, School group and Angler arrive as data plus a few hooks. The shipped list is `SHIPPED_TYPES` (never reorder, append only): **6 = Mountain biker** (Task 25), **7 = Angler** (Task 42), **8 = Senior**, **9 = School group** (Task 29), **10 = Snowboarder** (Task 33), **11 = Ski tourer** (Task 34). Types that become active move the golden hashes (re-recorded at the milestone STOP).

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
| `convert`, `flats`, `tourer` | Snowboarder (Task 33): carve the type OUT of the core draw (`from` core types, `share` per season) instead of adding weight; dislikes flats / catwalks (`flatHit`, `flatPick`, `widePick`); Ski tourer (Task 34): uses backcountry routes, never at danger >= 4 |
| `kidGroup` | arrives as a supervised kids group (`adults` + children) run by the Families system (School group) |
| `look` | `beanie` (share in a beanie in winter), `pack` (always a backpack), `top` cloth colour index, `colour` (impostor / legend), `gear` (`ski` / `board`, replaces the ~30 % boarder cosmetic), `outfit` (forced) |

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

## School classes and safety (M6.4 STOP investigation)
The year-2 incidents of the 64 / seed 21 `yearReport` resort went 8 -> 18 after the Senior and School types shipped; the guess was the classes. **Measured** with `npx vite-node scripts/analysis/incidentsByType.ts 360 <size> <seeds>` (bot resort, per guest type arrivals vs `incident:injury`):

| Run | school | family | couple | budget | solo | senior | vip | adventure |
|---|---|---|---|---|---|---|---|---|
| 64 / seeds 21,5,7, 360 d: injuries / guests (per 1000) | 0 / 275 (**0**) | 21 / 7582 (2.8) | 21 / 1994 (10.5) | 26 / 3569 (7.3) | 9 / 1044 (8.6) | 2 / 348 (5.7) | 4 / 338 (11.8) | 8 / 1986 (4.0) |
| 128 / seeds 5,7,61, 360 d | 0 / 256 (**0**) | 3 / 9214 (0.3) | 6 / 2564 (2.3) | 12 / 4172 (2.9) | 4 / 1294 (3.1) | 2 / 435 (4.6) | 0 / 504 (0) | 2 / 2442 (0.8) |

Finding: **school classes cause no injuries at all**. Children (and the teacher glued to them) are driven by the Families system (`families.controls`), never run `finishRun`, so there is no injury roll; they stay at the kids venue (Ski School, Kids Ground, Playground, Petting Zoo) with beginner skill, taught in batches of 6 and supervised by the teacher. The target "school incident rate <= families' rate" is met with 0 vs 2.8 / 0.3 per 1000, so **no risk code was changed**. The 8 -> 18 on one resort was the shifted arrival draw (more couples / solos / budget guests in the injury-prone ski population), not the classes; the safety-award drop on that single resort is noise of the same kind. Before / after numbers are equal by construction (nothing changed). Seniors (4.6-5.7 per 1000) sit between families and couples; no change.

## Snowboarder and Ski tourer (Phase 6 Tasks 33 + 34)
| Index | Id | Seasons | Gate | Notes |
|---|---|---|---|---|
| 10 | `snowboarder` Snowboarder | **carved out of the core draw** (`convert`): of solo / couple / budget / adventure arrivals 42 % in winter, 40 % in spring, 37.5 % in autumn become snowboarders (about 30 % of all arrivals in winter, like the old cosmetic ~30 % `BOARDER_SHARE`), none in summer | level 1, no building needed | segment adventure, fallback adventure; budget $160-330, group 1-3, pref [3 hike, 4 bike]; appeal stunt park 1.5, rental .7, bar .7; look: purple tops (55 %), beanies over helmets (70 % in winter), a board |
| 11 | `tourer` Ski tourer | winter 0.04, spring 0.025 | level 2; `requires: ['@backcountryRoute']` = an open backcountry route with danger < 4 | segment adventure, fallback adventure; budget $100-190 (low spend), skill mostly advanced / expert; appeal mountain hut 1.5, cafe .6, restaurant .5, the rest low; look: red shell (85 %), always a backpack, skis |

**Snowboarder = a conversion, not an addition.** Every arrival's core draw (and the `state.rng` stream) happens exactly as before; then `Spawner.convertCore` turns a core arrival of a `convert.from` type into the snowboarder with probability `convert.share[season]` x `mixBias` x campaign `types` multiplier (own stateless hash stream, nothing saved). So the volume does not move; Snowboard Park Jam / Powder Hounds raise the share. Families and VIPs are never converted. Segment `adventure` for the campaign log.
- **Flats and catwalks** (`GuestTypeDef.flats`): `Decider.refresh` caches per nav epoch (like the descent queries) the **shape** of the cheapest ski route top -> bottom of every lift per difficulty (`routeShape`): *flat share* = piste tiles in stretches of >= `FLATS.minRun` (4) consecutive tiles with a drop below `FLATS.drop` (0.04 world units) / piste tiles of the route, *width* = mean share of piste tiles among the 8 neighbours. `pickSkiLift` scores a boarder's lift as `- flatPick (1.4) x flat + widePick (0.4) x width`, so catwalk-heavy runs lose and wide runs win; `finishRun` takes `flatHit` (0.1) x the flat share off the happiness (at most 0.1, small). Skiers read none of it (`undefined` hook, bit for bit).
- **Park and rental**: the Stunt Park appeal comes from the row (`appeal.stunt` 1.5 beats every core column), so the park fills with the boarder share. Boarders own a board less often (`BOARD_OWNERS` 55 % vs 82 % skis, `Rental.ownsGear(id, 'board')`; `AttractionSystem.needsGear` reads the type), so the Rental sees them more.
- **Render**: the type's `look.gear = 'board'` decides the board; `isBoarder` (cosmetic 30 %) stays as the **fallback for guests of saves from before this version** only: `Spawner` saves `legacyBelow` (0 in new games; a save without the field resolves to the next guest id at load) and `GuestRenderer.legacyBoarderBelow` gives guests with an id at or above it skis when their type has no gear. New look hooks: `look.beanie` (share in a beanie instead of a helmet in winter), `look.pack` (always a backpack).

**Ski tourer** uses the backcountry layer through `Touring` (`sim/guests/Tourer.ts`, attached by `createSim`: `routes` / `openRoutes` / `dangerOf` / `isOpen` / `routeTiles` of `sim.backcountry`). `Touring.safeRoutes()` = open AND `danger < TOURER_MAX_DANGER` (4): the route's override that keeps it open at 4+ is ignored, so tourers neither spawn (`@backcountryRoute` flag) nor pick a goal on such a route. Goals = the summit plus a small sample of each safe route (`Decider.tourTiles`, refreshed every `refresh`); `TrailGoals.pick` takes them through `GoalCtx.only` (judged per start, never remembered as unreachable). Two ways up: **one lift, then up** (a tourer who alights at a lift top starts a tour with 70 % probability, `GuestSim.startTour`) or, when the route is on the foot network, straight from the base (a `hike` intent). The climb is Hike mode on **skinnable** tiles (`NavGraph.skinnable`: a snowy, open backcountry tile; 0.85 x the trail hiking speed, step cost 1.6 / tile), then the usual compressed-time excursion (back to where they started). A regular hiker's goals are never on a route. Limits: a tourer already on the route when its danger rises keeps going (the excursion is compressed time; the route closes for everyone else at 4); one lift ride is all they take.
**Golden tests that move** (the types ship ON): see docs/balance.md at the M6.5 STOP; this task re-records nothing. Moved so far: the type-dependent goldens (`staff` hashes, `yearReport`) and trajectory-sensitive bot checks (`summer` income comparison, `scenarioBots` Safe Slopes ends early on day 25, `seniorSchoolSim` window).

