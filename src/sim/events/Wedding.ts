import type { GameBus, SeasonId } from '../../core/events';
import { DAYS_PER_YEAR } from '../../config/balance';
import { WEDDING as W } from '../../config/wedding';
import { seasonOf, weekdayOf } from '../Clock';

/**
 * Chapel weddings (0.7.1, docs/chapel.md): a rare, seeded event. The SCHEDULE is a pure function of (seed, day); the WEDDING (positions, bell, feast) is a pure
 * function of one saved record and the clock, so save + reload is identical. Observer module in the save ('wedding'): the party is drawn by render/WeddingView,
 * the only sim effect is the small feast income and the news / bell events. Enabled only with autoEvents (off in the tutorial, the title demo and scenarios).
 */
const mix = (a: number, b: number, c: number): number => {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};
const u01 = (seed: number, day: number, k: number): number => mix(seed, day, k) / 4294967296;

export interface WeddingPlan { day: number; departHour: number; guests: number }
/** The wedding planned for absolute day `day` (year * DAYS_PER_YEAR + day), or null. Pure: same (seed, day) => same answer. Only on Saturdays (the calendar's weekday 5). */
export function weddingPlan(seed: number, day: number): WeddingPlan | null {
  const date = { year: Math.floor(day / DAYS_PER_YEAR), day: ((day % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR };
  if (weekdayOf(date) !== 5) return null;
  const season: SeasonId = seasonOf(date);
  if (u01(seed, day, 1) >= W.saturdayChance[season]) return null;
  const departHour = W.departHours[Math.floor(u01(seed, day, 2) * W.departHours.length)]!;
  const guests = W.partyMin + Math.floor(u01(seed, day, 3) * (W.partyMax - W.partyMin + 1));
  return { day, departHour, guests };
}

/** A walked route: flat [x0, y0, x1, y1, ...] tile-space points. */
export type Route = number[];
const routeLen = (r: Route): number => { let l = 0; for (let k = 2; k < r.length; k += 2) l += Math.hypot(r[k]! - r[k - 2]!, r[k + 1]! - r[k - 1]!); return l; };
/** The point at arc distance `d` along a route plus the local heading (dx, dy unit). */
function alongRoute(r: Route, d: number): { x: number; y: number; dx: number; dy: number } {
  let rest = Math.max(0, d), k = 2;
  for (; k < r.length; k += 2) {
    const ax = r[k - 2]!, ay = r[k - 1]!, bx = r[k]!, by = r[k + 1]!, len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-9) continue;
    if (rest <= len || k + 2 >= r.length) { const f = Math.min(1, rest / len); return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f, dx: (bx - ax) / len, dy: (by - ay) / len }; }
    rest -= len;
  }
  return { x: r[0] ?? 0, y: r[1] ?? 0, dx: 0, dy: 1 };
}

/**
 * The walking route between two points over the footpath / road network (4-neighbour BFS over tiles whose kind is 1 footpath, 2 road, or a level crossing),
 * from the path tile nearest to `a` to the path tile nearest to `b` (both within `snap` tiles). The route starts at `a` and ends at `b` themselves (the
 * doorstep stretches are the only off-path parts). Null when either end has no path nearby or the two are not connected. Pure and deterministic.
 */
