/**
 * Data side of the trophy shelf + cosmetics UI (M5.3 Task 16): pure helpers over the local profile. No DOM. The same API object serves the title
 * screen (profile only), the pause menu and Settings (the running game adds its per-game progress through `run`).
 */
import { ACHIEVEMENTS, TIER_POINTS, cosmeticUnlockedBy, type AchievementDef } from '../config/achievements';
import { COSMETICS, COSMETIC_KINDS, DEFAULT_COSMETIC_IDS, type CosmeticDef, type CosmeticKind } from '../config/cosmetics';
import { SCENARIOS } from '../config/scenarios';
import { progressOf, type AchRun } from '../sim/meta/Achievements';
import type { ProfileStore, ScenarioRecord, UnlockRecord } from '../persist/ProfileStore';

export interface TrophyState { id: string; unlocked: boolean; record: Readonly<UnlockRecord> | null; progress: { value: number; target: number } | null }
export interface TrophySummary { unlocked: number; total: number; points: number; maxPoints: number }
export interface TrophiesApi {
  list(): readonly AchievementDef[];
  state(id: string): TrophyState;
  summary(): TrophySummary;
  /** Scenario medals (best result per shipped scenario). */
  scenarios(): Array<{ id: string; name: string; record: Readonly<ScenarioRecord> }>;
  /** Run kind the achievement can be earned in is shown as a chip; the current run kind (when a game runs) greys out the ones it cannot earn. */
  runKind?(): 'career' | 'scenario' | 'sandbox' | null;
  onChange?(fn: () => void): () => void;
}
export interface CosmeticTile { def: CosmeticDef; owned: boolean; selected: boolean; /** 'Unlock: <achievement>' for locked ones. */ lock: string | null }
export interface CosmeticsApi {
  tiles(kind: CosmeticKind): CosmeticTile[];
  select(kind: CosmeticKind, id: string): boolean;
  onChange?(fn: () => void): () => void;
}

export const trophySummary = (unlockedIds: readonly string[]): TrophySummary => ({
  unlocked: unlockedIds.length, total: ACHIEVEMENTS.length,
  points: unlockedIds.reduce((a, id) => a + (TIER_POINTS[ACHIEVEMENTS.find((d) => d.id === id)?.tier ?? 1] ?? 0), 0),
  maxPoints: ACHIEVEMENTS.reduce((a, d) => a + TIER_POINTS[d.tier], 0),
});

export function trophiesApiFromProfile(profile: ProfileStore, opts: { run?: () => AchRun | null; runKind?: () => 'career' | 'scenario' | 'sandbox' | null } = {}): TrophiesApi {
  return {
    list: () => ACHIEVEMENTS,
    state: (id) => {
      const d = ACHIEVEMENTS.find((a) => a.id === id)!, a = profile.getProfile().achievements;
      return { id, unlocked: !!a.unlocked[id], record: a.unlocked[id] ?? null, progress: progressOf(d, a, opts.run?.() ?? null) };
    },
    summary: () => trophySummary(ACHIEVEMENTS.filter((d) => profile.getProfile().achievements.unlocked[d.id]).map((d) => d.id)),
    scenarios: () => SCENARIOS.map((s) => ({ id: s.id, name: s.name, record: profile.record(s.id) })),
    runKind: opts.runKind,
    onChange: (fn) => profile.subscribe(fn),
  };
}

/** Cosmetic tiles for Settings. Selection falls back to the default for anything not owned (a reset profile never leaves a locked item selected). */
export function cosmeticsApiFromProfile(profile: ProfileStore, onSelect?: (kind: CosmeticKind, id: string) => boolean): CosmeticsApi {
  const owned = (id: string): boolean => DEFAULT_COSMETIC_IDS.includes(id) || profile.getProfile().achievements.cosmetics.owned.includes(id);
  const sel = (kind: CosmeticKind): string => { const s = profile.getProfile().achievements.cosmetics.selected[kind]; return s && owned(s) ? s : DEFAULT_COSMETIC_IDS.find((d) => d.startsWith(`${kind}:`))!; };
  return {
    tiles: (kind) => COSMETICS.filter((c) => c.kind === kind).map((def) => ({ def, owned: owned(def.id), selected: sel(kind) === def.id, lock: owned(def.id) ? null : `Unlock: ${cosmeticUnlockedBy(def.id)?.title ?? 'an achievement'}` })),
    select: (kind, id) => (onSelect ? onSelect(kind, id) : false),
    onChange: (fn) => profile.subscribe(fn),
  };
}
export { COSMETIC_KINDS };

/** Cosmetics API straight from the live engine (the profile is persisted asynchronously, the tiles must update at once). */
export interface CosmeticEngine { owns(id: string): boolean; selected(kind: CosmeticKind): string; select(kind: CosmeticKind, id: string): boolean; onCosmetics(fn: () => void): () => void }
export function cosmeticsApiFromEngine(e: CosmeticEngine): CosmeticsApi {
  return {
    tiles: (kind) => COSMETICS.filter((c) => c.kind === kind).map((def) => ({ def, owned: e.owns(def.id), selected: e.selected(kind) === def.id, lock: e.owns(def.id) ? null : `Unlock: ${cosmeticUnlockedBy(def.id)?.title ?? 'an achievement'}` })),
    select: (kind, id) => e.select(kind, id),
    onChange: (fn) => e.onCosmetics(fn),
  };
}
