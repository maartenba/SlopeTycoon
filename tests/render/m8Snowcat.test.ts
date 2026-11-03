import { describe, expect, it } from 'vitest';
import { createSnowcatGeometry } from '../../src/render/meshes/Snowcat';

/** M8 lane A: the groomer is a lofted, rounded model (was 84 triangles of boxes); one merged geometry, one instance layer. */
describe('snowcat geometry (M8)', () => {
  const g = createSnowcatGeometry();
  const tris = g.getAttribute('position').count / 3;
  it('stays within the deliberate budget (<= 600 tris, was 84; at most 32 instances in 1 draw call)', () => {
    expect(tris).toBeGreaterThan(300);
    expect(tris).toBeLessThanOrEqual(600);
  });
  it('is finite, vertex-coloured and keeps the old footprint (~0.9 tiles long, < 0.75 wide, < 0.7 tall)', () => {
    for (const name of ['position', 'normal', 'color']) for (const v of g.getAttribute(name).array) expect(Number.isFinite(v)).toBe(true);
    g.computeBoundingBox();
    const s = g.boundingBox!.max.clone().sub(g.boundingBox!.min);
    expect(s.z).toBeGreaterThan(0.9); expect(s.z).toBeLessThan(1.4);
    expect(s.x).toBeLessThan(0.75); expect(s.y).toBeLessThan(0.7);
    expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.001);
  });
  it('is deterministic', () => {
    const h = (x: typeof g): string => Array.from(x.getAttribute('position').array).slice(0, 600).map((v) => v.toFixed(4)).join();
    expect(h(createSnowcatGeometry())).toBe(h(g));
  });
});
