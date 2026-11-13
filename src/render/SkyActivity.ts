import * as THREE from 'three';
import { SKY_TIERS } from '../config/sky';
import type { GraphicsQuality } from '../config/balance';
import { buildAircraft } from './meshes/aircraft';
import { buildHangGlider, buildSquareCanopy } from './meshes/canopies';
import { mergeParts } from './meshes/sweepGeo';

/**
 * Sky activities (M7.4, docs/m74-buildings.md): the jump plane of every open Skydive Centre (circles over the Grass Strip, jumpers leave it and canopies spiral down to the
 * strip) and the gliders of every open Launch Ramp (glide from the ramp to the Landing Field with a thermal-lite circle). View only: reads the attractions, writes nothing,
 * draws 3 instanced meshes (plane, canopies, gliders), capped per Graphics quality by SKY_TIERS (High = SKY_VIEW). Deterministic in the tick: no RNG at all.
 */
export interface SkyCentre { id: number; users: number; open: boolean; /** The Grass Strip it flies from: footprint in tiles. */ strip: { x: number; y: number; w: number; h: number } | null; /** Buildings to clear (not the strip itself). */ obstacles?: readonly SkyObstacle[] }
export interface SkyRamp { id: number; users: number; open: boolean; x: number; y: number; w: number; h: number; /** Landing Field centre (tiles) or null. */ landing: { x: number; y: number } | null; obstacles?: readonly SkyObstacle[] }

/** One plane load lasts this many sim ticks (10 ticks = 1 game hour; about 50 s at 1x). */
export const SKY_CYCLE = 80;
export const GLIDE_CYCLE = 120;
/** Cruise altitude of the plane above the strip (world units) and the circle radius (tiles). */
export const PLANE = { alt: 5.5, radius: 5 } as const;

export interface Pose { x: number; y: number; z: number; heading: number }
const TAU = Math.PI * 2;

/** A building the aircraft must clear: footprint in tiles + roof height above the ground (config/buildingHeights). */
export interface SkyObstacle { x: number; y: number; w: number; h: number; top: number }
/** Which end of the strip the plane takes off towards (dir) and which way it turns (turn: +1 left, -1 right). */
export interface PlanePlan { dir: 1 | -1; turn: 1 | -1 }
/** Horizontal margin around an obstacle footprint (tiles; a bit more than the plane's half span) and the vertical clearance wanted over a roof (world units). */
export const SKY_MARGIN = 0.6, SKY_CLEAR = 1;

/** Roof height (above ground) of the tallest obstacle under (x, y), 0 when none. */
export function obstacleTop(x: number, y: number, obst: readonly SkyObstacle[] | undefined, margin = SKY_MARGIN): number {
  let t = 0;
  if (obst) for (const o of obst) if (x > o.x - margin && x < o.x + o.w + margin && y > o.y - margin && y < o.y + o.h + margin && o.top > t) t = o.top;
  return t;
}

const PL = { roll: 3, climb: 10, r: 2.5, far: -6, touch: 3 } as const; // take-off roll, straight climb-out, orbit radius, far end of the downwind leg (strip centre = 0), landing roll
const PL_E = PL.roll + PL.climb, PL_D = PL_E - PL.far, PL_ARC = Math.PI * PL.r, PL_O = PL_E + PL_ARC + PL_D, PL_U = Math.PI * 2 * PL.r, PL_T = 2 * PL_O + PL_U;
/** Outbound leg (left turn) in the strip frame: a along the take-off direction from the strip centre, b to the left, th = heading (0 = along a). */
function outLeg(s: number): [number, number, number] {
  const r = PL.r;
  if (s <= PL_E) return [s, 0, 0];
  if (s <= PL_E + PL_ARC) { const f = (s - PL_E) / r; return [PL_E + r * Math.sin(f), r - r * Math.cos(f), f]; }
  return [PL_E - (s - PL_E - PL_ARC), 2 * r, Math.PI];
}
/** Whole circuit: out (left), a U-turn at the far end, and back in along the SAME corridor (the mirror of the out leg, reversed): it lands from the end it took off towards. */
function circuit(s: number): [number, number, number] {
  if (s <= PL_O) return outLeg(s);
  if (s >= PL_O + PL_U) { const [a, b, th] = outLeg(PL_T - s); return [a, -b, Math.PI - th]; }
  const f = (s - PL_O) / (2 * PL.r), [a0, b0] = outLeg(PL_O), rho = 2 * PL.r; // left U-turn of radius 2r: from (a0, 2r) heading pi to (a0, -2r) heading 2 pi
  return [a0 - rho * Math.sin(f), b0 - rho + rho * Math.cos(f) + 0, Math.PI + f];
}
const PLAN_ORDER: readonly PlanePlan[] = [{ dir: 1, turn: 1 }, { dir: -1, turn: 1 }, { dir: 1, turn: -1 }, { dir: -1, turn: -1 }];
const DEFAULT_PLAN = PLAN_ORDER[0]!;

