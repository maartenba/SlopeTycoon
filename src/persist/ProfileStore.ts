/**
 * Local player profile (M5.3 Tasks 15 + 16): scenario results (best medal / score / time, attempts) and the achievements section (unlock records, lifetime counters, cosmetics; docs/achievements.md).
 * Stored in its OWN IndexedDB database (`slope-profile`, never touched by save slots, so deleting a save never deletes a medal) with a LocalStorage
 * fallback when IndexedDB is unavailable. One versioned JSON document, sanitised on every load and update: corruption or a failed write never
 * throws into the game (the in-memory profile keeps working). NO export / import / sharing (decision D8).
 *
 * API: `getProfile()` (sync, read-only snapshot), `update(fn)` (mutate a draft; persisted + subscribers notified), `subscribe(fn)`.
 * Extending: add a field to `AchievementsProfile` + `sanitizeAchievements`, or a new top-level key to `Profile` and `sanitizeProfile`; bump `PROFILE_VERSION` only when an existing field changes shape (then add a step in `migrateProfile`).
 */
import type { Medal } from '../sim/scenario/ScenarioRunner';
import { MEDAL_RANK } from '../sim/scenario/ScenarioRunner';

export const PROFILE_VERSION = 2;
export const PROFILE_DB = 'slope-profile';
export const PROFILE_LS_KEY = 'slopetycoon.profile';

export interface ScenarioRecord {
  bestMedal: Medal;
  bestScore: number;
  /** Fewest game days of a won run (null = never won). */
  bestDays: number | null;
  attempts: number;
  wins: number;
  lastResult: 'won' | 'lost' | null;
}
/** Selected cosmetic per kind (`<kind>:<name>` ids, config/cosmetics.ts). Missing = the default look. */
export type CosmeticSelection = Partial<Record<'palette' | 'flags' | 'frame' | 'chair', string>>;
export interface UnlockRecord { /** Unix ms. */ at: number; /** Id of the game it happened in (a random token, never a save slot). */ gameId?: string; /** Earned in a sandbox / free-play game. */ sandbox?: boolean }
/** Profile-wide achievements state (M5.3 Task 16). Per-game state lives in the save (`achievementsRun`), never here. */
export interface AchievementsProfile {
  v: 1;
  unlocked: Record<string, UnlockRecord>;
  /** Lifetime counters (guests, rescues, photos, walked metres, ...). */
  counters: Record<string, number>;
  cosmetics: { owned: string[]; selected: CosmeticSelection };
}
export interface Profile {
  v: number;
  scenarios: Record<string, ScenarioRecord>;
  achievements: AchievementsProfile;
}

export const emptyAchievements = (): AchievementsProfile => ({ v: 1, unlocked: {}, counters: {}, cosmetics: { owned: [], selected: {} } });
export const emptyProfile = (): Profile => ({ v: PROFILE_VERSION, scenarios: {}, achievements: emptyAchievements() });
export const emptyRecord = (): ScenarioRecord => ({ bestMedal: 'none', bestScore: 0, bestDays: null, attempts: 0, wins: 0, lastResult: null });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonNeg = (v: unknown, max = 1e9): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.round(v)) : 0);
const MEDALS = Object.keys(MEDAL_RANK) as Medal[];

/** Defensive clean-up of anything read from storage (or produced by `update`): unknown / malformed entries are dropped, never thrown on. */
export function sanitizeProfile(raw: unknown): Profile {
  const out = emptyProfile();
  if (!isObj(raw)) return out;
  const scen = isObj(raw.scenarios) ? raw.scenarios : {};
  for (const [id, r] of Object.entries(scen)) {
    if (!/^[a-z][a-z0-9-]{2,31}$/.test(id) || !isObj(r)) continue;
    out.scenarios[id] = {
      bestMedal: MEDALS.includes(r.bestMedal as Medal) ? (r.bestMedal as Medal) : 'none',
      bestScore: nonNeg(r.bestScore, 100000), bestDays: r.bestDays === null || r.bestDays === undefined ? null : nonNeg(r.bestDays, 100000),
      attempts: nonNeg(r.attempts, 100000), wins: nonNeg(r.wins, 100000), lastResult: r.lastResult === 'won' || r.lastResult === 'lost' ? r.lastResult : null,
    };
  }
  out.achievements = sanitizeAchievements(raw.achievements);
  return out;
}

