# Phase 6 status (content wave, 0.2.2 - 0.3.0)

Version 0.3.0 (pre-release, never 1.0 until the owner says so). The plan is local (`.weave/plans/slope-tycoon-phase6-content.md`, git-ignored); this file is the committed summary. Every item below ships ON with no flag (player-driven content), except where noted.

## What shipped per milestone

| Milestone | Version | Tasks | Shipped | Dev docs |
|---|---|---|---|---|
| M6.0 | 0.2.2 | 1, 48, 50 | Splash loading indicator; real calendar + HUD date chip + Events dates (`formatGameDate`); first marketing campaigns v2 (Come by Train, Snowboard Park Jam, Hike & Bike Weekends, Festival Season) | `time-flow.md` s10-11, `marketing-pricing.md` |
| M6.1 | 0.2.3 | 2-11, 45 | `trail` access + remote supply; lodging tiers; tour system + viewpoint system (inert frameworks); comfort need + Toilets + Facilities rating facet; guest-type framework; rail level crossings; footbridge over rail; bridges v1 (footbridge, hiking, MTB, road) | `trails-access.md`, `lodging.md`, `tours.md`, `viewpoints.md`, `comfort.md`, `rating.md`, `guest-types.md`, `crossings.md`, `bridges.md` |
| M6.2 | 0.2.6 | 13-17, 44, 46 (+ 36-39, 47 from M6.6) | Rivers: dig / place spring / fill in, natural springs, flow classes, rapids foam, winter ice; bridges over dug rivers + suspension footbridge; the mid-station lifts and `chair6d` shipped in the same release | `rivers.md`, `bridges.md`, `mid-stations.md` |
| M6.3 | 0.2.7 | 19-25, 42, 49, 51 | Campground, petting zoo, viewpoint + treehouse, quad base, climbing crag, rafting + canyoning, tackle hut + piers + fish stock + ice fishing, Mountain biker + Angler guests, Family Summer Camp + Angler's Paradise | `campground.md`, `petting-zoo.md`, `viewpoints.md`, `quads.md`, `climbing.md`, `water-tours.md`, `anglers.md`, `guest-types.md` |
| M6.4 | 0.2.8 | 27-29, 52 | Small + Luxury Hotel with a steaming pool, Coffee Stand (decision points and mid-run stops), Senior + School group guests, Wellness & Views + School Trips | `hotels.md`, `coffee-stand.md`, `guest-types.md`, `marketing-pricing.md` |
| M6.5 | 0.2.9 | 31-35, 53 | Sleigh Stable, Snowshoe Hut, Snowscooter Base, backcountry routes with danger 1-5, Snowboarder + Ski tourer guests, Powder Hounds | `winter-tours.md`, `backcountry.md`, `guest-types.md` |
| M6.6 | 0.2.6 | 36-40, 47 | N-station lifts (mid-stations on gondolas / cable cars / detachable chairs), per-segment validation, capacity and queues, `chair6d` | `mid-stations.md`, `lifts-clearance.md` |
| M6.7 | 0.3.0 | 41, 43 | Mountain Concert (1-10 Sep) + Snow Concert (1-15 Mar) alongside the Summer Music Festival: stage, truss, light cones, gondola / cable car prerequisite, quiet crowd bed, Rudi hint | `festivals.md`, `audio.md` |

## Task table (plan numbers 1-53)

| Task | Status |
|---|---|
| 1 splash loader | built |
| 2-11 trail access, lodging v2, tours, viewpoints, comfort, facet, guest-type framework, crossings, footbridge | built |
| 12 M6.1 STOP | agent batch done (0.2.3); owner playtest pending |
| 13-17 rivers (model, tool, flow, render, ice) | built |
| 18 M6.2 STOP | agent batch done (0.2.6); owner playtest pending |
| 19-25 campground, petting zoo, viewpoint/treehouse, quads, climbing, water tours, MTB type | built |
| 26 M6.3 STOP | agent batch done (0.2.7); owner playtest pending |
| 27-29 hotels, coffee stand, Senior + School | built |
| 30 M6.4 STOP | agent batch done (0.2.8); owner playtest pending |
| 31-34 winter tours, backcountry + avalanche, Snowboarder, Ski tourer | built |
| 35 M6.5 STOP | agent batch done (0.2.9); owner playtest pending |
| 36-39 lift stations model, validation, capacity + NavGraph, mid-station UX | built |
| 40 M6.6 STOP | agent batch done (0.2.6); owner playtest pending |
| 41 mountain concerts | built |
| 42 angler type, 44 spring sites, 45-46 bridges, 47 `chair6d`, 48 date chip, 49 tackle hut, 50-53 campaigns | built |
| 43 M6.7 STOP | prep done (this batch, `docs/playtest-m66.md`); the owner's playtest and approval remain |

