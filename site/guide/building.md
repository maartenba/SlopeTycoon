---
title: "Building"
order: 3
summary: "Placing buildings, access rules, auto-flatten, rotating, undo and redo, bulldozing, terrain and trees."
screenshots: [ui-buildings-drawer, ui-lifts-drawer]
---
{{fig:ui-buildings-drawer}}

## The Buildings drawer

Buildings are grouped in tabs: **Core**, **Services** (restaurants, shops, parking…), **Lodging**, **Kids**, **Safety**, **Operations**, **Snow**, **Water**, **Recreation** and **Transport**. Each card shows the price and a small **season tag**: some buildings only earn their keep in winter (ski school, Après-Ski Bar, snowmaking cannons), some in summer (Adventure Park, beach, boat rental) and some all year. Hover a card for cost, upkeep, footprint and requirements.

> [!TIP] Press <kbd>1</kbd>–<kbd>9</kbd> to pick the Nth card while the Buildings drawer is open.

## Placing

1. Pick a building. A ghost follows your cursor: **green** is fine, **red** is blocked, and a message tells you why.
2. Rotate with <kbd>R</kbd> (or <kbd>Shift</kbd>+<kbd>R</kbd> back). Press <kbd>F</kbd> to toggle **auto-flatten**.
3. Click to place. Hold <kbd>Shift</kbd> to place several in a row. <kbd>Esc</kbd> or right-click cancels.

### Auto-flatten

Most buildings need level ground. With auto-flatten on, the game plans a tidy cut-and-fill pad under the footprint (with a small retaining wall where needed) and charges you for it. The preview shows the cost; if you can't afford it the placement is refused. Trees on the footprint are cleared. Flattening never touches water, streams, other buildings or pistes.

## Access: “Not connected”

A building can always be *placed*, but it only *works* when it is reachable. Depending on the building it needs a footpath, a road, both a rail line and a path, or to sit beside a piste (a hut, for instance, wants *a footpath, road or piste next to it*). If it isn't, the inspector says **Not connected: needs …** and, for roads, points at the nearest road end. Ranger Rudi will also nag about it.

## Undo and bulldoze

- <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> (or <kbd>Ctrl</kbd>+<kbd>Y</kbd>) redoes. **Everything you build is covered**: buildings, lifts, path / road / rail / piste strokes, bulldozing and even a whole terraform or tree-planting drag (one drag is one step). The last 10 actions are kept, and only on the same in-game day.
- Undo refuses, and tells you why, if guests are inside or riding, if the money isn't there or if the ground around it has changed. A new action clears the redo list.
- <kbd>X</kbd> or the **Bulldoze** button removes buildings, lifts, paths and pistes.

## Terrain and trees

Open **Terrain** to raise, lower, flatten or smooth the ground (keys <kbd>1</kbd>–<kbd>4</kbd> while the drawer is open, <kbd>[</kbd> <kbd>]</kbd> for brush size). Slopes can't be steeper than the maximum edge step you set. The **Plant** and **Clear** tools paint trees: saplings grow over about four months and never on pistes, paths, buildings or water. Felling forest and planting it back also feeds the *sustainability* bar of your rating (see [Events & the region](page:events)).

{{fig:ui-lifts-drawer}}

> [!NOTE] Lifts have their own tool: pick a lift type, click the bottom station, then the top station. More in [Lifts & pistes](page:lifts-pistes).
