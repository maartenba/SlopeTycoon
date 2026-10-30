# Backcountry routes and avalanche danger (Phase 6 Task 32, decision D-P3)

Winter ski-touring and off-piste routes the player paints, with an **avalanche danger level 1-5** derived from the avalanche model. Shipped ON with no flag: it is player-driven (no routes = no work, no state, no hash change).

**NO DEATHS, EVER.** A guest caught in a slide is *buried* and resolves as an injury (`recovered` / `hospitalised`), never a death or a removal from the world. `tests/repo/noDeaths.test.ts` greps every sim / ui / config / game / render string and the incident enums for death wording (comments, tests and docs may use it; the one allowed literal is the legacy-save migration in `Incidents.load`).

## The layer

`Layer.Backcountry = 8` in `src/world/Networks.ts` (`LayerBit` is `1|2|4|8`). It lives in the existing `layers` byte per tile, so it is saved with the `networks` module as before; an old save simply has no bit 8 (no migration needed, `SAVE_FORMAT_VERSION` unchanged).

- Painted from the **Pistes & Trails** drawer, fourth card **Backcountry route** (`NetworkItem` key `backcountry`): `BACKCOUNTRY_COST_PER_TILE` = $15 per tile, level-gated at **level 3** (`UNLOCKS` row `landscape:backcountry`, `sim.gate.locked('landscape', 'backcountry')`; the card shows the lock, the tool refuses). Winter item (`networkSeason`).
- Allowed on any ground that is not water, a stream, a building or garden decor (`Networks.canPaint`). One tile wide, like a trail.
- **Attachment**: the stroke must touch a lift station, a building, a piste, a hiking / MTB trail or a footpath / road (`isAnchoredTile`, ghost text `BACKCOUNTRY_ORPHAN_MSG`). A route that later loses its anchor is closed with 'Not connected...'. `Networks.attachedToNetwork(tiles)`.
- Erase with Shift-drag / the Erase button / Bulldoze, undo / redo (the shared journal) work as for trails.
- It is **not a piste and not a run**: `pisteAt` still sees it as "something is painted here" (no building on a route), but it has no grooming, no difficulty edge, no `RunIndex` run, no piste status and no quality. Routes are the 8-connected components of the layer (`Networks.backcountryComponents()`, cached per `version`).
- Look: soft violet track + purple dashes in the ground mask (B channel on a tile **without** a piste: `groundMask.ts`, `TerrainMesh` shader, world-space dashes so nothing crawls) and **flag poles** every ~3.5 tiles (`render/BackcountryFlags.ts`: one merged unlit mesh; the pennant colour is the route's danger level; a closed route's poles carry a dark cross-bar).

## Danger 1-5

`Avalanche.dangerScore(tiles) = 0.7 x max + 0.3 x mean` of the stored per-tile instability (0 on ground that cannot slide: flat, warm, no fresh snow), mapped through the **fixed thresholds** `DANGER.thresholds = [0.15, 0.35, 0.6, 0.9]` to a level (`levelOfScore`, `dangerLevel(route)`):

| Level | Name | Score from |
|---|---|---|
| 1 | Low | 0 |
| 2 | Moderate | 0.15 |
| 3 | Considerable | 0.35 |
| 4 | High | 0.6 |
| 5 | Very high | 0.9 |

It rises with heavy fresh snow, storms, warm-ups and rain-on-snow (the existing instability model), and falls after **control blasting** (a covered unstable slope is released at 04:00 and its neighbourhood reset to 0.1), after slides, with time (`settle` 0.98 per hour) and when it warms above 2 C. Patrol cover already lowers the gain and the release chance of a covered tile; a forest lowers it too. `Backcountry` (`src/sim/ops/Backcountry.ts`) recomputes the levels **once per sim hour** (tick 5 of the hour, from `Safety.onTick`) and whenever the Networks version moves; nothing is scanned per tick.

## Closing and the override (setting)

