import { describe, expect, it } from 'vitest';
import { AMB, ambienceMix, type AmbienceState } from '../../src/audio/Ambience';
import { AudioEngine, PRIORITY } from '../../src/audio/AudioEngine';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { RECIPES, Sfx, SFX_NAMES } from '../../src/audio/Sfx';
import { WorldProbe } from '../../src/audio/worldProbe';
import { Grid } from '../../src/world/Grid';
import { FakeBackend, MemStorage } from './fakeBackend';

const STEPS = ['stepSnow', 'stepGravel', 'stepGrass', 'stepWood', 'stepRoad'] as const;

describe('walk mode footsteps (Sfx recipes)', () => {
  it('one recipe per surface, lowest priority, on the sfx bus, rate limited and scaled by reduce-loud', () => {
    for (const n of STEPS) {
      expect(SFX_NAMES).toContain(n);
      const r = RECIPES[n];
      expect(r.priority, n).toBe(PRIORITY.ambience); // never steals a voice from an action / alert
      expect(r.bus, n).toBe('sfx');
      expect(r.maxPerSec, n).toBeLessThanOrEqual(4); expect(r.minGap, n).toBeGreaterThanOrEqual(0.1);
      expect(r.loud, n).toBe(true);
      expect(r.dur, n).toBeLessThan(0.3);
    }
  });
  it('play, release their voices, and stay under the click level: the running cadence cannot flood the voice pool', async () => {
    const fb = new FakeBackend(), settings = new AudioSettings(new MemStorage()), engine = new AudioEngine({ factory: () => fb, settings }), sfx = new Sfx(engine);
    await engine.onGesture();
    const base = fb.live;
    let started = 0;
    for (let i = 0; i < 300; i++) { fb.t += 0.02; if (sfx.play(STEPS[i % 5]!, { pitch: 0.9 + (i % 5) * 0.05 })) started++; } // 6 s of "stepping" at 50 Hz: the limiter decides
    expect(started).toBeGreaterThan(10); expect(started).toBeLessThan(5 * 4 * 6 + 1);
    expect(engine.voiceCount).toBeLessThan(10);
    fb.t += 5; engine.reap(fb.t);
    expect(fb.live).toBe(base);
    // quiet by construction: the footstep recipes' noise bursts peak <= 0.07 (click 0.18), documented in docs/audio.md
    const src = String(RECIPES.stepSnow.build);
    expect(src).toContain('0.06'); expect(/0\.(1[0-9]|[2-9])\d*\s*\*\s*o\.gain/.test(src)).toBe(false);
  });
  it('reduce-loud halves the footstep gain option', async () => {
    const fb = new FakeBackend(), settings = new AudioSettings(new MemStorage()), engine = new AudioEngine({ factory: () => fb, settings }), sfx = new Sfx(engine);
    await engine.onGesture();
    settings.set({ reduceLoud: true });
    expect(engine.loudScale).toBe(0.5);
    expect(sfx.play('stepGravel')).toBe(true);
  });
});

describe('walk mode near-field ambience', () => {
  const base: AmbienceState = { season: 'summer', weather: 'clear', hour: 10, zoom: 60, altitude: 0.2, wind: 0.2, water: 0.5, crowd: 20, lifts: 0.5, buildings: 0.5, cows: 0, snowcat: 0, heli: 0 };
  it("the walker's zoom proxy is 'close': crowd, lift hum, birds, water and bells sit at their near-field levels (> the far view)", () => {
    expect(AMB.walkZoom).toBeLessThanOrEqual(AMB.closeZoom);
    const far = ambienceMix(base), near = ambienceMix({ ...base, zoom: AMB.walkZoom });
    expect(near.crowd).toBeGreaterThan(far.crowd * 1.5);
    expect(near.lift).toBeGreaterThan(far.lift * 2);
    expect(near.birds).toBeGreaterThan(far.birds * 1.5);
    expect(near.water).toBeGreaterThan(far.water);
    expect(near.bells).toBeGreaterThan(far.bells);
    expect(near.wind).toBeLessThanOrEqual(far.wind); // wind stays a quiet bed (no far-view boost)
  });
  it('winter near-field: the snow bed stays quiet (muffled <= 1, wind unchanged by walking)', () => {
    const w = ambienceMix({ ...base, season: 'winter', zoom: AMB.walkZoom });
    expect(w.muffled).toBeLessThanOrEqual(0.9); expect(w.wind).toBeLessThan(0.6);
  });
  it('the probe samples around the walker: a crowd / lift next to the listener registers, the same listener far away does not (fixture)', () => {
    const grid = new Grid(64);
    const mk = (at: { x: number; z: number }) => new WorldProbe({
      grid, guests: { count: (x, y, r) => (Math.hypot(x - 30, y - 30) <= r + 2 ? 40 : 0) },
      lifts: () => [{ x: 30, y: 30 }], buildings: () => [{ x: 31, y: 31 }], cows: () => [], cats: () => [], helis: () => [],
      heightAt: () => 2, maxHeight: 10, env: () => ({ season: 'summer', weather: 'clear', hour: 10, wind: 0.1 }),
    }).sample({ x: at.x, z: at.z, yaw: 0 }, AMB.walkZoom);
    const near = mk({ x: 29, z: 29 }), far = mk({ x: 5, z: 5 });
    expect(near.crowd).toBe(40); expect(far.crowd).toBe(0);
    expect(near.lifts).toBeGreaterThan(0.9); expect(far.lifts).toBeLessThan(near.lifts);
    expect(near.buildings).toBeGreaterThan(far.buildings);
    expect(near.zoom).toBe(AMB.walkZoom);
  });
});