export function routeOnPaths(kind: ArrayLike<number>, cross: ArrayLike<number> | undefined, size: number, a: { x: number; y: number }, b: { x: number; y: number }, snap = 6): Route | null {
  const isPath = (i: number): boolean => kind[i] === 1 || kind[i] === 2 || (kind[i] === 3 && (cross?.[i] ?? 0) > 0);
  const nearest = (p: { x: number; y: number }): number => {
    const px = Math.floor(p.x), py = Math.floor(p.y);
    let best = -1, bd = Infinity;
    for (let y = Math.max(0, py - snap); y <= Math.min(size - 1, py + snap); y++) for (let x = Math.max(0, px - snap); x <= Math.min(size - 1, px + snap); x++) {
      const i = y * size + x;
      if (!isPath(i)) continue;
      const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
      if (d < bd - 1e-9) { bd = d; best = i; }
    }
    return best;
  };
  const s = nearest(a), g = nearest(b);
  if (s < 0 || g < 0) return null;
  const prev = new Int32Array(size * size).fill(-2);
  prev[s] = -1;
  const q = [s];
  for (let h = 0; h < q.length && prev[g] === -2; h++) {
    const i = q[h]!, x = i % size, y = (i / size) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 1 ? 1 : k === 3 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 0 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      if (prev[ni] !== -2 || !isPath(ni)) continue;
      prev[ni] = i; q.push(ni);
    }
  }
  if (prev[g] === -2) return null;
  const tiles: number[] = [];
  for (let c = g; c !== -1; c = prev[c]!) tiles.push(c);
  tiles.reverse();
  const out: Route = [a.x, a.y];
  for (const t of tiles) out.push((t % size) + 0.5, ((t / size) | 0) + 0.5);
  out.push(b.x, b.y);
  return out;
}

export interface WeddingRec {
  day: number; guests: number;
  /** Walked routes over the footpath network (0.7.2): origin -> forecourt and forecourt -> feast (or back to the start); null = a straight line (no path / old save). */
  p1?: Route | null; p2?: Route | null;
  /** Where the party starts, the forecourt in front of the chapel door, the chapel centre, and the feast building centre (null = no lodge / restaurant in reach). */
  ox: number; oy: number; fx: number; fy: number; cx: number; cy: number; sx: number | null; sy: number | null;
  /** Absolute sim minutes: set out, arrived at the forecourt, first bell, second bell (end of the ceremony), arrived at the feast (or back at the start), gone. */
  tDepart: number; tArrive: number; tBell: number; tEnd: number; tFeast: number; tGone: number;
  bell1: boolean; bell2: boolean; held: boolean; paid: boolean; income: number;
}
export interface WeddingSave { last: number; count: number; rec: WeddingRec | null }

export type PartyMode = 'walk' | 'stand';
export interface PartyPose { x: number; y: number; yaw: number; mode: PartyMode; /** distance walked (gait phase) */ dist: number }

export interface WeddingDeps {
  seed: number; bus: Pick<GameBus, 'emit'>;
  /** Absolute sim minutes now. */
  now: () => number;
  /** The connected chapel (null = none, or not active). x / y / w / h are the rotated footprint; rot 0..3. */
  chapel: () => { x: number; y: number; w: number; h: number; rot: number } | null;
  /** Where the party comes from: the Base Lodge centre, or null (then it comes from the valley side of the chapel). */
  origin: () => { x: number; y: number } | null;
  /** Buildings that can serve the feast (lodge, cafe, pizzeria, base lodge), centres. */
  feastSites: () => Array<{ x: number; y: number }>;
  weather: () => string;
  /** Feast income (restaurants). */
  earn: (amount: number) => void;
  inBounds: (x: number, y: number) => boolean;
  /** Walking route over the footpath / road network between two points (null = none: the party then walks a straight line). Optional. */
  route?: (a: { x: number; y: number }, b: { x: number; y: number }) => Route | null;
  /** Diagnostics (a straight-line fallback is logged). Optional. */
  log?: (msg: string) => void;
}

const DIR: Array<[number, number]> = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // the door side (+z before rotation) for rot 0..3 (the mesh turns by -rot * 90 degrees)
const ceilHour = (t: number): number => Math.ceil(t / 60) * 60;

export class Wedding {
  enabled = true;
  last = -1; count = 0;
  rec: WeddingRec | null = null;
  constructor(private d: WeddingDeps) {}

  /** The door side of a chapel (unit vector in tile space) for a rotation. */
  static doorDir(rot: number): [number, number] { return DIR[((rot % 4) + 4) % 4]!; }
  /** The forecourt: the spot in front of the door where the party stands. */
  static forecourt(c: { x: number; y: number; w: number; h: number; rot: number }): { x: number; y: number } {
    const [dx, dy] = Wedding.doorDir(c.rot), half = (c.rot % 2 === 0 ? c.h : c.w) / 2;
    return { x: c.x + c.w / 2 + dx * (half + 0.9), y: c.y + c.h / 2 + dy * (half + 0.9) };
  }

