# Promo video storyboard (M7.6, storyboard stage)

Status: **video pipeline built; 2026-11-10: ONE 2560x1440 / 30 fps file per cut (`npm run promo:video -- --final --cut both`), owner feedback round 2 done (groomer, camera wobble, snowflakes, logo reveal, end card, music ending), see "Round 2"**. The earlier 4K master / web-variant pipeline was removed (details below are kept as history). Plan: `.weave/plans/slope-tycoon-phase7.md` M7.6. The storyboard stills (below) are the older stage; the video plan is `film` in `promo/scenes.json`.

## Files

| File | What |
|------|------|
| `promo/scenes.json` | The scene manifest: scene id, map (128 / seed 5), start date + hour, weather and atmosphere forcing, setup ids, camera keyframes (`at` anchor + `dx`/`dz` tile offset, `zoom` = multiple of the minimum zoom, `yaw` = degrees from the default iso yaw, or `view: lift\|ride`), duration, caption, music cue, and `cuts` (which edit uses the scene and where: `c90` = the 90 s cut, `c30` = the 30 s teaser, `c30Keys` = the stills used there). New content adds a scene. No voiceover; short captions only. Music: "Seasons of Management" (alt "Seasonal Menu"), one clean edit per cut ("Round 3"). |
| `scripts/promo/stage.ts` | Boots the real game once per scene (dev server + Chrome SwiftShader), runs the scene's setups, shoots one still per camera keyframe at 2560x1440, High quality, atmosphere High, shadows on, UI hidden, resort name `Alpenglow`. |
| `scripts/promo/setups.ts` | The page-side staging steps keyed by setup id (`base-large`, `guests:N:mix`, `crowd:N:mix`, `apres`, `grooming-night` (+ key option `worn`), `coaster`, `sled`, `skystrip`, `concert`, `almabtrieb`, `river`, `rafting`; `lift-draw` / `run-paint` are notes for the video stage). |
| `scripts/promo/lib.ts` | `window.__promo` (anchors such as `baseLodge`, `top:gondola`, `mid:chair8`, `piste:1`, `snowcat`, `skyact`, `concertStage`; camera pose; placement with a road fix-up). |
| `scripts/promo/sheet.ts` | The contact sheet: `.weave/promo/storyboard/storyboard.html` (+ `storyboard-90s.png`, `storyboard-30s.png`). |

## Re-shooting the stills

```
npx vite-node scripts/promo/stage.ts --tag v2                       # all scenes, 2560x1440 (about 10 min)
npx vite-node scripts/promo/stage.ts --draft --only 05,08 --tag q   # 1280x720, some scenes
npx vite-node scripts/promo/stage.ts --eval "js" --only 06 ...      # run js in the page after staging and print it (debugging)
npx vite-node scripts/promo/sheet.ts --tag v2                       # contact sheet from the stills with that tag
```

Stills land in `.weave/promo/storyboard/<NN>-<id>-<a|b|c>-<tag>.png` (git-ignored). Use a **new `--tag` every run**: the image read tool caches by path. `--manifest <file>` shoots a scratch manifest (camera probes). Staging uses the Career unlock bypass and the demo resort (`buildDemoResort('large')`), the real placement rules, `jumpSimToDay`, `atmos.force`, `events.start` and the QA handle only; no game code changed.

QA-only overrides in the stills (render side, never shipped): the Schirmbar / bars report "serving", the sky centres and ramps report a few users so plane, canopies and gliders are drawn, a worn-piste flag so the snowcats have work.

## Honest limits (SwiftShader)

* Stills are software-rendered; no real GPU frame rate, no audio, no motion. The lift line "drawing itself", the run being painted and the spring melt are **animations** that a still cannot show.
* Valley fog at dawn reads as a pinkish haze; falling snow in the storm is sparse at heavy snow (precipitation density); the Schirmbar's banner text is not legible at the storyboard angles.
* Rafting cannot be staged (see below).

## Video pipeline (7.6.1 / 7.6.2)

```
npm run promo:towns                                   # build + save the staged towns (game save format) into .weave/promo/towns (git-ignored, ~130 kB each, ~1.5 min for all six)
npm run promo:capture -- --draft --jobs 3             # 1280x720, 12 fps, JPEG q88: every shot of the 90 s cut (15 shots, 1023 frames)
npm run promo:capture -- --draft --cut 30             # only the shots the teaser uses (the teaser reuses the 90 s frames: first `len` seconds of each shot)
npm run promo:capture -- --draft --shot s07b --force  # re-shoot ONE shot (prefix match); `--len 2` shortens it for camera probing; `--eval "js"` prints page state after staging; `--fps N`, `--freezecam 1` (camera stays at its first pose: isolates content flicker), `--tag x` (frames/<res>-x, never mixes resolutions), `--manifest f.json` (scratch camera variants)
npm run promo:capture -- --final --jobs 3             # 2560x1440, 30 fps, JPEG q97 (the only final resolution; frames/final)
npm run promo:video -- --draft --cut both             # ffmpeg: segments + logo + captions + end card + music -> .weave/promo/out/draft-90.mp4, draft-30.mp4 (+ -poster.jpg)
npm run promo:video -- --final --cut both             # THE command: captures the missing shots (resumes), assembles, writes slope-tycoon-90.mp4 + slope-tycoon-30.mp4 (+ -poster.jpg each) into .weave/promo/out; `--no-capture` assembles only, `--jobs N`, `--cut 90|30|both` (anything else is an error), `--reuse 1` keeps the picture master and redoes audio only, `--no-music`
```

