import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cliffFaces, type CliffFace, type CliffRule } from '../world/Cliffs';
import type { Grid } from '../world/Grid';

/** What the view needs of one open crag (derived from the attraction; tile coordinates). */
export interface CragView { id: number; x: number; y: number; w: number; h: number; users: number; open: boolean }

/** Climbers drawn per crag at most, and over the whole map. */
export const CRAG_VIEW = { perCrag: 6, total: 36, minGap: 0.95 } as const;

const PALETTE = [0xd9453a, 0x4a90d9, 0xf2c14e, 0x5cb85c, 0xf08a24, 0x8e5bd0] as const;
/** Faces are re-derived every this many ticks (the terrain can change under a crag; the scan is a 10x10 tile loop). */
const FACE_TTL = 480;

/** Pure: pick up to `n` well-spaced cliff faces, nearest first. */
export function pickFaces(faces: readonly CliffFace[], n: number, gap: number = CRAG_VIEW.minGap): CliffFace[] {
  const out: CliffFace[] = [];
  for (const f of faces) {
    if (out.length >= n) break;
    if (out.every((o) => Math.hypot(o.cx - f.cx, o.cy - f.cy) >= gap)) out.push(f);
  }
  return out;
}

/** Climb progress 0..1 up the face: a slow triangle wave with a different period per climber (pure in the tick). */
export function climbProgress(tick: number, seed: number): number {
  const per = 70 + 13 * (seed % 5), u = ((tick + seed * 23) % per) / per;
  return 0.12 + 0.76 * (u < 0.5 ? u * 2 : 2 - u * 2);
}

/**
 * Climbers on the rock face of every open crag (view only; docs/climbing.md): a helmeted figure per climbing guest (up to 6 per crag) on a spaced cliff
 * tile within reach of the hut, facing the rock and moving up and down it, each on a rope from the anchor at the top of the face. Two instanced meshes
 * (climbers + ropes). Reads the sim through `views()`, writes nothing.
 */
export class CragClimbers {
  readonly group = new THREE.Group();
  readonly climbers: THREE.InstancedMesh;
  readonly ropes: THREE.InstancedMesh;
  private cache = new Map<number, { tick: number; key: string; faces: CliffFace[] }>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private ex = new THREE.Vector3(1, 0, 0);
  private lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.5);
  private d = new THREE.Vector3();
  private col = new THREE.Color();
  private lastTick = NaN;
  /** Hidden when the camera is zoomed far out (set by the caller like the other activity props). */
  far = false;

  constructor(private grid: Grid, private views: () => Iterable<CragView>, private ground: (x: number, z: number) => number, private rule: CliffRule) {
    this.group.name = 'cragClimbers';
    // body + helmet + raised arms + stepping legs (one tinted merged mesh: ~120 triangles)
    const limb = (x: number, y: number, z: number, rz: number, len: number): THREE.BufferGeometry => { const g = new THREE.BoxGeometry(0.025, len, 0.025); g.rotateZ(rz); g.translate(x, y, z); return g; };
    const body = new THREE.CapsuleGeometry(0.045, 0.1, 2, 5); body.translate(0, 0.13, 0);
    const head = new THREE.SphereGeometry(0.048, 6, 5); head.translate(0, 0.27, 0);
    const fig = mergeGeometries([body, head, limb(0.07, 0.24, 0.05, -0.5, 0.13), limb(0.07, 0.24, -0.05, -0.5, 0.13), limb(0.03, 0.04, 0.03, 0.3, 0.12), limb(-0.02, 0.05, -0.03, -0.25, 0.12)].map((g) => (g.index ? g.toNonIndexed() : g)))!;
    this.climbers = new THREE.InstancedMesh(fig, new THREE.MeshLambertMaterial({ color: 0xffffff }), CRAG_VIEW.total);
    const rope = new THREE.BoxGeometry(1, 0.012, 0.012);
    this.ropes = new THREE.InstancedMesh(rope, new THREE.MeshLambertMaterial({ color: 0xf08a24 }), CRAG_VIEW.total);
    for (const m of [this.climbers, this.ropes]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0; this.group.add(m); }
    this.climbers.setColorAt(0, this.col.set(PALETTE[0]!)); // allocates the colour buffer
  }

  get count(): number { return this.climbers.count; }

  private facesOf(v: CragView, tick: number): CliffFace[] {
    const key = `${v.x},${v.y},${v.w},${v.h}`, c = this.cache.get(v.id);
    if (c && c.key === key && tick - c.tick < FACE_TTL && tick >= c.tick) return c.faces;
    const faces = pickFaces(cliffFaces(this.grid, v, this.rule), CRAG_VIEW.perCrag);
    this.cache.set(v.id, { tick, key, faces });
    return faces;
  }

  /** `tick` = sim tick (+ fraction); `viewHeight` is unused except through `far`. */
  update(tick: number): void {
    this.group.visible = !this.far;
    if (this.far) return;
    if (tick === this.lastTick) return;
    this.lastTick = tick;
    let n = 0;
    for (const v of this.views()) {
      if (!v.open || v.users <= 0) continue;
      const faces = this.facesOf(v, tick), k = Math.min(v.users, faces.length);
      for (let i = 0; i < k && n < CRAG_VIEW.total; i++, n++) {
        const f = faces[i]!, dx = Math.cos(f.heading), dy = Math.sin(f.heading), pr = climbProgress(tick, v.id * 7 + i);
        const x = f.cx + dx * (pr - 0.5) * 0.85, z = f.cy + dy * (pr - 0.5) * 0.85;
        const ax = f.cx + dx * 0.5, az = f.cy + dy * 0.5;
        const y = this.ground(x, z), ay = this.ground(ax, az) + 0.06;
        this.p.set(x, y + 0.04, z);
        this.q.setFromAxisAngle(this.up, -f.heading).multiply(this.lean); // faces the rock and leans into it
        this.s.setScalar(1.4);
        this.m.compose(this.p, this.q, this.s);
        this.s.set(1, 1, 1);
        this.climbers.setMatrixAt(n, this.m);
        this.climbers.setColorAt(n, this.col.set(PALETTE[(v.id + i) % PALETTE.length]!));
        // rope: chest -> anchor
        this.d.set(ax - x, ay - (y + 0.2), az - z);
        const len = Math.max(0.01, this.d.length());
        this.q.setFromUnitVectors(this.ex, this.d.normalize());
        this.p.set((x + ax) / 2, (y + 0.2 + ay) / 2, (z + az) / 2);
        this.s.set(len, 1, 1);
        this.m.compose(this.p, this.q, this.s);
        this.ropes.setMatrixAt(n, this.m);
        this.s.set(1, 1, 1);
      }
    }
    this.climbers.count = n; this.ropes.count = n;
    this.climbers.instanceMatrix.needsUpdate = true; this.ropes.instanceMatrix.needsUpdate = true;
    if (this.climbers.instanceColor) this.climbers.instanceColor.needsUpdate = true;
  }

  /** Drop cached faces of a removed crag. */
  forget(id: number): void { this.cache.delete(id); }
}
