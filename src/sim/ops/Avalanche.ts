import type { GameBus } from '../../core/events';
import { Rng } from '../../core/Rng';
import { CAL, HEIGHT_UNIT } from '../../config/balance';
import type { Coverage } from '../Coverage';
import { Sev, type Incidents, type SafetyGuestPort } from './Incidents';

/** Avalanche model (Task 26, rarity pass). Per-tile *instability* builds ONLY on steep (>= 1.5 half-steps/tile, 30-45 deg best) snowy tiles
 * while heavy fresh snow (>= freshMin, 48 h memory) is on the ground and it is cold (<= 2 deg C at the tile); warm-ups / rain-on-snow,
 * ungroomed + off-piste ground raise it, patrol cover, grooming and forests lower it. Releases are rare by construction: at most one
 * per day, a per-winter soft cap, a per-tile cooldown, and tiny slides are cosmetic sloughs (no event/closure/news). Patrol Hub control
 * blasting (04:00) releases unstable covered slopes in a controlled way (one event per night) and resets their instability. */
export const AVA = {
  /** Slope steepness (half-steps/tile) from which a tile can slide (>= 1.5 hs/tile = ~37 deg); the 30-45 deg band is the worst, steeper ground sloughs constantly and holds little snow. */
  minSlope: 0.75,
  /** Snow slabs only form on settled depth. */
  minDepth: 0.5,
  /** No avalanches above this tile temperature (deg C): warm days and the summer are safe. */
  maxTemp: 2,
  /** Fresh-snow memory per hour (about 48 h) and per-hour loading from snowfall intensity. */
  freshDecay: 0.985, freshLoad: 0.12,
  /** Fresh snow (48 h memory) needed before instability builds at all (about 12 h of heavy snowfall). */
  freshMin: 2.0,
  /** Instability gain per hour at full loading and slope factor. */
  gain: 0.008, settle: 0.98,
  groomedFactor: 0.2, pisteFactor: 0.5, offPisteFactor: 1.4,
  releaseRate: 0.000006,
  /** Patrol 'ski-cutting' on covered slopes: instability gain multiplier and release-chance multiplier. */
  coveredGain: 0.35, coveredRelease: 0.4,
  /** Tiles within this radius of a control release are stabilised too. */
  blastRelief: 4,
  blastHour: 4, blastThreshold: 0.9, blastMaxPerNight: 12, blastClosureTicks: 4,
  /** Closure (ticks, 10 = 1 h) of a notable slide: short; long only when guests were buried. */
  closureTicks: 80, buriedClosureTicks: 240, buriedSurvival: 15, buryChance: 0.85,
  /** An area that just slid cannot slide again for this many days. */
  cooldownDays: 6,
  /** Minimum days between two uncontrolled releases anywhere (a storm yields one slide, not a series). */
  minGapDays: 6,
  /** At most one uncontrolled release per game day; after `softCap` per winter the chance halves per extra release. */
  softCap: 2,
  /** Slides smaller than this that touch no piste and no guest are cosmetic sloughs (no event, closure or news). */
  microTiles: 12,
  /** At most one avalanche news item per this many days (buried guests always report). */
  newsGapDays: 3,
  /** A new winter starts after this many days without any release. */
  winterGapDays: Math.round(100 * CAL),
} as const;

/** Danger scale 1-5 of a backcountry route (Phase 6 Task 32, docs/backcountry.md): the route's instability score through FIXED thresholds. */
export const DANGER = {
  /** Score (0.7 x max + 0.3 x mean instability over the route's tiles) from which level 2, 3, 4 and 5 start. */
  thresholds: [0.15, 0.35, 0.6, 0.9] as readonly number[],
  maxWeight: 0.7,
  /** Routes close at this level (default setting; the player may override per route or globally). */
  closeAt: 4,
  /** A route closed by danger reopens once its score is below this (hysteresis: the level may flicker around a threshold). */
  reopenScore: 0.55,
  /** Off-piste guests (advanced skiers and boarders) only take open routes up to this level. */
  offPisteMax: 2,
} as const;
export const DANGER_NAMES = ['', 'Low', 'Moderate', 'Considerable', 'High', 'Very high'] as const;
/** 'Considerable (3)'. */
export const dangerText = (level: number): string => `${DANGER_NAMES[Math.max(1, Math.min(5, level))]} (${Math.max(1, Math.min(5, level))})`;

