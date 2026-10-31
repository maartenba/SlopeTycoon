import { LIFTS } from '../../config/lifts';
import { CROSSING } from '../../config/crossings';
import { NAV_MAX_BUILDS_PER_TICK, NAV_SPEED, walkSizeScale } from '../../config/balance';
import { Layer } from '../../world/Networks';
import { OccFlag } from '../../world/Occupancy';
import { octile, Pathfinder, type Link, type PathGraph } from '../../world/Pathfinding';
import { liftStations, stationCount, type LiftData } from '../Lift';

/** Extra link cost per intermediate stop of a ride through a mid-station (carriers slow down in the station). */
const MID_STOP_COST = 1.5;

/** Movement modes (also the pathfinding cache/abstract-graph key). Ski0..Ski3 = skis with max piste difficulty 0..3 (= skill+1, capped). */
export const NavMode = { Walk: 0, Hike: 1, Bike: 2, Ski0: 3, Ski1: 4, Ski2: 5, Ski3: 6, SkiOff: 7 } as const;
export const isSkiMode = (m: number): boolean => m >= NavMode.Ski0;
/** Ski mode for a guest skill: pistes up to skill+1 (beginners: blue at most; never black before advanced). */
export const skiModeFor = (skill: number): number => NavMode.Ski0 + Math.min(3, skill + 1);
export const maxDifficultyOf = (mode: number): number => (mode === NavMode.SkiOff ? 2 : mode - NavMode.Ski0);

/** Everything navigation reads from the world (Networks + Grid + TileConditions + LiftStore adapters; sim stays independent of three). */
export interface NavWorld {
  readonly size: number;
  readonly kind: Uint8Array;
  readonly layers: Uint8Array;
  readonly difficulty: Uint8Array;
  /** OccFlag bits per tile. */
  readonly occ: Uint8Array;
  /** Grid TileType per tile (rock/forest checks). */
  readonly tileType: Uint8Array;
  /** TileConditions hysteresis states. */
  readonly skiOpen: Uint8Array;
  readonly hikeOk: Uint8Array;
  /** Temporarily closed tiles (avalanche / control, Task 27): 1 = skiers may not enter. Optional; footpaths and stations stay usable. */
  readonly closed?: Uint8Array;
  /** Backcountry routes (Phase 6 Task 32): 1 on tiles of an OPEN route with low avalanche danger (<= 2). Off-piste skiers prefer them (x0.75) and avoid flagged routes of higher danger (x1.5). Optional. */
  readonly bcOff?: Uint8Array;
  /** Trail/path bridge flag per tile (1 = crossing a stream): hike/bike trails may cross water tiles flagged so. Optional. */
  readonly bridge?: Uint8Array;
  /** Level crossing per tile (Networks.cross; 0 none, 1 footpath / 2 road crossing, 3 footbridge over rail): such a rail tile is walkable. Optional. */
  readonly cross?: Uint8Array;
  /** Is this crossing tile closed right now (a train is coming)? Guests never enter a closed tile (Movement). Optional. */
  crossClosed?(tile: number): boolean;
  /** A guest waited a tick at a closed crossing (metric for the advisor). Optional. */
  onCrossingWait?(tile: number): void;
  /** Snow depth in metres. */
  readonly snow: Float32Array;
  networkVersion(): number;
  /** Mean tile altitude (world units). */
  tileAlt(x: number, y: number): number;
  isBikeable(x: number, y: number): boolean;
  lifts(): readonly LiftData[];
  /** Tile indices whose ski/hike state flipped since the last call (null = none). Consumed. */
  consumeFlips(): number[] | null;
  /** Optional: bumped when terrain heights change (flushes everything). */
  terrainVersion?(): number;
}

const SQRT2 = Math.SQRT2;
const SOLID = OccFlag.Building | OccFlag.Lift | OccFlag.Water;
const EPS = 1e-6;
const MODES = 8;
export const QUEUE_BUCKET_TICKS = 10;

