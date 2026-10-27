import type { SeasonId } from '../../core/events';
import type { Grid } from '../../world/Grid';
import type { PropStore } from '../../world/Props';
import { Fauna, TerrainStats, SPECIES, type Critter } from './Fauna';
import { Livestock, LIVESTOCK, type FarmRef } from './Livestock';
import { ForestCover, GrowthTracker } from './Planting';
import { DAYS_PER_YEAR } from '../../config/balance';

export interface NatureDeps {
  size: 64 | 128 | 256;
  grid: Grid;
  props: PropStore;
  forest: Uint8Array;
  blocked: (i: number) => boolean;
  /** Livestock-only obstacle test (see LivestockDeps.solid). */
  solid?: (i: number) => boolean;
  farms: () => FarmRef[];
  /** Iterate alive guests' tile positions. */
  forEachGuest: (cb: (x: number, y: number, id: number) => void) => void;
  /** Raise a guest's happiness (0..1 scale) by `amount`. */
  bump: (id: number, amount: number) => void;
  /** Predators (ops/Wildlife); wolves drift towards deer in winter. */
  predators?: () => ReadonlyArray<{ kind: string; x: number; y: number; tx: number; ty: number; asleep: boolean }>;
  date: () => { year: number; day: number; minute: number };
  season: () => SeasonId;
  news?: (msg: string) => void;
  seed: number;
}

export const NATURE = {
  /** Guests within this many tiles of a visible animal may 'spot' it. */
  spotRadius: 5, spotHappiness: 0.01, spotCooldown: 300, maxSpotsPerRun: 24, viewEvery: 30,
  /** Restaurant revenue bonus per active farm outside winter, and its cap. */
  farmBonusEach: 0.04, farmBonusMax: 0.1,
  coverEvery: 600, cellSize: 4,
} as const;

/** Nature facade: fauna + livestock + forest cover + growth. Driven once per sim tick; everything inside is time-sliced. */
export class Nature {
  readonly stats: TerrainStats;
  readonly fauna: Fauna;
  readonly livestock: Livestock;
  readonly cover: ForestCover;
  readonly growth: GrowthTracker;
  /** Renderer hook: chunk indices whose props changed because of growth. */
  onPropChunks?: (chunks: number[]) => void;
  spots = 0; hunts = 0;
  private spotted = new Map<number, number>();
  private cells: Float32Array; private cellN: number; private cellCount: Uint16Array;
  private sceneryValue = 0.2;
  /** perf accounting (ms) */
  msTotal = 0; ticks = 0; msMax = 0;

  constructor(private d: NatureDeps) {
    this.stats = new TerrainStats(d.grid);
    this.cellN = Math.ceil(d.size / NATURE.cellSize);
    this.cells = new Float32Array(this.cellN * this.cellN * 2);
    this.cellCount = new Uint16Array(this.cellN * this.cellN);
    this.fauna = new Fauna({
      size: d.size, grid: d.grid, forest: d.forest, blocked: d.blocked, seed: d.seed,
      threat: (x, y, r) => this.threat(x, y, r),
    }, this.stats);
    this.livestock = new Livestock({
      size: d.size, grid: d.grid, stats: this.stats, blocked: d.blocked, forest: d.forest, ...(d.solid ? { solid: d.solid } : {}), farms: d.farms, seed: d.seed, news: d.news,
      cheer: (x, y, r, amount) => this.cheer(x, y, r, amount),
    });
    this.cover = new ForestCover(d.props);
    this.growth = new GrowthTracker(d.props);
  }

  /** Initial population (after worldgen / when terrain changes a lot). */
  init(): void {
    this.fauna.populate();
    this.cover.rebuild();
    this.growth.scan();
    this.livestock.sync();
    this.sceneryValue = this.computeScenery();
  }

  /** Save/load (Task 33): fauna, livestock, growth tracker + scenery counters. Cover is derived (rebuilt). */
  serialize(): unknown {
    return { fauna: this.fauna.serialize(), livestock: this.livestock.serialize(), growth: this.growth.serialize(), spots: this.spots, hunts: this.hunts, spotted: [...this.spotted], scenery: this.sceneryValue, now: this.d.props.now };
  }
  load(data: unknown): void {
    const s = data as { fauna: unknown; livestock: unknown; growth: { last: number }; spots: number; hunts: number; spotted: Array<[number, number]>; scenery: number; now: number };
    this.d.props.now = s.now;
    this.fauna.load(s.fauna); this.livestock.load(s.livestock); this.growth.load(s.growth);
    this.spots = s.spots; this.hunts = s.hunts; this.spotted = new Map(s.spotted); this.sceneryValue = s.scenery;
    this.cover.rebuild(); this.stats.rebuild();
    this.cellCount.fill(0); // the guest-position cache (animals flee from it) is not saved: empty it on load so a loaded game and a live one agree until the next rebuild (found by the autumn save/load determinism test after the calendar fix)
  }

  /** Call when buildings change (farms may have appeared/vanished). */
  farmsChanged(): void { this.livestock.sync(); }

