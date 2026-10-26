import { CHUNK_SIZE } from '@/world/Grid';

export interface ProtectedSources {
  size: number;
  /** per-tile network kind and layer masks (Networks.kind / Networks.layers) */
  netKind: ArrayLike<number>;
  netLayers: ArrayLike<number>;
  buildings: Array<{ x: number; y: number; w: number; h: number }>;
  /** lift endpoints (tile coords); the line between them is sampled for towers / cable */
  lifts: Array<{ bottom: { x: number; y: number }; top: { x: number; y: number } }>;
}

/**
 * Chunk indices that hold anything draped on / seated on the terrain (roads, paths, rails, pistes, buildings, lift stations + towers).
 * The far-LOD terrain must keep these at full resolution: a coarse macro triangle above the fine surface buries them.
 * (TerrainMesh.setProtectedChunks adds the 1-chunk margin.)
 */
export function collectProtectedChunks(s: ProtectedSources): Set<number> {
  const cpr = Math.ceil(s.size / CHUNK_SIZE);
  const out = new Set<number>();
  const mark = (x: number, y: number): void => {
    const cx = Math.min(cpr - 1, Math.max(0, Math.floor(x / CHUNK_SIZE))), cy = Math.min(cpr - 1, Math.max(0, Math.floor(y / CHUNK_SIZE)));
    out.add(cy * cpr + cx);
  };
  for (let y = 0; y < s.size; y++) {
    const row = y * s.size;
    for (let x = 0; x < s.size; x++) if (s.netKind[row + x] || s.netLayers[row + x]) mark(x, y);
  }
  for (const b of s.buildings) for (const [px, py] of [[b.x, b.y], [b.x + b.w - 1, b.y], [b.x, b.y + b.h - 1], [b.x + b.w - 1, b.y + b.h - 1]] as const) mark(px, py);
  for (const l of s.lifts) {
    const n = Math.max(1, Math.ceil(Math.hypot(l.top.x - l.bottom.x, l.top.y - l.bottom.y) / (CHUNK_SIZE / 2)));
    for (let i = 0; i <= n; i++) mark(l.bottom.x + (l.top.x - l.bottom.x) * (i / n), l.bottom.y + (l.top.y - l.bottom.y) * (i / n));
  }
  return out;
}
