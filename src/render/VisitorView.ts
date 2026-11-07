import * as THREE from 'three';
import type { Grid } from '@/world/Grid';
import type { Visitor, Print } from '@/sim/nature/Visitor';
import { surfaceHeightAt } from '@/render/meshes/Paths';
import { createPoseSet, WALK_FRAMES, WAVE_FRAMES, type PoseSet } from '@/render/meshes/rareVisitor';
import { frameOf } from '@/render/meshes/visitorGait';

/**
 * Rare high-country visitor view: ONE vertex-coloured mesh (four walk poses swapped on the same mesh) and ONE draped footprint mesh. Nothing is
 * visible (and nothing is drawn) while no visit is on. Footprints are unlit-free Lambert decals draped with `surfaceHeightAt` (world-space,
 * no shader, no noise: flicker-safe). Read-only: it never touches the sim.
 */
export class VisitorView {
  readonly group = new THREE.Group();
  private poses: PoseSet = createPoseSet();
  private body: THREE.Mesh;
  private bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true });
  private prints: THREE.Mesh;
  private printMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private printKey = '';
  private cx = 0; private cz = 0; private yaw = 0; private seen = false; private alpha = 0; private clock = 0; private lastY = 0;
  /** Pose chosen last frame (tests / debug). */
  lastPose = { kind: 'idle' as 'walk' | 'idle' | 'wave', frame: 0, look: 0 as -1 | 0 | 1 };
  /** Current world position of the visitor (for hit tests / the photo check). */
  readonly pos = new THREE.Vector3();

  constructor(private grid: Grid, private visitor: Visitor, private now: () => number, private camera: THREE.Camera = new THREE.PerspectiveCamera()) {
    this.group.name = 'rareVisitor';
    this.bodyMat.name = 'rareVisitor'; this.printMat.name = 'rareVisitorTracks';
    this.body = new THREE.Mesh(this.poses.get('idle', 0), this.bodyMat); this.body.name = 'rareVisitor';
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
    this.clock += Math.max(0, dt);
    if (!this.seen) { this.cx = p.x; this.cz = p.y; this.yaw = p.yaw; this.seen = true; }
    const dx = p.x - this.cx, dz = p.y - this.cz;
    if (Math.hypot(dx, dz) > 3) { this.cx = p.x; this.cz = p.y; } else { const k = 1 - Math.exp(-Math.max(0, dt) * 5); this.cx += dx * k; this.cz += dz * k; }
    // facing: its walking direction, turned smoothly; the last peek turns it to face the camera
    let want = p.yaw;
    if (p.mode === 'wave') want = Math.atan2(this.camera.position.x - this.cx, this.camera.position.z - this.cz);
    let dy = want - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-Math.max(0, dt) * 3.5));
    // pose: walk frame from the distance walked (feet match the footprints), idle looks around, wave frames over the peek; now and then it glances aside
    const kind: 'walk' | 'idle' | 'wave' = p.mode; let frame = 0, look: -1 | 0 | 1 = 0;
    if (p.mode === 'walk') { frame = frameOf(p.phase, WALK_FRAMES); const g = this.clock % 7; look = g > 5.6 ? (Math.floor(this.clock / 7) % 2 ? 1 : -1) : 0; }
    else if (p.mode === 'idle') look = p.modeT < 0.3 ? 0 : p.modeT < 0.6 ? -1 : p.modeT < 0.85 ? 1 : 0;
    else frame = Math.min(WAVE_FRAMES - 1, Math.floor(p.modeT * WAVE_FRAMES));
    this.lastPose = { kind, frame, look };
    this.body.geometry = this.poses.get(kind, frame, look);
    const breathe = p.mode === 'walk' ? 0 : Math.sin(this.clock * 2.1) * 0.012;
    const gy = surfaceHeightAt(this.grid, this.cx, this.cz), s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const gf = surfaceHeightAt(this.grid, this.cx + s * 0.25, this.cz + c * 0.25), gb = surfaceHeightAt(this.grid, this.cx - s * 0.25, this.cz - c * 0.25);
    const pitch = Math.max(-0.45, Math.min(0.45, Math.atan2(gf - gb, 0.5)));
    this.body.rotation.order = 'YXZ'; this.body.rotation.set(-pitch, this.yaw, 0);
    this.body.position.set(this.cx, (gf + gb) / 2 + breathe, this.cz); void gy;
    this.alpha = p.alpha; this.bodyMat.opacity = p.alpha; this.body.visible = true;
    this.pos.set(this.cx, gy + 0.5, this.cz);
  }

  private updatePrints(list: Print[], alpha: number): void {
    if (!list.length || alpha <= 0) { this.prints.visible = false; return; }
    this.prints.visible = true; this.printMat.opacity = 0.9 * alpha;
    const key = `${list.length}|${this.grid.terrainVersion}`;
    if (key === this.printKey) return;
    this.printKey = key;
    const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
    const SEG = 10, A = 0.095, B = 0.2, RIM = 1.4;
    const INNER = [0.3, 0.38, 0.52], RIMC = [0.62, 0.7, 0.82];
    for (const pr of list) {
      const cs = Math.cos(pr.yaw), sn = Math.sin(pr.yaw);
      const vert = (lx: number, lz: number, c: number[]): number => { const wx = pr.x + lx * cs + lz * sn, wz = pr.y - lx * sn + lz * cs; pos.push(wx, surfaceHeightAt(this.grid, wx, wz) + 0.012, wz); nor.push(0, 1, 0); col.push(c[0]!, c[1]!, c[2]!); return pos.length / 3 - 1; };
      // sole: dark inner fan inside a soft lighter rim ring (reads as a pressed dent); toes the same, smaller
      const blob = (cx: number, cz: number, rx: number, rz: number, n: number): void => {
        const c0 = vert(cx, cz, INNER), inner: number[] = [], outer: number[] = [];
        for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; inner.push(vert(cx + Math.cos(a) * rx, cz + Math.sin(a) * rz * (Math.sin(a) > 0 ? 1.1 : 0.9), INNER)); }
        for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; outer.push(vert(cx + Math.cos(a) * rx * RIM, cz + Math.sin(a) * rz * RIM * (Math.sin(a) > 0 ? 1.1 : 0.9), RIMC)); }
        for (let k = 0; k < n; k++) { const m = (k + 1) % n; idx.push(c0, inner[m]!, inner[k]!, inner[k]!, inner[m]!, outer[k]!, inner[m]!, outer[m]!, outer[k]!); }
      };
      blob(0, 0, A, B, SEG);
      for (let t = 0; t < 4; t++) blob((t - 1.5) * 0.06, B * 1.3 - Math.abs(t - 1.5) * 0.035, 0.028, 0.04, 5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
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
  dispose(): void { this.poses.dispose(); this.prints.geometry.dispose(); this.bodyMat.dispose(); this.printMat.dispose(); }
}