* **`__slope.frameStep(dt, n)` (QA only, `src/main.ts`, `src/core/frameStep.ts`, `Renderer.stepFrame`)**: pauses the rAF loop, owns a virtual clock (`performance.now()` returns it while stepping, so water, tree cross-fades and every UI cadence read it), and draws `n` frames of exactly `dt` seconds. The sim runs through the real `TickLoop.advance(dt)` at `__slope.frameStepRate` (a `timeScale`), so guests, carriers and lift motion are the normal game at that speed. Every per-frame subsystem already takes the frame `dt` (precipitation, atmosphere, smoke, water, apres notes, nature, ShadowRig cadence, ...), so the same dt list gives the same frames. `__slope.frameCam = (t, dt) => void` runs first in each step (camera paths as a pure function of the virtual time, `src/render/PromoCamera.ts`); `frameStepEnd()` resumes the real loop; `frameHash()` = `stateHash`. Audio is untouched.
* **`?stepmode=1` (dev server only)** starts the renderer already stepped, so NO real-time frame ever runs and every render clock starts at 0: two page loads give identical frames. Without it the clocks start from however many real frames the boot happened to draw (the check below fails: snow particles differ). The capture runner always uses it, and runs 8 `dt = 0` pre-roll frames per shot so terrain / prop builds settle.
* **Determinism check**: `npx vite-node scripts/promo/frameCheck.ts` boots the game twice, steps 30 frames at sim rate 2 with an orbiting camera and compares `stateHash` + the SHA-256 of every frame's pixels: PASS (30/30 identical, 30 distinct frames).
* **The sky is a CSS gradient behind the transparent WebGL canvas** (`Lighting.skyElement`): the grab composites it into a 2D canvas first (`__promo.comp`), otherwise the sky is black / transparent.
* **Towns**: each town is a real game save (`encodeSave`) plus an `<id>.info.json` (piste mid-points, sled line, state hash). Shots load `?load=promo-<town>` (the runner puts the saves into the browser's IndexedDB first), then apply only date / hour / weather / atmosphere / guests / camera (the shot's `after` setups). Towns: `winter` (blue hour, build montage, busy slopes, golden hour, storm + night groom, night pull-back), `apres`, `spring` (+ alpine coaster), `sled`, `summer` (grass strip, skydive centre, launch ramp, landing field), `autumn`. QA overrides (bars serve, sky centres report users, worn pistes) are re-applied per shot (`qa-serving`, `qa-sky`, `worn`). Nothing is forced for the rare visitor: it is never staged, and the town builder starts no wildlife encounter.
* **Camera keyframes** (`film.shots[].keys`, seconds): `mode: iso` = `{ t, at, dx, dz, zoom, yaw, ease }` (ortho, zoom is log-interpolated); `mode: free` = `{ t, at, dx, dz, h, look: { at, h | track }, fov, ease }` (a perspective camera through the ride rig's QA `view.freeCam`, so low shots, narrow FOV and upward shots work; `look.track` = `plane` / `canopy` / `glider` from `SkyActivity`'s own pose functions); `mode: ride` = the real lift ride-along. Catmull-Rom spline between keys with a per-segment ease; `hour` / `weather` / `days` timelines per shot; `rate` = sim speed (ticks per real second = 1.6 x rate).
* **Capture formats**: `--format jpg|png|webcodecs`. `webcodecs` encodes H.264 (Annex B) inside the page and appends it to `<shot>/video.h264`; the assembler reads either (a shot dir with frames or a `video.h264`).
* **Resume**: a shot with a matching `.done` marker (frame count, size, fps, format) is skipped; `--force` re-shoots; a half-written shot restarts from frame 0 (the sim has to be replayed from the saved town to stay deterministic).
* **Draft assembly** (`assemble.ts`): hard-cut concat (manifest lengths sum to exactly 90 s / 30 s), captions bottom-left (Nunito from `public/fonts`, rendered by headless Chrome as transparent PNGs, faded in / out), the end card (the real `?uikit=logo-full` page, 'Free in your browser', slopetycoon.com), music `menu-seasons-of-management.mp3` at -18 LUFS (the clean edit, see "Round 3").

### Capture-method timings (measured 2026-11-09, `scripts/promo/capbench.ts`, ms per frame = render + capture, demo resort, High quality)

| Method | 1280x720 | 2560x1440 |
|--------|----------|-----------|
| render only (`frameStep`, nothing read back) | 638 | 922 |
| `page.screenshot` PNG (old path) | 674 | 1167 |
| `page.screenshot` JPEG 95 | 408 | 541 |
| `canvas.toDataURL('image/jpeg')` returned as string | 321 | 495 |
| `canvas.toBlob` JPEG 95 -> base64 string | 393 | 496 |
| **`canvas.toBlob` JPEG 95 -> `fetch` POST to a local sink (chosen)** | 373 | 503 |
| `canvas.toBlob` PNG -> POST | 378 | 611 |
| `readPixels` RGBA -> POST raw | 673 | 1526 |
| WebCodecs `VideoEncoder` H.264 chunks -> POST | 341 | 521 |

(The earlier 3.4 s `page.screenshot` PNG at 1440p was the old, un-stepped path; toBlob JPEG is about 2.3x faster than the PNG screenshot here, and the render itself dominates.) WebCodecs is not faster per frame and needs Annex B muxing, so JPEG + POST is the default; `--format webcodecs` exists for a lossy-free 8-bit H.264 route.

### Draft render and projections (this machine, SwiftShader, part of the time other renders ran at the same time, so conservative)

