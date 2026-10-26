import { Rng } from '../../core/Rng';
import { DAYS_PER_YEAR } from '../../config/balance';
import { EVENTS, FESTIVALS, FESTIVAL_BY_ID, type FestivalDef, type FestivalId } from '../../config/festivals';
import type { SeasonId } from '../../core/events';
import { phaseFor } from '../nature/Livestock';

/**
 * Events calendar (M5.4 Task 21): player-booked festivals + automatic events (Almabtrieb, New Year, critic visits, powder days).
 * Pure sim (no three / DOM). With no booking and `auto` off every query is neutral (`arrivalMult() === 1`, nothing active), so headless runs
 * that never book a festival keep their old state hash apart from the new `events` save module.
 *
 * Days are absolute (`year * 180 + day`). A booking occupies `[start, start + days)`.
 */
export interface Booking { id: FestivalId; start: number; end: number; started?: boolean }
export interface ActiveEvent {
  id: FestivalId; def: FestivalDef; start: number; end: number;
  /** 0-based day index inside the event and its length. */
  dayIndex: number; days: number;
  /** Last day of the event. */
  finale: boolean;
  auto: boolean;
}
export interface UpcomingEvent { id: FestivalId; def: FestivalDef; start: number; end: number; booked: boolean; daysAway: number }

export interface CriticInput { stars: number; happiness: number; openShare: number; incidents: number }
/** Pure critic score 0..5 in half steps: resort rating dominates, then guest mood, open runs and recent incidents. */
export function criticScore(i: CriticInput): number {
  const raw = i.stars * 0.6 + i.happiness * 5 * 0.25 + i.openShare * 5 * 0.15 - Math.min(1, i.incidents) * 0.5;
  return Math.max(0, Math.min(5, Math.round(raw * 2) / 2));
}

export interface CalendarDeps {
  today: () => number;
  funds: () => number;
  pay: (amount: number) => boolean;
  refund?: (amount: number) => void;
  stars: () => number;
  /** null = open; otherwise why the level is not high enough. */
  gate?: (minLevel: number) => string | null;
  hasLodge: () => boolean;
  hasBlackPiste: () => boolean;
  /** A snowfall that makes a powder day (read-only weather). */
  powder: () => boolean;
  /** Cows exist (Alpine Farm built): Almabtrieb can run. */
  hasHerd: () => boolean;
  critic: () => CriticInput;
  /** Raise every guest's happiness by `amount` (daily festival cheer). */
  cheer: (amount: number) => void;
  news: (msg: string) => void;
  seed: number;
  /** Turn on the automatic events (Almabtrieb, New Year, critic, powder). The game does; headless sims default to off. */
  auto?: boolean;
}

