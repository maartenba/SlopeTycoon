import { describe, expect, it } from 'vitest';
import { ATMOS, ATMOS_LEVELS, LEVEL_FEATURES } from '../../src/config/atmosphere';
import type { SeasonId, WeatherKind } from '../../src/core/events';
import { fogAt, fogDay, fogHourFactor, type DayContext } from '../../src/render/atmosphere/FogState';
import { alpenglowWeight, glowWeight, gradeLighting, specialSky } from '../../src/render/atmosphere/SunFx';
import { cloudShadowAmount, moonIllumination, moonPhase, moonPhaseName, starAlpha } from '../../src/render/atmosphere/Sky';
import { frostAmount, mistAmount, rainbowAmount } from '../../src/render/atmosphere/Flavour';
import { dayHash } from '../../src/render/atmosphere/hash';
import { AtmosphereController } from '../../src/render/atmosphere/AtmosphereState';
import { AtmosphereSettings, defaultAtmosLevel } from '../../src/render/atmosphere/AtmosphereSettings';
import { fogUniforms } from '../../src/render/Fog';
import { atmosTerrainUniforms } from '../../src/render/atmosphere/uniforms';
import { lightingAt } from '../../src/render/Lighting';
import { pickMistTiles } from '../../src/render/atmosphere/Mist';
import { createSim } from '../../src/game/createSim';
import { stateHash } from '../../src/game/saveState';
import { MemStorage } from '../audio/fakeBackend';

const SEASONS: SeasonId[] = ['winter', 'spring', 'summer', 'autumn'];
const ctx = (over: Partial<DayContext> = {}): DayContext => ({ seed: 5, dayKey: 100, season: 'winter', weather: 'clear', prevWet: false, valleyT: -2, ...over });
const share = (n: number, f: (d: number) => boolean): number => { let c = 0; for (let d = 0; d < n; d++) if (f(d)) c++; return c / n; };

describe('config', () => {
  it('ranges are sane', () => {
    for (const s of SEASONS) for (const p of [ATMOS.special.dawn[s], ATMOS.special.dusk[s], ATMOS.fog.chance[s]]) { expect(p).toBeGreaterThan(0); expect(p).toBeLessThan(0.6); }
    expect(ATMOS.special.minQuality).toBeGreaterThan(0.4); expect(ATMOS.special.minQuality).toBeLessThan(1);
    expect(ATMOS.special.gradeStrength).toBeLessThanOrEqual(0.5); // subtle on purpose
    expect(ATMOS.alpenglow.windowH).toBeCloseTo(40 / 60, 6);
    expect(ATMOS.fog.burnEnd).toBeLessThanOrEqual(11.5); expect(ATMOS.fog.maxOpacity).toBeLessThan(1);
    expect(ATMOS.rainbow.chance).toBeLessThan(0.5); expect(ATMOS.mist.maxPuffs).toBeLessThanOrEqual(64);
    expect(ATMOS.moon.synodic).toBeCloseTo(29.53, 2);
  });
  it('Off switches everything off; High has everything', () => {
    expect(ATMOS_LEVELS).toEqual(['off', 'low', 'high']);
    expect(Object.values(LEVEL_FEATURES.off).every((v) => v === 0 || v === false)).toBe(true);
    expect(Object.values(LEVEL_FEATURES.high).every((v) => v === 1 || v === true)).toBe(true);
    expect(LEVEL_FEATURES.low.frost || LEVEL_FEATURES.low.mist || LEVEL_FEATURES.low.rainbow).toBe(false);
  });
});

