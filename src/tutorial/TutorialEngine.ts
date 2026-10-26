import type { Sim } from '../game/createSim';
import type { Speed } from '../core/events';
import { Queries, GOALS } from './queries';
import type { ChangeSink, Change, ActionResult } from './suggest';
import { settle } from './suggest';
import { STRINGS, hintKey, stepKey, t } from './strings';

import type { RudiExpression } from '../ui/components/rudiAvatar';
export type Expression = RudiExpression;

/** A highlighted world area (tile rect), draped on the terrain by `render/TutorialMarker`. */
export interface MapMark { x: number; y: number; w: number; h: number; ok: boolean; /** Optional second area (e.g. top station of a lift). */ extra?: { x: number; y: number; w: number; h: number } | null; /** Optional route/line of tiles to drape (piste, road, footpath). */ line?: Array<{ x: number; y: number }> | null }

export interface ShowMeResult {
  /** Ordered UI target chain (shallow → deep); the spotlight highlights the deepest one that is visible. See ui-targets.ts. */
  ui: string[];
  map: MapMark | null;
  /** True when there is a valid thing to point at (a UI target and, for map steps, a valid site). */
  valid: boolean;
  /** Extra string key explaining the spot (defaults to `step.<id>.show`). */
  noteKey?: string;
  noteArgs?: Record<string, string | number>;
}

export interface DoPlan { cost: number; perform(): ActionResult }

/** Host actions the engine cannot do headlessly (main.ts supplies them; all optional). */
export interface TutorialHost {
  /** Mirror a world change in the renderer (meshes, props, lift views, overlays). */
  changed?: ChangeSink;
  camera?(): { x: number; y: number; yaw: number; zoom: number };
  jumpToDay?(day: number): void;
  save?(): void | Promise<void>;
  setSpeed?(s: Speed): void;
  /** Headless fast-forward (tests); the live game uses setSpeed instead. */
  fastForward?(ticks: number): void;
  setOverlay?(mode: string): void;
}

export interface StepCtx { sim: Sim; q: Queries; sink: ChangeSink; host: TutorialHost; /** Latch a UI fact (e.g. the camera step does it for the player). */ notify(flag: string): void }

export interface Step {
  id: string;
  /** Default UI target chain (also used when `showMe` returns none). */
  ui: string[];
  /** Re-checked after completion: when the predicate turns false (prerequisite deleted) the tutorial steps back. */
  structural?: boolean;
  /** Completed by the 'Got it' button (information steps). */
  ack?: boolean;
  /** Offered a different button label for the do-it action. */
  doLabel?: 'jump';
  expr?: Expression;
  isApplicable?(q: Queries): boolean;
  isComplete(q: Queries): boolean;
  onEnter?(ctx: StepCtx): void;
  showMe(ctx: StepCtx): ShowMeResult;
  doItForMe?(ctx: StepCtx): DoPlan | null;
}

export interface TutorialState {
  v: 1;
  enabled: boolean;
  finished: boolean;
  current: string | null;
  completed: string[];
  skipped: string[];
  flags: string[];
  /** One-shot hints already delivered / dismissed. */
  hints: string[];
  hintsEnabled: boolean;
  /** Assist was used once (the first one is free). */
  assisted: boolean;
  minimised: boolean;
}

export const TUTORIAL_KEY = 'slope.tutorial.v1';
export const ASSIST_FEE = 150;
export const FUNDING_BUFFER = 2000;

const blank = (): TutorialState => ({ v: 1, enabled: false, finished: false, current: null, completed: [], skipped: [], flags: [], hints: [], hintsEnabled: true, assisted: false, minimised: false });

/** Persistence of the tutorial state machine (and the dismissed-hints set) in localStorage. */
export class TutorialStore {
  state: TutorialState = blank();
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null, private readonly key = TUTORIAL_KEY) { this.load(); }

  load(): TutorialState {
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw) {
        const o = JSON.parse(raw) as Partial<TutorialState>;
        if (o && o.v === 1) {
          const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
          this.state = { ...blank(), enabled: !!o.enabled, finished: !!o.finished, current: typeof o.current === 'string' ? o.current : null, completed: arr(o.completed), skipped: arr(o.skipped), flags: arr(o.flags), hints: arr(o.hints), hintsEnabled: o.hintsEnabled !== false, assisted: !!o.assisted, minimised: !!o.minimised };
        }
      }
    } catch { /* corrupt or unavailable storage: start fresh */ }
    return this.state;
  }
  save(): void { try { this.storage?.setItem(this.key, JSON.stringify(this.state)); } catch { /* quota / private mode */ } }
  reset(keepHints = true): void {
    const { hints, hintsEnabled } = this.state;
    this.state = { ...blank(), ...(keepHints ? { hints, hintsEnabled } : {}) };
    this.save();
  }
}