const ID_RE = /^[a-z][a-z0-9-]{1,39}$/, COSMETIC_RE = /^[a-z]{3,8}:[a-z][a-z0-9-]{1,31}$/, COUNTER_RE = /^[A-Za-z][A-Za-z0-9:_-]{0,39}$/;
const SELECT_KEYS = ['palette', 'flags', 'frame', 'chair'] as const;
/** Defensive clean-up of the achievements section: malformed / unknown-shaped entries are dropped (never thrown on). Unknown ids are kept (a newer version may know them). */
export function sanitizeAchievements(raw: unknown): AchievementsProfile {
  const out = emptyAchievements();
  if (!isObj(raw)) return out;
  if (isObj(raw.unlocked)) {
    for (const [id, r] of Object.entries(raw.unlocked)) {
      if (!ID_RE.test(id) || !isObj(r) || typeof r.at !== 'number' || !Number.isFinite(r.at) || r.at < 0) continue;
      const rec: UnlockRecord = { at: Math.round(r.at) };
      if (typeof r.gameId === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(r.gameId)) rec.gameId = r.gameId;
      if (r.sandbox === true) rec.sandbox = true;
      out.unlocked[id] = rec;
    }
  }
  if (isObj(raw.counters)) for (const [k, v] of Object.entries(raw.counters)) if (COUNTER_RE.test(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) out.counters[k] = Math.min(1e9, Math.round(v));
  if (isObj(raw.cosmetics)) {
    const c = raw.cosmetics;
    if (Array.isArray(c.owned)) out.cosmetics.owned = [...new Set(c.owned.filter((x): x is string => typeof x === 'string' && COSMETIC_RE.test(x)))].slice(0, 200);
    if (isObj(c.selected)) for (const k of SELECT_KEYS) { const v = c.selected[k]; if (typeof v === 'string' && COSMETIC_RE.test(v) && v.startsWith(`${k}:`)) out.cosmetics.selected[k] = v; }
  }
  return out;
}

/** Version steps: v1 -> v2 gave `achievements` its structured shape (v1 only ever held an empty placeholder object). Unknown newer versions load as far as the sanitiser understands them. */
export function migrateProfile(raw: unknown): Profile {
  if (isObj(raw) && (typeof raw.v !== 'number' || raw.v < 2)) raw = { ...raw, achievements: undefined };
  return sanitizeProfile(raw);
}

type LS = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = (t: IDBTransaction): Promise<void> => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error ?? new Error('aborted')); });

export class ProfileStore {
  private profile: Profile = emptyProfile();
  private listeners = new Set<(p: Profile) => void>();
  private db: Promise<IDBDatabase> | null = null;
  private queue: Promise<void> = Promise.resolve();
  /** True when the stored document was unreadable and an empty profile was used instead. */
  recovered = false;
  /** Last persistence error (the in-memory profile is still valid). */
  lastError: string | null = null;
  /** Resolves when the stored profile has been loaded. */
  readonly ready: Promise<void>;

  constructor(
    private readonly factory: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB,
    private readonly ls: LS | undefined = (() => { try { return (globalThis as { localStorage?: Storage }).localStorage; } catch { return undefined; } })(),
    readonly dbName = PROFILE_DB,
  ) {
    this.ready = this.load();
  }

  getProfile(): Readonly<Profile> { return this.profile; }

