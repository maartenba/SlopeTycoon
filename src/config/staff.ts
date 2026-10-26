/**
 * Light staff system (M5.4 Task 19, D6). Four pools; AUTO (the default) reproduces the pre-staff behaviour exactly (golden hash, tests/sim/staff.test.ts).
 * Constants only: the mechanics live in `sim/staff/Staff.ts`. Docs: docs/staff.md.
 */
export type StaffPoolId = 'instructors' | 'patrol' | 'groomers' | 'liftOps';
export const STAFF_POOLS: readonly StaffPoolId[] = ['instructors', 'patrol', 'groomers', 'liftOps'];

export const POOL_INFO: Record<StaffPoolId, { label: string; icon: string; /** What a shortage slows. */ slows: string }> = {
  instructors: { label: 'Instructors', icon: '🎿', slows: 'ski-school lesson capacity' },
  patrol: { label: 'Patrol', icon: '⛑️', slows: 'rescue sled speed' },
  groomers: { label: 'Groomers', icon: '🚜', slows: 'snowcats on the night shift' },
  liftOps: { label: 'Lift operators', icon: '🚡', slows: 'lift loading speed' },
};

export type WageLevel = 'low' | 'normal' | 'high';
export const WAGE_LEVELS: readonly WageLevel[] = ['low', 'normal', 'high'];

export const STAFF = {
  /** Multiplier on the daily staff wage bill. 'normal' = exactly 1 (Auto is bit-identical). */
  wageMult: { low: 0.8, normal: 1, high: 1.25 } as Record<WageLevel, number>,
  /** Morale each wage level settles at (0..1). */
  moraleTarget: { low: 0.4, normal: 0.7, high: 0.9 } as Record<WageLevel, number>,
  /** Morale moves at most this much per day toward its target. */
  moraleStep: 0.05,
  /** Extra pull-down on the target when a pool is understaffed: x (1 - worst fill ratio). */
  overworkPenalty: 0.3,
  /** Breakdown multiplier: below `lowBelow` morale the crew gets sloppy; above `highAbove` they are careful. Between = exactly 1. */
  lowBelow: 0.5, highAbove: 0.85, sloppy: 1.2, careful: 0.9,
  /** Floor for how much an understaffed pool can slow its system (fill ratio is clamped to this). */
  minFill: 0.3,
  maxPerPool: 40,
  /** Operators per lift (the auto crew). */
  liftCrew: { tbar: 1, chair: 2, gondola: 3, cablecar: 3, funicular: 3 } as Record<string, number>,
  /** How often (ticks) an override recomputes the auto headcounts. */
  refreshTicks: 20,
} as const;
