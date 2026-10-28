# Bridges (v1, drag-to-bridge since 0.2.4)

Phase 6 task 45. The bridge family over streams, ponds, lake inlets and gaps: **footbridge** (footpath), **wooden hiking bridge** (Hike trail, also the "forest bridge for hikers"), **MTB bridge** (MTB trail) and **road bridge** (one lane). Rail never bridges (*Rail cannot cross water*, today's message). The suspension footbridge is Phase 6.2 task 46 and is not part of v1. Config: `src/config/bridges.ts`. Planner: `src/world/Bridges.ts` (`planBridge`). Data: `src/world/Networks.ts`. Stroke planner: `src/world/StrokePlan.ts` (`planStroke`, `planTrailStroke`); tools: `src/build/PathTool.ts` (`SegmentTool`), `src/build/PisteTool.ts`. Meshes: `src/render/meshes/bridges.ts`. Related: [crossings.md](crossings.md) (rail footbridge / level crossings).

## Kinds

| Kind | Layer | Max span | $ / span tile | Clearance | Notes |
|---|---|---|---|---|---|
| `footbridge` | footpath | 4 | 150 | 1 half-step | timber deck, rails, hand rails |
| `hikeBridge` | Hike trail | 4 | 120 | 1 | logs, low rope rail |
| `mtbBridge` | MTB trail | 4 | 140 | 1 | planks, no rails |
| `roadBridge` | road | 3 | 600 | 2 | stone deck + parapets + pier, both banks flat (spread <= 1) |

The two bank tiles are ordinary path / road / trail tiles and are charged as such when they are new; a bridge is paid once and refunds half when bulldozed.

## Planning (`planBridge(net, grid, kind, a, b)`)
`a` and `b` are the two banks (the drag start and end) on one row or column. Pure; checks in this order and returns the exact reason:

1. `rail` -> *Rail cannot cross water*.
2. Not straight -> *Bridges must run in a straight line*; adjacent banks / dry flat ground -> *Nothing to bridge: drag from one bank across water or a gap*.
3. Span longer than the kind's max -> *Too long (max N)*.
4. A bank is water, occupied, refuses the layer (slope, building) -> *Needs solid ground at both ends* (road bridge: *Road bridges need flat ground at both ends*).
5. Anything under the span (network, trail, building, lift, decor) -> *Something is in the way under the bridge*.
6. Every dry span tile must be a **gap**: its lowest corner at least `GAP_MIN_DROP` (3) half-steps below BOTH banks' highest corners (a depression, not a slope) -> otherwise *Bridges only cross water or a gap*.
7. **Deck level** (half-steps) = the highest of both banks' top corners and every water span tile's top corner + the kind's clearance; if that is more than `BRIDGE_MAX_RISE` (3) above a bank -> *Too low over the water: the banks are lower than the deck needs*.
8. Linking: a footpath / trail bank must attach to a path, road, building or trail (*Paths must connect to a path, road or building*), a road bank to the road network (*Roads must start at the road entry*). Judged last, so the physical reasons show first.

Result: span tiles, deck level, `rise` over the lower bank, `supports` (every second span tile and always the last), new bank tiles and cost.

## Data (`Networks`)
- `bid: Uint16Array` bridge id per **span** tile (0 = none), `bridgeTiles` count (0 = every bridge system is inert), records `Bridge { id, kind, a, b, span, deck, cost }` (never deleted, so undo can bring a bridge back; live bridges = records whose span tiles still carry the id).
- Span tiles carry the layer (kind Path / Road, or the Hike / Mtb bit) plus the old `bridge` flag, so NavGraph, the walk-mode water gate and everything that already understood stream crossings keep working. Lake tiles stay water underneath (deck over them).
- Bulldozing **any** span tile removes the whole bridge (banks stay) and refunds half its cost; one undo step per bridge (`Undo.recordNetwork` with `TileSnap.bid`).
- Save: networks module v2 writes `bid` + `bridges` only when a bridge exists; a world without one saves and hashes exactly as before.
- **Migration**: old per-tile stream crossings (plain path / trail strokes over a stream) keep their `bridge` flag untouched (connectivity and every golden stay identical) and are listed as zero-cost auto records by `Networks.legacyBridges()` / `allBridges()` (`auto: true`, kind by layer); nothing is stored for them.
- `deckY(x, y)` is the deck height at a world position (flat over the span, a linear ramp over the half tile next to each bank); guests (`createSim.groundAt`) and cars (main's vehicle height) use it, so they walk / drive on the deck.

## Pathing
One NavGraph step per deck tile with the layer's own speed and cost (trail bridges keep the existing +0.5 step cost of stream crossings); the water below keeps its rapids / raft tiles. Road bridges extend the road component, so a car park beyond the bridge is road-served and the arrival route (`routeOnKind`) crosses it.

## Drawing a bridge (no separate mode)
Bridges are part of drawing each path kind; there is no bridge tool, select or *Build bridge* button any more (owner feedback: the old Paths drawer control was clipped and confusing). Pick the kind, drag across the water:

| Drawing | Over a pond / lake / gap | Over a stream |
|---|---|---|
| Footpath | footbridge ($150 per span tile, max 4) | automatic per-tile crossing (below) |
| Road | road bridge ($600, max 3, flat banks) | automatic per-tile crossing |
| Hiking trail | wooden hiking bridge ($120, max 4) | automatic |
| MTB trail | MTB bridge ($140, max 4) | automatic |
| Rail / Ski piste | refused (*Rail cannot cross water* / piste water message) | rail refused, piste stops |

`StrokePlan.planStroke` (footpath / road / rail, the L-shaped drag) and `planTrailStroke` (hiking / MTB, the freehand 4-connected line) split the stroke into **runs** of tiles a bridge has to carry (lake tiles; for footpath / road also dry tiles at least `GAP_MIN_DROP` below the bank the run starts from = a depression), then validate each run: a bank before and after it (*Start the bridge on solid ground...* / *Keep dragging to the far bank...*), one straight line (*Bridges must run in a straight line*), then `planBridge` (reasons above; too long reads *Span too long: max N tiles*). A steep slope that is not a gap keeps its normal *Too steep* reason. Banks are built (and charged) by the bridge, the rest of the stroke as ordinary tiles; linking (roads from the road entry, footpaths to an anchor, trails to a path / building / trail) is judged for the whole stroke. Trails need no bridge over gaps (they follow the ground, as before). One undo step per stroke, bridges included; a stroke is paid once and a bridge refunds half when bulldozed.

The ghost (`Evaluation.ghost`) paints the line green / red as for any stroke, the **span tiles as a blue deck raised to the deck level**, and level-crossing / rail-bridge tiles gold. The tooltip reads `Cost: $255 (2 tiles + Footbridge: span 3 tiles, $225)` or `Blocked: Span too long: max 3 tiles`. It is clamped to the viewport (flips left / above near an edge, wraps at 300 px).

Streams keep the old behaviour: a stroke over a stream tile is an automatic zero-cost bridge (the per-tile `bridge` flag, see Migration), whatever the length; `planBridge` and `__slope.planBridge` still plan explicit bridges (tests, harness).

### Drawer UI
*Paths & Roads* and *Pistes & Trails* share the shape of the other drawers: cards (price per tile), then a side panel with a **Cross rails** (trails: *Trails over rails*) segmented control (`role=radiogroup`, two 44 px two-line buttons *Level crossing / $150 · guests wait* and *Bridge / $900 · no waiting*, arrow keys, the choice is kept between the two drawers and defaults to the level crossing), a hint line (*Drag across water or rails to build a bridge. Roads always use a level crossing; rail cannot cross water.*) and the price legend (Footpath: Footbridge $150/tile, max 4 ...). The card hover shows `Over water: <bridge> $/tile, max N`. On phones the Paths panel stacks under the cards and the Pistes drawer scrolls (44 px targets).

## Render
`bridges.ts` appends per tile to the chunk's network mesh (flat-shaded boxes, about 60 triangles per span tile, ~200 per bridge; a bridge across a chunk edge simply continues): so at most one draw call per chunk, far below one per kind per chunk. Deck pieces follow `Networks.deckAlong`, supports every second span tile reach down to the bed (two posts, or a stone pier for the road bridge). MaterialGuard sees the usual network material; no `gl_FragCoord`.

## Not in v1
Road overpasses over rail (the road always takes the level crossing, see crossings.md); suspension footbridge and bridges over dug rivers with raft clearance (task 46); rail bridges (refused by design); ride-along does not climb the bank ramps; walk mode follows deck height since M6.1 (`main.ts` walk ground; the rail footbridge stairs could not be verified headlessly, see `docs/playtest-m61.md`); terraform under a bridge needs no extra freeze (the terrain tools already refuse any tile that carries a network).
