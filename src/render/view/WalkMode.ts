import { LIFTS } from '../../config/lifts';
import { LIFT_STATION_SIZE } from '../../config/balance';
import { OccFlag } from '../../world/Occupancy';
import { TileType, type Grid } from '../../world/Grid';
import { PropKind, growthFactor, type PropStore } from '../../world/Props';
import type { Networks } from '../../world/Networks';
import type { LiftData, CablePath } from '../../sim/Lift';
import { samplePath } from '../../sim/Lift';
import { Damped, yawOfHeading, type RideSample, type ViewCameraRig } from './ViewCameraRig';
import {
  NO_INPUT, WALK, applyLook, eyeY, makeWalker, settle, stepStride, stepWalker, footstepDue,
  type WalkInput, type WalkWorld, type WalkerState,
} from './walkPhysics';
import {
  boardVerdict, cosmeticRideSeconds, footSurface, nearestBoardable, nearestFree, pickInteract, promptFor,
  type BoardableLift, type FootSurface, type InteractBox,
} from './walkInteract';
import { DEFAULT_WALK_SETTINGS, type WalkSettings } from './WalkInput';
import { spawnPoint } from './walkStart';
import type { DecorItem } from '../VillageDecor';

/**
 * Walk mode runtime (Task 12): owns the walker state, the world adapter, the first-person camera pose, interactions and the cosmetic lift ride.
 * It only READS the sim (grid, networks, props, buildings, lifts, guests, animals): nothing here writes sim state or consumes sim RNG, so `stateHash`
 * is identical with walk mode on or off. Not saved. The walker is not a sim guest (no queue slot, no ticket, no occupancy).
 */

export function bearingOf(yaw: number): number { const b = (-yaw * 180) / Math.PI; return ((b % 360) + 360) % 360; }
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Pure: compass point of a yaw (0 = north = -z, clockwise). */
export const compassPoint = (yaw: number): string => POINTS[Math.round(bearingOf(yaw) / 45) % 8]!;

/** Collision radii (tiles) of the props, matched to the visible trunks (Trees.ts trunk radius 0.05-0.1 x scale; shrubs / rocks a little wider). */
export const PROP_RADIUS: Record<number, number> = {
  [PropKind.Conifer]: 0.1, [PropKind.Deciduous]: 0.1, [PropKind.Pine]: 0.09, [PropKind.Larch]: 0.08, [PropKind.Birch]: 0.08, [PropKind.Oak]: 0.12, [PropKind.Shrub]: 0.1, [PropKind.Snag]: 0.08, [PropKind.Rock]: 0.27,
};

/** Pure: collision circles [x, z, r] of the village decor (lamp posts, benches, planters, hedge shrubs). Parking lines / path stones / lot are flat and walkable. */
export function decorCircles(items: readonly DecorItem[]): number[][] {
  const out: number[][] = [];
  for (const it of items) {
    switch (it.kind) {
      case 'lamp': out.push([it.x, it.z, 0.08]); break;
      case 'bench': { const ax = Math.sin(it.ry), az = Math.cos(it.ry); for (const k of [-0.2, 0, 0.2]) out.push([it.x + ax * k, it.z + az * k, 0.11]); break; }
      case 'planter': for (const k of [-0.18, 0, 0.18]) out.push([it.x + k, it.z, 0.13]); break;
      case 'shrub': out.push([it.x, it.z, (0.2 + ((it.ry * 37) % 5) * 0.03) * 0.85]); break;
      case 'fountain': for (const k of [-0.25, 0, 0.25]) out.push([it.x + k, it.z, 0.3]); break;
      case 'tree': out.push([it.x, it.z, 0.1]); break;
      case 'awning': for (const k of [-0.25, 0, 0.25]) out.push([it.x + Math.cos(it.ry) * k, it.z - Math.sin(it.ry) * k, 0.14]); break;
      default: break; // cobble / bed / fence are low and walkable (picket fences are not collision)
    }
  }
  return out;
}

/** The terrain-backed WalkWorld: tile solidity from Occupancy + water (bridges walkable) and a per-tile index of trunk / rock circles. */
export class TerrainWalkWorld implements WalkWorld {
  readonly size: number;
  private tiles = new Map<number, number[]>();
  private version = -1;
  private decorRef: readonly DecorItem[] | null = null;
  constructor(private grid: Grid, private nets: Pick<Networks, 'kind' | 'bridge'> | null, private props: PropStore | null, readonly ground: (x: number, z: number) => number, private decor: (() => readonly DecorItem[]) | null = null) { this.size = grid.size; }

