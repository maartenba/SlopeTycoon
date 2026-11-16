import { RACE, type CourseReason } from '../../config/race';
import type { Run } from '../../world/Runs';
import type { RunSettings } from '../RunSettings';

/**
 * Race courses (0.8.0, docs/race-course.md). A course is a property of a RUN (`RunSettings.isCourse`, saved in the `runs` module): no tile layer, no migration.
 * This system derives everything else: validity (red / black, drop, not a loop, a Start Hut beside the top and a Timing Hut beside the foot), the gate line
 * (a pure function of the run), the quality that drives racer demand, and the racers' lap bookkeeping (saved in the `raceCourse` module, null while nothing happened).
 */
export interface HutRect { x: number; y: number; w: number; h: number }
export interface RaceDeps {
  size: number;
  runs(): readonly Run[];
  runId(r: Run): number;
  settings: RunSettings;
  /** Active, connected Start / Timing Huts (tile footprints). */
  startHuts(): readonly HutRect[];
  timingHuts(): readonly HutRect[];
  /** Is the run open to skiers right now (not closed by the player, the weather or a lack of snow)? */
  runOpen(r: Run): boolean;
  /** Days since a snowcat last groomed the run (null: never). */
  groomedDaysAgo(id: number): number | null;
  /** Absolute day number. */
  day(): number;
  /** Pay the course fee (dollars). */
  earn(amount: number): void;
}
export interface Gate { x: number; y: number; red: boolean; /** unit heading along the run (tile space) */ dx: number; dy: number }
export interface CourseInfo {
  id: number; run: Run; valid: boolean; reason: CourseReason | null; open: boolean;
  /** 0..1: grooming x difficulty fit. 0 when not valid / open. */
  quality: number;
  start: HutRect | null; timing: HutRect | null;
}
export interface RaceSaved { laps: Array<[number, number, number]>; total: number; day: number; today: number; best: Array<[number, number]> }

/** Gap in tiles between a footprint and a tile (0 = touching or inside). */
const gap = (h: HutRect, tx: number, ty: number): number => Math.max(h.x - tx - 1, tx - (h.x + h.w - 1) - 1, h.y - ty - 1, ty - (h.y + h.h - 1) - 1, 0);

/** The gate line of a run (pure): every N centre-line tiles, alternating sides, alternating colours, offset perpendicular to the local heading. */
export function courseGates(run: Run, size: number): Gate[] {
  const poly = run.poly, step = RACE.gateSpacing[run.difficulty] ?? 3, out: Gate[] = [];
  if (poly.length < 4) return out;
  for (let k = step; k < poly.length - 1; k += step) {
    const a = poly[Math.max(0, k - 1)]!, b = poly[Math.min(poly.length - 1, k + 1)]!, c = poly[k]!;
    let dx = (b % size) - (a % size), dy = ((b / size) | 0) - ((a / size) | 0);
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const side = (out.length & 1) ? 1 : -1;
    out.push({ x: (c % size) + 0.5 - dy * RACE.gateOffset * side, y: ((c / size) | 0) + 0.5 + dx * RACE.gateOffset * side, red: (out.length & 1) === 0, dx, dy });
  }
  return out;
}