/**
 * Pure: the plane at cycle position `u` over a strip centred at (cx, cy) with axis angle `ax`. One continuous pattern (no jumps): roll out from the strip centre, a long straight
 * climb-out (gradient ~0.4 at the start: well above any roof by the time it passes a building 4 tiles on), a racetrack with the jump over the strip, a final approach along the axis
 * and the landing roll back to the centre. `plan` picks the take-off end and turn side (see choosePlanePlan); `obst` (optional) is a safety floor: the plane is never lower than a roof + SKY_CLEAR.
 */
export const JUMP_AT = 0.55;
export function planePose(u: number, cx: number, cy: number, ax: number, out: Pose = { x: 0, y: 0, z: 0, heading: 0 }, plan: PlanePlan = DEFAULT_PLAN, obst?: readonly SkyObstacle[]): Pose {
  const T = PL_T;
  let s: number;
  if (u < 0.12) { const t = u / 0.12; s = PL.roll * t * t; }
  else if (u < 0.88) s = PL.roll + (u - 0.12) / 0.76 * (T - PL.roll - PL.touch);
  else { const t = (u - 0.88) / 0.12; s = T - PL.touch + PL.touch * (1 - (1 - t) * (1 - t)); }
  const [a, b, th] = circuit(s);
  // height above the ground depends on the distance flown from the strip either way (the way out is the way back): rotate 2 tiles into the roll, climb to cruise over 16 tiles
  const d = Math.min(s, T - s);
  let z: number;
  if (d < 2) z = 0.02; else { const c = Math.min(1, (d - 2) / 16); z = 0.02 + (PLANE.alt - 0.02) * c * (1.25 - 0.25 * c); }
  const base = ax + (plan.dir < 0 ? Math.PI : 0), ca = Math.cos(base), sa = Math.sin(base), bb = plan.turn * b;
  out.x = cx + ca * a - sa * bb; out.y = cy + sa * a + ca * bb;
  out.heading = base + plan.turn * th;
  // safety floor: never closer than SKY_CLEAR to a roof it passes over (a take-off or landing never needs it on a layout the plan was chosen for)
  const top = obstacleTop(out.x, out.y, obst, groundMargin(z)); out.z = top > 0 ? Math.max(z, top + SKY_CLEAR) : z; return out;
}
/** Pure, deterministic: the plan (end + turn side, tried in a fixed order) whose flight clears every obstacle by the most (>= SKY_CLEAR wanted; ties go to the first of the order). */
export function planeMargin(plan: PlanePlan, cx: number, cy: number, ax: number, obst: readonly SkyObstacle[]): number {
  let m = Infinity; const p: Pose = { x: 0, y: 0, z: 0, heading: 0 };
  for (let i = 0; i <= 500; i++) {
    planePose(i / 500 * 0.9999, cx, cy, ax, p, plan);
    for (const o of obstacles(obst, p.x, p.y, groundMargin(p.z))) m = Math.min(m, p.z - o.top);
  }
  return m;
}
function* obstacles(obst: readonly SkyObstacle[], x: number, y: number, m: number): Generator<SkyObstacle> { for (const o of obst) if (x > o.x - m && x < o.x + o.w + m && y > o.y - m && y < o.y + o.h + m) yield o; }
/** On the ground (roll / touchdown at the strip end) the plane sits inside the strip, so only a sliver of margin counts; in the air the full SKY_MARGIN. */
const groundMargin = (z: number): number => (z < 0.1 ? 0.15 : SKY_MARGIN);
export function choosePlanePlan(cx: number, cy: number, ax: number, obst: readonly SkyObstacle[]): PlanePlan {
  if (obst.length === 0) return DEFAULT_PLAN;
  let best = DEFAULT_PLAN, bm = -Infinity;
  for (const pl of PLAN_ORDER) { const m = Math.min(planeMargin(pl, cx, cy, ax, obst), 3); if (m > bm + 1e-9) { bm = m; best = pl; } }
  return best;
}
/** Pure: a canopy `k` of `n` at cycle position `u` (only drawn from the jump on): a gentle spiral from the exit point down to the strip. Null before the jump / after landing. */
export function canopyPose(u: number, k: number, cx: number, cy: number, ax: number, out: Pose = { x: 0, y: 0, z: 0, heading: 0 }, plan: PlanePlan = DEFAULT_PLAN, obst?: readonly SkyObstacle[]): Pose | null {
  if (u < JUMP_AT + 0.01 || u > 0.97) return null;
  const exit = planePose(JUMP_AT, cx, cy, ax, undefined, plan), t = (u - JUMP_AT) / (0.97 - JUMP_AT), ease = 1 - Math.pow(1 - t, 1.3);
  const ang = TAU * (k / 6) + t * TAU * (1.4 + 0.1 * (k % 3)), r = 1.8 * (1 - ease) + 0.6 + 0.35 * (k % 3);
  out.x = (exit.x + (cx - exit.x) * ease) + Math.cos(ang) * r * (1 - ease * 0.3);
  out.y = (exit.y + (cy - exit.y) * ease) + Math.sin(ang) * r * (1 - ease * 0.3);
  out.z = Math.max(0.05, exit.z * (1 - ease) + 0.05 + 0.15 * (1 - t) * (k % 2)); out.heading = ang + Math.PI / 2;
  const top = obstacleTop(out.x, out.y, obst, 0.3); if (top > 0) out.z = Math.max(out.z, top + 0.5); return out;
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

/** The jump plane model is ~1.8 long; at this scale (x the 1.5 instance scale) it is about as long as the old box plane (0.62 x 1.5). */
export const SKY_PLANE_SCALE = 0.4;

/** The three merged geometries of a quality tier (High = the original models). */
export function skyGeometries(q: GraphicsQuality): { plane: THREE.BufferGeometry; can: THREE.BufferGeometry; gl: THREE.BufferGeometry } {
  const t = SKY_TIERS[q], air = buildAircraft(t.plane);
  const planeMat = new THREE.Matrix4().makeRotationY(Math.PI / 2).multiply(new THREE.Matrix4().makeScale(SKY_PLANE_SCALE, SKY_PLANE_SCALE, SKY_PLANE_SCALE));
  return { plane: mergeParts([...air.body, ...air.spinner, ...air.disc], planeMat), can: mergeParts(buildSquareCanopy(t.craft).parts), gl: mergeParts(buildHangGlider(t.craft).parts) };
}

export class SkyActivity {
  readonly group = new THREE.Group();
  readonly planes: THREE.InstancedMesh;
  readonly canopies: THREE.InstancedMesh;
  readonly gliders: THREE.InstancedMesh;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new THREE.Vector3(); private s = new THREE.Vector3(1, 1, 1); private up = new THREE.Vector3(0, 1, 0);
  private pose: Pose = { x: 0, y: 0, z: 0, heading: 0 }; private c = new THREE.Color();
  private lastTick = NaN;
  private plans = new Map<number, { key: string; plan: PlanePlan }>();
  /** The take-off plan of a centre (cached; recomputed when the strip or the buildings around it change). */
  private planFor(id: number, cx: number, cy: number, ax: number, ob: readonly SkyObstacle[]): PlanePlan {
    const key = `${cx},${cy},${ax}|${ob.map((o) => `${o.x},${o.y},${o.w},${o.h},${o.top}`).join(';')}`, c = this.plans.get(id);
    if (c && c.key === key) return c.plan;
    const plan = choosePlanePlan(cx, cy, ax, ob); this.plans.set(id, { key, plan }); return plan;
  }
  /** The jump plane of a centre at sim tick `tick` as a ground-relative pose (QA / promo camera tracks use the same path as the view). */
  planeOf(v: SkyCentre, tick: number, out: Pose = { x: 0, y: 0, z: 0, heading: 0 }): Pose | null {
    if (!v.strip) return null;
    const s = v.strip, cx = s.x + s.w / 2, cy = s.y + s.h / 2, ax = s.w >= s.h ? 0 : Math.PI / 2, ob = v.obstacles ?? [];
    return planePose(((tick + v.id * 17) % SKY_CYCLE) / SKY_CYCLE, cx, cy, ax, out, this.planFor(v.id, cx, cy, ax, ob), ob);
  }
  /** The first canopy of a centre at `tick` (null before the jump / after landing). */
  canopyOf(v: SkyCentre, tick: number, out: Pose = { x: 0, y: 0, z: 0, heading: 0 }): Pose | null {
    if (!v.strip) return null;
    const s = v.strip, cx = s.x + s.w / 2, cy = s.y + s.h / 2, ax = s.w >= s.h ? 0 : Math.PI / 2, ob = v.obstacles ?? [];
    return canopyPose(((tick + v.id * 17) % SKY_CYCLE) / SKY_CYCLE, 0, cx, cy, ax, out, this.planFor(v.id, cx, cy, ax, ob), ob);
  }
  far = false;
  /** Graphics quality tier: instance caps (`SKY_TIERS`) and the mesh detail. High = the original models and caps. */
  quality: GraphicsQuality = 'high';
  /** Switch tier (Settings > Graphics): swaps the three geometries and the caps; the instance buffers keep the High capacity. */
  setQuality(q: GraphicsQuality): void {
    if (q === this.quality) return;
    this.quality = q;
    const { plane, can, gl } = skyGeometries(q);
    for (const [m, g] of [[this.planes, plane], [this.canopies, can], [this.gliders, gl]] as const) { m.geometry.dispose(); m.geometry = g; }
    this.lastTick = NaN; // redraw with the new caps on the next update
  }
  /** Aircraft drawn last update (tests / harness). */
  drawn = { planes: 0, canopies: 0, gliders: 0 };

  constructor(private ground: (x: number, z: number) => number, private centres: () => Iterable<SkyCentre>, private ramps: () => Iterable<SkyRamp>, quality: GraphicsQuality = 'high') {
    this.quality = quality;
    this.group.name = 'skyActivity';
    // M8 smooth pass (docs/graphics-m8.md "Planes, paragliders and gliders"): the shared lofted high-wing plane (meshes/aircraft.ts, 'full', ~1,170 triangles incl. spinner + prop blur),
    // the square ram-air canopy with its jumper (~480) and the hang glider (~380). Forward = +x, one InstancedMesh each, same three draw calls as before.
    const { plane, can, gl } = skyGeometries(quality);
    const mk = (g: THREE.BufferGeometry, n: number, tint: boolean): THREE.InstancedMesh => {
      const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }), n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0;
      if (tint) m.setColorAt(0, this.c.set(0xffffff));
      this.group.add(m); return m;
    };
    this.planes = mk(plane, SKY_TIERS.high.planes, false);
    this.canopies = mk(can, SKY_TIERS.high.planes * SKY_TIERS.high.canopiesPerPlane, true);
    this.gliders = mk(gl, SKY_TIERS.high.gliders, true);
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
    const cap = SKY_TIERS[this.quality], maxC = cap.planes * cap.canopiesPerPlane;
    let np = 0, nc = 0, ng = 0;
    const palette = [0xf08a24, 0x1fa7a0, 0xf2c14e, 0xd9453a, 0x2f6fd0, 0xd63fa0] as const; // orange, teal, yellow, red, blue, pink
    for (const v of this.centres()) {
      if (!v.open || v.users <= 0 || !v.strip || np >= cap.planes) continue;
      const s = v.strip, cx = s.x + s.w / 2, cy = s.y + s.h / 2, ax = s.w >= s.h ? 0 : Math.PI / 2, u = ((tick + v.id * 17) % SKY_CYCLE) / SKY_CYCLE;
      const ob = v.obstacles ?? [], plan = this.planFor(v.id, cx, cy, ax, ob);
      this.put(this.planes, np++, planePose(u, cx, cy, ax, this.pose, plan, ob), 1.5);
      const k = Math.min(cap.canopiesPerPlane, v.users);
      for (let j = 0; j < k && nc < maxC; j++) {
        const cp = canopyPose(u, j, cx, cy, ax, this.pose, plan, ob);
        if (!cp) continue;
        this.put(this.canopies, nc, cp, 1.5); this.canopies.setColorAt(nc, this.c.set(palette[(v.id + j) % palette.length]!)); nc++;
      }
    }
    for (const r of this.ramps()) {
      if (!r.open || r.users <= 0 || !r.landing) continue;
      const rx = r.x + r.w / 2, ry = r.y + r.h / 2, rz = this.ground(rx, ry), lz = this.ground(r.landing.x, r.landing.y);
      for (let j = 0; j < Math.min(r.users, 3) && ng < cap.gliders; j++) {
        const u = ((tick + r.id * 29 + j * 37) % GLIDE_CYCLE) / GLIDE_CYCLE;
        const gp = gliderPose(u, { x: rx, y: ry }, r.landing, rz, lz, this.pose);
        gp.z = Math.max(0.4, gp.z - this.ground(gp.x, gp.y), obstacleTop(gp.x, gp.y, r.obstacles, 0.3) > 0 ? obstacleTop(gp.x, gp.y, r.obstacles, 0.3) + SKY_CLEAR : 0); this.put(this.gliders, ng, gp, 1.6);
        this.gliders.setColorAt(ng, this.c.set(palette[(r.id + j * 2) % palette.length]!)); ng++;
      }
    }
    this.planes.count = np; this.canopies.count = nc; this.gliders.count = ng;
    for (const m of [this.planes, this.canopies, this.gliders]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    this.drawn = { planes: np, canopies: nc, gliders: ng };
  }
}
