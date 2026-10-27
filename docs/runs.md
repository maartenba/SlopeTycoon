# Pistes as runs

A *piste* the player sees (name, difficulty, length, grooming, open / closed) is a **run**: the stretch of painted tiles between two nodes. Before 0.2.2 the game treated every 8-connected blob of ski tiles as ONE piste, so several strokes that happen to touch were one "Black Run 1" with a single majority difficulty.

## Phase 1: split + stats (`src/world/Runs.ts`, `src/sim/Runs.ts`)
- **Nodes**: junctions (3+ branches), lift stations (forced: the centre-line tile nearest each station footprint), dead ends (absorbed into their run).
- **Runs**: tile chains between nodes, oriented downhill (`from` = upstream/higher node). Each has its own length (centre line), vertical drop, average / max slope, difficulty (majority of ITS OWN tiles, stored 0..3 -> 1..4), tile list, loop flag.
- **Wide pistes**: Zhang-Suen thinning gives a centre line; thinning spurs shorter than the local half width are pruned, pseudo nodes (degree 2, not a station) dissolve; every other tile is handed to the nearest run by a deterministic multi-source flood fill. A 6-wide slope is one run, a blob / 2x2 is one synthetic run, a closed ring is one loop run.
- **Invariant** (property-tested): every piste tile is owned by exactly one run (`runOf`) or is a skeleton tile of a node (`nodeOf`, `runOf = -1`).
- **Lazy + deterministic**: `RunIndex.network()` rebuilds when `Networks.version` or the station positions change (no RNG, nothing saved). Terraforming under a piste does not bump the version: slope figures refresh on the next network edit.
- **Identity**: `Names` already keeps persistent piste ids by tile-sample overlap, so it is fed runs instead of components. Ids / auto names ('Blue Run 3', ordinal per difficulty) / custom names persist when runs grow, split or merge; an old component name goes to the largest overlapping run.
- **Still components**: "not connected to a lift" warnings (`disconnected`), the tutorial's connected-piste counts. A run is disconnected when its component is.
- Goals count runs (per run, per difficulty tile counts). Inspector shows slope. New **Runs** overlay (`O` cycles, Terrain/View drawer): each run in its own colour, junction / station tiles white, label per run. The *Piste difficulty* overlay is unchanged (tile level).
