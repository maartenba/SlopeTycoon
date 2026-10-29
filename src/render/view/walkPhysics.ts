import { FIGURE_HEIGHT, wrapAngle } from './ViewCameraRig';

/**
 * Walk mode physics (M5.2 / Task 12). PURE: plain numbers, no three / DOM / sim writes, allocation-free when `out` is given.
 * World units: x / z = ground plane in tile units (1 tile = 10 m), y = up. Yaw convention = ViewCameraRig (camera looks down -Z at yaw 0:
 * forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)).
 *
 * Scale note (same as ride-along, see ViewCameraRig): figures are 0.52 units tall (FIGURE_HEIGHT) while a tile is 1 unit (10 m), so a literal
 * 1.4 m/s (0.14 tiles/s) would be a crawl. The walker moves at GAME scale: 1.6 tiles/s walking, 3.2 tiles/s running (~3 / 6 figure heights a second).
 */
export const WALK = {
  /** Eye height above the ground: 0.9 x the figure height (= ride-along 'foot' eye 0.47). */
  eyeHeight: 0.9 * FIGURE_HEIGHT,
  /** Collision circle radius (tiles). Larger than the near plane (0.05) and ~2.5x a trunk radius, so a trunk never fills more than ~30 degrees of the view. */
  radius: 0.26,
  walkSpeed: 1.6,
  runSpeed: 3.2,
  /** Velocity change per second while input is held / released (tiles/s^2): reaches walk speed in ~0.11 s, run in ~0.23 s. */
  accel: 14,
  decel: 18,
  /** Fraction of ground control while in the air. */
  airControl: 0.35,
  /** Steepest climbable gradient: tan(40 deg). Above it the walker cannot go uphill and slowly slides down. */
  slopeLimitDeg: 40,
  /** A rise over this much horizontal run is judged against the slope limit: step-up height = tan(limit) x this = ~0.17 units (a curb / ledge; 0.5+ is a wall). */
  slopeProbe: 0.2,
  /** Downhill drift speed (tiles/s) on slopes steeper than the limit. */
  slideSpeed: 1.4,
  gravity: 9,
  /** Hop height (units): small, Space. */
  jumpHeight: 0.18,
  /** Longest distance covered in one physics substep (tiles): < radius, so nothing can be tunnelled. */
  maxStepDist: 0.12,
  /** Head-bob amplitude (units, one dip per step at walking pace; 0 with reduced motion / bob off). */
  bobAmp: 0.012,
  /** Keep this far inside the map edge. */
  boundsMargin: 0.6,
} as const;

export const slopeLimitTan = (): number => Math.tan((WALK.slopeLimitDeg * Math.PI) / 180);
/** Largest ledge (units) that is stepped up in one move: tan(limit) x probe. */
export const stepUpHeight = (): number => slopeLimitTan() * WALK.slopeProbe;

export interface WalkerState {
  x: number; z: number;
  vx: number; vz: number;
  /** Height of the hop above the ground (0 = on the ground) and its vertical velocity. */
  hop: number; hopV: number;
  yaw: number; pitch: number;
  /** Ground surface height at (x, z). */
  ground: number;
  /** Horizontal speed (tiles/s) after the last step. */
  speed: number;
  grounded: boolean;
  /** True while drifting down a slope steeper than the limit. */
  sliding: boolean;
  /** Distance walked since the start (tiles): footstep cadence. */
  stepPhase: number;
}

export interface WalkInput {
  /** -1..1 (+ = forward). */
  fwd: number;
  /** -1..1 (+ = right). */
  strafe: number;
  run: boolean;
  jump: boolean;
}

export interface WalkWorld {
  /** Map size in tiles. */
  size: number;
  /** Terrain surface height (same per-tile diagonal triangulation as the terrain mesh / roads: `surfaceHeightAt`). */
  ground(x: number, z: number): number;
  /** Tile that cannot be entered (building, lift station / tower, water without a bridge). Out-of-map tiles must be solid. */
  solid(tx: number, ty: number): boolean;
  /** Flat [cx, cz, r, ...] circles of the trunks / rocks standing on a tile, or null. Must return a stable array (no per-call allocation). */
  circles(tx: number, ty: number): ArrayLike<number> | null;
  /** True where (x, z) is on a bridge deck or on the half of a bank tile that ramps up to it: that surface is stairs / a ramp, never judged against the slope limit (Task 46: a suspension deck can sit up to 3 half-steps above the bank, a 1.0 gradient ramp was a wall). */
  onDeck?(x: number, z: number): boolean;
}

export const NO_INPUT: WalkInput = { fwd: 0, strafe: 0, run: false, jump: false };

export function makeWalker(x: number, z: number, yaw = 0, ground = 0): WalkerState {
  return { x, z, vx: 0, vz: 0, hop: 0, hopV: 0, yaw, pitch: 0, ground, speed: 0, grounded: true, sliding: false, stepPhase: 0 };
}
export const cloneWalker = (s: WalkerState): WalkerState => ({ ...s });
/** Eye height in world y (hop included, no head bob). */
export const eyeY = (s: WalkerState): number => s.ground + s.hop + WALK.eyeHeight;

