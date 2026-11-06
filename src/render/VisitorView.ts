import * as THREE from 'three';
import type { Grid } from '@/world/Grid';
import type { Visitor, Print } from '@/sim/nature/Visitor';
import { surfaceHeightAt } from '@/render/meshes/Paths';
import { createVisitorPoses } from '@/render/meshes/rareVisitor';

/**
 * Rare high-country visitor view: ONE vertex-coloured mesh (four walk poses swapped on the same mesh) and ONE draped footprint mesh. Nothing is
 * visible (and nothing is drawn) while no visit is on. Footprints are unlit-free Lambert decals draped with `surfaceHeightAt` (world-space,
 * no shader, no noise: flicker-safe). Read-only: it never touches the sim.
 */
export class VisitorView {
  readonly group = new THREE.Group();
  private poses = createVisitorPoses();
  private body: THREE.Mesh;
  private bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true });
  private prints: THREE.Mesh;
  private printMat = new THREE.MeshLambertMaterial({ color: 0x7d8fa8, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private printKey = '';
  private cx = 0; private cz = 0; private walked = 0; private seen = false; private alpha = 0;
  /** Current world position of the visitor (for hit tests / the photo check). */
  readonly pos = new THREE.Vector3();

  constructor(private grid: Grid, private visitor: Visitor, private now: () => number) {
    this.group.name = 'rareVisitor';
    this.bodyMat.name = 'rareVisitor'; this.printMat.name = 'rareVisitorTracks';
    this.body = new THREE.Mesh(this.poses[0]!, this.bodyMat); this.body.name = 'rareVisitor';
    this.prints = new THREE.Mesh(new THREE.BufferGeometry(), this.printMat); this.prints.name = 'rareVisitorTracks'; this.prints.renderOrder = 2; this.prints.frustumCulled = false;
    this.body.visible = false; this.prints.visible = false;
    this.group.add(this.body, this.prints);
  }

  /** True while the body is visible enough to count as 'seen'. */
  get visible(): boolean { return this.body.visible && this.alpha > 0.3; }

  update(dt: number): void {
    const t = this.now(), p = this.visitor.poseAt(t), tr = this.visitor.prints(t);
    this.updatePrints(tr.list, tr.alpha);
    if (!p) { this.body.visible = false; this.seen = false; this.alpha = 0; return; }
    if (!this.seen) { this.cx = p.x; this.cz = p.y; this.seen = true; }
    const dx = p.x - this.cx, dz = p.y - this.cz, d = Math.hypot(dx, dz);
    if (d > 3) { this.cx = p.x; this.cz = p.y; } else { const k = 1 - Math.exp(-Math.max(0, dt) * 4); this.cx += dx * k; this.cz += dz * k; this.walked += d * k; }
    const ph = Math.floor(((this.walked * 3.2) % 4 + 4) % 4);
    this.body.geometry = this.poses[ph]!;
    const bob = Math.abs(Math.sin(this.walked * 3.2 * Math.PI / 2)) * 0.015;
    const gy = surfaceHeightAt(this.grid, this.cx, this.cz);
    this.body.position.set(this.cx, gy + bob, this.cz); this.body.rotation.y = p.yaw;
    this.alpha = p.alpha; this.bodyMat.opacity = p.alpha; this.body.visible = true;
    this.pos.set(this.cx, gy + 0.5, this.cz);
  }

  private updatePrints(list: Print[], alpha: number): void {
    if (!list.length || alpha <= 0) { this.prints.visible = false; return; }
    this.prints.visible = true; this.printMat.opacity = 0.8 * alpha;
    const key = `${list.length}|${this.grid.terrainVersion}`;
    if (key === this.printKey) return;
    this.printKey = key;
    const pos: number[] = [], nor: number[] = [], idx: number[] = [];
    const SEG = 10, A = 0.07, B = 0.15;
    for (const pr of list) {
      const base = pos.length / 3, cs = Math.cos(pr.yaw), sn = Math.sin(pr.yaw);
      const vert = (lx: number, lz: number): void => { const wx = pr.x + lx * cs + lz * sn, wz = pr.y - lx * sn + lz * cs; pos.push(wx, surfaceHeightAt(this.grid, wx, wz) + 0.012, wz); nor.push(0, 1, 0); };
      vert(0, 0);
      for (let k = 0; k < SEG; k++) { const a = (k / SEG) * Math.PI * 2; vert(Math.cos(a) * A, Math.sin(a) * B * (Math.sin(a) > 0 ? 1.1 : 0.9)); }
      for (let k = 0; k < SEG; k++) idx.push(base, base + 1 + ((k + 1) % SEG), base + 1 + k);
      for (let t = 0; t < 4; t++) { // four toes
        const tb = pos.length / 3, tx = (t - 1.5) * 0.045, tz = B * 1.2 - Math.abs(t - 1.5) * 0.03;
        vert(tx, tz);
        for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; vert(tx + Math.cos(a) * 0.022, tz + Math.sin(a) * 0.03); }
        for (let k = 0; k < 5; k++) idx.push(tb, tb + 1 + ((k + 1) % 5), tb + 1 + k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
    g.computeBoundingSphere();
    this.prints.geometry.dispose(); this.prints.geometry = g;
  }

  /** Does a pointer ray pass close to the visitor? */
  hit(ray: THREE.Ray): boolean {
    if (!this.visible) return false;
    return ray.distanceSqToPoint(this.pos) < 0.55 * 0.55;
  }
  /** Is it on screen (inside the frame, near enough to make out)? Used by photo mode. */
  inFrame(camera: THREE.Camera): boolean {
    if (!this.visible) return false;
    const v = this.pos.clone().project(camera);
    return v.z < 1 && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.92 && camera.position.distanceTo(this.pos) < 140;
  }
  dispose(): void { for (const g of this.poses) g.dispose(); this.prints.geometry.dispose(); this.bodyMat.dispose(); this.printMat.dispose(); }
}
