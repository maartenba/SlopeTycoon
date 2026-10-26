import { describe, expect, it } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { PropStore } from '../../src/world/Props';
import { Rng } from '../../src/core/Rng';
import {
  cornerBrushRect, flattenRect, raiseLowerRect, smoothRect, tileBrushRect,
} from '../../src/world/Terraform';
import { pickHeightfield } from '../../src/render/Picking';
import { TERRAFORM_COST_PER_HALF_STEP } from '../../src/config/balance';

function flatGrid(h = 10): Grid {
  const g = new Grid(128);
  g.heights.fill(h);
  return g;
}

describe('terraform', () => {
  it('raises a tile (4 corners) with cost', () => {
    const g = flatGrid();
    const r = raiseLowerRect(g, tileBrushRect(g, 5, 5, 1), 1);
    expect(r.ok).toBe(true);
    expect(r.changed.length).toBe(4);
    expect(g.getCorners(5, 5)).toEqual([11, 11, 11, 11]);
    expect(r.cost).toBe(4 * TERRAFORM_COST_PER_HALF_STEP);
  });
  it('lowers a single corner', () => {
    const g = flatGrid();
    const r = raiseLowerRect(g, cornerBrushRect(g, 5, 5, 1), -1);
    expect(r.halfSteps).toBe(1);
    expect(g.getCorner(5, 5)).toBe(9);
  });
  it('multiplier hook scales cost; preview does not mutate', () => {
    const g = flatGrid();
    const r = raiseLowerRect(g, cornerBrushRect(g, 5, 5, 3), 1, { commit: false, constructionMultiplier: () => 0.5 });
    expect(r.halfSteps).toBe(9);
    expect(r.cost).toBe(9 * TERRAFORM_COST_PER_HALF_STEP * 0.5);
    expect(g.getCorner(5, 5)).toBe(10);
  });
  it('propagates to keep delta<=2', () => {
    const g = flatGrid();
    for (let i = 0; i < 6; i++) raiseLowerRect(g, cornerBrushRect(g, 20, 20, 1), 1);
    expect(g.getCorner(20, 20)).toBe(16);
    expect(g.checkInvariants()).toEqual([]);
    expect(g.getCorner(21, 21)).toBeGreaterThanOrEqual(14);
  });
  it('flattens area to target', () => {
    const g = flatGrid();
    raiseLowerRect(g, cornerBrushRect(g, 10, 10, 1), 2);
    const r = flattenRect(g, { vx0: 8, vy0: 8, vx1: 12, vy1: 12 }, 10);
    expect(r.ok).toBe(true);
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) expect(g.getCorner(x, y)).toBe(10);
    expect(g.checkInvariants()).toEqual([]);
  });
  it('flatten to a distant target stays valid', () => {
    const g = flatGrid();
    flattenRect(g, { vx0: 30, vy0: 30, vx1: 33, vy1: 33 }, 40);
    expect(g.getCorner(31, 31)).toBe(40);
    expect(g.checkInvariants()).toEqual([]);
  });
  it('blocks on occupied tiles and leaves grid untouched', () => {
    const g = flatGrid();
    g.occupancy.set(5, 5, OccFlag.Building, 1);
    const before = g.heights.slice();
    const r = raiseLowerRect(g, tileBrushRect(g, 5, 5, 1), 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('occupied');
    expect(g.heights).toEqual(before);
    // propagation reaching an occupied tile also blocks
    const r2 = raiseLowerRect(g, cornerBrushRect(g, 8, 5, 1), 5);
    expect(g.checkInvariants()).toEqual([]);
    expect(r2.ok === false ? g.heights : before).toEqual(before);
  });
  it('removes props in footprint', () => {
    const g = flatGrid();
    const props = new PropStore(g);
    props.add(0, 5, 5, 0.5, 0.5, 1, 0, 1);
    props.add(0, 60, 60, 0.5, 0.5, 1, 0, 1);
    const r = raiseLowerRect(g, tileBrushRect(g, 5, 5, 1), 1, { props });
    expect(r.removedProps).toBe(1);
    expect(props.count()).toBe(1);
    expect(r.touchedChunks.length).toBe(1);
  });
  it('fuzz keeps invariants', () => {
    const g = flatGrid(20);
    const rng = new Rng(7);
    for (let i = 0; i < 400; i++) {
      const x = Math.floor(rng.next() * 20) + 40, y = Math.floor(rng.next() * 20) + 40;
      const b = 1 + Math.floor(rng.next() * 5);
      const d = rng.next() < 0.5 ? -1 : 1;
      const k = rng.next();
      if (k < 0.4) raiseLowerRect(g, tileBrushRect(g, x, y, b), d);
      else if (k < 0.8) raiseLowerRect(g, cornerBrushRect(g, x, y, b), d);
      else flattenRect(g, { vx0: x, vy0: y, vx1: x + b, vy1: y + b }, Math.floor(rng.next() * 40));
    }
    expect(g.checkInvariants()).toEqual([]);
    for (const h of g.heights) expect(h).toBeGreaterThanOrEqual(0);
  });
});

