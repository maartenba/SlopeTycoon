/**
 * Advisor (M5.1 Task 4): Ranger Rudi's "What should I do next?". Pure read of the sim; never builds anything.
 *  - Cheap rules re-run every in-game hour (`time:hour`), all rules once per day (`day:changed`).
 *  - Hysteresis: a rule fires -> advice is live at once; it stays live until the rule has been silent for `HOLD` evaluations in a row, and while live the
 *    rule uses its looser `keep` thresholds (see rules.ts). Order is sticky too (the currently shown advice gets a small bonus).
 *  - Ranking = severity x player impact x recency (new advice is up to 1.5x for 3 in-game days); ties by id. Top `SHOWN` are shown.
 *  - "Dismiss" snoozes one advice for `SNOOZE_DAYS` in-game days (saved in the `advisor` module). Live advice itself is derived state (not saved).
 * No three / DOM imports.
 */
import type { GameBus } from '../../core/events';
import type { Sim } from '../../game/createSim';
import { DAYS_PER_YEAR } from '../../config/balance';
import { seasonOf } from '../Clock';
import { validatePlacement } from '../PlaceBuilding';
import { autoFlattenDefault } from '../PlacementRules';
import type { Site } from '../../tutorial/suggest';
import { RULES, computePisteFacts, type Advice, type PisteFacts, type Rule, type RuleCtx } from './rules';

export type { Advice, AdviceAction, AdviceTarget, Severity, Rule } from './rules';

export const SHOWN = 3;
export const SNOOZE_DAYS = 30;
const HOLD = 2;
const SEVERITY_W = { info: 1, warn: 2, urgent: 3 } as const;
const STICKY = 1.15;
/** Cached "no site" verdicts are retried after this many in-game days. */
const NO_SITE_RETRY_DAYS = 5;

interface Live { advice: Advice; since: number; miss: number }
export interface AdvisorSave { snooze: Array<[string, number]>; dismissed: number }

export class Advisor {
  /** True while the tutorial runs: advice is hidden and nothing is evaluated. Not saved. */
  paused = false;
  /** Total dismissals (saved; telemetry for tests/recap). */
  dismissed = 0;
  private live = new Map<string, Live>();
  private snooze = new Map<string, number>();
  private shownIds: string[] = [];
  private sites = new Map<string, { site: Site | null; type: string; day: number }>();
  private listeners: Array<() => void> = [];
  private lastSig = '';
  private dirty = false;

  private simRef: Sim | null = null;
  private get sim(): () => Sim { return () => this.simRef!; }

  constructor(bus: Pick<GameBus, 'on'>, readonly rules: readonly Rule[] = RULES) {
    // Every rule runs every in-game hour (a few thousand cheap reads), so advice follows the STATE of the resort within the hour, whatever the player did.
    bus.on('time:hour', () => { const changed = this.dirty; this.dirty = false; this.evaluate(true, changed); });
    bus.on('day:changed', () => this.evaluate(true));
    // The resort changed (any building / road / lift): the next hourly evaluation runs EVERY rule, so advice about a missing or unconnected
    // building disappears within the hour once the state is fine, wherever the player built it.
    for (const ev of ['building:placed', 'building:removed', 'path:drawn', 'piste:painted', 'lift:built', 'lift:opened', 'loan:taken', 'marketing:started', 'marketing:cancelled', 'weather:changed'] as const) bus.on(ev, () => { this.dirty = true; });
  }

  /** Bind the sim (createSim does this right after building it; the advisor reads the sim, it cannot be built first). */
  attach(sim: Sim): void { this.simRef = sim; }

  onChange(fn: () => void): void { this.listeners.push(fn); }

  private today(): number { const d = this.sim().game.date; return d.year * DAYS_PER_YEAR + d.day; }
  private now(): number { const d = this.sim().game.date; return d.year * DAYS_PER_YEAR + d.day + d.minute / 1440; }