export interface AvalancheDeps {
  size: number;
  grid: { steepness(x: number, y: number): number; getCorners(x: number, y: number): readonly [number, number, number, number]; snowDepth: Float32Array };
  weather: { current: { intensity: number; kind: string; valleyT?: number }; temperatureAt(worldY: number, hour?: number): number };
  altitude: (x: number, y: number) => number;
  addSnow: (i: number, depth: number) => void;
  coverage: Coverage;
  isPiste?: (i: number) => boolean;
  isGroomed?: (i: number) => boolean;
  isWater?: (i: number) => boolean;
  /** 0..1 forest protection of a tile (dense mature trees lower the release risk by up to 60%). */
  forestProtection?: (i: number) => number;
  incidents: Incidents;
  guests: SafetyGuestPort;
  closeTiles?: (tiles: number[], reason: string, ticks: number) => void;
  bus?: Pick<GameBus, 'emit'>;
  news?: (msg: string) => void;
  seed?: number;
}

export interface Slide { tiles: number[]; tick: number; controlled: boolean; x: number; y: number; buried: number; micro?: boolean }

export class Avalanche {
  readonly inst: Float32Array;
  private cands: Int32Array = new Int32Array(0);
  private rng: Rng;
  fresh = 0;
  slides: Slide[] = [];
  /** Notable uncontrolled releases (events), cosmetic sloughs, controlled blasts, buried guests. */
  releases = 0; sloughs = 0; controlledReleases = 0; buriedTotal = 0;
  private lastHour = -1;
  private lastBlastDay = -1;
  private built = false;
  private tickInHour = 0;
  private curDay = 0;
  private dayCount = 0; private countDay = -1;
  private winterReleases = 0; private lastReleaseDay = -1e9;
  private lastNewsDay = -1e9;
  private tempEma: number | null = null; private rise = 0;
  /** tile -> day until which it cannot slide again. */
  private cool = new Map<number, number>();

  constructor(private d: AvalancheDeps) {
    this.inst = new Float32Array(d.size * d.size);
    this.rng = new Rng((d.seed ?? 1) ^ 0xa7a1);
  }

  /** Recompute the steep-tile candidate list (call after terraforming / on load). */
  rebuild(): void {
    const N = this.d.size, out: number[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (this.d.isWater?.(i)) continue;
      if (this.d.grid.steepness(x, y) * HEIGHT_UNIT >= AVA.minSlope) out.push(i);
    }
    this.cands = Int32Array.from(out);
    this.built = true;
  }
  get candidateCount(): number { if (!this.built) this.rebuild(); return this.cands.length; }

  /** 0 below 1.5 hs/tile; peaks in the 30-45 deg band, tapers on very steep (sluffing) ground. */
  private slopeFactor(i: number): number {
    const N = this.d.size, hs = this.d.grid.steepness(i % N, (i / N) | 0);
    if (hs < 1.5) return 0;
    if (hs <= 2.1) return 0.8 + (hs - 1.5) * (0.5 / 0.6);
    return Math.max(0.4, 1.3 - (hs - 2.1) * 0.9);
  }

  /** Danger score of a set of tiles: 0.7 x max + 0.3 x mean of the stored instability (0 on ground that cannot slide). */
  dangerScore(tiles: ReadonlyArray<number>): number {
    if (!tiles.length) return 0;
    let mx = 0, sum = 0;
    for (const i of tiles) { const v = this.inst[i] ?? 0; if (v > mx) mx = v; sum += v; }
    return DANGER.maxWeight * mx + (1 - DANGER.maxWeight) * (sum / tiles.length);
  }
  /** Danger level 1..5 of a route (anything with `tiles`), from the instability model. Rises after storms / heavy fresh snow / warming, falls after control blasting and with time. */
  dangerLevel(route: { tiles: ReadonlyArray<number> }): number { return this.levelOfScore(this.dangerScore(route.tiles)); }
  levelOfScore(score: number): number { let l = 1; for (const t of DANGER.thresholds) if (score >= t) l++; return l; }

