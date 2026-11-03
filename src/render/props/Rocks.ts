import * as THREE from 'three';
import { PropKind, PropStore } from '@/world/Props';
import { NEAR_CAPS } from '../lod/nearLod';
import { nearRockGeometry } from './NearTrees';
import { InstancedLayer, ROCK_MAX_VIEW, TREE_RIDE_NEAR_DIST, ROCK_RIDE_DIST, createMeshMaterial, createPropUniforms, mergeParts } from './Trees';
import type { PropUniforms } from './Trees';

/**
 * Boulder (M8 8.3, 100 triangles): a jittered icosahedron (80) with a larger-scale lump pass, a flat bedded base and strata bands in the vertex colour
 * (alternating light / dark layers + a warm lichen patch), plus a small half-buried sibling stone (20) so the silhouette is never one blob.
 * The instance shader varies the proportions per rock (aSeed), so one mesh gives many shapes (still one draw call per cell).
 */
export function rockGeometry(): THREE.BufferGeometry {
  const hs = (x: number, y: number, z: number, k: number): number => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + k * 19.19) * 43758.5453; return h - Math.floor(h); };
  const g = new THREE.IcosahedronGeometry(0.38, 1);
  const p = g.getAttribute('position');
  const cache = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let j = cache.get(key);
    if (j === undefined) {
      const lump = 0.88 + 0.24 * hs(Math.round(x * 2), Math.round(y * 2), Math.round(z * 2), 3); // coarse lumps shared by neighbouring vertices
      j = lump * (0.9 + 0.2 * hs(x, y, z, 1)); // + per-vertex jitter
      cache.set(key, j);
    }
    p.setXYZ(i, x * j, Math.max(y * j * 0.72 + 0.1, 0.02), z * j); // squashed, flat bedded base (nothing below the ground line)
  }
  const sib = new THREE.IcosahedronGeometry(0.15, 0);
  const sp = sib.getAttribute('position');
  for (let i = 0; i < sp.count; i++) { const j = 0.85 + 0.3 * hs(sp.getX(i), sp.getY(i), sp.getZ(i), 5); sp.setXYZ(i, sp.getX(i) * j, Math.max(sp.getY(i) * j * 0.8 + 0.05, 0.01), sp.getZ(i) * j); }
  sib.translate(0.4, 0, 0.14);
  const out = mergeParts([{ geo: g, color: new THREE.Color(0x56534f), foliage: 0 }, { geo: sib, color: new THREE.Color(0x5e5a54), foliage: 0 }]);
  // strata: per face (flat facets), alternate light / dark bedding layers by the face height, one warm lichen-tinted band
  const pos = out.getAttribute('position'), col = out.getAttribute('aBase');
  for (let f = 0; f < pos.count; f += 3) {
    const cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
    const band = Math.floor(cy * 10), tone = band % 2 ? 1.1 : 0.9, warm = band === 3 ? 1 : 0;
    for (let v = 0; v < 3; v++) col.setXYZ(f + v, col.getX(f + v) * tone * (1 + 0.1 * warm), col.getY(f + v) * tone * (1 + 0.03 * warm), col.getZ(f + v) * tone * (1 - 0.08 * warm));
  }
  return out;
}

/** Rocks: single LOD (full mesh, 128-tile cells), hidden beyond ROCK_MAX_VIEW. */
export class RockLayer {
  readonly layer: InstancedLayer;
  readonly group: THREE.Group;

  constructor(store: PropStore, uniforms: PropUniforms = createPropUniforms()) {
    const material = createMeshMaterial(uniforms);
    material.uniforms.uMoss!.value = 1;
    const nearMat = createMeshMaterial(uniforms);
    nearMat.uniforms.uMoss!.value = 1;
    this.layer = new InstancedLayer(store, PropKind.Rock, [
      { maxView: ROCK_MAX_VIEW, groupChunks: 4, geometry: rockGeometry(), material, band: [TREE_RIDE_NEAR_DIST, ROCK_RIDE_DIST] },
      // ground cameras, < 8 tiles: detail-4 faceted rock (moss / snow tops come from the same shader terms); cross-fades into the standard rock
      { maxView: -1, perspectiveOnly: true, groupChunks: 1, maxPerCell: NEAR_CAPS.rocksPerCell, geometry: nearRockGeometry(), material: nearMat, band: [0, TREE_RIDE_NEAR_DIST] },
    ]);
    this.group = this.layer.group;
  }

  refreshChunks(idxs: Iterable<number>, snowOnly = false): void { this.layer.refreshChunks(idxs, snowOnly); }
  update(camera: THREE.Camera, viewHeight: number): void { this.layer.update(camera, viewHeight); }
  setQuality(lodScale: number): void { this.layer.setLodScale(lodScale); }
  /** Ground-level cap on near rock instances per cell (0 = off, the standard rock takes over from distance 0). */
  setNearCap(n: number): void { this.layer.setNearCap(n); }
  countDraws(camera: THREE.Camera, viewHeight: number): number { return this.layer.countDraws(camera, viewHeight); }
  dispose(): void { this.layer.dispose(); }
}
