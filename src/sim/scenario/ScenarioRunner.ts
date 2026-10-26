/**
 * Scenario runner (M5.3 Task 15): evaluates a `ScenarioDef` once per game day against a read-only `ScenarioWorld`, emits typed events and
 * exposes the HUD / result data. Deterministic: a pure function of sim state + a few latched counters (no RNG, no wall clock).
 *
 *  - Objectives: `fact op target`. `>=`/`>` objectives LATCH when met (optionally after `hold` consecutive days); `<=`/`<` objectives are
 *    met while the fact is within the cap. A cap on a monotonic fact (incidents, guests) that is exceeded is FAILED for good.
 *  - Ready: every mandatory objective is met. The player may then `finishNow()` (banks the medal with the speed bonus) or play on; the scenario is won
 *    automatically when EVERY objective is met or when the deadline passes while ready.
 *    Lost: bankrupt, a mandatory objective failed, rating below X for N months, or the deadline passed while not ready.
 *  - Medal on a win: gold / silver when their listed objectives are met and the score reaches `minScore`, otherwise bronze.
 *  - Score = points of met objectives + speedBonus x (time left / deadline) + marginBonus x clamp(margin fact / par).
 * Save: module `scenario` (`serialize` / `load`); a save without it (or with another scenario id) has no scenario.
 * No three / DOM imports.
 */
import type { GameBus } from '../../core/events';
import type { SeasonId } from '../../core/events';
import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../../config/balance';
import type { GoalFacts, GoalWorld } from '../goals/Goals';
import { deadlineDays, factInfo, SCENARIO_VERSION, type Comparator, type FactId, type ObjectiveDef, type ScenarioDef } from './ScenarioDef';

export type Medal = 'none' | 'bronze' | 'silver' | 'gold';
export const MEDAL_RANK: Record<Medal, number> = { none: 0, bronze: 1, silver: 2, gold: 3 };

/** Read-only world view (built in createSim from the real sim; fixtures in tests). */
export interface ScenarioWorld extends GoalWorld {
  facts(): Readonly<GoalFacts>;
  mtbTiles(): number;
  hikeTiles(): number;
  /** Trail tiles in the top third of the mountain. */
  highTrailTiles(): number;
  /** Average happiness of the guests in the resort, 0..1; -1 when nobody is there (sampled at noon). */
  happiness(): number;
  familyHappiness(): number;
  annualProfit(): number;
  lastMonthNet(): number;
  incidents(kind: string): number;
  level(): number;
  /** At least one lift and one piste are open right now. */
  openNow(): boolean;
  season(): SeasonId;
  isFamily(guestId: number): boolean;
  /** Absolute day count (year x 180 + day). */
  today(): number;
}

export interface ObjState { met: boolean; failed: boolean; hold: number; metDay: number | null; value: number; progress: number }
export interface ObjectiveView { id: string; title: string; description: string; progress: number; met: boolean; failed: boolean; mandatory: boolean; weight: number; value: number; target: number; op: Comparator; valueText: string; targetText: string; unit: string }
export interface ScenarioResult { result: 'won' | 'lost'; medal: Medal; score: number; days: number; reason: string; objectives: ObjectiveView[] }
export interface ScenarioView {
  id: string; name: string; sandbox: boolean; finished: ScenarioResult | null; ready: boolean; medalNow: Medal;
  elapsed: number; total: number; daysLeft: number; timeLabel: string;
  objectives: ObjectiveView[]; score: number;
}
export interface ScenarioSave {
  v: number; id: string; startAbs: number; family: number; summer: number; openDays: number; belowDays: number; happy: number; famHappy: number; sandbox: boolean;
  states: Record<string, ObjState>; finished: Omit<ScenarioResult, 'objectives'> | null;
}

