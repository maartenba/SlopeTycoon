---
title: "Touch & tablets"
order: 13
summary: "Playing on a tablet or phone: gestures, the pan / paint toggle, two-step placement, bottom sheets, on-screen controls and the touch setting."
description: "Playing Slope Tycoon on a tablet or phone: touch gestures, the pan and paint toggle, two-step placement, on-screen controls and the touch setting."
screenshots: [touch-phone-hud, touch-phone-place, touch-phone-ghost, touch-phone-land]
---
Slope Tycoon is a desktop-first game, but it works with fingers too. A tablet is comfortable, a phone is playable. There is nothing to install or enable: on a touch screen the game switches itself on.

## Gestures

| Gesture | What it does |
|---|---|
| **One-finger drag** | Pan the map |
| **Tap** | Select or inspect something; aim the ghost of a building or lift station; one dab with a paint tool |
| **Tap again** (or the **Place** button) | Confirm the placement |
| **Pinch** | Zoom |
| **Two-finger twist** | Rotate the view freely (the rotate buttons still snap by 90°) |
| **Two-finger drag** | Pan |
| **Two-finger tap** | Undo |
| **Long press on the map** | Cancel the current tool. In Select it shows the hover highlight, like pointing with a mouse |
| **Hold a finger on a button** | Shows its tooltip for a moment |

## Pan or paint

Tools that you drag across the map (pistes, paths, roads, terrain, trees, ponds, decor) would clash with panning. A small **pan / paint toggle** next to the tool column decides what one finger does: **✋ pan** moves the camera, **🖌 paint** draws with the tool. Putting a second finger down always cancels a stroke and turns into a camera gesture, so you cannot ruin a piste with a stray pinch.

## Two-step placement

On a touch screen nothing is built by accident. Tap where you want a building or a lift station: a ghost appears with its price (or the reason it is blocked) in the bar at the bottom. Move it with another tap, then confirm by tapping the ghost again or pressing **Place**. A lift works the same way: bottom station first, then top station. A long press cancels.

{{fig:touch-phone-ghost}}

## On-screen controls

- **Ride-along**: Recentre, Photo and Pause buttons; drag to look around, pinch for the field of view.
- **Walk mode**: a virtual joystick at the bottom left plus Interact, Hop, Run, Photo and Pause buttons. Look around by dragging; there is no pointer lock on touch.
- **Photo mode**: drag to orbit, pinch to dolly, two fingers to move the focus, Save and Exit buttons.
- The Space key does not exist on a phone: use the **1× / 3× / 10×** buttons (Pause is a button too).

## Screen size

{{fig:touch-phone-hud}}

On a phone the map comes first, so the screen is built from small pieces:

- **One-row top bar.** Menu, Photo, Statistics, Save and Settings stay; the **...** button opens a second row with Rotate, Walk, Graphics, Help and the rest.
- **A one-line HUD.** Money, stars and guests on one line. The little arrow under the top bar expands the date, weather and season for a few seconds.
- **One row of speed buttons**, and the goals card as a single row (tap it for the list).
- **Toasts** are small and show one at a time, above the dock.
- While you **drag the map** the cards fade out so you see everything, and they come back when you let go. While you **place, paint or build a lift** the goals, news and Rudi chips step aside.

### Bottom sheets

{{fig:touch-phone-place}}

Drawers (Buildings, Lifts, Paths, Pistes, Terrain, Landscape, View, Finance, Operations, Marketing, Pricing), the inspector for a building or lift, Rudi's advice and the news list are **sheets** that rise from the bottom with a grab bar.

- A sheet opens low, at its **peek** height: a row of cards or the first lines. **Drag the grab bar up** for half and full height, or tap it to toggle; a quick flick moves one step, dragging down folds it again.
- A swipe **up on the content** grows the sheet first and then scrolls; a swipe **down** scrolls back to the top first and then folds the sheet. Swiping **sideways** scrolls the card row.
- **Pick a card** and the sheet folds to its grab bar, so the ghost and the map are free. Tap or drag the grab bar (or a dock button) to bring the cards back. Each drawer remembers its own height.
- Everything stays at least 44 px. With the keyboard the grab bar answers to the arrow keys, Home, End and Esc.

### Landscape and tablets

{{fig:touch-phone-land}}

On a **landscape phone** the sheet is a **side sheet** on the right (the grab bar is on its left edge) and the cards wrap into a grid, so the map keeps the width. **Tablets** keep the normal drawers, capped at about 40 % of the screen height. The page never zooms, scrolls or pulls to refresh, and notches and home bars are respected.

## Turning it on or off

**Settings → Accessibility → Touch controls**: *Auto* (default, follows your device), *On* or *Off*. Use *On* to try the touch layout with a mouse, and *Off* if a laptop with a touch screen should behave like a plain desktop.

> [!NOTE] Touch has been tested with emulated fingers on a phone, a landscape phone and a tablet, not yet on many real devices. The sheets, the peek height and thumb reach may need tuning. Tell us what you find.
