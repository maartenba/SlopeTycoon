import { BUILDINGS } from '../../../src/config/buildings';
import { OccFlag } from '../../../src/world/Occupancy';
import { Layer } from '../../../src/world/Networks';
import type { LiftData } from '../../../src/sim/Lift';
import type { LiftKind } from '../../../src/config/lifts';
import { NavGraph, type NavWorld } from '../../../src/sim/guests/NavGraph';
import type { GuestWorld, WorldBuilding } from '../../../src/sim/guests/GuestWorld';
import { building, fakeWorld, type FakeOpts } from './helpers';

const SLOPE = 0.12; // altitude drop per tile southwards (world units)

/**
 * Synthetic resort on a plain grid (no WebGL, no terrain generator): altitude falls with y (north = up the mountain), tiles carry
 * footpath / piste / trail layers, snow state is driven by a snowline, lifts are plain LiftData. Implements NavWorld, so it feeds
 * NavGraph / GuestSim directly. Reusable by every sim test that needs "village, paths, a chairlift, a piste, a restaurant".
 */
export class Fixture implements NavWorld {
  readonly kind: Uint8Array; readonly layers: Uint8Array; readonly difficulty: Uint8Array; readonly occ: Uint8Array;
  readonly tileType: Uint8Array; readonly skiOpen: Uint8Array; readonly hikeOk: Uint8Array; readonly snow: Float32Array;
  /** Temporary closures (avalanche): NavWorld.closed. */
  readonly closed: Uint8Array;
  version = 1;
  liftList: LiftData[] = [];
  buildings: WorldBuilding[] = [];
  private flips: number[] = [];
  private nextLift = 1;
  snowline = Infinity;

  constructor(readonly size: number) {
    const n2 = size * size;
    this.kind = new Uint8Array(n2); this.layers = new Uint8Array(n2); this.difficulty = new Uint8Array(n2); this.occ = new Uint8Array(n2);
    this.tileType = new Uint8Array(n2); this.skiOpen = new Uint8Array(n2); this.hikeOk = new Uint8Array(n2); this.snow = new Float32Array(n2);
    this.closed = new Uint8Array(n2);
    this.setSnowline(Infinity, false);
  }
  /** Close / reopen an inclusive rectangle for skiers (records flips like OpenStatus.takeClosureFlips). */
  setClosed(x0: number, y0: number, x1: number, y1: number, closed: boolean): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * this.size + x; this.closed[i] = closed ? 1 : 0; this.flips.push(i); }
  }

  // ---- NavWorld ----
  networkVersion(): number { return this.version; }
  tileAlt(_x: number, y: number): number { return (this.size - y) * SLOPE; }
  isBikeable(): boolean { return true; }
  lifts(): readonly LiftData[] { return this.liftList; }
  consumeFlips(): number[] | null { if (!this.flips.length) return null; const f = this.flips; this.flips = []; return f; }
  groundAt = (x: number, y: number): number => this.tileAlt(x, y);

  // ---- builders ----
  path(x0: number, y0: number, x1: number, y1: number, k = 1): this {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.kind[y * this.size + x] = k;
    this.version++;
    return this;
  }
  /** Inclusive rectangle painted as ski piste of `difficulty` (0..3). */
  piste(x0: number, y0: number, x1: number, y1: number, difficulty = 1): this { return this.paint(Layer.Ski, x0, y0, x1, y1, difficulty); }
  trail(layer: 'hike' | 'mtb', x0: number, y0: number, x1: number, y1: number): this { return this.paint(layer === 'hike' ? Layer.Hike : Layer.Mtb, x0, y0, x1, y1, 0); }
  private paint(layer: number, x0: number, y0: number, x1: number, y1: number, diff: number): this {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * this.size + x; this.layers[i]! |= layer; this.difficulty[i] = diff; }
    this.version++;
    return this;
  }
  addBuilding(type: string, x: number, y: number): WorldBuilding {
    const b = building(type, x, y);
    for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) this.occ[yy * this.size + xx]! |= OccFlag.Building;
    this.buildings.push(b);
    return b;
  }
  /** Building whose bottom edge touches street row `streetY`. */
  addBuildingOnStreet(type: string, x: number, streetY: number): WorldBuilding {
    return this.addBuilding(type, x, streetY - BUILDINGS[type]!.h);
  }
  addLift(kind: LiftKind, bx: number, by: number, tx: number, ty: number, activeMode: LiftData['activeMode'] = 'ski'): LiftData {
    const ground = (y: number): number => this.tileAlt(0, y);
    const l: LiftData = {
      id: this.nextLift++, kind, bottom: { x: bx, y: by, ground: ground(by) }, top: { x: tx, y: ty, ground: ground(ty) },
      towers: [], nodes: [{ x: bx + 1, y: ground(by) + 1, z: by + 1 }, { x: tx + 1, y: ground(ty) + 1, z: ty + 1 }], tiles: [],
      open: true, mode: 'auto', activeMode, speed: 1, cost: 0,
    };
    for (const [sx, sy] of [[bx, by], [tx, ty]] as const) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const t = (sy + dy) * this.size + sx + dx;
      l.tiles.push(t); this.occ[t]! |= OccFlag.Lift;
    }
    this.liftList.push(l);
    return l;
  }
  /** Tiles with y < line hold snow (skiable, not snow-free); the rest are snow-free. Records flipped tiles. */
  setSnowline(line: number, record = true): void {
    this.snowline = line;
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      const i = y * this.size + x, snowy = y < line;
      const ski = snowy ? 1 : 0, hike = snowy ? 0 : 1;
      this.snow[i] = snowy ? 0.8 + Math.min(1, (line - y) * 0.02) : 0;
      if (record && (this.skiOpen[i] !== ski || this.hikeOk[i] !== hike)) this.flips.push(i);
      this.skiOpen[i] = ski; this.hikeOk[i] = hike;
    }
  }
  /** Force one tile's ski state (e.g. close a piste tile). */
  setSkiOpen(x: number, y: number, open: boolean): void {
    const i = y * this.size + x;
    this.skiOpen[i] = open ? 1 : 0; this.snow[i] = open ? 0.8 : 0;
    this.flips.push(i);
  }

  guestWorld(o: FakeOpts = {}): GuestWorld {
    const w = fakeWorld(this.buildings, { size: this.size, ...o });
    return { ...w, nav: () => this, groundAt: this.groundAt, networkVersion: () => this.version };
  }
  /** Standalone navigation graph with the per-tick cluster-build budget lifted (unit tests call queries directly). */
  graph(): NavGraph { const g = new NavGraph(this); g.pf.maxBuildsPerTick = Infinity; return g; }
}