| Run | Frames | Wall time | s / frame wall |
|-----|--------|-----------|----------------|
| draft 720p / 12 fps, 1 job (6 shots, 4 s each) | 294 | 309 s | 1.05 |
| draft, 2 jobs | 294 | 188 s | 0.64 |
| draft, 3 jobs | 294 | 119 s | 0.41 |
| draft full 90 s cut, 2 jobs (15 shots) | 1023 | 443 s | 0.43 |
| final 1440p / 30 fps JPEG, 2 jobs (2 shots x 2 s) | 122 | 70 s | 0.57 (includes ~12 s page boot per shot) |
| final 1440p, WebCodecs, 1 job (1 shot x 2 s) | 61 | 76 s | 1.24 |

Per-shot overhead (page boot, load town, staging) is 10-15 s. SwiftShader is CPU bound but scales with `--jobs` (separate browsers; one hidden tab would stop the sim, so one page per browser) up to at least 3.

**Projected FINAL render** (2560x1440, 30 fps, 2715 frames for the 90 s cut; the 30 s teaser reuses those shots, so it costs nothing extra): about 0.6 s/frame/shot-overhead-included at `--jobs 3` => about **30-40 min**; at `--jobs 2` about 45-50 min; at `--jobs 1` about 1.5-2 h. The assembler (libx264 `-preset slow -crf 14`) adds a few minutes. The draft of both cuts (1023 frames) is about 7-10 min at `--jobs 2`.

## Flicker hunt and the cut script (2026-11-09; the 4K master and the web variants were dropped on 2026-11-10, see Round 2)

**Owner feedback**: redo the videos, watch for flicker, higher definition, fix the cut script.

### Flicker hunt (`scripts/promo/flickerStats.py`, `glitchFrames.py`, `aliasStats.py`; numpy + opencv in a venv)
* `flickerStats.py`: motion-compensated (Farneback flow warps t-1 and t+1 onto t; residual = min of the two differences, so camera motion and occlusion cancel). Share of pixels with residual > 12 (1280x720 luma), per shot, worst frame and worst 8x8 tile. `glitchFrames.py`: a frame whose neighbours agree with each other but not with it. `aliasStats.py`: frames at the target size vs the same frames rendered bigger and area-downscaled ("truth"): the temporal change of the aliasing error = shimmer, no flow needed.
* **Found (before, the 2560x1440 final)**: (1) **a wrong-camera frame in `s08b-glider` frame 41** (64 % of the pixels changed for one frame): the followed guest left, the ride rig ended inside the step AFTER `frameCam` had run, and that frame showed the plain iso camera. (2) **`s03b-ride` was chaos for most of its 4 s** (8.4 % flips, worst frame 74 %): the lift ride camera sits between the cables, every oncoming chair fills the frame for 2-5 frames, and at the old cue (progress 0.58) the rider reached the top station after 0.7 s, so frames 21-25 were inside the station. (3) **Screen-space stipple on trees in every perspective shot** (`s01`, `s03b`, `s07b`, `s08*`): the LOD band cross-fade used `gl_FragCoord` noise (documented as "not fixed" in docs/flicker.md item 7), which crawls under camera motion (a real-game defect in ride / walk / photo views too). (4) Aliasing shimmer of thin geometry (cables, fences, bare branches, roof edges, corduroy) at 1440p: 3.5 % of the pixels shimmer by > 8 levels at 1440p against a 4K reference (4.7 % at 720p). Frozen-camera runs (`--freezecam 1`) show only 0.27 % flips (guests / sim motion), so the rest is camera-motion shimmer, not sim / shadow-cadence / sparkle / cloud-shadow flicker. Shadows: the map is texel-snapped, the sun is quantised to 0.25 degrees (docs/shadows.md); no swimming was found in the residual maps (the residual hotspots are shadow EDGES of cables and towers at sun steps and thin geometry).
* **Fixed**: (1) `P.grab` redraws the frame at dt 0 when no ride rig is active after a step (`film.ts`, up to 3 times). (2) `s03b-ride` is now a **free camera chasing a chair rider from beside the line** (`film.shots[].chase` = `{ p, side, h, back, ahead, lookH, fov }`, rate 0.5): same chairs, tower, forest and run, no oncoming chair in the lens (the real ride camera is unchanged). (3) **Game fix** (render only, same draws): the perspective LOD cross-fade is a stable per-instance hash (`lodHash` / `vLodN` in `src/render/props/Trees.ts`), complementary between the two levels; each tree swaps once, nothing crawls (`npm run flicker` 64 winter rotfine 0.66 %, same as before: the iso views never used the stipple). (4) Supersampling: the film is captured at 3840x2160 and the 1440p / 1080p files are lanczos downscales of it (below); the 4K master itself had 2.2x finer samples than the old final (superseded: round 2 measured native 1440p equal and dropped the supersampling).
* Not changed (honest): the roof / canopy near-hide (3 tiles around a ground camera) still uses screen-space noise but no film shot is that low; sun steps still move long shadow tips by about 2 px at the default zoom in the shots with an hour timeline (`s01`, `s04`, `s10`; sub-0.25 degree sun quantisation would multiply the static shadow passes, see docs/shadows.md).
* **Numbers, 1280x720 luma, shots at 30 fps** (`flickerStats.py`, flip share > 12 / mean residual; before = the 2560x1440 final, after = the 4K master):