export interface StepView {
  id: string; title: string; text: string; index: number; total: number; expr: Expression;
  /** 'Got it' (ack) is available. */
  canNext: boolean; canSkip: boolean; ack: boolean;
  doLabel: 'default' | 'jump'; price: number | null; canDo: boolean;
}
export interface EngineView {
  status: 'off' | 'active' | 'complete' | 'blocked';
  step: StepView | null;
  /** UI target chain / map mark of the last 'Show me' on this step (null until pressed). */
  ui: string[] | null;
  map: MapMark | null;
  note: string | null;
  message: string | null;
  minimised: boolean;
  goals: { guests: { done: boolean; have: number; need: number }; stars: { done: boolean; have: number; need: number }; profit: { done: boolean } } | null;
  completedCount: number;
}

export interface EngineOpts {
  sim: Sim;
  steps: Step[];
  host?: TutorialHost;
  store?: TutorialStore;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** Tutorial-mode funding: top up cash to a step's cost when the player is short (documented; off outside the tutorial). */
  fundingTopUp?: boolean;
  /** Real-time poll interval in ms (0 = none; tests call `poll()`). */
  pollMs?: number;
}

const EVALUATE_EVENTS = ['building:placed', 'building:removed', 'path:drawn', 'piste:painted', 'lift:built', 'lift:opened', 'speed:changed', 'loan:taken', 'season:changed', 'rating:changed', 'day:changed', 'marketing:started', 'finance:monthClosed'] as const;
const DIRTY_EVENTS = ['guest:arrived', 'money:changed', 'time:hour'] as const;

/**
 * Data-driven, completion-driven tutorial. Progress is always derived from WORLD STATE (`Step.isComplete(q)`), re-evaluated on typed
 * events and a low-rate poll; no timers gate progress. The player is never locked: the engine only tracks, highlights and (on request) acts.
 */
export class TutorialEngine {
  readonly sim: Sim;
  readonly q: Queries;
  readonly store: TutorialStore;
  readonly steps: Step[];
  readonly host: TutorialHost;
  private readonly flags: Set<string>;
  private readonly fundingTopUp: boolean;
  private cur: Step | null = null;
  private hintStale = false;
  private shown: { stepId: string; res: ShowMeResult } | null = null;
  private message: string | null = null;
  private mood: Expression | null = null;
  private listeners = new Set<() => void>();
  private unsubs: Array<() => void> = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;
  private evaluating = false;
  private lastSig = '';
  private camBase: { x: number; y: number; yaw: number; zoom: number } | null = null;
  private pollMs: number;

  constructor(o: EngineOpts) {
    this.sim = o.sim; this.steps = o.steps; this.host = o.host ?? {};
    this.store = o.store ?? new TutorialStore(o.storage ?? null);
    this.flags = new Set(this.store.state.flags);
    this.q = new Queries(o.sim, this.flags);
    this.fundingTopUp = o.fundingTopUp ?? false;
    this.pollMs = o.pollMs ?? 0;
  }

  // ------------------------------------------------------------ lifecycle
  get state(): TutorialState { return this.store.state; }
  get enabled(): boolean { return this.state.enabled; }
  get current(): Step | null { return this.cur; }
  get status(): EngineView['status'] {
    if (!this.state.enabled) return 'off';
    if (this.state.finished) return 'complete';
    if (this.q.gameOver()) return 'blocked';
    return this.cur ? 'active' : 'complete';
  }

  /** Begin (or resume) the tutorial and subscribe to gameplay events. */
  start(opts: { fresh?: boolean } = {}): void {
    if (opts.fresh) { this.flags.clear(); this.store.reset(true); }
    this.state.enabled = true;
    this.state.finished = false;
    this.applyUnlocks();
    this.subscribe();
    this.camBase = this.host.camera?.() ?? null;
    if (this.pollMs > 0 && !this.timer) this.timer = setInterval(() => this.poll(), this.pollMs);
    this.evaluate(true);
  }