  solid(tx: number, ty: number): boolean {
    const g = this.grid;
    if (tx < 0 || ty < 0 || tx >= g.size || ty >= g.size) return true;
    const i = ty * g.size + tx, f = g.occupancy.flags[i]!;
    if (f & (OccFlag.Building | OccFlag.Lift)) return true;
    const t = g.tileType[i]!;
    if ((t === TileType.Water || t === TileType.Stream || (f & OccFlag.Water)) && !(this.nets?.bridge[i])) return true;
    return false;
  }
  circles(tx: number, ty: number): ArrayLike<number> | null { return this.tiles.get(ty * this.size + tx) ?? null; }

  /** Rebuild the circle index when the prop chunks changed (cheap check, call every frame). */
  refresh(): void {
    const p = this.props, dec = this.decor?.() ?? null;
    let v = 0;
    if (p) {
      for (let i = 0; i < p.chunkVersion.length; i++) v = (v * 31 + p.chunkVersion[i]!) >>> 0;
      v = (v ^ Math.floor(p.now / 5)) >>> 0; // growth: radii barely change, refresh every few days
    }
    if (v === this.version && dec === this.decorRef) return;
    this.version = v; this.decorRef = dec;
    this.tiles.clear();
    if (dec) for (const [x, z, r] of decorCircles(dec)) {
      const key = Math.floor(z!) * this.size + Math.floor(x!);
      let a = this.tiles.get(key);
      if (!a) { a = []; this.tiles.set(key, a); }
      a.push(x!, z!, r!);
    }
    if (p) for (const c of p.chunks) for (let i = 0; i < c.kind.length; i++) {
      const r = (PROP_RADIUS[c.kind[i]!] ?? 0.1) * Math.max(0.5, c.scale[i]! * growthFactor(c.born[i]!, p.now));
      const key = c.ty[i]! * this.size + c.tx[i]!;
      let a = this.tiles.get(key);
      if (!a) { a = []; this.tiles.set(key, a); }
      a.push(c.tx[i]! + c.ox[i]!, c.ty[i]! + c.oy[i]!, r);
    }
  }
}

/** The ONE place collision data is assembled: Occupancy (buildings / lifts), water + bridges, prop trunks / rocks and village decor (lamps, benches, planters, hedges). */
export function buildWalkWorld(grid: Grid, nets: Pick<Networks, 'kind' | 'bridge'> | null, props: PropStore | null, ground: (x: number, z: number) => number, decor: (() => readonly DecorItem[]) | null = null): TerrainWalkWorld {
  const w = new TerrainWalkWorld(grid, nets, props, ground, decor);
  w.refresh();
  return w;
}

export interface WalkTarget { id: number; x: number; y: number; w: number; h: number; label: string }
export interface WalkPerson { id: number; x: number; z: number; label: string; kind: 'guest' | 'animal' }

export interface WalkDeps {
  world: TerrainWalkWorld;
  rig: ViewCameraRig;
  grid: Grid;
  nets: Pick<Networks, 'kind' | 'bridge'> | null;
  buildings(): WalkTarget[];
  lifts(): Array<LiftData & { name: string; rideTimeS: number; reason?: string | null; path: CablePath; family: string }>;
  /** Guests and animals within `r` tiles of (x, z), interpolated positions. Called at ~5 Hz and on E. */
  nearbyPeople(x: number, z: number, r: number): WalkPerson[];
  /** Compact info card for a target (building / lift / guest / animal). */
  info(kind: string, id: number): { title: string; lines: string[] } | null;
  /** 'Near Lodge 1' (Names.describeLocation). */
  describe(x: number, z: number): string;
  /** Footstep sound (audio layer: surface, ground speed, 0..1 run factor). */
  footstep?(s: FootSurface, speed: number): void;
  /** Reduced motion: 0..1 scale of bob / FOV kick. */
  motion(): number;
  toast?(msg: string): void;
}