describe('picking', () => {
  it('hits expected tile/corner on flat and sloped ground', () => {
    const g = flatGrid(10); // y = 5
    const r = pickHeightfield(g, { x: 30.3, y: 50, z: 40.4 }, { x: 0, y: -1, z: 0 });
    expect(r).not.toBeNull();
    expect(r!.tileX).toBe(30);
    expect(r!.tileY).toBe(40);
    expect(r!.vx).toBe(30);
    expect(r!.vy).toBe(40);
    expect(r!.point.y).toBeCloseTo(5, 3);
  });
  it('oblique ray accounts for height', () => {
    const g = flatGrid(10);
    const d = { x: -1, y: -1, z: -1 };
    // ray passing through (50.7, 5, 60.7)
    const t = 20;
    const r = pickHeightfield(g, { x: 50.7 - d.x * t, y: 5 - d.y * t, z: 60.7 - d.z * t }, d);
    expect(r!.tileX).toBe(50);
    expect(r!.tileY).toBe(60);
    expect(r!.vx).toBe(51);
    expect(r!.vy).toBe(61);
  });
  it('hits a raised hill instead of the ground behind it', () => {
    const g = flatGrid(0);
    raiseLowerRect(g, cornerBrushRect(g, 50, 50, 1), 2);
    const r = pickHeightfield(g, { x: 50, y: 30, z: 50 }, { x: 0, y: -1, z: 0 });
    expect(r!.point.y).toBeCloseTo(1, 2);
    expect(r!.vx).toBe(50);
  });
  it('misses outside map / upward rays', () => {
    const g = flatGrid();
    expect(pickHeightfield(g, { x: -50, y: 50, z: -50 }, { x: 0, y: -1, z: 0 })).toBeNull();
    expect(pickHeightfield(g, { x: 5, y: 50, z: 5 }, { x: 0, y: 1, z: 0 })).toBeNull();
  });
});

function maxEdge(g: Grid): number {
  let m = 0;
  const v = g.vsize;
  for (let y = 0; y < v; y++) for (let x = 0; x < v; x++) {
    const h = g.heights[y * v + x]!;
    if (x + 1 < v) m = Math.max(m, Math.abs(h - g.heights[y * v + x + 1]!));
    if (y + 1 < v) m = Math.max(m, Math.abs(h - g.heights[(y + 1) * v + x]!));
  }
  return m;
}
function roughness(g: Grid): number {
  let s = 0;
  const v = g.vsize;
  for (let y = 0; y < v; y++) for (let x = 0; x < v; x++) {
    const h = g.heights[y * v + x]!;
    if (x + 1 < v) s += Math.abs(h - g.heights[y * v + x + 1]!);
    if (y + 1 < v) s += Math.abs(h - g.heights[(y + 1) * v + x]!);
  }
  return s;
}

describe('terraform smoothing (R2)', () => {
  it.each([1, 2] as const)('repeated falloff raises respect maxEdgeDelta=%i and hill is monotonic', (me) => {
    const g = flatGrid(20);
    const cx = 64, cy = 64;
    for (let i = 0; i < 6; i++) raiseLowerRect(g, tileBrushRect(g, cx, cy, 3), 1, { falloff: true, maxEdgeDelta: me });
    expect(maxEdge(g)).toBeLessThanOrEqual(me);
    expect(g.checkInvariants().length).toBe(0);
    // monotonic non-increasing going outward along +x from the peak row
    const peak = g.getCorner(cx + 1, cy + 1);
    expect(peak).toBeGreaterThan(20);
    let prev = peak;
    for (let x = cx + 1; x < cx + 20; x++) {
      const h = g.getCorner(x, cy + 1);
      expect(h).toBeLessThanOrEqual(prev);
      prev = h;
    }
  });
  it('single falloff raise on flat is rounded and gentle', () => {
    const g = flatGrid(20);
    raiseLowerRect(g, tileBrushRect(g, 64, 64, 3), 1, { falloff: true });
    expect(maxEdge(g)).toBeLessThanOrEqual(1);
    expect(g.getCorner(64, 64)).toBe(22);
    expect(g.getCorner(63, 63)).toBeLessThan(22);
  });
  it('smooth mode reduces roughness', () => {
    const g = flatGrid(20);
    const r = new Rng(3);
    for (let i = 0; i < 40; i++) raiseLowerRect(g, cornerBrushRect(g, 30 + r.int(0, 10), 30 + r.int(0, 10), 1), r.int(0, 1) ? 2 : -2, { maxEdgeDelta: 2 });
    const rect = { vx0: 28, vy0: 28, vx1: 42, vy1: 42 };
    const before = roughness(g);
    const res = smoothRect(g, rect, { maxEdgeDelta: 1 });
    expect(res.ok).toBe(true);
    expect(roughness(g)).toBeLessThan(before);
    expect(maxEdge(g)).toBeLessThanOrEqual(2);
  });
  it('fuzz keeps invariants for both max-slope settings', () => {
    for (const me of [1, 2] as const) {
      const g = flatGrid(30);
      const r = new Rng(me * 77);
      for (let i = 0; i < 450; i++) {
        const x = r.int(2, 120), y = r.int(2, 120), b = r.int(1, 5), k = r.int(0, 3);
        const rect = r.int(0, 1) ? tileBrushRect(g, x, y, b) : cornerBrushRect(g, x, y, b);
        const o = { maxEdgeDelta: me, falloff: true };
        if (k === 0) raiseLowerRect(g, rect, 1, o);
        else if (k === 1) raiseLowerRect(g, rect, -1, o);
        else if (k === 2) flattenRect(g, rect, g.getCorner(x, y), o);
        else smoothRect(g, rect, o);
      }
      expect(g.checkInvariants()).toEqual([]);
      expect(maxEdge(g)).toBeLessThanOrEqual(me);
    }
  });
  it('flatten blends into surroundings', () => {
    const g = flatGrid(20);
    flattenRect(g, { vx0: 60, vy0: 60, vx1: 64, vy1: 64 }, 30, { maxEdgeDelta: 1 });
    expect(maxEdge(g)).toBeLessThanOrEqual(1);
    expect(g.getCorner(58, 62)).toBeGreaterThan(20);
  });
});