/** Ground gradient magnitude (rise per tile) at (x, z) by central differences, written to `out` as [gx, gz]. */
export function gradientAt(world: WalkWorld, x: number, z: number, out: { x: number; z: number }): number {
  const e = 0.12;
  out.x = (world.ground(x + e, z) - world.ground(x - e, z)) / (2 * e);
  out.z = (world.ground(x, z + e) - world.ground(x, z - e)) / (2 * e);
  return Math.hypot(out.x, out.z);
}

const _g = { x: 0, z: 0 };

/** Push the circle (x, z, r) out of solid tiles / trunk circles; returns the (mutated) point via `p` and the contact normal sum in `n` (for velocity slide). */
function resolve(world: WalkWorld, p: { x: number; z: number; vx: number; vz: number }, r: number): void {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    const x0 = Math.floor(p.x - r - 1), x1 = Math.floor(p.x + r + 1), z0 = Math.floor(p.z - r - 1), z1 = Math.floor(p.z + r + 1);
    for (let ty = z0; ty <= z1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (world.solid(tx, ty)) {
        const cx = Math.min(tx + 1, Math.max(tx, p.x)), cz = Math.min(ty + 1, Math.max(ty, p.z));
        const dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          let nx: number, nz: number, push: number;
          if (d2 > 1e-10) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; push = r - d; } else { // centre inside the tile: leave through the nearest face
            const l = p.x - tx, rr = tx + 1 - p.x, t = p.z - ty, b = ty + 1 - p.z, m = Math.min(l, rr, t, b);
            if (m === l) { nx = -1; nz = 0; } else if (m === rr) { nx = 1; nz = 0; } else if (m === t) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
            push = m + r;
          }
          p.x += nx * push; p.z += nz * push;
          const vn = p.vx * nx + p.vz * nz;
          if (vn < 0) { p.vx -= vn * nx; p.vz -= vn * nz; }
          moved = true;
        }
      }
      const c = world.circles(tx, ty);
      if (c) for (let i = 0; i + 2 < c.length; i += 3) {
        const dx = p.x - c[i]!, dz = p.z - c[i + 1]!, rr = r + c[i + 2]!, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2), nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
          p.x += nx * (rr - d); p.z += nz * (rr - d);
          const vn = p.vx * nx + p.vz * nz;
          if (vn < 0) { p.vx -= vn * nx; p.vz -= vn * nz; }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

const _p = { x: 0, z: 0, vx: 0, vz: 0 };

/** Resolve the walker circle at (x, z) against the world (solid tiles, circles, map edge): the nearest legal standing point. Allocates one small object (spawn / drop only). */
export function settle(world: WalkWorld, x: number, z: number): { x: number; z: number; moved: number } {
  const p = { x, z, vx: 0, vz: 0 }, lo = WALK.boundsMargin, hi = world.size - WALK.boundsMargin;
  for (let i = 0; i < 4; i++) {
    resolve(world, p, WALK.radius);
    p.x = Math.min(hi, Math.max(lo, p.x)); p.z = Math.min(hi, Math.max(lo, p.z));
  }
  return { x: p.x, z: p.z, moved: Math.hypot(p.x - x, p.z - z) };
}
/** True when the walker can stand at (x, z) without being pushed (not inside / touching a solid tile, trunk or decor circle, inside the map margin). */
export const standable = (world: WalkWorld, x: number, z: number): boolean => settle(world, x, z).moved < 1e-4;

/** Slope gate: the ground one fixed probe length ahead along the move must not rise more than tan(limit) x probe (so tiny substeps cannot creep up a wall). */
function climbable(world: WalkWorld, x: number, z: number, g0: number, mx: number, mz: number, tanL: number): boolean {
  const d = Math.hypot(mx, mz);
  if (d < 1e-9) return true;
  if (world.onDeck && world.onDeck(x, z) && world.onDeck(x + (mx / d) * WALK.slopeProbe, z + (mz / d) * WALK.slopeProbe)) return true;
  return world.ground(x + (mx / d) * WALK.slopeProbe, z + (mz / d) * WALK.slopeProbe) - g0 <= tanL * WALK.slopeProbe + 1e-9;
}

/**
 * Advance the walker by `dt` seconds. Substepped so that no single move exceeds WALK.maxStepDist (no tunnelling at low frame rates).
 * Writes into `out` (default: a fresh copy of `s`; pass `s` itself for the allocation-free in-place update). Deterministic: same inputs, same result.
 * yaw / pitch are NOT touched here (look input is applied by the caller).
 */
