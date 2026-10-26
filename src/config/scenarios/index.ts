/**
 * The six shipped scenarios (M5.3 Task 15). Every JSON file is validated at import time (`assertScenario`): a typo fails the build / test run
 * at once. There is no user import of scenario files (decision D8). How to add one: docs/scenarios.md.
 */
import type { GameConfig } from '../../game/difficulty';
import { assertScenario, type ScenarioDef } from '../../sim/scenario/ScenarioDef';
import firstTracks from './first-tracks.json';
import familyValley from './family-valley.json';
import powderDreams from './powder-dreams.json';
import summerEscape from './summer-escape.json';
import alpineGiant from './alpine-giant.json';
import safeSlopes from './safe-slopes.json';

const RAW: ReadonlyArray<[string, unknown]> = [
  ['first-tracks', firstTracks], ['family-valley', familyValley], ['powder-dreams', powderDreams],
  ['summer-escape', summerEscape], ['alpine-giant', alpineGiant], ['safe-slopes', safeSlopes],
];

/** In picker order (easy to hard). */
export const SCENARIOS: readonly ScenarioDef[] = RAW.map(([id, raw]) => {
  const d = assertScenario(raw, `scenario '${id}'`);
  if (d.id !== id) throw new Error(`scenario file '${id}.json' has id '${d.id}'`);
  return d;
});
export const getScenario = (id: string): ScenarioDef | undefined => SCENARIOS.find((s) => s.id === id);

/** The URL query that starts a scenario (the New Game reload path: `?scenario=<id>`). */
export const scenarioQuery = (id: string): string => `scenario=${id}`;

/** createSim options for a scenario (size / seed / preset / season / money / mode / starter all come from the definition). */
export function scenarioSimOptions(d: ScenarioDef): { size: 64 | 128 | 256; seed: number; startSeason: ScenarioDef['startSeason']; preset: ScenarioDef['preset']; difficulty?: NonNullable<ScenarioDef['difficulty']>; money?: number; startLoan: boolean; starterResort: boolean; mode: 'career' | 'sandbox'; scenario: string } {
  return {
    size: d.mapSize, seed: d.seed, startSeason: d.startSeason, preset: d.preset, ...(d.difficulty ? { difficulty: d.difficulty } : {}),
    ...(d.startMoney !== null ? { money: d.startMoney } : {}), startLoan: d.startLoan, starterResort: d.starter === 'prebuilt',
    mode: d.unlocks === 'career' ? 'career' : 'sandbox', scenario: d.id,
  };
}
/** The GameConfig of a scenario game (what the save's `config` module stores). */
export const scenarioConfigPatch = (d: ScenarioDef): Partial<GameConfig> => ({ size: d.mapSize, seed: d.seed, preset: d.preset, startSeason: d.startSeason, difficulty: d.difficulty ?? 'normal', money: d.startMoney, startLoan: d.startLoan, starterResort: d.starter === 'prebuilt', mode: d.unlocks === 'career' ? 'career' : 'sandbox', scenario: d.id });
