/**
 * Achievement engine (M5.3 Task 16): PURE event trackers evaluated from the typed bus plus a few daily facts.
 *  - Observer only: it never writes the sim, uses no RNG and no wall clock except the injectable `now()` stamp of an unlock, so `stateHash` is unchanged
 *    (its save module `achievementsRun` is flagged `observer` and skipped by `stateHash`).
 *  - Two stores: PROFILE-wide data (`AchievementsProfile`: unlock records, lifetime counters, cosmetics) that the host persists in the ProfileStore (it
 *    survives deleting save slots), and PER-GAME state (`AchRun`: game windows, streaks, distinct sets, game counters) saved in the `achievementsRun`
 *    save module so "a full year in profit" survives save / load.
 *  - Idempotent: an id unlocks once (first timestamp wins). Render-only counters (photos, walked metres, ride-alongs) come in through `note()` from the page
 *    and are never counted headless.
 *  - Events before `arm()` are ignored (sandbox starter resorts are a gift and must not unlock "first lift"); the host arms once the profile is loaded.
 * Tracker semantics: see config/achievements.ts. No three / DOM imports.
 */
import type { GameBus, GameEventName } from '../../core/events';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, SCENARIO_IDS, type AchievementDef, type Cond, type FactCond, type FactKey, type MedalRank, type Tracker } from '../../config/achievements';
import { COSMETIC_BY_ID, DEFAULT_COSMETIC_IDS, type CosmeticKind } from '../../config/cosmetics';
import { normalizeLiftKind } from '../../config/lifts';
import { emptyAchievements, sanitizeAchievements, type AchievementsProfile, type UnlockRecord } from '../../persist/ProfileStore';

export type RunKind = 'career' | 'scenario' | 'sandbox';
export interface ReportLite { year: number; partial: boolean; profit: number; headline: 'none' | 'bronze' | 'silver' | 'gold'; awards: Record<string, number> }
/** Read-only daily facts (built from the real sim in createSim, from fixtures in tests). */
export interface AchFacts { stars: number; level: number; guests: number; openLifts: number; money: number; festivals: number; report: ReportLite | null }
export interface AchHost {
  runKind(): RunKind;
  facts(): AchFacts;
  /** Unix ms stamp for unlocks (default Date.now). */
  now?(): number;
  /** Token of the game (never a save slot). */
  gameId?: string;
}

/** Per-game state (save module `achievementsRun`). */
export interface AchRun {
  v: 1;
  gameId: string;
  /** Per-game counters + streak days (`st:<id>`). */
  n: Record<string, number>;
  /** Distinct-value sets (`<id>`). */
  sets: Record<string, string[]>;
  /** Window state per id: 1 open, 2 violated (absent = closed). */
  win: Record<string, 1 | 2>;
}
export const emptyRun = (gameId = 'g0'): AchRun => ({ v: 1, gameId, n: {}, sets: {}, win: {} });

const MEDAL_RANK_OF: Record<string, number> = { bronze: 1, silver: 2, gold: 3 };
const HEADLINE_RANK: Record<ReportLite['headline'], number> = { none: 0, bronze: 1, silver: 2, gold: 3 };
const CAP = 1e9;

type Payload = Record<string, unknown>;
const cmp = (a: unknown, op: Cond['op'], v: string | number | boolean): boolean => {
  switch (op) {
    case '==': return a === v;
    case '!=': return a !== v;
    case '>=': return typeof a === 'number' && a >= (v as number);
    case '<=': return typeof a === 'number' && a <= (v as number);
  }
};
/** Does `p` satisfy every condition? (A missing field fails `==` / `>=` / `<=` and passes `!=`.) */
export const matches = (where: readonly Cond[] | undefined, p: Payload): boolean => !where || where.every((c) => cmp(p[c.f], c.op, c.v));
const factsOk = (needs: readonly FactCond[] | undefined, f: AchFacts): boolean => !needs || needs.every((c) => (c.op === '>=' ? f[c.fact] >= c.v : f[c.fact] <= c.v));