describe('special sky days', () => {
  it('about 1 in 4 to 1 in 3 days get a beautiful dawn / dusk; the rest stay plain', () => {
    let dawn = 0, dusk = 0, n = 0;
    for (const seed of [1, 5, 61, 777]) for (let d = 0; d < 1800; d++) {
      const s = SEASONS[Math.floor((d % 180) / 45)]!;
      const w: WeatherKind = ([ 'clear', 'clear', 'cloudy', 'rain', 'snow'] as const)[d % 5]!;
      const r = specialSky({ seed, dayKey: d, season: s, weather: w, prevWet: d % 3 === 0 });
      n++; if (r.dawn > 0) dawn++; if (r.dusk > 0) dusk++;
      for (const q of [r.dawn, r.dusk]) if (q > 0) { expect(q).toBeGreaterThanOrEqual(ATMOS.special.minQuality); expect(q).toBeLessThanOrEqual(1); }
    }
    expect(dawn / n).toBeGreaterThan(0.15); expect(dawn / n).toBeLessThan(0.34);
    expect(dusk / n).toBeGreaterThan(0.15); expect(dusk / n).toBeLessThan(0.34);
  });
  it('clear / cloudy days with fixed rules: clear-after-rain and cloudy are likelier; wet and storm days are never special', () => {
    const rate = (c: Partial<DayContext>): number => share(6000, (d) => specialSky(ctx({ dayKey: d, season: 'autumn', ...c })).dusk > 0);
    expect(rate({ weather: 'clear', prevWet: true })).toBeGreaterThan(rate({ weather: 'clear', prevWet: false }));
    expect(rate({ weather: 'cloudy' })).toBeGreaterThan(rate({ weather: 'clear' }));
    for (const w of ['rain', 'storm', 'heavySnow'] as const) expect(rate({ weather: w })).toBe(0);
  });
  it('deterministic per (seed, day)', () => {
    for (let d = 0; d < 50; d++) expect(specialSky(ctx({ dayKey: d }))).toEqual(specialSky(ctx({ dayKey: d })));
    expect(dayHash(5, 10, 3)).toBe(dayHash(5, 10, 3));
    expect(dayHash(5, 10, 3)).not.toBe(dayHash(6, 10, 3));
    for (let i = 0; i < 200; i++) { const h = dayHash(i, i * 7, 1); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(1); }
  });
});

describe('alpenglow + grading', () => {
  const sky = { dawn: 1, dusk: 0 };
  it('weights are 1 near sunrise, fade out by +-40 min, and 0 for plain days', () => {
    expect(alpenglowWeight(8, 8, 17, sky)).toBeCloseTo(1, 6);
    expect(alpenglowWeight(8 + 20 / 60, 8, 17, sky)).toBeCloseTo(1, 6);
    expect(alpenglowWeight(8 + 40 / 60, 8, 17, sky)).toBeCloseTo(0, 6);
    expect(alpenglowWeight(8 - 41 / 60, 8, 17, sky)).toBe(0);
    expect(alpenglowWeight(12, 8, 17, sky)).toBe(0);
    expect(alpenglowWeight(17, 8, 17, sky)).toBe(0); // dusk is plain in this sky
    expect(glowWeight(17, 8, 17, { dawn: 0, dusk: 0.8 })).toBeCloseTo(0.8, 6);
    expect(glowWeight(8, 8, 17, { dawn: 0, dusk: 0 })).toBe(0);
  });
  it('weight is monotone away from the horizon crossing', () => {
    let prev = 2; for (let m = 0; m <= 50; m += 2) { const w = alpenglowWeight(8 + m / 60, 8, 17, sky); expect(w).toBeLessThanOrEqual(prev + 1e-9); prev = w; }
  });
  it('gradeLighting is the identity at weight 0 and continuous in the weight; the pure Lighting model is untouched', () => {
    const p = lightingAt(8);
    expect(gradeLighting(p, 0)).toBe(p);
    const g1 = gradeLighting(p, 0.5), g2 = gradeLighting(p, 0.51);
    for (let i = 0; i < 3; i++) expect(Math.abs(g1.background[i]! - g2.background[i]!)).toBeLessThan(0.01);
    expect(gradeLighting(p, 1).background[0]).toBeGreaterThanOrEqual(p.background[0] - 0.4); // moves toward the warm glow, never wildly
    expect(Math.abs(gradeLighting(p, 1).background[1] - p.background[1])).toBeLessThan(0.3);
  });
});