/** Personal space (tiles) around a guest / animal: the walker is nudged out of it. */
export const PERSONAL_SPACE = 0.4;
/** Pure: push the walker away from every person closer than `minDist` by at most `maxMove` tiles in total (soft: never faster than walking). Returns the distance moved. */
export function softPush(s: { x: number; z: number }, people: ReadonlyArray<{ x: number; z: number }>, minDist: number, maxMove: number): number {
  let px = 0, pz = 0;
  for (const p of people) {
    const dx = s.x - p.x, dz = s.z - p.z, d = Math.hypot(dx, dz);
    if (d >= minDist) continue;
    const k = (minDist - d) * 0.5, nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
    px += nx * k; pz += nz * k;
  }
  const l = Math.hypot(px, pz);
  if (l < 1e-9) return 0;
  const m = Math.min(l, maxMove);
  s.x += (px / l) * m; s.z += (pz / l) * m;
  return m;
}

export interface WalkCard { title: string; lines: string[]; until: number }

const FOV_KICK = 4;
const _in: WalkInput = { fwd: 0, strafe: 0, run: false, jump: false };

export class WalkMode {
  state: WalkerState = makeWalker(0, 0);
  settings: WalkSettings = { ...DEFAULT_WALK_SETTINGS };
  active = false;
  /** Context prompt ('E: Board Chairlift 1'), '' when none. */
  prompt = '';
  location = '';
  card: WalkCard | null = null;
  /** Lift ride progress 0..1 (-1 = walking). */
  rideProgress = -1;
  /** Point the terrain near-chunk window should follow (ahead of the walker along the motion). */
  readonly focus = { x: 0, z: 0 };
  readonly footsteps = { count: 0, last: 'grass' as FootSurface };
  private clock = 0;
  private nextProbe = 0;
  private eyeD = new Damped();
  private fov = 75;
  private ride: { liftId: number; t: number; dur: number; path: CablePath; family: string; top: LiftData['top']; name: string; seats: number } | null = null;
  private rideSample: RideSample = { x: 0, y: 0, z: 0, hx: 0, hz: 0, speed: 0, slope: 0, kind: 'chair' };
  private lastStep = 0;
  /** True when the 5 Hz probe saw a guest / animal within ~2.5 tiles (then the per-frame soft push queries the crowd). */
  private nearPeople = false;
  private boardable: ReturnType<typeof nearestBoardable<BoardableLift & LiftData>> = null;
  private hit: ReturnType<typeof pickInteract> = null;
  /** Input source (the DOM handler's `input()` or a scripted one in the headless harness). */
  inputFn: (() => WalkInput) | null = null;

  constructor(private d: WalkDeps) {}

  get riding(): boolean { return this.ride !== null; }

  /** Start walking at tile-space (x, z) (moved to the nearest free spot when blocked), facing `yaw`. Returns false when there is nowhere to stand. */
  begin(x: number, z: number, yaw: number): boolean {
    const w = this.d.world;
    w.refresh();
    const p = spawnPoint(w, x, z);
    if (!p) return false;
    this.state = makeWalker(p.x, p.z, yaw, w.ground(p.x, p.z)); // velocity 0, step phase 0: no speed spike / stray footstep after a spawn or teleport
    this.active = true; this.ride = null; this.rideProgress = -1; this.card = null; this.prompt = ''; this.clock = 0; this.nextProbe = 0;
    this.lastStep = 0; this.nearPeople = false;
    this.fov = this.settings.fov;
    this.eyeD.snap(eyeY(this.state));
    this.focus.x = p.x; this.focus.z = p.z;
    this.d.rig.reset();
    this.applyCamera(0, true);
    return true;
  }
  end(): void { this.active = false; this.ride = null; this.rideProgress = -1; this.card = null; this.prompt = ''; }

  look(dyaw: number, dpitch: number): void {
    if (this.ride) { this.d.rig.look(dyaw, dpitch); return; }
    applyLook(this.state, dyaw, dpitch, this.settings.invertY);
  }

