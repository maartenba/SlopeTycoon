import * as THREE from 'three';
import { STRAND_OFFSET } from '../../sim/Lift';
import { SEAT_PITCH } from '../meshes/lifts/Chair';

/**
 * Perspective rig for the ground-level views (M5.2). The pose maths below is PURE (plain numbers, no per-frame allocation) and unit-tested in
 * tests/render/viewMode.test.ts; `ViewCameraRig` only pushes the result into a THREE.PerspectiveCamera.
 *
 * Scale: the world is 1 tile = TILE_METRES (10 m) for distances and speeds, but figures / chairs are drawn FIGURE_HEIGHT = 1.15 units tall
 * (= 1.7 m real, i.e. ~1.5 m per unit locally) so they read in the iso view. A literal 0.17-unit eye height would put the camera at ankle height of
 * every figure, tree and chair, so the eye heights below are in the FIGURE scale (head of a 1.15 unit figure ~1.05) - one consistent, believable world
 * at ground level. Tuned against the ride-* screenshots (docs/visual-qa.md).
 */
export const FIGURE_HEIGHT = 0.52;

export type RideKind = 'ski' | 'board' | 'chair' | 'gondola' | 'cablecar' | 'funicular' | 'bike' | 'foot';

export interface EyeSpec {
  /** Eye height above the guest origin (world units); for cable carriers the origin is the cable grip (negative = below the cable), for funiculars the track. */
  up: number;
  /** Eye offset ahead of the guest origin along the heading. */
  fwd: number;
  /** Vertical bob amplitude (ski carve rhythm / handlebar bounce) at full speed. */
  bob: number;
  /** Bob frequency (rad per metre-ish; multiplied by the clock). */
  bobHz: number;
  /** Roll sway amplitude on the cable / car (radians). */
  sway: number;
  /** Pitch bias added to the follow pitch (radians, + = looking up). */
  pitch: number;
  /** How much of the terrain/cable slope the view pitch follows (0..1). */
  slopeFollow: number;
  /** Cabin interior (draw a window frame overlay in the HUD). */
  interior: boolean;
  /** Rides on a cable strand: the sim position is on the line axis, the carrier hangs STRAND_OFFSET to the side, and the eye sits on `seatLateral` beyond that (see below). */
  strand?: boolean;
}

export const EYE: Record<RideKind, EyeSpec> = {
  ski: { up: 0.47, fwd: 0.06, bob: 0.008, bobHz: 7, sway: 0, pitch: 0, slopeFollow: 0.55, interior: false },
  board: { up: 0.45, fwd: 0.04, bob: 0.007, bobHz: 6, sway: 0, pitch: 0, slopeFollow: 0.55, interior: false },
  foot: { up: 0.47, fwd: 0.05, bob: 0.01, bobHz: 9, sway: 0, pitch: 0, slopeFollow: 0.3, interior: false },
  bike: { up: 0.5, fwd: 0.1, bob: 0.012, bobHz: 11, sway: 0, pitch: 0, slopeFollow: 0.6, interior: false },
  chair: { up: -0.19, fwd: 0.05, bob: 0, bobHz: 0, sway: 0.018, pitch: 0.06, slopeFollow: 0.35, interior: false, strand: true },
  gondola: { up: -0.6, fwd: 0, bob: 0, bobHz: 0, sway: 0.01, pitch: 0.04, slopeFollow: 0.3, interior: true, strand: true },
  cablecar: { up: -0.85, fwd: 0, bob: 0, bobHz: 0, sway: 0.008, pitch: 0.04, slopeFollow: 0.3, interior: true, strand: true },
  funicular: { up: 0.8, fwd: 0, bob: 0, bobHz: 0, sway: 0.004, pitch: 0.03, slopeFollow: 0.5, interior: true },
};

export const RIDE_FOV = 70;
export const FOV_MIN = 55;
export const FOV_MAX = 90;
export const RIDE_NEAR = 0.05;
export const LOOK_YAW_MAX = (100 * Math.PI) / 180;
export const LOOK_PITCH_MAX = (60 * Math.PI) / 180;
/** Seconds without input before the optional smooth return starts, and its time constant. */
export const LOOK_RETURN_DELAY_S = 1.2;
/** Far plane for a map size: fog hides the end, but never clip the slab. */
export const rideFar = (mapSize: number): number => Math.max(120, mapSize * 2.2);

export const clampLook = (yaw: number, pitch: number, out: { yaw: number; pitch: number }): { yaw: number; pitch: number } => {
  out.yaw = Math.min(LOOK_YAW_MAX, Math.max(-LOOK_YAW_MAX, yaw));
  out.pitch = Math.min(LOOK_PITCH_MAX, Math.max(-LOOK_PITCH_MAX, pitch));
  return out;
};

/** Camera yaw (rotation about +Y, camera looks down -Z) for a world heading direction (x, z). */
export const yawOfHeading = (hx: number, hz: number): number => Math.atan2(-hx, -hz);
export const wrapAngle = (a: number): number => { let r = a % (Math.PI * 2); if (r > Math.PI) r -= Math.PI * 2; else if (r < -Math.PI) r += Math.PI * 2; return r; };

