import type { GameBus, SeasonId } from '../../core/events';
import { Rng } from '../../core/Rng';
import { ANIMAL_SPEED_K, DAYS_PER_MONTH } from '../../config/balance';
import type { Coverage } from '../Coverage';
import { Sev, type Incidents, type SafetyGuestPort } from './Incidents';

/**
 * Wildlife (Task 26 + bear roaming): bears and wolves roam remote forest around a den (home range = `terr` tiles), cycle rest / wander /
 * forage, hibernate (bears, winter), get hungry in autumn (wider range, drifting towards buildings/paths) and stalk off-piste skiers / remote hikers.
 *
 * Bear threat field (`threat`, 0..255 per tile): a strong disc around the bear's CURRENT position (radius 10-18 tiles, larger when hungry /
 * wandering) plus a weak, persistent territory footprint. Guests inside the (smaller) scare radius get frightened (happiness, thought, abort
 * their activity, sometimes leave); the Decider penalises trails / attractions inside the field; scares feed a decaying 'scare level' that dents
 * the rating's safety component and the arrival rate. Ranger Stations (coverage kind 'wildlife') shrink the field, dispatch rangers to haze
 * bears off conflict spots and, for repeat offenders, tranquilise + relocate them. Warning Signs / patrol coverage still reduce ATTACK chances.
 */
export const WILD = {
  forestMin: 170, remoteDist: 6, sense: 7, attackRange: 1.6, speed: 0.3 * ANIMAL_SPEED_K, minBlockDist: 2,
  /** Tiles of remote forest per animal, and per-map-size max wolves. */
  tilesPerAnimal: 160, maxEach: { 64: 1, 128: 2, 256: 4 } as Record<number, number>,
  /** Bears: 1-3 / 2-4 / 4-8 on 64 / 128 / 256 (limited by remote forest: 1 per `bearTiles`). */
  maxBears: { 64: 3, 128: 4, 256: 8 } as Record<number, number>, minBears: { 64: 1, 128: 2, 256: 4 } as Record<number, number>, bearTiles: 90, minRemoteForBear: 40,
  attack: { bear: 0.5, wolf: 0.35 }, signFactor: 0.4, patrolFactor: 0.5, crowd: 3, retreatTicks: 40, relocateCost: 50, sweepChance: 0.5,
  /** Territory radius (tiles) and tiles/tick walking speed per kind. */
  terr: { bear: 15, wolf: 24 }, walk: { bear: 0.1 * ANIMAL_SPEED_K, wolf: 0.14 * ANIMAL_SPEED_K },
  field: { base: 10, extra: 8, scareFrac: 0.65, territoryWeight: 0.3 },
  scare: { cooldown: 60, happiness: 0.12, leaveChance: 0.12, newsGap: 1200, perGuestLevel: 1, levelDecay: 0.85, levelScale: 12, arrivalLoss: 0.2, ratingLoss: 30 },
  /** Rangers: ATV speed, deterrence (field shrink) with staff / without staff, costs, escalation. */
  ranger: { speed: 5, deter: 0.45, deterIdle: 0.18, hazeCost: 40, relocateCost: 600, relocateTicks: 8, relocateCooldown: 1200, escalateAt: 3, binsCost: 1500, extraWage: 30, defaultStaff: 2, maxStaff: 4, savedPerScare: 35, calm: 0.35, attackCut: 0.5, reach: 7 },
} as const;

export type AnimalKind = 'bear' | 'wolf';
export type AnimalMode = 'rest' | 'wander' | 'forage' | 'flee' | 'sedated';
export interface Animal {
  id: number; kind: AnimalKind; x: number; y: number; tx: number; ty: number; cooldown: number; stalking: number; asleep: boolean;
  /** Den tile centre (hibernation spot, territory centre) and territory radius (tiles). */
  denX: number; denY: number; terr: number;
  mode: AnimalMode; timer: number;
  /** Mother's cub follows (render only). */
  cub: boolean;
  /** Ticks left before this animal may be relocated again. */
  relocCd: number;
  /** Ticks left of retreat after hazing (no stalking, shrunken field). */
  hazed: number;
  /** Hazing count (decays daily); at `ranger.escalateAt` rangers relocate. */
  hazeLog: number;
  /** Guests scared since the last news line, and the tick of that line. */
  scareN: number; newsAt: number;
  /** Last tick a guest was in conflict range (scared / on a path near the bear). */
  conflict: number;
  /** Ranger already on the way. */
  claimed: boolean;
  /** Spawned by a debug tool: never culled by `refresh()` (not saved). */
  debug?: boolean;
}
export interface RangerAgent { id: number; station: number; x: number; y: number; bear: number; phase: 'go' | 'work' | 'back'; t: number; kind: 'haze' | 'relocate'; hx: number; hy: number }
export interface StationState { staff: number; bins: boolean; prevented: number; saved: number; hazes: number; relocations: number; month: number }

export interface WildlifeDeps {
  size: 64 | 128 | 256;
  forest: Uint8Array;
  /** Tiles that animals avoid: buildings, paths, pistes (occupied / network). */
  blocked: (i: number) => boolean;
  coverage: Coverage;
  guests: SafetyGuestPort;
  incidents: Incidents;
  season: () => SeasonId;
  bus?: Pick<GameBus, 'emit'>;
  news?: (msg: string) => void;
  spend?: (category: 'rescue', amount: number) => void;
  /** Human place name for a tile (Names.describeLocation). */
  where?: (x: number, y: number) => string;
  seed?: number;
}

