# Atmosphere (M7.0)

Render-only mood layer: valley fog, colourful sunrises / sunsets, alpenglow, stars and moon phases, cloud shadows, frost sparkle, dawn mist and rare rainbows.
**No gameplay effect, no sim Rng draw, no `stateHash` change** (a test runs the same sim with the atmosphere on and off and compares the hash). Every decision is a hash of `(seed, dayKey)` plus today's weather / season / hour, so a day looks the same on every visit.
Code: `src/config/atmosphere.ts` (the table), `src/render/atmosphere/*` (pure models + controller), shader terms in `src/render/Fog.ts`, `TerrainMesh.ts`, `meshes/index.ts`. Setting: Settings > Graphics > **Atmosphere** (Off / Low / High).

## What existed before (audit)

| Effect | File | Notes |
|---|---|---|
| Day / night light, sun arc, warm golden hours | `src/render/Lighting.ts`, `src/sim/Daylight.ts` | pure `lightingAt(hour, sunTimes)`; sunrise / sunset move with the season (08:00-16:30 winter .. 05:00-20:30 summer); the glow is already a wide warm band every day |
| Sky | CSS gradient on `#app` (`skyGradient` / `skyCss`) | the canvas is transparent; in iso the sky only shows at the corners |
| Distance fog (perspective views) | `src/render/Fog.ts` | `FogExp2` always installed, density 0 in iso; fog colour = sky horizon colour |
| Rain / snow particles | `src/render/Precipitation.ts` | camera-following pool, shader-animated |
| Chimney / pool smoke | `src/render/Smoke.ts` | tied to buildings (not reused for mist) |
| Snow on trees / roofs, seasons | `Season.ts`, `props/Trees.ts` (`aTint.a` = snow cover), `meshes/index.ts` | **snow on trees already follows the sim snow depth** (caps + snow atlas cells); no extra "fresh snow" tint was added |
| Snow glints | `TerrainMesh.ts` | static world-space hash cells, fade out when sub-pixel |
| Weather kinds | `src/sim/Weather.ts` | `clear / cloudy / snow / heavySnow / rain / storm`; a sim `fog` field exists (used only by Energy), **not** used for visuals: the new fog is render-side |

### Weather mix (measured: `npx vite-node scripts/analysis/weatherKinds.ts 5 2`, seed 5, 128, two years)

| Month | clear | cloudy | snow | heavy snow | rain | storm |
|---|--:|--:|--:|--:|--:|--:|
| April | 37% | 27% | 0 | 0 | 37% | 0 |
| May | 13% | 37% | 0 | 0 | 40% | 10% |
| June | 50% | 33% | 0 | 0 | 10% | 7% |
| July | 50% | 27% | 0 | 0 | 20% | 3% |
| August | 43% | 20% | 0 | 0 | 20% | 17% |
| September | 33% | 33% | 0 | 0 | 27% | 7% |
| October | 10% | 33% | 0 | 0 | 57% | 0 |
| November | 17% | 33% | 10% | 3% | 37% | 0 |
| December | 33% | 30% | 27% | 10% | 0 | 0 |
| January | 13% | 33% | 40% | 13% | 0 | 0 |
| February | 10% | 33% | 33% | 23% | 0 | 0 |
| March | 33% | 43% | 10% | 3% | 10% | 0 |

Monotone months: **October (57 % rain)** and **January / February (clear only 10-13 %, 53-56 % snow)**. That is exactly where special skies and fog mornings add variety. Not changed (sim is out of scope).
Atmosphere frequency on the same days (seed 5 / seed 61): special dawn 25.6 / 26.9 %, special dusk 27.5 / 29.4 %, fog mornings 15.8 / 15.0 % (inversion 6.1 / 6.1 %), frost 5.3 / 4.4 %, rainbow 1.7 / 1.1 %.

## Design

* **Special skies**: `specialSky()`: per-day hash decides a beautiful dawn and/or dusk (about 1 in 4 to 1 in 3; likelier after a wet day and under broken cloud; never in rain / storm). Plain days stay exactly as before. A special day warms the sky / sun colours (`gradeLighting`, strength 0.4 max) and puts **alpenglow** (pink-orange on high snow facing the sun) on the summits within +-40 min of the horizon crossing (full within +-20 min).
* **Valley fog / inversion**: `fogDay()` (season chance + after rain + cold clear), hour curve `fogHourFactor()` (builds from sunrise - 1.5 h, holds to ~08:30, gone by 11:00; the bank also sinks while it burns off). A height band in world space with slow world-space noise, applied in the terrain, water, tree / rock and building shaders (`FOG_FRAG`, `uValleyFog*` uniforms shared; amount 0 = exact old look, no recompiles). Inversion days (clear weather) have a higher, deeper bank: **valleys in fog, summits clear and bright**. HUD shows "Winter · fog" while it is strong.
* **Sky extras**: stars + moon (CSS layer in the sky, one canvas, no draw call), moon phase = 29.53-day cycle on the sim day, cloud shadows (world-space noise on terrain, drifting with the wind).
* **Flavour (High)**: frost twinkle (cold clear mornings, world-space hash on snow), dawn mist over lakes / rivers (`Mist.ts`, one instanced draw, <= 48 puffs), rainbow (CSS arc, first clear spell after a wet day, ~1-2 % of days).
* **Photo mode**: shows everything live; the saved PNG paints stars / moon / rainbow too (`paintSkyDecor`). The Scene section offers "Golden hour", "Foggy valley", "Frosty morning", "Starry night" buttons, **only when today delivers them**; they only set the photo hour (restored on exit, game clock untouched).

