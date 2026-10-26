import type { SeasonId } from '../../core/events';
import { Rng } from '../../core/Rng';
import { ANIMAL_SPEED_K, DAYS_PER_MONTH, DAYS_PER_YEAR } from '../../config/balance';
import { seasonOfMonth } from '../Clock';
import { TileType, isWaterType } from '../../world/Grid';
import type { Critter, TerrainStats } from './Fauna';
import type { Grid } from '../../world/Grid';

/** Season progress 0..1 over the current season (by months), and its length in months. */
export function seasonProgress(day: number): { season: SeasonId; progress: number; monthsInto: number } {
  const month = Math.floor(day / DAYS_PER_MONTH), season = seasonOfMonth(month);
  let first = month;
  while (seasonOfMonth(first - 1) === season) first--;
  let last = month;
  while (seasonOfMonth(last + 1) === season) last++;
  const len = (last - first + 1) * DAYS_PER_MONTH, startDay = ((first % 12) + 12) % 12 * DAYS_PER_MONTH;
  const into = (((day - startDay) % (12 * DAYS_PER_MONTH)) + 12 * DAYS_PER_MONTH) % (12 * DAYS_PER_MONTH);
  return { season, progress: Math.min(1, into / len), monthsInto: month - first };
}

export type HerdPhase = 'barn' | 'paddock' | 'ascend' | 'graze' | 'descend';

/** Phase of the transhumance calendar: winter barn; early spring paddock; late spring up to the alpine pastures; summer graze;
 * first part of autumn Almabtrieb (descend, decorated), then the paddock until winter. */
export function phaseFor(day: number): HerdPhase {
  const { season, progress } = seasonProgress(day);
  if (season === 'winter') return 'barn';
  if (season === 'spring') return progress < 0.5 ? 'paddock' : 'ascend';
  if (season === 'summer') return 'graze';
  return progress < 0.35 ? 'descend' : progress < 0.9 ? 'paddock' : 'barn';
}

export const LIVESTOCK = {
  /** Total livestock per map size (cap) and animals per farm. */
  maxTotal: { 64: 14, 128: 40, 256: 100 } as Record<number, number>,
  perFarm: { cow: 6, sheep: 5, goat: 3 },
  /** Pasture radius (tiles) by map size. */
  radius: { 64: 12, 128: 18, 256: 24 } as Record<number, number>,
  paddock: 4, speed: 0.07 * ANIMAL_SPEED_K, travelSpeed: 0.13 * ANIMAL_SPEED_K, snowFree: 0.08,
  festivalHappiness: 0.08, farmHappiness: 0.02,
} as const;

export interface FarmRef { id: number; x: number; y: number; w: number; h: number; active: boolean }

export interface LivestockDeps {
  size: 64 | 128 | 256;
  grid: Grid;
  stats: TerrainStats;
  blocked: (i: number) => boolean;
  /** Tiles livestock must never stand on (buildings, roads, rail, footpaths). Defaults to `blocked`. Ski/hike/MTB layers are NOT solid: in snow-free
   * months cows graze across pistes (they used to be fenced out of every piste tile, which left small maps without any pasture). */
  solid?: (i: number) => boolean;
  /** Forest density 0..255 per tile: cows prefer open meadow (trees hide them). */
  forest?: Uint8Array;
  /** Piste tiles: livestock is in the barn in winter, but may cross pistes in snow-free months (cosmetic). */
  farms: () => FarmRef[];
  seed: number;
  news?: (msg: string) => void;
  /** Bump happiness of guests near (x,y) within r (festival). */
  cheer?: (x: number, y: number, r: number, amount: number) => number;
}

/** Cows, sheep and goats belonging to Alpine Farms. Cosmetic + small bonuses; deterministic; time-sliced via Fauna-like stride. */
export class Livestock {
  animals: Critter[] = [];
  private rng: Rng;
  private nextId = 1_000_000;
  private lastPhase: HerdPhase = 'barn';
  private lastAscendYear = -1;
  private lastFestivalYear = -1;
  festivals = 0;
  phase: HerdPhase = 'barn';
  /** Day seen by the previous update (not saved): a jump of more than 3 days (date jump / debug) settles the herds straight into the new phase. */
  private lastDay = -1;

  constructor(private d: LivestockDeps) { this.rng = new Rng((d.seed ^ 0xc0e5) >>> 0); }

  /** Save/load (Task 33). */
  serialize(): unknown {
    return { animals: this.animals.map((a) => ({ ...a })), rng: this.rng.getState(), nextId: this.nextId, lastPhase: this.lastPhase, lastAscendYear: this.lastAscendYear, lastFestivalYear: this.lastFestivalYear, festivals: this.festivals, phase: this.phase };
  }
  load(d: unknown): void {
    const s = d as { animals: Critter[]; rng: number; nextId: number; lastPhase: HerdPhase; lastAscendYear: number; lastFestivalYear: number; festivals: number; phase: HerdPhase };
    this.animals = s.animals.map((a) => ({ ...a })); this.rng.setState(s.rng); this.nextId = s.nextId; this.lastPhase = s.lastPhase;
    this.lastAscendYear = s.lastAscendYear; this.lastFestivalYear = s.lastFestivalYear; this.festivals = s.festivals; this.phase = s.phase;
  }

