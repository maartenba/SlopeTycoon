# Promo video storyboard (M7.6, storyboard stage)

Status: **storyboard only**. The scenes are staged in the real game and shot as stills; nothing is recorded as video yet (the deterministic frame-step hook, Task 7.6.1, is not built). Plan: `.weave/plans/slope-tycoon-phase7.md` M7.6.

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

## Cost (measured 2026-11-09, 2560x1440, this machine)

* Render: about **0.53 s per frame** (mean over the 25 stills, max 0.86 s for the lift ride-along).
* `page.screenshot` PNG at 2560x1440: about **3.4 s** (max 4.8 s). Per frame about **4 s** with the PNG capture, so **2700 frames (90 s at 30 fps) about 3 h**, the 900-frame teaser about 1 h.
* Faster capture is likely (CDP JPEG / canvas `toBlob`, about 1 s, **not measured**): then about 1.5 s a frame, 2700 frames about 70 min. Decide in 7.6.2.
* **`--draft` plan** (7.6.2): 12 fps, 1280x720, JPEG; 90 s = 1080 frames, estimated about 20 min (render about a quarter of the pixels; not measured), same scene list and camera paths, burned-in scene numbers. Fixed `dt`, so a draft and the final cut line up.

## Hooks that are missing (not built)

7.6.1 frame-step hook, design in five lines:
1. `__slope.frameStep(dtMs, n)` pauses the rAF loop and the real `TickLoop` clock (`loop.setSpeed(0)`), keeps a **virtual clock** `t += dt`.
2. Every animated uniform / mixer reads that clock (`performance.now()` and `clock.getElapsedTime()` call sites: carriers, guest vertex shaders, water, snow, atmosphere, sky activity).
3. Per step: advance the sim by `floor(t * tps) - ticks` fixed ticks (`loop.advance(1)`), then render exactly once and resolve.
4. The camera director (7.6.2, `DemoCamera` keyframe mode) is a pure function of `t`: position / target / zoom / yaw eased between manifest keyframes; date, hour, weather, atmosphere are keyframes too.
5. Test: two 30-frame captures give the same `stateHash` and byte-identical pixels; debug / QA only behind `__slope`.

Scenes that cannot be staged as designed yet:

| Scene | Gap | Minimal hook |
|-------|-----|--------------|
| 01 lift line drawing itself, 02 a run being painted | Stills show the finished build | A staged-build mode: replay the real lift / piste tool calls (towers placed one per step) on the frame clock |
| 07 spring melt to summer | Stills jump dates; the melt needs stepped days | `jumpSimToDay` per frame batch with the snow flush; camera / date keyframes in the manifest (works once the frame clock exists) |
| 08 rafting | No brisk stream within 30 tiles of the village on any seed 1-16 (nearest 32-109); the base ends up about 50 tiles away under forest canopy at the map edge | Either a manifest scene on another map position with a tree clearing (a QA `clearTrees(rect)`), or a dug river with brisk flow near the village (the planner only reaches the map edge on seed 5: 8 tiles). Scene 08a is a placeholder |
| 03 queue, 06 snowfall | Queue length and heavy-snow density depend on the sim / quality tier | `precip` density override for the shot (render-only) |
| 03 ride-along | Needs a guest on the lift at a stable pace | Already usable (`view.rideLift`), the video stage needs the virtual clock |
| 10 pull-back | 14 s move with a dark scene; lift lights only visible at night | Keyframed camera only |
