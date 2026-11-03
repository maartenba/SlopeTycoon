import { clamp } from './CameraController';

/** A camera shot: ground target (world x,z), yaw (rad) and zoom (CameraController units). */
export interface Shot { x: number; z: number; yaw: number; zoom: number }

export type PoiKind = 'village' | 'lift' | 'piste' | 'lake' | 'train' | 'cat' | 'skier' | 'carrier' | 'animal' | 'farm' | 'hut' | 'beach' | 'altiport' | 'festival' | 'heli' | 'adventure';

/** Point of interest the director can look at. `at()` may move (skier / carrier / snowcat) and returns null when the thing is gone. */
export interface Poi {
  kind: PoiKind;
  id: string;
  /** Static position, or a live lookup (follow shots). */
  at: () => { x: number; z: number } | null;
  /** [min, max] zoom for a framing of this thing. */
  zoom: [number, number];
  /** Follow shots stay shorter and track the target. */
  follow?: boolean;
  /** Relative pick weight (default 1). */
  weight?: number;
}

export const easeInOutCubic = (t: number): number => { const c = clamp(t, 0, 1); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; };
export const smoothstep01 = (t: number): number => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

/** Shortest signed angle difference b - a in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function lerpAngle(a: number, b: number, t: number): number { return a + angleDelta(a, b) * t; }

/** Frame-rate independent exponential approach: fraction of the remaining distance covered in `dt` with response `rate` (1/s). */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));

/** One critically damped spring state (SmoothDamp): position `x` follows a moving goal with a CONTINUOUS velocity, so a cut, a reversing target or a frame-time spike never makes a kink (a first-order exponential has a velocity step at every change of the goal). */
export interface Spring { x: number; v: number }
/** Exact solution of x'' = w^2 (goal - x) - 2 w x' over `dt` (no integration error, stable for any dt). `w` in rad/s: the response time is about 3 / w. */
export function springStep(s: Spring, goal: number, w: number, dt: number): void {
  if (!(dt > 0)) return;
  const e = Math.exp(-Math.max(0, w) * dt), d = s.x - goal, t = s.v + w * d;
  s.x = goal + (d + t * dt) * e;
  s.v = (s.v - w * t * dt) * e;
}

/** Visible ground height (world units) at a zoom level for a map size (mirrors CameraController.viewHeight = 0.75 * size). */
export const viewHeightAt = (size: number, zoom: number): number => (size * 0.75) / Math.max(0.01, zoom);

/**
 * Keep the framing inside the map: the target is pulled in so that roughly `inset` of the visible half extent stays on the slab
 * (the void begins past the edge). The margin shrinks on small maps / wide views, never negative.
 */
export function frameInside(shot: Shot, size: number, aspect: number): Shot {
  const vh = viewHeightAt(size, shot.zoom);
  const half = Math.max(vh / 2, (vh * aspect) / 2);
  const margin = Math.min(size * 0.5 - 1, half * 0.8);
  return { ...shot, x: clamp(shot.x, margin, size - margin), z: clamp(shot.z, margin, size - margin) };
}

/** Deterministic PRNG (mulberry32) for shot picking: the director never touches the sim's RNG. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Picks the next POI: weighted, never the same kind twice in a row, avoids the last few ids. Pure given `rand`. */
export function pickPoi(pois: readonly Poi[], recent: readonly string[], lastKind: PoiKind | null, rand: () => number): Poi | null {
  const live = pois.filter((p) => p.at() !== null);
  if (!live.length) return null;
  let pool = live.filter((p) => p.kind !== lastKind && !recent.includes(p.id));
  if (!pool.length) pool = live.filter((p) => !recent.includes(p.id));
  if (!pool.length) pool = live;
  let total = 0;
  for (const p of pool) total += p.weight ?? 1;
  let r = rand() * total;
  for (const p of pool) { r -= p.weight ?? 1; if (r <= 0) return p; }
  return pool[pool.length - 1]!;
}

export interface ShotPlan { poi: Poi; duration: number; zoomA: number; zoomB: number; yawA: number; yawRate: number; offset: { x: number; z: number } }

/** Builds a plan for a POI: distinct framing (wide / medium / close) from its zoom range, slow dolly (zoom drift) and yaw drift. */
export function planShot(poi: Poi, prevYaw: number, rand: () => number, size = 64): ShotPlan {
  const [zmin, zmax] = poi.zoom;
  const framing = rand();
  const base = framing < 0.34 ? zmin : framing < 0.7 ? (zmin + zmax) / 2 : zmax;
  const dolly = rand() < 0.5 ? 1.12 : 0.9; // push in or pull back a little over the shot
  const zoomA = clamp(base, zmin, zmax);
  const zoomB = clamp(zoomA * dolly, zmin * 0.9, zmax * 1.1);
  const dir = rand() < 0.5 ? -1 : 1;
  const swing = 0.5 + rand() * 0.9; // rad over the shot
  const duration = poi.follow ? 9 + rand() * 5 : 12 + rand() * 8;
  // look INTO the map: the yaw whose forward vector points at the map centre (+- ~35 deg), so the slab edge / void stay behind and below
  const at = poi.at();
  const centreYaw = at ? Math.atan2(-(size / 2 - at.x), -(size / 2 - at.z)) : prevYaw;
  void prevYaw;
  return {
    poi, duration, zoomA, zoomB, yawA: centreYaw + (rand() - 0.5) * 1.2, yawRate: (dir * swing * 0.5) / duration,
    offset: { x: (rand() - 0.5) * 3, z: (rand() - 0.5) * 3 },
  };
}