export function stepWalker(s: WalkerState, input: WalkInput, dt: number, world: WalkWorld, out: WalkerState = { ...s }): WalkerState {
  if (out !== s) Object.assign(out, s);
  if (!(dt > 0)) return out;
  dt = Math.min(dt, 0.25);
  const maxV = Math.max(WALK.runSpeed, WALK.slideSpeed) + 1;
  const n = Math.min(24, Math.max(1, Math.ceil((maxV * dt) / WALK.maxStepDist)));
  const h = dt / n, r = WALK.radius, tanL = slopeLimitTan();
  const lo = WALK.boundsMargin, hi = world.size - WALK.boundsMargin;
  const sy = Math.sin(out.yaw), cy = Math.cos(out.yaw);
  let wx = -sy * input.fwd + cy * input.strafe, wz = -cy * input.fwd - sy * input.strafe;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) { wx /= wl; wz /= wl; }
  const top = input.run ? WALK.runSpeed : WALK.walkSpeed;
  const hasWish = wl > 1e-4;
  const tx = wx * top, tz = wz * top;
  let moved = 0;
  for (let k = 0; k < n; k++) {
    // jump
    if (input.jump && out.hop === 0 && out.hopV === 0 && !out.sliding) out.hopV = Math.sqrt(2 * WALK.gravity * WALK.jumpHeight);
    if (out.hop > 0 || out.hopV > 0) {
      out.hopV -= WALK.gravity * h; out.hop += out.hopV * h;
      if (out.hop <= 0) { out.hop = 0; out.hopV = 0; }
    }
    out.grounded = out.hop === 0;
    // accelerate towards the wish velocity
    const ctl = out.grounded ? 1 : WALK.airControl;
    const dvx = tx - out.vx, dvz = tz - out.vz, dl = Math.hypot(dvx, dvz);
    const maxd = (hasWish ? WALK.accel : WALK.decel) * h * ctl;
    if (dl <= maxd) { out.vx = tx; out.vz = tz; } else { out.vx += (dvx / dl) * maxd; out.vz += (dvz / dl) * maxd; }
    // slide on too-steep ground
    let sx = 0, sz = 0;
    const g = out.grounded ? gradientAt(world, out.x, out.z, _g) : 0;
    out.sliding = out.grounded && g > tanL && !(world.onDeck && world.onDeck(out.x, out.z)); // a deck ramp is stairs: no sliding
    if (out.sliding) { sx = (-_g.x / g) * WALK.slideSpeed * h; sz = (-_g.z / g) * WALK.slideSpeed * h; }
    let dx = out.vx * h + sx, dz = out.vz * h + sz;
    // slope gate on the intended move (uphill only; downhill is always allowed): try the full move, then each axis (slide along the slope contour)
    if (out.grounded && (dx !== 0 || dz !== 0)) {
      const g0 = world.ground(out.x, out.z), x0 = out.x, z0 = out.z;
      if (!climbable(world, x0, z0, g0, dx, dz, tanL)) {
        if (climbable(world, x0, z0, g0, dx, 0, tanL)) { dz = 0; out.vz = 0; } else if (climbable(world, x0, z0, g0, 0, dz, tanL)) { dx = 0; out.vx = 0; } else { dx = 0; dz = 0; out.vx = 0; out.vz = 0; }
      }
    }
    const ox = out.x, oz = out.z;
    _p.x = out.x + dx; _p.z = out.z + dz; _p.vx = out.vx; _p.vz = out.vz;
    resolve(world, _p, r);
    _p.x = Math.min(hi, Math.max(lo, _p.x)); _p.z = Math.min(hi, Math.max(lo, _p.z));
    out.x = _p.x; out.z = _p.z; out.vx = _p.vx; out.vz = _p.vz;
    // push-outs (spawning inside a wall, a decor circle growing under you) are NOT walked distance: capped by the intended move, so no speed spike / stray footstep
    moved += Math.min(Math.hypot(out.x - ox, out.z - oz), Math.hypot(dx, dz) + 1e-9);
  }
  out.ground = world.ground(out.x, out.z);
  out.speed = moved / dt;
  if (out.grounded) out.stepPhase += moved;
  return out;
}

/** Wrap + clamp the look angles: yaw wrapped to ±π, pitch clamped to ±80°. */
export const WALK_PITCH_MAX = (80 * Math.PI) / 180;
export function applyLook(s: WalkerState, dyaw: number, dpitch: number, invertY = false): void {
  s.yaw = wrapAngle(s.yaw + dyaw);
  s.pitch = Math.min(WALK_PITCH_MAX, Math.max(-WALK_PITCH_MAX, s.pitch + (invertY ? -dpitch : dpitch)));
}

/** Pure: footstep stride (tiles per step) for a ground speed: ~0.9 walking (1.8 steps/s), ~1.35 running (2.4 steps/s). */
export const stepStride = (speed: number): number => 0.45 + 0.28 * Math.min(WALK.runSpeed, Math.max(WALK.walkSpeed, speed));
/** Pure: steps per second at a speed. */
export const stepRate = (speed: number): number => (speed > 0.2 ? speed / stepStride(speed) : 0);
/** Pure: did the walked distance cross a footstep boundary between `prev` and `next` (stride from the current speed)? */
export const footstepDue = (prev: number, next: number, stride: number): boolean => Math.floor(next / stride) > Math.floor(prev / stride);
