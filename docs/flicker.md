# Flicker (rotating / zooming): method, causes, fixes

User feedback: *"Rendering may need a little bit of work to reduce some flickering, e.g. when rotating or zooming?"* This page documents the measurement tool, what it found and what was changed.

## Measuring: `npm run flicker` (not part of the default tests)

`scripts/flicker-test.ts` boots the real game in the SwiftShader harness (docs/visual-qa.md) at 960x600 for 6 scenarios (64 / 128 / 256 maps, winter / summer, day / night, Medium demo resort + 150 skiers, camera on the lodge, sim paused) and captures ONE frame per step inside the page (it hooks `WebGLRenderer.render`, so a step = one game frame = what a smooth 60 fps move would show). Sweeps:

| sweep | what | metric |
|---|---|---|
| `rotfine` | 18 windows (every 20 deg over 360) of 5 frames 0.1 deg apart | **oscillating pixels**: luma temporal derivative flips sign on 3 consecutive frames, each step >= T (10). With sub-pixel motion a smooth render changes monotonically, so this is shimmer / aliasing / noise |
| `zoomfine` | windows of 5 frames 0.1 % zoom apart every 20 % over the zoom range | same |
| `rotpop` / `zoompop` | 3 deg yaw sweep / 1.5 % zoom out + back in over the whole range | **pop events**: frames whose mean abs frame difference jumps over 1.3 x the rolling median of the neighbours + 0.5 (an LOD swap, a hole, a rebuild) |
| `jitter` | zoom wobbles +-2 % around every LOD threshold (tree 28, rock 45, guest 70, tree low 90, terrain macro 100 visible tiles) | **LOD flips**: how often (tree level, terrain macro, guest impostor, rock level) changes between frames |
| `still` | 8 frames, same camera | animation noise (water / smoke / snow / animals): not camera related |
| `sheet` | 6 frames across the tree LOD threshold (150 ms apart) | contact sheet `flick-sheet-<tag>-<scenario>.png` (top: frames, bottom: x6 frame difference) |

Per sweep a heatmap `.weave/shots/flicker-<tag>-<scenario>-<sweep>.png` (red = share of frames in which that pixel oscillated) and `flicker-<tag>.json|md` with the top offending screen cells are written. Options: `--only 64-winter`, `--kinds rotfine,jitter`, `--tag name`, `--T 10`, `--anchor 20`, `--step 3`, `--zstep 0.015`, `--off trees,guests,water,terrain,decor,nature,rocks,<scene child index>,list` (hide layers: bisecting; `list` prints the scene children). A full run takes ~40 min on SwiftShader (the 128 / 256 maps dominate); the 64 maps ~5 min.

Why the oscillation metric uses 0.1 degree steps: a 1 degree step moves content up to 7 px per frame at 400 px from the centre, so any textured area changes sign legitimately (a first 1 degree version flagged 4-7 % of the screen as "flicker", all false positives). Honest limits: SwiftShader is not a real GPU (MSAA 4x is present, timings are not), the pop detector only sees pops that are big compared to the motion, and the cross-fade clock is real time (a 5 frame window on SwiftShader spans ~1 s).

## Root causes found (with evidence)

