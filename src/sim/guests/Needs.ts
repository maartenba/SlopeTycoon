import { extraDef } from '../../config/guestTypes';
import { GState, Leave, GuestStore, SKILL_NAMES, GSTATE_NAMES, typeKey } from './Guest';

/** Per-tick need growth (240 ticks = one in-game day). */
export const NEEDS = {
  hungerWalk: 0.004, hungerIdle: 0.002,
  /** Hunger per tick during a compressed hike / bike excursion (relaxed pace: slightly below `hungerWalk`; docs/hiking.md 'Hunger audit'). */
  hungerHike: 0.003, fatigueWalk: 0.003, fatigueIdle: 0.0012, fatigueSleep: -0.012,
  /** happiness drifts toward its target at this rate per tick */
  happinessRate: 0.05,
  unhappyBelow: 0.2, unhappyTicks: 20, tiredAbove: 0.95, brokeBelow: 5,
  hungryAbove: 0.55,
  /** Hikers / bikers go and eat before a planned excursion above this hunger (the generic hungry mark is 0.55). */
  hungryExcursion: 0.45,
  /** Comfort need (docs/comfort.md): urge growth per tick (only with `NeedEnv.comfort`), and the urge above which a guest looks for a toilet. */
  urgeWalk: 0.010, urgeIdle: 0.005, urgeSeek: 0.55,
  /** Largest happiness-target penalty an unmet urge can cost (never worse than this). */
  urgePenalty: 0.18,
} as const;

/** External factors feeding happiness (stubs for queues / piste quality until later tasks). */
export interface NeedEnv {
  /** Guests in the same 8×8 cell. */
  crowd: number;
  /** 0..~0.3 penalty from weather (storm, rain, fog). */
  weatherPenalty: number;
  /** 0..1 piste quality stub (0.5 neutral). */
  pisteQuality: number;
  /** Average queue wait, minutes (stub 0). */
  queueMinutes: number;
  /** Comfort need on (createSim default): the urge grows and an unmet urge costs a little happiness. Absent / false = the old needs, bit for bit. */
  comfort?: boolean;
}

export const NEUTRAL_ENV: NeedEnv = { crowd: 0, weatherPenalty: 0, pisteQuality: 0.5, queueMinutes: 0 };

/** Target happiness from needs and environment, clamped 0..1. */
export function happinessTarget(hunger: number, fatigue: number, env: NeedEnv, urge = 0): number {
  const crowdPen = Math.min(0.2, Math.max(0, env.crowd - 25) * 0.004);
  const queuePen = Math.min(0.25, env.queueMinutes * 0.01);
  const t = 1 - 0.45 * hunger * hunger - 0.4 * fatigue * fatigue - crowdPen - queuePen - env.weatherPenalty - NEEDS.urgePenalty * urge * urge + 0.15 * (env.pisteQuality - 0.5);
  return Math.min(1, Math.max(0, t));
}

/**
 * Advance one guest's needs by one tick. Returns a Leave reason code (Tired/Broke/Bored) when the guest decides to leave, else 0.
 * Sleeping guests recover fatigue instead of accumulating.
 */
export function tickNeeds(s: GuestStore, i: number, env: NeedEnv): number {
  const st = s.state[i]!;
  const walking = st === GState.Walking || st === GState.Leaving;
  const tn = s.type[i]! >= 6 ? extraDef(s.type[i]!)?.needs : undefined; // per-type multipliers (extra types only; core = exactly the old numbers)
  if (st === GState.Sleeping) s.fatigue[i] = Math.max(0, s.fatigue[i]! + NEEDS.fatigueSleep);
  else {
    s.hunger[i] = Math.min(1, s.hunger[i]! + (walking ? (s.act[i] === 7 ? NEEDS.hungerHike : NEEDS.hungerWalk) : NEEDS.hungerIdle));
    s.fatigue[i] = Math.min(1, s.fatigue[i]! + (walking ? NEEDS.fatigueWalk : NEEDS.fatigueIdle) * (tn?.fatigue ?? 1));
  }
  if (env.comfort && st !== GState.Sleeping) s.urge[i] = Math.min(1, s.urge[i]! + (walking ? NEEDS.urgeWalk : NEEDS.urgeIdle) * (tn?.urge ?? 1));
  const target = happinessTarget(s.hunger[i]!, s.fatigue[i]!, env, s.urge[i]!);
  s.happiness[i] = s.happiness[i]! + (target - s.happiness[i]!) * NEEDS.happinessRate;
  if (s.state[i] === GState.Leaving) return 0;
  if (s.budget[i]! < NEEDS.brokeBelow) return Leave.Broke;
  if (s.fatigue[i]! > NEEDS.tiredAbove) return Leave.Tired;
  if (s.happiness[i]! < NEEDS.unhappyBelow) { s.lowTicks[i] = Math.min(65535, s.lowTicks[i]! + 1); } else s.lowTicks[i] = 0;
  if (s.lowTicks[i]! >= NEEDS.unhappyTicks) return Leave.Bored;
  return 0;
}

const ACT_NAMES = ['idle', 'heading to a building', 'heading to a lift', 'queueing', 'riding', 'skiing down', 'on a trail'] as const;

/** Short human-readable thoughts for the inspector stub. */
export function thoughts(s: GuestStore, i: number): string[] {
  const out: string[] = [];
  if (s.hunger[i]! > 0.75) out.push('I am starving!');
  else if (s.hunger[i]! > NEEDS.hungryAbove) out.push('I could eat something.');
  if (s.urge[i]! > 0.8) out.push('I really need a toilet!');
  else if (s.urge[i]! > NEEDS.urgeSeek) out.push('I could do with a toilet.');
  if (s.fatigue[i]! > 0.8) out.push('I am exhausted.');
  else if (s.fatigue[i]! > 0.55) out.push('My legs are tired.');
  if (s.budget[i]! < 30) out.push('My wallet is nearly empty.');
  if (s.happiness[i]! > 0.75) out.push('What a great day!');
  else if (s.happiness[i]! < 0.3) out.push('This resort is disappointing.');
  if (!out.length) out.push('Just enjoying the mountain.');
  return out;
}

export function describeGuest(s: GuestStore, i: number): string {
  const f = (v: number): string => `${Math.round(v * 100)}%`;
  return [
    `Guest #${s.id[i]} · ${typeKey(s.type[i]!)} · ${SKILL_NAMES[s.skill[i]!]} · ${GSTATE_NAMES[s.state[i]!]}`,
    `Happiness ${f(s.happiness[i]!)} · Hunger ${f(s.hunger[i]!)} · Fatigue ${f(s.fatigue[i]!)} · Budget ${Math.round(s.budget[i]!)}`,
    `Runs ${s.runs[i]} · ${ACT_NAMES[s.act[i]!] ?? 'idle'}${s.state[i] === GState.Queueing ? ' (in lift queue)' : ''}`,
    ...thoughts(s, i),
  ].join('\n');
}

/** Context-dependent complaints (queue / icy piste / missing kids venue) fed in by the caller (Task 27 inspector). */
export interface ThoughtCtx { queueTicks?: number; onIcyPiste?: boolean; noKidsVenue?: boolean; crowded?: boolean; sawBear?: boolean }
export function contextThoughts(c: ThoughtCtx): string[] {
  const out: string[] = [];
  if ((c.queueTicks ?? 0) > 25) out.push('Lift queue is too long');
  if (c.onIcyPiste) out.push('The piste is icy');
  if (c.noKidsVenue) out.push('No ski school for my kids');
  if (c.crowded) out.push('It is way too crowded here');
  if (c.sawBear) out.unshift('Saw a bear!');
  return out;
}
