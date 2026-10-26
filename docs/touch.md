# Touch support and accessibility (M5.5, Task 31)

Touch is a first-class input path. **Settings > Accessibility > Touch controls: Auto / On / Off.** Auto = on when the primary pointer is coarse (`(pointer: coarse)`); `?touch=1|0` in the URL overrides it (used by the screenshot harness). With touch on, `<html data-touch>` and `--touch-min-root: 44px` are set: every shared kit control (`KIT_CSS` in `StElement.ts`) grows to the `--touch-min` size (buttons min-height, sliders, checkboxes). Desktop behaviour with a mouse is unchanged (touch input only reacts to `pointerType === 'touch'`).

## Gestures (iso view)

| Gesture | Meaning |
|---|---|
| One finger drag | Pan the map. With a **paint tool** (terrain, trees, landscape, piste / path / road) and the **✋ / 🖌 toggle** on 🖌 the drag paints instead |
| Tap | Select / inspect (Select, Bulldoze); aim the ghost (building); one dab with a paint tool; place a lift station (lift tool) |
| Tap again near the ghost, or ✓ **Place** | Confirms a building at the ghost (never at a tile a finger-width away) |
| Long press (450 ms) | Alternative action = right-click: cancels the active tool; in Select it shows the hover info (tooltip substitute) |
| Pinch | Zoom |
| Two-finger twist | Free rotation (the ⟲ ⟳ buttons still snap 90°) |
| Two-finger drag | Pan |
| Quick two-finger tap | Undo (same as Ctrl+Z; also the ↶ button) |

A second finger always cancels a running paint stroke and becomes the camera gesture; the finger left over after a pinch is ignored until it lifts.

Ride-along, walk and photo mode: **one finger passes straight through** to the existing drag-look / orbit; a pinch becomes wheel events (field of view / zoom). The touch bar adds Recentre / Photo / Pause (ride), the **virtual joystick** (bottom-left, held W/A/S/D) + Interact / Hop / Run / Photo / Pause (walk), Save / Exit (photo). These buttons send ordinary key events, so the keyboard handlers stay the only code path.

## Architecture

- `src/render/touch.ts`: **pure** gesture recogniser `TouchGestures` (pointer down/move/up + injected time -> `TouchIntent`s: pan, zoom, rotate, tap, longpress, twoTap, paintStart/Move/End/Cancel), `TapConfirm` (two-step placement), `joystickAxes/joystickKeys`, `resolveTouchEnabled`, `toolKindOf`. Tested in `tests/render/touch.test.ts`.
- `src/render/TouchController.ts`: the DOM glue. Window-capture listeners (registered first in `main.ts`) take touch pointers on the canvas, feed the recogniser, drive `CameraController.panPixels / zoomBy / rotateBy`, and give the **tools synthetic mouse-style pointer events** (`pointermove` + `pointerdown` / `pointerup`, `contextmenu` for long press). Tools therefore keep **one** pointer-events code path (no touch fork; they never look at `pointerType`). Real touch events never reach the tools.
- `src/ui/touchWire.ts`: setting + media query -> controller + `<html>` flags; the dock steps aside (`.peek`) while a ghost is aimed on a small screen (the bar shows the cost / reason instead).
- `src/ui/components/StTouchControls.ts`: the on-screen bar (a 0x0 fixed host; z below the dock and every modal; exempt from the `body.view-*` hiding rules).
- `PlacementTool.confirm()`: place at the current ghost.

## Layout

`styles.css` compact rules apply under 760 px wide or 520 px high: the top bar scrolls sideways, the right column is narrower, the goals card starts collapsed, the dock row scrolls sideways, the drawer spans the screen, the debug panel and the `?` button (the top bar has one) are hidden, safe-area insets are respected. `html, body { overscroll-behavior: none }`, `touch-action: none` on the canvas and `manipulation` elsewhere stop page zoom, scrolling and pull-to-refresh.

## Harness

`npm run shot -- --viewport 390x844 --touch 1 ...` emulates a touch device (`hasTouch`, `isMobile`, `?touch=1`). Steps: `tap:x,y`, `tdrag:x1,y1,x2,y2`, `pinch:cx,cy,d1,d2`, `hold:x,y,ms`, `eval:js` (result logged; no `;` inside). Shots (`m55c-*`) cover phone portrait / landscape and a tablet: HUD, drawers, placement, modal, ride and walk controls.

## Colour palette (Settings > Accessibility > Colour palette)

`src/config/palette.ts`: `default` or `cbsafe` (Okabe-Ito: sky blue / blue / vermillion / near-black for the four piste difficulties, a yellow / blue / vermillion / purple quality scale, blue / orange / purple for good / bad / info). The neighbours' luminance ratio is >= 1.25:1 (tested), so the set also works in greyscale. Used by: the terrain shader's piste edge rope (uniforms), the piste and quality overlay textures (repaint on change), the slope profile, the piste inspector dot, and `--c-good / --c-bad / --c-info`. Render-only: nothing enters the sim or the stateHash.

## Accessibility review (cheap items fixed, the rest listed)

Fixed: the map canvas has `role=application` + an `aria-label`; **reduced motion now also reaches inside every shadow root** (`motionSheet.ts`: one shared stylesheet; before, only `html[data-reduced-motion] *` existed, which cannot cross shadow boundaries); dock labels no longer drop to 10 px; touch bar buttons all have `aria-label`; the pan / paint toggle exposes `aria-pressed`. Checked OK: every visible button / input has an accessible name (scripted audit over all shadow roots), text/background contrast of the main pairs is >= 5.4:1 (hint 7.2, placeholder 5.4, muted 9.9, accent 11.8, bad 6.1, good 10.5), the amber 2 px `:focus-visible` ring is in the shared kit.

Still open: no screen-reader live region for toasts / advisor tips (toasts are visual), the 3D map itself is not keyboard-navigable beyond the camera keys (no tile cursor), a few small numeric badges are 10 px (`.card .num`), tooltips on `data-tip` are hover / focus only (long press shows the hover info for the map, not for buttons), the colour-blind palette does not touch the guest / building colours or the snow / threat overlays, and nothing is verified with a real screen reader.

## Not verified on a real device

Everything here ran in desktop Chrome with touch emulation and SwiftShader: no real multi-touch feel (slop and long-press timing are guesses: 10 px / 450 ms), no iOS Safari quirks (visual viewport, rubber-banding, safe-area inset values, `100vh`), no Android Chrome gesture-navigation conflicts at the screen edges, no real GPU frame rate on phones, no haptics, no stylus / palm rejection, and no landscape notch layout.