1. **LOD thresholds had no hysteresis** (tree full -> low at 28 visible tiles, low -> billboard 90, rocks 45, terrain far LOD 100, guest impostor 70). Zoom wobble (wheel inertia, focus tween overshoot) around a threshold toggled the level EVERY frame: `jitter` sweep: **23 / 23 / 69 / 69 / 115 / 115 level flips** in 24 / 24 / 72 / 72 / 120 / 120 frames.
2. **Tree LOD swap was a whole-forest pop**: the full mesh (dark facets) and the low-poly cone (white) differ a lot in colour; the old level hid and the new level's cells were built at 3 cells per frame, so even holes were possible. Contact sheet before (`img/flicker-sheet-before.webp`): the diff row shows the whole forest flashing in ONE frame; `zoompop` found the pop at z 1.71 going out AND in at the same zoom (2 events, mad 18.3 vs 12.7).
3. **Far-LOD terrain swap (256 maps)**: macros were hidden the moment the mode flipped while full-res chunks were built lazily (24 per frame): holes for several frames; full-res chunks and macros could also overlap (z-fight).
4. **Sub-pixel noise in the terrain shader**: `hash(floor(xz * 9))` rock-edge grain, 2.6 / tile flower dots, 17 / tile snow glints are 2-4 px features at the default zoom: they crawl when the camera moves. (Small contributor: with trees and guests hidden the whole scene oscillates in only 0.07 % of the pixels.)
5. **Thin tree geometry** (bare winter branches, sparse crowns, fence posts) is the dominant source of the remaining oscillation: hiding the tree layer drops `rotfine` from 26128 to 2016 px / frame (-92 %, 64 winter, 4 deg steps). Not fixable in shaders; needs thicker / simpler meshes (later "less blocky look" pass).
6. Checked, no problem: depth precision (iso camera is orthographic: linear depth, 24 bit over near 0.1 - far 4 x map = 6e-5 tiles), antialiasing (`antialias: true`, 4 samples, pixel ratio <= 2), terrain texture mipmaps + anisotropy 4, `still` noise 0 on the 64 maps, water (hiding it changes nothing), buildings / decor / networks (the arc in front of the lodge in the heatmap is the fence + lamp posts, again thin geometry).
7. Not fixed (ride / walk views only): the perspective band cross-fade of the props and the roof near-hide still use a screen-space stipple (`gl_FragCoord`), which crawls when the camera moves. The iso views do not use it.

## Fixes

* `src/render/lodSelect.ts` (pure, unit tested): `lodSelect(prev, value, thresholds, hyst = 6 %)`, `schmitt`, `fadeWeight`, `instanceHash` / `inNewLevel`, `buildOrder`, `advanceFade`.
* **Hysteresis** (+-6 %): tree / rock levels (`InstancedLayer.levelForHyst`), terrain far LOD (`TerrainMesh.update`), guest impostor (`guestFarByView`).
* **Per-instance cross-fade of the tree / rock levels (iso)**: a zoom crossing starts a fade; the incoming level is built first (the outgoing one stays on screen: never a hole), then both draw for 0.4 s with complementary masks decided by a stable per-instance hash of `aSeed` against the fade weight (`uXf`, `XFADE_VERT_PARS` in Trees.ts): no screen-space noise, each tree swaps exactly once. The fade clock only runs while the incoming cells are all built.
* **Build ahead + nearest first**: cells touching the view enlarged by 28 % are built (a rotation / pan finds its cells ready), ordered by distance to the view centre (`buildNearestFirst`).
* **Atomic terrain LOD swap**: entering the far LOD a full-res chunk stays until its macro is built; leaving it a macro stays until all its chunks are built; protected chunks stay on top. Never a hole, never both resolutions.
* **Terrain shader AA**: one `fwW` (world units per pixel) fades the rock-edge grain, flower dots and snow glints out when they get smaller than a few pixels.

## Results (before -> after, same scenarios)

| scenario | rotate: osc px/frame (before → after) | zoom fine: osc px/frame | pop events (zoom out+in sweep) | jitter LOD flips (before → after) |
|---|---|---|---|---|
| 64-winter-day | 3685.7 → 3598.4 | 698.7 → 1052.2 | 2 → 0 | 23 → 0 |
| 64-summer-day | 949.8 → 886.8 | 539.2 → 609.8 | 0 → 0 | 23 → 0 |
| 128-winter-night | 1031.1 → 910.9 | 259.8 → 265.5 | 0 → 0 | 69 → 0 |
| 128-summer-day | 1551.4 → 1360.5 | 624 → 613.5 | 0 → 0 | 69 → 0 |
| 256-winter-day | 2889.9 → 2854.2 | 888 → 1063 | 0 → 0 | 115 → 0 |
| 256-summer-day | 1752.4 → 1549.9 | 322.4 → 404.4 | 0 → 0 | 115 → 0 |

Reading: **LOD flips under zoom jitter 23-115 -> 0**, tree-LOD pop events 2 -> 0 (contact sheets: `img/flicker-sheet-before.webp` / `img/flicker-sheet-after.webp`), rotation oscillation -1 .. -12 % (terrain noise is a minor share). The remaining oscillation is thin tree / fence geometry (heatmap: `img/flicker-heat-64-winter-rot.webp`). `zoomfine` winter rose a bit (699 -> 1052, 888 -> 1063): a 5 frame window can fall inside a running cross-fade (each swapped tree is a real, intended change that the metric counts as oscillation when it coincides with the zoom step); `still` numbers move between runs (weather, animals) and are not camera related. `zoompop` also reports 2-10 LOD flips for the 1.5 % sweeps: those are the legitimate single switches per threshold crossing in each direction (before: also one per crossing, but with the pop).

