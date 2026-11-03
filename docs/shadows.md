# Shadows and contact shadows (M8, task 8.6)

Render-only. No sim, save or golden change. Source: `src/render/ShadowRig.ts` (the pass), `src/render/shadowFit.ts` (pure maths), the `USE_SHADOWS` block in `src/render/TerrainMesh.ts` (the receiver), wiring in `src/main.ts` (`renderer.shadows.addReceiver`, `renderer.shadowFeed`, `userData.noShadow` flags).

## Two layers

| layer | tiers | what | cost |
|-------|-------|------|------|
| **Contact shadows** | low / med / high | soft darkening under buildings, lift towers and tree clusters: the existing ground-mask A channel (`groundMask.ts`, `treeTowerAo`) sampled bilinearly by the terrain shader, with a world-space wobble. M8 strengthened it (0.22 -> 0.32) so objects sit on the ground instead of floating. | **0 draw calls, 0 extra triangles** (no decals; the +1 draw call allowance is unused) |
| **Sun shadow map** | high only | trees, buildings, lift towers / stations, guests, vehicles, animals, props cast onto the terrain **and onto each other** (lane F: buildings, props, guests, vehicles, rocks and trees receive). Iso and the ride / photo / walk views. | a static depth pass (cached) + a small dynamic pass every frame, counted **separately** (see below) |

Low and med have no `USE_SHADOWS` define: their terrain program is the same as before apart from the M8 surface changes, and no render target exists.

## How the sun map works

