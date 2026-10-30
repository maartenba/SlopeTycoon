# Campground (Phase 6, Task 19)

A budget, summer-only lodging built on the **Lodging v2** framework (`docs/lodging.md`): 16 tent and caravan pitches around a campfire. It is data plus two small hooks, nothing is special-cased in placement or guest code.

| | |
|---|---|
| Catalog | `campground`, category lodging (shown in the Recreation tab with the other summer buildings), 5 x 4, $3,500, upkeep $8/day, no staff, capacity 16, level 1 (never gated) |
| Access | footpath (or road), alt **hiking trail**; supplied only by trail = the +25 % remote-supply upkeep (`docs/trails-access.md`); reason "Needs a footpath, road or hiking trail next to it" |
| Site | gentle slope (<= 2), flatten optional, no rock restriction beyond the HUT rule, not on pistes |
| Spec | `LODGING_SPECS.campground`: `rooms 16`, `tier 'budget'`, `seasonOpen ['summer']`, `campfire true`, overnight guests only, rest -0.30, +0.06 mood |
| Rate | `NIGHTLY_RATE.campground = tieredNightly(chalet 40 / cap 150, 'budget')` = **$24 a night, cap $90**; Pricing key `night:campground` |
| Appeal | `tierAppeal([0.3, 0.4, 0.6, 0.1, 0.5, 0.7], 'budget')` = solo 0.3, couple 0.35, family 0.6, VIP 0, budget 0.8, adventure 0.7 |

## Seasonal opening
Outside summer the attraction is `open = false`, reason **"Closed for the season"**, nobody checks in. Two places used to count lodging capacity by catalog category only, so a closed campground would have kept 16 phantom rooms in winter: `Spawner` (overnight cap) and `gatherRatingInput` (amenities) now go through `takesGuestsIn(type, season)` (`sim/attractions/Lodging.ts`). Chalet, apartment and base lodge have no `seasonOpen` and always count.

## Who camps (check-in order)
`AttractionSystem.checkIn` used plain building-id order. While at least one **tiered** house exists the order is per guest type (`byPreference`): a tiered house the type likes (appeal >= `CAMP.likes` 0.65: budget, adventure) comes first, untiered houses next, then tiered houses the type is lukewarm about; a type with appeal 0 for it (the VIP after the budget shift) never takes it. Worlds without a tiered house keep the old order, so they are bit-identical.

## Campfire evening (`sim/attractions/Campground.ts`, `CAMP`)
From 19:00, once per evening (`lastGatherDay`; saved as `gather` **only** once a campfire has burned, so worlds without a campground hash exactly as before), every camper at an open campground gains happiness: `+0.05`, **`+0.09` with a toilet building within 10 tiles**, `+0.03` (a grumble) without one. The inspector shows "Pitches: n/16 tonight - toilets in reach / no toilets within 10 tiles". Stat `fires` counts the evenings.

## Look
`render/meshes/campground.ts`: a fire ring (8 stones, ash, crossed logs, three flames), 4 A-frame tents, 2 caravans, 4 log seats, a picnic table, firewood, a lantern post and a CAMP sign (about 1,450 triangles, budget 3,000; wood / roof / sign layers, no stone layer so the group stays within 4 meshes with the glow).
* **Night glow**: `BuildingMeshes` adds one shared additive disc mesh ("fireGlow": orange centre fading to black through vertex colours, no noise, no point light) whose opacity follows the night factor. World-space and static, so the flicker rules hold (`npm run flicker:building` style checks only see the building layers). Lantern bulbs and caravan windows are glass-coloured vertices: they glow with the existing window shader.
* **Smoke**: `Smoke.ts` kind `camp` (`BuildingDef.chimney` = tip of the tallest flame): evenings 18:30-22:30 (0.6) and a faint breakfast fire 06:30-08:30, scaled by overnight occupancy, **independent of the cold**, only in summer (`ctx.season`). Same single instanced draw call and 16-emitter cap as the chimney smoke.
* **Audio**: see "Audio" below.

## Audio
A `campfire` ambience layer (`audio/Ambience.ts`, ceiling 0.035: below the crickets 0.05, a sixth of the crowd 0.2): band-passed pink noise whose level pops irregularly (two unrelated fast sine LFOs, no gates, so no clicks), 8 nodes (the layer budget test is `< 200` nodes in total). `ambienceMix` plays it only while the fire burns (about 18:30-22:30, ramped), close in (`close^1.3`: gone when zoomed out), not in rain, and `WorldProbe` feeds `campfire` = proximity (14 tiles) to the nearest **open** campground (`ProbeDeps.campfires`, wired in `main.ts`). By ear on a real device: not verified (the harness cannot hear audio); the tests pin the levels (`tests/audio/campfire.test.ts`).

## Advisor
`summer.camp` (impact 1, info): in summer with >= 12 guests and a lodge, "Summer nights: a campground" with a build action next to the village; with a campground but no toilets within 10 tiles, "Campers want toilets" with a toilets site next to it. Show me goes to the site.

## Tests
`tests/sim/attractions/campground.test.ts` (catalog row, access path / trail + surcharge, 16 pitches + revenue, winter closure, preference order, campfire once per evening with / without toilets, inspector data, determinism, save marker, a real summer resort with save / load and the winter / summer round trip, smoke), advisor case in `tests/sim/advisor.test.ts`.