  // ---- evaluation ----
  /** Run the rules. `full` = every rule (daily); otherwise only the cheap ones (hourly). `changed` = the resort was changed by the player: a rule that stopped firing is dropped at once (no hold). */
  evaluate(full: boolean, changed = false): void {
    if (this.paused || !this.simRef) return;
    const sim = this.simRef;
    let pf: PisteFacts | null = null;
    const ctx: RuleCtx = {
      sim, shown: false, season: seasonOf(sim.game.date),
      pistes: () => (pf ??= computePisteFacts(sim)),
      site: (key, type, find) => this.siteFor(key, type, find),
    };
    const now = this.now();
    for (const r of this.rules) {
      if (!full && !r.cheap) continue;
      ctx.shown = this.live.has(r.id);
      const a = r.eval(ctx);
      const cur = this.live.get(r.id);
      if (a) {
        const checked = this.sanitise(a);
        this.live.set(r.id, { advice: checked, since: cur?.since ?? now, miss: 0 });
      } else if (cur && (r.instant || changed || ++cur.miss >= HOLD)) this.live.delete(r.id);
    }
    this.publish();
  }

  /** A proposed site must still pass the placement rules; otherwise only the building type is named. */
  private sanitise(a: Advice): Advice {
    const act = a.action;
    if (!act?.site) return a;
    if (this.valid(act.building, act.site)) return a;
    const { site: _drop, ...rest } = act; void _drop;
    return { ...a, action: rest };
  }

  private valid(type: string, s: { x: number; y: number; rot: number }): boolean {
    const chk = validatePlacement(this.sim().env, type, s.x, s.y, s.rot, autoFlattenDefault(type));
    return chk.reasons.every((q) => q.startsWith('Not enough funds'));
  }

  private siteFor(key: string, type: string, find: () => Site | null): Site | null {
    const day = this.today(), c = this.sites.get(key);
    if (c && c.type === type) {
      if (c.site ? this.valid(type, c.site) : day - c.day < NO_SITE_RETRY_DAYS) return c.site;
    }
    const site = find();
    this.sites.set(key, { site, type, day });
    return site;
  }

  // ---- ranking / views ----
  private score(id: string, l: Live, now: number): number {
    const rule = this.rules.find((r) => r.id === id)!;
    const recency = 1 + 0.5 * Math.max(0, 1 - (now - l.since) / 3);
    return SEVERITY_W[l.advice.severity] * rule.impact * recency * (this.shownIds.includes(id) ? STICKY : 1);
  }

  /** Every live, non-snoozed advice, best first. */
  ranked(): Advice[] {
    const now = this.now(), today = this.today();
    const rows = [...this.live.entries()].filter(([id]) => (this.snooze.get(id) ?? -1) <= today).map(([id, l]) => ({ id, l, s: this.score(id, l, now) }));
    rows.sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return rows.map((r) => r.l.advice);
  }
  /** The advice shown in Ranger Rudi's card (top 3). Empty while paused. */
  top(): Advice[] { return this.paused ? [] : this.ranked().slice(0, SHOWN); }
  /** How many pieces of advice are waiting (badge). */
  count(): number { return this.paused ? 0 : this.ranked().length; }
  isSnoozed(id: string): boolean { return (this.snooze.get(id) ?? -1) > this.today(); }

  dismiss(id: string): void {
    this.snooze.set(id, this.today() + SNOOZE_DAYS);
    this.dismissed++;
    this.publish();
  }

  private publish(): void {
    this.shownIds = this.ranked().slice(0, SHOWN).map((a) => a.id);
    const sig = `${this.paused}|${this.count()}|${JSON.stringify(this.top())}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    for (const l of this.listeners) l();
  }
  /** Re-publish (e.g. after pause/resume or load). */
  refresh(): void { this.lastSig = ''; this.publish(); }

  // ---- save ----
  serialize(): AdvisorSave { return { snooze: [...this.snooze.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)), dismissed: this.dismissed }; }
  load(d: unknown): void {
    const o = (d ?? {}) as Partial<AdvisorSave>;
    this.snooze = new Map((o.snooze ?? []).filter((e) => Array.isArray(e) && typeof e[0] === 'string' && Number.isFinite(e[1])));
    this.dismissed = o.dismissed ?? 0;
    this.live.clear(); this.sites.clear(); this.shownIds = [];
    this.refresh();
  }
  reset(): void { this.load({}); }
}
