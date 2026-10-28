# Bridges (v1)

Phase 6 task 45. The bridge family over streams, ponds, lake inlets and gaps: **footbridge** (footpath), **wooden hiking bridge** (Hike trail, also the "forest bridge for hikers"), **MTB bridge** (MTB trail) and **road bridge** (one lane). Rail never bridges (*Rail cannot cross water*, today's message). The suspension footbridge is Phase 6.2 task 46 and is not part of v1. Config: `src/config/bridges.ts`. Planner: `src/world/Bridges.ts` (`planBridge`). Data: `src/world/Networks.ts`. Tool: `src/build/BridgeTool.ts`. Meshes: `src/render/meshes/bridges.ts`. Related: [crossings.md](crossings.md) (rail footbridge / level crossings).

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

## Tool
Paths drawer -> **Bridge type** select + **Build bridge** (44 px, mouse and touch alike): drag from one bank across the water or gap to the other; the pointer snaps to the dominant axis; the preview paints the line (green / red) and the tooltip reads `Footbridge: span 2, deck +1 half-steps, 2 supports, $340` or `Blocked: <reason>`. `__slope.planBridge` exists for the visual harness.

## Render
`bridges.ts` appends per tile to the chunk's network mesh (flat-shaded boxes, about 60 triangles per span tile, ~200 per bridge; a bridge across a chunk edge simply continues): so at most one draw call per chunk, far below one per kind per chunk. Deck pieces follow `Networks.deckAlong`, supports every second span tile reach down to the bed (two posts, or a stone pier for the road bridge). MaterialGuard sees the usual network material; no `gl_FragCoord`.

## Not in v1
Suspension footbridge and bridges over dug rivers with raft clearance (task 46); rail bridges (refused by design); walk mode and ride-along do not climb the bank ramps; terraform under a bridge needs no extra freeze (the terrain tools already refuse any tile that carries a network).
