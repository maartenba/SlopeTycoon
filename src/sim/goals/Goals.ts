/**
 * Resort goal chain (M5.1 Task 3): a short career of a resort director, in chapters. Data lives in `config/goals.ts`; this file is the engine.
 *  - Three goals are active at a time (the first three unfinished goals of the current chapter; the last ones of a chapter may be fewer).
 *  - Evaluated once per in-game hour (`time:hour`), never per tick. Pure function of sim state + a few latched event facts: no RNG.
 *  - A finished goal pays a small grant (`grant` ledger category) and emits `milestone{major:false}`; a finished chapter emits
 *    `milestone{major:true}` carrying the chapter's career line. Silent mode (old saves, pre-built resorts) completes without grant/events.
 * No three / DOM imports. The engine reads the world through the small `GoalWorld` interface so every check is testable with a fixture.
 */
import type { GameBus } from '../../core/events';
import { BONUS_GOALS, CHAPTERS, GOALS, type ChapterDef, type GoalDef } from '../../config/goals';

/** A place in the UI (not on the map) that 'Show me' opens: a dock drawer (+ optional item to point at) or the HUD rating panel. */
export interface PanelRef { drawer: 'buildings' | 'lifts' | 'pistes' | 'paths' | 'finance' | 'ops' | 'marketing' | 'pricing' | 'rating'; item?: string }
export interface Pt { x: number; y: number }

/** Read-only view of the world used by goal checks (built from the real sim in createSim, from fixtures in tests). */
export interface GoalWorld {
  buildings(): ReadonlyArray<{ type: string; active: boolean; x: number; y: number; w: number; h: number }>;
  /** Built lifts; `open` = open for business right now. `x`/`y` = bottom station tile. */
  lifts(): ReadonlyArray<{ kind: string; open: boolean; x: number; y: number; /** Stations incl. the terminals (2 = an ordinary lift); bonus goals only, absent in fixtures. */ stations?: number }>;
  /** Connected piste components (>= 4 tiles); `difficulty` 1 green .. 4 black. */
  pistes(): ReadonlyArray<{ difficulty: number; tiles: number; x: number; y: number }>;
  /** Tiles of mountain-bike / hiking trail. */
  trailTiles(): number;
  stars(): number;
  money(): number;
  debt(): number;
  /** Height of a tile as a share of the map's relief (0 valley floor .. 1 summit); bonus goals only (absent in fixtures = 0). */
  altFrac?(x: number, y: number): number;
  /** Pay a goal reward (ledger category `grant`). */
  grant(amount: number): void;
}

/** Latched counters maintained from bus events (saved). */
export interface GoalFacts {
  /** Guests that arrived since the day began. */
  arrivalsToday: number;
  /** Best single-day arrivals so far. */
  bestDay: number;
  /** Lifetime arrivals. */
  lifetime: number;
  /** Nights in which at least one groomer drove. */
  groomedNights: number;
  /** Incidents resolved (guest rescued / helped). */
  rescues: number;
  /** Months closed with a positive net. */
  profitMonths: number;
}
export const emptyFacts = (): GoalFacts => ({ arrivalsToday: 0, bestDay: 0, lifetime: 0, groomedNights: 0, rescues: 0, profitMonths: 0 });

export interface GoalCtx { w: GoalWorld; f: Readonly<GoalFacts> }

export interface GoalView {
  id: string; title: string; flavour: string; todo: string; progress: number; reward: number;
}
export interface GoalsView {
  chapter: { id: string; title: string; index: number; count: number; done: number; total: number } | null;
  active: GoalView[];
  completed: number; total: number; finished: boolean; granted: number;
}

export interface GoalsSave { done: string[]; chapters: string[]; facts: GoalFacts; granted: number; /** Bonus goals done (present only once one is). */ bonus?: string[] }

/** How many goals are shown / evaluated at a time. */
export const ACTIVE_GOALS = 3;

