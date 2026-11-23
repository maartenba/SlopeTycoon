import { RACE_DAY, type RaceKind } from '../../config/race';
import { SPONSORS, SPONSOR_BY_ID, type Sponsor } from '../../config/raceSponsors';
import { fmtTime, type CourseInfo } from './RaceCourse';

/**
 * Race days (0.8.1, docs/race-course.md "Race days"). The player books a **Club Race** on a weekend for one of the courses; the World Cup (festival) runs the same
 * 10:00-14:00 race on every one of its days on the best course. During the race the course is closed to the public (reason "Race day"), existing guests walk to the
 * Timing Hut and watch (cap 40), the field's times come from a pure seeded hash of (seed, day, course, racer) x course quality, and at 14:00 the results go on the board
 * and into the news. A course carries ONE sponsor from a pool (config/raceSponsors.ts): it pays a flat sum per race and adds a small rating bonus that fades.
 *
 * Everything that matters is saved in the `raceCourse` module (bookings, the running session, results, sponsors, the bonus): a save in the middle of a race reloads identically.
 * Nothing is drawn from a shared RNG (the times are hashes), and a world without a booking or a World Cup serialises to null (hashes of such worlds are unchanged).
 */
export interface RaceBooking { course: number; day: number }
export interface RaceResult { day: number; course: number; name: string; kind: RaceKind; winnerMs: number; winner: string; field: number; spectators: number; sponsor: string | null; earned: number }
export interface RaceSession { /** a downhill course (summer, 0.8.2); absent = a ski course */ mtb?: boolean; kind: RaceKind; course: number; day: number; name: string; difficulty: number; quality: number; field: number; sponsor: string | null; spectators: number[] }
export interface RaceDaySaved {
  bookings?: RaceBooking[]; session?: RaceSession | null; results?: RaceResult[]; sponsors?: Array<[number, string]>; bonus?: { day: number; pts: number } | null;
}

export interface RaceDayDeps {
  seed: number;
  day(): number;
  /** 0 = Monday .. 5 = Saturday, 6 = Sunday, for an absolute day. */
  weekday(abs: number): number;
  /** The season of an absolute day is the course's season: winter for a ski course, summer for a downhill (MTB) course (0.8.2). */
  inSeason(abs: number, mtb?: boolean): boolean;
  /** null = open; otherwise why the resort level is too low. */
  gate?(minLevel: number): string | null;
  funds(): number;
  pay(amount: number): boolean;
  refund(amount: number): void;
  earn(category: 'recreation' | 'other', amount: number): void;
  courses(): readonly CourseInfo[];
  courseName(c: CourseInfo): string;
  /** A World Cup is running today (the festival calendar). */
  worldCupToday(): boolean;
  /** Does a World Cup (booked or running) cover this absolute day? */
  worldCupOn(abs: number): boolean;
  /** Close the course to the public for `ticks` sim ticks. */
  close(c: CourseInfo, ticks: number): void;
  /** Send up to `n` more guests to watch (not in `taken`); returns their ids. */
  send(c: CourseInfo, n: number, taken: ReadonlySet<number>): number[];
  /** The race is over: the spectators are hungry now. */
  fed(ids: readonly number[]): void;
  news(msg: string): void;
}

const mix = (a: number, b: number, c: number, d: number): number => {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35) ^ Math.imul(d | 0, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Monday of the week containing `abs` (week = Monday .. Sunday). */
export const weekStartOf = (abs: number, weekday: number): number => abs - weekday;

/** Pure: the finishing times (ms) of a field, fastest first. Course quality 1 = freshly groomed. */
export function raceTimes(seed: number, day: number, courseId: number, lengthM: number, quality: number, field: number, boardBaseS: number, mps: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < field; k++) {
    const speed = mps * (0.82 + 0.36 * mix(seed, day, courseId, 100 + k)) * (0.94 + 0.06 * quality);
    out.push(Math.round((boardBaseS + lengthM / speed) * 1000));
  }
  return out.sort((a, b) => a - b);
}