## Tests (default suite, no WebGL)

`tests/render/lodSelect.test.ts` (hysteresis stable under jitter, switches on real change, fade weight continuous / monotonic, per-instance masks complementary and once-only, hash independent of the camera, build order) and `tests/render/flickerLod.test.ts` (guest impostor hysteresis; terrain swap covers every macro area exactly once per frame while zooming in / out; macro LOD stable under jitter; tree layer: no fade under jitter, fade keeps the old level drawn, never an empty frame, masks off at the end).

## Building snow / coplanar faces (user report: "still flickering on the snow patches underneath a building", winter)

Quick check: `npm run flicker:building -- [--season winter] [--zooms 2,3.5,6] [--yaws 8] [--rw 300 --rh 220] [--off terrain,trees,...,lodge,lodge:<layer>] [--out name]` (~35 s; `scripts/flicker-building.ts`): winter lodge, windows of 5 frames 0.1 deg apart at several yaws / zooms, oscillating pixels (as above) counted only in the centre region, heatmap `.weave/shots/flicker-building-<out>-z<i>.png`. `--off lodge:list|flat|coplanar|tris`, `lodge:<child>:x<a>-<b>` bisect the lodge mesh down to triangles.

Root causes:
1. **Roof snow tint used `floor()`-quantised hashes** (1/3 and 1/7 tile cells, also moving the snow threshold): hard blocky squares on every roof, static AND crawling when the camera moved. Now smooth world-space value noise (`snowRoofNoise`, 0.6 cells / tile), low contrast (0.93-0.98), threshold no longer jittered.
2. **Coplanar faces of different boxes** inside one building (the Base Lodge's wing-bay end walls are flush with the hall's end walls, doorway / frame trims, ...): same depth, so which one wins flips every frame = the large flickering parallelograms. `PartBuilder.box` now grows every box by a tiny strictly increasing amount (`boxGrow`: 0.04 mm-units per box, cap 0.008) so the later part always wins. Test: `tests/render/snowFlicker.test.ts` (no coplanar overlapping visible faces in any building).
3. Plinth flagstone tops sat exactly at the (flat) terrain height: 0.01 higher now.
Checked, not the cause: ground mask (already LINEAR sampled), terrace slab, snow shader on roofs (osc unchanged with snow off), shadow maps (disabled).

Numbers (lodge, 64-winter seed 61, T 8): small region 300x220 at zoom 2 / 3.5 / 6: 358.6 / 162.1 / 9.1 -> 257.2 / 78.3 / 9.1 osc px per window (sum 529.8 -> ~296); whole frame at zoom 4: 3485 -> 2956 (the rest is terrain texture shimmer on the dark cliff skirt at the bottom of the frame, not the building).

## Phase 6 scenes (0.2.6): river water and mid-station

`npm run flicker -- --only 64-summer-river,64-winter-mid --kinds rotfine,zoompop,jitter,still` (new scenarios; the river scene digs the best natural spring through the real tool, the mid scene rebuilds the starter gondola with a mid-station and looks at it). Same harness, 960 x 600, SwiftShader; baselines run in the same session with the same kinds:

| scenario | rotfine osc px/frame | zoompop pops | LOD flips (jitter) | still px/frame |
|---|---|---|---|---|
| 64-summer-day (baseline) | 748.2 | 0 | 0 | 622.6 |
| 64-summer-river | 318.3 | 0 | 0 | 517 (water animation) |
| 64-winter-day (baseline) | 3237.8 | 0 | 0 | 1052.7 |
| 64-winter-mid | 2189.5 | 0 | 0 | 2098.7 |

Reading: no pop events and no LOD flips in either new scene. The river's `still` figure (54 px of oscillation per frame, 0.009 % of the frame, against 10 for the bare summer scene) is the water's own animated texture and splash, not camera shimmer; its rotation oscillation is lower than the baseline because the view is mostly water and bare slope. The mid-station scene is in the same range as the winter baseline (the cable, the hall and the carriers add thin geometry; the heatmap offenders are the trees as before).