- Default **auto-close threshold 4** (`DANGER.closeAt`, `Backcountry.threshold`, 3-5 via `setThreshold`): a route at danger >= 4 closes with the reason **'Avalanche danger 4'** (or 5). It reopens when the score falls below the level-4 start minus 0.05 (hysteresis, so a level on a boundary cannot flap).
- Other closed reasons: 'Closed: no snow' (less than half of the tiles are skiable) and 'Not connected to a lift, hut, piste or trail'.
- **Override**: the route inspector has a checkbox *Open at danger 4+* per route and *All routes: open at danger 4+* (`setOverride(id, on)`, `setGlobalOverride(on)`). Turning either ON asks to confirm: *'Open at danger 4? Burials possible; patrol required.'* (`confirmDialog` in `main.ts`; `OVERRIDE_CONFIRM`). Turning it off needs no confirm.
- A closed route's tiles go into `OpenStatus.setExtraClosed` -> `closedMask` -> `NavWorld.closed`, exactly like an avalanche closure: **no guest is routed onto them** (`NavGraph.step` returns -1 for ski modes). Tiles shared with a piste are not closed (the piste's own status rules).
- Events `backcountry:closed` / `backcountry:opened` (news lines 'A backcountry route closed: Avalanche danger 4').
- **Advisor** (`backcountry.patrol`, `backcountry.risky`, cheap rules, warnings only): a route that is OPEN with less than half of its tiles in Ski Patrol cover; a route kept open at danger >= the threshold by an override.

## Inspector (select a route tile in Select mode)

`StRouteInspector`: a **danger rose** (half circle of 5 coloured wedges, the current level bright), the text **'Considerable (3)'**, Open / the closed reason, tiles and metres, patrol cover %, the two override toggles and warnings (`ui/backcountryFormat.ts`, `routeInfo`). Colours: green, yellow, orange, red, dark red; the level is always also text. On the map the poles' pennants show the same colours.

## API for the Ski tourer lane (do not write the behaviour here)

`sim.backcountry` (`Backcountry`):

- `routes()`, `openRoutes()`, `route(id)`, `routeAt(tile)`, `routeTiles(id)`, `dangerOf(id)` (1-5, 0 unknown), `isOpen(id)`, `count`.
- `BackcountryRoute`: `id` (lowest tile, stable while unchanged), `tiles`, `top` / `bottom` tile (start / end), `danger`, `score`, `open`, `closedReason`, `override`, `attached`, `covered` (0..1), `snowy`.
- **Hook** `pickRoute(rand, maxDanger = 3)`: an open route with danger <= `maxDanger` using the caller's random stream (deterministic order by id), null when none. Tourers should pass 3: they never go at danger >= 4 even when the route is open (plan: Task 34).
- `closedForDanger()`, `hasRiskyOpen()`, `stamp` (bumps when anything shown changes), `offPisteMask` (stable `Uint8Array`: 1 on tiles of an open route with danger <= `DANGER.offPisteMax` = 2).
- Navigation: a tourer needs a movement mode on `Layer.Backcountry` tiles in `NavGraph` (not added here: that is the guest-type lane).

## Off-piste users (small share)

Advanced skiers and boarders already ski off-piste (`NavMode.SkiOff`, the existing `offPisteScale`). `NavWorld.bcOff` (optional) makes `SkiOff` steps cost x0.75 on an OPEN low-danger (<= 2) route tile and x1.5 on any other flagged route tile, so they *prefer* routes at low danger and avoid flagged ones when it is risky. No new mode, no new guest decision; the share stays whatever off-piste is today.

## Burials = injuries (unchanged path, now covered)

`Avalanche.release` reports a `buried` incident for guests in the run-out (`buryChance` 0.85, else a minor injury). A buried guest has a `buriedSurvival` window (15 ticks = 90 game minutes): patrol or the helicopter dig them out (`recovered` / `hospitalised`); if nobody comes in time the transfer to hospital is forced (`hospitalised`, counted `severe` for the safety rating). Never a death, never removed: `tests/sim/backcountry.test.ts` runs 12 seeded slides over a route full of skiers and checks every outcome is in `recovered | hospitalised | evacuated | left`.

## Save / load, determinism, perf

- Save module `backcountry` (`omitWhenNull`): `null` while there is no route and no setting, so every world without a route hashes exactly as before (goldens untouched). Otherwise `{ overrides, closed, levels, global?, threshold? }`: the overrides, the closed-by-danger flags (for the hysteresis) and the shown levels (the stored instability is rounded to 0.01).
- Route identity: the lowest tile index; an edited route inherits the override / closed state of the old route it overlaps.
- Deterministic: no randomness (levels from the seeded instability, hourly on a fixed tick).
- Perf: components cached per `Networks.version`; the danger pass is O(route tiles) once per sim hour; `BackcountryFlags` rebuilds only when `stamp` / terrain changes.

## Tests

`tests/sim/backcountry.test.ts` (scale, rises after a storm, falls after blasting / settling, closes + hysteresis, override, save / load, burials), `tests/game/backcountryRoutes.test.ts` (layer, ground mask, attachment, closed route has no users in `NavGraph`, save -> load -> ticks), `tests/sim/backcountryAdvisor.test.ts`, `tests/ui-dom/routeInspector.test.ts`, `tests/repo/noDeaths.test.ts`.
