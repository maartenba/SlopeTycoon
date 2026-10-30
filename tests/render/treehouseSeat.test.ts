import { describe, expect, it } from 'vitest';
import { createSim } from '@/game/createSim';
import { buildParts, DEFAULT_FOUNDATION } from '@/render/meshes';
import { rootedSeatOf, seatOf } from '@/sim/PlaceBuilding';

/** Phase 6 visual check: a treehouse on a slope grows out of the hill (mid seat + trunk), it does not stand on a big grey retaining skirt. */
const bbox = (parts: ReturnType<typeof buildParts>): { minY: number } => {
  let minY = Infinity;
  for (const g of [parts.wood, parts.stone, parts.roof]) { const a = g?.attributes.position; if (a) for (let i = 0; i < a.count; i++) minY = Math.min(minY, a.getY(i)); }
  return { minY };
};

describe('treehouse seat on a slope', () => {
  it('rootedSeatOf sits mid-range with the trunk reaching the lowest corner; the plain seat would be a tall plinth', () => {
    const sim = createSim({ size: 64, seed: 61 });
    let steepest = { x: 0, y: 0, spread: 0 };
    for (let y = 2; y < 60; y++) for (let x = 2; x < 60; x++) { const s = seatOf(sim.grid, x, y, 2, 2); if (s.spread > steepest.spread) steepest = { x, y, spread: s.spread }; }
    expect(steepest.spread).toBeGreaterThanOrEqual(1);
    const plain = seatOf(sim.grid, steepest.x, steepest.y, 2, 2), rooted = rootedSeatOf(sim.grid, steepest.x, steepest.y, 2, 2);
    expect(rooted.y).toBeLessThan(plain.y); // lower than the high-corner pad
    expect(rooted.y - rooted.depth).toBeLessThanOrEqual(plain.y - plain.spread + 1e-6); // the trunk reaches the lowest corner
    expect(rooted.depth).toBeLessThan(plain.depth); // never deeper than the old plinth
    // flat ground: just the minimum embed
    const flat = rootedSeatOf({ getCorner: () => 4 } as never, 5, 5, 2, 2);
    expect(flat.depth).toBeCloseTo(0.3);
  });
  it('the treehouse mesh has no stone layer on a slope and its trunk reaches down to the depth', () => {
    const slope = buildParts('treehouse', 2, 2, 1.6), flat = buildParts('treehouse', 2, 2, DEFAULT_FOUNDATION);
    expect((slope as unknown as { stone?: unknown }).stone ?? null).toBeNull();
    expect(bbox(slope).minY).toBeCloseTo(-1.6, 1);
    expect(bbox(flat).minY).toBeCloseTo(-DEFAULT_FOUNDATION, 1);
    // a different building keeps its retaining skirt (unchanged behaviour)
    expect((buildParts('campground', 5, 4, 1.6) as unknown as { stone?: unknown }).stone ?? null).not.toBeNull();
  });
});
