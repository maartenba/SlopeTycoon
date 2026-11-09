# Promo video storyboard (M7.6, storyboard stage)

Status: **draft video pipeline built** (M7.6.1 frame-step hook, 7.6.2 capture + draft assembly). The final 1440p render has NOT been started; the owner signs off the draft first. Plan: `.weave/plans/slope-tycoon-phase7.md` M7.6. The storyboard stills (below) are the older stage; the video plan is `film` in `promo/scenes.json`.

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
npm run promo:capture -- --draft --shot s07b --force  # re-shoot ONE shot (prefix match); `--len 2` shortens it for camera probing; `--eval "js"` prints page state after staging
npm run promo:capture -- --final --jobs 3             # 2560x1440, 30 fps, JPEG q95 (long: see the timing table)
npm run promo:video -- --draft --cut both             # ffmpeg: segments + captions + end card + music -> .weave/promo/out/draft-90.mp4, draft-30.mp4 (+ -poster.jpg, manifest-*.json)
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

## Draft scene notes (2026-11-09, 720p / 12 fps; look at `.weave/promo/sheets/` contact sheets)

* **s01 blue hour (10 s)**: lit village (windows, lamps, chair lights) under a violet pre-dawn sky; narrow 36 deg lens rising from ground level over the finished lift line; hour 6.8 -> 7.95 so the light grows into the montage. The "fog banks below the village" are only the game's valley-fog haze, not distinct banks. A free camera needs the horizon fraction from the camera pitch (`preFrame` uses `debugFreeCam` pitch), otherwise the sky gradient is black above the horizon.
* **s07b sled (6 s)**: `follow` camera behind the last carrier of the sled group, looking at the leader (`film.shots[].follow`); the ride is cued on the way down (`cue: { tour: 'sled' }` pushes a cosmetic ride; carriers are view-only); family group in the foreground, pennant stakes pass; carriers glide between ticks while stepping (`main.ts`). The last second holds the final pose at the hut. The track runs in a carved trench, so the banks fill the frame.
* **s08a plane / s08b glider (4 s each)**: sky tracks and cues use `game.date.tick + alpha` (what `SkyActivity` draws with), not `loop.tickCount`. The plane scene starts at the strip's south end at ground level (the plane rolls, climbs and circles over the chalets); the glider is shot from above beside the ramp (a glider wing is a 0.01 thick slab: it is invisible edge-on, shoot it from above or below). If the followed guest leaves, the film re-acquires another ride rig so the free camera never drops to the guest view.
* `--jobs 2` gave about 1.7x (draft 90 s cut: 993 frames in 431 s = 0.43 s/frame wall vs 754 s = 0.74 s/frame at 1 job).
* Frames are keyed by shot id: do not run two captures (or a capture and an assemble) at the same time on the same `.weave/promo/frames/<res>` tree.

## Hooks that are still missing

* A staged-build mode (the lift line drawing itself / a run being painted): the shots show the finished build.
* Per-frame sim-date motion is a coarse `jumpSimToDay` every few days (`days` timeline), not a real month of simulated sim time.
* `?stepmode=1` works on the dev server only (`import.meta.env.DEV`); `__slope.frameStep` is a QA handle like the rest of `__slope` (no UI, nothing runs unless called).
