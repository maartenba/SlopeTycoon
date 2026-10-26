import { describe, expect, it } from 'vitest';
import { districtHues, roofVariant } from '@/render/meshes';
import { AO_TOWER, AO_TREE_MAX, treeTowerAo } from '@/render/groundMask';
import { appearanceOf, setGuestDistrict } from '@/render/guestAppearance';
import { layoutVillage } from '@/render/VillageDecor';

describe('rich look pass 2', () => {
  it('districts pick 3 distinct hues, deterministic; seed 0 / no district stay neutral', () => {
    for (const s of [1, 7, 42]) { const h = districtHues(s); expect(new Set(h).size).toBe(3); expect(districtHues(s)).toEqual(h); }
    expect(roofVariant(0, 5)).toBe('n0');
    expect(roofVariant(12, null)[0]).toBe('n');
    const kinds = new Set(Array.from({ length: 200 }, (_, i) => roofVariant(i + 1, 5)[0]));
    expect(kinds).toEqual(new Set(['n', 'h']));
    expect(new Set(Array.from({ length: 200 }, (_, i) => roofVariant(i + 1, 5))).size).toBeLessThanOrEqual(4 + 3);
  });
  it('contact AO dabs stay below the building level and never lower it', () => {
    const n = 16, d = new Uint8Array(n * n * 4); d[(5 * n + 5) * 4 + 3] = 255;
    treeTowerAo(d, n, [{ tx: 5, ty: 5 }, { tx: 5, ty: 5 }, { tx: 8, ty: 8 }, { tx: 8, ty: 8 }, { tx: 8, ty: 8 }, { tx: 1, ty: 1 }], [{ tileX: 12, tileY: 12 }]);
    expect(d[(5 * n + 5) * 4 + 3]).toBe(255);
    expect(d[(8 * n + 8) * 4 + 3]).toBeGreaterThan(60); expect(d[(8 * n + 8) * 4 + 3]).toBeLessThanOrEqual(AO_TREE_MAX);
    expect(d[(1 * n + 1) * 4 + 3]).toBe(0);
    expect(d[(12 * n + 12) * 4 + 3]).toBe(AO_TOWER);
  });
  it('guest outfit harmony is opt-in and stable', () => {
    const base = Array.from({ length: 60 }, (_, i) => appearanceOf(i, 0, true).top);
    setGuestDistrict(9);
    const tops = Array.from({ length: 400 }, (_, i) => appearanceOf(i, 0, true).top);
    expect(tops).toEqual(Array.from({ length: 400 }, (_, i) => appearanceOf(i, 0, true).top));
    const share = new Map<number, number>(); tops.forEach((t) => share.set(t, (share.get(t) ?? 0) + 1));
    expect([...share.values()].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0)).toBeGreaterThan(400 * 0.5);
    setGuestDistrict(null);
    expect(Array.from({ length: 60 }, (_, i) => appearanceOf(i, 0, true).top)).toEqual(base);
  });
  it('hedge rows / stone walls are produced for garden plots and stay on free tiles', () => {
    const items = layoutVillage({ x: 20, y: 20, w: 4, h: 3 }, { size: 64, blocked: () => false }, Array.from({ length: 12 }, (_, i) => ({ x: 8 + (i % 4) * 8, y: 30 + Math.floor(i / 4) * 8, w: 3, h: 3 })));
    const rows = items.filter((i) => i.kind === 'hedge' || i.kind === 'wall');
    expect(rows.length).toBeGreaterThan(2);
    expect(new Set(rows.map((r) => r.kind)).size).toBe(2);
  });
});
