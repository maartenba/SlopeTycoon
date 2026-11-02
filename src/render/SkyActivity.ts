import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SKY_VIEW } from '../config/sky';

/**
 * Sky activities (M7.4, docs/m74-buildings.md): the jump plane of every open Skydive Centre (circles over the Grass Strip, jumpers leave it and canopies spiral down to the
 * strip) and the gliders of every open Launch Ramp (glide from the ramp to the Landing Field with a thermal-lite circle). View only: reads the attractions, writes nothing,
 * draws 3 instanced meshes (plane, canopies, gliders), capped by SKY_VIEW. Deterministic in the tick: no RNG at all.
 */
export interface SkyCentre { id: number; users: number; open: boolean; /** The Grass Strip it flies from: footprint in tiles. */ strip: { x: number; y: number; w: number; h: number } | null }
export interface SkyRamp { id: number; users: number; open: boolean; x: number; y: number; w: number; h: number; /** Landing Field centre (tiles) or null. */ landing: { x: number; y: number } | null }

/** One plane load lasts this many sim ticks (10 ticks = 1 game hour; about 50 s at 1x). */
export const SKY_CYCLE = 80;
export const GLIDE_CYCLE = 120;
/** Cruise altitude of the plane above the strip (world units) and the circle radius (tiles). */
export const PLANE = { alt: 5.5, radius: 5 } as const;

export interface Pose { x: number; y: number; z: number; heading: number }
const TAU = Math.PI * 2;

/** Pure: the plane at cycle position `u` (0..1) over a strip centred at (cx, cy) with axis angle `ax`: roll out, climb in a circle, jump at `JUMP_AT`, descend and land. */
export const JUMP_AT = 0.55;
export function planePose(u: number, cx: number, cy: number, ax: number, out: Pose = { x: 0, y: 0, z: 0, heading: 0 }): Pose {
  const len = 3, R = PLANE.radius;
  if (u < 0.12) { // take-off run along the strip
    const t = u / 0.12; out.x = cx + Math.cos(ax) * (-len + 2 * len * t); out.y = cy + Math.sin(ax) * (-len + 2 * len * t); out.z = t > 0.7 ? (t - 0.7) * 1.2 : 0.02; out.heading = ax; return out;
  }
  if (u < 0.88) { // circle: climb to the jump point, then descend
    const t = (u - 0.12) / 0.76, ang = ax + t * TAU * 1.6;
    out.x = cx + Math.cos(ang) * R + Math.cos(ax) * len; out.y = cy + Math.sin(ang) * R + Math.sin(ax) * len;
    const climb = Math.min(1, t / ((JUMP_AT - 0.12) / 0.76)), down = Math.max(0, (t - (JUMP_AT - 0.12) / 0.76) / (1 - (JUMP_AT - 0.12) / 0.76));
    out.z = 0.35 + (PLANE.alt - 0.35) * climb * (1 - 0.8 * down); out.heading = ang + Math.PI / 2; return out;
  }
  const t = (u - 0.88) / 0.12; // final approach and landing roll
  out.x = cx + Math.cos(ax) * (len * 2 - 5.5 * t - 0.5); out.y = cy + Math.sin(ax) * (len * 2 - 5.5 * t - 0.5); out.z = 0.35 * (1 - t) + 0.02; out.heading = ax + Math.PI; return out;
}
/** Pure: a canopy `k` of `n` at cycle position `u` (only drawn from the jump on): a gentle spiral from the exit point down to the strip. Null before the jump / after landing. */
export function canopyPose(u: number, k: number, cx: number, cy: number, ax: number, out: Pose = { x: 0, y: 0, z: 0, heading: 0 }): Pose | null {
  if (u < JUMP_AT + 0.01 || u > 0.97) return null;
  const exit = planePose(JUMP_AT, cx, cy, ax), t = (u - JUMP_AT) / (0.97 - JUMP_AT), ease = 1 - Math.pow(1 - t, 1.3);
  const ang = TAU * (k / 6) + t * TAU * (1.4 + 0.1 * (k % 3)), r = 1.8 * (1 - ease) + 0.6 + 0.35 * (k % 3);
  out.x = (exit.x + (cx - exit.x) * ease) + Math.cos(ang) * r * (1 - ease * 0.3);
  out.y = (exit.y + (cy - exit.y) * ease) + Math.sin(ang) * r * (1 - ease * 0.3);
  out.z = Math.max(0.05, exit.z * (1 - ease) + 0.05 + 0.15 * (1 - t) * (k % 2)); out.heading = ang + Math.PI / 2; return out;
}
/** Pure: a glider at cycle position `u` between the ramp and the landing field: a straight glide with a lazy circle (thermal-lite) in the middle third. */
export function gliderPose(u: number, ramp: { x: number; y: number }, land: { x: number; y: number }, rampZ: number, landZ: number, out: Pose = { x: 0, y: 0, z: 0, heading: 0 }): Pose {
  const dx = land.x - ramp.x, dy = land.y - ramp.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
  const s = u < 0.05 ? 0 : u > 0.95 ? 1 : (u - 0.05) / 0.9, loop = Math.sin(Math.PI * Math.min(1, Math.max(0, (s - 0.25) / 0.5)));
  const ang = TAU * 2 * Math.min(1, Math.max(0, (s - 0.25) / 0.5)), r = 2.2 * loop; // two lazy circles (4 pi: the heading comes back to the glide line)
  out.x = ramp.x + dx * s + nx * Math.sin(ang) * r + (dx / d) * (1 - Math.cos(ang)) * r * 0.3;
  out.y = ramp.y + dy * s + ny * Math.sin(ang) * r + (dy / d) * (1 - Math.cos(ang)) * r * 0.3;
  out.z = (rampZ + 1) * (1 - s) + (landZ + 0.4) * s + 0.9 * loop; // ABSOLUTE height (the caller subtracts the ground under the glider)
  out.heading = Math.atan2(dy, dx) + ang; return out;
}

