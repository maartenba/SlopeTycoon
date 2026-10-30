# Climbing crag (Phase 6 Task 23)

A summer adventure attraction at the foot of a natural rock face. The wall is the real rock on the map; the building is the base hut.

| | |
|---|---|
| Building | `crag`, 2x2, recreation, $4,500, upkeep $14 / day, 1 instructor (optional), 8 places (`config/buildings.ts`) |
| Unlock | Career level 2 (selective; no goal, tutorial step or advisor rule mentions it, a test greps for that) |
| Site rule | **`SiteRule.nearRock`** = `{ minTiles: 3, radius: 3, minSpread: 2 }`: at least 3 *cliff tiles* within 3 tiles of the footprint. A cliff tile is a bare **Rock** tile whose four corners spread >= 2 half-steps (a full 45 degree face, the steepest tile the grid can hold). Pure helper `world/Cliffs.ts` (`isCliffTile`, `cliffFaces`, `countCliffs`) shared by the placement rule, the view, the tests and the scan. Refused with *Needs a steep rock face nearby* (hint: how many are there); accepted placements say *Rock face in reach (N steep rock tiles)* |
| Footprint | slope <= 2 half-steps, auto-flatten optional, never on bare rock itself (the hut sits at the foot) |
| Access | `trail`, alt `path` (a remote crag; the hut is inactive without it, like every attraction) |
| Ticket | $30 (`PRICE_TABLE.crag`, max $60) |
| Season | summer only: `seasonOpen: ['summer']` ("Closed for the season") plus the catalog `snowFree` need ("Closed: snow cover at ...") |
| Guests | 8 at a time, 6-tick climbs (`CLIMB.serviceTicks`), appeal [solo .8, couple .45, family .12, VIP .15, budget .3, adventure 1]; effects fatigue +.12, happiness +.2 |
| Instructor | **optional**: `spec.optionalStaff`. With the instructor (default) full capacity, mishap chance 0.4 %; with none the crag stays open at **half capacity** (`CLIMB.unguidedShare`) and the chance is 1.2 %. The inspector says which ("Guided climbs: an instructor is on duty" / "No instructor: half capacity, more mishaps") |
| Skill gate | none: the appeal vector already keeps families and VIPs away, and every climb is roped |

## Mishaps (minor incidents only)

A finished climb rolls a **stateless** hash of (crag, guest, tick) (`mishapRoll`: no Rng stream is drawn, nothing is saved, same inputs = same result). On a hit `createSim` reports a **minor injury incident** through the normal `Incidents` system (`safety.incidents.report('injury', ..., Sev.Minor, guestId)`) at the base. Consequences:

* A Ski Patrol Hub / First-Aid Hut in range answers it like any other incident, treatment takes a couple of ticks, the climber **recovers** and goes on with the day (test: seed 5, a crag inside the hub's range).
* Out of patrol range, or with no rescue building, it follows the existing neglect timeline (minor -> major -> critical -> hospital, flagged as a severe case for the safety rating). It never ends worse than a hospital stay; **nobody dies** (the incident system has no such outcome) and the crag cannot cause a severe injury by itself.
* The crag counts the call-outs (`stats.mishaps`, saved with the attraction, absent otherwise): the inspector shows "N minor mishaps so far (the patrol helps)".
* The advisor does not know the crag. A crag outside patrol range is not flagged (kept out of scope: goals and advisor must not require it).

## View

* **Mesh** (`render/meshes/buildings/climbing.ts`, ~950 triangles): timber hut with a pitched roof and a "CRAG" sign, a gear rack with coiled red / yellow / blue ropes and helmets, a little practice boulder with coloured holds (the man-made option), a crash pad, an anchor post with a rope, a chalk bucket and a bench.
* **Climbers** (`render/CragClimbers.ts`, 2 instanced draw calls, view only): every climbing guest of an open crag (up to 6 per crag, 36 on the map) is drawn as a small helmeted figure with raised arms on a well-spaced cliff tile in reach, leaning into the rock and moving up and down it (a slow triangle wave per climber) on a thin orange rope to the anchor at the top of the face. Hidden when the camera is far out (follows `AttractionActivity.far`); the faces are re-derived every 480 ticks.

## Availability scan

`npx vite-node scripts/analysis/cragScan.ts [seeds] [sizes]` counts valid crag sites by the real placement rules (auto-flatten on) and whether a footpath can reach them. Default seeds 61 / 7 / 5:

| size | seed | cliff tiles | rock-adjacent spots | **valid crag spots** | footpath reaches (sampled) |
|---|---|---|---|---|---|
| 64 | 61 | 82 | 271 | **165** | 43 / 43 |
| 64 | 7 | 86 | 157 | **95** | 34 / 34 |
| 64 | 5 | 242 | 710 | **323** | 60 / 60 |
| 128 | 61 | 530 | 1057 | **505** | 60 / 60 |
| 128 | 7 | 362 | 1317 | **638** | 60 / 60 |
| 128 | 5 | 901 | 2152 | **801** | 60 / 60 |
| 256 | 61 | 2249 | 4134 | **1439** | 60 / 60 |
| 256 | 7 | 1079 | 3775 | **1873** | 60 / 60 |
| 256 | 5 | 2671 | 7166 | **2479** | 60 / 60 |

## Tests

`tests/sim/attractions/climbing.test.ts` (data; rock-face helper; the placement rule refuses a meadow, accepts the foot of a cliff, is level-gated; in the sim: $30 per climb and the inspector line, winter closure, optional instructor / half capacity, stateless mishap rolls, a forced mishap opens a *minor* injury incident that is always resolved, a patrolled crag recovers its climber, determinism; availability on seeds 61 / 7 / 5). `tests/render/cragClimbers.test.ts` (climbers on cliff tiles, caps, motion, hidden when far / closed).

## Re-recorded on purpose

Only the `progression` golden part of `tests/sim/staff.test.ts` moved (the unlock snapshot gained `building:crag` at level 2). Without a crag nothing changes: the stats field is absent, no incident is reported, the view draws nothing.
