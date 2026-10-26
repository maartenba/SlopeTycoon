/**
 * Feedback ("juice") policy: pure table of thresholds and caps per intensity. The game is meant to feel calm: Subtle is the default,
 * Lively only doubles caps / halves thresholds, Off disables every optional effect (plain sounds stay under the SFX volume).
 */
export type FeedbackIntensity = 'off' | 'subtle' | 'lively';
export const FEEDBACK_INTENSITIES: readonly FeedbackIntensity[] = ['off', 'subtle', 'lively'];
export const DEFAULT_INTENSITY: FeedbackIntensity = 'subtle';

export interface FeedbackPolicy {
  /** The intensity actually applied (after the reduced-motion clamp). */
  intensity: FeedbackIntensity;
  /** A +$ popup needs at least this many dollars (aggregated)... */
  moneyMin: number;
  /** ...or this share of the rolling daily revenue average, whichever is larger. */
  moneyRel: number;
  maxPopups: number;
  /** Seconds sales of one building are summed before a popup may appear. */
  aggregateS: number;
  /** Seconds a popup lives (rises + fades). */
  popupLifeS: number;
  /** 0..1 size of a build puff. */
  puffScale: number;
  /** Gain of the build thunk (also used for FX-owned sounds). */
  puffGain: number;
  emotePerGuestPerDay: number;
  maxEmotes: number;
  confettiOn: 'major' | 'never';
  cameraKick: boolean;
  /** Minimum seconds between popup-tied ka-chings. */
  kachingGapS: number;
}

const SUBTLE: FeedbackPolicy = {
  intensity: 'subtle', moneyMin: 500, moneyRel: 0.05, maxPopups: 6, aggregateS: 2, popupLifeS: 1, puffScale: 0.6, puffGain: 0.25,
  emotePerGuestPerDay: 1, maxEmotes: 12, confettiOn: 'major', cameraKick: false, kachingGapS: 3,
};
const LIVELY: FeedbackPolicy = {
  ...SUBTLE, intensity: 'lively', moneyMin: SUBTLE.moneyMin / 2, moneyRel: SUBTLE.moneyRel / 2, maxPopups: SUBTLE.maxPopups * 2,
  puffScale: 1, puffGain: 0.4, emotePerGuestPerDay: 2, maxEmotes: SUBTLE.maxEmotes * 2, cameraKick: true,
};
const OFF: FeedbackPolicy = {
  intensity: 'off', moneyMin: Infinity, moneyRel: Infinity, maxPopups: 0, aggregateS: 2, popupLifeS: 1, puffScale: 0, puffGain: 0,
  emotePerGuestPerDay: 0, maxEmotes: 0, confettiOn: 'never', cameraKick: false, kachingGapS: 3,
};

export function isIntensity(v: unknown): v is FeedbackIntensity { return v === 'off' || v === 'subtle' || v === 'lively'; }

/** Reduced motion clamps Lively down to Subtle and never allows confetti or camera kicks. */
export function feedbackPolicy(intensity: FeedbackIntensity, opts: { reducedMotion?: boolean } = {}): FeedbackPolicy {
  const eff: FeedbackIntensity = opts.reducedMotion && intensity === 'lively' ? 'subtle' : intensity;
  const base = eff === 'off' ? OFF : eff === 'lively' ? LIVELY : SUBTLE;
  return opts.reducedMotion ? { ...base, confettiOn: 'never', cameraKick: false } : { ...base };
}

/** Persisted choice (localStorage 'slope.fx.v1'). */
export const FX_STORAGE_KEY = 'slope.fx.v1';
export interface FxStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }
export function loadIntensity(st: FxStorage | null): FeedbackIntensity {
  try { const o = JSON.parse(st?.getItem(FX_STORAGE_KEY) ?? 'null') as { intensity?: unknown } | null; if (o && isIntensity(o.intensity)) return o.intensity; } catch { /* corrupt / blocked */ }
  return DEFAULT_INTENSITY;
}
export function saveIntensity(st: FxStorage | null, v: FeedbackIntensity): void { try { st?.setItem(FX_STORAGE_KEY, JSON.stringify({ intensity: v })); } catch { /* quota / blocked */ } }

/** Is a milestone allowed to show confetti? Only major ones, and only when the policy allows. */
export const confettiAllowed = (p: FeedbackPolicy, major: boolean): boolean => p.confettiOn === 'major' && major;
