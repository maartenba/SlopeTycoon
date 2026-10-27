import { describe, expect, it } from 'vitest';
import { AMB, Ambience, LAYER_IDS, ambienceMix, churchStrikes, type AmbienceState } from '../../src/audio/Ambience';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { Sfx } from '../../src/audio/Sfx';
import { generateNoise, reverbImpulse } from '../../src/audio/synth';
import { nearestSource, proximity, spatialParams } from '../../src/audio/spatial';
import { FakeBackend } from './fakeBackend';

const base: AmbienceState = { season: 'summer', weather: 'clear', hour: 12, zoom: 8, altitude: 0.2, wind: 0.1, water: 0, crowd: 0, lifts: 0, buildings: 0, cows: 0, snowcat: 0, heli: 0 };
const mix = (o: Partial<AmbienceState>) => ambienceMix({ ...base, ...o });

describe('ambienceMix', () => {
  it('all outputs are finite and within 0..1', () => {
    for (const season of ['winter', 'spring', 'summer', 'autumn'] as const) for (const weather of ['clear', 'cloudy', 'snow', 'heavySnow', 'rain', 'storm'] as const) for (const hour of [0, 3, 6, 9, 12, 17, 20, 23.5]) for (const zoom of [5, 30, 120]) {
      const m = mix({ season, weather, hour, zoom, altitude: 1, wind: 1, water: 1, crowd: 500, lifts: 1, buildings: 1, cows: 20, snowcat: 1, heli: 1 });
      for (const [k, v] of Object.entries(m)) { expect(Number.isFinite(v), k).toBe(true); expect(v, k).toBeGreaterThanOrEqual(0); expect(v, k).toBeLessThanOrEqual(1); }
    }
  });
  it('seasons: birds/crickets/cowbells in summer, none in winter; winter muffled + creaks; spring drips; autumn leaves', () => {
    const sum = mix({ season: 'summer', hour: 7 }), win = mix({ season: 'winter', hour: 7 }), spr = mix({ season: 'spring', hour: 7 }), aut = mix({ season: 'autumn', hour: 7, wind: 0.6 });
    expect(sum.birds).toBeGreaterThan(win.birds * 10);
    expect(spr.birds).toBeGreaterThan(0.2);
    expect(win.muffled).toBeGreaterThan(sum.muffled);
    expect(win.creaks).toBeGreaterThan(0);
    expect(sum.creaks).toBe(0);
    expect(spr.drips).toBeGreaterThan(0);
    expect(sum.drips).toBe(0);
    expect(aut.leaves).toBeGreaterThan(0.2);
    expect(sum.leaves).toBe(0);
    expect(mix({ season: 'summer', cows: 6 }).cowbells).toBeGreaterThan(0.3);
    expect(mix({ season: 'winter', cows: 6 }).cowbells).toBe(0);
    expect(mix({ season: 'summer', hour: 12, cows: 6 }).insects).toBeGreaterThan(0);
    expect(mix({ season: 'winter' }).insects).toBe(0);
  });
  it('zoom: zoomed out = wind-dominated; zoomed in adds hums, murmur, bells, water', () => {
    const near = mix({ zoom: 8, lifts: 1, crowd: 60, water: 0.8, buildings: 1 }), far = mix({ zoom: 90, lifts: 1, crowd: 60, water: 0.8, buildings: 1 });
    expect(near.lift).toBeGreaterThan(far.lift * 3);
    expect(near.crowd).toBeGreaterThan(far.crowd);
    expect(far.crowd).toBeGreaterThan(0); // distant crowd stays audible
    expect(near.water).toBeGreaterThan(far.water);
    expect(near.bells).toBeGreaterThan(far.bells);
    expect(far.wind).toBeGreaterThan(near.wind);
  });
  it('water proximity drives the water layer; crowd density drives murmur monotonically', () => {
    expect(mix({ water: 0 }).water).toBe(0);
    expect(mix({ water: 1 }).water).toBeGreaterThan(mix({ water: 0.3 }).water);
    let last = -1;
    for (const c of [0, 5, 20, 80, 300]) { const v = mix({ crowd: c }).crowd; expect(v).toBeGreaterThan(last); last = v; }
    expect(mix({ season: 'winter', water: 1 }).water).toBeLessThan(mix({ season: 'spring', water: 1 }).water); // frozen
  });
  it('time of day: birds at dawn, crickets at warm dusk/night, quiet crowd at night, snowcat only at night', () => {
    expect(mix({ hour: 6.5 }).birds).toBeGreaterThan(mix({ hour: 14 }).birds);
    expect(mix({ hour: 0 }).birds).toBe(0);
    expect(mix({ hour: 21 }).crickets).toBeGreaterThan(mix({ hour: 12 }).crickets);
    expect(mix({ hour: 12 }).crickets).toBe(0);
    expect(mix({ hour: 2, crowd: 100 }).crowd).toBeLessThan(mix({ hour: 12, crowd: 100 }).crowd);
    expect(mix({ season: 'winter', hour: 23, snowcat: 1 }).snowcat).toBeGreaterThan(0.3);
    expect(mix({ season: 'winter', hour: 12, snowcat: 1 }).snowcat).toBe(0);
  });
  it('weather: storm wind > clear; rain patter only with rain/storm; snowfall quiets birds and crowd', () => {
    expect(mix({ weather: 'storm', wind: 1 }).wind).toBeGreaterThan(mix({ weather: 'clear' }).wind);
    expect(mix({ weather: 'rain' }).rain).toBeGreaterThan(0.3);
    expect(mix({ weather: 'clear' }).rain).toBe(0);
    expect(mix({ weather: 'snow', season: 'spring', crowd: 100, hour: 7 }).crowd).toBeLessThan(mix({ weather: 'clear', season: 'spring', crowd: 100, hour: 7 }).crowd);
    expect(mix({ weather: 'rain', hour: 7 }).birds).toBeLessThan(mix({ weather: 'clear', hour: 7 }).birds);
  });
  it('altitude strengthens wind; helicopter present only while airborne', () => {
    expect(mix({ altitude: 1 }).wind).toBeGreaterThan(mix({ altitude: 0 }).wind);
    expect(mix({ heli: 0 }).heli).toBe(0);
    expect(mix({ heli: 0.8 }).heli).toBeGreaterThan(0.3);
  });
  it('church strikes only in daytime hours', () => {
    expect(churchStrikes(3)).toBe(0); expect(churchStrikes(22)).toBe(0); expect(churchStrikes(12)).toBe(3); expect(churchStrikes(9)).toBe(3);
  });
});

