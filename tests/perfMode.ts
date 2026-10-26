/** Perf-test mode. `npm test` = coarse guards (budgets x GUARD); `npm run test:perf` (PERF=1, single worker) = real thresholds. */
export const PERF = process.env.PERF === '1';
export const GUARD = PERF ? 1 : 5;
/** Scale a ms budget: strict in perf mode, 5x in the default run so CPU contention cannot fail it. */
export const budget = (ms: number): number => ms * GUARD;
/** Scale a minimum-speedup ratio: strict in perf mode, loosened (/5) in the default run. */
export const minRatio = (r: number): number => (PERF ? r : Math.max(1.5, r / 5));
