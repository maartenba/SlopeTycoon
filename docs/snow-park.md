# Snow park, Freestylers and the Halfpipe (0.9.0)

A **snow park** is a property of a run (`docs/runs.md`): the player marks a blue, red or black run of at least 100 m; kickers, boxes and rails appear along it by themselves, the snowcat **shapes** it, and **Freestylers** come to ride it on winter days. A **Halfpipe** building beside the park adds a pipe. Ships ON with no flag; the plain `Bot` marks no park, so no Freestyler is ever drawn in a balance run. Owner decisions (2026-11-24): a new Freestyler type plus a light park preference for Snowboarders; unlock at **level 3**; features placed **automatically only**; **no park building** (a run + the groomer is enough); the **Halfpipe is placeable in this release** (level 3); **no summer version**.

Source: `src/config/park.ts` (every number), `src/sim/park/SnowPark.ts` (system), `src/render/park/ParkView.ts`, `src/render/meshes/buildings/halfpipe.ts`, the Freestyler row in `src/config/guestTypes.ts`.

## Validity (`SnowPark.reasonFor`)
Not a loop / blob, difficulty blue or harder, length >= 100 m (`PARK.minLengthM`; the 64 maps' runs are 120-180 m), a Groomer Garage standing. At most **2** parks. Plain-text reasons (`PARK.reasons`). Unlocking is the `snowPark` landscape unlock (level 3). A marked park whose run falls below the rules goes **inactive** with the reason; the flag is stored by persistent run id (`RunSettings.park`, `runs` module v3) and pruned only when the run is gone.

## Features (auto)
`parkFeatures(run, size)` is a pure function of the run: every 4 (blue) / 3 (red, black) centre-line tiles, leaving 2 tiles clear at both ends, a repeating cycle by difficulty (blue: small kicker, box, small kicker, rail; red: M kicker, rail, M kicker, box, L kicker; black: L, rail, M, L, box). Not saved, not obstacles for skiers. `ParkView` draws all of them as ONE merged vertex-coloured mesh (kicker ~30 triangles, box 24, rail ~36; a worn park tints the kickers browner) plus ONE small instanced mesh of **pipe riders** (3 per Halfpipe, only while freestylers are about): **2 draw calls**, about 100-2,000 triangles; the Halfpipe building is a normal 3-group building (~110 triangles). Airs: `GuestRenderer.air` (wired to `ParkView.airFor`) lifts a Freestyler over a feature by a parabola of its distance along the run (a hop on a kicker, a spin of 1-2 half turns on medium / large ones, a sideways slide on a box or rail); continuous at the edge of the reach (no pop), render only.

## Shape
`shape` 0..1 per park (module `snowPark`). A fresh park starts at 0.6; **a snowcat pass on a park tile** (`PisteQuality.groom` -> `SnowPark.onGroom`) adds `1 / (0.6 x tiles)`, so grooming 60 % of the tiles fully shapes it; **every day** costs 0.06 and **every lap** 0.004 (the decay is lazy: applied from the date before any read or write, equal to an eager midnight decay). Below **0.4** the park is **Worn**: demand x0.5, rougher injuries (`injuryScale`), kickers tinted. The garage's own snowcats groom a run every night, so a normal park stays shaped; setting the run to *Do not groom* (or an overstretched garage) wears it: the groomer time is the night-ops choice. No new groomer mode.

## Freestylers (guest type index 16)
Winter only (`winter: 0.05`), level 3, `requires ['@snowPark']` (pseudo id: at least one open, valid park), segment `adventure`, fallback `adventure`, group 1-4, budget $150-300, advanced / expert; magenta jackets (`look.top` 10 = magenta in `CLOTH_COLORS`, checked in `park:sanity`), helmets; skis OR a board by guest hash (55 % board). **Demand** = the arrival weight times `SnowPark.demand(alive)` = summed quality of up to 2 open parks (`0.35 + 0.65 x shape`, x0.5 worn, x1.25 with a Halfpipe); 0 without an open park or at 10 freestylers per park. At a lift top the via pick is restricted to the park tiles (`Exploration.parkTiles`); reaching the via tile is a **lap** (`GuestSim.parkLap` -> `SnowPark.onLap`): the first lap of a day pays **$16** (`recreation`), a lap through a park with a Halfpipe **$4** more, tricks += features of the park (max 6) + 2 with a pipe; after 4-8 laps (`parkQuota`) the rider leaves at the end of the run. Their injury roll is x1.5 plus x1.6 x (1 - shape): hurt riders are handled by the ski patrol like any injury, never deaths. **Snowboarders** get a small via-pick bonus (`PARK.boarderBonus` 0.45) for a park tile, only while an open park exists. The Park Jam campaign's prerequisite is "a Stunt Park or a snow park", and its lift bonus counts a park near a lift top.

## Halfpipe (building `halfpipe`)
3 x 8, $12,000 / $22 a day, level 3, Recreation, beside a piste or footpath (`access: pisteEdge`, slope <= 6 with auto-flatten, winter). It counts for a park when its footprint is within **3 tiles** of one of the park's tiles. **Deviation from the plan**: it is shaped by the park's own groomer pass (no separate pipe shape), and its riders are the cosmetic pipe riders plus the pipe fee / tricks above (guests do not navigate into the channel).

## Saves
Park flags: `runs` module v3 (optional `park` id list, absent while none). Shape, per-guest laps, totals and the day's riders: module `snowPark` v1, `omitWhenNull` (null while nothing happened; part of `stateHash` because laps decide when a rider leaves). Old saves load with no park. `SAVE_FORMAT_VERSION` is unchanged.

## UI
Run inspector: a **Make a snow park** / **Not a snow park** button (44 px, `data-role="run-park"`), the one-line status (reason / lock / *Snow park · 4 riders today · shape 80 %*) and a shape bar. **Operations -> Runs** has a *Park* column. Phones: the toggle lives in the run inspector sheet; no new floating card.

## Advisor, achievement
Rudi: `park.available` (a valid run, no park, a settled resort), `park.short` (a blue+ run 60-100 m long, 0.9.0), `park.worn` (an open park below 0.4 after riders came). Achievement **Stomped it** (`stomped-it`, fact `parkTricks`: 100 tricks in one game). No goal or chapter depends on a park.

## Economy
`npm run analysis:park` (`scripts/analysis/parkRoi.ts`): the starter resort for a year with / without a red park (and + Halfpipe), same seed. Result (64 maps, seeds 61 / 5 / 23 / 42): the park itself costs nothing to build, nets about **-$9,000 to +$5,800 a year** per seed (mean about -$1,600; the guests it attracts also take a share from others), the Halfpipe adds $12,000 capex and about the same again in upkeep and is roughly break-even on top. It is a cosmetic / liveliness feature, never a money machine; far from the top third of `analysis:roi`.

## Tests
`tests/sim/park/*`, `tests/persist/parkSave.test.ts`, `tests/render/parkView.test.ts`, `tests/ui-dom/snowPark.test.ts`, advisor rows, the building contract. `npm run park:sanity [-- --shots 1 --seed 5 --out NAME]`: the real-page story (locked at level 1, refusals, features + pipe, freestylers lap and jump, wear and a groomer pass, a forced injury answered by the patrol, save + reload identical).
