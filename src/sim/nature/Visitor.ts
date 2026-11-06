import type { GameBus } from '../../core/events';
import { Rng } from '../../core/Rng';
import { DAYS_PER_YEAR, HEIGHT_UNIT } from '../../config/balance';
import { VISITOR as V } from '../../config/visitor';
import { isWaterType, type Grid } from '../../world/Grid';

/** Rare high-country visitor: a pure schedule of (seed, year), one saved visit record, harmless. Observer state (not in stateHash). */
const mix = (a: number, b: number, c: number): number => {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};
const u01 = (seed: number, year: number, k: number): number => mix(seed, year, k) / 4294967296;

export interface VisitPlan { year: number; day: number; startMin: number; durMin: number }
/** The year's visit, or null. Pure: same (seed, year) => same answer. Minutes are absolute sim minutes (day = year * DAYS_PER_YEAR + day). */
export function visitPlan(seed: number, year: number): VisitPlan | null {
  if (u01(seed, year, 1) >= V.yearChance) return null;
  const day = V.dayMin + Math.floor(u01(seed, year, 2) * (V.dayMax - V.dayMin + 1));
  const hour = V.hourMin + Math.floor(u01(seed, year, 3) * (V.hourMax - V.hourMin + 1));
  const durMin = Math.round((V.durMinH + u01(seed, year, 4) * (V.durMaxH - V.durMinH)) * 60);
  return { year, day, startMin: (year * DAYS_PER_YEAR + day) * 1440 + hour * 60, durMin };
}

export interface Visit {
  year: number; startMin: number; durMin: number;
  /** Waypoints (tile coordinates, x then y). [0, 1] is where it is first seen. */
  path: number[];
  /** 'Show me' camera target (tiles). */
  fx: number; fy: number;
  ranger: boolean; left: boolean; followed: boolean;
}
export interface VisitorSave { last: number; count: number; /** Absolute sim minute the arrival boost ends (0 = none). */ buzzUntil?: number; visit: Visit | null; reacted: number[] }

export interface VisitorPose { x: number; y: number; yaw: number; alpha: number; phase: number }
export interface Print { x: number; y: number; yaw: number; side: 1 | -1 }

export interface VisitorDeps {
  size: 64 | 128 | 256; grid: Grid; seed: number; bus: Pick<GameBus, 'emit'>;
  /** Absolute sim minutes now. */
  now: () => number;
  /** Tiles to keep empty: buildings, paths, pistes (index y*size+x) and lift-line points. */
  blocked: (i: number) => boolean;
  liftPoints: () => Array<{ x: number; y: number }>;
  forest: Uint8Array;
  ranger: () => boolean;
  guests: (cb: (x: number, y: number, id: number) => void) => void;
  nudge: (id: number, delta: number) => void;
}

const CELL = 4;

export class Visitor {
  /** Off in the tutorial, the title demo and scenarios. */
  enabled = true;
  last = -1; count = 0;
  /** Absolute sim minute until which the sighting's arrival boost runs (saved; a pure function of when the sighting began). */
  buzzUntil = 0;
  visit: Visit | null = null;
  private reacted = new Set<number>();
  /** Debug / test: the spot override for the next forced start. */
  constructor(private d: VisitorDeps) {}

  // ---- schedule -------------------------------------------------------------------------------------------------------------------
  /** Called every sim hour. */
  onHour(): void {
    if (!this.enabled) return;
    const now = this.d.now(), year = Math.floor(now / 1440 / DAYS_PER_YEAR), v = this.visit;
    if (v) { this.progress(v, now); return; }
    if (this.last >= year) return;
    const plan = visitPlan(this.d.seed, year);
    if (!plan) { this.last = year; return; }
    if (now < plan.startMin) return;
    this.last = year;
    if (now < plan.startMin + plan.durMin * 0.5) this.start(plan, now);
  }

  private progress(v: Visit, now: number): void {
    const endMin = v.startMin + v.durMin;
    if (!v.left && now >= endMin) v.left = true;
    else if (!v.left) this.react(v, now);
    if (v.left && !v.followed && v.ranger && now >= endMin + V.followUpH * 60) { v.followed = true; this.d.bus.emit('visitor:followup', { x: v.path[0]!, y: v.path[1]!, tracks: this.d.seed % 2 === 0 ? 'footprints' : 'tracks' }); }
    if (now >= endMin + V.trackDays * 1440) { this.visit = null; this.reacted.clear(); }
  }

