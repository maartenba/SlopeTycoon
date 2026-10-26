import type { Coverage, CoverageBuilding } from '../Coverage';
import { Q, type PisteQuality } from './PisteQuality';
import type { OpsCostCategory } from './Snowmaking';

export const GROOM = {
  nightStart: 22,
  nightEnd: 6,
  /** Min snow depth (m) for grooming. */
  minDepth: 0.2,
  /** Tiles a single vehicle can groom per night. */
  capacity: 100,
  /** Tiles per tick while grooming / driving without grooming. */
  groomSpeed: 1.9,
  driveSpeed: 3.75,
  garageRange: 40,
  defaultFleet: { groomerGarage: 2, snowcatOutpost: 1 } as Record<string, number>,
  maxFleet: 4,
  wagePerVehicleNight: 60,
  fuelPerTile: 0.4,
} as const;

/** Priority per quality (higher = groomed first). */
const NEED: Record<number, number> = { [Q.Bumpy]: 5, [Q.Icy]: 5, [Q.Packed]: 4, [Q.Slush]: 3, [Q.Powder]: 1.5 };

export interface Cat {
  station: number;
  x: number; y: number;
  sx: number; sy: number;
  /** Tile indices in visiting order. */
  route: number[];
  k: number;
  groomed: number;
  returning: boolean;
  done: boolean;
}

export interface GroomingEnv {
  size: number;
  quality: PisteQuality;
  coverage: Coverage;
  snowDepth: Float32Array;
  buildings: () => Iterable<CoverageBuilding>;
  onCost?: (category: OpsCostCategory, amount: number) => void;
  onNight?: (r: { vehicles: number; tiles: number }) => void;
}

interface Station { id: number; x: number; y: number; r: number; vehicles: number }

export const isNightHour = (hour: number): boolean => hour >= GROOM.nightStart || hour < GROOM.nightEnd;

/** Nightly snowcat fleet: plans tile assignments at the start of the night, then drives along the routes grooming tile by tile. */
export class Grooming {
  readonly cats: Cat[] = [];
  private fleet = new Map<number, number>();
  private nightKey = Number.NEGATIVE_INFINITY;
  private active = false;
  /** Result of the last finished night. */
  last = { vehicles: 0, tiles: 0 };
  /** Tiles groomed by each station last night. */
  private lastByStation = new Map<number, number>();
  private nightTiles = 0;
  /** Bumped when cats are (re)planned or removed (renderer rebuild hint). */
  planVersion = 0;
  /** Staff hooks (Task 19 / 20): crew cap (null = none), per-cat tile capacity and fuel multipliers (1 = untouched). */
  crewLimit: () => number | null = () => null;
  capacityMod: () => number = () => 1;
  fuelMod: () => number = () => 1;

  constructor(private env: GroomingEnv) {}

  get nightActive(): boolean { return this.active; }

  /** Vehicles configured for a garage/outpost (defaults by type). */
  vehiclesOf(id: number, type?: string): number {
    const v = this.fleet.get(id);
    if (v !== undefined) return v;
    return type ? (GROOM.defaultFleet[type] ?? 0) : 0;
  }
  setVehicles(id: number, n: number): void { this.fleet.set(id, Math.max(0, Math.min(GROOM.maxFleet, Math.round(n)))); }
  groomedLastNight(id: number): number { return this.lastByStation.get(id) ?? 0; }

  private stations(): Station[] {
    const out: Station[] = [];
    const radius = new Map<number, number>();
    for (const s of this.env.coverage.sources('grooming')) radius.set(s.id, s.r);
    for (const b of this.env.buildings()) {
      if (!b.active) continue;
      if (b.type !== 'snowcatOutpost' && b.type !== 'groomerGarage') continue;
      const r = b.type === 'snowcatOutpost' ? radius.get(b.id) : GROOM.garageRange;
      if (!r) continue;
      const vehicles = this.vehiclesOf(b.id, b.type);
      if (vehicles > 0) out.push({ id: b.id, x: b.x + b.w / 2, y: b.y + b.h / 2, r, vehicles });
    }
    out.sort((a, b) => a.id - b.id);
    let cap = this.crewLimit();
    if (cap !== null) for (const s of out) { const v = Math.min(s.vehicles, cap); s.vehicles = v; cap -= v; }
    return cap === null ? out : out.filter((s) => s.vehicles > 0);
  }

  /** Auto headcount for the staff pool: configured snowcats of every active station (ignores the crew cap). */
  fleetNeed(): number {
    const cap = this.crewLimit; this.crewLimit = () => null;
    try { return this.stations().reduce((a, s) => a + s.vehicles, 0); } finally { this.crewLimit = cap; }
  }

  /** Advance one tick at the given absolute day / hour. */
  update(absDay: number, hour: number, win?: { start: number; end: number }): void {
    const start = win ? win.start : GROOM.nightStart, end = win ? win.end - 24 : GROOM.nightEnd; // window follows the dark hours (sim/Daylight.ts)
    const night = hour >= start || hour < end;
    if (night) {
      const key = hour >= start ? absDay : absDay - 1;
      if (key !== this.nightKey) { this.nightKey = key; this.plan(); }
      if (this.active) this.drive();
    } else if (this.active) this.finish();
  }