  /** Hints keep working with the tutorial off; this stops tutorial tracking only. */
  stop(): void {
    this.applyUnlocks(false);
    this.unsubscribe();
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  dispose(): void { this.stop(); this.listeners.clear(); }

  /** Career unlocks (M5.3): while the lessons run EVERYTHING is unlocked so the tutorial can never be blocked; off again when it finishes / is left. */
  private applyUnlocks(on = this.state.enabled && !this.state.finished): void {
    const p = (this.sim as Partial<Sim>).progression;
    if (p) p.unlockAll = on;
  }

  exit(): void {
    this.state.enabled = false;
    this.cur = null; this.shown = null;
    this.message = t('msg.exited');
    this.stop();
    this.persist();
    this.emit(true);
  }

  /** Replay from the start (progress cleared; hints keep their dismissed set). */
  replay(): void { this.stop(); this.start({ fresh: true }); }

  setMinimised(v: boolean): void { this.state.minimised = v; this.persist(); this.emit(true); }

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  private subscribe(): void {
    if (this.unsubs.length) return;
    const bus = this.sim.bus;
    for (const e of EVALUATE_EVENTS) this.unsubs.push(bus.on(e, ((p: unknown) => { this.onEvent(e, p); this.evaluate(); }) as never));
    for (const e of DIRTY_EVENTS) this.unsubs.push(bus.on(e, ((p: unknown) => { this.onEvent(e, p); this.dirty = true; }) as never));
  }
  private unsubscribe(): void { for (const u of this.unsubs) u(); this.unsubs = []; }

  private onEvent(e: string, p: unknown): void {
    if (e === 'speed:changed') this.flags.add(`speed:${(p as { speed: number }).speed}`);
    else if (e === 'season:changed') this.flags.add(`season:${(p as { season: string }).season}`);
    else if (e === 'guest:arrived') this.flags.add('guests:arrived');
    else if (e === 'loan:taken') this.flags.add('loan:taken');
    else if (e === 'marketing:started') this.flags.add('marketing:started');
    if (e === 'building:placed' || e === 'building:removed' || e === 'path:drawn' || e === 'piste:painted' || e === 'lift:built') this.hintStale = true;
  }

  /** Low-rate real-time tick: camera facts + any queued re-evaluation. */
  poll(): void {
    this.pollCamera();
    this.evaluate(this.dirty);
  }

  private pollCamera(): void {
    const c = this.host.camera?.();
    if (!c) return;
    if (!this.camBase) { this.camBase = c; return; }
    const b = this.camBase;
    let d = Math.abs(c.yaw - b.yaw) % (Math.PI * 2);
    d = Math.min(d, Math.PI * 2 - d);
    if (d > 0.1) this.flags.add('camera:rotate');
    if (Math.hypot(c.x - b.x, c.y - b.y) > 2) this.flags.add('camera:pan');
    if (Math.abs(Math.log((c.zoom || 1) / (b.zoom || 1))) > 0.08) this.flags.add('camera:zoom');
  }

  /** Latch a UI fact from outside (e.g. 'select:building', 'overlay:cycled', 'game:saved'). */
  notify(flag: string): void {
    if (this.flags.has(flag)) return;
    this.flags.add(flag);
    this.evaluate();
  }

  // ------------------------------------------------------------ evaluation
  private ctx(): StepCtx { return { sim: this.sim, q: this.q, sink: (c: Change) => this.host.changed?.(c), host: this.host, notify: (f: string) => { this.flags.add(f); } }; }

  private applicable(s: Step): boolean { return !s.isApplicable || s.isApplicable(this.q); }

  /** First applicable, un-skipped step whose predicate is not (or no longer) satisfied; marks satisfied steps as completed. */
  evaluate(force = false): void {
    if (this.evaluating || !this.state.enabled) return;
    this.evaluating = true;
    this.dirty = false;
    try {
      const st = this.state;
      const done = new Set(st.completed), skipped = new Set(st.skipped);
      const g = this.q.goals();
      for (const k of ['guests', 'stars', 'profit'] as const) if (g[k]) this.flags.add(`goal:${k}`);
      if (st.finished) { // lessons are over: only the goals keep being tracked
        this.cur = null; st.current = null; st.flags = [...this.flags];
        if (g.guests && g.stars && g.profit && !this.flags.has('goals:celebrated')) { this.flags.add('goals:celebrated'); this.message = t('msg.goalsReached'); this.mood = 'cheer'; }
        this.persist(); this.emit(force);
        return;
      }
      let next: Step | null = null;
      for (const s of this.steps) {
        if (skipped.has(s.id) || !this.applicable(s)) continue;
        if (s.isComplete(this.q)) { done.add(s.id); continue; }
        if (done.has(s.id) && !s.structural) continue; // latched (progress facts, speed settings…)
        done.delete(s.id);
        next = s;
        break;
      }
      const prevIdx = this.cur ? this.steps.indexOf(this.cur) : -1;
      const prev = this.cur;
      st.completed = [...done];
      st.flags = [...this.flags];
      if (next !== prev) {
        this.cur = next;
        this.shown = null;
        this.message = null;
        this.mood = prev && next ? 'cheer' : null;
        if (next && prev && this.steps.indexOf(next) < prevIdx) { this.message = t('msg.stepBack', { title: t(stepKey(next.id, 'title')) }); this.mood = 'worried'; }
        if (next) { try { next.onEnter?.(this.ctx()); } catch { /* onEnter is advisory */ } }
      }
      st.current = next ? next.id : null;
      if (!next && !st.finished) { st.finished = true; this.applyUnlocks(); this.message = t('msg.complete'); this.mood = 'cheer'; }
      // A 'Show me' spot is only a hint: when the world changed (building / road / lift / piste) re-validate it so the marker never points at ground that is no longer free.
      if (this.shown && next && this.shown.stepId === next.id && this.hintStale) {
        try { this.shown = { stepId: next.id, res: next.showMe(this.ctx()) }; } catch { /* keep the old hint */ }
      }
      this.hintStale = false;
      this.persist();
      this.emit(force);
    } finally { this.evaluating = false; }
  }

  private persist(): void { this.store.save(); }

  // ------------------------------------------------------------ player actions
  /** 'Got it' on information steps (or any step whose predicate is already true). */
  next(): void {
    const s = this.cur;
    if (!s) return;
    if (s.ack) this.flags.add(`ack:${s.id}`);
    this.evaluate();
  }

  /** Skip the current step (never softlocks; dependent steps become not applicable). */
  skip(): void {
    const s = this.cur;
    if (!s) return;
    if (!this.state.skipped.includes(s.id)) this.state.skipped.push(s.id);
    this.message = null;
    this.evaluate(true);
  }

  /** Step back to the previous step (un-skips / un-acknowledges it). */
  previous(): void {
    const idx = this.cur ? this.steps.indexOf(this.cur) : this.steps.length;
    for (let i = idx - 1; i >= 0; i--) {
      const s = this.steps[i]!;
      if (!this.applicable(s)) continue;
      this.state.skipped = this.state.skipped.filter((x) => x !== s.id);
      this.state.completed = this.state.completed.filter((x) => x !== s.id);
      this.flags.delete(`ack:${s.id}`);
      this.cur = null; // force re-pick (message suppressed)
      this.evaluate(true);
      return;
    }
  }

  /** 'Show me': the UI chain, plus a validated map spot where the step builds something. */
  showMe(): ShowMeResult {
    const s = this.cur;
    if (!s) return { ui: [], map: null, valid: false };
    let res: ShowMeResult;
    try { res = s.showMe(this.ctx()); } catch { res = { ui: s.ui, map: null, valid: false }; }
    if (!res.ui.length) res = { ...res, ui: s.ui };
    this.shown = { stepId: s.id, res };
    this.message = null;
    this.emit(true);
    return res;
  }

  /** Price estimate of doing the current step for the player (assist fee included), or null when impossible. */
  estimate(): { cost: number } | null {
    const s = this.cur;
    if (!s || !s.doItForMe || this.q.gameOver()) return null;
    let plan: DoPlan | null = null;
    try { plan = s.doItForMe(this.ctx()); } catch { plan = null; }
    return plan ? { cost: plan.cost + this.fee() } : null;
  }

  private fee(): number { return this.state.assisted ? ASSIST_FEE : 0; }

  /** 'Do it for me': performs the step through the real APIs; deducts the real cost (+ small fee after the first use). */
  doItForMe(): ActionResult {
    const s = this.cur;
    if (!s) return { ok: false, cost: 0, reason: 'no-step' };
    if (this.q.gameOver()) { this.message = t('msg.failed', { reason: t('reason.gameOver') }); this.emit(true); return { ok: false, cost: 0, reason: 'game-over' }; }
    let plan: DoPlan | null = null;
    try { plan = s.doItForMe?.(this.ctx()) ?? null; } catch { plan = null; }
    if (!plan) { this.message = t(s.id === 'lift' ? 'msg.noLift' : 'msg.noSite'); this.mood = 'worried'; this.emit(true); return { ok: false, cost: 0, reason: 'no-plan' }; }
    let fundNote = '';
    const fee = this.fee();
    const need = plan.cost + fee;
    if (this.sim.game.money < need) {
      if (this.fundingTopUp) {
        const top = Math.ceil(need - this.sim.game.money + FUNDING_BUFFER);
        this.sim.economy.deposit(top, 'tutorial funding');
        fundNote = t('msg.funding', { amount: `$${top.toLocaleString('en-US')}` }) + ' ';
      } else {
        this.message = t('msg.needMoney', { price: `$${Math.ceil(need).toLocaleString('en-US')}` });
        this.emit(true);
        return { ok: false, cost: need, reason: 'funds' };
      }
    }
    if (fee > 0 && !this.sim.economy.charge(fee, 'other')) { this.message = t('msg.failed', { reason: t('reason.funds') }); this.emit(true); return { ok: false, cost: 0, reason: 'funds' }; }
    const res = plan.perform();
    let msg: string, mood: Expression;
    if (res.ok) {
      this.state.assisted = true;
      settle(this.sim);
      msg = fundNote + t('msg.done', { price: `$${Math.round(res.cost + fee).toLocaleString('en-US')}` }); mood = 'cheer';
    } else {
      if (fee > 0) this.sim.economy.refund(fee, 'other');
      msg = t('msg.failed', { reason: res.reason ?? '?' }); mood = 'worried';
    }
    this.evaluate(true);
    this.message = msg; this.mood = mood;
    this.emit(true);
    return { ...res, cost: res.cost + (res.ok ? fee : 0) };
  }

  // ------------------------------------------------------------ view
  view(): EngineView {
    const total = this.steps.length;
    const goals = this.q.goals();
    const gview = {
      guests: { done: goals.guests, have: this.q.guests, need: GOALS.guests },
      stars: { done: goals.stars, have: this.q.stars, need: GOALS.stars },
      profit: { done: goals.profit },
    };
    const allGoals = goals.guests && goals.stars && goals.profit;
    const s = this.cur;
    let step: StepView | null = null;
    if (s && this.state.enabled) {
      const est = this.estimate();
      const live = this.sim.loop.speed;
      step = {
        id: s.id, title: t(stepKey(s.id, 'title')), text: t(stepKey(s.id, 'text')) + (s.id === 'guests' ? (live === 0 ? ' ' + t('msg.paused') : !this.q.anyGuests() ? ' ' + t('msg.waiting') : '') : ''),
        index: this.steps.filter((x) => this.applicable(x)).indexOf(s) + 1, total: this.steps.filter((x) => this.applicable(x)).length || total, expr: this.mood ?? s.expr ?? 'point',
        canNext: !!s.ack, canSkip: true, ack: !!s.ack, doLabel: s.doLabel === 'jump' ? 'jump' : 'default',
        price: est ? Math.round(est.cost) : null, canDo: !!est,
      };
    }
    const sh = this.shown && this.shown.stepId === s?.id ? this.shown.res : null;
    return {
      status: this.status, step, ui: sh ? sh.ui : null, map: sh ? sh.map : null,
      note: sh ? (sh.valid ? t(sh.noteKey ?? stepKey(s!.id, 'show'), sh.noteArgs) : t(sh.noteKey ?? 'msg.noSite')) : null,
      message: this.message, minimised: this.state.minimised,
      goals: this.state.enabled && !allGoals ? gview : null, completedCount: this.state.completed.length,
    };
  }

  private emit(force: boolean): void {
    const sig = JSON.stringify([this.cur?.id, this.state.enabled, this.state.finished, this.message, this.shown?.stepId, this.state.minimised, this.state.completed.length, this.q.guests, this.q.stars, this.sim.game.money > 5e4]);
    if (!force && sig === this.lastSig) return;
    this.lastSig = sig;
    for (const l of [...this.listeners]) { try { l(); } catch { /* UI listeners must not break the engine */ } }
  }
}

/** All hint / step string keys that exist for a step id (used by tests). */
export const stepKeysOf = (id: string): string[] => (['title', 'text', 'show'] as const).map((p) => stepKey(id, p)).filter((k) => k in STRINGS);
export const hintKeyOf = hintKey;