/** Critically damped follower (Unity-style SmoothDamp): converges without overshoot, no allocation. */
export class Damped {
  vel = 0;
  constructor(public value = 0) {}
  step(target: number, smoothTime: number, dt: number): number {
    if (dt <= 0) return this.value;
    const omega = 2 / Math.max(1e-4, smoothTime), x = omega * dt;
    const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.value - target;
    const temp = (this.vel + omega * change) * dt;
    this.vel = (this.vel - omega * temp) * e;
    this.value = target + (change + temp) * e;
    return this.value;
  }
  /** Angle version: follows along the shortest arc. */
  stepAngle(target: number, smoothTime: number, dt: number): number {
    this.value = target - wrapAngle(target - this.value);
    this.step(target, smoothTime, dt);
    return this.value;
  }
  snap(v: number): void { this.value = v; this.vel = 0; }
}

/** One frame's worth of target state, read from the sim by RideAlong. World coordinates: x/z ground, y up. */
export interface RideSample {
  /** Guest origin (feet / seat), interpolated. */
  x: number; y: number; z: number;
  /** Unit heading on the ground plane (0,0 = unknown: keep the last heading). */
  hx: number; hz: number;
  /** Ground speed in tiles per second of real time (for bob amplitude). */
  speed: number;
  /** Climb angle of the motion (radians, + = going up). */
  slope: number;
  kind: RideKind;
  /** Seat seed (guest id; 0 = default): picks the seat deterministically, see `seatLateral`. */
  seat?: number;
  /** Seats per carrier of the lift being ridden (chairs: 2..8); default 4. */
  seats?: number;
}

export interface RigPose { x: number; y: number; z: number; yaw: number; pitch: number; roll: number }

const _look = { yaw: 0, pitch: 0 };

