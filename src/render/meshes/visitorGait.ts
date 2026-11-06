import { VISITOR } from '../../config/visitor';

/**
 * Rare visitor gait: PURE maths (no three.js). A walk cycle has two steps (left, right); `phase` counts cycles (0..1 loops). The legs swing in
 * opposition, the arms swing against the legs on the same side, the body bobs twice per cycle (highest as the legs pass, lowest at the footfall),
 * sways once and the head counter-turns a touch. Stride length is tied to the leg: one step covers `2 * legLen * sin(swing)`, so the feet do not
 * skate (docs: none; owner-facing wording stays neutral).
 */
export const GAIT = {
  /** Distance covered per step (tiles); two steps per cycle. At the visitor's plodding pace (~0.4 tiles/s at 1x) that is about one step a second. */
  stepLen: VISITOR.stepLen as number,
  /** Arms swing this fraction of the same-side leg's angle, in the opposite direction. */
  armRatio: 0.75,
  /** Peak foot lift (fraction of leg length) while a leg swings forward. */
  liftFrac: 0.22,
  /** Body sway (rad, roll) and head counter-turn (rad). */
  /** Cap on the leg swing (rad): very short legs slide a little rather than splay. */
  maxSwing: 0.75,
  sway: 0.035, headCounter: 0.06,
} as const;

export interface GaitSpec { legLen: number; stepLen?: number }
export interface GaitPose {
  /** Leg swing about the hip (rad, + = forward). `L` is the +x side. */
  legL: number; legR: number;
  /** Foot lift above the ground (tiles) while swinging. */
  liftL: number; liftR: number;
  /** Arm swing about the shoulder (rad, + = forward). */
  armL: number; armR: number;
  /** Vertical body offset (tiles, <= 0: the hips drop as the legs spread). */
  bob: number;
  /** Roll (rad) and head yaw (rad). */
  sway: number; headYaw: number;
}
/** Peak leg angle for a spec: the step length is the foot-to-foot spread, 2 L sin(a). */
export const swingOf = (g: GaitSpec): number => Math.min(GAIT.maxSwing, Math.asin(Math.min(0.95, (g.stepLen ?? GAIT.stepLen) / (2 * g.legLen))));

/** The pose at `phase` (cycles). Periodic with period 1. */
export function walkPose(phase: number, g: GaitSpec): GaitPose {
  const A = swingOf(g), a = phase * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
  const legL = A * s, legR = -A * s;
  const bob = g.legLen * (Math.cos(A * Math.abs(s)) - 1);
  return {
    legL, legR,
    liftL: Math.max(0, c) * GAIT.liftFrac * g.legLen, liftR: Math.max(0, -c) * GAIT.liftFrac * g.legLen,
    armL: -GAIT.armRatio * legL, armR: -GAIT.armRatio * legR,
    bob, sway: GAIT.sway * s, headYaw: -GAIT.headCounter * s,
  };
}
/** Standing still: legs together, arms hanging. */
export const idlePose = (): GaitPose => ({ legL: 0, legR: 0, liftL: 0, liftR: 0, armL: 0.04, armR: 0.04, bob: 0, sway: 0, headYaw: 0 });

/** Walk phase (cycles) after `dist` tiles. */
export const phaseAt = (dist: number, stepLen: number = GAIT.stepLen): number => dist / (2 * stepLen);
/** Which walk-pose frame (of `n`) a phase belongs to. */
export const frameOf = (phase: number, n: number): number => ((Math.round((phase - Math.floor(phase)) * n) % n) + n) % n;

/** The wave ('peek') arm: progress 0..1 -> raise (0..1) and wiggle (rad). It rises, waves four times and lowers. */
export function wavePose(progress: number): { raise: number; wiggle: number } {
  const p = Math.min(1, Math.max(0, progress)), raise = Math.min(1, p / 0.2, (1 - p) / 0.2);
  return { raise: Math.max(0, raise), wiggle: p > 0.2 && p < 0.8 ? Math.sin(((p - 0.2) / 0.6) * Math.PI * 8) * 0.35 : 0 };
}