interface CounterRule { key: string; event: GameEventName; where?: readonly Cond[]; by?: string; per: 'profile' | 'game' }
/** The counter an `event` tracker reads (shared counters must share one rule; checked by tests). */
export const counterKey = (d: AchievementDef): string => { const t = d.tracker; return t.kind === 'event' ? (t.counter ?? d.id) : ''; };

export type UnlockListener = (def: AchievementDef, rec: UnlockRecord) => void;

export class Achievements {
  private data: AchievementsProfile = emptyAchievements();
  private run: AchRun;
  private armed = false;
  private dirty = false;
  private readonly rules = new Map<string, CounterRule>();
  private readonly byEvent = new Map<GameEventName, AchievementDef[]>();
  private readonly onUnlockL: UnlockListener[] = [];
  private persistL: Array<(d: AchievementsProfile) => void> = [];
  private cosmeticL: Array<() => void> = [];
  private offs: Array<() => void> = [];

  constructor(bus: GameBus, private readonly host: AchHost) {
    this.run = emptyRun(host.gameId ?? 'g0');
    for (const d of ACHIEVEMENTS) {
      for (const ev of eventsOf(d.tracker)) { const l = this.byEvent.get(ev) ?? []; l.push(d); this.byEvent.set(ev, l); }
      const t = d.tracker;
      if (t.kind === 'event') {
        const key = counterKey(d);
        if (!this.rules.has(key)) this.rules.set(key, { key, event: t.event, where: t.where, by: t.by, per: t.per ?? 'profile' });
      }
    }
    for (const ev of new Set<GameEventName>([...this.byEvent.keys(), 'day:changed'])) {
      this.offs.push(bus.on(ev, ((p: unknown) => this.onEvent(ev, (p ?? {}) as Payload)) as never));
    }
  }

  // ---------------------------------------------------------------- lifecycle
  /** Start observing (the host loads the profile first). Also checks the fact trackers once (a loaded save may already satisfy them). */
  arm(): void { if (this.armed) return; this.armed = true; this.checkFacts(); }
  get isArmed(): boolean { return this.armed; }
  dispose(): void { for (const o of this.offs.splice(0)) o(); }