## Deferred / not built (and why)

| Item | Why |
|---|---|
| Snowboarder "rental board stock" counter | Boarders own a board less often (`BOARD_OWNER`) and use normal rental; a separate stock was not needed for the economy |
| Senior guests walking slower | The type drives appeal, spend and calendar (weekdays), not a movement speed; changing walk speed would touch the shared nav kernel and goldens |
| Petting zoo feeding mechanic, advisor rule, animals reacting to guests | Kept simple on purpose (`petting-zoo.md`) |
| Ride-along alighting at mid-stations | The follow continues as a skier after the guest alights; the rider is not asked where to get off (`mid-stations.md`) |
| Night lights on mid-station lamps | Lamp-coloured geometry only (`mid-stations.md`) |
| Walk mode / ride-along on footbridge stairs and bank ramps | Walk mode follows deck height but was not verified on stairs (`bridges.md`, `playtest-m61.md`) |
| Road overpass over rail, rail bridges, raft clearance under river bridges | By design / not needed in v1 (`crossings.md`, `bridges.md`) |
| Tackle hut refusal beyond 3 tiles from water; guests walking to the pier; per-guest angler reviews | Closed reason + inspector line instead (`anglers.md`) |
| Planned goals and achievements ("Green travel", "A summer night", "Dig your first river", "Two pistes, one gondola", "Scenic route", "Hot springs", "Source to sea") | Not built; the plan marked them optional, none gates a chapter |
| Train timetable / second station upgrade for Come by Train | Follow-up (OQ-4: capacity-based in v1) |
| Verification on a real GPU, by ear, and on a real touch device | Agents have no GPU / audio / device; see `playtest-m66.md` |

## Known gaps

- Cosmetic: thin snowshoe poles at the default zoom; shaded snow roofs read slightly lavender (the game's snow shading).
- Skiers decide only at lift bottoms, piste ends and buildings, except the mid-run coffee stop.
- Concerts are view-only dressing (no new guest behaviour), run only with `autoEvents`, and need a gondola or cable car.
- Piste painted over a stream: a pre-existing open bug (the river tool refuses its own overlaps, the piste tool does not check streams).
- The bot builds none of the Phase 6 buildings, so the balance goldens show the guest-type effects only (`docs/balance.md`).

## Owner decisions answered

- OQ-1 winter concert month: the owner said March; in the real calendar March is a **winter** month (Dec-Mar), so the Snow Concert starts 1-15 March (`festivals.md`).
- Summer concert: first free days after the Music Festival, 1-10 September.
- OQ-2 ice fishing: ON (`anglers.md`). Coffee stand: skiers stop mid-run (0.2.8 follow-up). Couples may take luxury suites (0.2.8). Everything ships ON, no flags. Danger 4 closes a route and nobody ever dies (D-P3). Snowboarders are a conversion of the core draw (D-P4).
- Still open for the owner: the questions at the end of each `playtest-m6x.md` (economy of the bot after boarders, danger pacing, tourer volume, summer revenue share 21-25 % against the plan's 25 %).

## Where things live

Player docs: `site/guide/` (Summer, Quads / climbing / rafting / fishing, Hotels, Seniors & school trips, Sleighs / snowshoes / snowscooters, Backcountry, Rails & bridges, Events, Lifts & pistes). Playtest checklists: `playtest-m61.md` ... `playtest-m66.md`. Numbers per release: `release.md`, `balance.md`.