  /** Called every sim hour. */
  onHour(): void {
    if (!this.enabled) return;
    const now = this.d.now(), r = this.rec;
    if (r) { this.progress(r, now); return; }
    const day = Math.floor(now / 1440);
    if (this.last >= day) return;
    const plan = weddingPlan(this.d.seed, day);
    if (!plan) { this.last = day; return; }
    const depart = day * 1440 + plan.departHour * 60;
    if (now < depart) return;
    this.last = day;
    if (now >= depart + 180) return; // too late today (a chapel built at noon waits for the next Saturday)
    if (W.badWeather.includes(this.d.weather())) return;
    this.start(plan, now);
  }

  /** Begin a wedding now (the schedule, or a debug / test force). False when there is no connected chapel. */
  start(plan: WeddingPlan, now = this.d.now()): boolean {
    const chapel = this.d.chapel();
    if (!chapel) return false;
    const fc = Wedding.forecourt(chapel), cx = chapel.x + chapel.w / 2, cy = chapel.y + chapel.h / 2;
    const [dx, dy] = Wedding.doorDir(chapel.rot);
    let o = this.d.origin();
    if (!o || Math.hypot(o.x - fc.x, o.y - fc.y) < 5 || Math.hypot(o.x - fc.x, o.y - fc.y) > W.originReach) {
      // no lodge close by: the party comes down the lane in front of the chapel, from the valley side
      let ox = fc.x + dx * 11, oy = fc.y + dy * 11;
      for (let k = 11; k > 4 && !this.d.inBounds(ox, oy); k--) { ox = fc.x + dx * k; oy = fc.y + dy * k; }
      o = { x: ox, y: oy };
    }
    let site: { x: number; y: number } | null = null, best: number = W.feastReach;
    for (const s of this.d.feastSites()) { const dd = Math.hypot(s.x - fc.x, s.y - fc.y); if (dd < best && dd > 2) { best = dd; site = s; } }
    const back0 = site ?? o;
    const p1 = this.d.route?.(o, fc) ?? null, p2 = this.d.route?.(fc, back0) ?? null;
    if (!p1) this.d.log?.('wedding: no footpath from the start to the chapel, the party walks a straight line');
    if (!p2) this.d.log?.('wedding: no footpath from the chapel to the feast, the party walks a straight line');
    const len1 = p1 ? routeLen(p1) : Math.hypot(o.x - fc.x, o.y - fc.y), len2 = p2 ? routeLen(p2) : Math.hypot(back0.x - fc.x, back0.y - fc.y);
    const walk1 = len1 / W.walkTilesPerMin;
    const tDepart = Math.min(now, plan.day * 1440 + plan.departHour * 60);
    const tArrive = tDepart + walk1, tBell = ceilHour(tArrive + 1), tEnd = tBell + W.ceremonyMin;
    const tFeast = ceilHour(tEnd + len2 / W.walkTilesPerMin);
    const tGone = site ? tFeast + W.feastMin : tFeast;
    this.rec = { day: plan.day, guests: plan.guests, p1, p2, ox: o.x, oy: o.y, fx: fc.x, fy: fc.y, cx, cy, sx: site ? site.x : null, sy: site ? site.y : null, tDepart, tArrive, tBell, tEnd, tFeast, tGone, bell1: false, bell2: false, held: false, paid: false, income: 0 };
    this.d.bus.emit('wedding:started', { x: cx, y: cy, guests: plan.guests });
    return true;
  }

