import { RACE, type CourseReason } from '../../config/race';
import type { Run } from '../../world/Runs';
import type { RunSettings } from '../RunSettings';

/**
 * Race courses (0.8.0, docs/race-course.md). A course is a property of a RUN (`RunSettings.isCourse`, saved in the `runs` module): no tile layer, no migration.
 * This system derives everything else: validity (red / black, drop, not a loop, a Start Hut beside the top and a Timing Hut beside the foot), the gate line
 * (a pure function of the run), the quality that drives racer demand, and the racers' lap bookkeeping (saved in the `raceCourse` module, null while nothing happened).
 */
export interface HutRect { x: number; y: number; w: number; h: number; /** quarter turns (the Timing Hut's board faces along it) */ rot?: number }
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
  /** 0.8.2: the MTB trails as runs (a second run index over the Mtb layer), their openness (every tile bikeable) and the trail pass price paid by the rider is not here. Absent = no summer courses. */
  mtbRuns?(): readonly Run[];
  mtbOpen?(r: Run): boolean;
  /** Can a rider get from a bike lift to this course start tile? Structural (trails / paths, downhill or flat, snow ignored) and, while the course is open, also a real bike path search. Absent = yes. */
  mtbReach?(starts: readonly number[], open: boolean): boolean;
  /** Absolute day number. */
  day(): number;
  /** Pay the course fee (dollars). */
  earn(amount: number): void;
}
export interface Gate { x: number; y: number; red: boolean; /** unit heading along the run (tile space) */ dx: number; dy: number }
export interface CourseInfo {
  id: number; run: Run; valid: boolean; reason: CourseReason | null; open: boolean;
  /** A MTB trail downhill course (0.8.2, summer) instead of a ski run (winter). */
  mtb: boolean;
  /** A valid downhill course no bike lift reaches (the reason text); null = usable. Such a course draws no downhillers. */
  blocked: string | null;
  /** 0..1: grooming x difficulty fit. 0 when not valid / open. */
  quality: number;
  start: HutRect | null; timing: HutRect | null;
}
export interface RaceSaved { laps: Array<[number, number, number]>; total: number; day: number; today: number; best: Array<[number, number]>; /** 0.8.2: riders of the day on the downhill courses (absent while 0) */ todayMtb?: number; /** 0.8.2: the stable number of each downhill course, [course id, n] (absent while none) */ mtbNo?: Array<[number, number]> }

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

