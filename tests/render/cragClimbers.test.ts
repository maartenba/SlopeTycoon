import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CRAG_VIEW, CragClimbers, climbProgress, pickFaces, type CragView } from '../../src/render/CragClimbers';
import { BUILDINGS } from '../../src/config/buildings';
import { cliffFaces, isCliffTile } from '../../src/world/Cliffs';
import { createSim } from '../../src/game/createSim';

const RULE = BUILDINGS.crag!.site.nearRock!;
const sim = createSim({ size: 64, seed: 5, now: () => 0, starterResort: false });
const grid = sim.grid;
/** A 2x2 footprint with cliffs in reach (no placement rules needed: the view only reads faces). */
const site = ((): { x: number; y: number } => {
  for (let y = 4; y < 60; y++) for (let x = 4; x < 60; x++) if (cliffFaces(grid, { x, y, w: 2, h: 2 }, RULE).length >= 5) return { x, y };
  throw new Error('no cliff area');
})();
const view = (users: number, open = true, id = 1): CragView => ({ id, x: site.x, y: site.y, w: 2, h: 2, users, open });
const mk = (views: CragView[]) => new CragClimbers(grid, () => views, () => 3, RULE);

describe('CragClimbers (view only)', () => {
  it('draws nothing without climbers, when closed, or zoomed far out', () => {
    for (const v of [view(0), view(4, false)]) { const c = mk([v]); c.update(1); expect(c.count).toBe(0); }
    const far = mk([view(4)]); far.far = true; far.update(1);
    expect(far.group.visible).toBe(false);
    expect(far.count).toBe(0);
  });
  it('puts one climber per climbing guest on the rock face (capped), with a rope each, 2 instanced draws', () => {
    const c = mk([view(3)]);
    expect(c.group.children.length).toBe(2);
    c.update(10);
    expect(c.count).toBe(3);
    expect(c.ropes.count).toBe(3);
    const m = new THREE.Matrix4(), faces = cliffFaces(grid, { x: site.x, y: site.y, w: 2, h: 2 }, RULE);
    for (let i = 0; i < c.count; i++) {
      c.climbers.getMatrixAt(i, m);
      const x = m.elements[12]!, z = m.elements[14]!;
      expect(isCliffTile(grid, Math.floor(x), Math.floor(z), 2), `climber ${i} on a cliff tile`).toBe(true);
      expect(faces.some((f) => Math.hypot(f.cx - x, f.cy - z) < 0.8)).toBe(true);
    }
    const big = mk([view(30)]); big.update(10);
    expect(big.count).toBeLessThanOrEqual(CRAG_VIEW.perCrag);
  });
  it('is capped over the whole map and climbers move up and down the face with the tick', () => {
    const many = mk(Array.from({ length: 20 }, (_, k) => view(6, true, k + 1)));
    many.update(5);
    expect(many.count).toBeLessThanOrEqual(CRAG_VIEW.total);
    const c = mk([view(1)]), a = new THREE.Matrix4(), b = new THREE.Matrix4();
    c.update(0); c.climbers.getMatrixAt(0, a);
    c.update(30); c.climbers.getMatrixAt(0, b);
    expect(a.elements[12] !== b.elements[12] || a.elements[14] !== b.elements[14]).toBe(true);
  });
  it('picks well-spaced faces, nearest first, and the climb progress stays on the face', () => {
    const faces = cliffFaces(grid, { x: site.x, y: site.y, w: 2, h: 2 }, RULE);
    const pick = pickFaces(faces, 6);
    expect(pick.length).toBeGreaterThan(0);
    for (let i = 0; i < pick.length; i++) for (let j = i + 1; j < pick.length; j++) expect(Math.hypot(pick[i]!.cx - pick[j]!.cx, pick[i]!.cy - pick[j]!.cy)).toBeGreaterThanOrEqual(CRAG_VIEW.minGap);
    for (let t = 0; t < 400; t += 7) { const p = climbProgress(t, 3); expect(p).toBeGreaterThanOrEqual(0.12 - 1e-9); expect(p).toBeLessThanOrEqual(0.88 + 1e-9); }
  });
});