/** Smallest outward eye offset (keeps the head >= 0.14 from the sheave trains that sit ON the strand when a tower passes). */
export const MIN_SEAT_OUT = 0.13;
/** Cheap deterministic integer hash (guest id -> seat). */
const seatHash = (n: number): number => { let h = (Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; return (h ^ (h >>> 12)) >>> 0; };

/**
 * How far the rider's eye sits OUTWARD (towards the camera's right) of the carrier's cable strand. Towers stand on the line axis between the two strands
 * (mast on the axis, crossarm + sheave trains over the strands), so an eye ON the axis or on the strand passes through the mast / sheaves. Riders therefore sit
 * on the OUTER half of the bench: chairs: the guest's seat among the outer seats ((j + 0.5) x SEAT_PITCH, j picked from the guest id: a 4-seat chair gives 0.12 (floor MIN_SEAT_OUT)
 * or 0.255); gondola bench side 0.15, cable car 0.2. Always >= 0 (the inner half is where the mast passes). Pure and deterministic per guest.
 */
export function seatLateral(kind: RideKind, seed = 0, seats = 4): number {
  switch (kind) {
    case 'chair': { const outer = Math.max(1, Math.floor(Math.max(2, seats) / 2)); return Math.max(MIN_SEAT_OUT, ((seatHash(seed) % outer) + 0.5) * SEAT_PITCH); }
    case 'gondola': return 0.15;
    case 'cablecar': return 0.2;
    default: return 0;
  }
}
/** Total lateral eye offset from the line axis (to the camera's right for a rider moving along the heading): strand + seat. 0 off-strand. */
export const eyeLateral = (s: Pick<RideSample, 'kind' | 'seat' | 'seats'>): number => (EYE[s.kind].strand ? STRAND_OFFSET + seatLateral(s.kind, s.seat ?? 0, s.seats ?? 4) : 0);

/** Eye position for a sample (bob included) written to `out`. `t` = clock seconds, `motion` 0..1 (0 = reduced motion). `hx/hz` override the heading (stationary carriers keep the last). */
export function eyePosition(s: RideSample, t: number, motion: number, out: { x: number; y: number; z: number }, hx = s.hx, hz = s.hz): void {
  const e = EYE[s.kind];
  const amp = e.bob * motion * Math.min(1, s.speed / 3);
  const bob = amp * Math.sin(t * e.bobHz);
  const lat = eyeLateral(s);
  // right of the heading (hx, hz) is (-hz, hx): the up strand is on the rider's right, the seat is further out
  out.x = s.x + hx * e.fwd - hz * lat;
  out.y = s.y + e.up + bob;
  out.z = s.z + hz * e.fwd + hx * lat;
}

/** Target pitch that follows the slope of the motion (before smoothing). */
export const followPitch = (kind: RideKind, slope: number): number => {
  const e = EYE[kind];
  return Math.max(-0.7, Math.min(0.7, slope * e.slopeFollow + e.pitch));
};

/** Perspective camera + smoothed follow state. All per-frame work is allocation free. */
export class ViewCameraRig {
  readonly camera = new THREE.PerspectiveCamera(RIDE_FOV, 1, RIDE_NEAR, 300);
  readonly pose: RigPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  private px = new Damped(); private py = new Damped(); private pz = new Damped();
  private head = new Damped(); private slope = new Damped(); private bank = new Damped();
  private lastHx = 0; private lastHz = -1;
  private lastHead = 0;
  /** User drag-look offsets (clamped). */
  lookYaw = 0; lookPitch = 0;
  private lastLookInput = -1e9;
  /** Smoothly return the user look to the heading after `LOOK_RETURN_DELAY_S` without input. */
  smoothReturn = false;
  /** 0..1 scale of bob / sway / roll (reduced motion = 0). */
  motion = 1;
  fov = RIDE_FOV;
  private clock = 0;
  private started = false;
  private eye = { x: 0, y: 0, z: 0 };
  private fovTarget = RIDE_FOV;

  constructor() {
    this.camera.rotation.order = 'YXZ';
  }

  setMapSize(n: number): void { this.camera.far = rideFar(n); this.camera.updateProjectionMatrix(); }
  setAspect(a: number): void { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  /** Wheel: change the FOV slightly (clamped). */
  addFov(delta: number): void { this.fovTarget = Math.min(FOV_MAX, Math.max(FOV_MIN, this.fovTarget + delta)); }
  resetFov(): void { this.fovTarget = RIDE_FOV; }

  /** User look input (radians, added to the offsets and clamped). */
  look(dyaw: number, dpitch: number): void {
    clampLook(this.lookYaw + dyaw, this.lookPitch + dpitch, _look);
    this.lookYaw = _look.yaw; this.lookPitch = _look.pitch;
    this.lastLookInput = this.clock;
  }
  recentre(): void { this.lookYaw = 0; this.lookPitch = 0; }

  /** Photo mode: place the camera directly (no follow smoothing). Keeps `pose` / `fov` in sync so every ride-view consumer (horizon, fog, culling) sees it. */
  setFree(x: number, y: number, z: number, yaw: number, pitch: number, fov: number): RigPose {
    const p = this.pose;
    p.x = x; p.y = y; p.z = z; p.yaw = yaw; p.pitch = pitch; p.roll = 0;
    this.fov = fov; this.fovTarget = fov;
    if (Math.abs(this.camera.fov - fov) > 0.001) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.camera.position.set(x, y, z);
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld(true);
    return p;
  }

  /** Forget the smoothed state: the next update snaps to the sample (new target / teleports). */
  reset(): void { this.started = false; }

  update(dt: number, s: RideSample): RigPose {
    this.clock += dt;
    const e = EYE[s.kind];
    const hasHeading = s.hx * s.hx + s.hz * s.hz > 1e-6;
    if (hasHeading) { this.lastHx = s.hx; this.lastHz = s.hz; }
    eyePosition(s, this.clock, this.motion, this.eye, this.lastHx, this.lastHz);
    const targetHead = yawOfHeading(this.lastHx, this.lastHz);
    const targetSlope = followPitch(s.kind, s.slope);
    if (!this.started || Math.hypot(this.eye.x - this.px.value, this.eye.z - this.pz.value) > 6) {
      this.px.snap(this.eye.x); this.py.snap(this.eye.y); this.pz.snap(this.eye.z);
      this.head.snap(targetHead); this.slope.snap(targetSlope); this.bank.snap(0);
      this.lastHead = targetHead;
      this.started = true;
    } else {
      // position follows fast (the sim already interpolates), heading / pitch slower so turns glide
      this.px.step(this.eye.x, 0.07, dt); this.py.step(this.eye.y, 0.07, dt); this.pz.step(this.eye.z, 0.07, dt);
      this.head.stepAngle(targetHead, 0.28, dt);
      this.slope.step(targetSlope, 0.35, dt);
    }
    const turn = dt > 0 ? wrapAngle(this.head.value - this.lastHead) / dt : 0;
    this.lastHead = this.head.value;
    const bankT = this.motion * (e.sway > 0 ? e.sway * Math.sin(this.clock * 0.9) : Math.max(-0.1, Math.min(0.1, -turn * 0.06)));
    this.bank.step(bankT, 0.25, dt);
    if (this.smoothReturn && this.clock - this.lastLookInput > LOOK_RETURN_DELAY_S) {
      const k = 1 - Math.exp(-dt * 3);
      this.lookYaw -= this.lookYaw * k; this.lookPitch -= this.lookPitch * k;
    }
    this.fov += (this.fovTarget - this.fov) * (1 - Math.exp(-dt * 8));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
    const p = this.pose;
    p.x = this.px.value; p.y = this.py.value; p.z = this.pz.value;
    p.yaw = this.head.value + this.lookYaw;
    p.pitch = Math.max(-1.3, Math.min(1.3, this.slope.value + this.lookPitch));
    p.roll = this.bank.value;
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.rotation.set(p.pitch, p.yaw, p.roll, 'YXZ');
    this.camera.updateMatrixWorld(true);
    return p;
  }
}