/** The framing wanted `t` seconds into a plan (before smoothing / bounds). Zoom eases between A and B. */
export function shotAt(plan: ShotPlan, t: number, size: number, aspect: number): Shot {
  const p = plan.poi.at();
  const k = easeInOutCubic(t / plan.duration);
  const raw: Shot = { x: (p?.x ?? size / 2) + plan.offset.x * (plan.poi.follow ? 0 : 1), z: (p?.z ?? size / 2) + plan.offset.z * (plan.poi.follow ? 0 : 1), yaw: plan.yawA + plan.yawRate * t, zoom: plan.zoomA + (plan.zoomB - plan.zoomA) * k };
  return frameInside(raw, size, aspect);
}

/** The few camera controls the director drives (CameraController satisfies this). */
export interface CameraLike {
  target: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown };
  yaw: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  zoomBy(f: number): void;
  /** Re-poses the camera from target / yaw (the director runs after the controls' own update, so without this the pose lags the projection by a frame). */
  update?(dt: number): void;
}

export interface DemoCameraOptions {
  size: number;
  aspect: () => number;
  pois: () => readonly Poi[];
  groundY?: (x: number, z: number) => number;
  reducedMotion?: boolean;
  seed?: number;
}

/**
 * Cinematic loop for the title screen: shot after shot (village, lift stations, a busy piste, the lake, the train, the snowcat, a skier,
 * a carrier) with eased dolly + yaw drift and exponential smoothing between shots. `reducedMotion` = one static wide village framing
 * with a very slow drift (no cuts, no follow). Pure logic lives in the exported helpers above (unit-tested).
 */
export class DemoCamera {
  private plan: ShotPlan | null = null;
  private t = 0;
  private recent: string[] = [];
  private lastKind: PoiKind | null = null;
  private readonly rand: () => number;
  /** Smoothed state (critically damped springs: position, yaw, log zoom, ground height). */
  private cur: Shot | null = null;
  private sx: Spring = { x: 0, v: 0 }; private sz: Spring = { x: 0, v: 0 }; private syaw: Spring = { x: 0, v: 0 }; private szoom: Spring = { x: 0, v: 0 }; private sy: Spring = { x: 0, v: 0 };
  private ready = false;
  current(): { kind: PoiKind; id: string } | null { return this.plan ? { kind: this.plan.poi.kind, id: this.plan.poi.id } : null; }

  constructor(private cam: CameraLike, private o: DemoCameraOptions) {
    this.rand = mulberry(o.seed ?? 12345);
  }

  private next(): void {
    const pois = this.o.pois();
    if (this.o.reducedMotion) {
      const v = pois.find((p) => p.kind === 'village') ?? pois[0];
      if (v) this.plan = { poi: v, duration: 1e9, zoomA: v.zoom[0], zoomB: v.zoom[0], yawA: this.cam.yaw, yawRate: 0.004, offset: { x: 0, z: 0 } };
      return;
    }
    const poi = pickPoi(pois, this.recent, this.lastKind, this.rand);
    if (!poi) return;
    this.recent.push(poi.id);
    if (this.recent.length > 4) this.recent.shift();
    this.lastKind = poi.kind;
    this.plan = planShot(poi, this.cur?.yaw ?? this.cam.yaw, this.rand, this.o.size);
    this.t = 0;
  }

  update(dt: number): void {
    if (!this.plan || (!this.o.reducedMotion && (this.t > this.plan.duration || this.plan.poi.at() === null))) this.next();
    const plan = this.plan;
    if (!plan) return;
    this.t += dt;
    const want = shotAt(plan, this.t, this.o.size, this.o.aspect());
    if (!this.ready) { // first frame: start from wherever the camera is, at rest
      this.sx.x = this.cam.target.x; this.sz.x = this.cam.target.z; this.syaw.x = this.cam.yaw; this.szoom.x = Math.log(this.cam.zoom); this.sy.x = this.cam.target.y;
      this.ready = true;
    }
    // critically damped followers: velocity stays continuous across cuts, reversing follow targets and frame-time spikes (the title camera used to wobble:
    // first-order exponentials with a time-varying rate + a half-rate first frame + the raw bilinear ground height as the look height)
    const wMove = plan.poi.follow ? 1.5 : 0.9;
    springStep(this.sx, want.x, wMove, dt);
    springStep(this.sz, want.z, wMove, dt);
    springStep(this.syaw, this.syaw.x + angleDelta(this.syaw.x, want.yaw), 0.9, dt);
    springStep(this.szoom, Math.log(Math.max(0.01, want.zoom)), 0.8, dt);
    const c = this.cur ?? (this.cur = { x: 0, z: 0, yaw: 0, zoom: 1 });
    c.x = this.sx.x; c.z = this.sz.x; c.yaw = this.syaw.x; c.zoom = Math.exp(this.szoom.x);
    const s = frameInside(c, this.o.size, this.o.aspect());
    // the ground height under the look target is a bilinear patch: its slope changes at every tile edge, which would bob the whole picture. Follow it with a slow spring instead.
    springStep(this.sy, this.o.groundY ? this.o.groundY(s.x, s.z) : 0, 2.2, dt);
    this.cam.target.set(s.x, this.sy.x, s.z);
    this.cam.yaw = s.yaw;
    this.cam.zoom = clamp(s.zoom, this.cam.minZoom, this.cam.maxZoom);
    this.cam.zoomBy(1); // re-project
    this.cam.update?.(0); // pose from the NEW target / yaw now (the controls ran earlier this frame)
  }
}
