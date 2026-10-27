import { Act } from '@/sim/guests/Decision';
import { GState, SKILL_NAMES, typeKey, typeLabel, type GuestStore } from '@/sim/guests/Guest';
import { contextThoughts, thoughts, type ThoughtCtx } from '@/sim/guests/Needs';

export interface GuestInspectorModel {
  id: number;
  title: string;
  type: string;
  skill: string;
  bars: Array<{ id: 'hunger' | 'fatigue' | 'happiness' | 'budget'; label: string; value: number; text: string; good: 'high' | 'low' }>;
  activity: string;
  queue: string | null;
  family: string | null;
  thoughts: string[];
  /** Story guest (sim/guests/Stories.ts): name, wish line, optional progress counter. */
  story: { name: string; goal: string; progress: string | null; pinned: boolean; following: boolean } | null;
  x: number; y: number;
}

const ACT: Record<number, string> = { [Act.None]: 'Deciding what to do', [Act.ToBuilding]: 'Heading to a building', [Act.ToLift]: 'Heading to a lift', [Act.Queue]: 'Queueing for a lift', [Act.Ride]: 'Riding a lift', [Act.SkiDown]: 'Skiing down', [Act.ToTrail]: 'Heading to a trail', [Act.Excursion]: 'On an excursion' };
export const BUDGET_BAR_MAX = 500;

/** Pure model for the guest inspector (null if the slot is dead). `familyText` comes from Families.describe. */
export function guestInspectorModel(s: GuestStore, slot: number, extra: { story?: GuestInspectorModel['story']; familyText?: string | null; ctx?: ThoughtCtx; queueLift?: string | null; excursionText?: string | null } = {}): GuestInspectorModel | null {
  if (slot < 0 || !s.alive[slot]) return null;
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const st = s.state[slot]!;
  let activity = ACT[s.act[slot]!] ?? 'Idle';
  if (st === GState.Sleeping) activity = 'Sleeping'; else if (st === GState.Leaving) activity = 'Heading home'; else if (st === GState.Injured) activity = 'Injured, waiting for help'; else if (st === GState.Using) activity = 'Using an attraction';
  else if (st === GState.Queueing) activity = 'Queueing for a lift'; else if (st === GState.Riding) activity = 'Riding a lift';
  if (extra.excursionText && st !== GState.Leaving) activity = extra.excursionText;
  const budget = s.budget[slot]!;
  const ctx: ThoughtCtx = { queueTicks: 0, ...extra.ctx };
  const th = [...contextThoughts(ctx), ...thoughts(s, slot)];
  return {
    id: s.id[slot]!, title: extra.story ? extra.story.name : `Guest #${s.id[slot]}`, story: extra.story ?? null,
    type: s.type[slot]! < 6 ? typeKey(s.type[slot]!) : typeLabel(s.type[slot]!), skill: SKILL_NAMES[s.skill[slot]!] ?? 'beginner',
    bars: [
      { id: 'hunger', label: 'Hunger', value: s.hunger[slot]!, text: pct(s.hunger[slot]!), good: 'low' },
      { id: 'fatigue', label: 'Fatigue', value: s.fatigue[slot]!, text: pct(s.fatigue[slot]!), good: 'low' },
      { id: 'happiness', label: 'Happiness', value: s.happiness[slot]!, text: pct(s.happiness[slot]!), good: 'high' },
      { id: 'budget', label: 'Budget', value: Math.max(0, Math.min(1, budget / BUDGET_BAR_MAX)), text: `$${Math.round(budget)}`, good: 'high' },
    ],
    activity, queue: st === GState.Queueing ? (extra.queueLift ?? 'a lift') : null, family: extra.familyText ?? null,
    thoughts: th, x: s.x[slot]!, y: s.y[slot]!,
  };
}

export const barColour = (value: number, good: 'high' | 'low'): string => {
  const v = good === 'high' ? value : 1 - value;
  return v > 0.66 ? '#4caf50' : v > 0.33 ? '#e0a030' : '#e05555';
};