  private maxPerFarm(): number { return Math.max(1, Math.floor((LIVESTOCK.maxTotal[this.d.size] ?? 14) / Math.max(1, this.d.farms().length))); }

  /** Add/remove herds to match active farms. Call when buildings change (cheap). */
  sync(): void {
    // every built farm keeps its herd (an unconnected / closed farm used to have no animals at all, and a farm that became active later
    // got its herd only with the next building event)
    const farms = this.d.farms(), ids = new Set(farms.map((f) => f.id));
    this.animals = this.animals.filter((a) => ids.has(a.farm));
    const cap = this.maxPerFarm();
    for (const f of farms) {
      const have = this.animals.filter((a) => a.farm === f.id).length;
      if (have > 0) continue;
      const kinds: Array<'cow' | 'sheep' | 'goat'> = [];
      for (const k of ['cow', 'sheep', 'goat'] as const) for (let n = 0; n < LIVESTOCK.perFarm[k]; n++) kinds.push(k);
      const take = Math.min(cap, kinds.length);
      const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
      // interleave species so a cap keeps cows first, a bit of everything
      const order = take === kinds.length ? kinds : kinds.filter((_, i) => i % Math.ceil(kinds.length / take) === 0).slice(0, take);
      order.forEach((sp, k) => {
        const ang = (k / order.length) * Math.PI * 2;
        this.animals.push({ id: this.nextId++, species: sp, herd: f.id, leader: k === 0, x: cx, y: cy, tx: cx, ty: cy, heading: ang, flee: 0, hidden: true, phase: ang, farm: f.id });
      });
    }
  }

  /** Where the herd leaves / enters the barn: in front of the farm, kept inside the map (farms at the map edge used to spawn cows off-map: stuck forever). */
  private door(f: FarmRef): { x: number; y: number } {
    const N = this.d.size, lo = 1.5, hi = N - 2.5, cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const cands = [[cx, f.y + f.h + 0.6], [cx, f.y - 0.6], [f.x - 0.6, cy], [f.x + f.w + 0.6, cy]];
    for (const [x, y] of cands) if (x! >= lo && x! <= hi && y! >= lo && y! <= hi) return { x: x!, y: y! };
    return { x: Math.max(lo, Math.min(hi, cx)), y: Math.max(lo, Math.min(hi, f.y + f.h + 0.6)) };
  }

  private open(i: number): boolean {
    const g = this.d.grid;
    const t = g.tileType[i]!;
    return !isWaterType(t) && t !== TileType.Ice && t !== TileType.Rock && !(this.d.solid ?? this.d.blocked)(i) && this.d.stats.steep[i]! <= 1.8 && g.snowDepth[i]! < LIVESTOCK.snowFree;
  }