const clamp01 = (v: number): number => (Number.isNaN(v) || v < 0 ? 0 : v > 1 ? 1 : v);
export const compare = (v: number, op: Comparator, t: number): boolean => (op === '>=' ? v >= t : op === '<=' ? v <= t : op === '>' ? v > t : v < t);
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Value of a fact right now. */
export interface Counters { family: number; summer: number; openDays: number; happy: number; famHappy: number }
export function evalFact(w: ScenarioWorld, id: FactId, arg: string | number | undefined, c: Counters): number {
  const f = w.facts();
  switch (id) {
    case 'lifetimeGuests': return f.lifetime;
    case 'bestDayGuests': return f.bestDay;
    case 'familyGuests': return c.family;
    case 'summerGuests': return c.summer;
    case 'stars': return w.stars();
    case 'happiness': return c.happy * 100;
    case 'familyHappiness': return c.famHappy * 100;
    case 'money': return w.money();
    case 'debt': return w.debt();
    case 'monthlyProfit': return w.lastMonthNet();
    case 'annualProfit': return w.annualProfit();
    case 'profitMonths': return f.profitMonths;
    case 'buildings': return w.buildings().filter((b) => b.type === arg && b.active).length;
    case 'liftsOpen': return w.lifts().filter((l) => l.open && (arg === undefined || l.kind === arg)).length;
    case 'liftKinds': return new Set(w.lifts().map((l) => l.kind)).size;
    case 'pisteTiles': return w.pistes().filter((p) => arg === undefined || p.difficulty === arg).reduce((a, p) => a + p.tiles, 0);
    case 'trailTiles': return w.trailTiles();
    case 'hikeTiles': return w.hikeTiles();
    case 'mtbTiles': return w.mtbTiles();
    case 'highTrailTiles': return w.highTrailTiles();
    case 'openDays': return c.openDays;
    case 'groomedNights': return f.groomedNights;
    case 'rescues': return f.rescues;
    case 'incidents': return w.incidents(String(arg));
    case 'level': return w.level();
  }
}

export function formatFact(id: string, v: number): string {
  const u = factInfo(id)?.unit;
  return u === 'money' ? `${v < 0 ? '-' : ''}$${fmt(Math.abs(v))}` : u === 'stars' ? `${(Math.round(v * 10) / 10).toFixed(1)}\u2605` : u === 'percent' ? `${Math.round(v)}%` : fmt(v);
}

/** Score formula (see file header). `marginValue` = current value of `score.margin.fact` (0 when none). */
export function computeScore(def: ScenarioDef, met: ReadonlySet<string>, elapsed: number, marginValue: number): number {
  const total = deadlineDays(def.deadline);
  let pts = 0;
  for (const o of def.objectives) if (met.has(o.id)) pts += o.weight;
  const speed = def.score.speedBonus * clamp01(1 - elapsed / total);
  const margin = def.score.margin ? def.score.marginBonus * clamp01(marginValue / def.score.margin.par) : 0;
  return Math.round(pts + speed + margin);
}

export function medalFor(def: ScenarioDef, met: ReadonlySet<string>, score: number): Medal {
  const ok = (r: { objectives?: string[]; minScore?: number }): boolean => (r.objectives ?? []).every((id) => met.has(id)) && score >= (r.minScore ?? 0);
  if (ok(def.medals.gold)) return 'gold';
  if (ok(def.medals.silver)) return 'silver';
  return 'bronze';
}

export const timeLabel = (elapsed: number, total: number): string => {
  const e = Math.max(0, Math.min(total, Math.floor(elapsed)));
  const y = Math.floor(e / DAYS_PER_YEAR) + 1, m = Math.floor((e % DAYS_PER_YEAR) / DAYS_PER_MONTH) + 1;
  const left = Math.max(0, total - e);
  return `Year ${y}, Month ${m} \u00B7 ${left} day${left === 1 ? '' : 's'} left`;
};

export class ScenarioRunner {
  private startAbs = 0;
  private family = 0; private summer = 0; private openDays = 0; private belowDays = 0; private happy = 0; private famHappy = 0;
  sandbox = false;
  private states = new Map<string, ObjState>();
  private done: Omit<ScenarioResult, 'objectives'> | null = null;
  private listeners: Array<() => void> = [];