export class Wildlife {
  animals: Animal[] = [];
  /** Debug / test switch: false removes every animal and stops spawning. */
  enabled = true;
  /** Scenario modifier: fixed bear count (null = by map size). */
  bearsOverride: number | null = null;
  /** Debug / test switch: false ignores Ranger Stations entirely (no deterrence, no dispatch). */
  rangersEnabled = true;
  agents: RangerAgent[] = [];
  stations = new Map<number, StationState>();
  remote: Uint8Array;
  remoteCount = 0;
  attacks = 0; deterred = 0; scares = 0; prevented = 0; hazes = 0; relocations = 0;
  /** Exponentially decaying number of recently scared guests (see `scareLevel`). */
  recent = 0;
  /** 0..255 threat per tile; `version` bumps whenever it is recomputed. */
  readonly threat: Uint8Array;
  private base: Uint8Array;
  private baseKey = 0;
  private staffed = false;
  threatVersion = 0;
  private rng: Rng;
  private dist: Int16Array;
  private nextId = 1;
  private nextAgent = 1;
  private remoteList: Int32Array = new Int32Array(0);
  private scaredUntil = new Map<number, number>();
  private lastDay = -1e9;
  private lastTick = 0;
  /** Guest ids that recently saw a bear (inspector thought). */
  private saw = new Map<number, number>();

  constructor(private d: WildlifeDeps) {
    const N = d.size;
    this.remote = new Uint8Array(N * N);
    this.dist = new Int16Array(N * N);
    this.threat = new Uint8Array(N * N);
    this.base = new Uint8Array(N * N);
    this.rng = new Rng((d.seed ?? 1) ^ 0xb3a2);
  }