  /** Per frame. `dt` real seconds. Allocation free while walking (the 5 Hz probe allocates small arrays). */
  update(dt: number): void {
    if (!this.active) return;
    this.clock += dt;
    if (this.ride) { this.updateRide(dt); return; }
    const w = this.d.world;
    w.refresh();
    const src = this.inputFn ? this.inputFn() : NO_INPUT;
    _in.fwd = src.fwd; _in.strafe = src.strafe; _in.run = src.run; _in.jump = src.jump;
    const s = this.state, prevPhase = s.stepPhase;
    stepWalker(s, _in, dt, w, s);
    if (this.nearPeople) this.pushAway(dt);
    // footsteps: one per stride walked, by surface
    const stride = stepStride(s.speed);
    if (s.grounded && s.speed > 0.3 && footstepDue(prevPhase, s.stepPhase, stride)) this.doFootstep();
    // terrain prefetch focus: ahead along the motion (up to ~2 tiles)
    const ahead = Math.min(2, s.speed * 0.6), sp = Math.max(1e-3, s.speed);
    this.focus.x = s.x + (s.vx / sp) * ahead; this.focus.z = s.z + (s.vz / sp) * ahead;
    if (this.clock >= this.nextProbe) { this.nextProbe = this.clock + 0.2; this.probe(); }
    if (this.card && this.clock > this.card.until) this.card = null;
    this.applyCamera(dt, false);
  }

  /** Soft separation from guests / animals: nudges the walker out of their personal space (<= walk speed x dt, no velocity / step phase change). */
  private pushAway(dt: number): void {
    const s = this.state, ppl = this.d.nearbyPeople(s.x, s.z, PERSONAL_SPACE + 0.1);
    if (!ppl.length) return;
    const moved = softPush(s, ppl, PERSONAL_SPACE, WALK.walkSpeed * dt);
    if (moved > 0) { const q = settle(this.d.world, s.x, s.z); s.x = q.x; s.z = q.z; s.ground = this.d.world.ground(s.x, s.z); }
  }

  private doFootstep(): void {
    const g = this.d.grid, s = this.state, tx = Math.floor(s.x), ty = Math.floor(s.z), i = ty * g.size + tx;
    if (tx < 0 || ty < 0 || tx >= g.size || ty >= g.size) return;
    const surf = footSurface({ tileType: g.tileType[i]!, snowDepth: g.snowDepth[i]!, occFlags: g.occupancy.flags[i]!, netKind: this.d.nets?.kind[i] ?? 0, bridge: !!this.d.nets?.bridge[i] });
    this.footsteps.count++; this.footsteps.last = surf;
    this.d.footstep?.(surf, s.speed);
  }

  private applyCamera(dt: number, snap: boolean): void {
    const s = this.state, rig = this.d.rig, motion = this.d.motion();
    const bobOn = this.settings.headBob && motion > 0;
    const stride = stepStride(Math.max(WALK.walkSpeed, s.speed));
    const bob = bobOn && s.grounded ? WALK.bobAmp * Math.sin((s.stepPhase / stride) * Math.PI) * Math.min(1, s.speed / WALK.walkSpeed) : 0; // one dip per step
    const targetY = s.ground + s.hop + WALK.eyeHeight + bob;
    // smooth the vertical eye so slope changes / collisions never jerk the view (fast: ~40 ms)
    if (snap) this.eyeD.snap(targetY);
    const y = snap ? targetY : this.eyeD.step(targetY, 0.04, dt);
    const kick = bobOn && s.speed > WALK.walkSpeed * 1.25 ? FOV_KICK : 0;
    this.fov += (this.settings.fov + kick - this.fov) * (snap ? 1 : 1 - Math.exp(-dt * 6));
    rig.setFree(s.x, Math.max(y, s.ground + 0.1), s.z, s.yaw, s.pitch, this.fov);
  }

