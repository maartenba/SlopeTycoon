---
title: "Building"
order: 3
summary: "Placing buildings, access rules, auto-flatten, rotating, undo and redo, bulldozing, the Terrain drawer, trees and the Landscape drawer (ponds, decor)."
description: "How to place buildings in Slope Tycoon: access rules, auto-flatten, rotating, undo and redo, bulldozing, terraforming, trees and the Landscape drawer."
screenshots: [ui-buildings-drawer, ui-terrain-drawer, ui-landscape, landscape-pond]
---
{{fig:ui-buildings-drawer}}

## The Buildings drawer

Buildings are grouped in tabs: **Core**, **Services** (restaurants, shops, parking…), **Lodging**, **Kids**, **Safety**, **Operations**, **Snow**, **Water**, **Energy** (solar, wind, hydro, biomass, nursery, recycling: see [Operations & safety](page:operations)), **Recreation** and **Transport**. Each card shows the price and a small **season tag** (a hint only: you can build anything in any season): some buildings only earn their keep in winter (ski school, Après-Ski Bar, snowmaking cannons), some in summer (Adventure Park, beach, boat rental) and some all year. Hover a card for cost, upkeep, footprint and requirements.

> [!TIP] Press <kbd>1</kbd>–<kbd>9</kbd> to pick the Nth card while the Buildings drawer is open.

## Placing

1. Pick a building. A ghost follows your cursor: **green** is fine, **red** is blocked, and a message tells you why.
2. Rotate with <kbd>R</kbd> (or <kbd>Shift</kbd>+<kbd>R</kbd> back). Press <kbd>F</kbd> to toggle **auto-flatten**.
3. Click to place. Hold <kbd>Shift</kbd> to place several in a row. <kbd>Esc</kbd> or right-click cancels.

### Auto-flatten

Most buildings need level ground. With auto-flatten on, the game plans a tidy cut-and-fill pad under the footprint (with a small retaining wall where needed) and charges you for it. The preview shows the cost; if you can't afford it the placement is refused. Trees on the footprint are cleared. Flattening never touches water, streams, other buildings or pistes.

## Access: “Not connected”

A building can always be *placed*, but it only *works* when it is reachable. Depending on the building it needs a footpath, a road (**shops, chalets and apartments** accept either; a café and the stunt park also accept a piste edge), a rail line (the **Train Station** can stand on the end of a rail line, with a footpath next to it), or to sit beside a piste (a hut, for instance, wants *a footpath, road or piste next to it*). If it isn't, the inspector says **Not connected: needs …** and, for roads, points at the nearest road end. Ranger Rudi will also nag about it.

## Undo and bulldoze

- <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> (or <kbd>Ctrl</kbd>+<kbd>Y</kbd>) redoes. **Everything you build is covered**: buildings, lifts, path / road / rail / piste strokes, bulldozing and even a whole terraform or tree-planting drag (one drag is one step). The last 10 actions are kept, and only on the same in-game day.
- Undo refuses, and tells you why, if guests are inside or riding, if the money isn't there or if the ground around it has changed. A new action clears the redo list.
- <kbd>X</kbd> or the **Bulldoze** button removes buildings, lifts, paths and pistes.

## Terrain and trees

{{fig:ui-terrain-drawer}}

The **Terrain** drawer is sculpting only. Like Buildings and Pistes it has a card rail on the left (raise, lower, flatten, smooth and more, each with an icon, a key badge and a hover card) and a control column on the right: the **target** (corner or area), **brush size**, the **maximum slope** and a live ghost showing the **cost and number of tiles** before you drag. Keys <kbd>1</kbd>–<kbd>4</kbd> pick a tool while the drawer is open, <kbd>[</kbd> <kbd>]</kbd> change the brush. Slopes can't be steeper than the maximum edge step you set. Trees are in the **Landscape** drawer, **Nature** tab: the **Plant** and **Clear** tools paint trees: saplings grow over about four months and never on pistes, paths, buildings or water. Felling forest and planting it back also feeds the *sustainability* bar of your rating (see [Events & the region](page:events)).

> [!NOTE] Lifts have their own tool: pick a lift type, click the bottom station, then the top station. More in [Lifts & pistes](page:lifts-pistes).

> [!TIP] **Build in any season.** Nothing is locked by the calendar: every building, lift, path, piste and landscape item can be placed in any season. The season badges are only hints about when something earns money.

## Landscape: ponds, terrain, nature and decor

The **Landscape** drawer is where the scenery lives: water, trees and decoration. **Trees are only here** (Nature tab); the Terrain drawer no longer has tree tools.

{{fig:ui-landscape}}

The **Landscape** drawer (between Terrain and Bulldoze) has four tabs:

| Tab | What you can do |
|---|---|
| **Water** | **Dig pond**: drag a rectangle of 3 to 11 tiles (or click for the default size, <kbd>[</kbd> <kbd>]</kbd> change it). **Fill in** turns a pond you dug back into ground. |
| **Terrain** | Raise, lower, flatten and smooth, the same brush as the Terrain drawer. |
| **Nature** | Plant and clear trees, paint **boulders** and remove them (natural ones too). |
| **Decor** | Bench, lamp post, flower bed, hedge, picket fence, stone wall and fountain, plus an eraser. Oriented pieces follow your drag direction; <kbd>R</kbd> turns them. |

{{fig:landscape-pond}}

- **Unlock**: in Career, digging ponds unlocks at **resort level 2** (*Local favourite*). Everything else in the drawer is available from the start, and Sandbox has it all.
- **Ponds** need nearly level ground, at least two tiles from other water, buildings and pistes (three from lifts). They cost about **$70 per water tile plus earthworks** (a 5×5 pond is roughly $1,500 to $3,000); filling in costs $35 per tile. A pond freezes over in winter like a natural lake and counts as a lake for a Beach or Boat Rental. Digging works in every season.
- **Boulders** cost $25 each (removal $12). **Decor** costs $25 to $80 a piece (bench $60, lamp $80, flower bed $40, hedge $30, fence $25, wall $45) and the **fountain $600**; none has upkeep and the eraser is free. Decor needs dry, fairly level ground without trees or rocks, and occupies its tile.
- Undo and redo (<kbd>Ctrl</kbd>+<kbd>Z</kbd>) cover the whole drawer: one drag is one step. Its keys are listed in [Shortcuts](page:shortcuts).