export class RaceDay {
  bookings: RaceBooking[] = [];
  session: RaceSession | null = null;
  results: RaceResult[] = [];
  private sponsors = new Map<number, string>();
  private bonus: { day: number; pts: number } | null = null;
  /** Bumps on every change (UI / board caches). */
  version = 0;
  constructor(private d: RaceDayDeps, private boardBaseS = 30, private boardMps = 9, private mtbBaseS = 25, private mtbMps = 11) {}

  // ---- queries ------------------------------------------------------------------------------------------------------------------------------
  /** The sponsor of a course (assigned when its first race day is booked or held), or null. */
  sponsorOf(courseId: number): Sponsor | null { const id = this.sponsors.get(courseId); return id ? SPONSOR_BY_ID[id] ?? null : null; }
  /** Is this course closed for a race right now? */
  raceOn(courseId?: number): boolean { return !!this.session && (courseId === undefined || this.session.course === courseId); }
  /** Latest result of a course (newest first), or null. */
  lastResult(courseId: number): RaceResult | null { return this.results.find((r) => r.course === courseId) ?? null; }
  /** Today's club race booking, if any. */
  today(): RaceBooking | undefined { const t = this.d.day(); return this.bookings.find((b) => b.day === t); }
  /** Arrival multiplier on a club race day (1 otherwise; the World Cup has its own festival multiplier). */
  arrivalMult(): number { const t = this.d.day(); return this.session && this.session.kind === 'club' && this.session.day === t ? RACE_DAY.arrivalMult : 1; }
  /** Rating points added by the sponsor of the last race (0..1.0 of 100 = at most +0.05 stars), fading over `bonusDays`. */
  ratingBonus(): number {
    const b = this.bonus; if (!b) return 0;
    const age = this.d.day() - b.day;
    return age < 0 || age >= RACE_DAY.bonusDays ? 0 : b.pts * (1 - age / RACE_DAY.bonusDays);
  }
  /** The spectator cap of a session. */
  capFor(kind: RaceKind, difficulty: number): number { return Math.min(RACE_DAY.maxSpectators, RACE_DAY.spectators[kind][difficulty] ?? RACE_DAY.spectators[kind][3]!); }

  // ---- booking ------------------------------------------------------------------------------------------------------------------------------
  /** Date-independent prerequisites: the level gate; null = met. */
  requirement(): string | null { return this.d.gate?.(RACE_DAY.minLevel) ?? null; }
  /** Why a Club Race cannot be booked on `course` for absolute day `day` (null = it can). */
  blocker(course: number, day: number): string | null {
    const c = this.d.courses().find((x) => x.id === course);
    if (!c) return 'Pick a race course';
    if (!c.valid) return 'The course is inactive';
    const req = this.requirement(); if (req) return req;
    const t = this.d.day();
    if (day < t + RACE_DAY.leadDays) return `Needs ${RACE_DAY.leadDays} days notice`;
    const wd = this.d.weekday(day);
    if (!RACE_DAY.weekdays.includes(wd)) return 'Only on a Saturday or Sunday';
    if (!this.d.inSeason(day, c.mtb)) return c.mtb ? 'Only in summer' : 'Only in winter';
    if (this.d.worldCupOn(day)) return 'The World Cup is on that day';
    const ws = weekStartOf(day, wd);
    for (const b of this.bookings) if (weekStartOf(b.day, this.d.weekday(b.day)) === ws) return 'One race day a week is enough';
    if (this.d.funds() < RACE_DAY.cost) return 'Not enough cash';
    return null;
  }
  book(course: number, day: number): boolean {
    if (this.blocker(course, day)) return false;
    if (!this.d.pay(RACE_DAY.cost)) return false;
    this.bookings.push({ course, day }); this.bookings.sort((a, b) => a.day - b.day);
    this.assignSponsor(course);
    this.version++;
    return true;
  }
  cancel(course: number, day: number): boolean {
    const i = this.bookings.findIndex((b) => b.course === course && b.day === day);
    if (i < 0 || day <= this.d.day()) return false;
    this.bookings.splice(i, 1); this.d.refund(Math.round(RACE_DAY.cost * RACE_DAY.refund)); this.version++;
    return true;
  }
  /** Pick the course's sponsor from the pool: a seeded hash, never one that another course already has (while the pool lasts). */
  private assignSponsor(course: number): void {
    if (this.sponsors.has(course)) return;
    const taken = new Set(this.sponsors.values());
    let k = Math.floor(mix(this.d.seed, course, 0x5e, 7) * SPONSORS.length);
    for (let n = 0; n < SPONSORS.length; n++, k++) { const s = SPONSORS[k % SPONSORS.length]!; if (!taken.has(s.id)) { this.sponsors.set(course, s.id); return; } }
    this.sponsors.set(course, SPONSORS[k % SPONSORS.length]!.id);
  }