describe('valley fog', () => {
  it('fog days are a minority, and never on wet days', () => {
    for (const s of SEASONS) { const r = share(4000, (d) => fogDay(ctx({ dayKey: d, season: s })).strength > 0); expect(r).toBeGreaterThan(0.03); expect(r).toBeLessThan(0.6); } // cold + clear is the favourite fog day; over a whole year (all weather) fog mornings are ~15 % (npx vite-node scripts/analysis/weatherKinds.ts)
    expect(share(2000, (d) => fogDay(ctx({ dayKey: d, weather: 'rain' })).strength > 0)).toBe(0);
    expect(share(2000, (d) => fogDay(ctx({ dayKey: d, weather: 'storm' })).strength > 0)).toBe(0);
    expect(share(4000, (d) => fogDay(ctx({ dayKey: d, season: 'autumn' })).strength > 0)).toBeGreaterThan(share(4000, (d) => fogDay(ctx({ dayKey: d, season: 'summer' })).strength > 0));
  });
  it('density curve: builds before sunrise, holds, is gone by 11:00', () => {
    const sr = 7.5;
    expect(fogHourFactor(3, sr)).toBe(0);
    expect(fogHourFactor(sr, sr)).toBeGreaterThan(0.9);
    expect(fogHourFactor(8, sr)).toBeCloseTo(1, 1);
    expect(fogHourFactor(11, sr)).toBeCloseTo(0, 6);
    expect(fogHourFactor(14, sr)).toBe(0);
    let prev = 1; for (let h = 8.5; h <= 11; h += 0.25) { const f = fogHourFactor(h, sr); expect(f).toBeLessThanOrEqual(prev + 1e-9); prev = f; }
  });
  it('the bank sinks while it burns off; level 0 means no fog', () => {
    let day = 0; while (fogDay(ctx({ dayKey: day })).strength === 0) day++;
    const c = ctx({ dayKey: day });
    const early = fogAt(c, 7.6, 7.5), late = fogAt(c, 10.5, 7.5);
    expect(early.amount).toBeGreaterThan(late.amount); expect(early.lineFrac).toBeGreaterThan(late.lineFrac);
    expect(fogAt(c, 7.6, 7.5, 0).amount).toBe(0);
    expect(fogAt(c, 15, 7.5).amount).toBe(0);
  });
  it('inversion days exist on clear days only, with a higher line', () => {
    let seen = 0;
    for (let d = 0; d < 3000; d++) { const f = fogDay(ctx({ dayKey: d, season: 'autumn' })); if (f.inversion) { seen++; expect(fogAt(ctx({ dayKey: d, season: 'autumn' }), 7.6, 7.5).lineFrac).toBeGreaterThan(ATMOS.fog.lineFrac * 0.9); } }
    expect(seen).toBeGreaterThan(20);
    for (let d = 0; d < 800; d++) expect(fogDay(ctx({ dayKey: d, weather: 'cloudy', season: 'autumn' })).inversion).toBe(false);
  });
});

describe('moon, stars, clouds', () => {
  it('moon phase cycles every 29.53 days; new moon at the epoch, full about 14.8 days later', () => {
    expect(moonPhase(ATMOS.moon.newMoonDay)).toBeCloseTo(0, 6);
    expect(moonPhase(ATMOS.moon.newMoonDay + 29.53 / 2)).toBeCloseTo(0.5, 3);
    expect(moonPhase(ATMOS.moon.newMoonDay + 29.53)).toBeCloseTo(0, 3);
    expect(moonPhase(0)).toBeGreaterThanOrEqual(0); expect(moonPhase(0)).toBeLessThan(1);
    expect(moonIllumination(0)).toBeCloseTo(0, 6); expect(moonIllumination(0.5)).toBeCloseTo(1, 6); expect(moonIllumination(0.25)).toBeCloseTo(0.5, 6);
    expect(moonPhaseName(0)).toBe('New moon'); expect(moonPhaseName(0.5)).toBe('Full moon');
  });
  it('stars fade in with the night and are hidden by cloud', () => {
    expect(starAlpha(0, 'clear')).toBe(0); expect(starAlpha(1, 'clear')).toBe(1);
    expect(starAlpha(1, 'rain')).toBe(0); expect(starAlpha(1, 'cloudy')).toBeLessThan(0.5);
    expect(starAlpha(0.7, 'clear')).toBeGreaterThan(0); expect(starAlpha(0.7, 'clear')).toBeLessThan(1);
  });
  it('cloud shadows: stronger when cloudy, none at night', () => {
    expect(cloudShadowAmount(5, 1, 'cloudy', 0)).toBeGreaterThan(cloudShadowAmount(5, 1, 'clear', 0) * 0.99);
    expect(cloudShadowAmount(5, 1, 'cloudy', 1)).toBe(0);
    for (let d = 0; d < 100; d++) { const a = cloudShadowAmount(5, d, 'clear', 0); expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThan(0.3); }
  });
});

