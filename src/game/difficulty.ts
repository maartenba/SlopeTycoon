/**
 * New-game options (Task 35): one validated `GameConfig` shared by the New Game dialog, the URL boot params, createSim and the save
 * ('config' module + meta). `parseConfig` accepts the OLD params (`?size=&seed=&start=`) too, so existing links keep working.
 */
import { DIFFICULTY, DIFFICULTY_IDS, START_MONEY_RANGE, WALKING_RADIUS_RANGE, WALKING_RADIUS_TILES, type DifficultyDef, type DifficultyId } from '../config/balance';
import { STARTING_MONEY, type MapSize } from '../core/GameState';
import { DEFAULT_MODE, GAME_MODES, type GameMode } from '../config/progression';
import { PRESET_IDS, type TerrainPresetId } from '../world/TerrainPresets';

export type StartSeason = 'winter' | 'spring' | 'summer' | 'autumn';
export const START_SEASONS: readonly StartSeason[] = ['winter', 'spring', 'summer', 'autumn'];
export const MAP_SIZES: readonly MapSize[] = [64, 128, 256];

export interface GameConfig {
  size: MapSize;
  seed: number;
  preset: TerrainPresetId;
  difficulty: DifficultyId;
  startSeason: StartSeason;
  /** Starting cash override (before the loan); null = STARTING_MONEY x difficulty. */
  money: number | null;
  /** Start with the Starter loan already taken. */
  startLoan: boolean;
  /** Walking radius override (tiles); null = default. */
  radius: number | null;
  /** Pre-built starter resort (sandbox) instead of the empty map. */
  starterResort: boolean;
  /** Show contextual hints. */
  hints: boolean;
  /** Career (default: resort levels + selective unlocks) or Sandbox (everything unlocked). Old saves without it load as Sandbox (createSim). */
  mode: GameMode;
  /** Id of a shipped scenario (src/config/scenarios) or null. The scenario overrides size / seed / preset / season / money / mode in `scenarioConfig`. */
  scenario: string | null;
}

export const DEFAULT_CONFIG: GameConfig = {
  size: 128, seed: 1337, preset: 'balanced', difficulty: 'normal', startSeason: 'winter', money: null, startLoan: false, radius: null, starterResort: false, hints: true, mode: DEFAULT_MODE, scenario: null,
};

export const difficultyDef = (id: DifficultyId): DifficultyDef => DIFFICULTY[id] ?? DIFFICULTY.normal;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

/** Cash the game starts with (before the optional loan). */
export function startingMoney(c: Pick<GameConfig, 'money' | 'difficulty'>): number {
  return c.money !== null ? clamp(Math.round(c.money), START_MONEY_RANGE.min, START_MONEY_RANGE.max) : Math.round(STARTING_MONEY * difficultyDef(c.difficulty).money);
}
export const walkingRadius = (c: Pick<GameConfig, 'radius'>): number => (c.radius === null ? WALKING_RADIUS_TILES : clamp(Math.round(c.radius), WALKING_RADIUS_RANGE.min, WALKING_RADIUS_RANGE.max));

/** Validate / clamp anything (partial or hostile input, old saves) into a complete config. */
export function normalizeConfig(raw: Partial<Record<keyof GameConfig, unknown>> | null | undefined): GameConfig {
  const r = raw ?? {};
  const size = Number(r.size);
  const seed = Number(r.seed);
  const money = r.money === null || r.money === undefined || r.money === '' ? null : Number(r.money);
  const radius = r.radius === null || r.radius === undefined || r.radius === '' ? null : Number(r.radius);
  return {
    size: size === 64 ? 64 : size === 256 ? 256 : 128,
    seed: Number.isFinite(seed) ? Math.trunc(seed) : DEFAULT_CONFIG.seed,
    preset: oneOf(r.preset, PRESET_IDS, 'balanced'),
    difficulty: oneOf(r.difficulty, DIFFICULTY_IDS, 'normal'),
    startSeason: oneOf(r.startSeason, START_SEASONS, 'winter'),
    money: money !== null && Number.isFinite(money) ? clamp(Math.round(money), START_MONEY_RANGE.min, START_MONEY_RANGE.max) : null,
    startLoan: r.startLoan === true,
    radius: radius !== null && Number.isFinite(radius) ? clamp(Math.round(radius), WALKING_RADIUS_RANGE.min, WALKING_RADIUS_RANGE.max) : null,
    starterResort: r.starterResort === true,
    hints: r.hints !== false,
    mode: oneOf(r.mode, GAME_MODES, DEFAULT_MODE),
    scenario: typeof r.scenario === 'string' && /^[a-z][a-z0-9-]{2,31}$/.test(r.scenario) ? r.scenario : null,
  };
}

