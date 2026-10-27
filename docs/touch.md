# Touch support and accessibility (M5.5, Task 31)

Touch is a first-class input path. **Settings > Accessibility > Touch controls: Auto / On / Off.** Auto = on when the primary pointer is coarse (`(pointer: coarse)`); `?touch=1|0` in the URL overrides it (used by the screenshot harness). With touch on, `<html data-touch>` and `--touch-min-root: 44px` are set: every shared kit control (`KIT_CSS` in `StElement.ts`) grows to the `--touch-min` size (buttons min-height, sliders, checkboxes). Desktop behaviour with a mouse is unchanged (touch input only reacts to `pointerType === 'touch'`).

## Gestures (iso view)

| Gesture | Meaning |
|---|---|
| One finger drag | Pan the map. With a **paint tool** (terrain, trees, landscape, piste / path / road) and the **✋ / 🖌 toggle** on 🖌 the drag paints instead |
| Tap | Select / inspect (Select, Bulldoze); aim the ghost (building, lift station); one dab with a paint tool |
| Tap again near the ghost, or ✓ **Place** | Confirms a building **or a lift station** (bottom, then top) at the preview (never at a tile a finger-width away) |
| Long press on the map (450 ms) | Alternative action = right-click: cancels the active tool; in Select it shows the hover highlight and stays until the next tap (tooltip substitute) |
| Hold a finger on any button (0.5 s) | Shows the button's tooltip text (title / aria-label) in a bubble for 2.5 s; the click after the release is swallowed (`src/ui/touchTips.ts`) |
| Pinch | Zoom |
| Two-finger twist | Free rotation (the ⟲ ⟳ buttons still snap 90°) |
| Two-finger drag | Pan (in photo mode: pans the orbit focus, like Shift + drag) |
| Quick two-finger tap | Undo (same as Ctrl+Z; also the ↶ button) |

A second finger always cancels a running paint stroke and becomes the camera gesture; the finger left over after a pinch is ignored until it lifts. Once two fingers leave the tap zone the gesture **catches up** with everything they did since touching down (a 60 degree twist turns the view by 60 degrees, not by 50).

Ride-along, walk and photo mode: **one finger passes straight through** to the existing drag-look / orbit; a pinch becomes wheel events (field of view / zoom). The touch bar adds Recentre / Photo / Pause (ride), the **virtual joystick** (bottom-left, held W/A/S/D) + Interact / Hop / Run / Photo / Pause (walk), Save / Exit (photo). These buttons send ordinary key events, so the keyboard handlers stay the only code path.

## Architecture

- `src/render/touch.ts`: **pure** gesture recogniser `TouchGestures` (pointer down/move/up + injected time -> `TouchIntent`s: pan, zoom, rotate, tap, longpress, twoTap, paintStart/Move/End/Cancel), `TapConfirm` (two-step placement), `joystickAxes/joystickKeys`, `resolveTouchEnabled`, `toolKindOf`. Tested in `tests/render/touch.test.ts`.
- `src/render/TouchController.ts`: the DOM glue. Window-capture listeners (registered first in `main.ts`) take touch pointers on the canvas, feed the recogniser, drive `CameraController.panPixels / zoomBy / rotateBy`, and give the **tools synthetic mouse-style pointer events** (`pointermove` + `pointerdown` / `pointerup`, `contextmenu` for long press). Tools therefore keep **one** pointer-events code path (no touch fork; they never look at `pointerType`). Real touch events never reach the tools.
- `src/ui/touchWire.ts`: setting + media query -> controller + `<html>` flags; the dock drawer steps aside (`.peek`) while a ghost is aimed (building / lift: the bar shows the cost / reason instead) and, on a **short (landscape) screen**, for every map tool: choosing a card tucks it away, the **☰ options button** in the left column (compact layouts) brings it back, tapping a dock button too. `src/ui/touchTips.ts`: hold-for-tooltip.
- `src/ui/components/StTouchControls.ts`: the on-screen bar (a 0x0 fixed host; z below the dock and every modal; exempt from the `body.view-*` hiding rules).
- `PlacementTool.confirm()`: place at the current ghost.

## Layout

`styles.css` compact rules apply under 760 px wide or 520 px high: the top bar scrolls sideways, the right column is narrower (and scrolls when taller than the screen), the goals card starts collapsed, the touch tool column sits at the left edge, the dock row scrolls sideways, the drawer spans the screen, the debug panel and the `?` button (the top bar has one) are hidden, safe-area insets are respected. `html, body { overscroll-behavior: none }`, `touch-action: none` on the canvas and `manipulation` elsewhere stop page zoom, scrolling and pull-to-refresh.

## Harness and end-to-end test