describe('flavour (frost, mist, rainbow)', () => {
  it('frost needs a cold clear morning; none at noon, none when mild or cloudy', () => {
    let d = 0; while (frostAmount(ctx({ dayKey: d, valleyT: -8 }), 8.5, 8) === 0 && d < 100) d++;
    const c = ctx({ dayKey: d, valleyT: -8 });
    expect(frostAmount(c, 8.5, 8)).toBeGreaterThan(0.5);
    expect(frostAmount(c, 13, 8)).toBe(0);
    expect(frostAmount({ ...c, valleyT: 10 }, 8.5, 8)).toBe(0);
    expect(frostAmount({ ...c, weather: 'cloudy' }, 8.5, 8)).toBe(0);
  });
  it('mist is a dawn thing and needs no rain', () => {
    let d = 0; while (mistAmount(ctx({ dayKey: d, valleyT: 2, season: 'autumn' }), 7.5, 7.5, 0) === 0 && d < 200) d++;
    const c = ctx({ dayKey: d, valleyT: 2, season: 'autumn' });
    expect(mistAmount(c, 7.5, 7.5, 0)).toBeGreaterThan(0); expect(mistAmount(c, 14, 7.5, 0)).toBe(0); expect(mistAmount({ ...c, weather: 'rain' }, 7.5, 7.5, 0)).toBe(0);
    expect(mistAmount(c, 7.5, 7.5, 1)).toBeLessThan(mistAmount(c, 7.5, 7.5, 0));
  });
  it('rainbow is rare: only after a wet day, clear weather, a few % of days', () => {
    expect(share(2000, (d) => rainbowAmount(ctx({ dayKey: d, prevWet: false }), 9, 7.5, 17) > 0)).toBe(0);
    let hit = 0; for (let d = 0; d < 2000; d++) { const c = ctx({ dayKey: d, prevWet: true }); let m = 0; for (let h = 6; h < 19; h += 0.25) m = Math.max(m, rainbowAmount(c, h, 7.5, 17)); if (m > 0) hit++; }
    expect(hit / 2000).toBeGreaterThan(0.1); expect(hit / 2000).toBeLessThan(0.4); // of the AFTER-RAIN days; those are ~1/4 of all days
  });
  it('mist tiles are water tiles only, capped, deterministic', () => {
    const size = 32, t = new Uint8Array(size * size).fill(0);
    for (let z = 10; z < 20; z++) for (let x = 10; x < 20; x++) t[z * size + x] = 2;
    const a = pickMistTiles(t, size, 15, 15, 30, 12, 5), b = pickMistTiles(t, size, 15, 15, 30, 12, 5);
    expect(a).toEqual(b); expect(a.length).toBeLessThanOrEqual(12); expect(a.length).toBeGreaterThan(0);
    for (const p of a) expect(t[p.z * size + p.x]).toBe(2);
    expect(pickMistTiles(new Uint8Array(size * size), size, 15, 15, 30, 12, 5)).toEqual([]);
  });
});

describe('settings', () => {
  it('round-trips through storage; default is High on desktop, Low on touch / Low quality', () => {
    expect(defaultAtmosLevel(false, 'high')).toBe('high'); expect(defaultAtmosLevel(false, 'med')).toBe('high');
    expect(defaultAtmosLevel(true, 'high')).toBe('low'); expect(defaultAtmosLevel(false, 'low')).toBe('low');
    const st = new MemStorage(); const a = new AtmosphereSettings(st, () => 'high');
    expect(a.level).toBe('high'); let seen = ''; a.subscribe((l) => { seen = l; });
    a.set('off'); expect(seen).toBe('off'); expect(a.features.fog).toBe(0);
    expect(new AtmosphereSettings(st, () => 'high').level).toBe('off');
    st.m.set('slope.atmosphere', 'bogus'); expect(new AtmosphereSettings(st, () => 'low').level).toBe('low');
  });
});