const clamp01 = (v: number): number => (v < 0 || Number.isNaN(v) ? 0 : v > 1 ? 1 : v);

export class Goals {
  facts: GoalFacts = emptyFacts();
  /** Total grants paid (dollars). */
  granted = 0;
  /** True while the tutorial runs: no evaluation, no rewards (tutorial funds must stay predictable). Not saved. */
  paused = false;
  private done = new Set<string>();
  /** Optional bonus goals that are done (never part of a chapter, see BONUS_GOALS). */
  private bonusDone = new Set<string>();
  private chaptersDone = new Set<string>();
  private progress = new Map<string, number>();
  private listeners: Array<() => void> = [];

  constructor(private readonly world: () => GoalWorld, private readonly bus: GameBus, readonly goals: readonly GoalDef[] = GOALS, readonly chapters: readonly ChapterDef[] = CHAPTERS, readonly bonus: readonly GoalDef[] = goals === GOALS ? BONUS_GOALS : []) {
    bus.on('guest:arrived', () => { const f = this.facts; f.arrivalsToday++; f.lifetime++; if (f.arrivalsToday > f.bestDay) f.bestDay = f.arrivalsToday; });
    bus.on('day:changed', () => { this.facts.arrivalsToday = 0; });
    bus.on('ops:grooming', (e) => { if (e.vehicles > 0) this.facts.groomedNights++; });
    bus.on('incident:resolved', (e) => { if (e.outcome !== 'left' && !e.severe && e.responder !== 'none') this.facts.rescues++; });
    bus.on('finance:monthClosed', (e) => { if (e.net > 0) this.facts.profitMonths++; });
    bus.on('time:hour', () => this.evaluate());
  }

  onChange(fn: () => void): void { this.listeners.push(fn); }
  isDone(id: string): boolean { return this.done.has(id) || this.bonusDone.has(id); }
  chapterDone(id: string): boolean { return this.chaptersDone.has(id); }
  get completedCount(): number { return this.done.size; }
  get finished(): boolean { return this.done.size >= this.goals.length; }

  /** The goals currently shown: the first three unfinished goals of the current chapter (the chapter of the first unfinished goal). */
  active(): GoalDef[] {
    const out: GoalDef[] = [];
    let chapter = '';
    for (const g of this.goals) {
      if (this.done.has(g.id)) continue;
      if (!chapter) chapter = g.chapter; else if (g.chapter !== chapter) break;
      out.push(g);
      if (out.length >= ACTIVE_GOALS) break;
    }
    return out;
  }

  /** Progress 0..1 of a goal right now (pure check; cached by the last evaluation for UI reads). */
  check(g: GoalDef): number { return clamp01(g.check({ w: this.world(), f: this.facts })); }

  /**
   * Evaluate the active goals; complete the satisfied ones (cascading: a newly active goal may already be satisfied).
   * `silent` = no grant, no events (old save / pre-built resort).
   */
  evaluate(silent = false): void {
    if (this.paused && !silent) return;
    let changed = false;
    for (let guard = 0; guard <= this.goals.length; guard++) {
      let progressed = false;
      for (const g of this.active()) {
        const p = this.check(g);
        this.progress.set(g.id, p);
        if (p >= 1) { this.complete(g, silent); progressed = changed = true; }
      }
      if (!progressed) break;
    }
    for (const g of this.active()) this.progress.set(g.id, this.check(g));
    for (const g of this.bonus) if (!this.bonusDone.has(g.id) && this.check(g) >= 1) { this.completeBonus(g, silent); changed = true; }
    if (changed || !silent) for (const l of this.listeners) l();
  }

