import * as THREE from 'three';
import type { Grid } from '@/world/Grid';
import { Layer } from '@/world/Networks';
import { surfaceHeightAt } from './meshes/Paths';
import { COASTER_RAIL } from './TourVehicles';

/** Spacing (tiles) between the marker stakes along a sled run. */
export const STAKE_SPACING = 3;
/** Half-widths (tiles): the packed lane, its darker bank underlay, a coaster rail and the cross-tie. */
const LANE = 0.3, BANK = 0.4, RAIL = 0.02, RAIL_GAUGE = 0.1, TIE = 0.16;

export interface SledNet { readonly size: number; readonly layers: ArrayLike<number>; readonly version: number }

/**
 * Sled runs and alpine coaster rails (docs/sled-runs.md): ONE merged mesh (one draw call) with lit vertex colours, rebuilt only when the network or the terrain changes.
 * Sled run: a packed pale lane on a darker bank, connected tile to tile, with an orange marker stake every few tiles. Coaster: two steel rails and cross-ties lifted
 * `COASTER_RAIL` above the ground on thin posts (the cars of `TourVehicles` ride the same height). Heights follow `surfaceHeightAt` (no z-fighting: lanes lift 0.03 / 0.05).
 */
export class SledRunView {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private seen = '';
  /** Tiles drawn (sled, coaster) and stakes: for tests. */
  tiles = { sled: 0, coaster: 0 };
  stakes = 0;
  triangles = 0;
  constructor(private grid: Grid, private net: SledNet) { this.group.name = 'sledRuns'; }

  update(): void {
    const key = `${this.net.version}|${this.grid.terrainVersion}`;
    if (key === this.seen) return;
    this.seen = key;
    this.build();
  }