## Setting, defaults, reduced motion

`slope.atmosphere` in localStorage. Default **High on desktop, Low on touch (`pointer: coarse`) and when graphics quality is Low**.

| | fog | special grade + alpenglow | stars + moon | cloud shadows | frost / mist / rainbow |
|---|---|---|---|---|---|
| Off | - | - | - | - | - (exactly the pre-0.3.2 look) |
| Low | 75 % | yes | yes | yes | - |
| High | 100 % | yes | yes | yes | yes |

Reduced motion (OS or the in-game toggle): same picture, but **time is frozen**: no fog / cloud drift, no frost twinkle, no mist movement.

## Falling leaves (0.6.x, render-only)

`src/render/FallingLeaves.ts` + `src/config/leaves.ts` (every number); tests `tests/render/fallingLeaves.test.ts`.

* **What**: in autumn, leaves drift down from the crowns of deciduous, birch, oak and larch trees near the camera. ONE instanced quad layer = **+1 draw call** (a separate layer was chosen over folding the leaves into `Precipitation`'s pool: that pool is `Points` with one flake shader and is switched off in dry weather, and a leaf needs a silhouette, a spin and a flip, which a point sprite cannot do). Measured at 128 / seed 5, High, zoom 3: 155 -> 156 draw calls, ~0.1 ms JS either way, triangles +2 per drawn leaf (about +300).
* **Pool and sources**: a recycled pool of N leaves (Low 40, Med 120, High 260). Each leaf, when it spawns, binds to a shedding tree within a radius of the view target (iso: half the view height clamped to 8..34 tiles; ride / walk / photo: 16 tiles around the camera), at most 120 source trees, rebuilt when the focus moves 2.5 tiles or every 2 s of render clock. Sapling / young trees do not shed. No trees nearby = no leaves.
* **Season curve** (`seasonLeafStrength`, on the render season position, autumn = 0.5..0.75): zero outside autumn, ramps up over the first 15 % of autumn (about a week in October), holds mid-autumn, fades to nothing from 62 % (mid-November) so the last leaves go as the snow arrives; December is zero. **Weather** (`leafDensity`): rain x 0.3 and snow x 0.08 at full intensity (wet leaves stay down), wind lifts the density by up to 50 % and the drift speed; a slow gust wave modulates the drift. Each leaf has a stable hash threshold, so the density changes fade leaves in and out one by one (never a wave).
* **Motion** (`leafPose`, pure): fall 0.6-1.2 tiles/s (x 1 + 0.5 wind), a slow sway, a screen-plane spin and a flip that squashes the leaf to a sliver and back (a tumble), drift +x / +z with the wind, lands on the ground (`surfaceHeight`), lies flat and fades over 1.6 s, then recycles. A leaf's cycle is 5-6.5 s with a hashed offset per leaf. Reads the layer's own render clock (accumulated frame `dt`), so `__slope.frameStep` reproduces it exactly; no `Math.random`, no `performance.now()`, no `gl_FragCoord`, world-space motion only.
* **Look**: a pointed-ellipse leaf with a stalk and a darker midrib and rim, from the fragment shader (no texture, no asset); colours from an 8-entry autumn palette (golds, oranges, reds, browns) picked per leaf by hash; dimmed at night with the shared night uniform. Size 0.2-0.29 tiles (13 Nov 2026: was 0.3-0.44, which read too large; about 65 % now, about 20 px long at iso zoom 5 and still visible but not loud among the canopy; the promo film boost `fallingLeaves.sizeScale` 2.2 -> 1.9), with a floor of 8 device pixels (scaled with the render height like the snow, `precipPixelScale`) so it reads at iso zoom; in perspective views the size is x 0.3. Alpha-blended, depth-tested, no depth write, one draw call, skipped by the shadow pass.
* **Gating**: Atmosphere **Off** = none (and the title demo / DEMO never shows them); Low and High both show them; quality tier sets the pool (Low 40); only near the camera in iso (full at view height <= 60 tiles, gone at >= 110). **Reduced motion**: a still scatter of leaves on the ground around the source trees, nothing falls. Photo mode captures them like the snow.
* **QA**: `__slope.atmos.force({ leaves: 260 })` forces that many leaves in any season / weather (clear with `force(null)`); `__slope.fallingLeaves.drawn`. Shots use the prefix `leaves-`; the flicker scene is `64-autumn-leaves` (forces the full pool).

## Not done / honest limits

* **Northern lights dropped** (owner decision). No separate low-cloud sprite layer: valley fog + cloud shadows cover it. No god rays, no stronger long-shadow geometry (the sun already has a low elevation floor; the "long shadow feel" is the warm grade).
* Guests, animals, lift cabins and the map's side skirt are plain materials: they are not fogged (they stay crisp inside a bank, which also keeps the game readable).
* In iso the sky is only visible at the screen corners, so stars / moon / rainbow matter in ride, walk and photo views.
* Agents render with SwiftShader: the real-GPU look, banding and taste need the owner's eyes (`docs/playtest-m70.md`).

## QA

`__slope.atmos.force({ fog:1, inversion:true, special:1, frost:1, mist:1, rainbow:1, stars:1, moonPhase:0.5, cloudShadow:0.3, hour:8, day:N })`, `.level('off'|'low'|'high')`, `.state()`, `.suggestions()`. Shots use the prefix `atm-` (`.weave/shots/`). `npm run flicker -- --atmos off|low|high [--atmos-force "js"]`.