/** `end`: 0 bottom terminal, 1 top terminal, 2 mid-station; `index`: position in the lift's station list (bottom = 0). */
export interface StationInfo { lift: number; end: 0 | 1 | 2; index: number }

/**
 * Combined navigation graph over tiles. Edge costs are computed on demand per mode from the live world arrays (so traversability
 * follows snow state without rebuilds); long-range lift links and the cluster hierarchy live in the Pathfinder, which this class
 * keeps in sync: it diffs the networks on version changes, consumes snow flips and watches lift state.
 */
export class NavGraph implements PathGraph {
  readonly size: number;
  /** Walk-speed multiplier of this map size (balance.walkSizeScale). */
  readonly walkScale: number;
  readonly pf: Pathfinder;
  /** Structural epoch: bumped whenever traversability or lift availability changed (guests re-validate their paths). */
  epoch = 1;
  /** Expected wait (ticks) at a lift station for link costs; set by LiftQueues. */
  waitTicks: (liftId: number, dir: 0 | 1, station?: number) => number = () => 0;
  private alt: Float32Array;
  private stationMask: Uint8Array;
  private stations = new Map<number, StationInfo>();
  private liftsById = new Map<number, LiftData>();
  private linkMaps: Array<Map<number, Link[]>> = [];
  private linkTiles: number[] = [];
  private bucketSig = new Map<number, number>();
  private netVersion = -1;
  private terrainV = -1;
  private liftSig = NaN;
  private shCross: Uint8Array;
  private shKind: Uint8Array; private shLayers: Uint8Array; private shDiff: Uint8Array;
  /** Optional per-tile ski-speed multiplier by piste quality (ops, Task 25). */
  qualityFactor: ((tile: number) => number) | null = null;
  /** Diagnostics. */
  rebuilds = 0;

  constructor(readonly world: NavWorld) {
    this.size = world.size;
    this.walkScale = walkSizeScale(world.size);
    const n2 = world.size * world.size;
    this.alt = new Float32Array(n2).fill(NaN);
    this.stationMask = new Uint8Array(n2);
    this.shCross = new Uint8Array(n2); this.shKind = new Uint8Array(n2); this.shLayers = new Uint8Array(n2); this.shDiff = new Uint8Array(n2);
    for (let m = 0; m < MODES; m++) this.linkMaps.push(new Map());
    this.pf = new Pathfinder(this);
    this.pf.maxBuildsPerTick = NAV_MAX_BUILDS_PER_TICK;
  }

  // ---------- PathGraph ----------

  diagonals(mode: number): boolean { return mode !== NavMode.Walk; }
  minCost(): number { return 0.5; }
  portalSpacing(mode: number): number { return isSkiMode(mode) ? 2 : 4; } // downhill-only terrain makes lateral detours costly: dense portals for skis
  links(mode: number, a: number): readonly Link[] | undefined { return this.linkMaps[mode]!.get(a); }
  linkNodes(): readonly number[] { return this.linkTiles; }

  private altOf(t: number): number {
    let v = this.alt[t]!;
    if (v !== v) { v = this.world.tileAlt(t % this.size, (t / this.size) | 0); this.alt[t] = v; }
    return v;
  }

  /** Tile height used for downhill checks. */
  tileAltitude(t: number): number { return this.altOf(t); }

  private isPathTile(t: number): boolean { const k = this.world.kind[t]!; return k === 1 || k === 2 || (k === 3 && (this.world.cross?.[t] ?? 0) > 0); }

  /** A level crossing that closes for trains (footpath / road crossing; a footbridge over rail never does). */
  isCrossing(t: number): boolean { const c = this.world.cross?.[t] ?? 0; return (c === 1 || c === 2) && this.world.kind[t] === 3; }
  /** Closed level crossing: nobody may enter it. */
  crossingClosed(t: number): boolean { return this.isCrossing(t) && !!this.world.crossClosed?.(t); }

