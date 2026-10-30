import * as THREE from 'three';
import type { Grid } from '@/world/Grid';
import type { Backcountry } from '@/sim/ops/Backcountry';
import { HEIGHT_UNIT } from '@/config/balance';
import { DANGER_COLOR_HEX } from '@/ui/backcountryFormat';

/** Spacing (tiles) between flag poles along a route. */
export const FLAG_SPACING = 3.5;
const POLE_H = 1.25, POLE_W = 0.04;

/** Pole tiles of a route: greedy pick in BFS order with a minimum spacing, so a painted line gets a pole every few tiles. Pure. */
export function flagTiles(tiles: ReadonlyArray<number>, size: number, spacing = FLAG_SPACING): number[] {
  const out: number[] = [], s2 = spacing * spacing;
  for (const t of tiles) {
    const x = t % size, y = (t / size) | 0;
    let ok = true;
    for (const o of out) { const dx = (o % size) - x, dy = ((o / size) | 0) - y; if (dx * dx + dy * dy < s2) { ok = false; break; } }
    if (ok) out.push(t);
  }
  return out;
}

/**
 * Flag poles along every backcountry route (Phase 6 Task 32): ONE merged mesh (one draw call, ~8 triangles per pole), unlit vertex colours
 * (flicker-safe, no shader). The flag colour is the route's danger level (green 1 .. dark red 5); a closed route's poles carry a dark cross-bar.
 * Rebuilt only when the routes / their levels / the terrain change.
 */
export class BackcountryFlags {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private seen = '';
  poles = 0;
  constructor(private grid: Grid, private bc: Backcountry) { this.group.name = 'backcountryFlags'; }

  update(): void {
    const key = `${this.bc.stamp}|${this.grid.terrainVersion}|${this.bc.count}`;
    if (key === this.seen) return;
    this.seen = key;
    this.build();
  }

  private build(): void {
    const N = this.grid.size, pos: number[] = [], col: number[] = [];
    const c = new THREE.Color();
    const tri = (a: number[], b: number[], d: number[], hex: number): void => { c.setHex(hex); pos.push(...a, ...b, ...d); for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b); };
    const quad = (a: number[], b: number[], d: number[], e: number[], hex: number): void => { tri(a, b, d, hex); tri(a, d, e, hex); };
    let poles = 0;
    for (const r of this.bc.routes()) {
      for (const t of flagTiles(r.tiles, N)) {
        const x = t % N, y = (t / N) | 0, cs = this.grid.getCorners(x, y);
        const g = ((cs[0] + cs[1] + cs[2] + cs[3]) / 4) * HEIGHT_UNIT, cx = x + 0.5, cz = y + 0.5, w = POLE_W, y0 = g - 0.05, y1 = g + POLE_H;
        // pole: two crossed thin quads (visible from every side)
        quad([cx - w, y0, cz], [cx + w, y0, cz], [cx + w, y1, cz], [cx - w, y1, cz], 0x3a2e24);
        quad([cx, y0, cz - w], [cx, y0, cz + w], [cx, y1, cz + w], [cx, y1, cz - w], 0x3a2e24);
        // pennant in the danger colour (a triangle at the top, in the plane x-y; DoubleSide material)
        tri([cx + w, y1, cz], [cx + w, y1 - 0.42, cz], [cx + 0.55, y1 - 0.21, cz], DANGER_COLOR_HEX[r.danger] ?? DANGER_COLOR_HEX[1]);
        if (!r.open) quad([cx - 0.22, y1 - 0.62, cz], [cx + 0.22, y1 - 0.62, cz], [cx + 0.22, y1 - 0.53, cz], [cx - 0.22, y1 - 0.53, cz], 0x1a1010);
        poles++;
      }
    }
    this.poles = poles;
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh = null; }
    if (!poles) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.name = 'backcountryFlags';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'backcountryFlags';
    this.group.add(this.mesh);
  }

  dispose(): void { if (this.mesh) { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); } }
}
