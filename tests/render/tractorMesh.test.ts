import { describe, expect, it } from 'vitest';
import { baleGeometry, LIVERY_COUNT, loafGeometry, TRACTOR, tractorGeometry, tractorParts, tractorTris, trailerGeometry, trailerTris } from '../../src/render/meshes/tractor';

describe('tractor meshes', () => {
  it('stay inside the triangle budget (every livery)', () => {
    for (let v = 0; v < LIVERY_COUNT; v++) expect(tractorTris(v)).toBeLessThanOrEqual(1000);
    expect(trailerTris()).toBeLessThanOrEqual(450);
    expect(baleGeometry().getAttribute('position').count / 3).toBeLessThanOrEqual(100);
    expect(loafGeometry().getAttribute('position').count / 3).toBeLessThanOrEqual(90);
  });
  it('are vertex coloured, finite and sit on the ground', () => {
    for (const g of [tractorGeometry(), tractorGeometry(1), tractorGeometry(2), trailerGeometry(), baleGeometry(), loafGeometry()]) {
      expect(g.getAttribute('color')).toBeTruthy();
      const p = g.getAttribute('position').array as Float32Array;
      for (const v of p) expect(Number.isFinite(v)).toBe(true);
    }
    const t = tractorGeometry(); t.computeBoundingBox();
    expect(t.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.03); expect(t.boundingBox!.min.y).toBeLessThan(0.02);
    expect(t.boundingBox!.max.y).toBeLessThan(0.6);
  });
  it('variants are deterministic, share the silhouette and differ only in colour', () => {
    const a = tractorGeometry(0), b = tractorGeometry(0), c = tractorGeometry(1);
    expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(b.getAttribute('position').array));
    expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(c.getAttribute('position').array));
    expect(Array.from(a.getAttribute('color').array)).not.toEqual(Array.from(c.getAttribute('color').array));
  });
  it('keeps the attachment points the schedule code reads', () => {
    expect(TRACTOR.hitch).toBe(0.3); expect(TRACTOR.trailerAxle).toBe(0.58); expect(TRACTOR.stack).toEqual([0.2, 0.46, 0.09]);
    const t = trailerGeometry(); t.computeBoundingBox(); expect(t.boundingBox!.min.x).toBeLessThan(-0.58 - 0.3);
    expect(tractorParts().length).toBeGreaterThan(20);
  });
});