| Shot | before | after |
|------|--------|-------|
| s03b-ride (now chase) | 8.43 % / 4.74 (worst frame 74 %) | 0.75 % / 0.34 |
| s08b-glider | 3.06 % / 1.96 (worst frame 64 %) | 0.87 % / 0.98 (worst 2.0 %) |
| s02-build | 2.78 / 1.85 | 2.69 / 1.80 |
| s03-busy | 2.54 / 1.57 | 2.46 / 1.51 |
| s08a-plane (new camera, new plane) | 2.19 / 1.56 (worst 21 %) | 2.48 / 1.65 (worst 7 %) |
| s04-golden | 1.75 / 1.15 | 1.65 / 1.07 |
| s05-apres | 1.68 / 1.21 | 1.64 / 1.18 |
| s09-autumn, s07-seasons, s06a, s06b, s10, s08c, s07b, s01 | 1.46, 1.34, 1.33, 0.93, 0.86, 0.72, 0.78, 0.11 | 1.36, 1.31, 1.21, 0.89, 0.81, 0.70, 0.70, 0.10 |
| **all frames** | **1.81 % / 1.33** | **1.29 % / 1.02** |

The remaining 1-2.7 % in `s02` / `s03` / `s04` / `s05` is mostly flow error under fast camera moves over thin geometry (the `--freezecam` floor is 0.27 %), which the supersampling removes from the 1080p / 1440p deliverables. Zero one-frame glitches remain (`glitchFrames.py --ratio 2 --min 4`: 0).

### The cut script
`--cut 90|30|both` is parsed by `scripts/promo/cuts.ts` (`parseCuts`: anything else throws; the old parser turned every value except `30` into `90`). `both` builds the 90 s cut and the teaser in one browser session. The lengths were already exact: the shot lengths in the manifest sum to **83 s + a 7 s end card = 90 s** (and 26 s + 4 s = 30 s for the teaser); the assembler pads each clip by its crossfade (frozen last frame) so a crossfade does not eat running time, and the files are 2700 and 900 frames (`tests/scripts/promoCuts.test.ts` asserts both sums, whole-frame lengths, the end card last, no clip longer than its shot). Honest note: during each 0.4 s (0.25 s teaser) crossfade the outgoing shot shows its frozen last frame while the next one fades in.

## Autumn sequence and the 90 s / 30 s scene table (2026-11-10)

**Owner request**: "When showing the seasons, can we show some more fall imagery in there? Fall is nice. And then the snow comes." The single 5 s `s09-autumn` shot became **five autumn shots (16 s)** that end in the first snow and dissolve into the winter night pull-back. All five use the saved `autumn` town (no new town); the other scenes were tightened by trimming the **cut window** (`cuts.c90 = { len, from }`), so none of their frames had to be re-shot.

