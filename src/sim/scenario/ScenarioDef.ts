/**
 * Scenario definitions (M5.3 Task 15): the typed JSON schema, the fact catalogue objectives may reference, and the STRICT validator.
 * Scenarios ship with the game (`src/config/scenarios/*.json`); there is NO user import / export / sharing of scenario files (decision D8).
 * The validator runs over every shipped definition in the unit tests, and again when the index is built, so a typo in a JSON file fails fast.
 *
 * Time: every deadline counts GAME DAYS since the scenario start (180-day year, 15-day months, docs/time-flow.md):
 *   `{days: n}`, `{months: n}` (15 days each) or `{years: n}` (180 days each).
 * No three / DOM imports.
 */
import { BUILDINGS } from '../../config/buildings';
import { LIFTS } from '../../config/lifts';
import { DIFFICULTY_IDS, DAYS_PER_MONTH, DAYS_PER_YEAR, type DifficultyId } from '../../config/balance';
import { PRESET_IDS, type TerrainPresetId } from '../../world/TerrainPresets';
import { START_SEASONS, type StartSeason } from '../../game/difficulty';
import { UNLOCKS, key as unlockKey } from '../../config/unlocks';
import { GUEST_TYPE_NAMES } from '../guests/Guest';

export type Deadline = { days: number } | { months: number } | { years: number };
export const deadlineDays = (d: Deadline): number => ('days' in d ? d.days : 'months' in d ? d.months * DAYS_PER_MONTH : d.years * DAYS_PER_YEAR);

/** Facts an objective can read. `arg` says what the optional argument means. `mono` = never decreases (a cap on it can fail for good). */
export type FactArg = 'none' | 'building' | 'lift' | 'difficulty' | 'incident';
export interface FactInfo { id: string; label: string; arg: FactArg; argRequired?: boolean; mono?: boolean; unit: 'count' | 'money' | 'stars' | 'percent' | 'tiles' | 'days' }

export const FACTS = [
  { id: 'lifetimeGuests', label: 'Guests welcomed', arg: 'none', mono: true, unit: 'count' },
  { id: 'bestDayGuests', label: 'Guests on the best day', arg: 'none', mono: true, unit: 'count' },
  { id: 'familyGuests', label: 'Family guests welcomed', arg: 'none', mono: true, unit: 'count' },
  { id: 'summerGuests', label: 'Guests welcomed in summer', arg: 'none', mono: true, unit: 'count' },
  { id: 'stars', label: 'Resort rating', arg: 'none', unit: 'stars' },
  { id: 'happiness', label: 'Guest happiness', arg: 'none', unit: 'percent' },
  { id: 'familyHappiness', label: 'Family happiness', arg: 'none', unit: 'percent' },
  { id: 'money', label: 'Cash', arg: 'none', unit: 'money' },
  { id: 'debt', label: 'Debt', arg: 'none', unit: 'money' },
  { id: 'monthlyProfit', label: 'Profit of the last month', arg: 'none', unit: 'money' },
  { id: 'annualProfit', label: 'Profit of the last 12 months', arg: 'none', unit: 'money' },
  { id: 'profitMonths', label: 'Months closed in profit', arg: 'none', mono: true, unit: 'count' },
  { id: 'buildings', label: 'Buildings of a type', arg: 'building', argRequired: true, unit: 'count' },
  { id: 'liftsOpen', label: 'Open lifts (of a kind)', arg: 'lift', unit: 'count' },
  { id: 'liftKinds', label: 'Different lift kinds', arg: 'none', unit: 'count' },
  { id: 'pisteTiles', label: 'Connected piste tiles (of a difficulty 1-4)', arg: 'difficulty', unit: 'tiles' },
  { id: 'trailTiles', label: 'Hiking and biking trail tiles', arg: 'none', unit: 'tiles' },
  { id: 'hikeTiles', label: 'Hiking trail tiles', arg: 'none', unit: 'tiles' },
  { id: 'mtbTiles', label: 'Mountain-bike trail tiles', arg: 'none', unit: 'tiles' },
  { id: 'highTrailTiles', label: 'Trail tiles in the top third of the mountain', arg: 'none', unit: 'tiles' },
  { id: 'openDays', label: 'Days with lifts and pistes open', arg: 'none', mono: true, unit: 'days' },
  { id: 'groomedNights', label: 'Nights groomed', arg: 'none', mono: true, unit: 'count' },
  { id: 'rescues', label: 'Rescues completed', arg: 'none', mono: true, unit: 'count' },
  { id: 'incidents', label: 'Incidents (created / hospitalised / severe / wildlife)', arg: 'incident', argRequired: true, mono: true, unit: 'count' },
  { id: 'level', label: 'Resort level (Career unlocks only)', arg: 'none', unit: 'count' },
] as const satisfies readonly FactInfo[];
export type FactId = (typeof FACTS)[number]['id'];
export const FACT_IDS: readonly string[] = FACTS.map((f) => f.id);
export const factInfo = (id: string): FactInfo | undefined => (FACTS as readonly FactInfo[]).find((f) => f.id === id);
export const INCIDENT_KINDS = ['created', 'hospitalised', 'severe', 'wildlife'] as const;