  /** Recompute remote forest (forest dense, >= remoteDist tiles from anything blocked) and top up animals. */
  refresh(): void {
    const N = this.d.size, dist = this.dist, INF = 999;
    dist.fill(INF);
    for (let i = 0; i < N * N; i++) if (this.d.blocked(i)) dist[i] = 0;
    // two-pass chamfer (Chebyshev-ish with unit steps)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x; let v = dist[i]!;
      if (x > 0) v = Math.min(v, dist[i - 1]! + 1);
      if (y > 0) { v = Math.min(v, dist[i - N]! + 1); if (x > 0) v = Math.min(v, dist[i - N - 1]! + 1); if (x < N - 1) v = Math.min(v, dist[i - N + 1]! + 1); }
      dist[i] = v;
    }
    for (let y = N - 1; y >= 0; y--) for (let x = N - 1; x >= 0; x--) {
      const i = y * N + x; let v = dist[i]!;
      if (x < N - 1) v = Math.min(v, dist[i + 1]! + 1);
      if (y < N - 1) { v = Math.min(v, dist[i + N]! + 1); if (x < N - 1) v = Math.min(v, dist[i + N + 1]! + 1); if (x > 0) v = Math.min(v, dist[i + N - 1]! + 1); }
      dist[i] = v;
    }
    const list: number[] = [];
    for (let i = 0; i < N * N; i++) {
      const ok = this.d.forest[i]! >= WILD.forestMin && dist[i]! >= WILD.remoteDist;
      this.remote[i] = ok ? 1 : 0;
      if (ok) list.push(i);
    }
    this.remoteList = Int32Array.from(list);
    this.remoteCount = list.length;
    if (!this.enabled) { this.animals = []; this.updateField(); return; }
    const wolves = Math.min(WILD.maxEach[N] ?? 1, Math.floor(this.remoteCount / WILD.tilesPerAnimal));
    const bears = this.remoteCount < WILD.minRemoteForBear ? 0 : this.bearsOverride ?? Math.min(WILD.maxBears[N] ?? 1, Math.max(WILD.minBears[N] ?? 1, Math.floor(this.remoteCount / WILD.bearTiles)));
    for (const [kind, each] of [['bear', bears], ['wolf', wolves]] as const) {
      let have = this.animals.filter((a) => a.kind === kind && !a.debug);
      while (have.length < each) { const a = this.spawn(kind); this.animals.push(a); have = this.animals.filter((q) => q.kind === kind && !q.debug); }
      while (have.length > each) { this.animals.splice(this.animals.indexOf(have.pop()!), 1); }
    }
    for (const a of this.animals) if (!this.free(a.x, a.y)) {
      const home = this.free(a.denX, a.denY) ? ((a.denY | 0) * N + (a.denX | 0)) : this.randomRemote();
      if (home >= 0) { this.place(a, (home % N) + 0.5, ((home / N) | 0) + 0.5, true); }
    }
    this.updateField();
  }

  /** True while bears sleep in their dens (winter). */
  get hibernating(): boolean { return this.d.season() === 'winter'; }

  /**
   * DEBUG: add one animal on a remote forest tile (the nearest one to `near` when given, else a random one picked with the CALLER's rng:
   * the sim's own RNG stream is not touched). Returns null when the map has no remote forest. Refuses nothing else: the debug helpers
   * (`sim/ops/wildlifeDebug.ts`) apply the hibernation / existing-bear rules.
   */
  debugSpawn(kind: AnimalKind, rng: { next(): number }, near?: { x: number; y: number }): Animal | null {
    const N = this.d.size;
    if (!this.remoteList.length) return null;
    let t = -1;
    if (near) {
      let bd = Infinity;
      for (let k = 0; k < this.remoteList.length; k++) {
        const c = this.remoteList[k]!;
        const d = Math.hypot((c % N) + 0.5 - near.x, ((c / N) | 0) + 0.5 - near.y);
        if (d < bd) { bd = d; t = c; }
      }
    } else t = this.remoteList[Math.floor(rng.next() * this.remoteList.length)]!;
    if (t < 0) return null;
    const x = (t % N) + 0.5, y = ((t / N) | 0) + 0.5;
    const id = this.nextId++;
    const a: Animal = { id, kind, x, y, tx: x, ty: y, cooldown: 0, stalking: 0, asleep: this.hibernating && kind === 'bear', denX: x, denY: y, terr: WILD.terr[kind], mode: 'rest', timer: 10, cub: false, relocCd: 0, hazed: 0, hazeLog: 0, scareN: 0, newsAt: -1e9, conflict: -1e9, claimed: false, debug: true };
    this.animals.push(a);
    this.updateField();
    return a;
  }

  private randomRemote(): number { return this.remoteList.length ? this.remoteList[Math.floor(this.rng.next() * this.remoteList.length)]! : -1; }

  private place(a: Animal, x: number, y: number, newDen: boolean): void {
    a.x = a.tx = x; a.y = a.ty = y;
    if (newDen) { a.denX = x; a.denY = y; }
    a.stalking = 0; a.mode = 'rest'; a.timer = 8;
  }

  private spawn(kind: AnimalKind): Animal {
    const N = this.d.size;
    // spread dens: best of 8 random remote tiles by distance to the existing dens
    let t = this.randomRemote(), bestD = -1;
    for (let k = 0; k < 8; k++) {
      const c = this.randomRemote();
      if (c < 0) break;
      const cx = (c % N) + 0.5, cy = ((c / N) | 0) + 0.5;
      let md = 1e9;
      for (const o of this.animals) md = Math.min(md, Math.hypot(o.denX - cx, o.denY - cy));
      if (md > bestD) { bestD = md; t = c; }
    }
    const x = (t % N) + 0.5, y = ((t / N) | 0) + 0.5;
    const id = this.nextId++;
    return { id, kind, x, y, tx: x, ty: y, cooldown: 0, stalking: 0, asleep: false, denX: x, denY: y, terr: WILD.terr[kind], mode: 'rest', timer: 10 + (id % 7) * 3, cub: kind === 'bear' && id % 3 === 0, relocCd: 0, hazed: 0, hazeLog: 0, scareN: 0, newsAt: -1e9, conflict: -1e9, claimed: false };
  }

  private active(a: Animal): number {
    const s = this.d.season();
    if (a.kind === 'bear') return s === 'winter' ? 0 : s === 'summer' || s === 'autumn' ? 1 : 0.7;
    return s === 'winter' ? 1 : 0.6;
  }

  /** True for a tile an animal may stand on (>= 2 tiles from anything built, forested). */
  free(x: number, y: number): boolean {
    const N = this.d.size;
    if (x < 0 || y < 0 || x >= N || y >= N) return false;
    return this.dist[(y | 0) * N + (x | 0)]! >= WILD.minBlockDist && this.d.forest[(y | 0) * N + (x | 0)]! > 60;
  }

  // ---- ranger deterrence -------------------------------------------------------------------------------------------------------------
  /** Best deterrence (0..~0.45) at a point from active Ranger Stations in range (idle = no staff). */
  deterrence(x: number, y: number): number {
    let best = 0;
    if (!this.rangersEnabled) return 0;
    for (const s of this.d.coverage.sources('wildlife')) {
      if (Math.hypot(s.cx - x, s.cy - y) > s.r) continue;
      const st = this.stations.get(s.id);
      best = Math.max(best, (st?.staff ?? WILD.ranger.defaultStaff) > 0 ? WILD.ranger.deter : WILD.ranger.deterIdle);
    }
    return best;
  }
  private stationAt(x: number, y: number): { id: number; cx: number; cy: number } | null {
    let best: { id: number; cx: number; cy: number } | null = null, bd = Infinity;
    for (const s of this.d.coverage.sources('wildlife')) { const dd = Math.hypot(s.cx - x, s.cy - y); if (dd <= s.r && dd < bd) { bd = dd; best = { id: s.id, cx: s.cx, cy: s.cy }; } }
    return best;
  }
  private st(id: number): StationState {
    let s = this.stations.get(id);
    if (!s) { s = { staff: WILD.ranger.defaultStaff, bins: false, prevented: 0, saved: 0, hazes: 0, relocations: 0, month: this.month() }; this.stations.set(id, s); }
    return s;
  }
  private month(): number { return Math.floor(this.lastTick / 240 / DAYS_PER_MONTH); }
  staffOf(id: number): number { return this.stations.get(id)?.staff ?? WILD.ranger.defaultStaff; }
  setStaff(id: number, n: number): void { this.st(id).staff = Math.max(0, Math.min(WILD.ranger.maxStaff, n)); }
  binsOf(id: number): boolean { return this.stations.get(id)?.bins ?? false; }
  /** Buy / remove bear-proof bins (one-off fee). */
  setBins(id: number, on: boolean): void {
    const s = this.st(id);
    if (on && !s.bins) this.d.spend?.('rescue', WILD.ranger.binsCost);
    s.bins = on;
  }
  /** Stats for the inspector (this month). */
  stationStats(id: number): { staff: number; bins: boolean; preventedMonth: number; savedMonth: number; hazes: number; relocations: number; bearsInRange: number; ready: number } {
    const s = this.st(id), src = this.d.coverage.sources('wildlife').find((q) => q.id === id);
    const cur = s.month === this.month();
    let n = 0;
    if (src) for (const a of this.animals) if (a.kind === 'bear' && !a.asleep && Math.hypot(a.x - src.cx, a.y - src.cy) <= src.r) n++;
    return { staff: s.staff, bins: s.bins, preventedMonth: cur ? s.prevented : 0, savedMonth: cur ? s.saved : 0, hazes: s.hazes, relocations: s.relocations, bearsInRange: n, ready: s.staff - this.agents.filter((g) => g.station === id).length };
  }
  private binsNear(x: number, y: number): boolean {
    for (const s of this.d.coverage.sources('wildlife')) if (this.stations.get(s.id)?.bins && Math.hypot(s.cx - x, s.cy - y) <= s.r) return true;
    return false;
  }

  // ---- threat field ------------------------------------------------------------------------------------------------------------------
  /** 0..1 threat at a tile index; guests only know about it once there have been scares (`avoidance`). */
  threatAt(i: number): number { return this.threat[i]! / 255; }
  /** 0..1: how strongly guests steer clear of a tile (territory is only common knowledge after scares). */
  avoidance(i: number): number {
    const t = this.threat[i]!;
    if (t === 0) return 0;
    // rangers patrolling the area make guests feel safe again (staffed station in range)
    const calm = this.rangersEnabled && this.staffed && this.d.coverage.map('wildlife')[i]! > 0 ? WILD.ranger.calm : 1;
    return (t / 255) * (0.55 + 0.45 * this.scareLevel()) * calm;
  }
  /** 0..1 recent-scare level (decays over days); feeds the rating and arrival rate. */
  scareLevel(): number { return 1 - Math.exp(-this.recent / WILD.scare.levelScale); }
  /** Multiplier on guest arrivals (1 = no effect). */
  arrivalFactor(): number { return 1 - WILD.scare.arrivalLoss * this.scareLevel(); }
  /** Rating safety malus in points (0..ratingLoss). */
  ratingMalus(): number { return WILD.scare.ratingLoss * this.scareLevel(); }
  sawBear(id: number): boolean { const t = this.saw.get(id); return t !== undefined && this.lastTick - t < 180; }

  private fieldRadius(a: Animal): number {
    const hungry = this.d.season() === 'autumn';
    const lvl = hungry ? 1 : a.mode === 'wander' || a.stalking ? 0.6 : a.mode === 'flee' ? 0.4 : 0.15;
    return (WILD.field.base + WILD.field.extra * lvl) * (a.hazed > 0 ? 0.4 : 1) * (1 - 0.6 * this.deterrence(a.x, a.y));
  }

  /** Territory footprint layer (weak, persistent; halved inside ranger coverage). Rebuilt only when dens / sleep state / coverage change. */
  private rebuildBase(): void {
    const N = this.d.size, B = this.base, wmap = this.d.coverage.map('wildlife');
    B.fill(0);
    for (const a of this.animals) {
      if (a.kind !== 'bear' || a.mode === 'sedated' || a.asleep) continue; // a hibernating bear's den is quiet
      const R = a.terr, r2 = R * R, w = WILD.field.territoryWeight * 255;
      const y0 = Math.max(0, Math.floor(a.denY - R)), y1 = Math.min(N - 1, Math.ceil(a.denY + R)), x0 = Math.max(0, Math.floor(a.denX - R)), x1 = Math.min(N - 1, Math.ceil(a.denX + R));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - a.denX, dy = y + 0.5 - a.denY, q = dx * dx + dy * dy;
        if (q > r2) continue;
        const i = y * N + x;
        const v = w * (1 - 0.5 * Math.sqrt(q) / R) * (wmap[i]! ? 0.5 : 1);
        if (v > B[i]!) B[i] = v;
      }
    }
  }

  /** Rebuild the per-tile threat map: territory base + a disc around every awake bear (<= 8 bears, <= 18 tiles: ~tens of microseconds). */
  updateField(): void {
    const N = this.d.size, T = this.threat;
    let key = this.d.coverage.version * 31 + this.animals.length;
    for (const a of this.animals) key = (Math.imul(key, 1000003) + Math.round(a.denX * 2) * 7 + Math.round(a.denY * 2) * 13 + (a.asleep || a.mode === 'sedated' ? 1 : 0)) | 0;
    if (key !== this.baseKey) { this.baseKey = key; this.rebuildBase(); }
    T.set(this.base);
    this.staffed = this.d.coverage.sources('wildlife').some((s) => this.staffOf(s.id) > 0);
    for (const a of this.animals) {
      if (a.kind !== 'bear' || a.mode === 'sedated' || a.asleep) continue;
      const Rf = this.fieldRadius(a), rf2 = Rf * Rf;
      const fy0 = Math.max(0, Math.floor(a.y - Rf)), fy1 = Math.min(N - 1, Math.ceil(a.y + Rf)), fx0 = Math.max(0, Math.floor(a.x - Rf)), fx1 = Math.min(N - 1, Math.ceil(a.x + Rf));
      for (let y = fy0; y <= fy1; y++) for (let x = fx0; x <= fx1; x++) {
        const dx = x + 0.5 - a.x, dy = y + 0.5 - a.y, q = dx * dx + dy * dy;
        if (q > rf2) continue;
        const v = 255 * (1 - Math.sqrt(q) / Rf);
        const i = y * N + x;
        if (v > T[i]!) T[i] = v;
      }
    }
    this.threatVersion++;
  }

  private chance(kind: AnimalKind, x: number, y: number): number {
    const cov = this.d.coverage;
    let p: number = WILD.attack[kind];
    if (cov.isCovered('warning', x, y)) p *= WILD.signFactor;
    if (cov.isCovered('patrol', x, y)) p *= WILD.patrolFactor;
    p *= 1 - WILD.ranger.attackCut * this.deterrence(x, y);
    return p;
  }

  // ---- per-tick simulation -----------------------------------------------------------------------------------------------------------
  update(tick: number): void {
    this.lastTick = tick;
    const g = this.d.guests;
    for (const a of this.animals) {
      const act = this.active(a), wasAsleep = a.asleep;
      a.asleep = act === 0;
      if (a.asleep) { if (!wasAsleep) { a.x = a.tx = a.denX; a.y = a.ty = a.denY; a.mode = 'rest'; a.stalking = 0; } continue; }
      if (wasAsleep) { a.mode = 'rest'; a.timer = 12; }
      if (a.cooldown > 0) a.cooldown--;
      if (a.relocCd > 0) a.relocCd--;
      if (a.hazed > 0) a.hazed--;
      if (a.mode === 'sedated') continue; // ranger.relocate drives this
      // sense prey every other tick (staggered)
      if (a.cooldown === 0 && a.hazed === 0 && (tick + a.id) % 2 === 0) {
        let best = -1, bd = Infinity;
        const ids = g.near(a.x, a.y, WILD.sense, 'prey');
        if (ids.length >= WILD.crowd) { // animals avoid groups
          a.tx = a.x; a.ty = a.y; a.stalking = 0;
        } else for (const id of ids) {
          const p = g.position(id);
          if (!p) continue;
          const dd = Math.hypot(p.x - a.x, p.y - a.y);
          if (dd < bd) { bd = dd; best = id; }
        }
        if (best >= 0) {
          const p = g.position(best)!;
          if (bd <= WILD.attackRange) { this.encounter(a, best, p.x, p.y, tick); continue; }
          if (this.rng.next() < act) { a.tx = p.x; a.ty = p.y; a.stalking = best; a.mode = 'wander'; a.timer = 0; }
        } else a.stalking = 0;
      }
      this.move(a, act);
      if (a.kind === 'bear' && (tick + a.id) % 3 === 0) this.scareGuests(a, tick);
    }
    this.rangers(tick);
    this.updateField();
    if (tick % 240 === 120) this.sweep();
  }

  private move(a: Animal, act: number): void {
    const N = this.d.size, dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
    if (a.mode === 'rest' || a.mode === 'forage') {
      if (--a.timer <= 0) this.nextAction(a);
      return;
    }
    if (d < 0.3) { // arrived (or stalking target reached)
      if (a.mode === 'flee') { a.mode = 'rest'; a.timer = 25; a.stalking = 0; return; }
      if (a.stalking) { a.stalking = 0; a.mode = 'rest'; a.timer = 8; return; }
      a.mode = this.rng.next() < 0.7 ? 'forage' : 'rest'; a.timer = a.mode === 'forage' ? 8 + Math.floor(this.rng.next() * 14) : 14 + Math.floor(this.rng.next() * 30);
      return;
    }
    const sp = (a.stalking ? WILD.speed : a.mode === 'flee' ? WILD.speed * 1.2 : WILD.walk[a.kind]) * act;
    const nx = a.x + (dx / d) * Math.min(sp, d), ny = a.y + (dy / d) * Math.min(sp, d);
    if (this.free(nx, ny)) { a.x = nx; a.y = ny; } else { a.tx = a.x; a.ty = a.y; a.stalking = 0; a.mode = 'rest'; a.timer = 10; }
    void N;
  }

  /** After a rest/forage pause: pick the next wander target inside the territory (hungry autumn bears reach further, towards buildings/paths). */
  private nextAction(a: Animal): void {
    const N = this.d.size, hungry = this.d.season() === 'autumn' && a.kind === 'bear' && !this.binsNear(a.x, a.y);
    const reach = a.terr * (hungry ? 1.6 : 1);
    let bt = -1, bs = Infinity;
    for (let k = 0; k < (hungry ? 6 : 3); k++) {
      const ang = this.rng.next() * Math.PI * 2, r = Math.sqrt(this.rng.next()) * reach;
      const x = a.denX + Math.cos(ang) * r, y = a.denY + Math.sin(ang) * r;
      if (!this.free(x, y)) continue;
      const i = (y | 0) * N + (x | 0);
      const score = hungry ? this.dist[i]! : this.rng.next() - 0.02 * Math.min(this.dist[i]!, 20);
      if (score < bs) { bs = score; bt = i; }
    }
    if (bt < 0) { a.mode = 'rest'; a.timer = 15; return; }
    a.tx = (bt % N) + 0.5; a.ty = ((bt / N) | 0) + 0.5; a.mode = 'wander';
  }

  /** Patrols drive animals out of covered areas (costs a little). */
  sweep(): void {
    const N = this.d.size;
    for (const a of this.animals) {
      if (a.mode === 'sedated' || !this.d.coverage.isCovered('patrol', a.x, a.y) || !this.rng.chance(WILD.sweepChance)) continue;
      const t = this.randomRemote();
      if (t < 0) continue;
      a.x = a.tx = (t % N) + 0.5; a.y = a.ty = ((t / N) | 0) + 0.5; a.stalking = 0;
      this.d.spend?.('rescue', WILD.relocateCost);
    }
  }

  private encounter(a: Animal, guestId: number, px: number, py: number, tick: number): void {
    const N = this.d.size;
    const attack = this.rng.chance(this.chance(a.kind, px, py));
    a.cooldown = WILD.retreatTicks; a.stalking = 0;
    this.nextAction(a);
    if (a.mode !== 'wander') { a.tx = a.denX; a.ty = a.denY; a.mode = 'flee'; }
    if (attack) {
      this.attacks++;
      const r = this.rng.next();
      const sev = a.kind === 'bear' ? (r < 0.3 ? Sev.Critical : Sev.Major) : (r < 0.6 ? Sev.Minor : Sev.Major);
      const inc = this.d.incidents.report('attack', px, py, sev, guestId);
      this.d.bus?.emit('incident:wildlife', { x: px, y: py, kind: a.kind, animal: a.kind, guestId, outcome: 'attack' });
      if (inc) this.d.news?.(`${a.kind === 'bear' ? 'Bear' : 'Wolf'} attack near (${Math.floor(px)}, ${Math.floor(py)})! Warning signs and patrols help.`);
      if (a.kind === 'bear') { this.recent += 4; a.conflict = tick; }
    } else {
      this.deterred++;
      this.d.bus?.emit('incident:wildlife', { x: px, y: py, kind: a.kind, animal: a.kind, guestId, outcome: 'deterred' });
    }
    void N;
  }

  // ---- scares ------------------------------------------------------------------------------------------------------------------------
  /** Guests within the scare radius flee; guests that would have been scared without ranger deterrence count as 'prevented'. */
  private scareGuests(a: Animal, tick: number): void {
    const g = this.d.guests, N = this.d.size;
    const lvl = this.d.season() === 'autumn' ? 1 : a.mode === 'wander' || a.stalking ? 0.6 : a.mode === 'flee' ? 0.4 : 0.15;
    const R0 = (WILD.field.base + WILD.field.extra * lvl) * WILD.field.scareFrac * (a.hazed > 0 ? 0.4 : 1);
    const det = this.deterrence(a.x, a.y), Reff = R0 * (1 - det);
    const ids = g.near(a.x, a.y, R0, 'any');
    let scared = 0, prevented = 0;
    for (const id of ids) {
      if ((this.scaredUntil.get(id) ?? 0) > tick) continue;
      const p = g.position(id);
      if (!p) continue;
      const dd = Math.hypot(p.x - a.x, p.y - a.y);
      a.conflict = tick;
      this.scaredUntil.set(id, tick + WILD.scare.cooldown);
      if (dd > Reff) { prevented++; continue; }
      if (g.scare?.(id, a.x, a.y, this.rng.next() < WILD.scare.leaveChance)) { scared++; this.saw.set(id, tick); }
    }
    if (this.scaredUntil.size > 4000) for (const [k, v] of this.scaredUntil) if (v <= tick) this.scaredUntil.delete(k);
    if (this.saw.size > 2000) for (const [k, v] of this.saw) if (tick - v > 180) this.saw.delete(k);
    if (prevented) {
      this.prevented += prevented;
      const s = this.stationAt(a.x, a.y);
      if (s) { const ss = this.st(s.id); this.rollMonth(ss); ss.prevented += prevented; ss.saved += prevented * WILD.ranger.savedPerScare; }
    }
    if (!scared) return;
    this.scares += scared; this.recent += scared * WILD.scare.perGuestLevel; a.scareN += scared;
    if (tick - a.newsAt >= WILD.scare.newsGap) {
      a.newsAt = tick;
      const tx = Math.floor(a.x), ty = Math.floor(a.y);
      this.d.bus?.emit('wildlife:scare', { animal: a.kind, id: a.id, x: a.x, y: a.y, tile: ty * N + tx, guests: a.scareN, areaName: this.d.where?.(a.x, a.y) ?? '' });
      a.scareN = 0;
    }
  }
  private rollMonth(s: StationState): void { const m = this.month(); if (s.month !== m) { s.month = m; s.prevented = 0; s.saved = 0; } }

  // ---- rangers -----------------------------------------------------------------------------------------------------------------------
  private rangers(tick: number): void {
    const R = WILD.ranger, N = this.d.size;
    // advance agents
    for (let k = this.agents.length - 1; k >= 0; k--) {
      const ag = this.agents[k]!, bear = this.animals.find((a) => a.id === ag.bear);
      const src = this.d.coverage.sources('wildlife').find((s) => s.id === ag.station);
      if (!src) { if (bear) bear.claimed = false; this.agents.splice(k, 1); continue; } // station gone
      if (ag.phase === 'go') {
        if (!bear || bear.asleep) { ag.phase = 'back'; if (bear) bear.claimed = false; continue; }
        const dx = bear.x - ag.x, dy = bear.y - ag.y, d = Math.hypot(dx, dy);
        if (d <= R.reach) { ag.phase = 'work'; ag.t = ag.kind === 'relocate' ? R.relocateTicks : 2; ag.hx = bear.x; ag.hy = bear.y; if (ag.kind === 'relocate') { bear.mode = 'sedated'; bear.stalking = 0; } continue; }
        ag.x += (dx / d) * Math.min(R.speed, d); ag.y += (dy / d) * Math.min(R.speed, d);
      } else if (ag.phase === 'work') {
        if (--ag.t > 0 || !bear) { if (!bear) ag.phase = 'back'; continue; }
        const ss = this.st(ag.station); this.rollMonth(ss);
        if (ag.kind === 'haze') {
          this.retreat(bear); bear.hazed = 40; bear.stalking = 0; bear.cooldown = WILD.retreatTicks; bear.hazeLog++; bear.conflict = -1e9;
          ss.hazes++; ss.prevented++; ss.saved += R.savedPerScare * 2; this.hazes++; this.prevented++;
          this.d.spend?.('rescue', R.hazeCost);
          this.d.bus?.emit('wildlife:hazed', { animal: bear.kind, id: bear.id, x: bear.x, y: bear.y, station: ag.station });
        } else {
          // tranquilise + relocate: new den far away, deep in the wilderness
          let bt = -1, bs = -1;
          for (let q = 0; q < 14; q++) {
            const c = this.randomRemote();
            if (c < 0) break;
            const cx = (c % N) + 0.5, cy = ((c / N) | 0) + 0.5;
            const sc = Math.hypot(cx - ag.hx, cy - ag.hy) + 2 * this.dist[c]!;
            if (sc > bs) { bs = sc; bt = c; }
          }
          const fx = bear.x, fy = bear.y;
          if (bt >= 0) this.place(bear, (bt % N) + 0.5, ((bt / N) | 0) + 0.5, true);
          bear.mode = 'rest'; bear.timer = 30; bear.relocCd = R.relocateCooldown; bear.hazeLog = 0; bear.conflict = -1e9; bear.hazed = 20;
          ss.relocations++; ss.prevented += 3; ss.saved += R.savedPerScare * 6; this.relocations++; this.prevented += 3;
          this.d.spend?.('rescue', R.relocateCost);
          this.d.bus?.emit('wildlife:relocated', { animal: bear.kind, id: bear.id, x: fx, y: fy, toX: bear.x, toY: bear.y, station: ag.station, cost: R.relocateCost });
        }
        bear.claimed = false; ag.phase = 'back';
      } else {
        const dx = src.cx - ag.x, dy = src.cy - ag.y, d = Math.hypot(dx, dy);
        if (d < 1) { this.agents.splice(k, 1); continue; }
        ag.x += (dx / d) * Math.min(R.speed, d); ag.y += (dy / d) * Math.min(R.speed, d);
      }
    }
    // dispatch: one ranger per conflicted bear per station with a free ranger (checked every 2nd tick)
    if (tick % 2 !== 0 || !this.rangersEnabled) return;
    for (const src of this.d.coverage.sources('wildlife')) {
      const ss = this.st(src.id);
      if (ss.staff - this.agents.filter((g) => g.station === src.id).length <= 0) continue;
      let pick: Animal | null = null, pd = Infinity;
      for (const a of this.animals) {
        if (a.kind !== 'bear' || a.asleep || a.claimed || a.mode === 'sedated' || a.hazed > 0 || tick - a.conflict > 8) continue;
        const dd = Math.hypot(a.x - src.cx, a.y - src.cy);
        if (dd <= src.r && dd < pd) { pd = dd; pick = a; }
      }
      if (!pick) continue;
      const kind = pick.hazeLog >= R.escalateAt && pick.relocCd === 0 ? 'relocate' : 'haze';
      pick.claimed = true;
      this.agents.push({ id: this.nextAgent++, station: src.id, x: src.cx, y: src.cy, bear: pick.id, phase: 'go', t: 0, kind, hx: 0, hy: 0 });
    }
  }

  /** Hazing: the bear bolts to the remotest nearby tile and its home range creeps that way (rangers push territories away from trails). */
  private retreat(a: Animal): void {
    const N = this.d.size;
    let bt = -1, bs = -1;
    for (let k = 0; k < 10; k++) {
      const ang = this.rng.next() * Math.PI * 2, r = 10 + this.rng.next() * 10;
      const x = a.x + Math.cos(ang) * r, y = a.y + Math.sin(ang) * r;
      if (!this.free(x, y)) continue;
      const i = (y | 0) * N + (x | 0);
      if (this.dist[i]! > bs) { bs = this.dist[i]!; bt = i; }
    }
    if (bt < 0) { a.tx = a.denX; a.ty = a.denY; } else { a.tx = (bt % N) + 0.5; a.ty = ((bt / N) | 0) + 0.5; a.denX += (a.tx - a.denX) * 0.4; a.denY += (a.ty - a.denY) * 0.4; }
    a.mode = 'flee';
  }

  /** Daily bookkeeping (call once per in-game day): decay scare level / hazing log, ranger extra wages. Idempotent per day. */
  daily(day: number): void {
    if (day === this.lastDay) return;
    this.lastDay = day;
    this.recent *= WILD.scare.levelDecay;
    if (this.recent < 0.05) this.recent = 0;
    for (const a of this.animals) if (a.hazeLog > 0 && day > 0 && day % 2 === 0) a.hazeLog--;
    for (const s of this.d.coverage.sources('wildlife')) {
      const extra = Math.max(0, this.staffOf(s.id) - WILD.ranger.defaultStaff);
      if (extra > 0) this.d.spend?.('rescue', extra * WILD.ranger.extraWage);
    }
  }

  serialize(): unknown {
    return {
      rng: this.rng.getState(), animals: this.animals.map((a) => ({ ...a })), nextId: this.nextId, attacks: this.attacks, deterred: this.deterred,
      scares: this.scares, prevented: this.prevented, hazes: this.hazes, relocations: this.relocations, recent: this.recent, lastDay: this.lastDay,
      scared: [...this.scaredUntil].filter(([, v]) => v > this.lastTick), stations: [...this.stations].map(([id, s]) => [id, { ...s }]), agents: this.agents.map((a) => ({ ...a })), nextAgent: this.nextAgent,
    };
  }
  load(d: unknown): void {
    const s = d as {
      rng: number; animals?: Array<Partial<Animal> & Pick<Animal, 'id' | 'kind' | 'x' | 'y'>>; nextId?: number; attacks?: number; deterred?: number;
      scares?: number; prevented?: number; hazes?: number; relocations?: number; recent?: number; lastDay?: number;
      stations?: Array<[number, StationState]>; agents?: RangerAgent[]; nextAgent?: number; scared?: Array<[number, number]>;
    } | undefined;
    if (!s) return;
    this.rng.setState(s.rng);
    if (s.animals) {
      // explicit key order = spawn() order, so re-serialising a loaded save is byte-identical (save tests compare JSON)
      this.animals = s.animals.map((a) => ({
        id: a.id, kind: a.kind, x: a.x, y: a.y, tx: a.tx ?? a.x, ty: a.ty ?? a.y, cooldown: a.cooldown ?? 0, stalking: a.stalking ?? 0, asleep: a.asleep ?? false,
        denX: a.denX ?? a.x, denY: a.denY ?? a.y, terr: a.terr ?? WILD.terr[a.kind], mode: a.mode ?? 'rest', timer: a.timer ?? 10, cub: a.cub ?? false, relocCd: a.relocCd ?? 0, hazed: a.hazed ?? 0,
        hazeLog: a.hazeLog ?? 0, scareN: a.scareN ?? 0, newsAt: a.newsAt ?? -1e9, conflict: a.conflict ?? -1e9, claimed: a.claimed ?? false,
      }));
      this.nextId = s.nextId ?? this.nextId; this.attacks = s.attacks ?? 0; this.deterred = s.deterred ?? 0;
    }
    this.scares = s.scares ?? 0; this.prevented = s.prevented ?? 0; this.hazes = s.hazes ?? 0; this.relocations = s.relocations ?? 0; this.recent = s.recent ?? 0; this.lastDay = s.lastDay ?? -1e9;
    this.stations = new Map((s.stations ?? []).map(([id, v]) => [id, { ...v }]));
    this.agents = (s.agents ?? []).map((a) => ({ ...a })); this.nextAgent = s.nextAgent ?? 1;
    this.scaredUntil = new Map(s.scared ?? []); this.saw.clear(); this.baseKey = 0;
  }
  hash(): string {
    let h = 0x811c9dc5;
    const mix = (v: number): void => { h ^= v | 0; h = Math.imul(h, 0x01000193) >>> 0; };
    for (const a of this.animals) { mix(Math.round(a.x * 10)); mix(Math.round(a.y * 10)); mix(a.cooldown); mix(Math.round(a.denX * 10)); mix(Math.round(a.denY * 10)); mix(a.timer); mix(a.relocCd); mix(a.hazed); mix(a.mode.length); }
    for (const a of this.agents) { mix(Math.round(a.x * 10)); mix(Math.round(a.y * 10)); mix(a.t); }
    for (const s of this.stations.values()) { mix(s.staff); mix(s.bins ? 1 : 0); mix(s.prevented); }
    mix(this.attacks); mix(this.deterred); mix(this.scares); mix(this.prevented); mix(Math.round(this.recent * 100)); mix(this.rng.getState());
    return h.toString(16).padStart(8, '0');
  }
}
