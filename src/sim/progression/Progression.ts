/**
 * Resort level + selective unlocks (M5.3, Task 14). Pure function of sim state, evaluated once per game day (`day:changed`), LATCHED: the level never
 * decreases. Thresholds: `config/progression.ts`; gated items: `config/unlocks.ts`. No RNG, no three / DOM.
 *
 *  - Career: level 1..6; `locked(kind, id)` answers for the validators (placement, lifts, marketing).
 *  - Sandbox: everything unlocked, no level tracked, no events (old saves load as Sandbox).
 *  - `unlockAll` (the tutorial sets it for its whole run) and `bypass` (starter / demo resort builders) make `locked` return null without touching the level.
 *  - Level-up: ONE major `milestone` (confetti + important news row) per evaluation, even if several levels were gained at once, and a callback with
 *    the newly unlocked items (the UI shows the 'New: ...' card).
 *  - The save keeps the latched level, the mode, a snapshot of the unlocked item keys (so a later change of the table never re-locks a built item) and the history.
 */
import type { GameBus } from '../../core/events';
import { DEFAULT_MODE, GAME_MODES, LEVELS, MAX_LEVEL, levelDef, levelName, type GameMode, type LevelDef } from '../../config/progression';
import { UNLOCKS, key, lockedReason, unlockLevel, unlockName, type UnlockDef, type UnlockGate, type UnlockKind } from '../../config/unlocks';

/** The measured facts a level depends on (adapter built in createSim from the real sim; fixtures in tests). */
export interface ProgressInputs {
  stars(): number;
  /** Lifetime arrivals. */
  guests(): number;
  /** Best single day of arrivals. */
  peakDay(): number;
  /** Months closed with a positive net. */
  profitMonths(): number;
  /** Goal chapters completed. */
  chapters(): number;
  /** Net profit of the last 12 closed months. */
  annualProfit(): number;
  /** Calendar position stamped on the level-up history. */
  date(): { year: number; day: number };
}

export type CriterionId = 'stars' | 'guests' | 'peakDay' | 'profitMonths' | 'chapters' | 'annualProfit';
export interface Criterion { id: CriterionId; label: string; have: number; need: number; met: boolean; progress: number }
export interface LevelUp { level: number; name: string; unlocked: UnlockDef[] }
export interface LevelHistoryRow { level: number; year: number; day: number }
export interface ProgressView {
  mode: GameMode; level: number; name: string; max: boolean;
  /** Next level (null at the top). */
  next: { level: number; name: string } | null;
  /** Overall progress to the next level 0..1 (mean of the criteria; 1 at the top). */
  progress: number;
  /** Every criterion of the next level, unmet ones first (UI shows the first 2-3). */
  criteria: Criterion[];
  /** Items the next level unlocks. */
  nextUnlocks: UnlockDef[];
}
export interface ProgressionSave { mode: GameMode; level: number; unlocked: string[]; history: LevelHistoryRow[] }

const clamp01 = (v: number): number => (Number.isNaN(v) || v < 0 ? 0 : v > 1 ? 1 : v);
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const money = (n: number): string => `$${fmt(n)}`;

export function criteriaFor(d: LevelDef, i: Pick<ProgressInputs, 'stars' | 'guests' | 'peakDay' | 'profitMonths' | 'chapters' | 'annualProfit'>): Criterion[] {
  const out: Criterion[] = [];
  const add = (id: CriterionId, label: string, have: number, need: number): void => {
    if (!(need > 0)) return; // 0 / -Infinity = no requirement
    out.push({ id, label, have, need, met: have >= need, progress: clamp01(have / need) });
  };
  if (d.stars > 0) add('stars', `${d.stars}\u2605 rating`, i.stars(), d.stars);
  if (d.guests > 0) add('guests', `${fmt(d.guests)} guests in total`, i.guests(), d.guests);
  if (d.peakDay > 0) add('peakDay', `${fmt(d.peakDay)} guests in one day`, i.peakDay(), d.peakDay);
  if (d.profitMonths > 0) add('profitMonths', `${d.profitMonths} months in profit`, i.profitMonths(), d.profitMonths);
  if (d.chapters > 0) add('chapters', `${d.chapters} goal chapter${d.chapters === 1 ? '' : 's'} done`, i.chapters(), d.chapters);
  if (d.annualProfit > 0) add('annualProfit', `${money(d.annualProfit)} profit over 12 months`, i.annualProfit(), d.annualProfit);
  return out;
}

export class Progression implements UnlockGate {
  /** Latched level 1..6 (1 in Sandbox). */
  level = 1;
  /** Everything unlocked while set (the tutorial). Not saved. */
  unlockAll = false;
  /** Placement made by a builder (starter / demo resort) skips the gate while > 0. Not saved. */
  private bypass = 0;
  history: LevelHistoryRow[] = [];
  /** Scenario rules (disabled buildings, restricted unlock list): a reason text locks the item even in Sandbox. Set by createSim. Not saved. */
  extraLock: ((kind: UnlockKind, id: string) => string | null) | null = null;
  private unlocked = new Set<string>();
  private listeners: Array<(u: LevelUp) => void> = [];
  private changed: Array<() => void> = [];

