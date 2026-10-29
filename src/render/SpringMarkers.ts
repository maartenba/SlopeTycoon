import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Grid } from '@/world/Grid';
import type { Rivers } from '@/world/Rivers';
import { HEIGHT_UNIT } from '@/config/balance';

const MAX = 16;
const NATURAL = new THREE.Color(0x6fe0ff), PLACED = new THREE.Color(0x8dffb0), USED = new THREE.Color(0x7d9bb0);

/**
 * Spring markers (Phase 6 Task 14, docs/rivers.md): a flat ring with a centre dot on every spring site (natural hint = cyan, placed = green, one a river already
 * starts from = grey-blue). ONE InstancedMesh (one draw call, a few dozen triangles), shown only while the Landscape > Water tab is open. Flat, unlit and
 * depth-test free so it never crawls with the terrain (flicker rules). Rebuilt only when the springs / rivers / terrain change.
 */
export class SpringMarkers {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private shown = false;
  private seen = '';
  private readonly m = new THREE.Matrix4();
  constructor(private grid: Grid, private rivers: Rivers) {
    const ring = new THREE.RingGeometry(0.3, 0.42, 20, 1), dot = new THREE.CircleGeometry(0.13, 12);
    const geo = mergeGeometries([ring, dot])!;
    geo.rotateX(-Math.PI / 2);
    ring.dispose(); dot.dispose();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: false, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.count = 0;
    this.mesh.name = 'springMarkers';
    this.group.add(this.mesh);
    this.group.visible = false;
  }
  setVisible(v: boolean): void { this.shown = v; this.group.visible = v; if (v) this.sync(); }
  /** Per frame: one string compare while shown; nothing while hidden. */
  update(): void { if (this.shown) this.sync(); }
  count(): number { return this.mesh.count; }
  private sync(): void {
    const key = `${this.rivers.version}|${this.grid.terrainVersion}`;
    if (key === this.seen) return;
    this.seen = key;
    const list = this.rivers.allSprings().slice(0, MAX), g = this.grid;
    list.forEach((s, i) => {
      const c = g.getCorners(s.x, s.y), y = (Math.max(c[0], c[1], c[2], c[3])) * HEIGHT_UNIT + 0.1;
      this.m.makeTranslation(s.x + 0.5, y, s.y + 0.5);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, s.used ? USED : s.placed ? PLACED : NATURAL);
    });
    this.mesh.count = list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
