/**
 * Game modes + resort levels (M5.3, Task 14). Documented in docs/progression.md; every number here is tunable.
 *
 * Career (default for NEW games): the resort has a LEVEL 1..6 computed from sim state; a short list of items (`config/unlocks.ts`) unlocks with it.
 * Sandbox (old saves, `?mode=sandbox`, the New Game radio): everything is unlocked and no level is tracked. The goal chain works in both modes.
 *
 * A level is reached when ALL of its criteria hold (stars, lifetime guests, best single day, months closed in profit, goal chapters completed and,
 * for the top levels, the rolling 12-month profit). The level is LATCHED: it never decreases, even when the rating drops or a bad winter eats the profit.
 * Calibrated to the balance bot (scripts/analysis/progressionCalibrate.ts): the bot (which only completes the first goal chapter) reaches L2 in
 * the first week, L3 about 30 days in (mid first winter), L4 at the end of the first year / early year 2 (M5.3 pacing pass: ~30 % sooner than before) and never L5 (that needs the human goal chapters).
 */
export type GameMode = 'career' | 'sandbox';
export const GAME_MODES: readonly GameMode[] = ['career', 'sandbox'];
export const DEFAULT_MODE: GameMode = 'career';

export const MODE_INFO: Record<GameMode, { label: string; blurb: string; tip: string }> = {
  career: {
    label: 'Career',
    blurb: 'Grow from a small hill to an alpine destination. A few big lifts and buildings unlock as your resort levels up.',
    tip: 'Career: the resort levels up with stars, guests and profit. Gondolas, funiculars, helipads and a few more items unlock along the way. Recommended.',
  },
  sandbox: {
    label: 'Sandbox',
    blurb: 'Everything is available from the start. Goals still work, but nothing is locked.',
    tip: 'Sandbox: every lift, building and campaign is unlocked from day one. Goals are optional.',
  },
};

export interface LevelDef {
  level: number;
  /** Career title (matches the goal chapters where they line up). */
  name: string;
  /** Minimum resort rating (stars). */
  stars: number;
  /** Lifetime guests (arrivals). */
  guests: number;
  /** Best single day of arrivals. */
  peakDay: number;
  /** Months closed with a positive net. */
  profitMonths: number;
  /** Goal chapters completed (of 4). */
  chapters: number;
  /** Rolling 12-month net profit (dollars). */
  annualProfit: number;
}

export const LEVELS: readonly LevelDef[] = [
  { level: 1, name: 'Open for business', stars: 0, guests: 0, peakDay: 0, profitMonths: 0, chapters: 0, annualProfit: -Infinity },
  { level: 2, name: 'Local favourite', stars: 2, guests: 150, peakDay: 15, profitMonths: 0, chapters: 0, annualProfit: -Infinity },
  { level: 3, name: 'Regional name', stars: 3, guests: 750, peakDay: 30, profitMonths: 1, chapters: 1, annualProfit: -Infinity },
  { level: 4, name: 'Alpine destination', stars: 3.5, guests: 1_900, peakDay: 40, profitMonths: 3, chapters: 1, annualProfit: -Infinity },
  { level: 5, name: 'International resort', stars: 4, guests: 5_500, peakDay: 60, profitMonths: 10, chapters: 2, annualProfit: 45_000 },
  { level: 6, name: 'World-class destination', stars: 4.5, guests: 14_000, peakDay: 100, profitMonths: 22, chapters: 4, annualProfit: 110_000 },
];
export const MAX_LEVEL = LEVELS.length;
export const levelDef = (level: number): LevelDef => LEVELS[Math.max(1, Math.min(MAX_LEVEL, Math.trunc(level))) - 1]!;
export const levelName = (level: number): string => levelDef(level).name;

/** Months of net profit summed for the `annualProfit` criterion. */
export const PROFIT_WINDOW_MONTHS = 12;