  /** Begin a visit now (the schedule, or a debug / test force). Returns false when no valid spot exists. */
  start(plan: VisitPlan, now = this.d.now()): boolean {
    const spot = this.findSpot(plan.year);
    if (!spot) return false;
    const rng = new Rng(mix(this.d.seed, plan.year, 77));
    const path = this.makePath(spot, rng);
    const [fx, fy] = this.focusFor(spot, path, rng);
    const v: Visit = { year: plan.year, startMin: Math.min(plan.startMin, now), durMin: plan.durMin, path, fx, fy, ranger: this.d.ranger(), left: false, followed: false };
    this.visit = v; this.count++; this.reacted.clear();
    if (now >= this.buzzUntil) this.buzzUntil = now + V.buzz.days * 1440; // one window per sighting: an overlapping second visit does not extend or stack it
    this.d.bus.emit('visitor:spotted', { x: spot.x, y: spot.y, fx, fy, ranger: v.ranger });
    return true;
  }
  /** Debug / test: start a visit right now at a valid spot (ignores the schedule, season and the year's slot). */
  force(durMin: number = Math.round((V.durMinH + V.durMaxH) * 30)): boolean {
    const now = this.d.now();
    return this.start({ year: Math.floor(now / 1440 / DAYS_PER_YEAR), day: 0, startMin: now, durMin }, now);
  }

  // ---- ground ---------------------------------------------------------------------------------------------------------------------
  private blockedGrid(): { cells: Uint8Array; w: number } {
    const N = this.d.size, w = Math.ceil(N / CELL), cells = new Uint8Array(w * w);
    for (let i = 0; i < N * N; i++) if (this.d.blocked(i)) cells[((((i / N) | 0) / CELL) | 0) * w + (((i % N) / CELL) | 0)] = 1;
    for (const p of this.d.liftPoints()) { const cx = Math.min(w - 1, Math.max(0, (p.x / CELL) | 0)), cy = Math.min(w - 1, Math.max(0, (p.y / CELL) | 0)); cells[cy * w + cx] = 1; }
    return { cells, w };
  }
  private altRange(): { lo: number; hi: number } {
    let lo = Infinity, hi = -Infinity; const h = this.d.grid.heights;
    for (let i = 0; i < h.length; i++) { const v = h[i]!; if (v < lo) lo = v; if (v > hi) hi = v; }
    return { lo: lo * HEIGHT_UNIT, hi: hi * HEIGHT_UNIT };
  }
  private tileOk(x: number, y: number): boolean {
    const g = this.d.grid, N = this.d.size;
    if (x < 3 || y < 3 || x >= N - 3 || y >= N - 3) return false;
    const i = y * N + x, t = g.tileType[i]!;
    return !isWaterType(t) && t !== 5 && !this.d.blocked(i) && this.d.forest[i]! < 100; // open ground: the walk can be seen from above
  }
  /** High, snowy ground at least `emptyR` tiles from anything built. Null = no valid spot (no visit this year). Prefers ground near trees. */
  findSpot(year: number): { x: number; y: number } | null {
    const N = this.d.size, g = this.d.grid, R = V.emptyR[N] ?? 10, rng = new Rng(mix(this.d.seed, year, 55));
    const { cells, w } = this.blockedGrid(), { lo, hi } = this.altRange();
    const rc = Math.ceil(R / CELL) + 1;
    for (const frac of [V.altFrac, V.altFracLow]) { // high ground first; lower slopes only when the high ground is all built over
      const r = this.scan(rng, N, g, cells, w, rc, R, lo + (hi - lo) * frac);
      if (r) return r;
    }
    return null;
  }
  private scan(rng: Rng, N: number, g: Grid, cells: Uint8Array, w: number, rc: number, R: number, minAlt: number): { x: number; y: number } | null {
    let best: { x: number; y: number; score: number } | null = null, found = 0;
    for (let a = 0; a < V.attempts && found < 6; a++) {
      const x = rng.int(14, N - 15), y = rng.int(14, N - 15); // away from the map edge: the camera has to be able to look there
      if (!this.tileOk(x, y) || g.snowDepth[y * N + x]! < V.minSnow) continue;
      const [c0, c1, c2, c3] = g.getCorners(x, y);
      if (((c0 + c1 + c2 + c3) / 4) * HEIGHT_UNIT < minAlt) continue;
      const cx = (x / CELL) | 0, cy = (y / CELL) | 0;
      let clear = true;
      for (let yy = Math.max(0, cy - rc); yy <= Math.min(w - 1, cy + rc) && clear; yy++) for (let xx = Math.max(0, cx - rc); xx <= Math.min(w - 1, cx + rc); xx++) if (cells[yy * w + xx] && Math.hypot((xx + 0.5) * CELL - x, (yy + 0.5) * CELL - y) < R + CELL * 0.7) { clear = false; break; }
      if (!clear) continue;
      found++;
      // a treeline: some trees close by (about a fifth of the neighbourhood), never a thick forest
      let trees = 0;
      for (let yy = y - 5; yy <= y + 5; yy++) for (let xx = x - 5; xx <= x + 5; xx++) if (xx >= 0 && yy >= 0 && xx < N && yy < N && this.d.forest[yy * N + xx]! > 120) trees++;
      const score = -Math.abs(trees - 24);
      if (!best || score > best.score) best = { x, y, score };
    }
    return best ? { x: best.x, y: best.y } : null;
  }
  private makePath(spot: { x: number; y: number }, rng: Rng): number[] {
    const path = [spot.x + 0.5, spot.y + 0.5];
    let x = spot.x + 0.5, y = spot.y + 0.5, a = rng.next() * Math.PI * 2;
    for (let k = 0; k < V.steps; k++) {
      for (let tries = 0; tries < 8; tries++) {
        const aa = a + (rng.next() - 0.5) * 1.6, len = V.stepMin + rng.next() * (V.stepMax - V.stepMin);
        const nx = x + Math.cos(aa) * len, ny = y + Math.sin(aa) * len;
        if (Math.hypot(nx - spot.x - 0.5, ny - spot.y - 0.5) > V.wanderR || !this.tileOk(Math.floor(nx), Math.floor(ny))) continue;
        x = nx; y = ny; a = aa; path.push(x, y); break;
      }
    }
    if (path.length < 6) path.push(spot.x + 0.5 + 1.5, spot.y + 0.5 + 1); // always at least a short walk
    return path;
  }
  /** Camera target: 6-12 tiles from where it was first seen (never on the walk). */
  private focusFor(spot: { x: number; y: number }, path: number[], rng: Rng): [number, number] {
    const N = this.d.size, a0 = rng.next() * Math.PI * 2, dist = V.showMe.min + rng.next() * (V.showMe.max - V.showMe.min);
    let fb: [number, number] = [spot.x + 0.5, spot.y + 0.5 + V.showMe.min];
    for (let k = 0; k < 16; k++) {
      const a = a0 + (k * Math.PI * 2) / 16, fx = spot.x + 0.5 + Math.cos(a) * dist, fy = spot.y + 0.5 + Math.sin(a) * dist;
      if (fx < 4 || fy < 4 || fx > N - 4 || fy > N - 4) continue;
      let mn = Infinity;
      for (let i = 0; i < path.length; i += 2) mn = Math.min(mn, Math.hypot(path[i]! - fx, path[i + 1]! - fy));
      if (mn >= 2) return [fx, fy];
      fb = [fx, fy];
    }
    return fb;
  }