`npm run shot -- --viewport 390x844 --touch 1 ...` emulates a touch device (`hasTouch`, `isMobile`, `?touch=1`). Steps: `tap:x,y`, `tdrag:x1,y1,x2,y2`, `pinch:cx,cy,d1,d2`, `hold:x,y,ms`, `eval:js` (result logged; no `;` inside). Shots (`m55c-*`) cover phone portrait / landscape and a tablet: HUD, drawers, placement, modal, ride and walk controls.

`npm run touch:e2e [-- --only camera,walk --viewport phone|land|tablet]` (`scripts/touch-e2e.ts` + `scripts/touch-e2e/{rig,scenarios}.ts`; **gated**, not part of `npm test`, ~55 min for everything on SwiftShader) drives the real game in Chrome with real CDP touch events (`page.touchscreen`, one or two fingers, polylines, twists) and asserts outcomes through `window.__slope` state (`tools`, `touch`, `selection()`, `sim.networks`, `view.walk.mode.state`, `view.rig`, `view.photo`...): 11 scenarios x 3 viewports (phone 390x844, phone landscape 844x390, tablet 1024x768), 585 checks. Failure screenshots go to `.weave/shots/touch2-FAIL-<viewport>-<scenario>-<n>.png`, review shots to `.weave/shots/touch2-*.png`; the exit code is 1 when anything failed. `?touchhold=ms` (harness) sets the tooltip hold time.

Caveats of the emulation (why the script relaxes timings): SwiftShader renders about 8 fps and CDP acknowledges every touch event through the busy main thread, so a 100 ms tap arrives 300-500 ms long. After `resetView` the script therefore sets `tapMs = 1500`, `longPressMs = 4000` and the tooltip hold to 6 s; the long-press and tooltip scenarios put the real values back. **Do not judge the 10 px / 450 ms / 300 ms numbers from it**; they are covered by the pure recogniser tests (`tests/render/touch.test.ts`). `TouchController` now takes times from `event.timeStamp` and skips a long-press tick while the browser reports queued input (`scheduling.isInputPending`), which is what a busy real phone needs too.

### Verified matrix (real emulated touch; checks passed / total per viewport)

| Scenario | What is asserted | Phone | Land | Tablet |
|---|---|---|---|---|
| camera | one-finger pan (world follows the finger), pinch out / in, twist cw 60 deg / ccw 45 deg (yaw amount and screen direction), pure twist keeps zoom, two-finger drag pans | 11/11 | 11/11 | 11/11 |
| placement | tap aims, second tap places, Place button (>= 44 px), two-finger tap = undo, pinch never undoes, long press cancels the tool, long press in Select shows the hover highlight, tap selects a building | 13/13 | 13/13 | 13/13 |
| walk | stick forward / back / strafe, lift = stop, look drag (yaw, pitch), stick + look with two fingers, E / Hop / Run / Photo / Pause buttons, interact card next to the lodge, photo from walk, Exit | 22/22 | 22/22 | 22/22 |
| ride-photo | ride-along start, look drag, Recentre, pinch = field of view, Pause, HUD buttons >= 44 px, Photo from the ride, orbit drag, pinch dolly, two-finger pan of the focus, Save (toast + status), Exit | 17/17 | 17/17 | 17/17 |
| lift | two-step lift stations (preview, second tap or Place), far tap re-aims, undo by two-finger tap, long press cancels | 10/10 | 10/10 | 10/10 |
| strokes | card taps select the tool; paint mode paints (camera stays), pan mode pans (nothing painted), two fingers zoom instead of painting: ski piste, footpath, road, terraform, plant trees, landscape pond (+ landscape: drawer tucks away, options button) | 28/28 | 44/44 | 28/28 |
| trails | the same for hiking and MTB trails (summer) | 13/13 | 21/21 | 13/13 |
| drawers | dock row and card rail scroll by swipe without selecting / placing, card tap selects, close button, drawer body scroll without painting, every drawer opens without page overflow | 15/15 | 15/15 | 15/15 |
| ui | speed / pause / skip menu, hold-for-tooltip, every button / input / option >= 44 px in HUD, Settings, New game, Save, Help, Trophies, About; dialog scroll by swipe; st-select by touch; toggle and slider by touch; text input with the on-screen keyboard keys | 31/31 | 31/31 | 31/31 |
| title | title screen, no page scroll, New Game by tap, Start boots a game, targets >= 44 px | 9/9 | 9/9 | 9/9 |
| page | viewport meta, touch-action / overscroll, no pull-to-refresh, no double-tap or pinch page zoom, no page scroll, no text selection / context menu, rotate to the other orientation and back, 320 x 480 relayout (nothing hangs outside the window) | 18/18 | 18/18 | 18/18 |

### Bugs the end-to-end run found (all fixed, with tests)

