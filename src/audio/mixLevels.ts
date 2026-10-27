import { AMB, type LayerId } from './Ambience';
import { DEFAULT_AUDIO_SETTINGS, busGains, type AudioSettingsData } from './AudioSettings';

/**
 * Pure loudness model (no audio device was available: these are reasoned estimates, see docs/audio.md "Mix levels").
 * Level = bus volume x layer ceiling (AMB.layerMax) x recipe gain x noise RMS x spectral share. Master cancels in ratios.
 */
export type MixBus = 'music' | 'sfx' | 'ambience';

/** RMS of the normalised (±0.9 peak) noise buffers (crest factor ~3.6). */
export const NOISE_RMS = 0.25;
/** Fraction of that RMS surviving each layer's filter chain (estimates). */
export const SPECTRAL_SHARE: Partial<Record<LayerId, number>> = { wind: 0.5, crowd: 0.5, muffled: 0.3 };
/** Peak recipe gain (base + LFO depth) of each layer's last gain stage before `out`. Wind: gust 0.55 + LFOs 0.31. Crowd: sum 0.6 + LFOs 0.32. Muffled: none. */
export const RECIPE_GAIN: Partial<Record<LayerId, number>> = { wind: 0.86, crowd: 0.92, muffled: 1 };
/** Reference one-shot: typical sfx recipe peak (click .18, tick .1, scrape .16, kaching arp .12) x RMS factor .7. */
export const SFX_REF_PEAK = 0.18 * 0.7;
/** Music nominal level at the music bus input (sum of voices, estimate). */
export const MUSIC_NOMINAL = 0.12;
/** Ambience-only mode must keep ambience bus x master at least this (linear), also with reduce-loud. */
export const AMBIENCE_ONLY_MIN_EFFECTIVE = 0.15;

/** Target ratios (dB, upper bounds): the contract tested in tests/audio/mixLevels.test.ts. */
export const MIX_TARGETS = {
  windVsSfxDb: -12,
  windVsMusicDb: -9,
  ambienceBedVsSfxDb: -6,
} as const;

export const db = (ratio: number): number => 20 * Math.log10(ratio);

/** Nominal linear level at the master input for a bus (reference signal) or an ambience layer at peak (mix = 1). */
export function nominalLevel(bus: MixBus, layer?: LayerId, s: Readonly<AudioSettingsData> = DEFAULT_AUDIO_SETTINGS, layerMax: Record<LayerId, number> = AMB.layerMax): number {
  const v = s[bus];
  if (bus === 'sfx') return v * SFX_REF_PEAK;
  if (bus === 'music') return v * MUSIC_NOMINAL;
  if (!layer) return 0;
  return v * layerMax[layer] * (RECIPE_GAIN[layer] ?? 1) * NOISE_RMS * (SPECTRAL_SHARE[layer] ?? 1);
}

/** Total ambience bed at peak: wind + snow(muffled) + crowd, summed coherently (worst case). */
export function ambienceBedLevel(s: Readonly<AudioSettingsData> = DEFAULT_AUDIO_SETTINGS, layerMax: Record<LayerId, number> = AMB.layerMax): number {
  return (['wind', 'muffled', 'crowd'] as const).reduce((a, l) => a + nominalLevel('ambience', l, s, layerMax), 0);
}

/** Effective ambience gain in ambience-only mode (bus x master). */
export function ambienceOnlyEffective(reduceLoud = false): number {
  const g = busGains({ ...DEFAULT_AUDIO_SETTINGS, ambienceOnly: true, reduceLoud });
  return g.ambience * g.master;
}