  /** Assign tiles to vehicles (priority: worst surface first, within coverage + station range, capacity-limited). */
  plan(): void {
    const e = this.env, N = e.size, q = e.quality;
    this.cats.length = 0; this.lastByStation.clear(); this.nightTiles = 0;
    const stations = this.stations();
    this.active = false;
    this.planVersion++;
    if (!stations.length) return;
    const cov = e.coverage.map('grooming');
    const cands: Array<{ i: number; p: number }> = [];
    for (let i = 0; i < N * N; i++) {
      const s = q.state[i]!;
      if (!s || s === Q.Groomed || !cov[i]) continue;
      if (e.snowDepth[i]! < GROOM.minDepth) continue;
      const need = NEED[s] ?? 0;
      if (need > 0) cands.push({ i, p: need + Math.min(3, q.wear[i]! / 20) });
    }
    for (const st of stations) for (let v = 0; v < st.vehicles; v++) {
      this.cats.push({ station: st.id, x: st.x, y: st.y, sx: st.x, sy: st.y, route: [], k: 0, groomed: 0, returning: false, done: false });
    }
    const catStation = this.cats.map((c) => stations.find((s) => s.id === c.station)!);
    cands.sort((a, b) => b.p - a.p || a.i - b.i);
    const load = new Array<number>(this.cats.length).fill(0);
    const capacity = GROOM.capacity * this.capacityMod();
    for (const c of cands) {
      const tx = (c.i % N) + 0.5, ty = ((c.i / N) | 0) + 0.5;
      let best = -1;
      for (let v = 0; v < this.cats.length; v++) {
        if (load[v]! >= capacity) continue;
        const st = catStation[v]!;
        if (Math.hypot(tx - st.x, ty - st.y) > st.r) continue;
        if (best < 0 || load[v]! < load[best]!) best = v;
      }
      if (best >= 0) { this.cats[best]!.route.push(c.i); load[best]!++; }
    }
    // order each route by nearest neighbour from the station
    for (const cat of this.cats) cat.route = nearestOrder(cat.route, cat.sx, cat.sy, N);
    for (const cat of this.cats) if (!cat.route.length) cat.done = true;
    this.active = this.cats.some((c) => !c.done);
    if (!this.active) this.cats.length = 0;
    else this.env.onCost?.('wages', this.cats.length * GROOM.wagePerVehicleNight);
  }

  private drive(): void {
    const N = this.env.size;
    let any = false;
    for (const c of this.cats) {
      if (c.done) continue;
      any = true;
      let budget = 1;
      while (budget > 1e-6) {
        let tx: number, ty: number;
        if (c.returning) { tx = c.sx; ty = c.sy; }
        else { const t = c.route[c.k]!; tx = (t % N) + 0.5; ty = ((t / N) | 0) + 0.5; }
        const d = Math.hypot(tx - c.x, ty - c.y);
        const v = c.returning || d > 1.5 ? GROOM.driveSpeed : GROOM.groomSpeed;
        if (d / v <= budget) {
          budget -= d / v; c.x = tx; c.y = ty;
          if (c.returning) { c.done = true; break; }
          this.env.quality.groom(c.route[c.k]!); c.groomed++; this.nightTiles++;
          if (++c.k >= c.route.length) c.returning = true;
        } else { c.x += ((tx - c.x) / d) * v * budget; c.y += ((ty - c.y) / d) * v * budget; budget = 0; }
      }
    }
    if (!any) this.finish();
  }

  /** End the night: bill fuel, record stats, emit. */
  private finish(): void {
    if (!this.active) return;
    this.active = false;
    for (const c of this.cats) this.lastByStation.set(c.station, (this.lastByStation.get(c.station) ?? 0) + c.groomed);
    const r = { vehicles: this.cats.length, tiles: this.nightTiles };
    this.last = r;
    this.env.onCost?.('fuel', Math.round(r.tiles * GROOM.fuelPerTile * this.fuelMod()));
    this.cats.length = 0;
    this.planVersion++;
    this.env.onNight?.(r);
  }

  serialize(): unknown {
    return { fleet: [...this.fleet.entries()], nightKey: this.nightKey === Number.NEGATIVE_INFINITY ? null : this.nightKey, active: this.active, last: this.last,
      by: [...this.lastByStation.entries()], nightTiles: this.nightTiles, cats: this.cats };
  }
  load(d: unknown): void {
    const s = d as { fleet: Array<[number, number]>; nightKey: number | null; active: boolean; last: { vehicles: number; tiles: number }; by: Array<[number, number]>; nightTiles: number; cats: Cat[] };
    this.fleet = new Map(s.fleet); this.nightKey = s.nightKey ?? Number.NEGATIVE_INFINITY; this.active = s.active; this.last = s.last;
    this.lastByStation = new Map(s.by); this.nightTiles = s.nightTiles; this.cats.length = 0; this.cats.push(...s.cats); this.planVersion++;
  }
}

function nearestOrder(tiles: number[], sx: number, sy: number, N: number): number[] {
  const rem = tiles.slice().sort((a, b) => a - b), out: number[] = [];
  let cx = sx, cy = sy;
  while (rem.length) {
    let bi = 0, bd = Infinity;
    for (let j = 0; j < rem.length; j++) {
      const t = rem[j]!, dx = (t % N) + 0.5 - cx, dy = ((t / N) | 0) + 0.5 - cy, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bi = j; }
    }
    const t = rem[bi]!; rem[bi] = rem[rem.length - 1]!; rem.pop();
    // keep deterministic: swap-remove changes order of ties deterministically (same inputs => same outputs)
    out.push(t); cx = (t % N) + 0.5; cy = ((t / N) | 0) + 0.5;
  }
  return out;
}
