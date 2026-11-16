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

export interface WeddingRec {
  day: number; guests: number;
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
    const walk1 = Math.hypot(o.x - fc.x, o.y - fc.y) / W.walkTilesPerMin;
    const tDepart = Math.min(now, plan.day * 1440 + plan.departHour * 60);
    const tArrive = tDepart + walk1, tBell = ceilHour(tArrive + 1), tEnd = tBell + W.ceremonyMin;
    const back = site ?? o, tFeast = ceilHour(tEnd + Math.hypot(back.x - fc.x, back.y - fc.y) / W.walkTilesPerMin);
    const tGone = site ? tFeast + W.feastMin : tFeast;
    this.rec = { day: plan.day, guests: plan.guests, ox: o.x, oy: o.y, fx: fc.x, fy: fc.y, cx, cy, sx: site ? site.x : null, sy: site ? site.y : null, tDepart, tArrive, tBell, tEnd, tFeast, tGone, bell1: false, bell2: false, held: false, paid: false, income: 0 };
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
    const lat = (i - (r.guests - 1) / 2) * 0.32, back = ((i * 7) % 3) * 0.22; // a loose group: spread across the walk and a little in depth
    const seg = (ax: number, ay: number, bx: number, by: number, f: number): PartyPose => {
      const dx = bx - ax, dy = by - ay, len = Math.max(1e-6, Math.hypot(dx, dy)), ux = dx / len, uy = dy / len;
      const along = Math.min(len, Math.max(0, f * len - back));
      return { x: ax + ux * along - uy * lat, y: ay + uy * along + ux * lat, yaw: Math.atan2(dx, dy), mode: 'walk', dist: along };
    };
    if (t < r.tArrive) return seg(r.ox, r.oy, r.fx, r.fy, (t - r.tDepart) / Math.max(1, r.tArrive - r.tDepart));
    if (t < r.tEnd) { // standing at the door: the couple in front, the guests in a loose arc behind, all facing the chapel
      const fx = r.cx - r.fx, fy = r.cy - r.fy, len = Math.max(1e-6, Math.hypot(fx, fy)), ux = fx / len, uy = fy / len; // toward the chapel
      const couple = i < 2, k = couple ? i - 0.5 : i - 2 - (r.guests - 3) / 2, depth = couple ? 0 : 0.5 + (i % 2) * 0.3, sp = couple ? 0.26 : 0.34;
      return { x: r.fx - ux * depth - uy * k * sp, y: r.fy - uy * depth + ux * k * sp, yaw: Math.atan2(ux, uy), mode: 'stand', dist: 0 };
    }
    const toX = hasFeast ? r.sx! : r.ox, toY = hasFeast ? r.sy! : r.oy;
    return seg(r.fx, r.fy, toX, toY, (t - r.tEnd) / Math.max(1, r.tFeast - r.tEnd));
  }

  serialize(): WeddingSave { return { last: this.last, count: this.count, rec: this.rec ? { ...this.rec } : null }; }
  load(d: unknown): void {
    const s = d as Partial<WeddingSave> | null;
    this.last = typeof s?.last === 'number' ? s.last : -1; this.count = typeof s?.count === 'number' ? s.count : 0;
    this.rec = s?.rec && typeof s.rec === 'object' ? { ...(s.rec as WeddingRec) } : null;
  }
  reset(): void { this.last = -1; this.count = 0; this.rec = null; }
}