- **The walk joystick never worked on a real screen**: `.joy` had no `touch-action:none`, so Chrome cancelled the pointer as soon as it moved. The Pause button in walk mode sent Space (= Hop there; the walk handler swallows it) and Hop sent keydown + keyup in one task, which the per-frame key polling never saw. Now: `touch-action`, a `togglePause` api, Hop holds Space for two frames.
- Taps and drags were lost on a busy main thread (a stalled frame between two events turned them into long presses): event timestamps + `isInputPending` (see above).
- Select's long-press hover info vanished at once: the touch pointer's `pointerleave` hid it (and the Terraform / Plant / Landscape tools hid the overlay on `pointerleave` even when they were not the active tool).
- A slow twist lost the first ~11 degrees (zoom ~20 %, pan 14 px) inside the tap zone; the gesture now catches up on leaving it.
- Lift stations built at the first tap: now two-step like buildings (`LiftTool.confirm / touchHint`, Place bar, hint, dock steps aside). The profile card under the aim point ate the second tap (`pointer-events:none`).
- Photo mode had no way to pan the focus: two-finger drag sends the Shift + drag pointer.
- **Typing in a text field fired hotkeys** (`h` opened Help, `o` cycled overlays, `m` muted, digits switched brushes): inputs inside a shadow root retarget `keydown` to the host; the handlers now use `composedPath()[0]`.
- Layout: the Pistes & Trails drawer gave its card rail a 50 px strip on a phone (Ski piste could not be tapped); the touch column sat under the growing goals card (now on the left); the ride card overlapped its own title and stats; stick and buttons overlapped the view card in portrait; the photo buttons hid under the photo panel; the right HUD column hung off a 320 x 480 screen (now scrolls); on a landscape phone every drawer covered the whole map and closing it cancels the tool (now it tucks away when a card is chosen or the map is touched; the **☰ options** button brings it back).
- Targets under 44 px: speed buttons (32 px wide, now wrap), dock buttons on tablets, the drawer close button, text inputs, toggle / checkbox rows (the hit area grows through an invisible `::before`), st-select options, the title screen's Shuffle button.

## Colour palette (Settings > Accessibility > Colour palette)

`src/config/palette.ts`: `default` or `cbsafe` (Okabe-Ito: sky blue / blue / vermillion / near-black for the four piste difficulties, a yellow / blue / vermillion / purple quality scale, blue / orange / purple for good / bad / info). The neighbours' luminance ratio is >= 1.25:1 (tested), so the set also works in greyscale. Used by: the terrain shader's piste edge rope (uniforms), the piste and quality overlay textures (repaint on change), the slope profile, the piste inspector dot, and `--c-good / --c-bad / --c-info`. Render-only: nothing enters the sim or the stateHash.

## Accessibility review (cheap items fixed, the rest listed)

Fixed: the map canvas has `role=application` + an `aria-label`; **reduced motion now also reaches inside every shadow root** (`motionSheet.ts`: one shared stylesheet; before, only `html[data-reduced-motion] *` existed, which cannot cross shadow boundaries); dock labels no longer drop to 10 px; touch bar buttons all have `aria-label`; the pan / paint toggle exposes `aria-pressed`. Checked OK: every visible button / input has an accessible name (scripted audit over all shadow roots), text/background contrast of the main pairs is >= 5.4:1 (hint 7.2, placeholder 5.4, muted 9.9, accent 11.8, bad 6.1, good 10.5), the amber 2 px `:focus-visible` ring is in the shared kit.

Still open: no screen-reader live region for toasts / advisor tips (toasts are visual), the 3D map itself is not keyboard-navigable beyond the camera keys (no tile cursor), a few small numeric badges are 10 px (`.card .num`), tooltips on `data-tip` are hover / focus only (holding a finger on a button shows its `title` bubble instead, `touchTips.ts`), the colour-blind palette does not touch the guest / building colours or the snow / threat overlays, and nothing is verified with a real screen reader.

## Not verified on a real device

Everything above ran in desktop Chrome with touch emulation and SwiftShader (about 8 fps), driven by CDP touch events. Still unverifiable without real devices: the feel of slop and long-press timing (10 px / 450 ms are guesses; the emulation cannot measure them), real multi-touch ergonomics (finger size, palm contact, thumb reach of the right-hand HUD column), iOS Safari quirks (visual viewport, rubber-banding, safe-area inset values, `100vh`, `:hover` stickiness, the double-tap zoom rule, pull-to-refresh, text selection / callout after a long press), Android Chrome gesture-navigation conflicts at the screen edges, the on-screen keyboard (it shrinks the visual viewport; the emulation only sends key events), real GPU frame rate, haptics, stylus / palm rejection, a landscape notch. The emulation also cannot confirm that the browser would not claim a touch for its own scrolling where `touch-action` is not `none` (it reports no `pointercancel` here). Walk mode pointer lock is not used on touch (drag-look only). Inline text links (About) are below 44 px by design. Known leftovers: the walk info popover is narrow on a phone (text wraps / clips at the right edge); the Pause button does not toggle (resume with 1x / 3x / 10x, there is no Space key on touch).