  // ---- time ---------------------------------------------------------------------------------------------------------------------------------
  /** Day boundary: stale bookings and a stale session (a skipped day) are dropped. */
  onDay(): void {
    const t = this.d.day();
    const n = this.bookings.length;
    this.bookings = this.bookings.filter((b) => b.day >= t);
    if (this.session && this.session.day !== t) { this.session = null; this.version++; }
    if (this.bookings.length !== n) this.version++;
  }

  /** Every game hour (`time:hour`, hour 0..23). */
  onHour(hour: number): void {
    const t = this.d.day();
    if (hour === RACE_DAY.from) this.start(t);
    else if (this.session && this.session.day === t && hour === RACE_DAY.to) this.finish();
    else if (this.session && this.session.day === t && RACE_DAY.spectatorHours.includes(hour)) this.topUp();
  }

  private start(t: number): void {
    if (this.session) this.session = null; // a leftover of a skipped hour
    const booking = this.today();
    let kind: RaceKind | null = null, c: CourseInfo | undefined;
    if (booking) {
      kind = 'club';
      c = this.d.courses().find((x) => x.id === booking.course);
      this.bookings = this.bookings.filter((b) => b !== booking); this.version++;
      if (!c || !c.valid || !c.open) {
        this.d.refund(RACE_DAY.cost);
        this.d.news(`${RACE_DAY.reasons.cancelled}${c ? ` (${this.d.courseName(c)} is ${c.valid ? 'closed' : 'inactive'})` : ''}. The fee is refunded.`);
        return;
      }
    } else if (this.d.worldCupToday()) {
      kind = 'worldCup';
      const live = this.d.courses().filter((x) => x.valid && x.open && !x.mtb).sort((a, b) => b.run.difficulty - a.run.difficulty || b.quality - a.quality || a.id - b.id);
      c = live[0];
      if (!c) return; // an old save without a course keeps the abstract World Cup
    }
    if (!kind || !c) return;
    this.assignSponsor(c.id);
    const sp = this.sponsorOf(c.id);
    const range = kind === 'club' ? RACE_DAY.field : RACE_DAY.fieldWorldCup;
    const field = range[0] + Math.floor(mix(this.d.seed, t, c.id, 3) * (range[1] - range[0] + 1));
    this.session = { ...(c.mtb ? { mtb: true } : {}), kind, course: c.id, day: t, name: this.d.courseName(c), difficulty: c.run.difficulty, quality: c.quality, field, sponsor: sp?.id ?? null, spectators: [] };
    this.d.close(c, (RACE_DAY.to - RACE_DAY.from) * 10);
    this.d.news(`${this.session.name} ${kind === 'club' ? (c.mtb ? 'Downhill Race' : 'Club Race') : 'World Cup race'}: ${field} ${c.mtb ? 'riders' : 'racers'} are at the gate. The ${c.mtb ? 'trail' : 'run'} is closed to the public until ${RACE_DAY.to}:00.${sp ? ` Sponsored by ${sp.name}.` : ''}`);
    this.version++;
    this.topUp();
  }