const doyOf = (day: number): number => ((day % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
const seasonOfDoy = (doy: number): SeasonId => {
  const m = Math.floor(doy / 15);
  return m < 2 ? 'spring' : m < 6 ? 'summer' : m < 8 ? 'autumn' : 'winter';
};

export class EventCalendar {
  booked: Booking[] = [];
  /** Finished events per id (lifetime). */
  history: Partial<Record<FestivalId, number>> = {};
  private rng: Rng;
  /** Absolute day of the next critic visit (null = not scheduled yet) and whether the 3-day notice has been given. */
  nextCritic: number | null = null;
  private criticNoticed = false;
  /** Review effect on arrivals. */
  buff: { until: number; mult: number; score: number } | null = null;
  lastReview: { day: number; score: number } | null = null;
  private lastPowder = -1e9;
  private powderDay = -1;
  private lastDay = -1;
  private criticDone = -1;

  constructor(private d: CalendarDeps) { this.rng = new Rng((d.seed ^ 0xfe57) >>> 0); }

  get auto(): boolean { return !!this.d.auto; }
  setAuto(on: boolean): void { this.d.auto = on; }

  // ---- queries ----------------------------------------------------------------------------------------------------------------------------

  /** Events running on `day` (default today), booked first. Includes the derived automatic ones when `auto` is on. */
  active(day = this.d.today()): ActiveEvent[] {
    const out: ActiveEvent[] = [];
    for (const b of this.booked) if (day >= b.start && day < b.end) out.push(this.mk(b.id, b.start, b.end, day, false));
    if (this.d.auto) {
      const doy = doyOf(day), base = day - doy;
      // New Year: the last day of the year (the eve) and day 0 of the next one
      if (doy >= DAYS_PER_YEAR - 1) out.push(this.mk('newYear', base + DAYS_PER_YEAR - 1, base + DAYS_PER_YEAR + 1, day, true));
      else if (doy === 0) out.push(this.mk('newYear', base - 1, base + 1, day, true));
      if (this.d.hasHerd() && phaseFor(doy) === 'descend') {
        let s = doy; while (s > 0 && phaseFor(s - 1) === 'descend') s--;
        let e = doy; while (e < DAYS_PER_YEAR - 1 && phaseFor(e + 1) === 'descend') e++;
        out.push(this.mk('almabtrieb', base + s, base + e + 1, day, true));
      }
      if (this.powderDay === day) out.push(this.mk('powder', day, day + 1, day, true));
      if (this.criticDone === day) out.push(this.mk('critic', day, day + 1, day, true));
    }
    return out;
  }
  private mk(id: FestivalId, start: number, end: number, day: number, auto: boolean): ActiveEvent {
    return { id, def: FESTIVAL_BY_ID[id], start, end, dayIndex: day - start, days: end - start, finale: day === end - 1, auto };
  }

  /** Product of every running event's arrival multiplier and the review effect (exactly 1 with nothing on). */
  arrivalMult(day = this.d.today()): number {
    let m = 1;
    for (const e of this.active(day)) m *= e.def.arrivalMult;
    if (this.buff && day < this.buff.until) m *= this.buff.mult;
    return m;
  }

  /** The event whose fireworks show runs today (night), if any. Pure data: the render layer decides whether it is allowed (Feedback intensity). */
  fireworksToday(day = this.d.today()): ActiveEvent | null {
    for (const e of this.active(day)) {
      if (e.def.fireworks === 'finale' && e.finale) return e;
      if (e.def.fireworks === 'first' && e.dayIndex === 0) return e;
    }
    return null;
  }

  /** Booked + automatic events in the next `horizon` days (soonest first). The critic only shows once announced. */
  upcoming(horizon: number = EVENTS.horizonDays): UpcomingEvent[] {
    const t = this.d.today(), out: UpcomingEvent[] = [];
    for (const b of this.booked) if (b.start > t || (b.start <= t && b.end > t)) out.push({ id: b.id, def: FESTIVAL_BY_ID[b.id], start: b.start, end: b.end, booked: true, daysAway: Math.max(0, b.start - t) });
    if (this.d.auto) {
      const doy = doyOf(t), base = t - doy;
      const ny = base + DAYS_PER_YEAR - 1;
      if (ny > t && ny - t <= horizon) out.push({ id: 'newYear', def: FESTIVAL_BY_ID.newYear, start: ny, end: ny + 2, booked: false, daysAway: ny - t });
      if (this.nextCritic !== null && this.nextCritic > t && this.nextCritic - t <= EVENTS.criticAnnounceDays) out.push({ id: 'critic', def: FESTIVAL_BY_ID.critic, start: this.nextCritic, end: this.nextCritic + 1, booked: false, daysAway: this.nextCritic - t });
    }
    return out.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  }

  // ---- booking ----------------------------------------------------------------------------------------------------------------------------

  /** Why `id` cannot be booked to start on absolute day `start` (null = it can). */
  blocker(id: FestivalId, start: number): string | null {
    const def = FESTIVAL_BY_ID[id];
    if (!def || def.kind !== 'booked') return 'Not bookable';
    const t = this.d.today();
    if (start < t + def.leadDays) return `Needs ${def.leadDays} days notice`;
    const doy = doyOf(start);
    if (!def.seasons.includes(seasonOfDoy(doy))) return `Only in ${def.seasons.join(' / ')}`;
    if (def.startWindow && (doy < def.startWindow[0] || doy > def.startWindow[1])) return 'Outside the festival season';
    const end = start + def.days;
    if (this.booked.some((b) => start < b.end && b.start < end)) return 'Another festival is already booked then';
    const req = this.requirement(id);
    if (req) return req;
    if (this.d.funds() < def.cost) return 'Not enough cash';
    return null;
  }
  /** Date-independent prerequisites (level, stars, lodge, black piste); null = met. Cash is checked separately. */
  requirement(id: FestivalId): string | null {
    const def = FESTIVAL_BY_ID[id];
    const g = this.d.gate?.(def.minLevel);
    if (g) return g;
    if (this.d.stars() < def.minStars) return `Needs ${def.minStars} stars`;
    if (def.needs.includes('lodge') && !this.d.hasLodge()) return 'Needs a Base Lodge';
    if (def.needs.includes('blackPiste') && !this.d.hasBlackPiste()) return 'Needs a black piste';
    return null;
  }
  book(id: FestivalId, start: number): boolean {
    if (this.blocker(id, start)) return false;
    const def = FESTIVAL_BY_ID[id];
    if (def.cost > 0 && !this.d.pay(def.cost)) return false;
    this.booked.push({ id, start, end: start + def.days });
    this.booked.sort((a, b) => a.start - b.start);
    return true;
  }
  /** Cancel a booking that has not started; refunds `EVENTS.refund` of the cost. */
  cancel(id: FestivalId, start: number): boolean {
    const i = this.booked.findIndex((b) => b.id === id && b.start === start);
    if (i < 0 || start <= this.d.today()) return false;
    this.booked.splice(i, 1);
    const def = FESTIVAL_BY_ID[id];
    if (def.cost > 0) this.d.refund?.(Math.round(def.cost * EVENTS.refund));
    return true;
  }
  /** First day (absolute) the festival can start on from today, or null within the next two years. */
  nextStart(id: FestivalId): number | null {
    const t = this.d.today();
    for (let k = 0; k < DAYS_PER_YEAR * 2; k++) {
      const s = t + k;
      const def = FESTIVAL_BY_ID[id];
      if (def.kind !== 'booked' || s < t + def.leadDays) continue;
      const doy = doyOf(s);
      if (!def.seasons.includes(seasonOfDoy(doy))) continue;
      if (def.startWindow && (doy < def.startWindow[0] || doy > def.startWindow[1])) continue;
      return s;
    }
    return null;
  }
  /** Candidate start days for the UI: every `step` days inside the window over the next year. */
  startOptions(id: FestivalId, step = 1): number[] {
    const t = this.d.today(), out: number[] = [], def = FESTIVAL_BY_ID[id];
    for (let k = def.leadDays; k < DAYS_PER_YEAR; k += step) {
      const s = t + k, doy = doyOf(s);
      if (!def.seasons.includes(seasonOfDoy(doy))) continue;
      if (def.startWindow && (doy < def.startWindow[0] || doy > def.startWindow[1])) continue;
      out.push(s);
    }
    return out;
  }

  // ---- time -------------------------------------------------------------------------------------------------------------------------------

  /** Once per in-game day (`day:changed`). */
  newDay(): void {
    const t = this.d.today();
    this.lastDay = t;
    // booked festivals: begin / finish
    for (const b of this.booked) {
      if (!b.started && t >= b.start && t < b.end) {
        b.started = true;
        this.d.news(`${FESTIVAL_BY_ID[b.id].name} begins! ${FESTIVAL_BY_ID[b.id].blurb}`);
      }
    }
    for (const b of this.booked.filter((x) => t >= x.end)) this.history[b.id] = (this.history[b.id] ?? 0) + 1;
    this.booked = this.booked.filter((b) => t < b.end);
    // daily cheer
    for (const e of this.active(t)) if (e.def.cheer > 0) this.d.cheer(e.def.cheer);
    if (this.buff && t >= this.buff.until) this.buff = null;
    if (!this.d.auto) return;
    if (this.active(t).some((e) => e.id === 'newYear' && e.dayIndex === 0)) this.d.news('New Year\'s Eve! A small fireworks show lights up the village tonight.');
    // critic: schedule, announce 3 days ahead, visit
    if (this.nextCritic === null) this.nextCritic = t + this.rng.int(EVENTS.criticFirst[0], EVENTS.criticFirst[1]);
    if (!this.criticNoticed && t >= this.nextCritic - EVENTS.criticAnnounceDays && t < this.nextCritic) {
      this.criticNoticed = true;
      this.d.news(`A travel critic will visit the resort in ${this.nextCritic - t} days. Make sure the pistes and lifts are in good shape.`);
    }
    if (t >= this.nextCritic) {
      this.criticDone = t;
      const score = criticScore(this.d.critic());
      this.lastReview = { day: t, score };
      if (score >= EVENTS.goodReview) { this.buff = { until: t + EVENTS.reviewDays, mult: EVENTS.goodMult, score }; this.d.news(`The critic gave the resort ${score} / 5: a glowing review. More guests are expected.`); }
      else if (score <= EVENTS.badReview) { this.buff = { until: t + EVENTS.reviewDays, mult: EVENTS.badMult, score }; this.d.news(`The critic gave the resort ${score} / 5. A few guests will think twice.`); }
      else this.d.news(`The critic gave the resort ${score} / 5: a fair review.`);
      this.nextCritic = t + this.rng.int(EVENTS.criticGap[0], EVENTS.criticGap[1]);
      this.criticNoticed = false;
    }
  }

  /** Hourly: a snowfall may declare a powder day (once per cooldown). */
  newHour(): void {
    if (!this.d.auto) return;
    const t = this.d.today();
    if (this.powderDay === t || t - this.lastPowder < EVENTS.powderCooldown) return;
    if (seasonOfDoy(doyOf(t)) !== 'winter' || !this.d.powder()) return;
    this.powderDay = t; this.lastPowder = t;
    this.d.news('Powder day! Fresh snow on the slopes: expect a crowd.');
    this.d.cheer(FESTIVAL_BY_ID.powder.cheer);
  }

  // ---- save -------------------------------------------------------------------------------------------------------------------------------

  serialize(): unknown {
    return {
      booked: this.booked.map((b) => ({ ...b })), history: { ...this.history }, rng: this.rng.getState(), nextCritic: this.nextCritic, criticNoticed: this.criticNoticed,
      buff: this.buff ? { ...this.buff } : null, lastReview: this.lastReview ? { ...this.lastReview } : null, lastPowder: this.lastPowder, powderDay: this.powderDay, criticDone: this.criticDone,
    };
  }
  load(d: unknown): void {
    this.reset();
    const s = d as Partial<ReturnType<EventCalendar['serialize']> & Record<string, unknown>> & Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!s) return;
    this.booked = ((s.booked ?? []) as Booking[]).filter((b) => FESTIVAL_BY_ID[b.id]).map((b) => ({ ...b }));
    this.history = { ...(s.history ?? {}) };
    if (typeof s.rng === 'number') this.rng.setState(s.rng);
    this.nextCritic = typeof s.nextCritic === 'number' ? s.nextCritic : null;
    this.criticNoticed = !!s.criticNoticed;
    this.buff = s.buff ? { ...s.buff } : null; this.lastReview = s.lastReview ? { ...s.lastReview } : null;
    this.lastPowder = typeof s.lastPowder === 'number' ? s.lastPowder : -1e9; this.powderDay = typeof s.powderDay === 'number' ? s.powderDay : -1;
    this.criticDone = typeof s.criticDone === 'number' ? s.criticDone : -1;
  }
  reset(): void {
    this.booked = []; this.history = {}; this.rng = new Rng((this.d.seed ^ 0xfe57) >>> 0); this.nextCritic = null; this.criticNoticed = false; this.buff = null; this.lastReview = null;
    this.lastPowder = -1e9; this.powderDay = -1; this.criticDone = -1; this.lastDay = -1;
  }
}

export { FESTIVALS };