  constructor(readonly def: ScenarioDef, private readonly world: () => ScenarioWorld, private readonly bus: GameBus) {
    for (const o of def.objectives) this.states.set(o.id, { met: false, failed: false, hold: 0, metDay: null, value: 0, progress: 0 });
    bus.on('guest:arrived', (e) => {
      if (this.done || this.sandbox) return;
      const w = this.world();
      if (w.isFamily(e.id)) this.family++;
      if (w.season() === 'summer') this.summer++;
    });
    bus.on('time:hour', (e) => {
      if (e.hour !== 12 || this.done || this.sandbox) return;
      const w = this.world();
      if (w.openNow()) this.openDays++;
      const h = w.happiness(), f = w.familyHappiness(); // noon sample: guests are in the resort
      if (h >= 0) this.happy = h;
      if (f >= 0) this.famHappy = f;
    });
    bus.on('day:changed', () => this.evaluate());
    bus.on('finance:declaredBankrupt', () => { if (this.def.failure.bankrupt) this.finish('lost', 'The resort went bankrupt.'); });
  }

  onChange(fn: () => void): void { this.listeners.push(fn); }
  private changed(): void { for (const l of this.listeners) l(); }

  /** Called once for a NEW game (not a loaded save): the clock of the scenario starts now. */
  begin(): void { this.startAbs = this.world().today(); this.evaluate(); }

  get finished(): ScenarioResult | null { return this.done ? { ...this.done, objectives: this.objectiveViews() } : null; }
  get active(): boolean { return !this.done && !this.sandbox; }
  get elapsed(): number { return Math.max(0, this.world().today() - this.startAbs); }
  state(id: string): ObjState | undefined { return this.states.get(id); }
  metSet(): Set<string> { return new Set([...this.states].filter(([, s]) => s.met).map(([id]) => id)); }

  private marginValue(): number { const m = this.def.score.margin; return m ? evalFact(this.world(), m.fact, m.arg, this.counters()) : 0; }
  private counters(): Counters { return { family: this.family, summer: this.summer, openDays: this.openDays, happy: this.happy, famHappy: this.famHappy }; }
  score(): number { return computeScore(this.def, this.metSet(), this.done ? this.done.days : this.elapsed, this.marginValue()); }

  /** Daily evaluation. */
  evaluate(): void {
    if (this.done || this.sandbox) return;
    const w = this.world(), elapsed = this.elapsed, total = deadlineDays(this.def.deadline), c = this.counters();
    for (const o of this.def.objectives) this.evalObjective(o, w, elapsed, c);
    // rating-below failure (consecutive days)
    const rb = this.def.failure.ratingBelow;
    if (rb) this.belowDays = w.stars() < rb.stars ? this.belowDays + 1 : 0;
    const mandatory = this.def.objectives.filter((o) => o.mandatory);
    const ready = mandatory.every((o) => this.states.get(o.id)!.met);
    if (this.def.objectives.every((o) => this.states.get(o.id)!.met)) { this.finish('won', 'Every objective met.'); return; }
    const failed = mandatory.find((o) => this.states.get(o.id)!.failed);
    if (failed) { this.finish('lost', `Objective failed: ${failed.title}`); return; }
    if (rb && this.belowDays >= rb.months * DAYS_PER_MONTH) { this.finish('lost', `Rating stayed below ${rb.stars}\u2605 for ${rb.months} month${rb.months === 1 ? '' : 's'}.`); return; }
    if (elapsed >= total) { if (ready) this.finish('won', 'Deadline reached with every required objective met.'); else this.finish('lost', 'Time is up.'); return; }
    this.changed();
  }

  private evalObjective(o: ObjectiveDef, w: ScenarioWorld, elapsed: number, c: Counters): void {
    const s = this.states.get(o.id)!;
    const value = evalFact(w, o.fact, o.arg, c);
    s.value = value;
    const cap = o.op === '<=' || o.op === '<';
    const ok = compare(value, o.op, o.target);
    s.progress = cap ? (ok ? 1 : o.target > 0 ? clamp01(o.target / Math.max(1e-9, value)) : 0) : o.target > 0 ? clamp01(value / o.target) : ok ? 1 : 0;
    if (s.failed) return;
    const latch = !cap || o.hold !== undefined;
    if (s.met && latch) { s.progress = 1; return; }
    if (cap && !ok && factInfo(o.fact)?.mono) { s.failed = true; s.met = false; return; }
    s.hold = ok ? s.hold + 1 : 0;
    const was = s.met;
    s.met = ok && s.hold >= (o.hold ?? 1);
    if (s.met && !was) { s.metDay = elapsed; this.bus.emit('scenario:objective', { id: o.id, title: o.title, met: true }); }
    if (!s.met && !s.failed && o.by && elapsed >= deadlineDays(o.by)) s.failed = true;
  }