describe('Ambience layers (fake backend)', () => {
  async function rig() {
    const fb = new FakeBackend(); const engine = new AudioEngine({ factory: () => fb, settings: new AudioSettings(null) });
    const sfx = new Sfx(engine); const amb = new Ambience(engine, sfx, () => 0.0001);
    return { fb, engine, sfx, amb };
  }
  it('no nodes before unlock; layers built once after; node count constant across 1000 updates', async () => {
    const { fb, engine, amb } = await rig();
    amb.update(base, 0.1);
    expect(amb.layerCount).toBe(0);
    await engine.onGesture();
    amb.update(base, 0.1);
    expect(amb.layerCount).toBe(LAYER_IDS.length);
    const after = fb.nodes.length;
    expect(fb.live).toBeLessThan(200); // budget: loops + buses (LFO-driven drift costs a few nodes per layer)
    for (let i = 0; i < 1000; i++) { fb.t += 0.1; amb.update({ ...base, zoom: 5 + (i % 50), hour: (i / 10) % 24 }, 0.1); engine.reap(fb.t); }
    // one-shot voices come and go, but looping layers are never rebuilt
    expect(amb.layerCount).toBe(LAYER_IDS.length);
    expect(fb.live).toBeLessThan(240);
    expect(fb.nodes.length - after).toBeGreaterThan(0);
  });
  it('layer gains crossfade with setTargetAtTime (no instant jumps)', async () => {
    const { fb, engine, amb } = await rig();
    await engine.onGesture();
    amb.update({ ...base, weather: 'storm', wind: 1 }, 0.1);
    const gains = fb.nodes.filter((n) => n.gain.calls.includes('target'));
    expect(gains.length).toBeGreaterThanOrEqual(LAYER_IDS.length);
    for (const n of fb.nodes) if (n.kind === 'gain' && n.gain.calls.includes('target')) expect(n.gain.calls.includes('set')).toBe(false);
    expect(AMB.fadeTc).toBeGreaterThan(0.2);
  });
  it('one-shots are scheduled by rate (birds at dawn with a deterministic rng)', async () => {
    const { fb, engine, amb, sfx } = await rig();
    await engine.onGesture();
    for (let i = 0; i < 100; i++) { fb.t += 0.5; amb.update({ ...base, hour: 6.5 }, 0.5); }
    expect(sfx.played.birdChirp ?? 0).toBeGreaterThan(5);
  });
  it('dispose disconnects layer nodes', async () => {
    const { fb, engine, amb } = await rig();
    await engine.onGesture(); amb.update(base, 0.1);
    const live = fb.live; amb.dispose();
    expect(fb.live).toBeLessThan(live - 20);
  });
});

describe('synth + spatial', () => {
  it('noise is normalised, deterministic and seamless-ish', () => {
    for (const k of ['white', 'pink', 'brown'] as const) {
      const a = generateNoise(k, 4000, 3), b = generateNoise(k, 4000, 3);
      expect(Array.from(a.slice(0, 20))).toEqual(Array.from(b.slice(0, 20)));
      expect(Math.max(...Array.from(a, Math.abs))).toBeCloseTo(0.9, 5);
      let sum = 0;
      for (let i = 1; i < 4000; i++) sum += Math.abs(a[i]! - a[i - 1]!);
      expect(Math.abs(a[3999]! - a[0]!)).toBeLessThan((sum / 3999) * 6); // loop seam is as smooth as any other neighbouring pair
    }
    const imp = reverbImpulse(8000, 1);
    expect(imp.length).toBe(8000);
    expect(Math.abs(imp[7990]!)).toBeLessThan(0.01);
  });
  it('spatial: nearer = louder; pan follows camera right axis and flips with yaw', () => {
    const l = { x: 50, z: 50, yaw: 0 };
    expect(spatialParams(l, 52, 50).gain).toBeGreaterThan(spatialParams(l, 90, 50).gain);
    expect(spatialParams(l, 80, 50).pan).toBeGreaterThan(0.3);
    expect(spatialParams(l, 20, 50).pan).toBeLessThan(-0.3);
    expect(spatialParams({ ...l, yaw: Math.PI }, 80, 50).pan).toBeLessThan(-0.3);
    expect(spatialParams(l, 50, 50).pan).toBe(0);
    expect(proximity(0, 40)).toBe(1); expect(proximity(50, 40)).toBe(0);
    expect(nearestSource(l, [{ x: 10, y: 10 }, { x: 52, y: 51 }])!.item.x).toBe(52);
    expect(nearestSource(l, [])).toBeNull();
  });
});
