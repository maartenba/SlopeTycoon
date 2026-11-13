import { describe, expect, it } from 'vitest';
import { baleGeometry, tractorGeometry, tractorTris, trailerGeometry, trailerTris } from '../../src/render/meshes/tractor';

describe('tractor meshes', () => {
  it('stay inside the triangle budget', () => {
    console.log('tractor', tractorTris(), 'trailer', trailerTris());
    expect(tractorTris()).toBeLessThanOrEqual(760);
    expect(trailerTris()).toBeLessThanOrEqual(400);
    expect(baleGeometry().getAttribute('position').count / 3).toBeLessThanOrEqual(40);
  });
  it('are vertex coloured, finite and sit on the ground', () => {
    for (const g of [tractorGeometry(), trailerGeometry(), baleGeometry()]) {
      expect(g.getAttribute('color')).toBeTruthy();
      const p = g.getAttribute('position').array as Float32Array;
      for (const v of p) expect(Number.isFinite(v)).toBe(true);
    }
    const t = tractorGeometry(); t.computeBoundingBox();
    expect(t.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.02); expect(t.boundingBox!.min.y).toBeLessThan(0.02);
    expect(t.boundingBox!.max.y).toBeLessThan(0.6);
  });
});
