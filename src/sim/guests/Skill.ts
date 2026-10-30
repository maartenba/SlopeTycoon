import { INJURY_BASE, INJURY_PER_LEVEL } from '../../config/balance';
import { extraDef } from '../../config/guestTypes';
import type { GuestStore } from './Guest';

/** Skill levels: 0 beginner, 1 intermediate, 2 advanced, 3 expert. Piste difficulty 0 green .. 3 black. */
export const MAX_SKILL = 3;

/** Hardest piste a guest of this skill will take (difficulty <= skill + 1, black only from advanced up). */
export const maxDifficultyFor = (skill: number): number => Math.min(3, skill + 1);

/** Highest skill a guest type ever reaches (extra types may cap it, seniors at intermediate: no black runs); core types = MAX_SKILL. */
export const skillCapOf = (type: number): number => (type >= 6 ? extraDef(type)?.maxSkill ?? MAX_SKILL : MAX_SKILL);

/** Experience needed to leave `skill`. */
export const xpToLevel = (skill: number): number => 5 + 5 * skill;

/** Experience for a completed run: stretching (difficulty >= skill) teaches most, easy runs a little. */
export function runXp(difficulty: number, skill: number): number {
  if (difficulty > skill) return 1.2;
  if (difficulty === skill) return 1;
  return 0.25;
}

/** Record a completed run: bumps the counters and may level the guest up. Returns true on level-up. */
export function recordRun(s: GuestStore, i: number, difficulty: number): boolean {
  s.runs[i] = Math.min(65535, s.runs[i]! + 1);
  const skill = s.skill[i]!;
  if (skill >= skillCapOf(s.type[i]!)) return false;
  s.skillXp[i] = s.skillXp[i]! + runXp(difficulty, skill);
  if (s.skillXp[i]! >= xpToLevel(skill)) { s.skill[i] = skill + 1; s.skillXp[i] = 0; return true; }
  return false;
}

/** Lessons (Task 22) call this to grant experience directly. */
export function addLessonXp(s: GuestStore, i: number, xp: number): void {
  const skill = s.skill[i]!, cap = skillCapOf(s.type[i]!);
  if (skill >= cap) return;
  s.skillXp[i] = s.skillXp[i]! + xp;
  while (s.skill[i]! < cap && s.skillXp[i]! >= xpToLevel(s.skill[i]!)) { s.skillXp[i] = s.skillXp[i]! - xpToLevel(s.skill[i]!); s.skill[i] = s.skill[i]! + 1; }
}

/** Injury probability for one run whose hardest piste had `difficulty` (piste-quality placeholder: 0.5 neutral, worse snow = riskier). */
export function injuryRisk(difficulty: number, skill: number, quality = 0.5): number {
  const over = Math.max(0, difficulty - skill);
  return (INJURY_BASE + INJURY_PER_LEVEL * over * over) * (1.5 - quality);
}