  /** Is (x,y) a tile cows may stand on (paths/pistes/buildings are crossed only along the way: allowed while travelling). */
  private pick(f: FarmRef, a: Critter, phase: HerdPhase): void {
    const N = this.d.size, R = phase === 'paddock' ? LIVESTOCK.paddock : LIVESTOCK.radius[N] ?? 12;
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const farmAlt = this.d.stats.alt[Math.min(N - 1, Math.floor(cy)) * N + Math.min(N - 1, Math.floor(cx))]!;
    let best = -1, bs = -1;
    for (let k = 0; k < 8; k++) {
      const r = 1.5 + this.rng.next() * R, ang = this.rng.next() * Math.PI * 2;
      const x = Math.floor(cx + Math.cos(ang) * r), y = Math.floor(cy + Math.sin(ang) * r);
      if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) continue;
      const i = y * N + x;
      if (!this.open(i)) continue;
      // transhumance: follow the snow-free meadows upwards once the herd is on the high pastures
      const up = phase === 'ascend' || phase === 'graze' ? Math.max(0, this.d.stats.alt[i]! - farmAlt) : 0;
      const s = 0.3 + 6 * up + this.rng.next() * 0.6 - (this.d.forest ? (this.d.forest[i]! / 255) * 1.6 : 0);
      if (s > bs) { bs = s; best = i; }
    }
    if (best >= 0) { a.tx = (best % N) + 0.5; a.ty = ((best / N) | 0) + 0.5; } else { const dr = this.door(f); a.tx = dr.x; a.ty = dr.y; }
  }

  update(tick: number, day: number, year: number): void {
    const phase = phaseFor(day);
    this.phase = phase;
    const farms = new Map(this.d.farms().map((f) => [f.id, f]));
    const gap = this.lastDay < 0 ? 0 : Math.min((day - this.lastDay + DAYS_PER_YEAR) % DAYS_PER_YEAR, (this.lastDay - day + DAYS_PER_YEAR) % DAYS_PER_YEAR);
    this.lastDay = day;
    if (gap > 3 && phase !== this.lastPhase) this.settle(phase, farms);
    if (phase !== this.lastPhase) {
      if (phase === 'ascend' && this.lastAscendYear !== year && this.animals.length) { this.lastAscendYear = year; this.d.news?.('The cows are heading up to the alpine pastures.'); }
      this.lastPhase = phase;
    }
    let arrived = 0, total = 0;
    const N = this.d.size;
    for (const a of this.animals) {
      const f = farms.get(a.farm);
      if (!f) continue;
      const door = this.door(f);
      if (phase === 'barn') { // walk to the barn door and disappear inside (the centre of the farm is a building tile: steps into it are refused)
        a.timer = Math.max(0, a.timer ?? 0) + 1;
        if (!a.hidden && (Math.hypot(a.x - door.x, a.y - door.y) < 1 || a.timer > 500)) a.hidden = true; // boxed in on the way: stop waiting after 500 ticks
        if (!a.hidden) { a.tx = door.x; a.ty = door.y; this.step(a, LIVESTOCK.travelSpeed, tick); }
        continue;
      }
      if (a.hidden) { if ((tick + a.id) % 40 === 0) { a.hidden = false; a.x = door.x; a.y = door.y; this.pick(f, a, phase); a.timer = 1; } else continue; }
      const dist = Math.hypot(a.tx - a.x, a.ty - a.y);
      if (phase === 'descend') {
        a.tx = door.x; a.ty = door.y; total++;
        if (Math.hypot(a.x - a.tx, a.y - a.ty) < 3) arrived++;
        this.step(a, LIVESTOCK.travelSpeed, tick);
        continue;
      }
      // timer: > 0 = ticks walking towards the current target, <= 0 = ticks left of the graze pause. A target that cannot be reached (boxed in by
      // buildings / water) used to be kept forever, which left whole herds standing at the barn door: give up after 700 ticks.
      const t = (a.timer ?? 1) + 1;
      a.timer = t;
      if (t === 0) { this.pick(f, a, phase); a.timer = 1; }
      else if (t > 0 && dist < 0.6) { a.timer = -(40 + Math.floor(this.rng.next() * 200)); a.mode = 0; }
      else if (t > 700) { this.pick(f, a, phase); a.timer = 1; }
      if (a.timer <= 0) { a.mode = 0; continue; }
      this.step(a, phase === 'ascend' ? LIVESTOCK.travelSpeed : LIVESTOCK.speed, tick);
    }
    // Almabtrieb: once most of the herd is home, one festival per year
    if (phase === 'descend' && total > 0 && arrived / total >= 0.6 && this.lastFestivalYear !== year) {
      this.lastFestivalYear = year; this.festivals++;
      this.d.news?.('Almabtrieb! The decorated cows are back from the alpine pastures. Guests love the parade.');
      for (const f of farms.values()) if (f.active) this.d.cheer?.(f.x + f.w / 2, f.y + f.h / 2, 14, LIVESTOCK.festivalHappiness);
    }
    void N;
  }

  /** Teleport every herd to where the calendar says it should be (after a date jump), without news or festival. */
  private settle(phase: HerdPhase, farms: Map<number, FarmRef>): void {
    for (const a of this.animals) {
      const f = farms.get(a.farm);
      if (!f) continue;
      const door = this.door(f);
      a.timer = 1;
      if (phase === 'barn') { a.hidden = true; a.x = door.x; a.y = door.y; continue; }
      a.hidden = false; a.x = door.x; a.y = door.y;
      this.pick(f, a, phase === 'descend' ? 'graze' : phase); // descending herds start up on the pasture
      a.x = a.tx; a.y = a.ty;
      a.timer = -(1 + Math.floor(this.rng.next() * 120));
    }
  }

  /** Step towards the target; when the straight line is blocked (water / building) try sidestepping by up to ~90 degrees before giving up. */
  private step(a: Critter, speed: number, tick: number): void {
    if ((tick + a.id) % 2) return;
    const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
    if (d < 0.05) { a.mode = 0; return; }
    const s = Math.min(speed * 2, d), N = this.d.size, base = Math.atan2(dy, dx);
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.7, -1.7]) {
      const ang = base + turn, nx = a.x + Math.cos(ang) * s, ny = a.y + Math.sin(ang) * s;
      if (nx < 1 || ny < 1 || nx >= N - 1 || ny >= N - 1) continue;
      const i = (ny | 0) * N + (nx | 0), t = this.d.grid.tileType[i]!;
      if (isWaterType(t) || (this.d.grid.occupancy.flags[i]! & 1)) continue; // water / building
      a.x = nx; a.y = ny; a.heading = ang; a.mode = 1;
      return;
    }
    a.tx = a.x; a.ty = a.y; a.mode = 0; // boxed in: re-pick a target next time
  }

  visibleCount(): number { return this.animals.filter((a) => !a.hidden).length; }
}