  private threat(x: number, y: number, r: number): { x: number; y: number } | null {
    const cs = NATURE.cellSize, n = this.cellN, c0 = Math.max(0, Math.floor((x - r) / cs)), c1 = Math.min(n - 1, Math.floor((x + r) / cs));
    const r0 = Math.max(0, Math.floor((y - r) / cs)), r1 = Math.min(n - 1, Math.floor((y + r) / cs));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const k = cy * n + cx;
      if (!this.cellCount[k]) continue;
      const gx = this.cells[k * 2]!, gy = this.cells[k * 2 + 1]!;
      if ((gx - x) ** 2 + (gy - y) ** 2 <= r * r) return { x: gx, y: gy };
    }
    return null;
  }

  private rebuildCells(): void {
    this.cellCount.fill(0);
    const cs = NATURE.cellSize, n = this.cellN;
    this.d.forEachGuest((x, y) => {
      const k = Math.min(n - 1, Math.floor(y / cs)) * n + Math.min(n - 1, Math.floor(x / cs));
      this.cells[k * 2] = x; this.cells[k * 2 + 1] = y;
      this.cellCount[k]!++;
    });
  }

  private cheer(x: number, y: number, r: number, amount: number): number {
    let n = 0;
    this.d.forEachGuest((gx, gy, id) => { if ((gx - x) ** 2 + (gy - y) ** 2 <= r * r) { this.d.bump(id, amount); n++; } });
    return n;
  }

  private visible(): Critter[] {
    const out: Critter[] = [];
    for (const a of this.fauna.animals) if (!a.hidden) out.push(a);
    for (const a of this.livestock.animals) if (!a.hidden) out.push(a);
    return out;
  }

  private computeScenery(): number {
    const area = (this.d.size / 64) ** 2;
    const trees = Math.min(1, this.cover.treeShare() / 0.3);
    const wild = Math.min(1, this.fauna.animals.filter((a) => !a.hidden).reduce((s, a) => s + (SPECIES[a.species as keyof typeof SPECIES]?.scenic ?? 1), 0) / (14 * area));
    const farm = Math.min(1, this.livestock.visibleCount() / 10);
    return 0.5 * trees + 0.3 * wild + 0.2 * farm;
  }
  /** 0..1 scenery value for the Rating hook. */
  scenery(): number { return this.sceneryValue; }

  /** Restaurant income bonus from active farms outside winter (cheese & milk supply). */
  farmBonus(): number {
    if (this.d.season() === 'winter') return 0;
    const n = this.d.farms().filter((f) => f.active).length;
    return Math.min(NATURE.farmBonusMax, n * NATURE.farmBonusEach);
  }

  update(tick: number): void {
    const t0 = performance.now();
    const dt = this.d.date(), season = this.d.season(), hour = dt.minute / 60;
    if (tick % 5 === 0) this.rebuildCells();
    this.fauna.update(tick, season, hour);
    this.livestock.update(tick, dt.day, dt.year);
    if (tick % 10 === 0) {
      const dirty = this.growth.update(dt.year * DAYS_PER_YEAR + dt.day);
      if (dirty.length) { this.cover.dirty = true; this.onPropChunks?.(dirty); }
    }
    if (tick % NATURE.coverEvery === 0 || (this.cover.dirty && tick % 50 === 0)) { this.cover.rebuild(); this.sceneryValue = this.computeScenery(); }
    if (tick % NATURE.viewEvery === 0) this.viewing(tick);
    if (tick % 300 === 150) this.predation(season);
    const ms = performance.now() - t0;
    this.msTotal += ms; this.ticks++; if (ms > this.msMax) this.msMax = ms;
  }

  /** Guests near visible animals 'spot' them: tiny happiness boost with a per-guest cooldown (no news). */
  private viewing(tick: number): void {
    let budget = NATURE.maxSpotsPerRun;
    const vis = this.visible();
    const stride = Math.max(1, Math.floor(vis.length / 40));
    const r2 = NATURE.spotRadius ** 2;
    for (let k = (tick / NATURE.viewEvery) % stride; k < vis.length && budget > 0; k += stride) {
      const a = vis[k]!;
      this.d.forEachGuest((x, y, id) => {
        if (budget <= 0 || (x - a.x) ** 2 + (y - a.y) ** 2 > r2) return;
        if ((this.spotted.get(id) ?? -1e9) > tick - NATURE.spotCooldown) return;
        this.spotted.set(id, tick); budget--; this.spots++;
        this.d.bump(id, a.farm ? LIVESTOCK.farmHappiness : NATURE.spotHappiness);
      });
    }
    if (this.spotted.size > 2000) for (const [id, t] of this.spotted) if (t < tick - NATURE.spotCooldown) this.spotted.delete(id);
  }

  /** Winter: deer attract wolves; a wolf close to a herd scatters it (cosmetic hunt, no news). */
  private predation(season: SeasonId): void {
    const wolves = this.d.predators?.().filter((p) => p.kind === 'wolf' && !p.asleep) ?? [];
    if (!wolves.length) return;
    const deer = this.fauna.animals.filter((a) => a.species === 'deer' && a.leader && !a.hidden);
    for (const w of wolves) {
      let best: Critter | null = null, bd = Infinity;
      for (const dr of deer) { const d = Math.hypot(dr.x - w.x, dr.y - w.y); if (d < bd) { bd = d; best = dr; } }
      if (!best) continue;
      if (season === 'winter' && bd < 30 && bd > 3) { w.tx = best.x; w.ty = best.y; }
      if (bd < 6) { this.fauna.scare(best.herd, 20); this.hunts++; }
    }
  }

  summary(): { animals: number; livestock: number; hunts: number; spots: number; perTickMs: number; maxMs: number; scenery: number; forestShare: number } {
    return {
      animals: this.fauna.animals.length, livestock: this.livestock.animals.length, hunts: this.hunts, spots: this.spots,
      perTickMs: this.ticks ? this.msTotal / this.ticks : 0, maxMs: this.msMax, scenery: this.sceneryValue, forestShare: this.cover.treeShare(),
    };
  }
}
