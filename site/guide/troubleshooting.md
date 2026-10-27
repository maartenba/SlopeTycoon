---
title: "Troubleshooting & FAQ"
order: 15
summary: "Fixes for the common problems: a black screen, slow frame rate, guests not arriving, closed buildings and lost saves."
description: "Fix common Slope Tycoon problems: a black screen, slow frame rate, guests not arriving, closed buildings and lost saves, plus a privacy FAQ."
screenshots: [ui-loading]
---
## It stays on the loading screen

{{fig:ui-loading}}

The splash shows a slim progress bar with the current stage (*Loading the mountain…*, *Carving the terrain…*, *Planting trees…*, *Warming up the lifts…*). On a slow device a hint appears after about 8 seconds: keep waiting, the first load of a large map takes longest. If starting fails the splash says so and offers a **Reload** button. New game and Continue use the same screen.

## The game shows a blank or black screen

Slope Tycoon needs **WebGL 2**. Use a current Chrome, Edge, Firefox or Safari, make sure hardware acceleration is on, and try reloading. Strict privacy modes and some remote desktops disable WebGL.

## It is slow

Lower **Quality** (Settings or the *Graphics* menu in the top bar), shrink the browser window, use a smaller map, or switch to **Reduced motion**. Large 256-tile maps with thousands of guests are the heaviest.

## A cannon, run or lift is not doing what I expect

A snow cannon that is idle says why (*Off by you*, *Paused: snowline above this piste*, *Auto: waiting for cold*): see **Operations → Lifts → Snowmaking**. A run that guests ignore may be *Closed by you* in **Operations → Runs**. A lift that closed for a few days is probably in its **annual service** (**Operations → Maintenance**), announced in the news the day before.

## Nobody is coming

Check, in order: is a **lift open** and connected to a **piste**? Is there a **Parking** building, and are it and the **Base Lodge** connected by road and path? Is it the right season (a ski-only resort gets few visitors in July)? Is the day pass far too dear (see [Money](page:money))? Ranger Rudi's Advice list usually names the problem.

## A building says “Not connected” or “Closed”

*Not connected* means it lacks a path, road or rail link (see [Building](page:building)). *Closed* followed by a reason such as *too warm at 1,240 m* or *no snow* means conditions are wrong for that building. It reopens by itself.

## My lift can't be built

Read the red message: too steep, too long, or the cable would hit a tree, roof or lift tower, or the towers would need to be taller than allowed (shorten the span or pick another route). See [Lifts & pistes](page:lifts-pistes).

## The progress bar for a goal does not move

Goals are checked once per in-game hour. Let time run, or use **Show me** to see what is missing.

## My saves disappeared

Saves live in browser storage. Clearing site data, using private windows or switching browsers hides them. Export `.slope` files for safety (see [Saves & offline](page:saves)).

## Can I use it on a phone?

Yes. The game has touch support (gestures, a pan / paint toggle, two-step placement and on-screen controls for walk, ride and photo mode) that switches on by itself on a touch screen. Tablets work well; phones are playable but cramped. If it does not switch on (or switches on by mistake), see Settings → Accessibility → Touch controls. Details in [Touch & tablets](page:touch). Desktop with a mouse is still the most comfortable.

## Is anything tracked or uploaded?

Your saves, photos and reports never leave your device, and there are no accounts or ads. The only thing that can be sent is **anonymous usage statistics (Google Analytics), and only if you allow it**: it is off until you say yes, and you can switch it off again in Settings → Privacy or with the footer link on this website. Details on the [privacy & analytics page](../../privacy/).

## I found a bug

Please open an issue on the GitHub repository linked in the website footer, with your browser, what you did and (if possible) an exported save.