  private build(): void {
    const N = this.net.size, g = this.grid, pos: number[] = [], col: number[] = [];
    const c = new THREE.Color();
    const H = (x: number, z: number): number => surfaceHeightAt(g, x, z);
    const vtx = (x: number, y: number, z: number, hex: number): void => { c.setHex(hex); pos.push(x, y, z); col.push(c.r, c.g, c.b); };
    const tri = (a: number[], b: number[], d: number[], hex: number): void => { vtx(a[0]!, a[1]!, a[2]!, hex); vtx(b[0]!, b[1]!, b[2]!, hex); vtx(d[0]!, d[1]!, d[2]!, hex); };
    const quad = (a: number[], b: number[], d: number[], e: number[], hex: number): void => { tri(a, b, d, hex); tri(a, d, e, hex); };
    /** Ground-following ribbon cell from (x0,z0) to (x1,z1), `lift` above the surface, subdivided `n` x `n`. */
    const patch = (x0: number, z0: number, x1: number, z1: number, lift: number, hex: number, n = 1): void => {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const ax = x0 + ((x1 - x0) * i) / n, bx = x0 + ((x1 - x0) * (i + 1)) / n, az = z0 + ((z1 - z0) * j) / n, bz = z0 + ((z1 - z0) * (j + 1)) / n;
        quad([ax, H(ax, az) + lift, az], [bx, H(bx, az) + lift, az], [bx, H(bx, bz) + lift, bz], [ax, H(ax, bz) + lift, bz], hex);
      }
    };
    const has = (x: number, y: number, bit: number): boolean => x >= 0 && y >= 0 && x < N && y < N && (this.net.layers[y * N + x]! & bit) !== 0;
    let sled = 0, coaster = 0, stakes = 0;
    const lastStake: number[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const l = this.net.layers[y * N + x]!;
      if (!(l & (Layer.Sled | Layer.Coaster))) continue;
      const cx = x + 0.5, cz = y + 0.5;
      if (l & Layer.Sled) {
        sled++;
        patch(cx - BANK, cz - BANK, cx + BANK, cz + BANK, 0.03, 0x9fb4c8, 2);
        patch(cx - LANE, cz - LANE, cx + LANE, cz + LANE, 0.05, 0xe9f1f8, 2);
        for (const [dx, dz] of [[1, 0], [0, 1]] as const) { // connect to the east / south neighbour (each pair once); diagonal runs join through the corner patches
          if (!has(x + dx, y + dz, Layer.Sled)) continue;
          const nx = cx + dx, nz = cz + dz;
          patch(Math.min(cx, nx) + (dx ? BANK : -BANK), Math.min(cz, nz) + (dz ? BANK : -BANK), Math.max(cx, nx) - (dx ? BANK : -BANK), Math.max(cz, nz) - (dz ? BANK : -BANK), 0.03, 0x9fb4c8);
          patch(Math.min(cx, nx) + (dx ? LANE : -LANE), Math.min(cz, nz) + (dz ? LANE : -LANE), Math.max(cx, nx) - (dx ? LANE : -LANE), Math.max(cz, nz) - (dz ? LANE : -LANE), 0.05, 0xe9f1f8);
        }
        // orange stake on the bank every STAKE_SPACING tiles (greedy in scan order: stable)
        if (!lastStake.some((i) => { const sx = (i % N) - x, sy = ((i / N) | 0) - y; return sx * sx + sy * sy < STAKE_SPACING * STAKE_SPACING; })) {
          lastStake.push(y * N + x); stakes++;
          const sx = cx + BANK, sh = H(sx, cz);
          quad([sx - 0.025, sh, cz], [sx + 0.025, sh, cz], [sx + 0.025, sh + 0.5, cz], [sx - 0.025, sh + 0.5, cz], 0xf08a24);
          tri([sx + 0.025, sh + 0.5, cz], [sx + 0.025, sh + 0.36, cz], [sx + 0.22, sh + 0.43, cz], 0xd9453a);
        }
      }
      if (l & Layer.Coaster) {
        coaster++;
        const sh = H(cx, cz), top = sh + COASTER_RAIL;
        // post
        quad([cx - 0.025, sh, cz - 0.025], [cx + 0.025, sh, cz - 0.025], [cx + 0.025, top - 0.02, cz - 0.025], [cx - 0.025, top - 0.02, cz - 0.025], 0x5a6068);
        quad([cx - 0.025, sh, cz + 0.025], [cx + 0.025, sh, cz + 0.025], [cx + 0.025, top - 0.02, cz + 0.025], [cx - 0.025, top - 0.02, cz + 0.025], 0x5a6068);
        quad([cx - 0.025, sh, cz - 0.025], [cx - 0.025, sh, cz + 0.025], [cx - 0.025, top - 0.02, cz + 0.025], [cx - 0.025, top - 0.02, cz - 0.025], 0x5a6068);
        quad([cx + 0.025, sh, cz - 0.025], [cx + 0.025, sh, cz + 0.025], [cx + 0.025, top - 0.02, cz + 0.025], [cx + 0.025, top - 0.02, cz - 0.025], 0x5a6068);
        // cross-tie under the rails (perpendicular to the dominant run direction) and the two rails towards the east / south neighbour
        const horiz = has(x + 1, y, Layer.Coaster) || has(x - 1, y, Layer.Coaster);
        const tw = horiz ? [TIE * 0.4, TIE] : [TIE, TIE * 0.4];
        patch(cx - tw[0]!, cz - tw[1]!, cx + tw[0]!, cz + tw[1]!, COASTER_RAIL - 0.01, 0x3a3f48);
        for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
          if (!has(x + dx, y + dz, Layer.Coaster)) continue;
          for (const o of [-RAIL_GAUGE, RAIL_GAUGE]) {
            const ox = dz ? o : 0, oz = dx ? o : 0;
            patch(cx + ox - (dz ? RAIL : 0), cz + oz - (dx ? RAIL : 0), cx + dx + ox + (dz ? RAIL : 0), cz + dz + oz + (dx ? RAIL : 0), COASTER_RAIL, 0x9aa5b4);
          }
        }
        // the rails also end in a short stub at an isolated end so a one-tile stump is still visible
        if (!has(x + 1, y, Layer.Coaster) && !has(x, y + 1, Layer.Coaster) && !has(x - 1, y, Layer.Coaster) && !has(x, y - 1, Layer.Coaster)) for (const o of [-RAIL_GAUGE, RAIL_GAUGE]) patch(cx - 0.3, cz + o - RAIL, cx + 0.3, cz + o + RAIL, COASTER_RAIL, 0x9aa5b4);
      }
    }
    this.tiles = { sled, coaster }; this.stakes = stakes; this.triangles = pos.length / 9;
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh = null; }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.name = 'sledRuns';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'sledRuns';
    this.group.add(this.mesh);
  }

  dispose(): void { if (this.mesh) { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); } }
}