  step(mode: number, a: number, b: number): number {
    const w = this.world, n = this.size;
    const kb = w.kind[b]!, cb = kb === 3 && w.cross ? w.cross[b]! : 0;
    const road = kb === 2 || cb === 2, path = kb === 1 || road || cb > 0, station = this.stationMask[b] === 1;
    const trailBridge = mode <= NavMode.Bike && !path && w.bridge !== undefined && w.bridge[b] === 1 && (w.layers[b]! & (Layer.Mtb | Layer.Hike)) !== 0;
    if (!path && !station && !trailBridge && (w.occ[b]! & SOLID) !== 0) return -1;
    const diag = (a % n !== b % n) && (((a / n) | 0) !== ((b / n) | 0));
    // no corner cutting: a diagonal step may not graze a building / water tile on either side (the drawn straight segment would cross it)
    if (diag && this.cornerBlocked(a, b)) return -1;
    const len = (diag ? SQRT2 : 1) + (trailBridge ? 0.5 : 0) + (cb === 1 || cb === 2 ? CROSSING.waitCost : 0); // a level crossing costs an expected wait
    switch (mode) {
      case NavMode.Walk:
        return path || station ? len * (road ? 0.8 : 1) : -1;
      case NavMode.Hike:
        if (path || station) return len * (road ? 0.8 : 1);
        if ((w.layers[b]! & Layer.Hike) !== 0 && w.hikeOk[b] === 1) return len * 1.2;
        return this.skinnable(b) ? len * 1.6 : -1; // Ski tourers (Task 34) skin up an open backcountry route; a plain hiker's goals are never on one
      case NavMode.Bike: {
        if (path || station) return len * 0.8;
        // a bridge deck is flat by construction; `isBikeable` is false on water tiles, so bikers could never use an MTB bridge over a lake or stream without this
        if ((w.layers[b]! & Layer.Mtb) === 0 || w.hikeOk[b] !== 1 || (!trailBridge && !w.isBikeable(b % n, (b / n) | 0))) return -1;
        const d = this.altOf(b) - this.altOf(a);
        if (d > EPS) return -1;
        return len * (d < -EPS ? 0.5 : 1.4);
      }
      default: {
        if (path) return len * 1.6; // skis carried
        if (station) return len;
        const l = w.layers[b]!, off = mode === NavMode.SkiOff;
        if (w.skiOpen[b] !== 1 || (w.closed && w.closed[b] === 1)) return -1;
        const d = this.altOf(b) - this.altOf(a);
        if (d > EPS) return -1;
        const down = d < -EPS;
        if ((l & Layer.Ski) !== 0) {
          const diff = w.difficulty[b]!, max = off ? 3 : mode - NavMode.Ski0;
          if (diff > max) return -1;
          return len * (down ? 0.55 + (diff === max && max < 3 ? 0.25 : 0) : 2.5);
        }
        if (!off) return -1;
        const t = w.tileType[b]!;
        if (t === 1) return -1; // rock
        const base = len * (down ? 1.2 : 4) * (t === 4 ? 2.2 : 1);
        return w.bcOff && (l & Layer.Backcountry) !== 0 ? base * (w.bcOff[b] === 1 ? 0.75 : 1.5) : base;
      }
    }
  }

  /** A snowy, open (not closed for avalanche danger) backcountry tile: the Ski tourer walks up it on skins (Hike mode, slower than a hiker on a trail). */
  private skinnable(t: number): boolean {
    const w = this.world;
    return (w.layers[t]! & Layer.Backcountry) !== 0 && w.skiOpen[t] === 1 && !(w.closed && w.closed[t] === 1); // a marked route is walked even over a patch of rock
  }

  private cornerBlocked(a: number, b: number): boolean {
    const n = this.size, w = this.world;
    const c1 = ((a / n) | 0) * n + (b % n), c2 = ((b / n) | 0) * n + (a % n);
    for (const c of [c1, c2]) {
      if ((w.occ[c]! & SOLID) !== 0 && !this.isPathTile(c) && this.stationMask[c] !== 1) return true;
    }
    return false;
  }