  /** Mean risk (instability) over candidates, for UI / blasting decisions. */
  maxRisk(): number { let m = 0; for (const i of this.cands) if (this.inst[i]! > m) m = this.inst[i]!; return m; }
  hasControl(i: number): boolean { return this.d.coverage.map('patrol')[i]! > 0; }

  /** Release chance multiplier from the winter soft cap. */
  /** Scenario modifier: multiplier on the slab loading gain (1 = normal). */
  gainMult = 1;
  private capMult(): number { return this.winterReleases < AVA.softCap ? 1 : Math.pow(0.15, this.winterReleases - AVA.softCap + 1); }

  /**
   * Called once per sim tick with the clock; 10 ticks = 1 hour. Time-sliced: the candidate list is processed over the ticks of an hour.
   * `tickInHour` 0..9, `hour` 0..23, `day` absolute day.
   */
  update(tick: number, hour: number, tickInHour: number, day: number): void {
    if (!this.built) this.rebuild();
    const hi = Math.floor(hour), key = day * 24 + hi;
    this.curDay = day;
    if (day !== this.countDay) { this.countDay = day; this.dayCount = 0; }
    if (key !== this.lastHour) {
      this.lastHour = key; this.tickInHour = 0;
      const k = this.d.weather.current.kind;
      const snowing = this.d.weather.current.intensity > 0 && k !== 'rain' && k !== 'storm';
      this.fresh = this.fresh * AVA.freshDecay + (snowing ? AVA.freshLoad * this.d.weather.current.intensity : 0);
      if (k === 'rain' || k === 'storm') this.fresh += 0.03; // rain-on-snow loading
      // temperature rise against the ~day-long running mean (warm spell / foehn)
      const vt = this.d.weather.current.valleyT;
      if (vt !== undefined) { this.tempEma = this.tempEma === null ? vt : this.tempEma + (vt - this.tempEma) / 24; this.rise = Math.max(0, vt - this.tempEma); }
      if (day - this.lastReleaseDay > AVA.winterGapDays) this.winterReleases = 0;
    }
    const n = this.cands.length;
    const a = Math.floor((tickInHour * n) / 10), b = Math.floor(((tickInHour + 1) * n) / 10);
    const N = this.d.size, g = this.d.grid, cov = this.d.coverage.map('patrol');
    const k = this.d.weather.current.kind;
    const wet = k === 'rain' || k === 'storm' ? 2 : 1;
    const riseF = 1 + Math.min(1.5, this.rise * 0.3);
    const loaded = this.fresh >= AVA.freshMin;
    const excess = this.fresh - AVA.freshMin + 0.3;
    for (let q = a; q < b; q++) {
      const i = this.cands[q]!;
      const depth = g.snowDepth[i]!;
      let v = this.inst[i]! * AVA.settle;
      if (v > 0.001 || (loaded && depth >= AVA.minDepth)) {
        const T = this.d.weather.temperatureAt(this.d.altitude(i % N, (i / N) | 0));
        if (T > AVA.maxTemp) v = 0; // warm: wet snow settles / no slab
        else if (loaded && depth >= AVA.minDepth) {
          const t = this.d.isGroomed?.(i) ? AVA.groomedFactor : this.d.isPiste?.(i) ? AVA.pisteFactor : AVA.offPisteFactor;
          v += (cov[i]! > 0 ? AVA.coveredGain : 1) * AVA.gain * this.gainMult * excess * Math.min(2, depth) * this.slopeFactor(i) * t * wet * riseF * (T > -1 ? 1.3 : 1) * (1 - 0.75 * (this.d.forestProtection?.(i) ?? 0));
        }
      }
      if (v > 3) v = 3;
      this.inst[i] = v;
      if (v > 1 && this.dayCount < 1 && day - this.lastReleaseDay >= AVA.minGapDays && this.rng.chance(Math.min(0.5, (v - 1) * AVA.releaseRate * this.capMult() * (cov[i]! > 0 ? AVA.coveredRelease : 1))) && (this.cool.get(i) ?? -1) <= day) this.release(i, false, tick);
    }
    if (hi === AVA.blastHour && tickInHour === 0 && day !== this.lastBlastDay) { this.lastBlastDay = day; this.blast(tick); }
    this.slides = this.slides.filter((s) => tick - s.tick < 60);
  }