const mix = (a: number, b: number): number => { let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** Laps a racer trains before leaving (a stable function of the guest id). */
export const lapQuota = (guestId: number): number => RACE.laps[0] + Math.floor(mix(guestId, 11) * (RACE.laps[1] - RACE.laps[0] + 1));

export class RaceCourse {
  private laps = new Map<number, [number, number]>(); // guest id -> [laps done, last fee day + 1]
  total = 0;
  private dayStamp = -1; private today = 0;
  private bestToday = new Map<number, number>();
  /** Bumps whenever a lap lands (UI caches). */
  version = 0;
  private cache: { key: string; runs: readonly Run[]; st: Array<{ id: number; run: Run; reason: CourseReason | null; start: HutRect | null; timing: HutRect | null }> } | null = null;
  constructor(private d: RaceDeps) {}

  private key(): string {
    const s = this.d.settings;
    return `${s.version}:${this.d.day()}:${this.d.startHuts().map((h) => `${h.x},${h.y}`).join(';')}|${this.d.timingHuts().map((h) => `${h.x},${h.y}`).join(';')}`;
  }

  /** Why a run cannot be a course right now (null = it can). Ignores the course count. */
  reasonFor(r: Run): CourseReason | null {
    if (r.loop || r.synthetic || r.poly.length < 4) return 'shape';
    if (r.difficulty < RACE.minDifficulty) return 'difficulty';
    if (r.dropM < RACE.minDropM) return 'drop';
    if (!this.hutNear(this.d.startHuts(), r, true)) return 'noStartHut';
    if (!this.hutNear(this.d.timingHuts(), r, false)) return 'noTimingHut';
    return null;
  }
  private hutNear(huts: readonly HutRect[], r: Run, top: boolean): HutRect | null {
    const n = RACE.endTiles, p = r.poly, tiles = top ? p.slice(0, n) : p.slice(Math.max(0, p.length - n));
    let best: HutRect | null = null, bg = Infinity;
    for (const h of huts) for (const t of tiles) { const g = gap(h, t % this.d.size, (t / this.d.size) | 0); if (g <= RACE.hutReach && g < bg) { bg = g; best = h; } }
    return best;
  }

  /** Mark / unmark a run. Switching on is refused with the reason; switching off always works. */
  setCourse(id: number, on: boolean): { ok: boolean; reason?: CourseReason } {
    const r = this.d.runs().find((x) => this.d.runId(x) === id);
    if (!r) return { ok: false };
    if (!on) { this.d.settings.setCourse(id, false); return { ok: true }; }
    if (this.d.settings.isCourse(id)) return { ok: true };
    const why = this.reasonFor(r);
    if (why) return { ok: false, reason: why };
    if (this.d.settings.courseIds().length >= RACE.maxCourses) return { ok: false, reason: 'tooMany' };
    this.d.settings.setCourse(id, true);
    return { ok: true };
  }

  /** Every marked course with its status. The structure (validity, huts) is cached per network / settings / hut / day; openness and quality are read live (a groom or a storm changes them mid-day). */
  courses(): readonly CourseInfo[] { return this.fresh().list; }
  private structure(): Array<{ id: number; run: Run; reason: CourseReason | null; start: HutRect | null; timing: HutRect | null }> {
    const key = this.key();
    if (this.cache && this.cache.key === key && this.cache.runs === this.d.runs()) return this.cache.st;
    const st: Array<{ id: number; run: Run; reason: CourseReason | null; start: HutRect | null; timing: HutRect | null }> = [];
    for (const r of this.d.runs()) {
      const id = this.d.runId(r);
      if (!this.d.settings.isCourse(id)) continue;
      const reason = this.reasonFor(r);
      st.push({ id, run: r, reason, start: reason === null ? this.hutNear(this.d.startHuts(), r, true) : null, timing: reason === null ? this.hutNear(this.d.timingHuts(), r, false) : null });
    }
    this.cache = { key, runs: this.d.runs(), st };
    return st;
  }
  private tilesCache: { sig: string; tiles: Set<number> } = { sig: '', tiles: new Set() };
  private fresh(): { list: CourseInfo[]; tiles: ReadonlySet<number> } {
    const list: CourseInfo[] = [];
    for (const c of this.structure()) {
      const valid = c.reason === null, open = valid && this.d.runOpen(c.run);
      const ago = this.d.groomedDaysAgo(c.id);
      const gq = ago === null ? RACE.groomQuality.ungroomed : ago <= 1 ? RACE.groomQuality.fresh : ago <= 2 ? RACE.groomQuality.stale : RACE.groomQuality.ungroomed;
      list.push({ id: c.id, run: c.run, valid, reason: c.reason, open, quality: open ? gq * (RACE.diffQuality[c.run.difficulty] ?? 0.8) : 0, start: c.start, timing: c.timing });
    }
    const sig = list.filter((c) => c.open).map((c) => c.id).join(',') + '|' + (this.cache?.key ?? '');
    if (this.tilesCache.sig !== sig) { const tiles = new Set<number>(); for (const c of list) if (c.open) for (const t of c.run.tiles) tiles.add(t); this.tilesCache = { sig, tiles }; }
    return { list, tiles: this.tilesCache.tiles };
  }
  /** Active (valid + open) courses. */
  active(): CourseInfo[] { return this.courses().filter((c) => c.open); }
  /** Tiles of the open courses (racers aim at them). */
  courseTiles(): ReadonlySet<number> { return this.fresh().tiles; }
  courseAt(tile: number): CourseInfo | undefined { return this.courses().find((c) => c.open && c.run.tiles.includes(tile)); }
  /** Arrival multiplier for the Racer type: summed quality of up to `maxCourses` courses; 0 without an open course or once the racers fill every course. */
  demand(racersAlive: number): number {
    const a = this.active().slice(0, RACE.maxCourses);
    if (!a.length || racersAlive >= a.length * RACE.maxRacersPerCourse) return 0;
    let q = 0; for (const c of a) q += c.quality;
    return q;
  }

  /** A racer reached the via tile on a course: count the lap, charge the fee on the first lap of the day. Returns true when the racer has trained enough and should leave. */
  onLap(guestId: number, tile: number): boolean {
    const c = this.courseAt(tile);
    if (!c) return false;
    const day = this.d.day();
    this.rollDay(day);
    const rec = this.laps.get(guestId) ?? [0, 0];
    rec[0]++; this.total++; this.version++;
    if (rec[1] !== day + 1) { rec[1] = day + 1; this.today++; this.d.earn(RACE.courseFee); }
    this.laps.set(guestId, rec);
    const ms = Math.round((c.run.lengthM / (RACE.boardMps * (0.85 + 0.3 * mix(guestId, rec[0] + 97)) * (0.9 + 0.1 * c.quality))) * 1000);
    const b = this.bestToday.get(c.id);
    if (b === undefined || ms < b) this.bestToday.set(c.id, ms);
    return rec[0] >= lapQuota(guestId);
  }
  private rollDay(day: number): void { if (day !== this.dayStamp) { this.dayStamp = day; this.today = 0; this.bestToday.clear(); } }
  racersToday(): number { return this.dayStamp === this.d.day() ? this.today : 0; }
  bestMs(courseId: number): number | null { return this.dayStamp === this.d.day() ? this.bestToday.get(courseId) ?? null : null; }
  lapsOf(guestId: number): number { return this.laps.get(guestId)?.[0] ?? 0; }
  /** Forget the lap records of guests that are gone (call on the day boundary). */
  prune(alive: (id: number) => boolean): void { for (const id of [...this.laps.keys()]) if (!alive(id)) this.laps.delete(id); }

  serialize(): RaceSaved | null {
    if (!this.laps.size && !this.total) return null;
    return { laps: [...this.laps].sort((a, b) => a[0] - b[0]).map(([id, v]) => [id, v[0], v[1]]), total: this.total, day: this.dayStamp, today: this.today, best: [...this.bestToday].sort((a, b) => a[0] - b[0]) };
  }
  load(d: Partial<RaceSaved> | null | undefined): void {
    this.laps = new Map((d?.laps ?? []).map(([id, n, f]) => [id, [n, f] as [number, number]]));
    this.total = d?.total ?? 0; this.dayStamp = d?.day ?? -1; this.today = d?.today ?? 0; this.bestToday = new Map(d?.best ?? []);
    this.cache = null; this.version++;
  }
  reset(): void { this.load(null); }
}