/** One restaurant, village paths, a chairlift and a blue piste beside it: the smallest working resort. */
export function starterResort(size: 64 | 128 | 256 = 64, difficulty = 1): Fixture {
  const f = new Fixture(size);
  const mid = size >> 1, base = Math.floor(size * 0.78), top = Math.floor(size * 0.2), street = base + 2;
  f.path(4, street, size - 5, street); // village street
  f.piste(mid - 2, top, mid - 1, base - 2, difficulty); // 2-wide piste down the fall line, left of the lift
  f.path(mid - 1, base - 1, mid - 1, street); // piste exit -> street (and beside the bottom station)
  f.addLift('chair4', mid, base, mid, top, 'ski');
  f.addBuildingOnStreet('cafe', mid + 6, street);
  f.addBuildingOnStreet('baseLodge', mid - 14, street);
  return f;
}

/**
 * Spring layout for the snowline test: a gondola (mixed) from the village to a mid station, a chairlift above it, a piste only
 * above the mid station and a hike trail below it. With the snowline at `mid` the upper mountain is skiable and the lower
 * is snow-free (same save, different date).
 */
export function springResort(size: 64 | 128 | 256 = 64): { f: Fixture; mid: number; base: number } {
  const f = new Fixture(size);
  const x = size >> 1, base = Math.floor(size * 0.8), mid = Math.floor(size * 0.5), top = Math.floor(size * 0.18);
  f.path(4, base + 2, size - 5, base + 2);
  f.addLift('gondola6', x, base, x, mid, 'mixed');
  f.path(x - 8, mid + 2, x + 6, mid + 2); // mid-station plaza
  f.addLift('chair4', x + 4, mid, x + 4, top, 'ski');
  f.piste(x + 2, top, x + 3, mid - 1, 1);
  f.trail('hike', x - 8, mid + 3, x - 8, base + 1);
  f.addBuildingOnStreet('cafe', x + 8, base + 2);
  f.setSnowline(mid + 1, false);
  return { f, mid, base };
}

/**
 * Big generated map for pathfinding tests/perf: footpath lattice with random gaps, wide pistes down the fall line (difficulty varies
 * by band), hike trails and a few lifts. Deterministic in `seed`.
 */
export function generatedResort(size: 64 | 128 | 256, seed: number): Fixture {
  const f = new Fixture(size);
  let s = (seed * 2654435761) >>> 0;
  const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const step = 12;
  for (let y = 6; y < size - 4; y += step) for (let x = 3; x < size - 4; x++) if (rnd() > 0.04) f.kind[y * size + x] = 1;
  for (let x = 6; x < size - 4; x += step) for (let y = 3; y < size - 4; y++) if (rnd() > 0.04) f.kind[y * size + x] = 1;
  const pistes = Math.max(2, size >> 5);
  for (let k = 0; k < pistes; k++) {
    const cx = 10 + Math.floor(rnd() * (size - 24));
    f.piste(cx, 8, cx + 4, size - 10, 1 + (k % 3));
  }
  for (let k = 0; k < pistes; k++) { const cx = 8 + Math.floor(rnd() * (size - 16)); f.trail('hike', cx, 10, cx, size - 10); }
  for (let k = 0; k < Math.max(1, size >> 6); k++) {
    const cx = 12 + Math.floor(rnd() * (size - 28));
    f.addLift('chair4', cx, size - 14, cx, 12, 'mixed');
  }
  f.version++;
  return f;
}
