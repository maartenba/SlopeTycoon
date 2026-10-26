import { describe, expect, it } from 'vitest';
import { highlightPositions, PisteHighlight } from '../../src/render/PisteHighlight';
import { Grid } from '../../src/world/Grid';

describe('PisteHighlight', () => {
  it('builds 6 vertices per tile above the surface and toggles visibility', () => {
    const g = new Grid(64);
    const tiles = [5 * 64 + 5, 6 * 64 + 5];
    const p = highlightPositions(g, tiles);
    expect(p.length).toBe(2 * 18);
    expect(p[1]).toBeGreaterThan(0);
    const h = new PisteHighlight();
    expect(h.mesh.visible).toBe(false);
    h.set(g, tiles);
    expect(h.mesh.visible).toBe(true);
    h.clear();
    expect(h.mesh.visible).toBe(false);
  });
});
