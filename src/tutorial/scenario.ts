import type { Grid } from '../world/Grid';
import { skiableStats } from '../world/Skiable';

/**
 * The tutorial map: a fixed 64×64 gentle valley in early winter with generous money. The seed was picked by scanning seeds 1..120 with
 * `scoreTerrain` (flat village benches + a skiable flank + lakes) AND by running the full "do it for me" bot on each (every lesson buildable
 * without a single failure on all 120; seed 61 has the best skiable fraction with three lakes and the cheapest chain). tests/tutorial
 * re-checks both on every run, so a terrain-generator change that breaks the lesson chain is caught.
 */
export const TUTORIAL_SCENARIO = {
  size: 64 as const,
  seed: 61,
  startSeason: 'winter' as const,
  money: 400_000,
} as const;

/** Terrain-only suitability score (higher = better tutorial valley). Used by the seed search. */
export function scoreTerrain(grid: Grid, lakeCount: number): number {
  const s = skiableStats(grid);
  return s.skiableFrac * 2 + s.dropFrac + Math.min(lakeCount, 2) * 0.1;
}

/** createSim options for the tutorial scenario. */
export function tutorialSimOptions(): { size: 64; seed: number; startSeason: 'winter'; money: number } {
  return { size: TUTORIAL_SCENARIO.size, seed: TUTORIAL_SCENARIO.seed, startSeason: TUTORIAL_SCENARIO.startSeason, money: TUTORIAL_SCENARIO.money };
}

/** `?tutorial=1` boots the tutorial scenario (main menu entry comes with Task 35). */
export function isTutorialRequest(params: URLSearchParams): boolean {
  const v = params.get('tutorial');
  return v === '1' || v === 'true';
}

/** The URL query that starts the tutorial scenario (used by Help / Settings 'Replay tutorial'). */
export const TUTORIAL_QUERY = '?tutorial=1';