  /** Replace the profile-wide data (host, after the ProfileStore loaded). Re-derives owned cosmetics from the unlocked achievements. */
  loadProfile(p: unknown): void {
    this.data = sanitizeAchievements(p);
    this.repairOwned();
    for (const l of this.cosmeticL) l();
  }
  profileData(): Readonly<AchievementsProfile> { return this.data; }
  onPersist(fn: (d: AchievementsProfile) => void): () => void { this.persistL.push(fn); return () => { this.persistL = this.persistL.filter((f) => f !== fn); }; }
  onUnlock(fn: UnlockListener): () => void { this.onUnlockL.push(fn); return () => { const i = this.onUnlockL.indexOf(fn); if (i >= 0) this.onUnlockL.splice(i, 1); }; }
  onCosmetics(fn: () => void): () => void { this.cosmeticL.push(fn); return () => { this.cosmeticL = this.cosmeticL.filter((f) => f !== fn); }; }
  /** Persist now when something changed (also called daily and on unlock / selection). */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const l of this.persistL) { try { l(this.data); } catch { /* a bad listener must not break the game */ } }
  }
  /** 'Reset profile': forget every unlock, counter and cosmetic choice (the per-game state stays). */
  resetProfile(): void { this.data = emptyAchievements(); this.dirty = true; this.flush(); for (const l of this.cosmeticL) l(); }

  // ---------------------------------------------------------------- queries
  isUnlocked(id: string): boolean { return !!this.data.unlocked[id]; }
  unlockedIds(): string[] { return Object.keys(this.data.unlocked).filter((id) => id in ACHIEVEMENT_BY_ID).sort(); }
  unlockedCount(): number { return this.unlockedIds().length; }
  points(): number { return this.unlockedIds().reduce((a, id) => a + ({ 1: 1, 2: 3, 3: 5 } as const)[ACHIEVEMENT_BY_ID[id]!.tier], 0); }
  record(id: string): Readonly<UnlockRecord> | null { return this.data.unlocked[id] ?? null; }
  counter(key: string): number { return this.data.counters[key] ?? 0; }
  /** Can this achievement be earned in the current kind of game? */
  eligible(d: AchievementDef, kind: RunKind = this.host.runKind()): boolean {
    if (kind === 'sandbox') return d.scope === 'any';
    if (d.scope === 'any') return true;
    return d.scope === kind;
  }
  /** Progress towards a counter-style achievement (null = not a counter). */
  progress(d: AchievementDef): { value: number; target: number } | null { return progressOf(d, this.data, this.run); }

  // ---------------------------------------------------------------- unlocking
  /** Unlock (idempotent). `force` skips the scope + armed checks (debug hook). Returns true when newly unlocked. */
  unlock(id: string, force = false): boolean {
    const d = ACHIEVEMENT_BY_ID[id];
    if (!d || this.data.unlocked[id]) return false;
    if (!force && (!this.armed || !this.eligible(d))) return false;
    const kind = this.host.runKind();
    const rec: UnlockRecord = { at: Math.round((this.host.now ?? Date.now)()), gameId: this.run.gameId };
    if (kind === 'sandbox') rec.sandbox = true;
    this.data.unlocked[id] = rec;
    if (d.reward && !this.data.cosmetics.owned.includes(d.reward)) this.data.cosmetics.owned.push(d.reward);
    this.dirty = true;
    for (const l of [...this.onUnlockL]) { try { l(d, rec); } catch { /* ignore */ } }
    if (d.reward) for (const l of this.cosmeticL) l();
    this.flush();
    return true;
  }

  // ---------------------------------------------------------------- render-side counters
  /** A render-only counter from the page (photos, walkM, rideGondola). Counts only while armed. */
  note(counter: string, amount = 1): void {
    if (!this.armed || !(amount > 0)) return;
    this.data.counters[counter] = Math.min(CAP, Math.round(((this.data.counters[counter] ?? 0) + amount) * 100) / 100);
    this.dirty = true;
    for (const d of ACHIEVEMENTS) if (d.tracker.kind === 'render' && d.tracker.counter === counter && (this.data.counters[counter] ?? 0) >= d.tracker.n) this.unlock(d.id);
  }

  // ---------------------------------------------------------------- event handling
  private bump(key: string, per: 'profile' | 'game', by: number): number {
    const store = per === 'game' ? this.run.n : this.data.counters;
    store[key] = Math.min(CAP, (store[key] ?? 0) + by);
    if (per === 'profile') this.dirty = true;
    return store[key]!;
  }

  private onEvent(ev: GameEventName, p: Payload): void {
    if (!this.armed) return;
    // 1) counters (one increment per distinct counter, however many achievements read it)
    for (const r of this.rules.values()) {
      if (r.event !== ev || !matches(r.where, p)) continue;
      const by = r.by ? Number(p[r.by]) : 1;
      if (!(by > 0)) continue;
      const v = this.bump(r.key, r.per, by);
      for (const d of this.byEvent.get(ev) ?? []) if (d.tracker.kind === 'event' && counterKey(d) === r.key && v >= (d.tracker.n ?? 1)) this.unlock(d.id);
    }
    const f = this.host.facts();
    for (const d of this.byEvent.get(ev) ?? []) {
      const t = d.tracker;
      switch (t.kind) {
        case 'streak': if (t.reset === ev && matches(t.where, p)) this.run.n[`st:${d.id}`] = 0; break;
        case 'window': this.windowEvent(d, t, ev, p, f); break;
        case 'distinct': if (t.event === ev && matches(t.where, p)) this.distinct(d, t, p); break;
        case 'report': if (ev === 'year:report') this.report(d, t, f); break;
        default: break;
      }
    }
    // 'scenario:finished' records the medal first (profile counter), 'day:changed' drives facts + streaks + the daily flush
    if (ev === 'scenario:finished' && p.result === 'won' && SCENARIO_IDS.includes(String(p.id))) {
      const k = `medal:${String(p.id)}`, rank = MEDAL_RANK_OF[String(p.medal)] ?? 0;
      if (rank > (this.data.counters[k] ?? 0)) { this.data.counters[k] = rank; this.dirty = true; }
      for (const d of this.byEvent.get(ev) ?? []) if (d.tracker.kind === 'scenario') this.scenario(d, d.tracker, p);
    }
    if (ev === 'day:changed') {
      this.checkFacts();
      for (const d of this.byEvent.get(ev) ?? []) {
        const t = d.tracker;
        if (t.kind !== 'streak' || !factsOk(t.needs, f)) continue;
        const k = `st:${d.id}`, n = (this.run.n[k] = (this.run.n[k] ?? 0) + 1);
        if (n >= t.days) this.unlock(d.id);
      }
      this.flush();
    }
  }

  private checkFacts(): void {
    const f = this.host.facts();
    for (const d of ACHIEVEMENTS) {
      const t = d.tracker;
      if (t.kind !== 'fact' || this.data.unlocked[d.id]) continue;
      const v = f[t.fact as FactKey];
      if (t.op === '>=' ? v >= t.v : v <= t.v) this.unlock(d.id);
    }
  }

  private windowEvent(d: AchievementDef, t: Extract<Tracker, { kind: 'window' }>, ev: GameEventName, p: Payload, f: AchFacts): void {
    const w = this.run.win;
    if (t.end === ev && matches(t.endWhere, p) && w[d.id]) {
      if (w[d.id] === 1 && factsOk(t.needs, f)) { delete w[d.id]; this.unlock(d.id); }
      else if (!(t.retry && w[d.id] === 1)) delete w[d.id];
    }
    if (t.violate === ev && matches(t.violateWhere, p) && w[d.id] === 1) w[d.id] = 2;
    if (t.start === ev && matches(t.startWhere, p) && !(t.retry && w[d.id])) w[d.id] = 1;
  }

  private distinct(d: AchievementDef, t: Extract<Tracker, { kind: 'distinct' }>, p: Payload): void {
    let k = String(p[t.key] ?? '');
    if (t.event === 'lift:built') k = normalizeLiftKind(k);
    const s = (this.run.sets[d.id] ??= []);
    if (k && !s.includes(k)) s.push(k);
    if (s.length >= t.n) this.unlock(d.id);
  }

  private report(d: AchievementDef, t: Extract<Tracker, { kind: 'report' }>, f: AchFacts): void {
    const r = f.report;
    if (!r || r.partial) return;
    const ok = t.metric === 'profit' ? r.profit > 0 : t.metric === 'headline' ? HEADLINE_RANK[r.headline] >= (t.min ?? 3) : (r.awards[t.award ?? ''] ?? 0) >= (t.min ?? 1);
    if (ok) this.unlock(d.id);
  }

  private scenario(d: AchievementDef, t: Extract<Tracker, { kind: 'scenario' }>, p: Payload): void {
    const min: MedalRank = t.min;
    if (t.scenario === 'any') { if (p.result === 'won' && SCENARIO_IDS.includes(String(p.id)) && (MEDAL_RANK_OF[String(p.medal)] ?? 0) >= min) this.unlock(d.id); return; }
    if (t.scenario === 'all') { if (SCENARIO_IDS.every((s) => (this.data.counters[`medal:${s}`] ?? 0) >= min)) this.unlock(d.id); return; }
    if ((this.data.counters[`medal:${t.scenario}`] ?? 0) >= min) this.unlock(d.id);
  }

  // ---------------------------------------------------------------- cosmetics
  owns(id: string): boolean { return DEFAULT_COSMETIC_IDS.includes(id) || this.data.cosmetics.owned.includes(id); }
  /** The selected cosmetic of a kind (the default when none / not owned). */
  selected(kind: CosmeticKind): string {
    const id = this.data.cosmetics.selected[kind];
    return id && this.owns(id) && COSMETIC_BY_ID[id]?.kind === kind ? id : DEFAULT_COSMETIC_IDS.find((d) => d.startsWith(`${kind}:`))!;
  }
  /** Select an owned cosmetic (false when locked / unknown / wrong kind). */
  select(kind: CosmeticKind, id: string): boolean {
    const c = COSMETIC_BY_ID[id];
    if (!c || c.kind !== kind || !this.owns(id)) return false;
    this.data.cosmetics.selected[kind] = id;
    this.dirty = true; this.flush();
    for (const l of this.cosmeticL) l();
    return true;
  }
  private repairOwned(): void {
    for (const id of Object.keys(this.data.unlocked)) { const r = ACHIEVEMENT_BY_ID[id]?.reward; if (r && !this.data.cosmetics.owned.includes(r)) this.data.cosmetics.owned.push(r); }
    this.data.cosmetics.owned = this.data.cosmetics.owned.filter((id) => id in COSMETIC_BY_ID);
  }

  // ---------------------------------------------------------------- per-game save module
  serializeRun(): AchRun { return JSON.parse(JSON.stringify(this.run)) as AchRun; }
  loadRun(d: unknown): void {
    const o = d as Partial<AchRun> | null;
    const r = emptyRun(typeof o?.gameId === 'string' ? o.gameId : this.run.gameId);
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o.n ?? {})) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) r.n[k] = Math.min(CAP, v);
      for (const [k, v] of Object.entries(o.sets ?? {})) if (Array.isArray(v)) r.sets[k] = v.filter((x): x is string => typeof x === 'string').slice(0, 64);
      for (const [k, v] of Object.entries(o.win ?? {})) if (v === 1 || v === 2) r.win[k] = v;
    }
    this.run = r;
  }
  resetRun(): void { this.run = emptyRun(this.run.gameId); }
  get gameId(): string { return this.run.gameId; }
}