  /** A bonus goal: pays its grant and shows one quiet milestone; no chapter, no active slot. */
  private completeBonus(g: GoalDef, silent: boolean): void {
    this.bonusDone.add(g.id);
    if (silent) return;
    if (g.reward > 0) { this.world().grant(g.reward); this.granted += g.reward; }
    this.bus.emit('milestone', { id: `goal:${g.id}`, title: g.reward > 0 ? `${g.title} (+$${g.reward.toLocaleString('en-US')})` : g.title, major: false });
  }

  private complete(g: GoalDef, silent: boolean): void {
    this.done.add(g.id);
    if (!silent && g.reward > 0) { this.world().grant(g.reward); this.granted += g.reward; }
    const ch = this.chapters.find((c) => c.id === g.chapter);
    const chapterFinished = !!ch && !this.chaptersDone.has(ch.id) && this.goals.filter((x) => x.chapter === ch.id).every((x) => this.done.has(x.id));
    if (chapterFinished) this.chaptersDone.add(ch!.id);
    if (silent) return;
    this.bus.emit('milestone', { id: `goal:${g.id}`, title: g.reward > 0 ? `${g.title} (+$${g.reward.toLocaleString('en-US')})` : g.title, major: false });
    if (chapterFinished) this.bus.emit('milestone', { id: `chapter:${ch!.id}`, title: `${ch!.title} complete. ${ch!.outro}`, major: true });
  }

  view(): GoalsView {
    const act = this.active();
    const first = act[0];
    const ch = first ? this.chapters.find((c) => c.id === first.chapter) ?? null : null;
    const inCh = ch ? this.goals.filter((g) => g.chapter === ch.id) : [];
    return {
      chapter: ch ? { id: ch.id, title: ch.title, index: this.chapters.indexOf(ch) + 1, count: this.chapters.length, done: inCh.filter((g) => this.done.has(g.id)).length, total: inCh.length } : null,
      active: act.map((g) => ({ id: g.id, title: g.title, flavour: g.flavour, todo: g.todo, progress: this.progress.get(g.id) ?? this.check(g), reward: g.reward })),
      completed: this.done.size, total: this.goals.length, finished: this.finished, granted: this.granted,
    };
  }

  /** Where "Show me" should look for a goal (null when there is nothing to look at yet). */
  focusOf(id: string): Pt | null {
    const g = this.goals.find((x) => x.id === id);
    return g?.focus ? g.focus(this.world()) : null;
  }

  /** The drawer / panel 'Show me' opens when a goal has nothing to look at on the map yet. */
  panelOf(id: string): PanelRef | null { return this.goals.find((x) => x.id === id)?.panel ?? null; }

  /** Mark every already-satisfied goal as done without reward or events (old saves, pre-built resorts). */
  silentSync(): void { this.evaluate(true); }

  serialize(): GoalsSave { return { done: this.goals.filter((g) => this.done.has(g.id)).map((g) => g.id), chapters: [...this.chaptersDone], facts: { ...this.facts }, granted: this.granted, ...(this.bonusDone.size ? { bonus: [...this.bonusDone].sort() } : {}) }; }
  load(d: unknown): void {
    const o = d as Partial<GoalsSave>;
    const ids = new Set(this.goals.map((g) => g.id));
    this.done = new Set((o.done ?? []).filter((id) => ids.has(id)));
    this.chaptersDone = new Set((o.chapters ?? []).filter((id) => this.chapters.some((c) => c.id === id)));
    this.facts = { ...emptyFacts(), ...(o.facts ?? {}) };
    this.granted = o.granted ?? 0;
    this.bonusDone = new Set((o.bonus ?? []).filter((id) => this.bonus.some((b) => b.id === id)));
    this.progress.clear();
    for (const g of this.active()) this.progress.set(g.id, this.check(g));
  }
  /** Fresh chain (module missing in an old save): nothing done, then silently complete what is already satisfied. */
  reset(): void {
    this.done.clear(); this.bonusDone.clear(); this.chaptersDone.clear(); this.facts = emptyFacts(); this.granted = 0; this.progress.clear();
    this.silentSync();
  }
}