  /** Whether a guest in `mode` can stand on tile t (goal resolution / start repair). */
  standable(mode: number, t: number): boolean {
    const w = this.world;
    const st = this.stationMask[t] === 1;
    if (st || this.isPathTile(t)) return true;
    if ((w.occ[t]! & SOLID) !== 0) return false;
    switch (mode) {
      case NavMode.Walk: return false;
      case NavMode.Hike: return ((w.layers[t]! & Layer.Hike) !== 0 && w.hikeOk[t] === 1) || this.skinnable(t);
      case NavMode.Bike: return (w.layers[t]! & Layer.Mtb) !== 0 && w.hikeOk[t] === 1;
      default:
        if (w.skiOpen[t] !== 1 || (w.closed && w.closed[t] === 1)) return false;
        if ((w.layers[t]! & Layer.Ski) !== 0) return w.difficulty[t]! <= maxDifficultyOf(mode);
        return mode === NavMode.SkiOff && w.tileType[t] !== 1;
    }
  }

  /** Tiles per tick when moving a -> b. */
  speed(mode: number, a: number, b: number, skill: number, walkMul = 1): number {
    const walk = NAV_SPEED.walk * this.walkScale * walkMul; // walkMul: per-type pace on foot (seniors 0.82, `config/guestTypes` SENIOR_WALK); skiing is not affected
    if (mode === NavMode.Walk) return walk;
    const onPath = this.isPathTile(b) || this.stationMask[b] === 1;
    if (mode === NavMode.Hike) return onPath ? walk : (this.world.layers[b]! & Layer.Backcountry) !== 0 ? NAV_SPEED.hike * 0.85 : NAV_SPEED.hike; // skins are a little slower than boots
    if (mode === NavMode.Bike) {
      if (onPath) return NAV_SPEED.bike * 0.6;
      return this.altOf(a) - this.altOf(b) > EPS ? NAV_SPEED.bike : NAV_SPEED.bike * 0.5;
    }
    if (onPath) return walk * 0.8;
    const drop = this.altOf(a) - this.altOf(b);
    if (drop <= EPS) return NAV_SPEED.skiFlat;
    return NAV_SPEED.skiBase * (0.8 + 0.07 * skill) * (0.6 + Math.min(1, drop * 4) * 0.6) * (this.qualityFactor ? this.qualityFactor(b) : 1);
  }

  isPiste(t: number): boolean { return (this.world.layers[t]! & Layer.Ski) !== 0 && this.world.kind[t] === 0; }
  difficultyAt(t: number): number { return this.world.difficulty[t]!; }
  layersAt(t: number): number { return this.world.layers[t]!; }
  isStation(t: number): boolean { return this.stationMask[t] === 1; }
  stationAt(t: number): StationInfo | undefined { return this.stations.get(t); }
  liftOfTag(tag: number): LiftData | undefined { return this.liftsById.get(tag >> 1); }
  liftTag(mode: number, a: number, b: number): number {
    return this.linkMaps[mode]!.get(a)?.find((l) => l.to === b)?.tag ?? -1;
  }

  // ---------- synchronisation ----------

  /** Mark one tile changed (also used by tests that mutate the world directly). */
  touch(tile: number): void { this.pf.markDirty(tile); this.epoch++; }
  invalidateAll(): void { this.alt.fill(NaN); this.pf.markAllDirty(); this.epoch++; }

  private liftSignature(): number {
    let h = 0x811c9dc5;
    const mix = (v: number): void => { h ^= v | 0; h = Math.imul(h, 0x01000193) >>> 0; };
    for (const l of this.world.lifts()) {
      mix(l.id); mix(l.open ? 1 : 0); mix(Math.round(l.speed * 100));
      mix(l.bottom.x); mix(l.bottom.y); mix(l.top.x); mix(l.top.y);
      if (l.stations && l.stations.length > 2) for (const st of l.stations) { mix(st.x); mix(st.y); mix(st.board === false ? 0 : 1); mix(st.alight === false ? 0 : 1); }
      const m = l.activeMode ?? 'none';
      for (let i = 0; i < m.length; i++) mix(m.charCodeAt(i));
      mix(l.kind.length);
    }
    return h;
  }