  private topUp(): void {
    const s = this.session; if (!s) return;
    const c = this.d.courses().find((x) => x.id === s.course); if (!c) return;
    const room = Math.min(RACE_DAY.perWave, this.capFor(s.kind, s.difficulty) - s.spectators.length);
    if (room <= 0) return;
    const got = this.d.send(c, room, new Set(s.spectators));
    if (got.length) { s.spectators.push(...got); this.version++; }
  }

  private finish(): void {
    const s = this.session; if (!s) return;
    const c = this.d.courses().find((x) => x.id === s.course);
    const length = c?.run.lengthM ?? 400;
    const mtb = !!s.mtb, times = raceTimes(this.d.seed, s.day, s.course, length, s.quality, s.field, mtb ? this.mtbBaseS : this.boardBaseS, mtb ? this.mtbMps : this.boardMps);
    const winnerMs = times[0] ?? 0;
    const wi = Math.floor(mix(this.d.seed, s.day, s.course, 9) * RACE_DAY.winners.length);
    const winner = `${String.fromCharCode(65 + Math.floor(mix(this.d.seed, s.day, s.course, 10) * 26))}. ${RACE_DAY.winners[wi]!}`;
    const sp = s.sponsor ? SPONSOR_BY_ID[s.sponsor] ?? null : null;
    const fees = s.field * (s.kind === 'club' ? RACE_DAY.entryFee : RACE_DAY.entryFeeWorldCup);
    this.d.earn('recreation', fees);
    if (sp) { this.d.earn('other', sp.pay); this.bonus = { day: s.day, pts: sp.rating }; }
    const earned = fees + (sp?.pay ?? 0);
    this.results.unshift({ day: s.day, course: s.course, name: s.name, kind: s.kind, winnerMs, winner, field: s.field, spectators: s.spectators.length, sponsor: s.sponsor, earned });
    if (this.results.length > RACE_DAY.keepResults) this.results.length = RACE_DAY.keepResults;
    this.d.fed(s.spectators);
    this.d.news(`${s.name} ${s.kind === 'club' ? (mtb ? 'Downhill Race' : 'Club Race') : 'World Cup'}: ${winner} wins in ${fmtTime(winnerMs)} (${s.field} ${mtb ? 'riders' : 'racers'}, ${s.spectators.length} spectators).${sp?.line ? ` ${sp.line}` : ''}`);
    this.session = null; this.version++;
  }

  // ---- save ---------------------------------------------------------------------------------------------------------------------------------
  serialize(): RaceDaySaved | null {
    if (!this.bookings.length && !this.session && !this.results.length && !this.sponsors.size && !this.bonus) return null;
    return {
      bookings: this.bookings.map((b) => ({ ...b })), session: this.session ? { ...this.session, spectators: [...this.session.spectators] } : null,
      results: this.results.map((r) => ({ ...r })), sponsors: [...this.sponsors].sort((a, b) => a[0] - b[0]), bonus: this.bonus ? { ...this.bonus } : null,
    };
  }
  load(d: RaceDaySaved | null | undefined): void {
    this.bookings = (d?.bookings ?? []).map((b) => ({ ...b }));
    this.session = d?.session ? { ...d.session, spectators: [...d.session.spectators] } : null;
    this.results = (d?.results ?? []).map((r) => ({ ...r }));
    this.sponsors = new Map((d?.sponsors ?? []).filter(([, id]) => !!SPONSOR_BY_ID[id]));
    this.bonus = d?.bonus ? { ...d.bonus } : null;
    this.version++;
  }
  reset(): void { this.load(null); }
}