/** Which store a counter lives in (event trackers share counters by key). */
const COUNTER_PER = new Map<string, 'profile' | 'game'>();
for (const d of ACHIEVEMENTS) if (d.tracker.kind === 'event') COUNTER_PER.set(counterKey(d), d.tracker.per ?? 'profile');

/**
 * Pure progress of a counter-style achievement from the profile data (+ the running game's state when there is one; the trophy shelf on the title
 * screen has none, so per-game bars read 0 there). null = nothing to show (single-shot achievements).
 */
export function progressOf(d: AchievementDef, data: Readonly<AchievementsProfile>, run: Readonly<AchRun> | null): { value: number; target: number } | null {
  const t = d.tracker;
  switch (t.kind) {
    case 'event': { if ((t.n ?? 1) <= 1) return null; const key = counterKey(d), game = COUNTER_PER.get(key) === 'game'; return { value: Math.min(t.n!, (game ? run?.n[key] : data.counters[key]) ?? 0), target: t.n! }; }
    case 'render': return t.n > 1 ? { value: Math.min(t.n, data.counters[t.counter] ?? 0), target: t.n } : null;
    case 'distinct': return { value: Math.min(t.n, run?.sets[d.id]?.length ?? 0), target: t.n };
    case 'streak': return { value: Math.min(t.days, run?.n[`st:${d.id}`] ?? 0), target: t.days };
    case 'scenario': return t.scenario === 'all' ? { value: SCENARIO_IDS.filter((s) => (data.counters[`medal:${s}`] ?? 0) >= t.min).length, target: SCENARIO_IDS.length } : null;
    default: return null;
  }
}

/** The bus events a tracker listens to. */
export function eventsOf(t: Tracker): GameEventName[] {
  switch (t.kind) {
    case 'event': return [t.event];
    case 'distinct': return [t.event];
    case 'streak': return [t.reset, 'day:changed'];
    case 'window': return [...new Set<GameEventName>([t.start, t.end, ...(t.violate ? [t.violate] : [])])];
    case 'report': return ['year:report'];
    case 'scenario': return ['scenario:finished'];
    default: return [];
  }
}