  /** Call once per tick before guests move. Cheap when nothing changed. */
  update(tick: number): void {
    const w = this.world;
    const tv = w.terrainVersion ? w.terrainVersion() : 0;
    if (tv !== this.terrainV) { this.terrainV = tv; this.alt.fill(NaN); this.netVersion = -1; }
    const v = w.networkVersion();
    if (v !== this.netVersion) {
      const first = this.netVersion < 0;
      this.netVersion = v;
      const n2 = this.size * this.size;
      let changed = 0;
      for (let i = 0; i < n2; i++) {
        if (this.shKind[i] !== w.kind[i] || this.shLayers[i] !== w.layers[i] || this.shDiff[i] !== w.difficulty[i] || (w.cross !== undefined && this.shCross[i] !== w.cross[i])) {
          if (w.cross) this.shCross[i] = w.cross[i]!;
          this.shKind[i] = w.kind[i]!; this.shLayers[i] = w.layers[i]!; this.shDiff[i] = w.difficulty[i]!;
          if (!first) { this.pf.markDirty(i); changed++; }
        }
      }
      if (first) this.pf.markAllDirty();
      if (changed || first) this.epoch++;
      this.rebuilds++;
    }
    const flips = w.consumeFlips();
    if (flips && flips.length) {
      if (flips.length > (this.size * this.size) / 8) this.pf.markAllDirty();
      else for (const t of flips) this.pf.markDirty(t);
      this.epoch++;
    }
    const sig = this.liftSignature();
    const structural = sig !== this.liftSig;
    this.liftSig = sig;
    if (structural || tick % QUEUE_BUCKET_TICKS === 0) this.syncLifts(structural);
  }

  private bucket(liftId: number, dir: 0 | 1, station?: number): number {
    return Math.min(30, Math.round(this.waitTicks(liftId, dir, station) / QUEUE_BUCKET_TICKS));
  }
  /** Bucket signature key of the queue at station `idx` for direction `d`. */
  private bkey(liftId: number, idx: number, d: 0 | 1): number { return (liftId * 8 + idx) * 2 + d; }

