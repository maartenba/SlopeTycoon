# Promo video storyboard (M7.6, storyboard stage)

Status: **video pipeline built and the 4K master rendered; 2026-11-10: autumn sequence reworked, see "Autumn sequence"** (2026-11-09: 3840x2160 / 30 fps frames, `final-90-4k.mp4`, `final-30-4k.mp4`, web encodes; see "4K master" below). The older 2560x1440 final was replaced. Plan: `.weave/plans/slope-tycoon-phase7.md` M7.6. The storyboard stills (below) are the older stage; the video plan is `film` in `promo/scenes.json`.

## Files

| File | What |
|------|------|
| `promo/scenes.json` | The scene manifest: scene id, map (128 / seed 5), start date + hour, weather and atmosphere forcing, setup ids, camera keyframes (`at` anchor + `dx`/`dz` tile offset, `zoom` = multiple of the minimum zoom, `yaw` = degrees from the default iso yaw, or `view: lift\|ride`), duration, caption, music cue, and `cuts` (which edit uses the scene and where: `c90` = the 90 s cut, `c30` = the 30 s teaser, `c30Keys` = the stills used there). New content adds a scene. No voiceover; short captions only. Music: "Seasons of Management" (90 s; alt "Seasonal Menu"), the strongest 30 s of the same song for the teaser. |
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
npm run promo:capture -- --final --jobs 3             # 2560x1440, 30 fps, JPEG q95 (old baseline)
npm run promo:capture -- --final --w 3840 --h 2160 --tag 4k --quality 100 --jobs 3   # the 4K master frames -> frames/final-4k (JPEG q100 = 4:4:4), ~37 min
npm run promo:video -- --draft --cut both             # ffmpeg: segments + captions + end card + music -> .weave/promo/out/draft-90.mp4, draft-30.mp4 (+ -poster.jpg, manifest-*.json)
npm run promo:video -- --final --tag 4k --cut both    # BOTH cuts: final-90-4k.mp4, final-30-4k.mp4 + out/web/*; `--cut 90|30|both` (anything else is an error); `--reuse 1` keeps the picture master and redoes audio + web; `--no-web`, `--no-webm`
```

* **`__slope.frameStep(dt, n)` (QA only, `src/main.ts`, `src/core/frameStep.ts`, `Renderer.stepFrame`)**: pauses the rAF loop, owns a virtual clock (`performance.now()` returns it while stepping, so water, tree cross-fades and every UI cadence read it), and draws `n` frames of exactly `dt` seconds. The sim runs through the real `TickLoop.advance(dt)` at `__slope.frameStepRate` (a `timeScale`), so guests, carriers and lift motion are the normal game at that speed. Every per-frame subsystem already takes the frame `dt` (precipitation, atmosphere, smoke, water, apres notes, nature, ShadowRig cadence, ...), so the same dt list gives the same frames. `__slope.frameCam = (t, dt) => void` runs first in each step (camera paths as a pure function of the virtual time, `src/render/PromoCamera.ts`); `frameStepEnd()` resumes the real loop; `frameHash()` = `stateHash`. Audio is untouched.
* **`?stepmode=1` (dev server only)** starts the renderer already stepped, so NO real-time frame ever runs and every render clock starts at 0: two page loads give identical frames. Without it the clocks start from however many real frames the boot happened to draw (the check below fails: snow particles differ). The capture runner always uses it, and runs 8 `dt = 0` pre-roll frames per shot so terrain / prop builds settle.
* **Determinism check**: `npx vite-node scripts/promo/frameCheck.ts` boots the game twice, steps 30 frames at sim rate 2 with an orbiting camera and compares `stateHash` + the SHA-256 of every frame's pixels: PASS (30/30 identical, 30 distinct frames).
* **The sky is a CSS gradient behind the transparent WebGL canvas** (`Lighting.skyElement`): the grab composites it into a 2D canvas first (`__promo.comp`), otherwise the sky is black / transparent.
* **Towns**: each town is a real game save (`encodeSave`) plus an `<id>.info.json` (piste mid-points, sled line, state hash). Shots load `?load=promo-<town>` (the runner puts the saves into the browser's IndexedDB first), then apply only date / hour / weather / atmosphere / guests / camera (the shot's `after` setups). Towns: `winter` (blue hour, build montage, busy slopes, golden hour, storm + night groom, night pull-back), `apres`, `spring` (+ alpine coaster), `sled`, `summer` (grass strip, skydive centre, launch ramp, landing field), `autumn`. QA overrides (bars serve, sky centres report users, worn pistes) are re-applied per shot (`qa-serving`, `qa-sky`, `worn`). Nothing is forced for the rare visitor: it is never staged, and the town builder starts no wildlife encounter.
* **Camera keyframes** (`film.shots[].keys`, seconds): `mode: iso` = `{ t, at, dx, dz, zoom, yaw, ease }` (ortho, zoom is log-interpolated); `mode: free` = `{ t, at, dx, dz, h, look: { at, h | track }, fov, ease }` (a perspective camera through the ride rig's QA `view.freeCam`, so low shots, narrow FOV and upward shots work; `look.track` = `plane` / `canopy` / `glider` from `SkyActivity`'s own pose functions); `mode: ride` = the real lift ride-along. Catmull-Rom spline between keys with a per-segment ease; `hour` / `weather` / `days` timelines per shot; `rate` = sim speed (ticks per real second = 1.6 x rate).
* **Capture formats**: `--format jpg|png|webcodecs`. `webcodecs` encodes H.264 (Annex B) inside the page and appends it to `<shot>/video.h264`; the assembler reads either (a shot dir with frames or a `video.h264`).
* **Resume**: a shot with a matching `.done` marker (frame count, size, fps, format) is skipped; `--force` re-shoots; a half-written shot restarts from frame 0 (the sim has to be replayed from the saved town to stay deterministic).
* **Draft assembly** (`assemble.ts`): hard-cut concat (manifest lengths sum to exactly 90 s / 30 s), captions bottom-left (Nunito from `public/fonts`, rendered by headless Chrome as transparent PNGs, faded in / out), the end card (the real `?uikit=logo-full` page, 'Free in your browser', slopetycoon.com), music `menu-seasons-of-management.mp3` at about -18 LUFS (90 s: fade in 1.5 s, fade out the last 3 s; teaser: strongest 30 s window by loudness + onset density, bar-snapped, reported in `manifest-*.json`).

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

## 4K master, flicker hunt and the cut script (2026-11-09)

**Owner feedback**: redo the videos, watch for flicker, higher definition, fix the cut script.

### Flicker hunt (`scripts/promo/flickerStats.py`, `glitchFrames.py`, `aliasStats.py`; numpy + opencv in a venv)
* `flickerStats.py`: motion-compensated (Farneback flow warps t-1 and t+1 onto t; residual = min of the two differences, so camera motion and occlusion cancel). Share of pixels with residual > 12 (1280x720 luma), per shot, worst frame and worst 8x8 tile. `glitchFrames.py`: a frame whose neighbours agree with each other but not with it. `aliasStats.py`: frames at the target size vs the same frames rendered bigger and area-downscaled ("truth"): the temporal change of the aliasing error = shimmer, no flow needed.
* **Found (before, the 2560x1440 final)**: (1) **a wrong-camera frame in `s08b-glider` frame 41** (64 % of the pixels changed for one frame): the followed guest left, the ride rig ended inside the step AFTER `frameCam` had run, and that frame showed the plain iso camera. (2) **`s03b-ride` was chaos for most of its 4 s** (8.4 % flips, worst frame 74 %): the lift ride camera sits between the cables, every oncoming chair fills the frame for 2-5 frames, and at the old cue (progress 0.58) the rider reached the top station after 0.7 s, so frames 21-25 were inside the station. (3) **Screen-space stipple on trees in every perspective shot** (`s01`, `s03b`, `s07b`, `s08*`): the LOD band cross-fade used `gl_FragCoord` noise (documented as "not fixed" in docs/flicker.md item 7), which crawls under camera motion (a real-game defect in ride / walk / photo views too). (4) Aliasing shimmer of thin geometry (cables, fences, bare branches, roof edges, corduroy) at 1440p: 3.5 % of the pixels shimmer by > 8 levels at 1440p against a 4K reference (4.7 % at 720p). Frozen-camera runs (`--freezecam 1`) show only 0.27 % flips (guests / sim motion), so the rest is camera-motion shimmer, not sim / shadow-cadence / sparkle / cloud-shadow flicker. Shadows: the map is texel-snapped, the sun is quantised to 0.25 degrees (docs/shadows.md); no swimming was found in the residual maps (the residual hotspots are shadow EDGES of cables and towers at sun steps and thin geometry).
* **Fixed**: (1) `P.grab` redraws the frame at dt 0 when no ride rig is active after a step (`film.ts`, up to 3 times). (2) `s03b-ride` is now a **free camera chasing a chair rider from beside the line** (`film.shots[].chase` = `{ p, side, h, back, ahead, lookH, fov }`, rate 0.5): same chairs, tower, forest and run, no oncoming chair in the lens (the real ride camera is unchanged). (3) **Game fix** (render only, same draws): the perspective LOD cross-fade is a stable per-instance hash (`lodHash` / `vLodN` in `src/render/props/Trees.ts`), complementary between the two levels; each tree swaps once, nothing crawls (`npm run flicker` 64 winter rotfine 0.66 %, same as before: the iso views never used the stipple). (4) Supersampling: the film is captured at 3840x2160 and the 1440p / 1080p files are lanczos downscales of it (below); the 4K master itself has 2.2x finer samples than the old final.
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

### HD pipeline (chosen: 4K capture, JPEG q100 4:4:4, lanczos downscales)
* Capture at 3840x2160 (`--w 3840 --h 2160 --tag 4k --quality 100`): `toBlob` at q >= 100 gives 4:4:4 (`yuvj444p`, 4.9 MB / frame; q98 is 4:2:0, 2.2 MB); 2505 frames = 12 GB, disk is fine. PNG was not used (the 1440p benchmark showed +120 ms / frame, and the JPEG 4:4:4 q100 is visually lossless). Pixel ratio 2 at 1280x720 CSS would have given the same pixels but UI-less canvas rendering is identical, so a plain 4K viewport is used.
* Assembly (`assemble.ts --final --tag 4k`): captions and the end card are rendered by Chrome AT 3840x2160 (relative sizes, vector logo: crisp, checked at 100 %); JPEG (BT.601, full range) -> BT.709 limited range in one lanczos `scale` (`SCALE_IN`); near-lossless x264 intermediates; xfade chain -> libx264 `-preset slow -crf 16` 4K master (`final-<cut>-4k.mp4`, 4:2:0, tags bt709 / tv, AAC 192 kbps, `+faststart`); web files are lanczos downscales of that picture (`accurate_rnd + full_chroma_int`). Music is `loudnorm` + fades + a measured gain trim so the integrated loudness is -18.0 LUFS on every file.

### Render / encode timings (this machine, 14 cores, SwiftShader, `--jobs 3`, measured 2026-11-09)

| Step | Time |
|------|------|
| 4K capture, all 15 shots, 2505 frames (another job was running parts of the time) | 36.5 min = 0.88 s / frame wall (2.1-2.7 s / frame per job; the 1440p run was 18.5 min) |
| 4K re-shoot of `s03b` / `s08a` + `s08b` | 3.4 min / 5.3 min |
| Assembly 90 s: 16 clips + crossfade chain + 4K master (libx264 slow crf 16) | 131 s + 145 s |
| Assembly 30 s | 44 s + 47 s |
| Web 90 s: 1080p H.264 / 1440p H.264 / VP9 / AV1 | 23 s / 42 s / 59 s / 27 s |
| Web 30 s | 8 s / 14 s / 19 s / 9 s |

### Output files (`.weave/promo/out/`, git-ignored)

| File | Resolution | Size |
|------|-----------|------|
| `final-90-4k.mp4` / `final-30-4k.mp4` (masters, crf 16 slow, 34 Mbit/s) | 3840x2160 | 386 MB / 134 MB (with the autumn sequence) |
| `web/slope-tycoon-90-1080p.mp4` / `-30-` (crf 19, maxrate 2.7 Mbit/s) | 1920x1080 | 30.5 MB / 9.9 MB |
| `web/slope-tycoon-90-1440p.mp4` / `-30-` (crf 19, maxrate 6.5 Mbit/s) | 2560x1440 | 68.1 MB / 22.0 MB |
| `web/slope-tycoon-90-1080p-vp9.webm` / `-30-` (crf 33, Opus 160 kbit/s) | 1920x1080 | 30.9 MB / 9.8 MB |
| `web/slope-tycoon-90-1080p-av1.webm` / `-30-` (SVT-AV1 preset 6 crf 38) | 1920x1080 | 31.1 MB / 10.6 MB |
| `final-*-4k-poster.jpg`, `web/slope-tycoon-{90,30}-poster.jpg` | 4K / 1080p | |

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
* The game has **no falling-leaf particles** and **no church** (so no bell); the sequence shows the real seasonal tint: autumn tree palette (per-tree staggered gold / orange / red, `src/render/props/Trees.ts`), the golden-brown grass (`uAutumn`) and the snowline creeping down. There are no street trees in the staged village, so the village shot reads through the hillside colour, cows, hikers and smoke.
* Water is a **pond** (the only open water on seed 5; the stream at the east edge is cliff-side); it is flat blue (no reflections in the game), so shot `c` shows colour around it, not reflected colour.
* Real-game calendar: by 12 Oct the upper slopes already carry snow, so the autumn shots use 3-6 Oct (clean gold) and the first-snow shot 18 Oct (white hill, brown valley floor). 6 Nov is already a white valley.
* **Snow only falls as snow when the ground under the view is <= 0.5 C** (`updatePrecip` in `src/main.ts`): an October weather timeline with `kind: snow` drew **rain streaks**. The timeline now takes `valleyT` per entry (`film.shots[].weather[].valleyT`, `P.weather(..., valleyT)`; weather state only) and the first-snow shot sets -3 C. Snow points are a **constant screen size** (`Precipitation.ts`: "orthographic camera: constant screen size"), so at 3840 px they are 1-2 px dots; the film scales `uSize` with the frame width (`film.ts`, x 1.6 per 1280 px). Possible game defect (not changed): the flakes also shrink on high-resolution / high-DPI screens in the real game.
* Flicker (1280x720 luma flip share > 12, 4K frames, `flickerStats.py --half 3`): `s09a` 0.69 %, `s09b` 0.60 %, `s09c` 0.25 %, `s09d` 0.46 %, `s09e` 0.37 % (worst frame 0.7 %); the other shots are 0.7-2.7 %, so the new shots are at or below the quietest existing ones.

## Draft scene notes (2026-11-09, 720p / 12 fps; look at `.weave/promo/sheets/` contact sheets)

* **s01 blue hour (10 s)**: lit village (windows, lamps, chair lights) under a violet pre-dawn sky; narrow 36 deg lens rising from ground level over the finished lift line; hour 6.8 -> 7.95 so the light grows into the montage. The "fog banks below the village" are only the game's valley-fog haze, not distinct banks. A free camera needs the horizon fraction from the camera pitch (`preFrame` uses `debugFreeCam` pitch), otherwise the sky gradient is black above the horizon.
* **s07b sled (6 s)**: `follow` camera behind the last carrier of the sled group, looking at the leader (`film.shots[].follow`); the ride is cued on the way down (`cue: { tour: 'sled' }` pushes a cosmetic ride; carriers are view-only); family group in the foreground, pennant stakes pass; carriers glide between ticks while stepping (`main.ts`). The last second holds the final pose at the hut. The track runs in a carved trench, so the banks fill the frame.
* **s03b chair chase (4 s, 2026-11-09)**: was the real lift ride camera (see the flicker hunt: oncoming chairs flash across the lens, the rider reaches the top station within a second at the old cue); now a free camera 3 tiles beside the line, 1.2 above the cable, 5 behind the rider (`chase`), sim rate 0.5.
* **s08a plane (2026-11-09)**: the new rounded plane is bigger, the old camera sat in its flight path (it flew through the lens, one frame of empty strip, a whip pan). Camera is now `pos:62,126`, h 3, fov 34 (7 tiles to the side, plane visible in the whole shot, banking over the chalets); the glider (hand-glider wing, orange) and the canopies (ramp-air, arched stripes, lines, jumper) read well at 4K, `look.track` works with the new meshes.
* **s08a plane / s08b glider (4 s each)**: sky tracks and cues use `game.date.tick + alpha` (what `SkyActivity` draws with), not `loop.tickCount`. The plane scene starts at the strip's south end at ground level (the plane rolls, climbs and circles over the chalets); the glider is shot from above beside the ramp (a glider wing is a 0.01 thick slab: it is invisible edge-on, shoot it from above or below). If the followed guest leaves, the film re-acquires another ride rig so the free camera never drops to the guest view.
* `--jobs 2` gave about 1.7x (draft 90 s cut: 993 frames in 431 s = 0.43 s/frame wall vs 754 s = 0.74 s/frame at 1 job).
* Frames are keyed by shot id: do not run two captures (or a capture and an assemble) at the same time on the same `.weave/promo/frames/<res>` tree.

## Hooks that are still missing

* A staged-build mode (the lift line drawing itself / a run being painted): the shots show the finished build.
* Per-frame sim-date motion is a coarse `jumpSimToDay` every few days (`days` timeline), not a real month of simulated sim time.
* `?stepmode=1` works on the dev server only (`import.meta.env.DEV`); `__slope.frameStep` is a QA handle like the rest of `__slope` (no UI, nothing runs unless called).
