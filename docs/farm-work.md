# Summer farm work: tractors on the pastures (render only)

In summer (June to September) every Alpine Farm gets one or two tractors with a hay trailer. They leave the farm, drive to a patch of flat pasture, mow two rows, drop round bales, drive home with a growing load and unload. It is atmosphere: **no sim state, nothing saved, no sim Rng, `stateHash` and every golden unchanged.** Code: `src/render/FarmWorkView.ts` (the instanced layers + the state machine), `src/render/farmWorkPlan.ts` (pure: schedule, planner, timeline), `src/render/meshes/tractor.ts` (meshes), `src/config/farmWork.ts` (every number), `src/main.ts` (the wiring and the QA hook), the `tractor` layer in `src/audio/Ambience.ts`.

## Gating

| Rule | Value |
|------|-------|
| Season | real calendar Jun-Sep only (`farmPhase`); the first and last 2 days of that window the tractors only sit parked in the farm (they scale in / out), so the season edges are soft. Zero otherwise |
| Per farm | Low 1, Medium / High 2 (`tractorCap`); Atmosphere **Off** = none, Atmosphere **Low** = at most 1; also none in the title demo, and no new trips under reduced motion or at 10x / fast-forward (they stay parked) |
| Farms | the 6 nearest to the camera target (`maxFarms`); everything is hidden once the view is taller than 110 tiles |
| Hours | a tractor may leave 07:30-12:00 and 13:30-16:00 (the second one starts about 1.4 h later, plus a hashed jitter); a trip on the road is not cut by lunch; it must be home at 17:30. Rain, storm and snow park it (a tractor on the road drives home, load and all). Night: parked |
| Active farms only | a farm without access (`active` false) shows nothing |

Honest note: a game day is only 150 s at 1x, but a trip is about 60-90 s of real time (speed 0.55-0.7 tiles/s), so at 1x a tractor makes roughly one trip a day and at 3x it is often sent home by the evening rule mid-trip. That is why trips are not tied to the clock tightly.

## One trip

`planTrip` (pure) picks a work spot by a **stable hash of (seed, day, farm id, tractor, trip number)** (`hk`, never the sim Rng): 16 tries, the first half within 14 tiles of the farm gate, the rest up to 25. A spot is valid when a 3.6 x 0.72 tile patch (plus turning room) is entirely **free, flat, bare, snow-free pasture at about the farm's own altitude** (`patchOk`): no building footprint, water, stream, rock, ice, forest tile, tile with a tree / rock prop, piste, lift, decor, road or path, no steep tile (corner range > 1), and none within 3 tiles of a patch that is still on the map. The route reuses the snowcat planner (`legWaypoints` in `src/sim/ops/groomPath.ts`: A* around footprints with line-of-sight shortcuts) on a world where everything above is blocked; the route is rounded (Chaikin) and then **re-checked every 0.08 tile with a 0.3 tile body margin**, so a clipped corner rejects the spot. Tractors may drive across roads and paths (never along a piste or through a footprint); mowing never happens on them. A farm walled in (the starter resort's farm on some seeds) simply makes no trips: three gates on the farm's front side are tried before giving up.

Timeline (`Runner`, advanced by the frame `dt`): turn at the parking spot (1.2 s), drive out (0.7 t/s), stop at the patch (1.2 s), mow row A (0.55 t/s), U-turn (semicircle, 0.45 t/s), mow row B (bales drop behind the trailer), stop (1.2 s), drive home, **unload 3.5 s**. The pose is a pure function of the plan and the distance travelled, the trailer follows the path 0.3 + 0.58 tiles behind the tractor (articulated: it swings on turns), pitch follows the ground.

* **Mown stripes** (`farm:stripes`): flat straw-coloured quads (one per tile of row, draped on three height samples, polygon offset, soft edges, no `gl_FragCoord`) that grow with the mower. A finished patch is held 50 s, then fades over 40 s (real time).
* **Bales**: 3 round bales per patch (`farm:bales`, instanced), popped in 0.45 s behind the trailer, shrinking away with the patch. Square bales are NOT drawn (one geometry per layer).
* **Hay load**: a loaf (a bale cylinder stretched along the deck) whose height and width grow smoothly with the mown share of both rows (0 -> 0.92 of the full heap, `hayLoadAt`) and empty during the unload stop.
* **Farmer**: merged into the tractor mesh (a coat, head and straw hat at the wheel).
* **Exhaust** (Medium / High): a small grey puff every 0.45 s while moving, 7 per tractor, with the shared smoke shader (`SMOKE_VERT` / `SMOKE_FRAG` exported from `src/render/Smoke.ts`, its own clock = the frame clock).
* Not done: cows lifting their heads and a cow bell on pass-by (the cow agents have no hook that is cheap and stays render-only; skipped, not faked).

## Rendering numbers (measured, SwiftShader, 128 / seed 5, 2 farms = 4 tractors)

