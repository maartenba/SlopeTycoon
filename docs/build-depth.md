# Build depth: full undo / redo, slope profile, run suggestion (M5.4, Task 24)

No blueprints (D8): nothing here saves, shares or imports a layout.

Code: `src/build/UndoStack.ts` (stack + redo list), `src/build/UndoActions.ts` (`Undo`: one recorder per kind of action), `src/build/{TerraformTool,PlantTool,PathTool,PisteTool,LiftTool}.ts` (hooks), `src/sim/PisteStats.ts` (`slopeProfile`, `liftProfile`), `src/ui/components/StProfile.ts`, `src/tutorial/suggest.ts` (`suggestPiste`), wiring in `src/main.ts` (`applyUndoReport`, `performUndo`, `performRedo`, `suggestRun`). Tests: `tests/build/undo.test.ts`, `tests/build/undoAll.test.ts`, `tests/build/profileHook.test.ts`, `tests/sim/trailSuggest.test.ts`, `tests/ui-dom/profile.test.ts`.

## One undo / redo stack for every build action

**Ctrl/Cmd+Z** undoes, **Ctrl+Shift+Z** or **Ctrl+Y** redoes (the Undo / Redo buttons in the Bulldoze pane and the Pistes pane do the same). The 10 newest actions are kept:

| Action | Recorded by | Undo | Redo |
|---|---|---|---|
| Place a building / lift | `Undo.placeBuilding` / `placeLift` | removes it, refunds 100 %, reverts auto-flatten (heights + felled trees) | places it again (same rules, same funds check) |
| Bulldoze a building / lift | `bulldozeBuilding` / `demolishLift` | puts it back (instance state, name, school staff), gives the 50 % refund back | bulldozes it again |
| Path / road / rail / piste / trail **stroke** | `recordNetwork` (from `DragTool`, `record` option) | restores the pre-stroke tiles (Networks journal), refunds the stroke | repaints the post-stroke tiles, charges again |
| Tile bulldoze (path / road / rail / piste) | `recordNetworkBulldoze` | restores the tiles | clears them again |
| Terraform **drag** | `terrainStroke(...).stamp` | restores every moved corner + the trees the drag cleared | reapplies them |
| Plant / clear trees **drag** | `terrainStroke(...).stamp` | removes the planted / restores the cleared trees, refunds (net of timber money) | replants exactly the same trees |

A terraform or planting **drag is one step**, not one per brush stamp: the tool opens a stroke on pointer-down (`beginStroke`), every stamp grows one `TerrainDelta` (first capture of a vertex / prop chunk wins) and updates the one command's money.

Rules (all refused with a plain-language message, the command stays on the stack):

* **Day boundary.** A command belongs to the in-game day it happened on. Undo / redo on a later day says *"Can't undo Café: it was built on an earlier day, undo only works within the same day"* (`DAY_REFUSAL`) and drops both lists (days only go forward).
* **World changed.** Undo checks that the ground, props, tile occupancy and network tiles around the action still look as the action left them (`TerrainDelta.stale`, now including occupancy flags + entity ids); redo checks they look as they did before it (`preMatches`).
* **Guests** inside / queueing at / riding on the thing block undo of a placement, redo of a bulldoze.
* **Money**: undoing a bulldoze, redoing a placement or stroke needs the funds ("Not enough funds to undo / redo").
* A **new action empties the redo list**. Nothing is persisted: a loaded game starts with empty lists.

Path / piste tools no longer keep a private Ctrl+Z (`StrokeHistory` is only the fallback for headless tools without `record`); the global handler always answers.

## Slope profile chart (`st-profile`)

A small card (320 px, `position:fixed`, `pointer-events:none`, zone `top-card`) with an SVG chart: altitude over distance, every tile segment filled by difficulty (green / blue / red / black; black is drawn light grey so it reads on the dark panel), the current **snowline** as a dashed line, length / drop (or climb) / average and max gradient, a legend.

* **Piste ghost**: while a ski / MTB / hiking stroke is dragged `PisteTool.emitProfile` samples the centre-line per tile (`slopeProfile`; colours = the difficulty each tile WILL get: the Networks auto grade with hysteresis, or the override).
* **Lift ghost**: `LiftTool.refresh` shows `liftProfile` (ground under the bottom -> top station centres, one sample per tile; colour by how steep the ground is, 50 % per half-step, same 0.75 / 1.25 / 1.75 thresholds as pistes) and says *Not valid as drawn* when the check fails.
* Hidden when the stroke ends, is cancelled or the lift tool stops (`strokeEnded`, `clearPreview`).

## Snowline-aware run suggestion

`suggestPiste(grid, networks, snowlineY, { want?, maxTiles? })` (pure, read-only, deterministic). **Suggest a run** (Pistes pane) highlights the line (piste highlight overlay), centres the camera on its top, shows the profile card + advice for 12 s. Nothing is built or charged.

1. Candidates: skiable tiles (`SKIABLE_MIN..SKIABLE_MAX` from `world/Skiable.ts`; never rock / water / stream / building / lift) above the village.
2. Start pool: the highest candidates **above the current snowline** (all candidates when none is above: summer).
3. From each of ~60 starts it walks down the fall line to the neighbour whose steepness is closest to the wanted grade (green 0.55 .. black 1.9 half-steps / tile, the dock's Difficulty select; default blue), with a small penalty for turns.
4. Score = 3 x the drop that is still above the snowline + total drop + 0.05 x length - 4 x mean steepness deviation + 2 when the foot is within 2 tiles of an existing path / road / piste.
5. Advice: *mostly above the snowline* / *x % above today's snowline: the lower part may be bare in warm weather* / *No snow on this run right now ... closed until the snowline drops*.

## Not done / follow-ups

* Footpath / road strokes do not show a profile (pistes and lifts only, as planned).
* The suggestion does not look at lift stations (it ends near the network when it can, but does not plan a lift).
* Undo limit stays 10 (a drag counts as one).