  constructor(private readonly inputs: ProgressInputs, bus: GameBus, public mode: GameMode = DEFAULT_MODE) {
    this.bus = bus;
    bus.on('day:changed', () => this.evaluate());
    this.snapshot();
  }
  private readonly bus: GameBus;

  get career(): boolean { return this.mode === 'career'; }
  /** True when the gate currently lets everything through. */
  get open(): boolean { return this.mode === 'sandbox' || this.unlockAll || this.bypass > 0; }
  onLevelUp(fn: (u: LevelUp) => void): void { this.listeners.push(fn); }
  onChange(fn: () => void): void { this.changed.push(fn); }

  /** Run `fn` with the gate open (builders of pre-made resorts). */
  withBypass<T>(fn: () => T): T { this.bypass++; try { return fn(); } finally { this.bypass--; } }

  // ---- gate ----
  /** `null` = available; otherwise 'Unlocks at level N: Name'. */
  locked(kind: UnlockKind, id: string): string | null {
    if (this.unlockAll || this.bypass > 0) return null;
    const extra = this.extraLock?.(kind, id);
    if (extra) return extra;
    if (this.open) return null;
    const need = unlockLevel(kind, id);
    if (need <= 1 || this.level >= need || this.unlocked.has(key(kind, id))) return null;
    return lockedReason(need);
  }
  isUnlocked(kind: UnlockKind, id: string): boolean { return this.locked(kind, id) === null; }

  // ---- level ----
  /** The level the CURRENT facts qualify for (not latched). */
  computedLevel(): number {
    let lvl = 1;
    for (const d of LEVELS) if (d.level > 1 && criteriaFor(d, this.inputs).every((c) => c.met)) lvl = d.level; else if (d.level > 1) break;
    return lvl;
  }

  /** Daily evaluation: latch the highest qualified level; fires the level-up once for the whole jump. */
  evaluate(): void {
    if (this.mode !== 'career' || this.level >= MAX_LEVEL) return;
    const to = this.computedLevel();
    if (to > this.level) this.advance(to);
  }

  private advance(to: number): void {
    const from = this.level, unlocked = UNLOCKS.filter((u) => u.level > from && u.level <= to);
    this.level = to;
    const d = this.inputs.date();
    for (let l = from + 1; l <= to; l++) this.history.push({ level: l, year: d.year, day: d.day });
    this.snapshot();
    const name = levelName(to);
    this.bus.emit('milestone', { id: `level:${to}`, title: `Level ${to}: ${name}${unlocked.length ? `. New: ${unlocked.slice(0, 3).map((u) => unlockName(u.kind, u.id)).join(', ')}${unlocked.length > 3 ? ` and ${unlocked.length - 3} more` : ''}` : ''}`, major: true });
    for (const l of this.listeners) l({ level: to, name, unlocked });
    for (const l of this.changed) l();
  }

  /** Debug / test hook: jump to a level as if earned (latched, fires the normal level-up). Only ever raises. */
  setLevel(n: number): void {
    const to = Math.max(1, Math.min(MAX_LEVEL, Math.trunc(n)));
    if (this.mode === 'career' && to > this.level) this.advance(to);
  }

  /** Remember every item unlocked at the current level so a later change of the table can never re-lock it. */
  private snapshot(): void { for (const u of UNLOCKS) if (u.level <= this.level) this.unlocked.add(key(u.kind, u.id)); }

  view(): ProgressView {
    const next = this.level < MAX_LEVEL ? levelDef(this.level + 1) : null;
    const criteria = next ? criteriaFor(next, this.inputs).sort((a, b) => Number(a.met) - Number(b.met) || a.progress - b.progress) : [];
    const progress = next ? (criteria.length ? criteria.reduce((a, c) => a + c.progress, 0) / criteria.length : 1) : 1;
    return {
      mode: this.mode, level: this.level, name: levelName(this.level), max: !next,
      next: next ? { level: next.level, name: next.name } : null, progress, criteria,
      nextUnlocks: next ? UNLOCKS.filter((u) => u.level === next.level) : [],
    };
  }

  // ---- save ----
  serialize(): ProgressionSave { return { mode: this.mode, level: this.level, unlocked: [...this.unlocked].sort(), history: this.history.map((h) => ({ ...h })) }; }
  load(d: unknown): void {
    const o = d as Partial<ProgressionSave>;
    this.mode = GAME_MODES.includes(o.mode as GameMode) ? (o.mode as GameMode) : 'sandbox';
    this.level = Math.max(1, Math.min(MAX_LEVEL, Math.trunc(Number(o.level) || 1)));
    this.unlocked = new Set((o.unlocked ?? []).filter((k) => typeof k === 'string'));
    this.history = (o.history ?? []).map((h) => ({ level: h.level, year: h.year, day: h.day }));
    this.snapshot();
  }
  /** Save without this module (older game): Sandbox, everything open. */
  reset(): void { this.mode = 'sandbox'; this.level = 1; this.unlocked.clear(); this.history = []; }
}