describe('controller: Off = neutral, reduced motion = static, sim untouched', () => {
  const input = (hour: number, over = {}) => ({ seed: 5, dayKey: 3, season: 'autumn' as SeasonId, weather: 'clear' as WeatherKind, wind: 0.2, valleyT: -3, hour, sunrise: 7.5, sunset: 17, night: hour > 17 || hour < 7 ? 1 : 0, prevWet: true, ...over });
  const mk = (level: 'off' | 'low' | 'high', reduced = false) => new AtmosphereController({ features: () => LEVEL_FEATURES[level], level: () => level, reducedMotion: () => reduced, skyParent: null, maxWorld: () => 40, grid: null });
  const stepN = (c: AtmosphereController, hour: number, force = false) => { if (force) c.force({ fog: 1, frost: 1, special: 1, cloudShadow: 0.2 }); for (let i = 0; i < 5; i++) c.update(0.1, input(hour), { x: 0, z: 0 }, 40, lightingAt(hour), 0.7); };
  it('Off writes the neutral uniforms even when states are forced (the old look)', () => {
    const c = mk('off'); stepN(c, 8, true);
    expect(fogUniforms.uValleyFog.value.x).toBe(0);
    expect(atmosTerrainUniforms.uAtmA.value.x).toBe(0); expect(atmosTerrainUniforms.uAtmA.value.z).toBe(0); expect(atmosTerrainUniforms.uAtmA.value.w).toBe(0);
    expect(c.grade(lightingAt(8), 8)).toEqual(lightingAt(8));
    expect(c.last!.fog).toBe(0);
  });
  it('High shows forced fog / frost; reduced motion freezes the clock and the twinkle', () => {
    const c = mk('high'); stepN(c, 8, true);
    expect(fogUniforms.uValleyFog.value.x).toBeGreaterThan(0.3); expect(atmosTerrainUniforms.uAtmA.value.z).toBeGreaterThan(0.5);
    const t0 = fogUniforms.uValleyFogT.value; stepN(c, 8);
    expect(fogUniforms.uValleyFogT.value).toBeGreaterThan(t0); expect(atmosTerrainUniforms.uAtmB.value.w).toBe(1);
    const r = mk('high', true); stepN(r, 8, true);
    const t1 = fogUniforms.uValleyFogT.value; stepN(r, 8);
    expect(fogUniforms.uValleyFogT.value).toBe(t1); expect(fogUniforms.uValleyFogT.value).toBe(0); expect(atmosTerrainUniforms.uAtmB.value.w).toBe(0);
    expect(fogUniforms.uValleyFog.value.x).toBeGreaterThan(0.3); // same picture, just static
  });
  it('photo suggestions only offer what the day delivers', () => {
    const c = mk('high');
    let found = false;
    for (let d = 0; d < 80 && !found; d++) { const s = c.suggestions({ ...input(12), dayKey: d }); if (s.some((x) => x.id === 'foggy') && s.some((x) => x.id === 'golden')) { found = true; for (const g of s) { expect(g.hour).toBeGreaterThanOrEqual(0); expect(g.hour).toBeLessThan(24); } } }
    expect(found).toBe(true);
    expect(c.suggestions({ ...input(12), weather: 'rain', prevWet: false }).some((x) => x.id === 'foggy' || x.id === 'golden')).toBe(false);
    expect(c.suggestions(input(12)).some((x) => x.id === 'starry')).toBe(true);
  });
  it('never touches the simulation: stateHash is identical with the atmosphere on or off', () => {
    const run = (level: 'off' | 'high'): string => {
      const sim = createSim({ size: 64, seed: 9, now: () => 0 });
      const c = mk(level); stepN(c, 8, true); c.suggestions(input(8));
      for (let i = 0; i < 400; i++) sim.loop.advance(0.05);
      stepN(c, 9);
      return JSON.stringify(stateHash(sim));
    };
    expect(run('high')).toBe(run('off'));
  }, 60_000);
  it('atmosphere modules import nothing from the sim Rng / sim state (render-side hash only)', async () => {
    const fs = await import('node:fs'), path = await import('node:path');
    const dir = path.resolve(__dirname, '../../src/render/atmosphere');
    for (const f of fs.readdirSync(dir)) { const src = fs.readFileSync(path.join(dir, f), 'utf8'); expect(src, f).not.toMatch(/core\/Rng|sim\/(?!Weather)/); expect(src, f).not.toMatch(/Math\.random/); }
  });
});