const col = (g: THREE.BufferGeometry, c: number): THREE.BufferGeometry => {
  const n = g.attributes.position!.count, a = new Float32Array(n * 3), k = new THREE.Color(c);
  for (let i = 0; i < n; i++) { a[i * 3] = k.r; a[i * 3 + 1] = k.g; a[i * 3 + 2] = k.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g.index ? g.toNonIndexed() : g;
};
const bx = (w: number, h: number, d: number, c: number, x = 0, y = 0, z = 0): THREE.BufferGeometry => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return col(g, c); };

export class SkyActivity {
  readonly group = new THREE.Group();
  readonly planes: THREE.InstancedMesh;
  readonly canopies: THREE.InstancedMesh;
  readonly gliders: THREE.InstancedMesh;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new THREE.Vector3(); private s = new THREE.Vector3(1, 1, 1); private up = new THREE.Vector3(0, 1, 0);
  private pose: Pose = { x: 0, y: 0, z: 0, heading: 0 }; private c = new THREE.Color();
  private lastTick = NaN;
  far = false;
  /** Aircraft drawn last update (tests / harness). */
  drawn = { planes: 0, canopies: 0, gliders: 0 };

  constructor(private ground: (x: number, z: number) => number, private centres: () => Iterable<SkyCentre>, private ramps: () => Iterable<SkyRamp>) {
    this.group.name = 'skyActivity';
    // small high-wing plane (forward = +x): fuselage, wing, tail, tail fin, propeller disc (~60 triangles)
    const plane = mergeGeometries([bx(0.62, 0.11, 0.11, 0xf4f1ea), bx(0.13, 0.025, 0.86, 0xd9453a, 0.02, 0.07, 0), bx(0.1, 0.02, 0.3, 0xf4f1ea, -0.28, 0.02, 0), bx(0.09, 0.15, 0.02, 0xd9453a, -0.28, 0.1, 0), bx(0.02, 0.2, 0.03, 0x555555, 0.32, 0, 0)])!;
    // canopy (forward = +x): a flat arched wing of three panels + a hanging jumper
    const can = mergeGeometries([bx(0.2, 0.012, 0.16, 0xffffff, 0, 0.26, 0), bx(0.2, 0.012, 0.1, 0xffffff, 0, 0.245, 0.12), bx(0.2, 0.012, 0.1, 0xffffff, 0, 0.245, -0.12), bx(0.03, 0.14, 0.03, 0x2f3b52, 0, 0.1, 0)])!;
    // glider (forward = +x): a delta wing with a pilot below
    const gl = mergeGeometries([bx(0.16, 0.01, 0.62, 0xffffff, 0, 0.2, 0), bx(0.12, 0.01, 0.4, 0xffffff, 0.1, 0.2, 0), bx(0.03, 0.14, 0.03, 0x2f3b52, 0, 0.1, 0)])!;
    const mk = (g: THREE.BufferGeometry, n: number, tint: boolean): THREE.InstancedMesh => {
      const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }), n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0;
      if (tint) m.setColorAt(0, this.c.set(0xffffff));
      this.group.add(m); return m;
    };
    this.planes = mk(plane, SKY_VIEW.planes, false);
    this.canopies = mk(can, SKY_VIEW.planes * SKY_VIEW.canopiesPerPlane, true);
    this.gliders = mk(gl, SKY_VIEW.gliders, true);
  }

  private put(mesh: THREE.InstancedMesh, i: number, pose: Pose, scale: number): void {
    this.q.setFromAxisAngle(this.up, -pose.heading);
    this.m.compose(this.p.set(pose.x, pose.z + this.ground(pose.x, pose.y), pose.y), this.q, this.s.setScalar(scale));
    mesh.setMatrixAt(i, this.m);
  }

  /** `tick` = sim tick (+ fraction). */
  update(tick: number): void {
    this.group.visible = !this.far;
    if (this.far || tick === this.lastTick) return;
    this.lastTick = tick;
    let np = 0, nc = 0, ng = 0;
    const palette = [0xd9453a, 0x2f6fd0, 0xf2c14e, 0x3fa34d, 0xd63fa0, 0xf08a24] as const;
    for (const v of this.centres()) {
      if (!v.open || v.users <= 0 || !v.strip || np >= SKY_VIEW.planes) continue;
      const s = v.strip, cx = s.x + s.w / 2, cy = s.y + s.h / 2, ax = s.w >= s.h ? 0 : Math.PI / 2, u = ((tick + v.id * 17) % SKY_CYCLE) / SKY_CYCLE;
      this.put(this.planes, np++, planePose(u, cx, cy, ax, this.pose), 1.5);
      const k = Math.min(SKY_VIEW.canopiesPerPlane, v.users);
      for (let j = 0; j < k && nc < SKY_VIEW.canopiesPerPlane * SKY_VIEW.planes; j++) {
        const cp = canopyPose(u, j, cx, cy, ax, this.pose);
        if (!cp) continue;
        this.put(this.canopies, nc, cp, 1.5); this.canopies.setColorAt(nc, this.c.set(palette[(v.id + j) % palette.length]!)); nc++;
      }
    }
    for (const r of this.ramps()) {
      if (!r.open || r.users <= 0 || !r.landing) continue;
      const rx = r.x + r.w / 2, ry = r.y + r.h / 2, rz = this.ground(rx, ry), lz = this.ground(r.landing.x, r.landing.y);
      for (let j = 0; j < Math.min(r.users, 3) && ng < SKY_VIEW.gliders; j++) {
        const u = ((tick + r.id * 29 + j * 37) % GLIDE_CYCLE) / GLIDE_CYCLE;
        const gp = gliderPose(u, { x: rx, y: ry }, r.landing, rz, lz, this.pose);
        gp.z = Math.max(0.4, gp.z - this.ground(gp.x, gp.y)); this.put(this.gliders, ng, gp, 1.6);
        this.gliders.setColorAt(ng, this.c.set(palette[(r.id + j * 2) % palette.length]!)); ng++;
      }
    }
    this.planes.count = np; this.canopies.count = nc; this.gliders.count = ng;
    for (const m of [this.planes, this.canopies, this.gliders]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    this.drawn = { planes: np, canopies: nc, gliders: ng };
  }
}
