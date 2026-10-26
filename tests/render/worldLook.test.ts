import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { summerLeaf, displayHsv, SUMMER_GLSL } from '../../src/render/props/treeTint';
import { skyGradient, lightingAt } from '../../src/render/Lighting';
import { layoutVillage } from '../../src/render/VillageDecor';
import { chamferBox } from '../../src/render/meshes/common';

const hex = (h: number): [number, number, number] => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

describe('summer foliage tint (no grey/white/blue crowns)', () => {
  const leaves = { deciduous: 0x5b8c3a, birch: 0x93b955, oak: 0x4a7a2c, shrub: 0x4d8035 };
  for (const [name, h] of Object.entries(leaves)) {
    it(`${name} stays green (hue 65..160 deg) and saturated for every variety`, () => {
      for (let i = 0; i <= 20; i++) {
        const { h: hue, s, v } = displayHsv(summerLeaf(hex(h), i / 20));
        expect(hue, name).toBeGreaterThan(64);
        expect(hue).toBeLessThan(160);
        expect(s).toBeGreaterThan(0.38);
        expect(v).toBeLessThan(0.95); // never white-ish
      }
    });
  }
  it('birch is lighter than oak; oak is the deepest', () => {
    const v = (h: number) => displayHsv(summerLeaf(hex(h), 0.5)).v;
    expect(v(0x93b955)).toBeGreaterThan(v(0x5b8c3a)); expect(v(0x5b8c3a)).toBeGreaterThan(v(0x4a7a2c));
  });
  it('exports GLSL generated from the same constants', () => { expect(SUMMER_GLSL).toContain('summerColor'); expect(SUMMER_GLSL).toContain('1.300'); });
});

describe('sky gradient', () => {
  it('is deeper at the top by day and dark at night', () => {
    const d = skyGradient(lightingAt(12)), n = skyGradient(lightingAt(0));
    expect(d.top[2]).toBeGreaterThan(d.top[0]); expect(d.horizon[0] + d.horizon[1]).toBeGreaterThan(d.top[0] + d.top[1]);
    expect(n.top[0] + n.top[1] + n.top[2]).toBeLessThan(0.6);
  });
});

describe('village layout', () => {
  const lodge = { x: 30, y: 50, w: 4, h: 3 };
  it('is deterministic, avoids blocked tiles and stays near the lodge', () => {
    const a = layoutVillage(lodge, { size: 64, blocked: () => false }), b = layoutVillage(lodge, { size: 64, blocked: () => false });
    expect(a).toEqual(b); expect(a.length).toBeGreaterThan(20);
    expect(a.some((i) => i.kind === 'lamp') && a.some((i) => i.kind === 'bench') && a.some((i) => i.kind === 'planter') && a.some((i) => i.kind === 'stall')).toBe(true);
    const blockedRow = layoutVillage(lodge, { size: 64, blocked: (i) => Math.floor(i / 64) === 54 });
    expect(blockedRow.every((i) => Math.floor(i.z) !== 54)).toBe(true);
    for (const i of a) expect(Math.hypot(i.x - 32, i.z - 51.5)).toBeLessThan(9);
  });
});

describe('chamfered box', () => {
  it('has 44 triangles, outward normals and the requested bounding box', () => {
    const g = chamferBox(2, 1, 1, 0.1);
    expect(g.getAttribute('position').count / 3).toBe(44);
    g.computeBoundingBox(); const bb = g.boundingBox!;
    expect(bb.max.x).toBeCloseTo(1); expect(bb.min.y).toBeCloseTo(-0.5);
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) expect(p.getX(i) * n.getX(i) + p.getY(i) * n.getY(i) + p.getZ(i) * n.getZ(i)).toBeGreaterThan(-1e-6);
  });
});