  /** Night control work: patrol-covered unstable slopes are released in a controlled way (one event / news row per night). */
  blast(tick: number): number {
    if (this.d.coverage.sources('patrol').length === 0) return 0;
    if (!this.built) this.rebuild();
    const cov = this.d.coverage.map('patrol');
    let done = 0;
    for (const i of this.cands) {
      if (done >= AVA.blastMaxPerNight) break;
      if (cov[i]! > 0 && this.inst[i]! >= AVA.blastThreshold) {
        const sl = this.release(i, true, tick, done === 0); done++;
        // the blast stabilises the surrounding unstable ground
        const N = this.d.size, R = AVA.blastRelief;
        for (const t of sl.tiles) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const x = (t % N) + dx, y = ((t / N) | 0) + dy;
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          const j = y * N + x;
          if (this.inst[j]! > 0.1) this.inst[j] = 0.1;
        }
      }
    }
    return done;
  }

  /** Downhill run-out from a start tile (deterministic: steepest neighbour, ties by scan order). */
  runout(start: number): number[] {
    const N = this.d.size, g = this.d.grid;
    const alt = (x: number, y: number): number => { const c = g.getCorners(x, y); return (c[0] + c[1] + c[2] + c[3]) / 4; };
    const wide = this.inst[start]! > 1.3; // only well-loaded slopes fan out into a real slab
    const path: number[] = [start];
    const set = new Set<number>([start]);
    let x = start % N, y = (start / N) | 0;
    // size follows the instability of the start tile: barely unstable ground only sloughs a few tiles, a fully loaded slope runs far
    const len = 2 + this.rng.int(0, 4) + Math.round(8 * Math.min(1, Math.max(0, this.inst[start]! - 1)));
    for (let s = 0; s < len; s++) {
      const a = alt(x, y);
      let bx = -1, by = -1, ba = a;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const na = alt(nx, ny);
        if (na < ba - 1e-6) { ba = na; bx = nx; by = ny; }
      }
      if (bx < 0) break;
      x = bx; y = by;
      const i = y * N + x;
      if (this.d.isWater?.(i)) break;
      if (!set.has(i)) { set.add(i); path.push(i); }
      // widen: lateral neighbours on every other step
      if (wide && s % 2 === 0) for (const [lx, ly] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const wx = x + lx, wy = y + ly;
        if (wx < 0 || wy < 0 || wx >= N || wy >= N) continue;
        const wi = wy * N + wx;
        if (!set.has(wi) && alt(wx, wy) <= a + 0.5 && !this.d.isWater?.(wi)) { set.add(wi); path.push(wi); }
      }
    }
    return path;
  }

  release(start: number, controlled: boolean, tick: number, emit = true): Slide {
    const N = this.d.size, tiles = this.runout(start);
    const sx = (start % N) + 0.5, sy = ((start / N) | 0) + 0.5;
    let buried = 0, hurt = 0;
    const onPiste = tiles.some((t) => this.d.isPiste?.(t));
    // guests in the path (uncontrolled slides only: control work happens at night on closed ground)
    const seen = new Set<number>();
    if (!controlled) for (const t of tiles) {
      const tx = t % N + 0.5, ty = ((t / N) | 0) + 0.5;
      for (const id of this.d.guests.near(tx, ty, 1.2, 'any')) { if (seen.has(id)) continue; seen.add(id); }
    }
    const micro = !controlled && tiles.length < AVA.microTiles && !onPiste && seen.size === 0;
    for (const t of tiles) {
      this.d.addSnow(t, controlled ? -0.2 : micro ? -0.25 : -0.45);
      this.inst[t] = controlled ? 0.1 : 0.15;
      if (!controlled) this.cool.set(t, this.curDay + AVA.cooldownDays);
    }
    if (this.cool.size > 6000) for (const [t, u] of this.cool) if (u <= this.curDay) this.cool.delete(t);
    if (micro) {
      this.sloughs++;
      const slide: Slide = { tiles, tick, controlled, x: sx, y: sy, buried: 0, micro: true };
      return slide; // cosmetic: no event, closure, counters or news
    }
    for (const id of seen) {
      const p = this.d.guests.position(id);
      if (!p) continue;
      if (this.rng.chance(AVA.buryChance)) {
        const inc = this.d.incidents.report('buried', p.x, p.y, Sev.Critical, id, { survival: AVA.buriedSurvival });
        if (inc) buried++;
      } else { this.d.incidents.report('injury', p.x, p.y, Sev.Minor, id); hurt++; }
    }
    void hurt;
    this.d.closeTiles?.(tiles, controlled ? 'Avalanche control' : 'Avalanche', controlled ? AVA.blastClosureTicks : buried > 0 ? AVA.buriedClosureTicks : AVA.closureTicks);
    const slide: Slide = { tiles, tick, controlled, x: sx, y: sy, buried };
    this.slides.push(slide);
    let quiet = !emit;
    if (controlled) this.controlledReleases++;
    else {
      this.releases++; this.buriedTotal += buried; this.dayCount++; this.winterReleases++; this.lastReleaseDay = this.curDay;
      if (buried === 0 && this.curDay - this.lastNewsDay < AVA.newsGapDays) quiet = true; else this.lastNewsDay = this.curDay;
    }
    if (emit || !controlled) this.d.bus?.emit('incident:avalanche', { x: sx, y: sy, severity: Math.min(3, Math.ceil(tiles.length / 8)), tiles: tiles.length, buried, controlled, ...(quiet ? { quiet: true } : {}) });
    if (!controlled && !quiet) this.d.news?.(buried > 0 ? `Avalanche! ${buried} skier${buried === 1 ? '' : 's'} trapped in the snow near (${Math.floor(sx)}, ${Math.floor(sy)})` : `Avalanche released near (${Math.floor(sx)}, ${Math.floor(sy)}); pistes closed`);
    return slide;
  }

  serialize(): unknown {
    return { rng: this.rng.getState(), fresh: this.fresh, inst: Array.from(this.inst.map((v) => Math.round(v * 100))), lastBlastDay: this.lastBlastDay, lastHour: this.lastHour,
      winterReleases: this.winterReleases, lastReleaseDay: this.lastReleaseDay, lastNewsDay: this.lastNewsDay, tempEma: this.tempEma, rise: this.rise, curDay: this.curDay, dayCount: this.dayCount, countDay: this.countDay, cool: Array.from(this.cool).flat() };
  }
  load(data: unknown): void {
    const s = data as { rng: number; fresh: number; inst: number[]; lastBlastDay: number; lastHour: number; winterReleases?: number; lastReleaseDay?: number; lastNewsDay?: number; tempEma?: number | null; rise?: number; curDay?: number; dayCount?: number; countDay?: number; cool?: number[] } | undefined;
    if (!s) return;
    this.rng.setState(s.rng); this.fresh = s.fresh; this.lastBlastDay = s.lastBlastDay; this.lastHour = s.lastHour;
    this.winterReleases = s.winterReleases ?? 0; this.lastReleaseDay = s.lastReleaseDay ?? -1e9; this.lastNewsDay = s.lastNewsDay ?? -1e9; this.tempEma = s.tempEma ?? null;
    this.rise = s.rise ?? 0; this.curDay = s.curDay ?? 0; this.dayCount = s.dayCount ?? 0; this.countDay = s.countDay ?? -1;
    this.cool.clear(); for (let k = 0; k + 1 < (s.cool?.length ?? 0); k += 2) this.cool.set(s.cool![k]!, s.cool![k + 1]!);
    for (let i = 0; i < this.inst.length; i++) this.inst[i] = (s.inst[i] ?? 0) / 100;
    this.built = false;
  }
  hash(): string {
    let h = 0x811c9dc5;
    const mix = (v: number): void => { h ^= v | 0; h = Math.imul(h, 0x01000193) >>> 0; };
    for (let i = 0; i < this.inst.length; i += 7) mix(Math.round(this.inst[i]! * 100));
    mix(this.releases); mix(this.sloughs); mix(this.controlledReleases); mix(this.buriedTotal); mix(this.rng.getState());
    return h.toString(16).padStart(8, '0');
  }
}
