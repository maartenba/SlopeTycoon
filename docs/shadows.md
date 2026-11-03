# Shadows and contact shadows (M8, task 8.6)

Render-only. No sim, save or golden change. Source: `src/render/ShadowRig.ts` (the pass), `src/render/shadowFit.ts` (pure maths), the `USE_SHADOWS` block in `src/render/TerrainMesh.ts` (the receiver), wiring in `src/main.ts` (`renderer.shadows.addReceiver`, `renderer.shadowFeed`, `userData.noShadow` flags).

## Two layers

| layer | tiers | what | cost |
|-------|-------|------|------|
| **Contact shadows** | low / med / high | soft darkening under buildings, lift towers and tree clusters: the existing ground-mask A channel (`groundMask.ts`, `treeTowerAo`) sampled bilinearly by the terrain shader, with a world-space wobble. M8 strengthened it (0.22 -> 0.32) so objects sit on the ground instead of floating. | **0 draw calls, 0 extra triangles** (no decals; the +1 draw call allowance is unused) |
| **Sun shadow map** | high only | trees, buildings, lift towers / stations, guests, vehicles, animals, props cast onto the terrain **and onto each other** (lane F: buildings, props, guests, vehicles, rocks and trees receive). Iso and the ride / photo / walk views. | one extra depth pass, counted **separately** (see below) |

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

* The window is a square of `2 * half`, `half` on a x1.25 ladder from 10 (`quantiseHalf`), centre **snapped to 8 texels in light space** (`fitShadowWindow`), sun direction **quantised to 0.35 degrees** (`quantiseSun`): panning, zooming a little or creeping time moves the window only in whole texels, so shadow texels never swim against the world.
* The window is **rotation invariant** (fitted to the circle containing the view, not the rotated rectangle) and only refits when the view leaves it or the needed size drops under 1/1.3 of it (hysteresis), so a yaw sweep never refits.
* Beyond `half > 200` (the whole of a 256 map at its widest zoom) shadows switch off; the 2048 map then spreads thinner than a screen pixel.
* **Perspective views (ride / photo / walk, lane F):** one window **centred on the camera's ground position**, never on its look direction, so yaw / pitch never move it (`fitPerspectiveWindow` in `shadowFit.ts`: the iso fit with `perspectiveRadius(eye height)` = 52 + 0.8 x height above ground, capped at 90). Half-sizes come from the same x1.25 ladder (walker: half 59.6 .. 74.5, texel 0.06 .. 0.07 world units; a gondola 30 above the ground: 74.5 .. 93), texel-snapped, with the same 1.3 shrink hysteresis; a refit keeps the texel lattice (same half and sun) so shadow edges do not shift. The border fade (5 % of the window) hides the cut-off at 60-90 tiles, where the ground fog is already thick. The same quality gate (High) applies; `Renderer.start` feeds the rig the active camera.
* **Tree distance bands in the pass:** the tree / rock vertex shaders compute their LOD band from the camera. In the depth pass `cameraPosition` is the sun camera, so they read `shCam()` (`uShCam`, set to the real camera for the pass only) and cast the same LOD they draw.

## Cost (SwiftShader here: relative only, no GPU)

* **Main pass draw calls: identical with shadows on and off** (64 / seed 5: 31 vs 31; 128 / seed 5: 41 vs 41). The +1 allowance is unused.
* **Shadow pass** (separate, `renderer.shadows.stats`): 64 map ~22 calls / 241 k triangles; 128 map ~24 calls / 628 k triangles at the default zoom. It runs at most **10 Hz** (6 Hz under 45 fps, 3 Hz under 30 fps) unless the window refits or the sun steps; it is skipped at night and while the shadow window is unavailable.
* **Heavy fallback:** when the previous main pass had more than 1.2 M triangles (256 maps at wide zoom), roots flagged `userData.shadowHeavy` (the tree layers) stop casting until it drops below 0.84 M; buildings, lifts and guests still cast (256 / seed 5 zoom 2.2: 13 calls / 52 k triangles instead of ~1.3 M).
* Memory: one 2048 depth texture (16 MB) + an R8 colour target (4 MB), only while High is on.
* Frame time on a real GPU is unverified; SwiftShader A/B on 64 / 128 was dominated by noise (+7 % .. +27 %). If High is too heavy on a device, lower `ShadowRig.refreshHz` / `heavyTriBudget` (both public).

## Flicker (`npm run flicker -- --quality high`, 64 maps, rotfine / zoomfine, % oscillating pixels)

| scenario | HEAD without lane C | lane C, med | lane C, high (shadows) |
|----------|--------------------:|------------:|-----------------------:|
| 64 winter rotfine | 0.6508 | 0.6582 | 0.6645 |
| 64 winter zoomfine | 0.1483 | 0.1530 | 0.1549 |
| 64 summer rotfine | 0.1384 | 0.1365 | 0.1393 |
| 64 summer zoomfine | 0.0466 | 0.0464 | 0.0418 |

(M8 audit baseline before any lane: winter 0.5604 / 0.1522, summer 0.1283 / 0.0444; the lane A / B commits on trees, rocks and animals moved winter rotfine to ~0.65 before lane C. "HEAD without lane C" = a worktree at the commit lane C started from.) Lane C's terrain / skirt / water changes move the med numbers by <= 0.01 points and the shadow map adds <= 0.014 points on top: within noise, no pops, no LOD flips. With High quality, 64 winter rotfine at Atmosphere High = 0.6581 and Atmosphere Off = 0.6631 (both within noise of 0.6645 at the default Atmosphere level).

## Tests

`tests/render/shadowFit.test.ts` (quantisation idempotent, orthonormal basis, ladder, texel snapping under sub-cell pans, rotation-invariant coverage, off beyond `MAX_HALF`, depth range finite, minimum sun slope, strength never NaN, tier gating of the shader define and the render target) and the skirt `aWet.x` depth test in `tests/render/terrainGeometry.test.ts`.

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

* Casters outside the camera frustum: tree cells outside the view are culled per cell, so in ride / walk views a tree behind the camera does not cast into the view, and iso off-screen casters pop at the screen edge as before.
* In perspective views the main pass often has > 1.2 M triangles (forest in view), which switches the tree layers off as casters (`heavyTriBudget`): buildings, lifts, guests and rocks still cast. Raise `ShadowRig.heavyTriBudget` on a fast GPU.
* Tree billboards do not receive; trees receive at 55 %; terrain does not cast (no hill shadows at dawn).
* Real GPU frame time with receivers is unverified (SwiftShader only); 12 extra shader programs compile when High is switched on.
* Casters outside the main view are only drawn if their layer draws them (tree cells outside the camera are culled per cell), so a long shadow of an off-screen tree can pop at the screen edge.
* Terrain does not cast (no hill shadows at dawn).