  /** Rebuild lift station masks and link tables. `structural` = lifts changed; otherwise only queue-time buckets may have moved. */
  private syncLifts(structural: boolean): void {
    const w = this.world, n = this.size;
    if (!structural) {
      let costChanged = false;
      for (const l of w.lifts()) {
        const n = stationCount(l);
        for (const d of [0, 1] as const) for (let k = 0; k < n; k++) {
          if (n === 2 && k !== (d === 0 ? 0 : 1)) continue; // ordinary lift: one queue per direction (bottom up, top down)
          if (this.bucketSig.get(this.bkey(l.id, k, d)) !== this.bucket(l.id, d, n === 2 ? undefined : k)) costChanged = true;
        }
      }
      if (!costChanged) return;
    }
    for (const t of this.stations.keys()) this.stationMask[t] = 0;
    this.stations.clear(); this.liftsById.clear();
    for (const m of this.linkMaps) m.clear();
    this.bucketSig.clear();
    for (const l of w.lifts()) {
      this.liftsById.set(l.id, l);
      const ends = liftStations(l);
      const NS = ends.length;
      const tl: number[][] = ends.map(() => []);
      for (let e = 0; e < NS; e++) {
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const x = ends[e]!.x + dx, y = ends[e]!.y + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const t = y * n + x;
          this.stationMask[t] = 1; this.stations.set(t, { lift: l.id, end: e === 0 ? 0 : e === NS - 1 ? 1 : 2, index: e });
          tl[e]!.push(t);
        }
      }
      for (const d of [0, 1] as const) for (let k = 0; k < NS; k++) {
        if (NS === 2 && k !== (d === 0 ? 0 : 1)) continue;
        this.bucketSig.set(this.bkey(l.id, k, d), this.bucket(l.id, d, NS === 2 ? undefined : k));
      }
      if (structural) for (const list of tl) for (const t of list) this.pf.markDirty(t);
      const am = l.activeMode ?? (l.kind === 'tbar' ? 'ski' : 'mixed');
      if (!l.open || !am || tl.some((x) => !x.length)) continue;
      const def = LIFTS[l.kind];
      const skiOk = am === 'ski' || am === 'mixed', footOk = (am === 'foot' || am === 'mixed') && l.kind !== 'tbar';
      const add = (mode: number, from: number[], to: number, cost: number, tag: number): void => {
        const m = this.linkMaps[mode]!;
        for (const f of from) { let a = m.get(f); if (!a) { a = []; m.set(f, a); } a.push({ to, cost, tag }); }
      };
      for (let mode = NavMode.Hike as number; mode < MODES; mode++) {
        const ski = mode >= NavMode.Ski0;
        const upOk = ski ? skiOk : mode === NavMode.Bike ? footOk && def.carriesBikes : footOk;
        const downOk = !ski && footOk && (mode !== NavMode.Bike || def.carriesBikes); // skiers never ride down by choice
        // every ordered pair of stations is a link (a guest may ride through, or alight at the station nearest the goal)
        for (let i = 0; i < NS; i++) for (let j = 0; j < NS; j++) {
          if (i === j) continue;
          const upward = j > i;
          if (upward ? !upOk : !downOk) continue;
          if (ends[i]!.board === false || ends[j]!.alight === false) continue;
          const base = 0.5 * octile(n, tl[i]![0]!, tl[j]![0]!) + 2 + Math.max(0, Math.abs(j - i) - 1) * MID_STOP_COST;
          const cost = upward ? base + this.waitTicks(l.id, 0, NS === 2 ? undefined : i) * NAV_SPEED.walk * this.walkScale : base;
          add(mode, tl[i]!, tl[j]![0]!, cost, l.id * 2 + (upward ? 0 : 1));
        }
      }
    }
    const keys = new Set<number>();
    for (const m of this.linkMaps) for (const k of m.keys()) keys.add(k);
    this.linkTiles = [...keys].sort((a, b) => a - b);
    if (structural) { this.pf.refreshLinks(); this.epoch++; } else this.pf.bumpCosts();
  }

  // ---------- helpers for decisions / movement ----------

  /** Rectangle of one lift station (2x2). */
  stationRect(l: LiftData, end: 0 | 1): { x: number; y: number; w: number; h: number } {
    const p = end === 0 ? l.bottom : l.top;
    return { x: p.x, y: p.y, w: 2, h: 2 };
  }
  stationAnchor(l: LiftData, end: 0 | 1): number { const p = end === 0 ? l.bottom : l.top; return p.y * this.size + p.x; }
  /** Anchor tile of station `index` of the lift's station list (0 = bottom). */
  stationAnchorAt(l: LiftData, index: number): number { const p = liftStations(l)[index]!; return p.y * this.size + p.x; }

  /** Whether the remaining path from index `from` is still traversable (cheap re-validation after structural changes). */
  pathStillValid(mode: number, nodes: Int32Array, from: number): boolean {
    return this.pf.pathCost(mode, nodes.subarray(Math.max(0, from))) >= 0;
  }
}

/** Minimal NavWorld over the legacy WalkNet (footpath/road tiles only). Lets pre-navigation fixtures keep working. */
export function navFromWalkNet(net: { size: number; kind: Uint8Array; version: number }): NavWorld {
  const n2 = net.size * net.size;
  const z = new Uint8Array(n2);
  return {
    size: net.size, kind: net.kind, layers: z, difficulty: z, occ: z, tileType: z, skiOpen: z, hikeOk: z, snow: new Float32Array(n2),
    networkVersion: () => net.version, tileAlt: () => 0, isBikeable: () => false, lifts: () => [], consumeFlips: () => null,
  };
}