  subscribe(fn: (p: Readonly<Profile>) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /** Mutate a draft copy; the result is sanitised, stored and announced. Resolves when it is persisted (never rejects). */
  async update(fn: (draft: Profile) => void): Promise<void> {
    await this.ready;
    const draft = sanitizeProfile(JSON.parse(JSON.stringify(this.profile)));
    try { fn(draft); } catch (e) { this.lastError = `update failed: ${String(e)}`; return; }
    this.profile = sanitizeProfile(draft);
    for (const l of [...this.listeners]) { try { l(this.profile); } catch { /* a bad listener must not break saving */ } }
    this.queue = this.queue.then(() => this.persist(JSON.stringify(this.profile)));
    await this.queue;
  }

  // ---- scenario helpers ----
  recordStart(id: string): Promise<void> {
    return this.update((p) => { const r = (p.scenarios[id] ??= emptyRecord()); r.attempts++; });
  }
  recordResult(id: string, res: { result: 'won' | 'lost'; medal: Medal; score: number; days: number }): Promise<void> {
    return this.update((p) => {
      const r = (p.scenarios[id] ??= emptyRecord());
      r.lastResult = res.result;
      if (res.result === 'won') {
        r.wins++;
        if (MEDAL_RANK[res.medal] > MEDAL_RANK[r.bestMedal]) r.bestMedal = res.medal;
        if (res.score > r.bestScore) r.bestScore = res.score;
        if (r.bestDays === null || res.days < r.bestDays) r.bestDays = res.days;
      }
    });
  }
  record(id: string): Readonly<ScenarioRecord> { return this.profile.scenarios[id] ?? emptyRecord(); }
  /** 'Reset profile': clears scenario results + achievements + cosmetics. Save slots are separate storage and are never touched. */
  resetProfile(): Promise<void> { return this.update((p) => { p.scenarios = {}; p.achievements = emptyAchievements(); }); }

  // ---- storage ----
  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((res, rej) => {
      if (!this.factory) { rej(new Error('IndexedDB unavailable')); return; }
      let r: IDBOpenDBRequest;
      try { r = this.factory.open(this.dbName, 1); } catch (e) { rej(e); return; }
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('profile')) r.result.createObjectStore('profile'); };
      r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); this.db = null; }; res(r.result); };
      r.onerror = () => rej(r.error ?? new Error('open failed'));
      r.onblocked = () => rej(new Error('blocked'));
    });
    this.db.catch(() => { this.db = null; });
    return this.db;
  }

  private async load(): Promise<void> {
    let text: string | null = null;
    try {
      const db = await this.open();
      const v = await req(db.transaction('profile').objectStore('profile').get('main') as IDBRequest<unknown>);
      if (typeof v === 'string') text = v;
    } catch { /* fall back to LocalStorage */ }
    if (text === null) { try { text = this.ls?.getItem(PROFILE_LS_KEY) ?? null; } catch { text = null; } }
    if (text === null) return;
    try { this.profile = migrateProfile(JSON.parse(text)); } catch { this.recovered = true; this.profile = emptyProfile(); }
  }

  private async persist(text: string): Promise<void> {
    let idbOk = false;
    try {
      const db = await this.open();
      const tx = db.transaction('profile', 'readwrite');
      tx.objectStore('profile').put(text, 'main');
      await txDone(tx);
      idbOk = true; this.lastError = null;
    } catch (e) { this.lastError = `IndexedDB: ${(e as Error | undefined)?.message ?? String(e)}`; }
    if (idbOk) { try { this.ls?.removeItem(PROFILE_LS_KEY); } catch { /* ignore */ } return; }
    try { this.ls?.setItem(PROFILE_LS_KEY, text); } catch (e) { this.lastError = `${this.lastError ?? ''} LocalStorage: ${(e as Error | undefined)?.message ?? String(e)}`.trim(); }
  }
}

let shared: ProfileStore | null = null;
/** The game-wide profile store (created on first use). */
export const profileStore = (): ProfileStore => (shared ??= new ProfileStore());