/** m:ss.t */
export const fmtTime = (ms: number): string => { const t = Math.round(ms / 100), m = Math.floor(t / 600), s = (t % 600) / 10; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
const mix = (a: number, b: number): number => { let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** Laps a racer trains before leaving (a stable function of the guest id). */
export const lapQuota = (guestId: number, mtb = false): number => { const L = mtb ? RACE.mtb.laps : RACE.laps; return L[0] + Math.floor(mix(guestId, 11) * (L[1] - L[0] + 1)); };

const NO_RUNS: readonly Run[] = [];
/** A placeholder run for a downhill course whose trail is gone (never drawn, never open). */
const ghostRun = (tile: number): Run => ({ index: -1, tiles: [tile], count: 1, poly: [tile], from: -1, to: -1, top: { x: 0, y: 0 }, bottom: { x: 0, y: 0 }, topAlt: 0, bottomAlt: 0, lengthM: 0, dropM: 0, avgSlopePct: 0, maxSlopePct: 0, difficulty: 1, loop: false, synthetic: true, disconnected: false });

export class RaceCourse {
  private laps = new Map<number, [number, number]>(); // guest id -> [laps done, last fee day + 1]
  total = 0;
  private dayStamp = -1; private today = 0; private todayMtb = 0;
  private bestToday = new Map<number, number>();
  /** Bumps whenever a lap lands (UI caches). */
  version = 0;
  private cache: { key: string; runs: readonly Run[]; mruns: readonly Run[]; st: Array<{ id: number; run: Run; mtb: boolean; reason: CourseReason | null; start: HutRect | null; timing: HutRect | null }> } | null = null;
  constructor(private d: RaceDeps) {}

  private key(): string {
    const s = this.d.settings;
    return `${s.version}:${this.d.day()}:${this.d.startHuts().map((h) => `${h.x},${h.y}`).join(';')}|${this.d.timingHuts().map((h) => `${h.x},${h.y}`).join(';')}`;
  }

  /** Why a run cannot be a course right now (null = it can). Ignores the course count. */
  isMtb(r: Run): boolean { return !!this.d.mtbRuns && this.d.mtbRuns().includes(r); }
  /** The persistent course id of a run: ski runs use their `runId`; a MTB trail uses the stored anchor tile that is still on it, else the middle of its centre line. */
  idOf(r: Run): number {
    if (!this.isMtb(r)) return this.d.runId(r);
    const base = RACE.mtb.idBase;
    for (const a of this.d.settings.courseIds()) if (a >= base && r.tiles.includes(a - base)) return a;
    return base + (r.poly[r.poly.length >> 1] ?? r.tiles[0]!);
  }
  reasonFor(r: Run): CourseReason | null {
    if (r.loop || r.synthetic || r.poly.length < 4) return 'shape';
    if (r.difficulty < RACE.minDifficulty) return 'difficulty';
    if (r.dropM < RACE.minDropM) return 'drop';
    if (!this.hutNear(this.d.startHuts(), r, true)) return 'noStartHut';
    if (!this.hutNear(this.d.timingHuts(), r, false)) return 'noTimingHut';
    return null;
  }
  /**
   * The run (or MTB trail) that just misses the minimum drop (`RACE.nearMissM` below `RACE.minDropM`) while a Start / Timing Hut already stands at its top / foot, biggest drop first;
   * null when none. A pure read (Rudi's `race.course.short`): never marks anything, never allocates a course number.
   */
  nearMiss(): { run: Run; mtb: boolean } | null {
    let best: { run: Run; mtb: boolean } | null = null;
    const all: Array<{ run: Run; mtb: boolean }> = [...this.d.runs().map((run) => ({ run, mtb: false })), ...(this.d.mtbRuns?.() ?? NO_RUNS).map((run) => ({ run, mtb: true }))];
    for (const c of all) {
      const r = c.run;
      if (r.loop || r.synthetic || r.poly.length < 4 || r.difficulty < RACE.minDifficulty || r.dropM >= RACE.minDropM || r.dropM < RACE.minDropM - RACE.nearMissM) continue;
      if (this.d.settings.isCourse(c.mtb ? this.idOf(r) : this.d.runId(r))) continue;
      if (!this.hutNear(this.d.startHuts(), r, true) && !this.hutNear(this.d.timingHuts(), r, false)) continue;
      if (!best || r.dropM > best.run.dropM) best = c;
    }
    return best;
  }
  private hutNear(huts: readonly HutRect[], r: Run, top: boolean): HutRect | null {
    const n = RACE.endTiles, p = r.poly, tiles = top ? p.slice(0, n) : p.slice(Math.max(0, p.length - n));
    let best: HutRect | null = null, bg = Infinity;
    for (const h of huts) for (const t of tiles) { const g = gap(h, t % this.d.size, (t / this.d.size) | 0); if (g <= RACE.hutReach && g < bg) { bg = g; best = h; } }
    return best;
  }

  /** Mark / unmark a run. Switching on is refused with the reason; switching off always works. */
  setCourse(id: number, on: boolean): { ok: boolean; reason?: CourseReason } {
    const r = this.d.runs().find((x) => this.d.runId(x) === id) ?? (this.d.mtbRuns?.() ?? []).find((x) => this.idOf(x) === id);
    if (!r) { if (!on && id >= RACE.mtb.idBase && this.d.settings.setCourse(id, false)) { this.mtbNo.delete(id); return { ok: true }; } return on && id >= RACE.mtb.idBase ? { ok: false, reason: 'gone' } : { ok: false }; }
    const mtb = this.isMtb(r);
    if (!on) { this.d.settings.setCourse(id, false); this.mtbNo.delete(id); return { ok: true }; }
    if (this.d.settings.isCourse(id)) return { ok: true };
    const why = this.reasonFor(r);
    if (why) return { ok: false, reason: why };
    if (this.courses().filter((c) => c.mtb === mtb).length >= RACE.maxCourses) return { ok: false, reason: 'tooMany' };
    this.d.settings.setCourse(id, true);
    if (mtb) this.numberOf(id);
    return { ok: true };
  }

  /** Every marked course with its status. The structure (validity, huts) is cached per network / settings / hut / day; openness and quality are read live (a groom or a storm changes them mid-day). */
  courses(): readonly CourseInfo[] { return this.fresh().list; }
  private structure(): Array<{ id: number; run: Run; mtb: boolean; reason: CourseReason | null; start: HutRect | null; timing: HutRect | null }> {
    const key = this.key(), mruns = this.d.mtbRuns?.() ?? NO_RUNS;
    if (this.cache && this.cache.key === key && this.cache.runs === this.d.runs() && this.cache.mruns === mruns) return this.cache.st;
    const st: Array<{ id: number; run: Run; mtb: boolean; reason: CourseReason | null; start: HutRect | null; timing: HutRect | null }> = [];
    for (const r of this.d.runs()) {
      const id = this.d.runId(r);
      if (!this.d.settings.isCourse(id)) continue;
      const reason = this.reasonFor(r);
      st.push({ id, run: r, mtb: false, reason, start: reason === null ? this.hutNear(this.d.startHuts(), r, true) : null, timing: reason === null ? this.hutNear(this.d.timingHuts(), r, false) : null });
    }
    for (const r of mruns) {
      const id = this.idOf(r);
      if (!this.d.settings.isCourse(id)) continue;
      const reason = this.reasonFor(r);
      st.push({ id, run: r, mtb: true, reason, start: reason === null ? this.hutNear(this.d.startHuts(), r, true) : null, timing: reason === null ? this.hutNear(this.d.timingHuts(), r, false) : null });
    }
    // a marked downhill course whose trail is gone (no run holds its anchor tile any more): inactive with a reason, never silently dropped; it returns when the trail does
    if (this.d.mtbRuns) for (const id of this.d.settings.courseIds()) {
      if (id < RACE.mtb.idBase || st.some((c) => c.id === id)) continue;
      const t = id - RACE.mtb.idBase;
      st.push({ id, run: ghostRun(t), mtb: true, reason: 'gone', start: null, timing: null });
    }
    for (const c of st.filter((x) => x.mtb).sort((a, b) => a.id - b.id)) this.numberOf(c.id);
    this.cache = { key, runs: this.d.runs(), mruns, st };
    return st;
  }
  private tilesCache: { sig: string; tiles: Set<number> } = { sig: '', tiles: new Set() };
  private bottoms: number[] = [];
  private starts: Array<{ tiles: number[]; poly: number[] }> = [];
  /** Stable "Downhill N" numbers (course id -> n), saved; the number is kept while the course is marked, however the others come and go. */
  private mtbNo = new Map<number, number>();
  private fresh(): { list: CourseInfo[]; tiles: ReadonlySet<number> } {
    const list: CourseInfo[] = [];
    for (const c of this.structure()) {
      const valid = c.reason === null, open = valid && (c.mtb ? this.d.mtbOpen?.(c.run) ?? false : this.d.runOpen(c.run));
      const blocked = valid && c.mtb && this.d.mtbReach && !this.d.mtbReach(c.run.poly.slice(0, RACE.endTiles), open) ? RACE.mtb.noLift : null;
      let gq: number;
      if (c.mtb) gq = RACE.mtb.surface; // a trail is never groomed
      else { const ago = this.d.groomedDaysAgo(c.id); gq = ago === null ? RACE.groomQuality.ungroomed : ago <= 1 ? RACE.groomQuality.fresh : ago <= 2 ? RACE.groomQuality.stale : RACE.groomQuality.ungroomed; }
      list.push({ id: c.id, run: c.run, mtb: c.mtb, valid, reason: c.reason, open, quality: open && !blocked ? gq * (RACE.diffQuality[c.run.difficulty] ?? 0.8) : 0, blocked, start: c.start, timing: c.timing });
    }
    const sig = list.filter((c) => c.open).map((c) => c.id + (c.blocked ? 'x' : '')).join(',') + '|' + (this.cache?.key ?? '');
    if (this.tilesCache.sig !== sig) {
      const tiles = new Set<number>(), bottoms: number[] = [], starts: Array<{ tiles: number[]; poly: number[] }> = [];
      for (const c of list) if (c.open) { if (c.mtb) { if (!c.blocked) { for (const t of c.run.poly.slice(-RACE.endTiles)) bottoms.push(t); starts.push({ tiles: c.run.poly.slice(0, RACE.endTiles), poly: c.run.poly }); } } else for (const t of c.run.tiles) tiles.add(t); }
      this.tilesCache = { sig, tiles }; this.bottoms = bottoms; this.starts = starts;
    }
    return { list, tiles: this.tilesCache.tiles };
  }
  /** Active (valid + open) SKI courses (winter racers). */
  active(): CourseInfo[] { return this.courses().filter((c) => c.open && !c.mtb); }
  /** Active (valid + open) MTB downhill courses (summer downhillers, 0.8.2). */
  activeMtb(): CourseInfo[] { return this.courses().filter((c) => c.open && c.mtb && !c.blocked); }
  /** Per usable downhill course the first `endTiles` centre-line tiles, top first: where a Downhiller sets out (a lift first, then a bike path to the first of them it can reach, then the course). */
  mtbStarts(): ReadonlyArray<readonly number[]> { this.fresh(); return this.starts.map((x) => x.tiles); }
  /** The centre line from `tile` down to the foot of the usable downhill course that has `tile` among its start tiles, or null. A rider on that tile rides exactly these tiles. */
  mtbRoute(tile: number): Int32Array | null { this.fresh(); for (const c of this.starts) { const k = c.tiles.indexOf(tile); if (k >= 0) return Int32Array.from(c.poly.slice(k)); } return null; }
  /** The stable number of a downhill course ("Downhill N"). */
  nameNo(id: number): number { this.courses(); return this.mtbNo.get(id) ?? 0; }
  private numberOf(id: number): number {
    let n = this.mtbNo.get(id);
    if (n === undefined) { const used = new Set(this.mtbNo.values()); n = 1; while (used.has(n)) n++; this.mtbNo.set(id, n); }
    return n;
  }
  /** The last tiles of the centre line of every open downhill course: the goals of the Downhillers (a lap = reaching one). */
  mtbGoalTiles(): readonly number[] { this.fresh(); return this.bottoms; }
  /** Tiles of the open courses (racers aim at them). */
  courseTiles(): ReadonlySet<number> { return this.fresh().tiles; }
  courseAt(tile: number, mtb = false): CourseInfo | undefined { return this.courses().find((c) => c.open && c.mtb === mtb && (mtb ? c.run.poly.slice(-RACE.endTiles) : c.run.tiles).includes(tile)); }
  /** Arrival multiplier for the Racer type: summed quality of up to `maxCourses` courses; 0 without an open course or once the racers fill every course. */
  demand(racersAlive: number): number {
    const a = this.active().slice(0, RACE.maxCourses);
    if (!a.length || racersAlive >= a.length * RACE.maxRacersPerCourse) return 0;
    let q = 0; for (const c of a) q += c.quality;
    return q;
  }
  /** Arrival multiplier for the Downhiller type (0.8.2): the summed quality of up to `maxCourses` open downhill courses; 0 without one or when every course has its riders. */
  demandMtb(ridersAlive: number): number {
    const a = this.activeMtb().slice(0, RACE.maxCourses);
    if (!a.length || ridersAlive >= a.length * RACE.mtb.maxRidersPerCourse) return 0;
    let q = 0; for (const c of a) q += c.quality;
    return q;
  }

  /** A racer reached the via tile on a course: count the lap, charge the fee on the first lap of the day. Returns true when the racer has trained enough and should leave. */
  onLap(guestId: number, tile: number, mtb = false): boolean {
    const c = this.courseAt(tile, mtb);
    if (!c) return false;
    const day = this.d.day();
    this.rollDay(day);
    const rec = this.laps.get(guestId) ?? [0, 0];
    rec[0]++; this.total++; this.version++;
    if (rec[1] !== day + 1) { rec[1] = day + 1; if (mtb) this.todayMtb++; else this.today++; this.d.earn(mtb ? RACE.mtb.courseFee : RACE.courseFee); }
    this.laps.set(guestId, rec);
    const ms = Math.round(((mtb ? RACE.mtb.boardBaseS : RACE.boardBaseS) + c.run.lengthM / ((mtb ? RACE.mtb.boardMps : RACE.boardMps) * (0.85 + 0.3 * mix(guestId, rec[0] + 97)) * (0.9 + 0.1 * c.quality))) * 1000);
    const b = this.bestToday.get(c.id);
    if (b === undefined || ms < b) this.bestToday.set(c.id, ms);
    return rec[0] >= lapQuota(guestId, mtb);
  }
  private rollDay(day: number): void { if (day !== this.dayStamp) { this.dayStamp = day; this.today = 0; this.todayMtb = 0; this.bestToday.clear(); } }
  racersToday(mtb = false): number { return this.dayStamp === this.d.day() ? (mtb ? this.todayMtb : this.today) : 0; }
  bestMs(courseId: number): number | null { return this.dayStamp === this.d.day() ? this.bestToday.get(courseId) ?? null : null; }
  lapsOf(guestId: number): number { return this.laps.get(guestId)?.[0] ?? 0; }
  /** Forget the lap records of guests that are gone (call on the day boundary). */
  prune(alive: (id: number) => boolean): void { for (const id of [...this.laps.keys()]) if (!alive(id)) this.laps.delete(id); }

  serialize(): RaceSaved | null {
    if (!this.laps.size && !this.total && !this.mtbNo.size) return null;
    return { laps: [...this.laps].sort((a, b) => a[0] - b[0]).map(([id, v]) => [id, v[0], v[1]]), total: this.total, day: this.dayStamp, today: this.today, best: [...this.bestToday].sort((a, b) => a[0] - b[0]), ...(this.todayMtb ? { todayMtb: this.todayMtb } : {}), ...(this.mtbNo.size ? { mtbNo: [...this.mtbNo].sort((a, b) => a[0] - b[0]) } : {}) };
  }
  load(d: Partial<RaceSaved> | null | undefined): void {
    this.laps = new Map((d?.laps ?? []).map(([id, n, f]) => [id, [n, f] as [number, number]]));
    this.total = d?.total ?? 0; this.dayStamp = d?.day ?? -1; this.today = d?.today ?? 0; this.todayMtb = d?.todayMtb ?? 0; this.mtbNo = new Map(d?.mtbNo ?? []); this.bestToday = new Map(d?.best ?? []);
    this.cache = null; this.version++;
  }
  reset(): void { this.load(null); }
}