  private progress(r: WeddingRec, now: number): void {
    const c = this.d.chapel();
    if (!c) { this.rec = null; return; } // the chapel was bulldozed (or lost its road): the party goes home
    const strikes = W.bellStrikes;
    if (!r.bell1 && now >= r.tBell) { r.bell1 = true; this.d.bus.emit('wedding:bell', { x: r.cx, y: r.cy, strikes }); }
    if (!r.bell2 && now >= r.tEnd) { r.bell2 = true; this.d.bus.emit('wedding:bell', { x: r.cx, y: r.cy, strikes }); }
    if (!r.held && now >= r.tEnd) { r.held = true; this.count++; this.d.bus.emit('wedding:held', { count: this.count }); }
    if (!r.paid && now >= r.tFeast) {
      r.paid = true;
      if (r.sx !== null && r.sy !== null) { r.income = r.guests * W.feastPerPerson; this.d.earn(r.income); this.d.bus.emit('wedding:feast', { x: r.sx, y: r.sy, income: r.income }); }
    }
    if (now >= r.tGone) this.rec = null;
  }

  /** Debug / test: a wedding right now (ignores the Saturday and the chance). */
  force(guests = 5): boolean {
    const now = this.d.now();
    return this.start({ day: Math.floor(now / 1440), departHour: Math.floor((now % 1440) / 60), guests }, now);
  }

  /** The party's n members at time `t`: null while nobody is outside (before the departure, inside the restaurant, gone). Pure of the record. */
  poseOf(i: number, t: number): PartyPose | null {
    const r = this.rec;
    if (!r || t < r.tDepart || t >= r.tGone) return null;
    const hasFeast = r.sx !== null && r.sy !== null;
    if (hasFeast && t >= r.tFeast) return null;
    // the party walks in single file along the route: the couple first, each follower a little further behind (small offsets along the path), a hair off the centre line
    const lat = (i % 2 === 0 ? -1 : 1) * 0.1 * (i > 1 ? 1 : 0.6), back = i * 0.32;
    const seg = (route: Route | null | undefined, ax: number, ay: number, bx: number, by: number, f: number): PartyPose => {
      const pts = route && route.length >= 4 ? route : [ax, ay, bx, by], L = routeLen(pts);
      const along = Math.min(L, Math.max(0, f * L - back)), p = alongRoute(pts, along);
      return { x: p.x - p.dy * lat, y: p.y + p.dx * lat, yaw: Math.atan2(p.dx, p.dy), mode: 'walk', dist: along };
    };
    if (t < r.tArrive) return seg(r.p1, r.ox, r.oy, r.fx, r.fy, (t - r.tDepart) / Math.max(1, r.tArrive - r.tDepart));
    if (t < r.tEnd) { // standing at the door: the couple in front, the guests in a loose arc behind, all facing the chapel
      const fx = r.cx - r.fx, fy = r.cy - r.fy, len = Math.max(1e-6, Math.hypot(fx, fy)), ux = fx / len, uy = fy / len; // toward the chapel
      const couple = i < 2, k = couple ? i - 0.5 : i - 2 - (r.guests - 3) / 2, depth = couple ? 0 : 0.5 + (i % 2) * 0.3, sp = couple ? 0.26 : 0.34;
      return { x: r.fx - ux * depth - uy * k * sp, y: r.fy - uy * depth + ux * k * sp, yaw: Math.atan2(ux, uy), mode: 'stand', dist: 0 };
    }
    const toX = hasFeast ? r.sx! : r.ox, toY = hasFeast ? r.sy! : r.oy;
    return seg(r.p2, r.fx, r.fy, toX, toY, (t - r.tEnd) / Math.max(1, r.tFeast - r.tEnd));
  }

  serialize(): WeddingSave { return { last: this.last, count: this.count, rec: this.rec ? { ...this.rec } : null }; }
  load(d: unknown): void {
    const s = d as Partial<WeddingSave> | null;
    this.last = typeof s?.last === 'number' ? s.last : -1; this.count = typeof s?.count === 'number' ? s.count : 0;
    this.rec = s?.rec && typeof s.rec === 'object' ? { ...(s.rec as WeddingRec) } : null;
  }
  reset(): void { this.last = -1; this.count = 0; this.rec = null; }
}