  // ---- interaction ----
  private probe(): void {
    const s = this.state, d = this.d;
    this.location = d.describe(s.x, s.z);
    this.boardable = nearestBoardable(d.lifts() as Array<BoardableLift & LiftData>, s.x, s.z);
    const people = d.nearbyPeople(s.x, s.z, 4);
    this.nearPeople = people.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < 2.5);
    this.hit = pickInteract(s.x, s.ground + s.hop + WALK.eyeHeight, s.z, -Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.yaw) * Math.cos(s.pitch), this.boxes(people));
    if (this.boardable) this.prompt = boardVerdict(this.boardable.lift).prompt;
    else this.prompt = this.hit ? promptFor(this.hit) : '';
  }
  private boxes(people: WalkPerson[]): InteractBox[] {
    const out: InteractBox[] = [], d = this.d, s = this.state;
    for (const b of d.buildings()) {
      if (Math.abs(b.x + b.w / 2 - s.x) > b.w / 2 + 4 || Math.abs(b.y + b.h / 2 - s.z) > b.h / 2 + 4) continue;
      const g = d.world.ground(b.x + b.w / 2, b.y + b.h / 2);
      out.push({ kind: 'building', id: b.id, label: b.label, minX: b.x, maxX: b.x + b.w, minZ: b.y, maxZ: b.y + b.h, minY: g - 1, maxY: g + 3 });
    }
    for (const p of people) {
      const g = d.world.ground(p.x, p.z);
      out.push({ kind: p.kind, id: p.id, label: p.label, minX: p.x - 0.3, maxX: p.x + 0.3, minZ: p.z - 0.3, maxZ: p.z + 0.3, minY: g, maxY: g + 0.6 });
    }
    return out;
  }
  /** E key. Returns a short description of what happened (for tests / toasts). */
  interact(): 'board' | 'closed' | 'inspect' | 'none' {
    if (!this.active || this.ride) return 'none';
    this.probe();
    const b = this.boardable;
    if (b) {
      const v = boardVerdict(b.lift);
      if (!v.ok) { this.d.toast?.(v.reason!); return 'closed'; }
      this.startRide(b.lift as unknown as ReturnType<WalkDeps['lifts']>[number]);
      return 'board';
    }
    if (this.hit) {
      const inf = this.d.info(this.hit.kind, this.hit.id);
      if (inf) { this.card = { title: inf.title, lines: inf.lines, until: this.clock + 7 }; return 'inspect'; }
    }
    this.card = null;
    return 'none';
  }

  // ---- cosmetic lift ride ----
  private startRide(l: ReturnType<WalkDeps['lifts']>[number]): void {
    this.ride = { liftId: l.id, t: 0, dur: cosmeticRideSeconds({ rideTimeS: l.rideTimeS }), path: l.path, family: l.family, top: l.top, name: l.name, seats: LIFTS[l.kind]?.capacityPerCarrier ?? 4 };
    this.card = null; this.prompt = '';
    this.d.rig.reset(); this.d.rig.recentre();
  }
  private updateRide(dt: number): void {
    const r = this.ride!;
    r.t += dt;
    const p = Math.min(1, r.t / r.dur);
    this.rideProgress = p;
    const sm = this.rideSample, sp = samplePath(r.path, p * r.path.length);
    sm.x = sp.x; sm.y = sp.y; sm.z = sp.z; sm.hx = r.path.dirX; sm.hz = r.path.dirZ; sm.speed = r.path.length / r.dur; sm.slope = -sp.pitch;
    sm.kind = r.family === 'gondola' || r.family === 'cablecar' || r.family === 'funicular' ? (r.family as RideSample['kind']) : 'chair';
    sm.seat = 1; sm.seats = r.seats; // deterministic seat for the (non-guest) walker
    this.d.rig.update(dt, sm);
    if (p >= 1) this.alight(r);
  }
  private alight(r: NonNullable<WalkMode['ride']>): void {
    const w = this.d.world, cx = r.top.x + LIFT_STATION_SIZE / 2, cz = r.top.y + LIFT_STATION_SIZE / 2;
    const f = nearestFree(w, cx + r.path.dirX * (LIFT_STATION_SIZE / 2 + 1), cz + r.path.dirZ * (LIFT_STATION_SIZE / 2 + 1), 10) ?? { x: cx, z: cz };
    this.ride = null; this.rideProgress = -1;
    const s = this.state;
    s.x = f.x; s.z = f.z; s.vx = s.vz = 0; s.hop = 0; s.hopV = 0; s.pitch = 0; s.yaw = yawOfHeading(r.path.dirX, r.path.dirZ); s.ground = w.ground(f.x, f.z); s.speed = 0;
    this.eyeD.snap(eyeY(s));
    this.d.rig.reset();
    this.applyCamera(0, true);
    this.d.toast?.(`Arrived at the top of ${r.name}`);
  }
  /** Name of the lift being ridden (HUD). */
  get rideName(): string { return this.ride?.name ?? ''; }
  get lookTarget(): { kind: string; id: number } | null { return this.hit ? { kind: this.hit.kind, id: this.hit.id } : null; }
  /** Altitude of the eye (world y). */
  get eyeHeightY(): number { return this.ride ? this.d.rig.pose.y : eyeY(this.state); }
  /** Name for the family -> LIFTS lookup (used by main). */
  static familyOfKind(kind: string): string { return (LIFTS as Record<string, { family: string }>)[kind]?.family ?? 'chair'; }
}