| Shot | Cut length | What | Camera / light |
|------|-----------|------|----------------|
| `s09a-larch` (also the teaser's autumn beat) | 3 s (teaser 3 s) | Golden larch / birch / maple bowl above the village, orange + red foliage, long shadows | iso, slow yaw drift + push, 3 Oct, 16.0 -> 16.5 h, special sky 1 |
| `s09b-village` | 3 s | The village in autumn: smoke, hikers, cows (Almabtrieb event) in the pasture | free camera drifting in past the lodge, 4 Oct, 15.6 -> 16.0 h, special 0.7, haze 0.1 |
| `s09c-pond` | 3 s | The pond in the forest, ringed by gold and red crowns, stream mist (High atmosphere) | free camera arcing above the north-west bank, 5 Oct, 15.2 -> 15.7 h |
| `s09d-walk` | 3 s | Low walk-style shot among the autumn trees beside the lift line, deer by the road, long shadows | free camera at 3 m, 6 Oct, 16.6 -> 17.0 h, special 0.8 |
| `s09e-first-snow` | 4 s | Frosty mist at 7 am, the hill already dusted white, flakes start (weather ramp 0 -> 0.95 over the shot), dissolves into `s10-night` | iso push, 18 Oct, 7.0 -> 7.7 h, frost 1, mist 1, fog 0.45, sim rate 1.5 |

**90 s cut** (sum 83 s + 7 s end card): `s01` 8 (was 10), `s02` 5 (6), `s03` 5 (7), `s03b` 4, `s04` 5 (6), `s05` 6 (7), `s06a` 3, `s06b` 3, `s07-seasons` 5 (7), `s07b` 5 (6), `s08a` 4, `s08b` 4, `s08c` 2 (3), `s09a` 3, `s09b` 3, `s09c` 3, `s09d` 3, `s09e` 4, `s10` 8, end card 7. Verified on the 2026-11-10 files: 2700 / 900 frames at 30 fps, video and audio both exactly 90.000 / 30.000 s starting at 0, -18.0 LUFS integrated (90 s, 30 s and the VP9 web file), audio fades out over the last 3 s (RMS -42 dB at the end), the only black frames are the last 0.07 s (the end-card fade). Timings: 4K capture of the five new shots 7.2 min at `--jobs 3` (485 frames, 0.89 s / frame wall) + 2.3 min for the final first-snow re-shoot; assembly of both cuts + web files about 8 min.

**30 s teaser** (26 s + 4 s end card): `s01` 4, `s02` 4, `s03` 3, `s04` 3, `s05` 3, `s07b` 3, **`s09a` 3 (replaces the summer glider shot)**, `s10` 3 (from 5), end card 4. Trimmed windows start at the shot's start except `s03` and `s07-seasons`, which start 1 s in.

Notes (honest):
* (Superseded: since the falling-leaves layer, `docs/atmosphere.md` "Falling leaves", the game has falling leaves; the autumn shots below were captured before it and can be re-shot with leaves: they sit at 3-6 Oct where the real curve is still ramping up, so stage them with `__slope.atmos.force({ leaves: 260 })` (or 3-4 Nov for the natural peak); the layer reads the frame `dt` and so is deterministic under `frameStep`. No film re-render was done.) The game has **no church** (so no bell); the sequence shows the real seasonal tint: autumn tree palette (per-tree staggered gold / orange / red, `src/render/props/Trees.ts`), the golden-brown grass (`uAutumn`) and the snowline creeping down. There are no street trees in the staged village, so the village shot reads through the hillside colour, cows, hikers and smoke.
* Water is a **pond** (the only open water on seed 5; the stream at the east edge is cliff-side); it is flat blue (no reflections in the game), so shot `c` shows colour around it, not reflected colour.
* Real-game calendar: by 12 Oct the upper slopes already carry snow, so the autumn shots use 3-6 Oct (clean gold) and the first-snow shot 18 Oct (white hill, brown valley floor). 6 Nov is already a white valley.
* **Snow only falls as snow when the ground under the view is <= 0.5 C** (`updatePrecip` in `src/main.ts`): an October weather timeline with `kind: snow` drew **rain streaks**. The timeline now takes `valleyT` per entry (`film.shots[].weather[].valleyT`, `P.weather(..., valleyT)`; weather state only) and the first-snow shot sets -3 C. Snow points used to be a **constant screen size** (3.15 px): 1-2 px dots at 3840 px. Fixed in the game in round 2 (below); the old film-only width hack is gone.
* Flicker (1280x720 luma flip share > 12, 4K frames, `flickerStats.py --half 3`): `s09a` 0.69 %, `s09b` 0.60 %, `s09c` 0.25 %, `s09d` 0.46 %, `s09e` 0.37 % (worst frame 0.7 %); the other shots are 0.7-2.7 %, so the new shots are at or below the quietest existing ones.

## Round 2 (2026-11-10): one 1440p file per cut, groomer, wobble, snowflakes, logo, end card, music

**Owner feedback on the 90 s film**: a groomer drove through buildings near the end; the camera wobbled in the first 20 s; "fix the snowflakes"; a logo at the start; a stronger end card; one encoding per cut, no 4K.

### Output: ONE 2560x1440 / 30 fps MP4 per cut (no 4K, no web variants)
* `npm run promo:video -- --final --cut both` captures the missing shots at **2560x1440 native** (JPEG q97) and writes `.weave/promo/out/slope-tycoon-90.mp4`, `slope-tycoon-30.mp4` and `slope-tycoon-90-poster.jpg`, `slope-tycoon-30-poster.jpg`. H.264 High, `-preset slow -crf 17`, yuv420p, bt709 / tv tags, AAC 192 kbit/s 48 kHz, `+faststart`, **-18 LUFS** (90 s: -18.0, 30 s: -18.1; true peak -6 dBFS). Exactly **2700 / 900 frames, video and audio 90.000 s / 30.000 s from 0**, the only near-black frame is the last one (the end-card fade). Sizes: 218 MB (90 s), 76.8 MB (30 s). Manifests (splice plan, trim, timings) go to `.weave/promo/manifests/`. The old `final-*-4k`, `old-2560`, `web/` files and the 4K frame folders were deleted.
* **Supersampling dropped (measured)**: the 4K capture lanczos-downscaled to 1440p versus a native 1440p capture of the same frames (`flickerStats.py --half 2`, `s03-busy` + `s04-golden`, 91 frames each): native 2.433 % flips / 1.603 mean residual, supersampled 2.388 % / 1.669 (native within 2 %, so native is kept; it also halves the render time). The whole native film: **1.30 % flips, mean residual 1.075** (the 4K master was 1.29 % / 1.02). Zero one-frame glitches (`glitchFrames.py --ratio 2 --min 4`). Worst shots (flip share): `s03-busy` 2.8 %, `s03b-ride` 2.6 % (moving camera now, was 0.75 % when it did not move), `s02-build` 2.5 %, `s08a-plane` 2.5 %, `s04-golden` 1.7 %, `s05-apres` 1.7 %; quietest `s01` 0.11 %, `s09c` 0.28 %.
* Timings (this machine, SwiftShader, `--jobs 3`): the full 90 s capture 2839 frames in **25 min** (0.53 s / frame wall, part of it while the unit tests ran; the 4K capture was 36.5 min); one-shot re-shoots 1-4 min; assembly 90 s 34 s (clips) + 70 s (encode), teaser 13 s + 24 s.

### Groomer through buildings: a real game defect, fixed in the game
* **Where**: `s10-night` (the last 8 s before the end card; the same code runs in `s06b`). **Why**: `Grooming.drive` sent every snowcat in a straight line from tile to tile and back to its garage, so the routes crossed lodges, the ice rink, the kids ground, parking, the ticket office and snow cannons. Measured on the saved `winter` town (sim positions every frame): cat 0 was inside a building in 21 of 60 frames (mountain hut, kids ground, snow cannon, ice rink, lodge, parking), cat 1 in 2, cat 2 in 12.
* **Fix** (`src/sim/ops/groomPath.ts`, `Grooming.ts`, `GroomingView.ts`): each leg is a straight line unless it crosses a building footprint (own garage excepted), then an 8-connected A* around the footprints (one tile of clearance first, footprints only as a fallback) with line-of-sight shortcuts; waypoints live in the cat state (`Cat.wp`, optional, saved), a piste tile under a snow cannon is groomed from the free tile beside it (`Cat.hold`), and the drawn (lagging) cat is pushed out of any footprint (render only). Detours drive at drive speed. Tests: `tests/sim/ops/ops.test.ts` "Grooming avoids buildings" (a wall of lodges, a cannon on the piste, `pushOut`).
* **Verified**: per-frame probe at 30 fps on the final shots, **sim positions: 0 frames inside a building; drawn positions: 0** (before the render push-out: 1-8 frames at cannon corners per cat). `s06b` also now follows a snowcat (`film.shots[].trackCat`: the drawn cat through a critically damped spring) instead of staring at an empty village once the cat had driven away. `__slope.groomingView` is a getter on the QA handle.

### Camera wobble in the first 20 s: root causes (`scripts/promo/poseStats.py`, per-frame pose at 30 fps)
1. **`s02` / `s03` (iso): the ortho target followed the raw terrain height** (`heightAt` has a kink at every tile edge), so the whole picture jittered vertically while panning: peak |a| of the target height 289 / 122 units per s^2. Now the ground under the target is a Gaussian-smoothed height (`smoothGround`, 7 x 7 samples): peak 19 / 14.
2. **Per-segment eases stopped the camera at every key** (`inout` / `smooth` give zero velocity at each key: a hesitation at 3 s in `s02`; neighbouring eases that do not match = a velocity jump). The first shots, `s06b` and `s10` use `path: "c2"`: a clamped **C2 cubic spline** through the keys (`sampleC2`: velocity and acceleration continuous, rests only at the first and last key). Peak position acceleration in the pan: 45 -> 11 (x, `s02`), 47 -> 11 (`s03`).
3. **`s03b` (chair chase) read the rider's position per SIM TICK** (0.8 ticks per second at rate 0.5): the camera did not move for 1-2 s, then lurched; and the rider's speed jumps when it boards the chair. Now the rider's position is interpolated with the frame alpha (as the ride rig does) and the tracked point goes through a critically damped spring (omega 2.5): peak accel (z) 312 units / s^2 with the interpolation alone (a boarding jump) -> **5.9**. Rate 0.3 and a rider picked at 5-35 % progress so the chase lasts the whole 4 s.
4. `s01` was already smooth (free camera; peak accel 2.4 -> 1.9 with the spline; nothing sim-driven).

| Shot | peak accel before | after (position units / s^2) |
|------|-------------------|------------------------------|
| `s01` (py) | 2.40 | 1.89 |
| `s02` target x / y / z | 45 / 289 / 48 | 11 / 19 / 11 |
| `s03` target x / y / z | 47 / 122 / 39 | 11 / 14 / 9 |
| `s03b` camera z | 0 (frozen for the whole shot in the probe: tick-stepped) / 312 interpolated only | 5.9 |

### Snowflakes: fixed in the game (`src/render/Precipitation.ts`)
Snow was `gl_PointSize = uSize * 9` = **3.15 px at every resolution**. It is now multiplied by `precipPixelScale(drawing-buffer height)` = `max(1, height / 1080)` (cap 4): 720p and 1080p are unchanged, 1440p x1.33, 4K x2, 1280x720 CSS at DPR 2 (1440 px buffer) x1.33 (`main.ts` passes `renderer.webgl.getDrawingBufferSize`; `tests/render/precipSize.test.ts`). Rain is line segments (1 px lines, world-space length) and has no point size: unchanged. Flicker-safe (a per-frame uniform, no noise). The film's own width hack is removed; the film raises the game's size by `precip.sizeScale = 2.2` (about 9 px at 1440p, the share of the frame the old 4K hack gave) in `film.ts`, snow shots `s06a`, `s09e`, `s10`.

### Logo reveal, end card, music
* **Logo reveal** (first clip, `film.logoReveal`): the real `?uikit=logo-full` asset (PNG rendered by Chrome at the output size) fades in at the centre (0.6 s), holds, shrinks into a small bottom-right mark by 1.7 s (smoothstep on scale + position, ffmpeg expressions), stays until 7 s and fades by 8 s; the hook caption starts at 1.9 s. Teaser: 0.4 s fade, settle by 1.1 s, mark until 3 s, caption at 1.4 s.
* **End card** (7 s / 4 s): the last night frame of `s10` (dimmed, blurred, pushed in 1.75 -> 1.85x on the village so the map edge never shows) behind four layers that fade in 0.4 s apart: the logo, **`slopetycoon.com` in Lilita One at 0.165 x the frame height** (the largest type), "Play it now. No download, no account." (Nunito 800) and "Desktop, tablet and phone." (small); everything rendered by Chrome at 2560x1440 from `public/fonts`.
* **Music**: superseded by Round 3 (below): the splice-to-the-ending crossfade of Round 2 (1.5 s / 1.0 s, onset correlation 0.12 / 0.14) was audible-or-uncertain and is gone.

## Draft scene notes (2026-11-09, 720p / 12 fps; look at `.weave/promo/sheets/` contact sheets)

* **s01 blue hour (10 s)**: lit village (windows, lamps, chair lights) under a violet pre-dawn sky; narrow 36 deg lens rising from ground level over the finished lift line; hour 6.8 -> 7.95 so the light grows into the montage. The "fog banks below the village" are only the game's valley-fog haze, not distinct banks. A free camera needs the horizon fraction from the camera pitch (`preFrame` uses `debugFreeCam` pitch), otherwise the sky gradient is black above the horizon.
* **s07b sled (6 s)**: `follow` camera behind the last carrier of the sled group, looking at the leader (`film.shots[].follow`); the ride is cued on the way down (`cue: { tour: 'sled' }` pushes a cosmetic ride; carriers are view-only); family group in the foreground, pennant stakes pass; carriers glide between ticks while stepping (`main.ts`). The last second holds the final pose at the hut. The track runs in a carved trench, so the banks fill the frame.
* **s03b chair chase (4 s, 2026-11-09)**: was the real lift ride camera (see the flicker hunt: oncoming chairs flash across the lens, the rider reaches the top station within a second at the old cue); now a free camera 3 tiles beside the line, 1.2 above the cable, 5 behind the rider (`chase`), sim rate 0.5.
* **s08a plane (2026-11-09)**: the new rounded plane is bigger, the old camera sat in its flight path (it flew through the lens, one frame of empty strip, a whip pan). Camera is now `pos:62,126`, h 3, fov 34 (7 tiles to the side, plane visible in the whole shot, banking over the chalets); the glider (hand-glider wing, orange) and the canopies (ramp-air, arched stripes, lines, jumper) read well at 4K, `look.track` works with the new meshes.
* **s08a plane / s08b glider (4 s each)**: sky tracks and cues use `game.date.tick + alpha` (what `SkyActivity` draws with), not `loop.tickCount`. The plane scene starts at the strip's south end at ground level (the plane rolls, climbs and circles over the chalets); the glider is shot from above beside the ramp (a glider wing is a 0.01 thick slab: it is invisible edge-on, shoot it from above or below). If the followed guest leaves, the film re-acquires another ride rig so the free camera never drops to the guest view.
* `--jobs 2` gave about 1.7x (draft 90 s cut: 993 frames in 431 s = 0.43 s/frame wall vs 754 s = 0.74 s/frame at 1 job).
* Frames are keyed by shot id: do not run two captures (or a capture and an assemble) at the same time on the same `.weave/promo/frames/<res>` tree.

## Round 3 (2026-11-10): a music edit without an audible seam, a lighter end card

**Owner feedback**: "can we look at not having the music seam?" and "the end card might need a bit less blurring".

### Music: one bar-aligned cut, the song's real ending

* **Analysis** (`scripts/promo/musicFeatures.py`, needs numpy / scipy / librosa in `.weave/venv-audio`; analysis tooling only): beat grid (about 83 bpm for Seasons of Management, 89 for Seasonal Menu), per-beat chroma, level (dB), MFCC timbre, section novelty (checkerboard on a beat-level self-similarity matrix) and the start of the song's final decay; written to `promo/music-<song>.json` (committed, 17-21 kB each). Both songs are through-composed (almost no repeated section), so the planner looks for a bar in the middle that merely *sounds* like a later bar.
* **Planner** (`scripts/promo/music.ts`, pure, `tests/scripts/promoMusic.test.ts` with a synthetic click-track song): the film is `[start, A] + [B, end of file]`: the song from its natural beginning (teaser: its beginning too, or a section start) to a beat A, then ONE jump to a beat B a whole number of bars later, then the song plays to its REAL ending (final cadence + ring-out, which decays to silence in the file itself). A and B are scored on chroma before / after / at the seam and across it (what the listener hears either side), level difference, the speed change needed, where the final cadence lands against the end card (about 82.7 s in the 90 s film, the end card starts at 83 s) and a preference for starting at the real beginning. The whole cut is sped up / slowed down by at most 3 % (`atempo`, pitch-preserving) so the natural ending lands exactly at 90.000 / 30.000 s: no fade-out needed, only a 0.5 s anti-click fade at the very end (the file is already at -65 dB there).
* **Seam**: a 100 ms equal-power (`qsin`) crossfade that ends exactly on beat A (B's downbeat plays in full). `refineSeam` shifts B by up to +/- 40 ms to align the amplitude envelopes when they correlate (>= 0.3; soft pads often do not, then the tracked beat stays).
* **Chosen edits** (Seasons of Management, `npm run` free: `npx vite-node scripts/promo/musicCheck.ts -- --cut 90|30 [--song seasonal-menu]`, renders `music-*.wav`, `seam-check-*.wav` = seam +/- 3 s and `seam-check-*-ending.wav` = the last 12 s into `.weave/promo/out`): **90 s**: 0 -> 33.112 s, jump to 82.709 s -> end (49.6 s of the middle section removed), speed +0.40 %, chroma cosine before / after / across / at the seam 0.93 / 0.92 / 0.97 / 0.77, level step 0.1 dB; **30 s**: 0 -> 8.290 s (the intro), jump to 119.009 s -> end, speed -2.53 %, 0.82 / 0.85 / 0.97 / 0.57, 0.2 dB.
* **Measured** (`scripts/promo/musicVerify.py` on the audio extracted from the finished mp4; numbers from 2026-11-10): the largest sample step at the seam (0.011 / 0.016) is below the 99.9th percentile of the whole track (0.029 / 0.028), i.e. no click; the biggest 10 ms energy step at the seam 4.4 / 4.0 dB against a 99th percentile of 5.8 / 7.2 dB elsewhere; the log-mel distance across the seam (0.4 s before vs 0.4 s after) sits at the 59th / 41st percentile of the same distance at every other 0.72 s position of the film (a normal beat-to-beat step); chroma across-the-seam cosine 0.97 against a natural bar-to-bar median of 0.84 (10th percentile 0.72). The seam is invisible in the spectrograms. **Not verified by ear**: nobody has listened (agents cannot), listen to `seam-check-90.wav` (seam at 32.98 s of the film), `seam-check-30.wav` (8.50 s) and the `-ending` files.
* **Seasonal Menu** (`--song seasonal-menu`, optional): its 90 s edit (42.701 -> 107.749, -1.3 %, mel distance at the 7th percentile, cosine after 1.00) is the cleaner splice, but the cadence lands at 86 s (3 s into the end card) and the song itself is a notch less "title" than the owner's pick; the owner chose Seasons of Management, so that stays the default and `slope-tycoon-90-alt-seasonal-menu.mp4` (same picture, other song) is the A/B file. Its teaser edit is worse (100th percentile). The default is unchanged unless the owner picks it (`--song seasonal-menu` on `promo:video`).
* **Honest limits**: the Suno songs are through-composed, so "same chord, same bar position" is approximate (the chroma at the seam beat is only 0.77 / 0.57 similar; the bar before and after matches better); the teaser jump from the quiet intro into the last section is the audible one of the two (a change of texture at a bar line, as in a normal arrangement change, not a click). Tempo drifts slightly (the tracker's beat intervals vary 3 %), so the grid is the tracked beats, not a fixed tempo.

### End card: less blur, scrim only behind the text

The blur sigma went from 0.012 x height (17.3 px at 1440p, about 15.6 px in the finished frame after the 1.8x push-in) to **0.0042 x height (6 px, about 5.4 px in the frame, 0.35 x the old radius)**; the global darkening (brightness -0.26, saturation 0.82) became a light -0.06 / 0.95; a separate scrim layer (`ec-scrim.png`, rendered by Chrome) darkens only where the text sits: a soft dark ellipse behind the centred stack plus a top and bottom vignette. Lifts, chalets, the rink and the piste read as the game again. Contrast of the white URL against the brightest background pixel around its glyphs (8 px ring excluded; `scripts/promo/endCardContrast.py` on the finished frame): **7.2:1 worst case**, 12.7:1 mean (WCAG; before: 14.2:1 / 17.1:1: the old card was simply darker). The push-in and the staged fade-in of the lines are unchanged. `--endcard-only 1` on the assembler renders only the end-card clip and four stills (`endcard-<cut>-t*.png`) for a quick look.

## Hooks that are still missing

* A staged-build mode (the lift line drawing itself / a run being painted): the shots show the finished build.
* Per-frame sim-date motion is a coarse `jumpSimToDay` every few days (`days` timeline), not a real month of simulated sim time.
* `?stepmode=1` works on the dev server only (`import.meta.env.DEV`); `__slope.frameStep` is a QA handle like the rest of `__slope` (no UI, nothing runs unless called).

## Round 4: the plane no longer flies through a roof (2026-11-10)

Owner report: the jump plane in `s08a-plane` flew through a roof in the first seconds. Cause (a game defect, not staging): the old flight path ignored buildings: after a 6-tile roll it jumped to a circle of radius 5 flown at 0.35 -> 5.5 units, which crossed two houses beside the strip of the `summer` town (24 of the shot's 120 frames inside a roof; 181 of 2000 frames over the whole cycle). Fix in `src/render/SkyActivity.ts` (render only, no stateHash change): `choosePlanePlan` picks the strip end and turn side with the clearest corridor, one continuous circuit (steep climb-out, the way out is the way back), a 1-unit safety floor over any roof. `npx vite-node scripts/promo/planeScan.ts [town]` scans a saved town (after: 0 / 2000 and 0 / 120). `s08a` / `s08b` / `s08c` re-shot (`--shot s08 --force`), both cuts re-assembled.

## Website embed (2026-11-10, preview only: media NOT committed)

The landing page has an optional "Watch it" section (`scripts/site/video.ts`, `site/assets/site.js`, `.vid*` in `site/assets/site.css`): a click-to-play card for the 30 s trailer with a second button that swaps the source to the 90 s film. Self-hosted, no autoplay, `preload="none"`, nothing requested before the visitor presses play, no external host. Web encodes (`ffmpeg`, 1920x1080 H.264 High, AAC 128k, `+faststart`, bt709, -18 LUFS kept) go in `site/assets/video/`: `trailer-30.mp4` (crf 24, maxrate 2200k, ~7.6 MB), `film-90.mp4` (crf 23, maxrate 2400k, ~25 MB), `trailer-poster.jpg`, `film-poster.jpg` (1280 wide). Captions: `npx vite-node scripts/site/video-captions.ts` writes `trailer-30.vtt` / `film-90.vtt` from this manifest; the track is `kind=captions`, not `default` (the same text is already burned into the picture). If the mp4 / poster / vtt files are missing the section and the VideoObject JSON-LD are left out, so the site still builds and passes `site:check`. `site:check` caps every file in `assets/video/` at 30 MB.


### Committed trailer and film (owner decision 2026-11-10, replaces "trailer only")

Both web encodes are committed (they stay in git history): `site/assets/video/trailer-30.mp4` (~8 MB), `film-90.mp4` (~26 MB, under the 30 MB `site:check` cap), `trailer-poster.jpg` (frame at 10 s of the 30 s cut: busy village), `film-poster.jpg` (frame at 70 s of the film: the golden autumn forest, bright, no caption or logo) and the two `.vtt` files. Both were checked against the final `.weave/promo/out` masters (same duration, PSNR vs a fresh 1080p encode min 30 dB, many frames identical, i.e. the plane fix and the round 3 music/end card are in). The build still copes with the film files being absent (the button, `data-film` and the film VideoObject are left out); `tests/site/video.test.ts` covers both states.
