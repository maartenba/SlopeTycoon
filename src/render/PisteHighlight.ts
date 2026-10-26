import * as THREE from 'three';
import type { Grid } from '../world/Grid';
import { HEIGHT_UNIT } from '../config/balance';

/** Positions (xyz triples, 6 vertices per tile) of tile quads lifted slightly above the terrain surface. Pure (testable without WebGL). */
export function highlightPositions(grid: Grid, tiles: readonly number[], lift = 0.07): Float32Array {
  const N = grid.size, out = new Float32Array(tiles.length * 18);
  let o = 0;
  for (const t of tiles) {
    const x = t % N, y = (t / N) | 0;
    const [n, e, s, w] = grid.getCorners(x, y);
    const yn = n * HEIGHT_UNIT + lift, ye = e * HEIGHT_UNIT + lift, ys = s * HEIGHT_UNIT + lift, yw = w * HEIGHT_UNIT + lift;
    const v = [x, yn, y, x, yw, y + 1, x + 1, ye, y, x, yw, y + 1, x + 1, ys, y + 1, x + 1, ye, y];
    for (const c of v) out[o++] = c;
  }
  return out;
}

/** One translucent mesh (1 draw call) covering the tiles of the selected piste. */
export class PisteHighlight {
  readonly mesh: THREE.Mesh;
  private key = '';
  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
  }
  /** Show `tiles` (skipped when unchanged since the last call). */
  set(grid: Grid, tiles: readonly number[]): void {
    const key = `${tiles.length}:${tiles[0]}:${tiles[tiles.length - 1]}`;
    if (key === this.key && this.mesh.visible) return;
    this.key = key;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(highlightPositions(grid, tiles), 3));
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    this.mesh.visible = tiles.length > 0;
  }
  clear(): void { this.mesh.visible = false; this.key = ''; }
}
