# M7.5 playtest: phones show the map (real-device checklist)

Everything below was built and checked with Chrome's touch emulation on SwiftShader (`npm run mobile:audit`, `npm run touch:e2e`). That cannot tell you how it **feels**: finger size, thumb reach, slop, rubber-banding, the notch, the keyboard, real frame rate. This checklist is for an iPhone (Safari, and the installed PWA) and an Android phone (Chrome). The code is `src/ui/components/StSheet.ts` and the phone rules in the components; the design and numbers are in `docs/mobile-ui.md`.

Open the game on the phone (`https://slopetycoon.com/play/`), start a **new game**, and keep the default (Career, size 64 or 128).

## 1. First look (portrait)
- [ ] The map is clearly the biggest thing on the screen (more than half). Top bar is **one row**: Menu, Photo, Statistics, Save, Settings and a `…` button.
- [ ] `…` opens a second row (Rotate, Walk, Graphics, ?, Install) and closes again. Nothing is cut off on the right.
- [ ] The HUD is a **one-line strip** (money, stars, guests). The little arrow expands the date / weather / season for a few seconds, then it folds back.
- [ ] Speed row: pause, 1x, 3x, 10x (and night / skip) are comfortable to hit with a thumb.
- [ ] The goals card is one row. Tapping it opens the list; it scrolls inside itself.
- [ ] Toasts are small, one at a time, above the dock row, and never cover the top bar.

## 2. Sheets (drawers)
- [ ] Tap **Buildings**: a sheet rises from the dock with a grabber bar. It opens at **peek** (tabs + one row of cards). The map above it is still visible.
- [ ] Drag the grabber up: **half**, then **full**. A quick flick moves one step. Drag down: it folds back to peek. A tap on the grabber toggles peek / half.
- [ ] Swipe **sideways** on the card row: the cards scroll, the sheet does not move.
- [ ] Swipe **up** on the cards or the options: the sheet grows first, then the content scrolls. At full, swiping down on scrolled content scrolls back first; only at the top does the sheet fold.
- [ ] Choose a building card: the sheet shrinks to its grabber, a ghost shows on the map, **Place / cancel / rotate** appear above the dock. Tap again to place. Tapping the dock button brings the cards back.
- [ ] Close one drawer and open another: each remembers its own height (Terrain at peek, Finance at half...). Reload: they are remembered.
- [ ] With the sheet at peek you can still pan, pinch and tap the map beside / above it (nothing is blocked by an invisible layer).
- [ ] Turn on **Reduce motion** (iOS Settings > Accessibility): the sheet jumps instead of sliding.

## 3. Camera and tools
- [ ] Dragging the map: the cards (goals, news, Rudi) **fade out** while the finger is down and come back when it lifts, with no layout jump.
- [ ] Pan, pinch, twist: same feel as 0.3.2. Painting (terrain, piste, trees) with the pan/paint toggle works under the sheet's peek.
- [ ] While a tool is active the goals / news / Rudi chips are gone (tool-first mode) and return when you cancel.
- [ ] Inspector: tap a building. A sheet with its name and numbers rises at **peek**; drag it up for the rest. Tap empty ground: it goes away.
- [ ] Rudi's lightbulb badge opens his advice as a sheet, not a screen-covering card.

## 4. Landscape (notch phone)
- [ ] The sheet is a **side sheet on the right** (grabber on its left edge). The cards wrap in a grid. Nothing hides under the notch / rounded corners (safe areas), also with the notch on the **right** side.
- [ ] Top bar and HUD strip are at the left / top; the dock row at the bottom. Rotate the phone back and forth: the layout re-flows without a reload.
- [ ] The Place bar is reachable with the right thumb.

## 5. Safe areas and Safari
- [ ] iPhone Safari: the dock row and the sheet are not hidden by the home indicator; the address bar showing / hiding does not move the layout badly (the page never scrolls).
- [ ] Installed PWA (Add to Home Screen): the same, with the status bar area clear of the top bar.
- [ ] Rubber-banding: pulling down at the top of a sheet does not pull the page; the pull-to-refresh does not trigger anywhere.
- [ ] Double-tap does not zoom the page; pinch does not zoom the page, only the map.
- [ ] Long-press on a button shows its tooltip bubble; long-press on the map does not open a text-selection / image menu.

## 6. Text fields and the on-screen keyboard
- [ ] Settings / Save: tap a text field. The keyboard opens; the field stays visible and the dialog can still be scrolled. Typing `h`, `o`, `m` does **not** trigger hotkeys.
- [ ] Rename a building in the inspector sheet: the keyboard does not push the whole game off the screen; after closing it the layout is back to normal.
- [ ] Landscape + keyboard: the dialog is usable (you may need to scroll).

## 7. Performance and battery
- [ ] Frame rate while dragging the map with a sheet open is as smooth as without it (the sheet animates `height`, not the canvas).
- [ ] Opening / closing sheets repeatedly does not stutter or leak (let it run for a minute).
- [ ] The phone does not get hot faster than in 0.3.2 with the same resort.

## 8. Tablet
- [ ] iPad / Android tablet portrait and landscape: drawers keep the old look (not sheets) but never cover more than about 45 % of the screen. Everything stays tappable at 44 px.

## What to tell me
Anything that felt too small, too slow or in the wrong place. In particular: the **peek height** (196 px), whether the **fade-while-dragging** feels good or flickery, and whether you want the tutorial / Rudi bubble to become a sheet as well (it is still a floating card).

## Gate that was run
`npm run mobile:audit` (asserts map visible >= 50 % in every default state and >= 40 % with a drawer at peek and a tool active, at 390x844, 844x390 and 768x1024), `npm run desktop:diff` (desktop unchanged), the touch end-to-end matrix, and the standard gate. Numbers in `docs/mobile-ui.md` and `CHANGELOG.md` [0.3.3].
