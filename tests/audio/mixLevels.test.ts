import { describe, expect, it } from 'vitest';
import { AMB } from '../../src/audio/Ambience';
import { DEFAULT_AUDIO_SETTINGS } from '../../src/audio/AudioSettings';
import { AMBIENCE_ONLY_MIN_EFFECTIVE, MIX_TARGETS, ambienceBedLevel, ambienceOnlyEffective, db, nominalLevel } from '../../src/audio/mixLevels';

describe('mix levels at default settings', () => {
  const sfx = nominalLevel('sfx'), music = nominalLevel('music');
  it('wind bed peak <= -12 dB vs sfx and <= -9 dB vs music', () => {
    const w = nominalLevel('ambience', 'wind');
    expect(db(w / sfx)).toBeLessThanOrEqual(MIX_TARGETS.windVsSfxDb);
    expect(db(w / music)).toBeLessThanOrEqual(MIX_TARGETS.windVsMusicDb);
  });
  it('total bed (wind+snow+crowd) <= -6 dB vs sfx', () => {
    expect(db(ambienceBedLevel() / sfx)).toBeLessThanOrEqual(MIX_TARGETS.ambienceBedVsSfxDb);
  });
  it('the old mix (wind .5, ambience .7) violated the wind target', () => {
    const old = { ...DEFAULT_AUDIO_SETTINGS, ambience: 0.7 };
    expect(db(nominalLevel('ambience', 'wind', old, { ...AMB.layerMax, wind: 0.5 }) * (0.95 / 0.75) / sfx)).toBeGreaterThan(-12);
  });
  it('ambience-only stays audible (also with reduce-loud)', () => {
    expect(ambienceOnlyEffective(false)).toBeGreaterThanOrEqual(AMBIENCE_ONLY_MIN_EFFECTIVE);
    expect(ambienceOnlyEffective(true)).toBeGreaterThanOrEqual(AMBIENCE_ONLY_MIN_EFFECTIVE);
  });
  it('layer ceilings', () => {
    expect(AMB.layerMax.wind).toBe(0.2); expect(AMB.layerMax.muffled).toBe(0.175); expect(AMB.layerMax.rain).toBeCloseTo(0.245);
  });
});
