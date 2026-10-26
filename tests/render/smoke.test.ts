import { describe, it, expect } from 'vitest';
import { selectEmitters, smokeIntensity, smokeCapForZoom, SMOKE, type SmokeCandidate } from '../../src/render/Smoke';

const mk = (id: number, type: string): SmokeCandidate => ({ id, type, active: true, cx: id, cy: id });
describe('chimney smoke emitter selection', () => {
  it('needs cold, a chimney and an active building', () => {
    expect(smokeIntensity('chalet', true, 15, 20, 1)).toBe(0);
    expect(smokeIntensity('chalet', true, -5, 20, 1)).toBeGreaterThan(0.8);
    expect(smokeIntensity('chalet', false, -5, 20, 1)).toBe(0);
    expect(smokeIntensity('shop', true, -5, 20, 1)).toBe(0);
  });
  it('chalets smoke with overnight guests; restaurants at lunch', () => {
    expect(smokeIntensity('chalet', true, 0, 23, 1)).toBeGreaterThan(smokeIntensity('chalet', true, 0, 23, 0));
    expect(smokeIntensity('lodge', true, 0, 12.5, 0, 1)).toBeGreaterThan(smokeIntensity('lodge', true, 0, 15, 0, 1));
  });
  it('caps, orders and is deterministic', () => {
    const cands = Array.from({ length: 40 }, (_, i) => mk(i + 1, i % 2 ? 'chalet' : 'cafe'));
    const ctx = { tempAt: () => -3, hour: 19, overnight: 0.8 };
    const a = selectEmitters(cands, ctx), b = selectEmitters(cands, ctx);
    expect(a).toEqual(b);
    expect(a.length).toBe(SMOKE.maxEmitters);
    for (let i = 1; i < a.length; i++) expect(a[i - 1]!.intensity).toBeGreaterThanOrEqual(a[i]!.intensity);
    expect(selectEmitters(cands, { ...ctx, tempAt: () => 20 })).toEqual([]);
  });
  it('LOD lowers the cap with zoom', () => {
    expect(smokeCapForZoom(30)).toBe(SMOKE.maxEmitters);
    expect(smokeCapForZoom(60)).toBeLessThan(SMOKE.maxEmitters);
    expect(smokeCapForZoom(200)).toBe(0);
  });
});
