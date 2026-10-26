import { describe, expect, it } from 'vitest';
import { seasonTerrain, seasonWeights } from '@/render/Season';
import { PropStore } from '@/world/Props';
import { Grid } from '@/world/Grid';
import { TreeLayer } from '@/render/props/Trees';

describe('season', () => {
  it('weights sum to 1 and peak at their centres', () => {
    for (let t = 0; t < 1; t += 0.037) {
      const w = seasonWeights(t);
      expect(w.spring + w.summer + w.autumn + w.winter).toBeCloseTo(1, 6);
    }
    expect(seasonWeights(0.625).autumn).toBeCloseTo(1, 6);
    expect(seasonWeights(0.875).winter).toBeCloseTo(1, 6);
    expect(seasonWeights(1.125).spring).toBeCloseTo(1, 6);
  });
  it('snowline is lowest in winter, above peaks in summer', () => {
    expect(seasonTerrain(0.375, 40).snowline).toBeGreaterThan(40);
    expect(seasonTerrain(0.875, 40).snowline).toBeLessThan(15);
    expect(seasonTerrain(0.625, 40).autumn).toBe(1);
    expect(seasonTerrain(0.125, 40).springBloom).toBe(1);
  });
  it('TreeLayer.setSeasonYear updates the shared uniform in place', () => {
    const t = new TreeLayer(new PropStore(new Grid(64)));
    const ref = t.uniforms.uSeason.value;
    t.setSeasonYear(0.875);
    expect(t.uniforms.uSeason.value).toBe(ref);
    expect(ref.w).toBeCloseTo(1, 6);
    t.setSeason({ spring: 1, summer: 1, autumn: 0, winter: 0 });
    expect(ref.x).toBeCloseTo(0.5, 6);
  });
});

import { advanceYear, seasonName } from '@/render/Season';
describe('season debug helpers', () => {
  it('seasonName maps quarters and wraps', () => {
    expect(seasonName(0)).toBe('spring');
    expect(seasonName(0.375)).toBe('summer');
    expect(seasonName(0.6)).toBe('autumn');
    expect(seasonName(0.99)).toBe('winter');
    expect(seasonName(1.1)).toBe('spring');
    expect(seasonName(-0.1)).toBe('winter');
  });
  it('advanceYear wraps and scales with speed', () => {
    expect(advanceYear(0.5, 30, 1)).toBeCloseTo(0, 6);
    expect(advanceYear(0.9, 6, 1)).toBeCloseTo(0, 6);
    expect(advanceYear(0.1, 6, 2)).toBeCloseTo(0.3, 6);
  });
});