* **Own pass, not three's shadow system.** The custom prop / terrain shaders cannot sample three's shadow chunks, so `ShadowRig` renders the scene from an orthographic sun camera into a 2048 x 2048 depth texture (`DepthTexture` + `LessEqualCompare`, hardware PCF). Casters keep **their own materials** (colour output is thrown away), so custom vertex shaders (instanced trees, billboards, wind / season uniforms, guest batches) land in the depth map correctly and **no extra shader programs are compiled** (the target has the screen's output colour space). `webgl.render` is called through the function captured at construction, so the flicker / shot harnesses (which wrap `render` to count frames) do not count it.
* **What casts:** every visible, opaque `Mesh` except roots flagged `userData.noShadow` (terrain, water, overlays, particles, markers, sky traffic, sled run ...) and the names in `NO_CAST_NAMES` (`networks`, `springMarkers`, `emotes`, `railCrossings`, `model-gallery`): flat draped decals (roads, rails, pistes) would shadow the ground they sit on. Transparent meshes, points, lines and sprites are hidden for the pass and restored right after. New buildings / trees need no registration.
* **What receives (lane F):**
  * **Terrain**: its own block (`USE_SHADOWS` in the terrain fragment shader: 5 fixed PCF taps, normal-offset + constant bias, fade at the window border), unchanged.
  * **Every opaque built-in Lambert material** (buildings, lift stations, vehicles, guests, props, paths): `ShadowRig.adopt()` walks the scene (once a second, only while High is on; subtrees flagged `noShadow` are skipped), wraps the material's own `onBeforeCompile` with `patchLambertReceiver` (`src/render/shadowChunk.ts`) and adds `USE_SHADOWS` to `material.defines`. The patch scales `reflectedLight.directDiffuse` (the sun term) by the shadow factor and takes ~11 % off the ambient term in shade (like the terrain); emissive night windows are untouched. World position comes from the view-space position, so instanced, batched and custom-vertex materials all work. The material's `customProgramCacheKey` gets `|sunrecv` appended (computed from the original key first), so programs do not collide.
  * **Trees and rocks** (custom ShaderMaterials flagged `userData.shadowRecv`, `createMeshMaterial`): the vertex shader passes the sun part of the baked colour and the world normal; the fragment shader subtracts `sunPart * (1 - shadow) * 0.55`. 55 %, not 100 %: at full strength winter conifer `rotfine` flicker rose from 0.665 to 0.736 (strong contrast inside canopies), at 0.55 it is 0.687. Tree **billboards** (far LOD) cast but do not receive (the quad faces the camera, so its depth is not a surface).
  * **Low / Med**: `release()` restores the original `onBeforeCompile`, `customProgramCacheKey` and defines when High is off, and nothing is adopted before High is on. Verified: 20 programs on Low and 20 on Med before and after lane F (`scripts/shots/m8-programs-f.ts`); High goes from 33 to 45.
  * **Feedback loop guard:** receivers must not sample the texture they are drawn into, so during the shadow pass `tShadow` is swapped for a 1x1 stand-in depth texture and the strength is 0; the real texture is also allocated and cleared when High turns on, so a main pass before the first shadow pass never samples an unallocated texture.
* **Strength** follows the day: `shadowStrength(night, overcast, sunElevation)` fades through dusk, is 0 at night (the pass is skipped), is 40 % softer under heavy weather (cloudy 0.5, snow / rain 0.8, storm 1), and fainter with a grazing sun. Atmosphere Off / Low / High are independent (the pass reads only the lighting, not the atmosphere settings).
* **Cast direction** is the real sun azimuth with the elevation lowered (`shadowSunDir`: x 0.6, never flatter than 17 degrees), the same trick the terrain relief light uses, so a high summer sun does not hide every shadow under its caster and a dawn sun does not comb the map with 10x fingers (lane E: the minimum slope is now 0.4, about 22 degrees, and the strength fades with the real sun elevation). Sun azimuth is the game's: with the default camera the sun is behind the camera's right shoulder at noon, so noon shadows fall mostly behind their casters; morning / evening and rotated views show them (see the shots).

## Stability (flicker-safe)

* The window is a square of `2 * half`, `half` on a x1.12 ladder from 10 (was x1.25: each ladder step changes the texel size by at most 12 %, so a zoom crossing it changes the shadow edge softness less) (`quantiseHalf`), centre **snapped to 8 texels in light space** (`fitShadowWindow`), sun direction **quantised to 0.35 degrees** (`quantiseSun`): panning, zooming a little or creeping time moves the window only in whole texels, so shadow texels never swim against the world.
* The window is **rotation invariant** (fitted to the circle containing the view, not the rotated rectangle) and only refits when the view leaves it or the needed size drops under 1/1.3 of it (hysteresis), so a yaw sweep never refits.
* Beyond `half > 200` (the whole of a 256 map at its widest zoom) shadows switch off; the 2048 map then spreads thinner than a screen pixel.
* **Perspective views (ride / photo / walk, lane F):** one window **centred on the camera's ground position**, never on its look direction, so yaw / pitch never move it (`fitPerspectiveWindow` in `shadowFit.ts`: the iso fit with `perspectiveRadius(eye height)` = 52 + 0.8 x height above ground, capped at 90). Half-sizes come from the same x1.25 ladder (walker: half 59.6 .. 74.5, texel 0.06 .. 0.07 world units; a gondola 30 above the ground: 74.5 .. 93), texel-snapped, with the same 1.3 shrink hysteresis; a refit keeps the texel lattice (same half and sun) so shadow edges do not shift. The border fade (5 % of the window) hides the cut-off at 60-90 tiles, where the ground fog is already thick. The same quality gate (High) applies; `Renderer.start` feeds the rig the active camera.
* **Tree distance bands in the pass:** the tree / rock vertex shaders compute their LOD band from the camera. In the depth pass `cameraPosition` is the sun camera, so they read `shCam()` (`uShCam`, set to the real camera for the pass only) and cast the same LOD they draw.

## Cost (SwiftShader here: relative only, no GPU)

* **Main pass draw calls: identical with shadows on and off** (64 / seed 5: 31 vs 31; 128 / seed 5: 41 vs 41). The +1 allowance is unused.
* **Shadow passes** (separate, `renderer.shadows.stats`; see "Static cache + dynamic pass" below): the static pass has the old pass's cost but runs only when something static changed (a sun step, a re-fit, a building, a tree cell entering the view); the dynamic pass (12 roots: guests, vehicles, carriers, animals ...; about 14 calls / 27 k triangles on the 128 demo resort) runs EVERY frame. Both are skipped at night and while the shadow window is unavailable.
* **Heavy fallback (gradual, was a hard cut):** the tree layers (`userData.shadowHeavy`) cast with a **density** that falls linearly from 1 at 50 % of `heavyTriBudget` (1.2 M triangles in the previous main pass) to 0 at the budget, so the pass never costs more than the old one did. See "Cast density" below. Buildings, lifts and guests always cast.
* Memory: two 2048 depth targets, 16-bit depth (8 MB) + R8 colour (4 MB) each = **24 MB** (was one 32-bit depth 16 MB + 4 MB = 20 MB), only while High is on.
* Frame time on a real GPU is unverified; SwiftShader A/B on 64 / 128 was dominated by noise (+7 % .. +27 %). If High is too heavy on a device, lower `ShadowRig.refreshHz` / `heavyTriBudget` (both public).

## Static cache + dynamic pass (lane H: "the shadows miss frames")

**Owner report (real GPU, High):** "the shadows flicker a bit, like they miss frames". **Cause:** one depth pass for everything, throttled to 10 Hz (6 / 3 Hz under load), so guests, lift carriers and vehicles cast a shadow that updated at 10 Hz while the main pass ran at 60 fps; plus a hard tree cut-off (1.2 M triangles) that switched whole forests' shadows on or off as the zoom changed.

**Measured (SwiftShader, `npm run shadow:stability`, 128 / seed 5, summer 16:00, zoom 3, 150 skiers, 40 frames per sweep; the metric renders each frame twice, with and without shadows, and compares the luma difference = the pure shadow signal; "CV" = std / mean of the per-frame change, lower = more even, "still" = frames with no shadow change at all):**

| sweep | before (CV / still frames / worst÷median) | after |
|-------|------------------------------------------|-------|
| game speed 1 | 1.30 / 26 of 39 / 13.6 | 1.10 / 25 / 11.9 (the residual is the sun step, see below) |
| game speed 3 | 0.75 / 30 / 4.7 | **0.37 / 27 / 1.3** |
| game speed 10 | 1.34 / 39 / 12.9 | **0.53 / 39 / 4.1** |
| pan | 0.018, osc 0.0052 % | 0.016, osc 0.0054 % |
| zoom out | 0.59 / 0 / 3.5, 0 pops | **0.30 / 0 / 2.0**, 0 pops |

Before, the depth pass ran in 10 of 39 frames (and 4 s apart on this slow renderer); after, the dynamic pass runs in **40 of 40** frames and the static pass only when needed (0 to 10 times).

* **Static casters** (buildings, towers, stations, trees, rocks, props: everything not flagged dynamic) render into a cached depth target `rtStatic`. They re-render only when: the window re-fits (immediately), the sun steps (<= 20 Hz), the static set changes (a **signature** of visible static meshes, geometry ids / versions, instance counts and instance-matrix versions, so a new building or a tree cell entering the view; <= 8 Hz), the tree cast density steps (<= 8 Hz), or, in perspective views, the camera moved 3 units (tree LOD bands; <= 8 Hz). Under load (smoothed frame time over 22 / 34 ms) ONLY those rates drop (x0.6 / x0.35); a re-fit is never throttled.
* **Dynamic casters** are the roots flagged `userData.shadowDynamic` (`main.ts`: guests, vehicles, nature, petting zoo, tour carriers, crag climbers, attraction activity, grooming, incidents; lift carriers flag their own instanced mesh in `meshes/lifts/index.ts`). Every frame the rig GPU-copies the static depth into the **final** target (`copyTextureToTexture`, a `blitFramebuffer`, no shader) and draws the dynamic roots on top (their `userData` subtree is filtered like the static pass). They are never throttled or skipped: no sub-guard touches them. To draw only them the pass temporarily swaps `scene.children` for the lights + dynamic roots (same scene, fog, lights, programs: **no new shader programs**, no extra traversal of the world).
* **Receivers still sample one texture** (the final target); no shader changed except the tree cast density test.
* **Window ladder:** x1.12 instead of x1.25 (each step changes the texel size at most 12 %), same 1.3 shrink hysteresis. The window and its matrix are still set together with the static render, so receivers never see a map and a matrix from different fits. There is no crossfade between ladder sizes (it would need a third 8 MB target); the steps are small, 0 pops in `zoompop` (flicker harness) and in the stability zoom sweep.
* **Sun direction:** quantised to **0.25 degrees** (was 0.35), the static map re-renders at most 20 Hz for it. At game speed 1 the sun moves 2.4 degrees / s, about 9.6 steps / s: each step moves a long shadow tip ~0.1 units (2 px at the default zoom); this is the residual judder at speed 1 above. Smaller steps are possible but cost static passes in proportion (0.1 degrees = 24 per second).
* **Cast density** (`shadowSchedule.ts`, shader `shDropTree` in `shadowChunk.ts`): the density follows the previous main pass's triangle count (1 up to 50 % of the budget, 0 at the budget), slews at <= 0.25 / s, is quantised to 1/16 and a step re-renders the static map (<= 8 Hz). In the depth pass a tree casts when `hash(aSeed) < density`, a stable per-instance hash, so the sets are nested (raising the density only ADDS trees, a step flips ~6 % of them, spread over the whole map; no clump or forest pops). **Limit:** the dropped trees are collapsed in the vertex shader, so they still count as submitted triangles (vertex cost remains, rasterisation and depth writes go); at density 0 the whole layer is hidden as before.
* **Tier gating:** Low / Med never allocate a target, add a define or adopt a material (`tests/render/shadowFit.test.ts`); programs are unchanged: 20 / 20 / 45 as before (the dynamic pass reuses the casters' own programs).
* **Instrumentation:** `renderer.shadows.stats` has `staticPasses`, `dynPasses`, `dynCalls`, `dynTriangles`, `density`, `dynRoots`, `memMB`; `shadows.measureSync = true` (benchmarks only) ends every pass with a 1-pixel read so the ms are real rasteriser times.

### Cost (SwiftShader, `npm run shadow:cost`: RELATIVE ONLY; 128 / seed 5 summer 16:00, zoom 3, demo resort + 150 skiers)

| | before | after |
|---|---|---|
| one shadow pass | 66 .. 160 ms (142 calls, 161 k tris, trees off by the hard cut) | static 195 ms (135 calls, density 0.06, 1.33 M submitted tris); dynamic 17.8 ms per frame (13 calls, 27 k tris), of which the 2048 depth copy 7.9 ms |
| passes per second at 60 fps | 10 | static ~9.6 (sun steps at speed 1, 0 when the sun stands still) + dynamic 60 |
| main-pass draw calls | 35 / 31 / 165 | 35 / 31 / 166 (iso 64 at 17:00 and noon, 128 demo: the same, +1 is a moving guest) |
| shadow memory | 20 MB | 24 MB |

On SwiftShader the new design costs more per second (the CPU rasteriser pays 8 ms to copy 8 MB and ~10 ms per tiny dynamic pass; modelled 2.9 s of shadow work per second against 1.6 s: **well over +25 %, not met on SwiftShader**). I can not measure a GPU here. Reasoning for a real one: the static pass is the same size and runs at the same or a lower rate (sun steps 9.6 Hz vs the old 10 Hz, and 0 Hz while the sun stands still: the old pass ran at 10 Hz always); the dynamic pass is ~14 draw calls and 27 k triangles (about 0.1 ms) plus a 16-bit 2048 x 2048 depth blit (8 MB read + 8 MB write, tens of microseconds on a discrete GPU, ~0.1 ms on a phone). If a device is too slow the sub-guard lowers the static rates; `ShadowRig.heavyTriBudget` still bounds the static pass.

## Flicker (`npm run flicker -- --quality high`, 64 maps, rotfine / zoomfine, % oscillating pixels)

| scenario | HEAD without lane C | lane C, med | lane C, high (shadows) |
|----------|--------------------:|------------:|-----------------------:|
| 64 winter rotfine | 0.6508 | 0.6582 | 0.6645 |
| 64 winter zoomfine | 0.1483 | 0.1530 | 0.1549 |
| 64 summer rotfine | 0.1384 | 0.1365 | 0.1393 |
| 64 summer zoomfine | 0.0466 | 0.0464 | 0.0418 |

(M8 audit baseline before any lane: winter 0.5604 / 0.1522, summer 0.1283 / 0.0444; the lane A / B commits on trees, rocks and animals moved winter rotfine to ~0.65 before lane C. "HEAD without lane C" = a worktree at the commit lane C started from.) Lane C's terrain / skirt / water changes move the med numbers by <= 0.01 points and the shadow map adds <= 0.014 points on top: within noise, no pops, no LOD flips. With High quality, 64 winter rotfine at Atmosphere High = 0.6581 and Atmosphere Off = 0.6631 (both within noise of 0.6645 at the default Atmosphere level).

## Flicker after lane H (`npm run flicker -- --quality high`, same session as a baseline worktree)

| scenario | before (HEAD) | after |
|----------|--------------:|------:|
| 64 winter rotfine | 0.6851 | 0.6868 |
| 64 winter zoomfine | 0.1502 | 0.1549 (0.1512 .. 0.1560 over three runs: run-to-run noise is about 0.005) |
| 64 summer rotfine | 0.1320 | 0.1385 |
| 64 summer zoomfine | 0.0368 | 0.0407 (0.0355 with the x1.25 ladder: noise) |
| pops / LOD flips (rotpop, zoompop) | 0 / 2 | 0 / 2 (the same two tree-level flips as before) |

Within noise of the previous numbers (0.687 / 0.150 / 0.156 / 0.037 in the table below), 0 pops. Honest note: zoomfine is 0.003 .. 0.005 above the baseline in two of three runs; I could not make it better or worse by the ladder size or the depth precision.

## Tests

`tests/render/shadowSchedule.test.ts` (static refresh decision, load scaling that never delays a re-fit, density band / slew / quantisation, nested per-tree sets, and the rig itself with a fake renderer: static pass once, dynamic pass every frame at any frame rate, scene restored, panning inside the window keeps the cache, leaving it re-fits, a new building re-renders the static map and a new guest does not, 24 MB, density steps <= 0.2), then `tests/render/shadowFit.test.ts` (quantisation idempotent, orthonormal basis, ladder, texel snapping under sub-cell pans, rotation-invariant coverage, off beyond `MAX_HALF`, depth range finite, minimum sun slope, strength never NaN, tier gating of the shader define and the render target) and the skirt `aWet.x` depth test in `tests/render/terrainGeometry.test.ts`.

## Lane F numbers (64 and 128 maps, SwiftShader: counts are real, ms are not)

| | before (b8b6d0f) | after |
|---|---|---|
| main-pass draw calls, 128 / zoom 1.5, low / med / high | 164 / 169 / 169 | **164 / 169 / 169** (triangles 0.39 / 0.68 / 0.76 M, same) |
| main-pass draw calls, 128 / zoom 3, low / med / high | 156 / 157 / 156 | 156 / 157 / 156 |
| shader programs, Low / Med / High (64) | 20 / 20 / 33 | **20 / 20** / 45 |
| shadow pass, 64 map iso | ~26 calls / ~1.07 M tris | same (not changed) |
| shadow pass, 128 demo resort | - | 145-178 calls / 0.65-0.78 M tris (iso 17:00 and a lift ride; buildings are many small meshes) |
| shadow pass, walker next to the lodge | - | 14-60 calls; 19 k tris when the tree layers are skipped (main pass > 1.2 M tris), 1.3 M with trees |
| shadow memory | 16 + 4 MB | same, plus a 1x1 stand-in depth texture |
| gzip JS (app js) | 776.4 kB | 777.8 kB (+1.4 kB; total +1.7 kB) |
| flicker 64 winter rotfine / zoomfine (High) | 0.6645 / 0.1549 | **0.687** / 0.150 |
| flicker 64 summer rotfine / zoomfine (High) | 0.1393 / 0.0418 | 0.156 / 0.037 |
| flicker winter rotfine, High + Atmosphere Off / High | 0.6631 / 0.6581 | 0.688 / 0.684 |
| pops / LOD flips | 0 / 0 | 0 / 0 |

Shadow-pass refresh rates are unchanged (max 10 Hz, 6 / 3 Hz under load, immediate on a refit or sun step). Winter rotfine rose by about 0.02 (from 0.665) with trees receiving at 55 %: the number came from 0.736 at full strength (see "What receives"). `renderer.shadows.stats` is the only place the pass is counted.

## What I saw (`m8-after-f-*` shots, `scripts/shots/m8-shadows-f.ts`)

* **Iso, summer, 17:00, rotated** (`m8-after-f-q-iso17-high` vs `m8-after-f-before-iso17-high`): the forest is a little darker and more layered where neighbouring crowns shade each other; no speckle or acne; terrain shadows unchanged.
* **Iso close-up of the lodge** (`m8-after-f-p-iso-lodge-close-high`): bushes get a self-shadow and the lodge casts onto the bushes beside it; with a red debug build the plaza paving, the road, the rail and the lodge roof slopes all showed the shadow factor (lamp shadows on the paving, lodge shadow on the road). The visible effect on lit paving and walls is mild, because only the sun term is scaled and the hemisphere light is strong; walls turned away from the sun were already unlit. I did not make it harsher.
* **Walk** (17:30 / 16:00, `m8-after-f-o-walk-*`, debug build `m8-after-f-n`): ground shadows of the lodge, lamps and deer appear in the first-person view and stay put while the camera stands still; they are short because the cast sun is lifted to >= 22 degrees and the casters are small. With the default strength they read as a soft darker patch, not a hard shadow.
* **Ride / photo**: the 128 demo resort at 17:00 winter (`m8-after-f-r-demo-ride-high`, `...-photo-high`): no GL errors, no artefacts; the sun is low and the strength 0.27, so the shadows are faint. The photo **export** goes through the same scene and the same shadow uniforms (`photo-export-m8-after-f-s-photo-high.png` is a real export; in that orientation the sun is behind the camera, so the shadows are hidden behind the objects: I did not capture an export with a shadow in view).
* A first walk shot looked shadowless: it was looking along the cast direction from the sun side. Shadows fall away from the sun; the camera has to look toward the sun to see them.

## Known gaps

* Sun steps (0.25 degrees, ~10 per second at speed 1) still move long shadow tips in small jumps; no crossfade between ladder sizes; dropped trees still cost vertex work (see Cast density); the depth copy and per-pass cost on a CPU rasteriser make the SwiftShader cost +80 % (see Cost).

* Casters outside the camera frustum: tree cells outside the view are culled per cell, so in ride / walk views a tree behind the camera does not cast into the view, and iso off-screen casters pop at the screen edge as before.
* In perspective views the main pass often has > 1.2 M triangles (forest in view), which switches the tree layers off as casters (`heavyTriBudget`): buildings, lifts, guests and rocks still cast. Raise `ShadowRig.heavyTriBudget` on a fast GPU.
* Tree billboards do not receive; trees receive at 55 %; terrain does not cast (no hill shadows at dawn).
* Real GPU frame time with receivers is unverified (SwiftShader only); 12 extra shader programs compile when High is switched on.
* Casters outside the main view are only drawn if their layer draws them (tree cells outside the camera are culled per cell), so a long shadow of an off-screen tree can pop at the screen edge.
* Terrain does not cast (no hill shadows at dawn).
