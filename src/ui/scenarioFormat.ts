/**
 * Pure helpers for the scenario UI (picker, HUD card, result dialog): ordering, wording and medal tiers. No DOM.
 */
import type { ScenarioDef } from '../sim/scenario/ScenarioDef';
import { deadlineDays } from '../sim/scenario/ScenarioDef';
import type { Medal, ObjectiveView } from '../sim/scenario/ScenarioRunner';
import type { AwardTier } from '../config/yearAwards';
import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../config/balance';

export const MEDAL_TIER: Record<Medal, AwardTier> = { none: 0, bronze: 1, silver: 2, gold: 3 };
export const MEDAL_LABEL: Record<Medal, string> = { none: 'No medal', bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
export const SEASON_LABEL: Record<ScenarioDef['startSeason'], string> = { winter: 'Winter start', spring: 'Spring start', summer: 'Summer start', autumn: 'Autumn start' };

/** Objectives in the order the HUD card shows them: unmet required first, then unmet optional, then met ones (failed last of the unmet). */
export function sortObjectives(list: readonly ObjectiveView[]): ObjectiveView[] {
  const rank = (o: ObjectiveView): number => (o.met ? 4 : o.failed ? 3 : o.mandatory ? 1 : 2);
  return [...list].map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).map((x) => x.o);
}

/** 'Year 1' / '6 months' / '45 days' for the picker. */
export function deadlineText(d: ScenarioDef): string {
  const days = deadlineDays(d.deadline);
  if (days % DAYS_PER_YEAR === 0) { const y = days / DAYS_PER_YEAR; return `${y} year${y === 1 ? '' : 's'}`; }
  if (days % DAYS_PER_MONTH === 0) { const m = days / DAYS_PER_MONTH; return `${m} month${m === 1 ? '' : 's'}`; }
  return `${days} days`;
}

/** Short objectives summary for a picker card: the required objectives (first three) and how many optional ones. */
export function objectiveSummary(d: ScenarioDef): { required: string[]; moreRequired: number; optional: number } {
  const req = d.objectives.filter((o) => o.mandatory);
  return { required: req.slice(0, 3).map((o) => o.title), moreRequired: Math.max(0, req.length - 3), optional: d.objectives.length - req.length };
}

export const starsText = (n: number): string => '\u2605'.repeat(n) + '\u2606'.repeat(Math.max(0, 5 - n));
export const DIFFICULTY_WORD = ['', 'Easy', 'Gentle', 'Medium', 'Hard', 'Expert'] as const;
