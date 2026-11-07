import type { AmbienceMix, AmbienceState, LayerId } from './Ambience';
import { BED_SLOTS, GATE_IDS, SYNTH_KEEP, SYNTH_SHRINK_WITH_SHOTS, type BedSlot, type GateId, type SampleDef, type ShotRole } from '../config/audioSamples';

/** Pure helpers of the sample player (no Web Audio): bed gates, slot targets, synth coverage and the random pick. Tested in tests/audio/samples.test.ts. */

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** How loud each gate wants to be (0..1). `crossing` is the level-crossing bell level (0 when no bell rings). Storm = the weather is a storm (light and storm wind / rain beds crossfade on it). */
export function gateLevels(mix: AmbienceMix, s: Pick<AmbienceState, 'weather'> & { cannon?: number }, crossing = 0, extra: Partial<Record<GateId, number>> = {}): Record<GateId, number> {
  const storm = s.weather === 'storm' ? 1 : 0;
  const kinds = Math.max(clamp01(extra.gondola ?? 0), clamp01(extra.cableCar ?? 0), clamp01(extra.funicular ?? 0));
  const liftShare = 1 - SAMPLE_MIX.kindStepBack * kinds; // near a gondola / cable car / funicular the chairlift recordings step back
  // Snow cannon: the nearer recordings take over as the camera comes close (smoothstep over the cannon level), the older one is the far bed.
  const nearT = clamp01((mix.cannon - SAMPLE_MIX.cannonNearFrom) / SAMPLE_MIX.cannonNearSpan), near = nearT * nearT * (3 - 2 * nearT);
  return {
    windLight: mix.wind * (1 - storm), windStorm: mix.wind * storm, windGust: mix.wind * (1 - storm) * 0.7,
    rainLight: mix.rain * (1 - storm), rainStorm: mix.rain * storm,
    crickets: mix.crickets, crowd: mix.crowd, lift: mix.lift * liftShare, liftHum: mix.lift * 0.8 * liftShare, stream: mix.stream, rapids: mix.rapids, snowcat: mix.snowcat, heli: mix.heli, campfire: mix.campfire,
    birds: mix.birds, morning: mix.birds * 0.7, cowbells: mix.cowbells, drips: mix.drips, cannon: mix.cannon * (1 - near), cannonNear: mix.cannon * near, crossing: clamp01(crossing),
    gondola: clamp01(extra.gondola ?? 0), cableCar: clamp01(extra.cableCar ?? 0), funicular: clamp01(extra.funicular ?? 0), crowdQueue: clamp01(extra.crowdQueue ?? 0), barCrowd: clamp01(extra.barCrowd ?? mix.apres),
  };
}
/** Tunables of the batch-2 gates (pure mix only; levels / ceilings are in audioSamples.ts BED_SLOTS). */
export const SAMPLE_MIX = { kindStepBack: 0.5, cannonNearFrom: 0.35, cannonNearSpan: 0.35 } as const;
export const GATES_COMPLETE = GATE_IDS.length;

/**
 * Per-slot target gain (gate x weight x ceiling x file trim) and, per synth layer, the coverage 0..1 = share of the wanted slot weight whose buffer is ready.
 * `ceil` of a layered slot is that layer's ceiling (AMB.layerMax); `trimOf` / `ready` come from the player.
 */
export function slotTargets(gates: Record<GateId, number>, layerMax: Record<LayerId, number>, trimOf: (sample: string) => number, ready: (sample: string) => boolean, slots: readonly BedSlot[] = BED_SLOTS, skip?: (slotId: string) => boolean): { gains: Record<string, number>; coverage: Partial<Record<LayerId, number>> } {
  const gains: Record<string, number> = {}, want: Partial<Record<LayerId, number>> = {}, have: Partial<Record<LayerId, number>> = {};
  for (const sl of slots) {
    const g = skip?.(sl.id) ? 0 : clamp01(gates[sl.gate]) * sl.weight;
    gains[sl.id] = g * (sl.layer ? layerMax[sl.layer] : (sl.ceil ?? 0)) * trimOf(sl.sample);
    if (sl.layer && !skip?.(sl.id)) { want[sl.layer] = (want[sl.layer] ?? 0) + g; if (ready(sl.sample)) have[sl.layer] = (have[sl.layer] ?? 0) + g; }
  }
  const coverage: Partial<Record<LayerId, number>> = {};
  for (const k of Object.keys(want) as LayerId[]) coverage[k] = want[k]! > 1e-4 ? clamp01((have[k] ?? 0) / want[k]!) : 1;
  return { gains, coverage };
}

/** Multiplier for the synth layer `id` given the sample coverage (1 = synth alone, `keep` = the part the recording never replaces). Layers without samples / with one-shot extras use `shotReady`. */
export function synthScale(id: LayerId, coverage: Partial<Record<LayerId, number>>, shotReady: (role: ShotRole) => boolean): number {
  const shrink = SYNTH_SHRINK_WITH_SHOTS[id];
  if (shrink) return shotReady(shrink.role) ? shrink.keep : 1;
  const cov = coverage[id];
  if (cov === undefined) return 1;
  const keep = SYNTH_KEEP[id] ?? 0;
  return keep + (1 - keep) * (1 - cov);
}

/** Random index in [0, n) that differs from `last` whenever n > 1 (no immediate repeat). */
export function pickIndex(n: number, last: number, rnd: () => number): number {
  if (n <= 1) return 0;
  if (last < 0 || last >= n) return Math.min(n - 1, Math.floor(rnd() * n));
  const i = Math.min(n - 2, Math.floor(rnd() * (n - 1)));
  return i >= last ? i + 1 : i;
}

/** Playback parameters of one play: rate = caller pitch x (1 +- pitchJitter), gain = caller gain x trim x (1 +- gainJitter); clamped to sane ranges. */
export function shotParams(def: Pick<SampleDef, 'trim' | 'gainJitter' | 'pitchJitter'>, pitch: number, gain: number, rnd: () => number): { rate: number; gain: number } {
  const j = (a: number): number => 1 + (rnd() * 2 - 1) * a;
  return { rate: Math.min(2, Math.max(0.5, pitch * j(def.pitchJitter))), gain: Math.max(0, gain * def.trim * j(def.gainJitter)) };
}
