import { describe, expect, it } from 'vitest';
import { AMB, ambienceMix, type AmbienceState } from '../../src/audio/Ambience';
import { WorldProbe, type ProbeDeps } from '../../src/audio/worldProbe';
import { Grid } from '../../src/world/Grid';

/** Phase 6 Task 19: the campfire crackle (docs/campground.md, "Audio"): the quietest bed, only near an open campground in the evening. */
const base: AmbienceState = { season: 'summer', weather: 'clear', hour: 20.5, zoom: 8, altitude: 0.2, wind: 0.1, water: 0, crowd: 0, lifts: 0, buildings: 0, cows: 0, snowcat: 0, heli: 0, campfire: 1 };
const mix = (o: Partial<AmbienceState>) => ambienceMix({ ...base, ...o });

describe('campfire crackle', () => {
  it('audible near a fire on a summer evening, silent by day, without a fire, zoomed far out and in the rain', () => {
    expect(mix({}).campfire).toBeGreaterThan(0.8);
    expect(mix({ hour: 12 }).campfire).toBe(0);
    expect(mix({ hour: 3 }).campfire).toBe(0);
    expect(mix({ campfire: 0 }).campfire).toBe(0);
    expect(mix({ campfire: undefined }).campfire).toBe(0);
    expect(mix({ zoom: 90 }).campfire).toBe(0);
    expect(mix({ weather: 'storm' }).campfire).toBe(0);
    expect(mix({ zoom: 30 }).campfire).toBeLessThan(mix({ zoom: 8 }).campfire);
  });
  it('is the quietest layer: its ceiling is below the crickets, a fraction of the crowd', () => {
    expect(AMB.layerMax.campfire).toBeLessThanOrEqual(AMB.layerMax.crickets);
    expect(AMB.layerMax.campfire).toBeLessThan(AMB.layerMax.crowd / 4);
    expect(AMB.layerMax.campfire).toBeGreaterThan(0);
  });
  it('the probe: 1 at the fire, fading out by 14 tiles, 0 with no fire or no provider', () => {
    const grid = new Grid(64);
    const d = (campfires?: ProbeDeps['campfires']): ProbeDeps => ({
      grid, guests: { count: () => 0 }, lifts: () => [], buildings: () => [], cows: () => [], cats: () => [], helis: () => [], heightAt: () => 0, maxHeight: 1,
      env: () => ({ season: 'summer', weather: 'clear', hour: 20, wind: 0 }), campfires,
    });
    const at = (x: number, z: number, f?: ProbeDeps['campfires']): number | undefined => new WorldProbe(d(f)).sample({ x, z } as never, 8).campfire;
    const fire = (): Array<{ x: number; y: number }> => [{ x: 30, y: 30 }];
    expect(at(30, 30, fire)).toBeCloseTo(1, 1);
    expect(at(30, 38, fire)!).toBeLessThan(at(30, 33, fire)!);
    expect(at(30, 50, fire)).toBe(0);
    expect(at(30, 30, () => [])).toBe(0);
    expect(at(30, 30)).toBe(0);
  });
});