  // ---- reaction -------------------------------------------------------------------------------------------------------------------
  private react(v: Visit, now: number): void {
    const p = this.poseAt(now);
    if (!p || p.alpha < 0.5) return;
    this.d.guests((x, y, id) => {
      if ((x - p.x) ** 2 + (y - p.y) ** 2 > V.reactR * V.reactR || this.reacted.has(id)) return;
      this.reacted.add(id);
      this.d.nudge(id, mix(id, v.year, 9) % 5 === 0 ? -V.fright : V.cheer);
    });
  }

  // ---- queries (render / UI) -------------------------------------------------------------------------------------------------------
  private lengths(v: Visit): { cum: number[]; total: number } {
    const cum = [0];
    for (let i = 2; i < v.path.length; i += 2) cum.push(cum[cum.length - 1]! + Math.hypot(v.path[i]! - v.path[i - 2]!, v.path[i + 1]! - v.path[i - 1]!));
    return { cum, total: cum[cum.length - 1]! };
  }
  private distAt(v: Visit, t: number): number { return Math.min(1, Math.max(0, (t - v.startMin) / v.durMin)) * this.lengths(v).total; }
  private pointAt(v: Visit, d: number): { x: number; y: number; yaw: number } {
    const { cum } = this.lengths(v);
    let i = 1; while (i < cum.length - 1 && cum[i]! < d) i++;
    const s = cum[i]! - cum[i - 1]!, f = s > 0 ? Math.min(1, Math.max(0, (d - cum[i - 1]!) / s)) : 0;
    const ax = v.path[(i - 1) * 2]!, ay = v.path[(i - 1) * 2 + 1]!, bx = v.path[i * 2]!, by = v.path[i * 2 + 1]!;
    return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f, yaw: Math.atan2(bx - ax, by - ay) };
  }
  /** Where it is at absolute minute `t` (null when not around). Yaw 0 faces +y (world +z). */
  poseAt(t = this.d.now()): VisitorPose | null {
    const v = this.visit;
    if (!v || !this.enabled || v.left || t < v.startMin) return null;
    const end = v.startMin + v.durMin, d = this.distAt(v, t), p = this.pointAt(v, d);
    const alpha = Math.min(1, (t - v.startMin) / V.fadeIn, (end - t) / V.fadeOut);
    return alpha <= 0 ? null : { x: p.x, y: p.y, yaw: p.yaw, alpha, phase: d * 2.2 };
  }
  /** Footprints in the snow: a lead-in trail, then the steps taken so far; fades over the last quarter of `trackDays`. */
  prints(t = this.d.now()): { list: Print[]; alpha: number } {
    const v = this.visit;
    if (!v || !this.enabled || t < v.startMin) return { list: [], alpha: 0 };
    const endMin = v.startMin + v.durMin, left = t >= endMin;
    const age = left ? (t - endMin) / (V.trackDays * 1440) : 0, alpha = age < 0.7 ? 1 : Math.max(0, 1 - (age - 0.7) / 0.3);
    if (alpha <= 0) return { list: [], alpha: 0 };
    const list: Print[] = [], N = this.d.size;
    const { total } = this.lengths(v), dist = left ? total : this.distAt(v, t);
    // lead-in: it came from somewhere up the slope
    const first = this.pointAt(v, 0), nxt = this.pointAt(v, Math.min(0.5, total)), hx = Math.sin(first.yaw), hy = Math.cos(first.yaw);
    void nxt;
    const back = (mix(this.d.seed, v.year, 31) % 2 === 0 ? 1 : -1) * 0.6, ba = Math.atan2(hx, hy) + Math.PI + back, bx = Math.sin(ba), by = Math.cos(ba);
    let side: 1 | -1 = 1;
    for (let s = V.leadIn; s > 0; s -= V.printGap) {
      const x = first.x + bx * s, y = first.y + by * s;
      if (x < 1 || y < 1 || x > N - 1 || y > N - 1) continue;
      list.push({ x: x + Math.cos(ba) * 0.12 * side, y: y - Math.sin(ba) * 0.12 * side, yaw: ba + Math.PI, side }); side = side === 1 ? -1 : 1;
    }
    for (let s = 0; s <= dist; s += V.printGap) {
      const p = this.pointAt(v, s);
      list.push({ x: p.x + Math.cos(p.yaw) * 0.12 * side, y: p.y - Math.sin(p.yaw) * 0.12 * side, yaw: p.yaw, side }); side = side === 1 ? -1 : 1;
    }
    return { list, alpha };
  }
  /** Tile to show on the minimap-ish / ping; the first-seen point. */
  seenAt(): { x: number; y: number } | null { const v = this.visit; return v ? { x: v.path[0]!, y: v.path[1]! } : null; }
  /** True while it is out walking (for the stateful observers: sound, photo, spotted). */
  active(t = this.d.now()): boolean { return !!this.poseAt(t); }

  /** Arrival multiplier while the sighting's buzz runs (1 otherwise and whenever the visitor is disabled). */
  buzzMult(t = this.d.now()): number { return this.enabled && t < this.buzzUntil ? V.buzz.mult : 1; }
  /** Whole sim days left of the buzz (0 = none). */
  buzzDaysLeft(t = this.d.now()): number { return this.enabled && t < this.buzzUntil ? Math.ceil((this.buzzUntil - t) / 1440) : 0; }

  // ---- save -----------------------------------------------------------------------------------------------------------------------
  serialize(): VisitorSave { return { last: this.last, count: this.count, buzzUntil: this.buzzUntil, visit: this.visit ? { ...this.visit, path: [...this.visit.path] } : null, reacted: [...this.reacted] }; }
  load(d: unknown): void {
    const s = (d ?? {}) as Partial<VisitorSave>;
    this.last = Number.isFinite(s.last) ? s.last! : -1; this.count = Number.isFinite(s.count) ? s.count! : 0;
    this.buzzUntil = Number.isFinite(s.buzzUntil) ? s.buzzUntil! : 0;
    const v = s.visit;
    this.visit = v && Array.isArray(v.path) && v.path.length >= 4 && Number.isFinite(v.startMin) ? { ...v, path: v.path.map(Number) } : null;
    this.reacted = new Set(Array.isArray(s.reacted) ? s.reacted.map(Number) : []);
  }
  reset(): void { this.last = -1; this.count = 0; this.buzzUntil = 0; this.visit = null; this.reacted.clear(); }
}
