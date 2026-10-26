import * as THREE from 'three';
import { PropKind, PropStore } from '@/world/Props';
import { NEAR_CAPS } from '../lod/nearLod';
import { nearRockGeometry } from './NearTrees';
import { InstancedLayer, ROCK_MAX_VIEW, TREE_RIDE_NEAR_DIST, ROCK_RIDE_DIST, createMeshMaterial, createPropUniforms, mergeParts } from './Trees';
import type { PropUniforms } from './Trees';

/** Deterministic jittered icosahedron (flat-shaded, squashed). */
export function rockGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.38, 1);
  const p = g.getAttribute('position');
  const cache = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let j = cache.get(key);
    if (j === undefined) {
      // cheap deterministic hash of the position so shared vertices jitter identically
      const h = Math.sin(p.getX(i) * 127.1 + p.getY(i) * 311.7 + p.getZ(i) * 74.7) * 43758.5453;
      j = 0.8 + 0.4 * (h - Math.floor(h));
      cache.set(key, j);
    }
    p.setXYZ(i, p.getX(i) * j, p.getY(i) * j * 0.7 + 0.1, p.getZ(i) * j);
  }
  return mergeParts([{ geo: g, color: new THREE.Color(0x56534f), foliage: 0 }]);
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
