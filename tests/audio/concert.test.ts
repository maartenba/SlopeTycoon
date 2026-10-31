import { describe, expect, it } from 'vitest';
import { AMB, LAYER_IDS, ambienceMix, type AmbienceState } from '../../src/audio/Ambience';
import { WorldProbe, type ProbeDeps } from '../../src/audio/worldProbe';
import { Grid } from '../../src/world/Grid';
import { clickScore, spectrum, statsOf, tonalProminence } from './offlineBackend';
import { AMB_BASE, renderAudio } from './renderHarness';

/** Task 41: the Mountain Concert bed (docs/festivals.md, "Audio"): a very quiet distant music bed + murmur while the event runs and the camera is near. */
const base: AmbienceState = { season: 'summer', weather: 'clear', hour: 20, zoom: 8, altitude: 0.4, wind: 0.1, water: 0, crowd: 0, lifts: 0, buildings: 0, cows: 0, snowcat: 0, heli: 0, concert: 1 };
const mix = (o: Partial<AmbienceState>) => ambienceMix({ ...base, ...o });

describe('concert bed', () => {
  it('audible near a running concert, silent without one, zoomed far out, at night after the show or in a storm', () => {
    expect(mix({}).concert).toBeGreaterThan(0.8);
    expect(mix({ concert: 0 }).concert).toBe(0);
    expect(mix({ concert: undefined }).concert).toBe(0);
    expect(mix({ zoom: 90 }).concert).toBe(0);
    expect(mix({ hour: 4 }).concert).toBe(0);
    expect(mix({ zoom: 30 }).concert).toBeLessThan(mix({ zoom: 8 }).concert);
    expect(mix({ weather: 'rain' }).concert).toBeLessThan(mix({}).concert);
    expect(mix({ weather: 'snow', season: 'winter', hour: 15 }).concert).toBeGreaterThan(0);
  });
  it('ceiling about 0.04 (one of the quietest layers, below the crowd and every wind / water bed)', () => {
    expect(AMB.layerMax.concert).toBeLessThanOrEqual(0.04);
    expect(AMB.layerMax.concert).toBeGreaterThan(0);
    expect(AMB.layerMax.concert).toBeLessThan(AMB.layerMax.crowd / 4);
    expect(LAYER_IDS).toContain('concert');
  });
  it('the probe: 1 at the stage, fading out by 30 tiles, 0 with no stage or no provider', () => {
    const grid = new Grid(64);
    const d = (concerts?: ProbeDeps['concerts']): ProbeDeps => ({
      grid, guests: { count: () => 0 }, lifts: () => [], buildings: () => [], cows: () => [], cats: () => [], helis: () => [], heightAt: () => 0, maxHeight: 1,
      env: () => ({ season: 'summer', weather: 'clear', hour: 20, wind: 0 }), concerts,
    });
    const at = (x: number, z: number, f?: ProbeDeps['concerts']): number | undefined => new WorldProbe(d(f)).sample({ x, z } as never, 8).concert;
    const stage = (): Array<{ x: number; y: number }> => [{ x: 30, y: 30 }];
    expect(at(30, 30, stage)).toBeCloseTo(1, 1);
    expect(at(30, 45, stage)!).toBeLessThan(at(30, 35, stage)!);
    expect(at(30, 62, stage)).toBe(0);
    expect(at(30, 30, () => [])).toBe(0);
    expect(at(30, 30)).toBe(0);
  });
  it('rendered at full gain: headroom, no DC, no clicks, no tonal line, far below the music; quiet at defaults', async () => {
    const SR = 24000;
    const r = await renderAudio({ seconds: 24, sampleRate: SR, seed: 7, settings: { ambience: 1, master: 1 }, ambience: { ...AMB_BASE, season: 'summer', hour: 20, wind: 0, concert: 1 }, musicOn: false });
    const x = r.l.subarray(SR * 8), s = statsOf(x), tp = tonalProminence(x, SR);
    expect(s.peak).toBeLessThan(0.9); expect(Math.abs(s.dc)).toBeLessThan(1e-3);
    expect(clickScore(x)).toBeLessThan(12); expect(tp.db, `tonal ${tp.hz} Hz`).toBeLessThan(7);
    expect(spectrum(x, SR).above(8000)).toBeLessThan(0.01);
    const d = await renderAudio({ seconds: 14, sampleRate: 16000, seed: 7, ambience: { ...AMB_BASE, season: 'summer', hour: 20, wind: 0, concert: 1 }, musicOn: false });
    expect(statsOf(d.l.subarray(16000 * 6)).rmsDb).toBeLessThan(-30);
    // muted ambience = silence
    const m = await renderAudio({ seconds: 10, sampleRate: 16000, seed: 7, settings: { ambience: 0 }, ambience: { ...AMB_BASE, concert: 1 }, musicOn: false });
    expect(statsOf(m.l.subarray(16000 * 5)).peak).toBeLessThan(1e-4);
  }, 120000);
});
