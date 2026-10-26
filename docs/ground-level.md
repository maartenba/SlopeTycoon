# Ground-level views (M5.2): overview

Four pieces, all render-only (the sim is untouched; `stateHash` is identical with the views on or off, see tests/render/rideAlong.test.ts and photoMode.test.ts):

| piece | what | doc |
|---|---|---|
| Ride-along | first-person camera on a guest (skier, boarder, hiker, biker, chair / gondola / cable car / funicular rider) | `docs/ride-along.md` |
| Photo mode | free orbit camera, filters, frames, time of day, PNG export + local gallery | `docs/photo-mode.md` |
| Walk mode | first-person on foot: terrain follow, collision, footsteps, E to inspect / board lifts | `docs/walk-mode.md` |
| Close-up LOD | near variants of figures, chairs, cabins, towers, cable, trees, rocks, terrain detail; roof fade; fog | `docs/models.md` ("Close-up LOD") |

Walk mode (Task 12) was approved by the user after the ride-along playtest and is built (`docs/walk-mode.md`); it shares the perspective rig, near LOD, fog and forced-full-res terrain window with the ride-along, adds `walk` to the view state machine (iso <-> walk, walk <-> photo; ride <-> walk is illegal) and returns to the exact iso pose on exit.

## Controls
* **Enter ride**: guest inspector > "Ride along" (select a guest on the slope, in a lift, on a bike). Photo: **P**, top-bar camera button or View drawer.
* **Ride**: Esc exit, **N** next guest, **C** recentre, drag = look (+-100 deg yaw, +-60 deg pitch), wheel = FOV 55..90, Space / + / - / . / , still control the game speed. Everything else on the canvas is swallowed.
* **Photo**: drag = orbit, right / middle / Shift+drag or WASD = move the focus, wheel = dolly, Q / E = focus down / up, Enter = save, Esc / P exit. Panel: hero shot, FOV, time of day, snow / rain, filter, vignette, frame, aspect, 1x / 2x, gallery.
* **Settings**: Graphics (low / med / high: also the ground caps), Gameplay > "Ride-along slow motion" (default On; Off = the game speed you chose).

## Scale
One tile = 10 m for distances and speeds, but figures are drawn 0.52 tiles tall (chibi), so the eye heights are in figure scale: eye = ~0.9 x 0.52 = 0.47 above the feet for skiers / boarders / hikers (head level of the guests next to you), 0.50 on a bike, and cable carriers are positioned against the real seat / cabin geometry. See `docs/ride-along.md` "Eye heights". Trees and buildings are ~10x a figure; deliberate.

## Performance and quality
Walk mode on 128 (med): 178 draw calls, 2.8 M triangles, 0.28 ms JS update (low 161, high 182).

`npm run perf:ground` prints draw calls / triangles / JS update ms in ride and photo on 64 / 128 / 256 (docs/perf.md). Budget: <= 350 draw calls in ride on 128. Measured 102-226. Graphics quality scales: near-LOD radius, near tree / rock caps, near figure count, fog range, terrain detail texture (`QUALITY_PRESETS[q].ground`). Low = near LOD off + no detail texture + closer fog. To tune: edit the three `ground` blocks in `src/config/balance.ts`; the pure budget logic is `src/render/lod/nearLod.ts` (`GROUND_CAPS`, `setGroundCaps`).

## Visual QA
`npm run shot -- --view ride|lift|photo ...` (docs/visual-qa.md); the suites contain `suite-ride-ski`, `suite-ride-lift`, `suite-photo-hero`, `suite-photo-dusk-film` and `ui-s-ride-hud-*`, `ui-s-photo-panel-*`. Page API: `__slope.view.*` (`ride`, `rideLift`, `freeCam`, `setQuality`, `stats`, `photo.*`).

## Known issues / gaps
* No depth of field, no camera roll, no hide-guests toggle in photo mode.
* Building near detail is minimal (roofs fade within 3 tiles; walls are the iso meshes). A wall can fill the view when you stand right next to a building.
* Trees / buildings dwarf the figures (chibi scale). The T-bar station reads as a large machine from the ground.
* Gondola / cable car cabins are shorter than a standing figure (seated riders are hidden inside the solid shell).
* The tree cross-fade is a dither (stipple) between 5 and 11 tiles; visible as grain on trees, more so in screenshots than in motion.
* Lifts close when there is no snow at the top (demo seeds): chairlift POV needs an open lift.
* Mobile touch look and DOF: not implemented (walk mode is desktop only).
* GPU cost on real hardware is unmeasured (only SwiftShader here).

## How to tune
* Eyes / bob / sway: `EYE` in `src/render/view/ViewCameraRig.ts` (+ `FIGURE_HEIGHT`).
* Pacing: `RIDE_TIME_SCALE` (0.15) in `RideAlong.ts` or the setting.
* Fog: `fogRangeFor` (`Fog.ts`) x the preset's `fogRangeScale`.
* LOD distances: `NEAR_TILES` / `MID_TILES` (nearLod.ts), `TREE_RIDE_*` (Trees.ts), `TREE_FADE_W`.