  private objectiveViews(): ObjectiveView[] {
    return this.def.objectives.map((o) => {
      const s = this.states.get(o.id)!;
      return { id: o.id, title: o.title, description: o.description ?? '', progress: s.met ? 1 : s.progress, met: s.met, failed: s.failed, mandatory: !!o.mandatory, weight: o.weight, value: s.value, target: o.target, op: o.op, valueText: formatFact(o.fact, s.value), targetText: formatFact(o.fact, o.target), unit: factInfo(o.fact)?.unit ?? 'count' };
    });
  }

  private finish(result: 'won' | 'lost', reason: string): void {
    if (this.done) return;
    const days = this.elapsed, met = this.metSet();
    const score = computeScore(this.def, met, days, this.marginValue());
    const medal: Medal = result === 'won' ? medalFor(this.def, met, score) : 'none';
    this.done = { result, medal, score, days, reason };
    this.bus.emit('scenario:finished', { id: this.def.id, result, medal, score, reason });
    this.changed();
  }

  /** Every mandatory objective is met right now (the scenario can be finished). */
  get ready(): boolean { return this.active && this.def.objectives.filter((o) => o.mandatory).every((o) => this.states.get(o.id)!.met); }
  /** The medal a finish right now would bank. */
  medalNow(): Medal { return this.ready ? medalFor(this.def, this.metSet(), this.score()) : 'none'; }
  /** Finish early with the current medal (the speed bonus is kept). Returns false when not ready. */
  finishNow(): boolean { if (!this.ready) return false; this.finish('won', 'Finished early.'); return true; }

  /** Debug / QA hook: end the scenario now with the given result (`__slope.scenario.forceResult`). */
  forceResult(result: 'won' | 'lost'): void { this.finish(result, result === 'won' ? 'Forced win (debug).' : 'Forced loss (debug).'); }

  /** After a win: keep playing without objectives (the host also opens the unlock gate). */
  continueSandbox(): void { this.sandbox = true; this.changed(); }

  view(): ScenarioView {
    const total = deadlineDays(this.def.deadline), elapsed = this.done ? this.done.days : this.elapsed;
    return {
      id: this.def.id, name: this.def.name, sandbox: this.sandbox, finished: this.finished, ready: this.ready, medalNow: this.medalNow(), elapsed, total,
      daysLeft: Math.max(0, total - Math.floor(elapsed)), timeLabel: timeLabel(elapsed, total), objectives: this.objectiveViews(), score: this.score(),
    };
  }

  serialize(): ScenarioSave {
    const states: Record<string, ObjState> = {};
    for (const [id, s] of this.states) states[id] = { ...s };
    return { v: SCENARIO_VERSION, id: this.def.id, startAbs: this.startAbs, family: this.family, summer: this.summer, openDays: this.openDays, belowDays: this.belowDays, happy: this.happy, famHappy: this.famHappy, sandbox: this.sandbox, states, finished: this.done ? { ...this.done } : null };
  }

  /** Restore; returns false (and leaves the runner fresh) when the data belongs to another scenario or version. */
  load(d: unknown): boolean {
    const o = d as Partial<ScenarioSave> | null;
    if (!o || o.id !== this.def.id || o.v !== SCENARIO_VERSION || typeof o.startAbs !== 'number') return false;
    this.startAbs = o.startAbs; this.family = o.family ?? 0; this.summer = o.summer ?? 0; this.openDays = o.openDays ?? 0; this.belowDays = o.belowDays ?? 0; this.happy = o.happy ?? 0; this.famHappy = o.famHappy ?? 0; this.sandbox = !!o.sandbox;
    for (const ob of this.def.objectives) { const s = o.states?.[ob.id]; if (s) this.states.set(ob.id, { met: !!s.met, failed: !!s.failed, hold: s.hold ?? 0, metDay: s.metDay ?? null, value: s.value ?? 0, progress: s.progress ?? 0 }); }
    this.done = o.finished ? { ...o.finished } : null;
    return true;
  }
}
