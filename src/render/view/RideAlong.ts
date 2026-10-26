import { GState, type GuestStore } from '../../sim/guests/Guest';
import { isSkiMode, NavMode } from '../../sim/guests/NavGraph';
import { Act } from '../../sim/guests/Decision';
import { LIFT_SECONDS_PER_TICK, TILE_METRES } from '../../config/balance';
import type { RideKind, RideSample } from './ViewCameraRig';

/**
 * Ride-along (M5.2): picks a guest, turns its sim state into a `RideSample` for the rig and notices when the guest is gone.
 * READ-ONLY on the sim: it only reads the guest store (typed arrays); nothing here mutates guests, so `stateHash` is identical with ride mode on or off.
 */

/**
 * Ride-along slow motion is TARGET-SPEED based (docs/time-flow.md): while riding along (and the setting is on) the game clock is slowed by the factor
 * `rideTimeFactor` so the followed guest's apparent speed stays <= RIDE_TARGET_TILES_PER_S (TickLoop.timeScale: REAL-TIME PACING only, the sim ticks
 * identically, `stateHash` is unaffected). With the 150 s day a blue-run skier is ~8 tiles/s at 1x, so the factor is 1.0 at 1x and < 1 only at 3x / 10x.
 */
export const RIDE_TARGET_TILES_PER_S = 9;
/** Never slower than this (a lift ride covers ~20 tiles per tick). */
export const RIDE_MIN_TIME_SCALE = 0.1;
/** Pure: time-scale factor (RIDE_MIN_TIME_SCALE..1) that keeps `tilesPerTick x ticksPerSecond` (the unscaled apparent speed) at or below `target` tiles/s. */
export function rideTimeFactor(tilesPerTick: number, ticksPerSecond: number, target: number = RIDE_TARGET_TILES_PER_S): number {
  const apparent = tilesPerTick * ticksPerSecond;
  if (!(apparent > target) || !(target > 0)) return 1;
  return Math.max(RIDE_MIN_TIME_SCALE, target / apparent);
}
/** Pure: ease the live factor towards the desired one (slow down quicker than speeding up; framerate independent). */
export function easeRideFactor(current: number, desired: number, dt: number): number {
  const rate = desired < current ? 6 : 1.5;
  return current + (desired - current) * (1 - Math.exp(-rate * Math.max(0, dt)));
}
/** km/h readout: tiles/tick x TILE_METRES / LIFT_SECONDS_PER_TICK x 3.6 gives ~38 km/h for the average skier already, so no extra factor. */
export const SPEED_DISPLAY_SCALE = 1;
export const MAX_DISPLAY_KMH = 95;

export interface RideDeps {
  store: GuestStore;
  /** Lift family for a lift id ('chair' | 'gondola' | 'cablecar' | 'funicular' | 'tbar'), undefined when unknown. */
  liftFamily(liftId: number): string | undefined;
  /** Height of the cable (or funicular track) above/at the guest's position on a lift line, or undefined when unknown: lets cable riders sit ON the carrier line instead of the straight station-to-station interpolation the sim uses. */
  cableY?(liftId: number, x: number, z: number): number | undefined;
  /** Seats per carrier of a lift (chairs), for the seat the rider sits in. */
  liftSeats?(liftId: number): number | undefined;
  /** Real ticks per second at the current game speed (0 when paused). */
  ticksPerSecond(): number;
  /** Called when the followed guest is gone / the ride ended by the guest side. */
  onGone?(reason: 'despawned' | 'none'): void;
}

export interface RideInfo { id: number; slot: number; kind: RideKind; kmh: number; altitude: number; state: number }

/** Pure: ride kind of a guest from its sim state. */
export function rideKindOf(state: number, moveMode: number, family: string | undefined): RideKind {
  if (state === GState.Riding) {
    switch (family) {
      case 'chair': return 'chair';
      case 'gondola': return 'gondola';
      case 'cablecar': return 'cablecar';
      case 'funicular': return 'funicular';
      case 'tbar': return 'ski';
      default: return 'chair';
    }
  }
  if (isSkiMode(moveMode)) return 'ski';
  if (moveMode === NavMode.Bike) return 'bike';
  return 'foot';
}

/** Pure: short HUD activity text. */
export function rideActivityLabel(kind: RideKind, state: number): string {
  switch (kind) {
    case 'ski': return 'Skiing';
    case 'board': return 'Snowboarding';
    case 'chair': return 'On a chairlift';
    case 'gondola': return 'In a gondola';
    case 'cablecar': return 'In a cable car';
    case 'funicular': return 'On the funicular';
    case 'bike': return 'Mountain biking';
    default:
      return state === GState.Queueing ? 'Queueing for a lift' : state === GState.Idle ? 'Taking a break' : state === GState.Using ? 'Using an attraction'
        : state === GState.Leaving ? 'Heading home' : state === GState.Injured ? 'Injured' : 'Walking';
  }
}

/** Pure: display speed in km/h from horizontal tiles per tick. */
export function displayKmh(tilesPerTick: number): number {
  const mps = (tilesPerTick * TILE_METRES) / LIFT_SECONDS_PER_TICK;
  return Math.min(MAX_DISPLAY_KMH, Math.round(mps * 3.6 * SPEED_DISPLAY_SCALE));
}

