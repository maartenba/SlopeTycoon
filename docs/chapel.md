# Chapel and weddings (0.7.1)

A small building and one rare event. Config: `src/config/wedding.ts` (`CHAPEL`, `WEDDING`), catalog row `chapel` in `src/config/buildings.ts`, schedule + timeline `src/sim/events/Wedding.ts`, party figures `src/render/meshes/weddingParty.ts` + `src/render/WeddingView.ts`, mesh `src/render/meshes/buildings/chapel.ts`.

## The building

| | |
|---|---|
| Size / price / upkeep | 2 x 3, $4,200, $8 a day (cheap-to-mid: the Tourist Office is $3,500 / $12) |
| Unlock | resort level 2 (`UNLOCKS`), together with the Tourist Office and the Launch Ramp; no goal and no Advisor build action requires it |
| Access | footpath or road (`access: 'path'`, `altAccess: ['road']`); without it the chapel is inactive ("Not connected") and neither the charm nor the weddings apply |
| Site | level ground (max slope 2, auto-flatten default ON), not on a piste tile, not on water; `maxCount: 1` (one per resort) |
| Mesh | whitewashed nave with a shingled gable roof, a square bell tower with an open belfry (a bell inside), a pointed slate spire with a gilded ball and a cross, a clock disc, arched windows that glow at night (glass layer), a bench, three grave markers, two shrubs and a lantern on a gravel forecourt; 1,102 triangles; height 2.05 (`BUILDING_HEIGHT`). The door and the tower are on the front (+z); the mesh turns by `-rot x 90 degrees`, so the door side for rot 0..3 is south, west, north, east (`Wedding.doorDir`) |
| Rudi | `chapel.suggest` (a settled resort without one, once it is unlocked and affordable) and a one-line aside `chapel.wedding` while a party is out |

## Village charm

A connected chapel adds `CHAPEL.charm` = 0.06 to the 0..1 scenery value that feeds the Rating's scenery bonus (up to +2 rating points at 1.0): about +0.12 rating points at most, capped at 1.0 and counted once (`maxCount: 1`). There is no new rating facet.

## Weddings

- **Schedule** (`weddingPlan(seed, day)`): a pure function of (seed, absolute day). Only on **Saturdays** (the calendar's weekday 5), with a chance per Saturday of 45 % in summer, 20 % in spring and autumn, 8 % in winter: about 3 to 4 a year on average. The party sets out at 09:00 or 10:00 (seeded) and has 4 to 6 people (bride, groom, 2 to 4 guests). A day with a storm, heavy snow or rain is skipped; a chapel built after the set-out hour waits for the next Saturday.
- **Timeline** (absolute sim minutes, kept in one saved record): set out from the Base Lodge (or, when there is none within 40 tiles, down the lane in front of the chapel) -> walk to the **forecourt** in front of the door (0.16 tiles per game minute) -> wait for the next whole hour -> **bell** (2 strikes) -> the ceremony stands **120 minutes** at the door (couple in front, guests behind, all facing the chapel) -> **bell** again -> walk to the nearest lodge / cafe / pizzeria / Base Lodge within 40 tiles -> the party is inside for **60 minutes** (hidden), pays `guests x $110` as `restaurants` income at arrival -> gone. With no such building in reach the party walks back and leaves, no income.
- **Pure poses**: `Wedding.poseOf(i, t)` is a function of the saved record and the clock, so a save made in the middle of a ceremony reloads to the same picture. The view (`WeddingView`) only smooths the per-minute steps; one Lambert vertex-colour material, <= 6 meshes (draw calls), nothing drawn while no wedding is on.
- **Events**: `wedding:started` (news "A wedding at the chapel today", focus on the chapel), `wedding:bell` (x2; no news, no UI sound: the sound layer rings it), `wedding:held` (count; feeds the achievement), `wedding:feast` (news line with the income).
- **Save**: observer module `wedding` (`{ last, count, rec }`, version 1), not part of `stateHash`; the feast income is a normal economy entry, so a save + reload is identical (`npm run chapel:sanity`). Off with `autoEvents: false` (tutorial, title demo) and in scenarios, like the rare visitor.
- **Achievement**: *Wedding bells* (tier 2, `wedding:held` x 3 in one game, visible on the shelf).
- **Plain bot**: builds no chapel, so nothing here runs in the balance suites; the goldens did not move (`docs/balance.md` "0.7.1").

## Sound

The hour chime used to follow ANY building. With a connected chapel the probe reports `chapel` (a 0..1 proximity within 35 tiles) and `ambienceMix` uses it instead of the building proximity for the chime (`bells = chapel ?? buildings`, daytime only, same `AMB.church` caps: one chime per 60 s of audio time, at most 2 strikes, `minBells` 0.3). The wedding bell is `Ambience.weddingBell()`: the same **synthesised** `churchBell` (the recorded church-bell sample stays retired), the same caps, only with the camera really at the chapel. No new audio file.

## Tests and tools

`tests/sim/wedding.test.ts` (schedule, timeline, bell / held / feast events, income, chapel removed mid-wedding, save round trip, achievement), the advisor tables, `tests/repo/buildingContract.test.ts` (the contract row), `npm run chapel:sanity [-- --shots 1]` (the real page: lock, placement + footpath, forced wedding, figures, bell, feast income, save in the middle of a ceremony + reload identical, MaterialGuard 0; shots `.weave/shots/chapel-*.png`), `npm run analysis:roi -- --only chapel`.

## Economy

`npm run analysis:roi -- --only chapel,touristOffice` (5 seeds, 180 days from 1 December in the sandbox starter): chapel capex $4,200, net **+$5,044 a year +/- $2,211** (payback 150 days); Tourist Office +$5,079 +/- $3,419. Both are inside the noise of the guest stream, and the year starts in winter, so the summer weddings and the charm are not what that number measures. By design the chapel does not pay for itself through weddings (about 3 to 4 a year x about $550); it is a village decoration with a small rating effect, so it does not dominate any build order.