export type Comparator = '>=' | '<=' | '>' | '<';
export const COMPARATORS: readonly Comparator[] = ['>=', '<=', '>', '<'];

export interface ObjectiveDef {
  id: string;
  title: string;
  description?: string;
  fact: FactId;
  arg?: string | number;
  op: Comparator;
  target: number;
  /** Score points when met. */
  weight: number;
  /** All mandatory objectives met = the scenario is won. */
  mandatory?: boolean;
  /** Must hold for this many consecutive days before it counts (then it stays met). */
  hold?: number;
  /** Must be met by this time, otherwise the objective is failed for good. */
  by?: Deadline;
}

export interface MedalReq { objectives?: string[]; minScore?: number }

export interface ScenarioModifiers {
  /** Multiplier on daily snowfall (0.2..3). */
  snowMultiplier?: number;
  /** Relative arrival weights per guest type (0..5 each). */
  guestMix?: Partial<Record<(typeof GUEST_TYPE_NAMES)[number], number>>;
  costMultipliers?: { construction?: number; upkeep?: number; wages?: number };
  disabledBuildings?: string[];
  noLoans?: boolean;
  /** A loan that exists from day one. */
  startingDebt?: { amount: number; ratePct: number; termMonths: number };
  /** 0..2: wetter weather with more heavy days. */
  weatherHarsh?: number;
  /** Fixed number of bears (0..8). */
  bearsMax?: number;
  /** Multipliers on injuries and avalanche loading (0.2..4). */
  eventBias?: { incidents?: number; avalanche?: number };
}

export type StarterSpec = 'empty' | 'prebuilt' | { buildings: string[] };

export interface ScenarioDef {
  id: string;
  name: string;
  blurb: string;
  tagline: string;
  /** Difficulty 1..5 stars. */
  stars: number;
  mapSize: 64 | 128 | 256;
  seed: number;
  preset: TerrainPresetId;
  startSeason: StartSeason;
  difficulty?: DifficultyId;
  startMoney: number | null;
  startLoan: boolean;
  /** 'all' = everything unlocked, no levels; 'career' = levels + unlocks; a list = only these gated items ('lift:funicular') are unlocked, no levels. */
  unlocks: 'all' | 'career' | string[];
  starter: StarterSpec;
  modifiers: ScenarioModifiers;
  objectives: ObjectiveDef[];
  deadline: Deadline;
  medals: { bronze: MedalReq; silver: MedalReq; gold: MedalReq };
  failure: { bankrupt: boolean; ratingBelow?: { stars: number; months: number } };
  score: { speedBonus: number; marginBonus: number; margin?: { fact: FactId; arg?: string | number; par: number } };
}

export const SCENARIO_VERSION = 1;

// ---------------------------------------------------------------------------------------------------------------------------- validator

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const GATED_KEYS = new Set(UNLOCKS.map((u) => unlockKey(u.kind, u.id)));

export interface ValidationResult { ok: boolean; errors: string[]; def?: ScenarioDef }