Note: `flicker-test.ts` and `flicker-building.ts` used `populateDemo('Medium')`, which builds nothing (the level is lowercase); the numbers above are the first with the demo resort really present, the tables further up were taken on the bare village.

## M6.3 summer content scene (0.2.7)
`npm run flicker -- --only 64-summer-content --kinds rotfine,zoompop,jitter,still`: the 64 / seed 61 summer village at 21:00 with the M6.3 buildings placed through the Bot's own placement (campground with its night glow, toilets, petting zoo, viewpoint, treehouse, quad base, tackle hut; the crag and the pier need rock / water and are not placed here). Result: rotfine 0.082 % oscillation, **0 pop events**, zoompop **2 LOD flips, identical to the plain `64-summer-day` baseline** (2), jitter 0, still 0.0027 %. The campfire glow is one static additive disc (world-space, no noise), so it adds no shimmer.


## Quality tier (M8)
`npm run flicker -- --quality low|med|high` writes `slope.quality` before the page boots (default: the game's own default for the map size, `med` on 64 / 128). Use `--quality high` to measure the shadow map (`docs/shadows.md`): the texel-snapped window must keep `rotfine` / `zoomfine` within noise of `--quality med`. M8 lane C numbers are in `docs/shadows.md`.


## Title camera wobble + pylon foot flicker (owner report, real GPU, 0.5.x High)

Report: the title screen camera "is sometimes a bit wobbly"; "flickering at the pylon foot". What was measured, what was fixed, what could NOT be reproduced on SwiftShader.

### 1. Title camera (`npm run title:camera`, `scripts/title-camera.ts`)

The script boots the live title demo (`?demoscene=1&nomenu=1&demosize=64&demoseed=7`) and logs, per game frame, dt, the pose the renderer actually used (camera position, look target, yaw, zoom) and whether a static shadow pass ran; with `--fixed 1 --dt 0.0333` it runs on a virtual clock so the PATH is separated from SwiftShader's frame time. Metric: **acceleration of each channel** (change of per-second velocity between frames / dt). A smooth camera has a small bounded value; a wobble is a spike.

Causes found in `DemoCamera` / `DemoScene` (all confirmed by the log, same seed 7, same virtual clock, 25 s):

1. **First-order exponential followers** (`c += (want - c) * damp(rate, dt)`): velocity jumps by `rate * distance` at every cut (a new shot), every time the followed skier / animal reverses, and the rate itself changed over time (`settle` smoothstep, a half-rate first frame). Peak acceleration of the camera x 1063 -> 38, z 521 -> 43, yaw 11.5 -> 0.55 rad / s^2, zoom 41 -> 0.77.
2. **Look height = the raw bilinear ground height** under the target: its slope changes at every tile edge, so the whole picture bobbed vertically as the target drifted over the terrain (p99 52, max 139 -> p99 1.3, max 1.3).
3. **The director ran AFTER `controls.update`** (Renderer: controls, preFrame, onFrame): the camera pose (position, lookAt) was built from the PREVIOUS frame's target / yaw while the projection (zoom) was already new: a one-frame lag between zoom and pose, so any frame-time variation made them disagree. Now the director re-poses the camera (`CameraLike.update(0)`) right after it sets the target.
4. **Periodic static shadow pass** (suspected, not measurable here): the title demo's sun moves ~9 steps a second, each re-rendering the cached static depth map (135 calls, ~1.3 M submitted triangles): 260 passes in 25 s = a ~10 Hz pulse of GPU work, which on a modest GPU is a regular frame-time hitch that reads as a wobble of a slow camera. `ShadowRig.staticRateScale` (title demo 0.25) lowers the refresh RATE of pure changes (sun steps now <= 5 Hz, steps < 0.5 degrees): **260 -> 105 passes in 25 s**; a window re-fit is never throttled. A frame that already hitched (dt > max(30 ms, 2 x smoothed)) defers a pure refresh by one frame instead of piling on. Honest limit: SwiftShader has no real GPU timings, so I can state the pass count, not the hitch it causes on the owner's machine.

Fix: `DemoCamera` follows with **critically damped springs** (`springStep`, exact solution, any dt): x, z, yaw (shortest way round), log zoom and the look height; velocity is continuous at cuts and for reversing follow targets; the path is a function of continuous time (a 120 ms hitch every second moves the camera < 6 tiles off the smooth run, test). Tests: `tests/render/demoCamera.test.ts` ("DemoCamera smoothness"), `tests/render/shadowSchedule.test.ts` (rate scale, hitch guard, `why` counters).

### 2. Pylon foot (`npm run flicker:tower`, `scripts/flicker-tower.ts`)

`flicker:tower` centres the camera on a lift tower, crops 100-160 px around its foot and counts oscillating pixels (rotation windows, running time, slow pan) with the same metric as `flicker`; options `--quality`, `--shadows off`, `--static off`, `--freeze 1` (hold the carriers still), `--noshadow cable|towers|stations|carriers|liftsAll` (stop a group from casting), `--bias k` / `--nofs k` (receiver depth bias / normal offset), `--flat 1`, `--dump 1`.

What the measurement said (honest):

* A first run showed High at 10-16 x the Med / shadows-off value in the tower crop (e.g. zoom 8 rot 119 vs 8). **That was an artefact**: the lift carriers animate on the RENDER clock even with the sim paused, so chairs (and their shadows) kept moving through the crop. Held still (`--freeze 1`): High 3.6 / 2.5 vs shadows off 2.9 / 2.9 osc px per window (zoom 8 / 16), High vs Med on three towers 15.8 / 12.3 vs 13.8 / 9.8 (zoom 4) and 5.6 / 3.4 vs 4.5 / 3.1 (zoom 8): **no foot flicker from the shadow receivers, the static re-render or the dynamic pass reproduces on SwiftShader**. (Also checked by bisect: tower / station / cable casters, bias x0.3..x3, normal offset x0..x3: no effect.)
* So the likely cause on a real GPU is one SwiftShader cannot show: **z-fighting between the footing cap and the terrain.** `Lift.ts` places a tower at `heightAt` (bilinear) but the terrain mesh is drawn as planar triangles (`surfaceHeightAt`, "exactly as the terrain mesh triangulates it"), and tile corner heights are whole steps, so on every flat tile the old footing cap (a stone disc with its top exactly at tower ground height) was COPLANAR with the snow over the whole 0.3 radius, and within ~0.1 of it on a gentle slope. Equal depths flip winner per pixel and per frame on a real GPU as soon as the camera moves (tiny sub-pixel jitter): a shimmering patch at the foot. SwiftShader evaluates both planes with the same arithmetic and consistently picks one, so the harness shows nothing (confirmed on the flattest tower: 9.4 vs 8.6). Status: **suspected from the code and the geometry, not confirmed by an image.**
* Fix (conservative, no draw-call change): the footing is a plinth that stands `TOWER_FOOT_PROUD` = 0.06 above the tower's ground height (still sunk `TOWER_FOOT_DEPTH` = 0.2), so no up-facing face of the tower sits at ground height anywhere (`tests/render/liftModels.test.ts`: "tower footing"). Same triangle count, same material.

### By-eye checklist for the owner (High, real GPU)

1. Title screen, 2 minutes: is the wobble gone? If it remains, in the console set `__slope.renderer.shadows.staticRateScale = 0.05` (almost no static refresh) and watch again; then `__slope.renderer.shadows.freezeStatic = true` (no static re-render at all) and `__slope.renderer.setShadows(false)`: whichever makes it stop is the cause (static shadow pass vs the pass in general vs the camera path). `__slope.renderer.shadows.stats.why` counts why static passes ran (`sun`, `view`, `set`, `density`, `camera`).
2. Pylon foot: zoom in on a tower on a flat snowy tile and orbit slowly. If the footing still shimmers, `__slope.renderer.shadows.freezeStatic = true`, then `setShadows(false)`: gone with shadows off = shadow receiving at the contact (bias: raise `uShadowP.y`); gone only when the footing is hidden = geometry (z-fight: tell me which tower kind).
3. Also look at the tower base flange (near LOD, ride / walk) and the station slabs: the same coplanar-with-terrain pattern may exist there (not changed: no report).