/** Boot URL params -> config (old `?size=&seed=&start=` still work). `explicit` is true when any new-game param was present. */
/** Fresh seed 0..999,999,999 (inject `rnd` in tests). Menu / URL boot only: the sim itself never uses Math.random. */
// eslint-disable-next-line no-restricted-properties
export const randomSeed = (rnd: () => number = Math.random): number => Math.min(999_999_999, Math.floor(rnd() * 1e9));

/** A missing / invalid `seed` is RANDOM (never the old fixed 1337): only an explicit `?seed=` is reproducible. */
// eslint-disable-next-line no-restricted-properties
export function parseConfig(params: URLSearchParams, rnd: () => number = Math.random): { config: GameConfig; explicit: boolean } {
  const g = (k: string): string | null => params.get(k);
  const explicit = ['size', 'seed', 'start', 'preset', 'difficulty', 'money', 'radius', 'loan', 'starter', 'hints', 'mode', 'scenario'].some((k) => params.has(k));
  const seedRaw = g('seed');
  const seed = seedRaw === null || seedRaw.trim() === '' ? NaN : Number(seedRaw);
  return {
    explicit,
    config: normalizeConfig({
      size: g('size'), seed: Number.isFinite(seed) ? seed : randomSeed(rnd), preset: g('preset'), difficulty: g('difficulty'), startSeason: g('start'),
      money: g('money'), radius: g('radius'), startLoan: g('loan') === '1', starterResort: g('starter') === '1', hints: g('hints') !== '0', mode: g('mode'), scenario: g('scenario'),
    }),
  };
}

/** Config -> URL query (only non-default values; stable key order so links are shareable). */
export function configQuery(c: GameConfig): string {
  const q = new URLSearchParams({ size: String(c.size), seed: String(c.seed) });
  if (c.preset !== 'balanced') q.set('preset', c.preset);
  if (c.difficulty !== 'normal') q.set('difficulty', c.difficulty);
  if (c.startSeason !== 'winter') q.set('start', c.startSeason);
  if (c.money !== null) q.set('money', String(c.money));
  if (c.startLoan) q.set('loan', '1');
  if (c.radius !== null) q.set('radius', String(c.radius));
  if (c.starterResort) q.set('starter', '1');
  if (!c.hints) q.set('hints', '0');
  if (c.mode !== DEFAULT_MODE) q.set('mode', c.mode);
  if (c.scenario) q.set('scenario', c.scenario);
  return q.toString();
}

const ADJ = ['Alpine', 'Frosty', 'Silver', 'Misty', 'Golden', 'Crystal', 'Snowy', 'Rocky', 'Sunny', 'Wild', 'Quiet', 'Lofty', 'Icy', 'Cosy', 'Bold', 'Windy'] as const;
const NOUN = ['Fox', 'Marmot', 'Eagle', 'Ibex', 'Lynx', 'Owl', 'Hare', 'Wolf', 'Bear', 'Falcon', 'Chamois', 'Stoat', 'Raven', 'Otter', 'Deer', 'Grouse'] as const;
/** Deterministic seed <-> name: number -> 'Alpine-Fox-1234'. The name is a pure function of the seed, and `seedFromText` inverts it. */
export function seedName(seed: number): string {
  const s = Math.abs(Math.trunc(seed)) % 1_000_000_000;
  return `${ADJ[s % 16]}-${NOUN[(s >> 4) % 16]}-${Math.floor(s / 256)}`;
}
/** Text the player typed -> numeric seed: a number, a seed name from `seedName`, or any other text (hashed, FNV-1a). Empty -> null. */
export function seedFromText(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^-?\d+$/.test(t)) return Math.abs(Math.trunc(Number(t))) % 1_000_000_000;
  const m = /^([A-Za-z]+)-([A-Za-z]+)-(\d+)$/.exec(t);
  if (m) {
    const a = ADJ.findIndex((x) => x.toLowerCase() === m[1]!.toLowerCase()), n = NOUN.findIndex((x) => x.toLowerCase() === m[2]!.toLowerCase());
    if (a >= 0 && n >= 0) {
      const hi = Number(m[3]);
      // seedName: s = hi*256 + low8, a = s & 15, n = (s >> 4) & 15 -> low8 = n*16 + a
      const s = hi * 256 + n * 16 + a;
      if (hi < 3_906_250 && seedName(s) === `${ADJ[a]}-${NOUN[n]}-${hi}`) return s;
    }
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % 1_000_000_000;
}
