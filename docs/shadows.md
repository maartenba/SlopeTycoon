# Shadows and contact shadows (M8, task 8.6)

Render-only. No sim, save or golden change. Source: `src/render/ShadowRig.ts` (the pass), `src/render/shadowFit.ts` (pure maths), the `USE_SHADOWS` block in `src/render/TerrainMesh.ts` (the receiver), wiring in `src/main.ts` (`renderer.shadows.addReceiver`, `renderer.shadowFeed`, `userData.noShadow` flags).

## Two layers

| layer | tiers | what | cost |
|-------|-------|------|------|
| **Contact shadows** | low / med / high | soft darkening under buildings, lift towers and tree clusters: the existing ground-mask A channel (`groundMask.ts`, `treeTowerAo`) sampled bilinearly by the terrain shader, with a world-space wobble. M8 strengthened it (0.22 -> 0.32) so objects sit on the ground instead of floating. | **0 draw calls, 0 extra triangles** (no decals; the +1 draw call allowance is unused) |
| **Sun shadow map** | high only | trees, buildings, lift towers / stations, guests, vehicles, animals, props cast onto the terrain. | one extra depth pass, counted **separately** (see below) |

Low and med have no `USE_SHADOWS` define: their terrain program is the same as before apart from the M8 surface changes, and no render target exists.

## How the sun map works

* **Own pass, not three's shadow system.** The custom prop / terrain shaders cannot sample three's shadow chunks, so `ShadowRig` renders the scene from an orthographic sun camera into a 2048 x 2048 depth texture (`DepthTexture` + `LessEqualCompare`, hardware PCF). Casters keep **their own materials** (colour output is thrown away), so custom vertex shaders (instanced trees, billboards, wind / season uniforms, guest batches) land in the depth map correctly and **no extra shader programs are compiled** (the target has the screen's output colour space). `webgl.render` is called through the function captured at construction, so the flicker / shot harnesses (which wrap `render` to count frames) do not count it.
* **What casts:** every visible, opaque `Mesh` except roots flagged `userData.noShadow` (terrain, water, overlays, particles, markers, sky traffic, sled run ...) and the names in `NO_CAST_NAMES` (`networks`, `springMarkers`, `emotes`, `railCrossings`, `model-gallery`): flat draped decals (roads, rails, pistes) would shadow the ground they sit on. Transparent meshes, points, lines and sprites are hidden for the pass and restored right after. New buildings / trees need no registration.
* **What receives:** the terrain only (`USE_SHADOWS` in the terrain fragment shader: 5 fixed PCF taps, normal-offset + constant bias, fade at the window border). Buildings and trees do not receive (no tree-on-roof shade): the contact term and the baked lighting already carry that.
* **Strength** follows the day: `shadowStrength(night, overcast, sunElevation)` fades through dusk, is 0 at night (the pass is skipped), is 40 % softer under heavy weather (cloudy 0.5, snow / rain 0.8, storm 1), and fainter with a grazing sun. Atmosphere Off / Low / High are independent (the pass reads only the lighting, not the atmosphere settings).
* **Cast direction** is the real sun azimuth with the elevation lowered (`shadowSunDir`: x 0.6, never flatter than 17 degrees), the same trick the terrain relief light uses, so a high summer sun does not hide every shadow under its caster and a dawn sun does not comb the map with 10x fingers (lane E: the minimum slope is now 0.4, about 22 degrees, and the strength fades with the real sun elevation). Sun azimuth is the game's: with the default camera the sun is behind the camera's right shoulder at noon, so noon shadows fall mostly behind their casters; morning / evening and rotated views show them (see the shots).

## Stability (flicker-safe)

* The window is a square of `2 * half`, `half` on a x1.25 ladder from 10 (`quantiseHalf`), centre **snapped to 8 texels in light space** (`fitShadowWindow`), sun direction **quantised to 0.35 degrees** (`quantiseSun`): panning, zooming a little or creeping time moves the window only in whole texels, so shadow texels never swim against the world.
* The window is **rotation invariant** (fitted to the circle containing the view, not the rotated rectangle) and only refits when the view leaves it or the needed size drops under 1/1.3 of it (hysteresis), so a yaw sweep never refits.
* Beyond `half > 200` (the whole of a 256 map at its widest zoom) shadows switch off; the 2048 map then spreads thinner than a screen pixel.
* Not used in ride / photo / walk views (iso only).

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

## Known gaps

* Only the terrain receives; no self-shadowing on buildings or trees; no shadows in ride / photo / walk views.
* Casters outside the main view are only drawn if their layer draws them (tree cells outside the camera are culled per cell), so a long shadow of an off-screen tree can pop at the screen edge.
* Terrain does not cast (no hill shadows at dawn).
