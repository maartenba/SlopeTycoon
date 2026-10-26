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
