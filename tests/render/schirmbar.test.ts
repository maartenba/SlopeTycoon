import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildParts } from '../../src/render/meshes';
import { revolveWedge, SB } from '../../src/render/meshes/schirmbar';

const tris = (id: string): number => { const p = buildParts(id, 2, 2, 0.4); return [p.wood, p.stone, p.roof].reduce((a, g) => a + (g ? (g.index ? g.index.count : g.getAttribute('position').count) / 3 : 0), 0) + (p.sign ? p.sign.geometry.getAttribute('position').count / 3 : 0); };

describe('Schirmbar mesh', () => {
  it('stays within 2000 triangles open and the closed state is lighter', () => {
    const open = tris('schirmbar'), closed = tris('schirmbar:closed');
    expect(open).toBeLessThanOrEqual(2000);
    expect(closed).toBeLessThan(open);
  });
  it('has a banner sign layer in both states (the resort name goes there) and a roof layer for the snow shader', () => {
    for (const id of ['schirmbar', 'schirmbar:closed']) { const p = buildParts(id, 2, 2, 0.4); expect(p.sign, id).toBeDefined(); expect(p.roof, id).toBeDefined(); expect(p.wood, id).toBeDefined(); }
  });
  it('fits its 2 x 2 footprint', () => {
    for (const id of ['schirmbar', 'schirmbar:closed']) {
      const p = buildParts(id, 2, 2, 0.4);
      for (const g of [p.wood, p.roof, p.sign?.geometry]) { g!.computeBoundingBox(); const bb = g!.boundingBox!; expect(bb.min.x).toBeGreaterThanOrEqual(-1.08); expect(bb.max.x).toBeLessThanOrEqual(1.08); expect(bb.min.z).toBeGreaterThanOrEqual(-1.08); expect(bb.max.z).toBeLessThanOrEqual(1.4); }
    }
  });
  it('roof wedges face outward (a wrong winding would make the roof invisible)', () => {
    const g = revolveWedge([[1, 0.6], [0.8, 1.0], [0.3, 1.4]], 0.2, 0.6), n = g.getAttribute('normal'), p = g.getAttribute('position');
    for (let i = 0; i < n.count; i++) { const out = new THREE.Vector3(p.getX(i), 0, p.getZ(i)).normalize(); expect(new THREE.Vector3(n.getX(i), 0, n.getZ(i)).dot(out)).toBeGreaterThan(0); }
    expect(SB.wedges % 2).toBe(0);
  });
  it('closed: the drape reaches the deck and the panels are not glass-coloured', () => {
    const p = buildParts('schirmbar:closed', 2, 2, 0.4); p.roof!.computeBoundingBox();
    expect(p.roof!.boundingBox!.min.y).toBeLessThan(0.15);
  });
});