/** Preference order of the automatic pick: skiers/bikers on a run, then lift riders, then anyone awake. */
export function pickAutoSlot(s: GuestStore, from = 0, skip = -1): number {
  const n = s.limit;
  if (n === 0) return -1;
  const tiers: Array<(i: number) => boolean> = [
    (i) => s.state[i] === GState.Walking && s.act[i] === Act.SkiDown && isSkiMode(s.moveMode[i]!),
    (i) => s.state[i] === GState.Riding,
    (i) => s.state[i] === GState.Walking && s.moveMode[i] === NavMode.Bike,
    (i) => s.state[i] !== GState.Sleeping && s.state[i] !== GState.Using && s.state[i] !== GState.Injured,
    () => true,
  ];
  for (let t = 0; t < tiers.length; t++) {
    const ok = tiers[t]!;
    let best = -1, bestScore = 0;
    for (let k = 0; k < n; k++) {
      const i = (from + k) % n;
      if (i === skip || !s.alive[i] || !ok(i)) continue;
      if (t !== 0) return i; // lift riders / bikers / anyone: first match
      // skiers: prefer one that is actually moving, then the one highest up the mountain (a long run ahead, the best view)
      const score = s.z[i]! + (Math.hypot(s.x[i]! - s.px[i]!, s.y[i]! - s.py[i]!) > 0.5 ? 100 : 0);
      if (best < 0 || score > bestScore + 0.5) { best = i; bestScore = score; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

export class RideAlong {
  /** Followed guest id (0 = none). Ids are never reused, so a stale id can never point at another guest. */
  targetId = 0;
  private lastSlot = -1;
  private _kind: RideKind = 'foot';
  private _kmh = 0;
  private _tpt = 0;
  private _alt = 0;
  private _state = 0;
  private _gone = false;

  constructor(private d: RideDeps) {}

  get active(): boolean { return this.targetId !== 0; }
  /** Lift family of a lift id (delegates to the host). */
  familyOf(liftId: number): string | undefined { return this.d.liftFamily(liftId); }

  /** Start following a guest by id. False when the guest does not exist. */
  follow(id: number): boolean {
    const slot = this.d.store.slotOf(id);
    if (slot < 0 || !this.d.store.alive[slot]) return false;
    this.targetId = id; this.lastSlot = slot; this._gone = false;
    return true;
  }

  /** Follow a guest picked automatically (see `pickAutoSlot`). Returns the guest id or 0. */
  followAuto(): number {
    const s = this.d.store, slot = pickAutoSlot(s, 0);
    if (slot < 0) return 0;
    this.follow(s.id[slot]!);
    return this.targetId;
  }

  /** Next guest after the current one (wraps); keeps the current one when nobody else exists. */
  next(): number {
    const s = this.d.store, cur = this.targetId ? s.slotOf(this.targetId) : -1;
    const slot = pickAutoSlot(s, (cur < 0 ? 0 : cur + 1) % Math.max(1, s.limit), cur);
    if (slot < 0) return this.targetId;
    this.follow(s.id[slot]!);
    return this.targetId;
  }

  stop(): void { this._tpt = 0; this.targetId = 0; this.lastSlot = -1; this._gone = false; }

  /** Slot of the followed guest or -1 (also -1 once the guest left; call `check` to react). */
  get slot(): number {
    if (!this.targetId) return -1;
    const s = this.d.store, i = s.slotOf(this.targetId);
    return i >= 0 && s.alive[i] && s.id[i] === this.targetId ? i : -1;
  }

  /** Per frame: detects a despawned guest. Returns true while the ride goes on. */
  check(): boolean {
    if (!this.targetId) return false;
    if (this.slot < 0) { this.targetId = 0; this._gone = true; this.d.onGone?.('despawned'); return false; }
    return true;
  }
  /** True once after the guest disappeared (for tests / HUD). */
  get wasGone(): boolean { return this._gone; }

  /** Fill `out` from the guest's interpolated state. False when there is no (live) target. READ-ONLY. */
  sample(alpha: number, out: RideSample): boolean {
    const i = this.slot;
    if (i < 0) return false;
    const s = this.d.store;
    const dx = s.x[i]! - s.px[i]!, dy = s.y[i]! - s.py[i]!, dz = s.z[i]! - s.pz[i]!;
    out.x = s.px[i]! + dx * alpha; out.z = s.py[i]! + dy * alpha; out.y = s.pz[i]! + dz * alpha;
    const h = Math.hypot(dx, dy);
    if (h > 1e-5) { out.hx = dx / h; out.hz = dy / h; } else { out.hx = 0; out.hz = 0; }
    const tps = this.d.ticksPerSecond();
    out.speed = h * tps;
    out.slope = h > 1e-5 ? Math.atan2(dz, h) : 0;
    const st = s.state[i]!;
    const fam = st === GState.Riding ? this.d.liftFamily(s.liftId[i]!) : undefined;
    out.kind = rideKindOf(st, s.moveMode[i]!, fam);
    if (st === GState.Riding && out.kind !== 'ski' && this.d.cableY) { const cy = this.d.cableY(s.liftId[i]!, out.x, out.z); if (cy !== undefined) out.y = cy; }
    out.seat = s.id[i]!; out.seats = st === GState.Riding ? this.d.liftSeats?.(s.liftId[i]!) : undefined;
    this._kind = out.kind; this._state = st;
    this._tpt = Math.max(h, this._tpt * 0.985); // peak-hold of the tiles-per-tick displacement (decays over ~1 s)
    this._kmh += (displayKmh(h) - this._kmh) * 0.08; // tick-to-tick displacement is spiky: smooth the readout
    this._alt = out.y;
    this.lastSlot = i;
    return true;
  }

  /** Peak-held tiles per tick of the followed guest (drives the ride slow-mo factor). */
  get tilesPerTick(): number { return this._tpt; }

  info(): RideInfo { return { id: this.targetId, slot: this.lastSlot, kind: this._kind, kmh: Math.round(this._kmh), altitude: this._alt, state: this._state }; }
}