| | Low | Medium | High |
|---|---|---|---|
| Tractors per farm | 1 | 2 | 2 |
| Extra main-pass draw calls (frozen-frame delta) | +4 | +5 | +5 |
| Extra triangles (4 / 2 tractors, loads, bales, stripes) | +2.2 k | +4.6 k | +4.6 k |
| Exhaust | off | on | on |
| Shadows | none (Low has none) | none | tractors, trailers, bales are `shadowDynamic` casters |

The brief asked for at most +2 draw calls: it is **+5** (tractors, trailers, bales + hay loads, stripes, exhaust) because the trailer has to articulate and the stripes need their own alpha shader. All five are hidden (0 draws) in winter, with Atmosphere Off and when the camera is far. Meshes: tractor **728 triangles**, trailer **210**, bale **40** (`tests/render/tractorMesh.test.ts`). `MaterialGuard`: 0 problems (read in every shot). Flicker (`npm run flicker -- --only 64-summer-day`): base rotfine 798.1 px/frame (0.1386 %), zoomfine 269.5 (0.0468 %), 0 pop events; with tractors forced 801.6 (0.1392 %), 272.4 (0.0473 %), 0 pop events: within noise (the tractors may not be in every sweep frame).

## Audio

New proximity layer `tractor` (ceiling 0.04, quieter than any other bed but the sleigh bells): low-passed brown noise (210 Hz) + a 330 Hz pink band, amplitude pulsed by sub-audible sines at 6.1 / 3.05 / 0.37 Hz (the diesel putt-putt; noise only, no oscillator whine, every Q <= 0.6). `ambienceMix`: `tractor * close^1.4 * day * (1 - rain)`, so only zoomed in, by day and when dry; `WorldProbe.tractors` = the working (moving) tractors, reach 16 tiles (`FARM_WORK.audioReach`); off on Low quality and in the demo; muted with the ambience slider like every layer. No recording is used (the only groomer clip has an unknown licence and is not reused). The node-budget test went 300 -> 320 for the ~15 nodes of the bed.

## QA hook

`__slope.farmWork.force({ day, hour, weather, at })` puts every tractor mid-trip: `at` = `'mowA' | 'mowB' | 'home' | 'gate' | 'unload' | 0..1` (an array = one per tractor index); `force(null)` releases (running trips then follow the natural rules). Also `.snapshot()`, `.stats()`, `.working()` and the view itself. `scripts/shots/tractor.ts` (`npx vite-node scripts/shots/tractor.ts -- --tag x --q med --atmos high --size 128`) places a farm on open pasture through the placement rules, forces the tractors and writes `.weave/shots/tractor-<tag>-<q>-<atmos>-<shot>.png` plus draw-call / triangle numbers. Use a new `--tag` every run.

## Tests

`tests/render/farmWorkPlan.test.ts` (season edges, hours / weather, caps, hay curve, route validity against buildings / water / piste / forest / steep on a staged map, determinism, avoid list, walled-in farm, timeline, abort-home), `tests/render/farmWorkView.test.ts` (nothing in winter / Atmosphere Off / far, caps, trips and building avoidance, parked at night / in rain / at speed, frame-rate independence, exhaust, caps), `tests/render/tractorMesh.test.ts`, `tests/audio/proximity.test.ts` (the layer's curve).

## Known weak spots

* The starter farm sits in a crowded pocket on some seeds and then makes no trips (the planner finds no clear route): correct, but the farm looks idle.
* Tractors cross village paths and plazas when the route needs it.
* Parking is inside the fenced pasture: leaving and arriving, the tractor drives through the fence rails (no gate is modelled).
* The exhaust is a few tiny puffs: easy to miss at the default zoom.
* SwiftShader only: no real GPU timing, no audio heard by an ear (the bed is unlistened, `docs/playtest-audio.md`).

## 0.6.5 look upgrade

Tractor: **980 triangles** (cap 1,000, three liveries red / green / blue picked by a stable hash of the farm id, one instanced mesh each; empty ones are not drawn), trailer **360** (cap 450, slatted sides, A-frame drawbar, rounded arches), round bale **96** (wrap band), hay loaf **84** (its own `farm:loaves` layer: domed, straw strands by vertex colour). Draw calls while tractors are visible: unchanged for one livery (+1 per extra livery in view, +1 loaf layer while a load is on). Exhaust: pool 9, life 2.5 s, larger puffs. Cows (`src/render/meshes/Animals.ts`): 880 triangles, instance-colour coat variants (`COW_TINTS`), one in six drawn as a calf. Not done: animated tail / ear / bell (the whole-body pose animation is unchanged), rectangular bales, a contact shadow disc. Shots: `.weave/shots/tractor-m8-{before,after}-o-*`, `m8-*-o-cows*`; MaterialGuard 0 in every shot; flicker `64-summer-day` rotfine 802.8 px/frame (0.1394 %), zoomfine 266.5 (0.0463 %), 0 pops.
