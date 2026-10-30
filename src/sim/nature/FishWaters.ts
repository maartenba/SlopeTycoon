import type { Lake } from '../../world/TerrainGen';
import type { Stream } from '../../world/Streams';
import type { RiverRec } from '../../world/Rivers';
import type { FishBody } from './FishStock';

/** The fishable water bodies of a world (Phase 6 Task 49): natural lakes `l<i>`, player ponds `p<id>`, natural streams `n<i>`, dug rivers `r<id>` (waterway ids of the flow model). */
export function fishBodies(size: number, lakes: ReadonlyArray<Pick<Lake, 'tileIdx'>>, ponds: ReadonlyArray<{ id: number; tileIdx: number[] }>, streams: ReadonlyArray<Pick<Stream, 'path'>>, rivers: ReadonlyArray<Pick<RiverRec, 'id' | 'path'>>): FishBody[] {
  const out: FishBody[] = [];
  lakes.forEach((l, i) => out.push({ key: `l${i}`, kind: 'lake', name: `Lake ${i + 1}`, tiles: l.tileIdx }));
  for (const p of ponds) out.push({ key: `p${p.id}`, kind: 'pond', name: `Pond ${p.id}`, tiles: p.tileIdx });
  streams.forEach((s, i) => out.push({ key: `n${i}`, kind: 'stream', name: `Stream ${i + 1}`, tiles: s.path.map((t) => t.y * size + t.x) }));
  for (const r of rivers) out.push({ key: `r${r.id}`, kind: 'river', name: `River ${r.id}`, tiles: r.path.map((t) => t.y * size + t.x) });
  return out;
}