/** Strict validation of one definition (unknown keys rejected, ranges checked, every reference resolved). Never throws. */
export function validateScenario(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const err = (path: string, msg: string): void => { errors.push(`${path}: ${msg}`); };
  if (!isObj(raw)) return { ok: false, errors: ['scenario: must be an object'] };
  const keys = (o: Obj, allowed: readonly string[], path: string): void => { for (const k of Object.keys(o)) if (!allowed.includes(k)) err(path ? `${path}.${k}` : k, `unknown key '${k}'`); };
  const str = (o: Obj, k: string, path: string, max: number, min = 1): void => {
    const v = o[k];
    if (typeof v !== 'string' || v.trim().length < min || v.length > max) err(`${path}${k}`, `must be a text of ${min}..${max} characters`);
  };
  const range = (o: Obj, k: string, path: string, lo: number, hi: number, integer = false): void => {
    const v = o[k];
    if (!num(v) || v < lo || v > hi || (integer && !Number.isInteger(v))) err(`${path}${k}`, `must be ${integer ? 'an integer' : 'a number'} in ${lo}..${hi}`);
  };
  const deadline = (v: unknown, path: string, allowYears = true): number => {
    if (!isObj(v)) { err(path, "must be {days:n}, {months:n} or {years:n}"); return 0; }
    const ks = Object.keys(v);
    if (ks.length !== 1 || !['days', 'months', 'years'].includes(ks[0]!)) { err(path, "must have exactly one of 'days', 'months', 'years'"); return 0; }
    const n = v[ks[0]!];
    if (!num(n) || !Number.isInteger(n) || n <= 0) { err(`${path}.${ks[0]}`, 'deadline must be a positive whole number (> 0)'); return 0; }
    if (!allowYears && ks[0] === 'years') err(path, 'years not allowed here');
    const d = deadlineDays(v as unknown as Deadline);
    if (d < 7 || d > DAYS_PER_YEAR * 10) err(path, `deadline must be between 7 days and 10 years (got ${d} days)`);
    return d;
  };
  const factRef = (fact: unknown, arg: unknown, path: string): void => {
    const info = typeof fact === 'string' ? factInfo(fact) : undefined;
    if (!info) { err(`${path}.fact`, `unknown fact '${String(fact)}' (known: ${FACT_IDS.join(', ')})`); return; }
    if (info.arg === 'none') { if (arg !== undefined) err(`${path}.arg`, `fact '${info.id}' takes no argument`); return; }
    if (arg === undefined) { if (info.argRequired) err(`${path}.arg`, `fact '${info.id}' needs an argument`); return; }
    if (info.arg === 'building') { if (typeof arg !== 'string' || !BUILDINGS[arg]) err(`${path}.arg`, `unknown building id '${String(arg)}'`); }
    else if (info.arg === 'lift') { if (typeof arg !== 'string' || !(arg in LIFTS)) err(`${path}.arg`, `unknown lift kind '${String(arg)}'`); }
    else if (info.arg === 'difficulty') { if (!num(arg) || ![1, 2, 3, 4].includes(arg)) err(`${path}.arg`, 'piste difficulty must be 1, 2, 3 or 4'); }
    else if (info.arg === 'incident') { if (typeof arg !== 'string' || !(INCIDENT_KINDS as readonly string[]).includes(arg)) err(`${path}.arg`, `incident kind must be one of ${INCIDENT_KINDS.join(', ')}`); }
  };

  const top = ['id', 'name', 'blurb', 'tagline', 'stars', 'mapSize', 'seed', 'preset', 'startSeason', 'difficulty', 'startMoney', 'startLoan', 'unlocks', 'starter', 'modifiers', 'objectives', 'deadline', 'medals', 'failure', 'score'];
  keys(raw, top, '');
  if (typeof raw.id !== 'string' || !/^[a-z][a-z0-9-]{2,31}$/.test(raw.id)) err('id', 'must be a lower-case slug (3..32 characters: a-z, 0-9, -)');
  str(raw, 'name', '', 40); str(raw, 'blurb', '', 280, 10); str(raw, 'tagline', '', 90, 3);
  range(raw, 'stars', '', 1, 5, true);
  if (![64, 128, 256].includes(raw.mapSize as number)) err('mapSize', 'must be 64, 128 or 256');
  range(raw, 'seed', '', 0, 999_999_999, true);
  if (!(PRESET_IDS as readonly string[]).includes(raw.preset as string)) err('preset', `must be one of ${PRESET_IDS.join(', ')}`);
  if (!(START_SEASONS as readonly string[]).includes(raw.startSeason as string)) err('startSeason', `must be one of ${START_SEASONS.join(', ')}`);
  if (raw.difficulty !== undefined && !(DIFFICULTY_IDS as readonly string[]).includes(raw.difficulty as string)) err('difficulty', `must be one of ${DIFFICULTY_IDS.join(', ')}`);
  if (raw.startMoney !== null) range(raw, 'startMoney', '', 0, 5_000_000, true);
  if (typeof raw.startLoan !== 'boolean') err('startLoan', 'must be true or false');

  if (raw.unlocks === 'all' || raw.unlocks === 'career') { /* ok */ }
  else if (Array.isArray(raw.unlocks)) { for (const k of raw.unlocks) if (typeof k !== 'string' || !GATED_KEYS.has(k)) err('unlocks', `unknown gated item '${String(k)}' (known: ${[...GATED_KEYS].join(', ')})`); }
  else err('unlocks', "must be 'all', 'career' or a list of gated items");

  const st = raw.starter;
  if (st === 'empty' || st === 'prebuilt') { /* ok */ }
  else if (isObj(st)) {
    keys(st, ['buildings'], 'starter');
    if (!Array.isArray(st.buildings) || st.buildings.length === 0 || st.buildings.length > 24) err('starter.buildings', 'must be a list of 1..24 building ids');
    else for (const b of st.buildings) if (typeof b !== 'string' || !BUILDINGS[b]) err('starter.buildings', `unknown building id '${String(b)}'`);
  } else err('starter', "must be 'empty', 'prebuilt' or {buildings:[...]}");

  const disabled: string[] = [];
  if (!isObj(raw.modifiers)) err('modifiers', 'must be an object (may be empty)');
  else {
    const m = raw.modifiers;
    keys(m, ['snowMultiplier', 'guestMix', 'costMultipliers', 'disabledBuildings', 'noLoans', 'startingDebt', 'weatherHarsh', 'bearsMax', 'eventBias'], 'modifiers');
    if (m.snowMultiplier !== undefined) range(m, 'snowMultiplier', 'modifiers.', 0.2, 3);
    if (m.weatherHarsh !== undefined) range(m, 'weatherHarsh', 'modifiers.', 0, 2);
    if (m.bearsMax !== undefined) range(m, 'bearsMax', 'modifiers.', 0, 8, true);
    if (m.noLoans !== undefined && typeof m.noLoans !== 'boolean') err('modifiers.noLoans', 'must be true or false');
    if (m.guestMix !== undefined) {
      if (!isObj(m.guestMix)) err('modifiers.guestMix', 'must be an object');
      else { keys(m.guestMix, GUEST_TYPE_NAMES, 'modifiers.guestMix'); for (const k of Object.keys(m.guestMix)) if ((GUEST_TYPE_NAMES as readonly string[]).includes(k)) range(m.guestMix, k, 'modifiers.guestMix.', 0, 5); }
    }
    if (m.costMultipliers !== undefined) {
      if (!isObj(m.costMultipliers)) err('modifiers.costMultipliers', 'must be an object');
      else { keys(m.costMultipliers, ['construction', 'upkeep', 'wages'], 'modifiers.costMultipliers'); for (const k of ['construction', 'upkeep', 'wages']) if (m.costMultipliers[k] !== undefined) range(m.costMultipliers, k, 'modifiers.costMultipliers.', 0.3, 3); }
    }
    if (m.eventBias !== undefined) {
      if (!isObj(m.eventBias)) err('modifiers.eventBias', 'must be an object');
      else { keys(m.eventBias, ['incidents', 'avalanche'], 'modifiers.eventBias'); for (const k of ['incidents', 'avalanche']) if (m.eventBias[k] !== undefined) range(m.eventBias, k, 'modifiers.eventBias.', 0.2, 4); }
    }
    if (m.disabledBuildings !== undefined) {
      if (!Array.isArray(m.disabledBuildings)) err('modifiers.disabledBuildings', 'must be a list of building ids');
      else for (const b of m.disabledBuildings) { if (typeof b !== 'string' || !BUILDINGS[b]) err('modifiers.disabledBuildings', `unknown building id '${String(b)}'`); else disabled.push(b); }
    }
    if (m.startingDebt !== undefined) {
      if (!isObj(m.startingDebt)) err('modifiers.startingDebt', 'must be an object');
      else { keys(m.startingDebt, ['amount', 'ratePct', 'termMonths'], 'modifiers.startingDebt'); range(m.startingDebt, 'amount', 'modifiers.startingDebt.', 1000, 5_000_000, true); range(m.startingDebt, 'ratePct', 'modifiers.startingDebt.', 0, 25); range(m.startingDebt, 'termMonths', 'modifiers.startingDebt.', 6, 240, true); }
    }
  }
  if (isObj(st) && Array.isArray(st.buildings)) for (const b of st.buildings) if (disabled.includes(b as string)) err('starter.buildings', `'${String(b)}' is also in disabledBuildings`);

  const total = deadline(raw.deadline, 'deadline');
  const ids = new Set<string>();
  let mandatory = 0, weightSum = 0;
  if (!Array.isArray(raw.objectives) || raw.objectives.length < 1 || raw.objectives.length > 10) err('objectives', 'must be a list of 1..10 objectives');
  else raw.objectives.forEach((o: unknown, i: number) => {
    const p = `objectives[${i}]`;
    if (!isObj(o)) { err(p, 'must be an object'); return; }
    keys(o, ['id', 'title', 'description', 'fact', 'arg', 'op', 'target', 'weight', 'mandatory', 'hold', 'by'], p);
    if (typeof o.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]{1,24}$/.test(o.id)) err(`${p}.id`, 'must be an identifier (2..25 letters / digits)');
    else if (ids.has(o.id)) err(`${p}.id`, `duplicate objective id '${o.id}'`); else ids.add(o.id);
    str(o, 'title', `${p}.`, 70);
    if (o.description !== undefined) str(o, 'description', `${p}.`, 200);
    factRef(o.fact, o.arg, p);
    if (!COMPARATORS.includes(o.op as Comparator)) err(`${p}.op`, `must be one of ${COMPARATORS.join(' ')}`);
    if (!num(o.target)) err(`${p}.target`, 'must be a number'); else if (o.target < 0) err(`${p}.target`, 'must be >= 0');
    range(o, 'weight', `${p}.`, 1, 1000, true);
    if (typeof o.weight === 'number') weightSum += o.weight;
    if (o.mandatory !== undefined && typeof o.mandatory !== 'boolean') err(`${p}.mandatory`, 'must be true or false');
    if (o.mandatory === true) mandatory++;
    if (o.hold !== undefined) { range(o, 'hold', `${p}.`, 1, DAYS_PER_YEAR, true); if (typeof o.hold === 'number' && total > 0 && o.hold >= total) err(`${p}.hold`, 'hold must be shorter than the scenario deadline'); }
    if (o.by !== undefined) { const d = deadline(o.by, `${p}.by`); if (total > 0 && d > total) err(`${p}.by`, 'objective deadline is after the scenario deadline'); }
    if (typeof o.fact === 'string' && o.fact === 'level' && raw.unlocks !== 'career') err(`${p}.fact`, "'level' needs unlocks: 'career'");
  });
  if (mandatory === 0 && Array.isArray(raw.objectives)) err('objectives', 'at least one objective must be mandatory (the scenario is won when all mandatory objectives are met)');
  else if (Array.isArray(raw.objectives) && !raw.objectives.some((o: unknown) => isObj(o) && o.mandatory === true && (o.op === '>=' || o.op === '>'))) err('objectives', "at least one mandatory objective must be a goal ('>=' or '>'), not only a cap: a cap is met from day one");

  const medalReq = (m: unknown, path: string): number => {
    if (!isObj(m)) { err(path, 'must be an object'); return 0; }
    keys(m, ['objectives', 'minScore'], path);
    if (m.objectives !== undefined) {
      if (!Array.isArray(m.objectives)) err(`${path}.objectives`, 'must be a list of objective ids');
      else for (const id of m.objectives) if (typeof id !== 'string' || !ids.has(id)) err(`${path}.objectives`, `unknown objective id '${String(id)}'`);
    }
    if (m.minScore !== undefined) range(m, 'minScore', `${path}.`, 0, 100000, true);
    return typeof m.minScore === 'number' ? m.minScore : 0;
  };
  let gold = 0, silver = 0, bronze = 0;
  if (isObj(raw.medals) && isObj(raw.medals.bronze) && Object.keys(raw.medals.bronze).length > 0) err('medals.bronze', 'bronze is awarded for meeting every mandatory objective: leave it empty ({})');
  if (!isObj(raw.medals)) err('medals', 'must be {bronze, silver, gold}');
  else { keys(raw.medals, ['bronze', 'silver', 'gold'], 'medals'); bronze = medalReq(raw.medals.bronze, 'medals.bronze'); silver = medalReq(raw.medals.silver, 'medals.silver'); gold = medalReq(raw.medals.gold, 'medals.gold'); if (!(bronze <= silver && silver <= gold)) err('medals', `minScore must grow bronze (${bronze}) <= silver (${silver}) <= gold (${gold})`); }

  if (!isObj(raw.failure)) err('failure', 'must be an object');
  else {
    keys(raw.failure, ['bankrupt', 'ratingBelow'], 'failure');
    if (typeof raw.failure.bankrupt !== 'boolean') err('failure.bankrupt', 'must be true or false');
    if (raw.failure.ratingBelow !== undefined) {
      const r = raw.failure.ratingBelow;
      if (!isObj(r)) err('failure.ratingBelow', 'must be {stars, months}');
      else { keys(r, ['stars', 'months'], 'failure.ratingBelow'); range(r, 'stars', 'failure.ratingBelow.', 0.5, 5); range(r, 'months', 'failure.ratingBelow.', 1, 48, true); }
    }
  }

  let scoreMax = weightSum;
  if (!isObj(raw.score)) err('score', 'must be {speedBonus, marginBonus}');
  else {
    const s = raw.score;
    keys(s, ['speedBonus', 'marginBonus', 'margin'], 'score');
    range(s, 'speedBonus', 'score.', 0, 1000, true); range(s, 'marginBonus', 'score.', 0, 1000, true);
    if (num(s.speedBonus)) scoreMax += s.speedBonus;
    if (num(s.marginBonus)) scoreMax += s.marginBonus;
    if (s.margin !== undefined) {
      if (!isObj(s.margin)) err('score.margin', 'must be {fact, arg?, par}');
      else { keys(s.margin, ['fact', 'arg', 'par'], 'score.margin'); factRef(s.margin.fact, s.margin.arg, 'score.margin'); if (!num(s.margin.par) || s.margin.par <= 0) err('score.margin.par', 'must be a number > 0'); }
    } else if (num(s.marginBonus) && s.marginBonus > 0) err('score.margin', 'a marginBonus needs a margin {fact, par}');
  }
  if (gold > scoreMax) err('medals.gold.minScore', `${gold} is above the best possible score (${scoreMax})`);

  return errors.length ? { ok: false, errors } : { ok: true, errors, def: raw as unknown as ScenarioDef };
}

/** Validate or throw one readable error (used when building the shipped index). */
export function assertScenario(raw: unknown, label = 'scenario'): ScenarioDef {
  const r = validateScenario(raw);
  if (!r.ok) throw new Error(`Invalid ${label}:\n  ${r.errors.join('\n  ')}`);
  return r.def!;
}

/** Best possible score of a definition (objective weights + both bonuses). */
export const maxScore = (d: ScenarioDef): number => d.objectives.reduce((a, o) => a + o.weight, 0) + d.score.speedBonus + d.score.marginBonus;
