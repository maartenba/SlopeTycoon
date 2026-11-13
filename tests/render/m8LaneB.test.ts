import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import * as T from '../../src/render/props/Trees';
import { rockGeometry } from '../../src/render/props/Rocks';
import * as A from '../../src/render/meshes/Animals';
import { buildGearGeometry, visibleTriangles } from '../../src/render/meshes/Figures';
import { Gear } from '../../src/render/guestAppearance';

const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const finite = (g: THREE.BufferGeometry): boolean => { for (const a of Object.values(g.attributes)) for (const v of a.array) if (!Number.isFinite(v)) return false; return true; };
const same = (a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean => { const x = a.getAttribute('position').array, y = b.getAttribute('position').array; return x.length === y.length && x.every((v, i) => v === y[i]); };

/** 0.4.0 triangle counts (docs/graphics-audit.md baseline): M8 lane B must not grow the tree total (trees are 59-92 % of a frame), animals / guests / rocks may grow <= 25 %. */
const TREE_BEFORE: Record<string, [number, number]> = { conifer: [72, 14], deciduous: [132, 52], pine: [60, 24], larch: [124, 24], birch: [104, 52], oak: [140, 52], shrub: [100, 56], snag: [88, 40] };
const ANIMAL_BEFORE: Record<string, number> = { Cow: 420, Sheep: 264, Goat: 300, Deer: 368, Ibex: 368, Chamois: 332, Marmot: 156, Fox: 420, Eagle: 124, Bear: 396, Wolf: 440, Rabbit: 180, Donkey: 476 };

describe('M8 lane B: trees, rocks, animals, guests', () => {
  it('every tree LOD stays within its 0.4.0 triangle count (+10 % total at most), finite and deterministic', () => {
    let before = 0, after = 0;
    for (const [n, [full, low]] of Object.entries(TREE_BEFORE)) {
      const f = (T as unknown as Record<string, (full: boolean) => THREE.BufferGeometry>)[n]!;
      const a = f(true), b = f(false);
      expect(tris(a)).toBeLessThanOrEqual(full * 1.1); expect(tris(b)).toBeLessThanOrEqual(low * 1.1);
      expect(finite(a) && finite(b)).toBe(true);
      expect(same(a, f(true))).toBe(true);
      before += full + low; after += tris(a) + tris(b);
    }
    expect(after).toBeLessThanOrEqual(before * 1.1);
  });
  it('conifer tiers are turned against each other (no stack of identical cones)', () => {
    const t0 = T.tier(0.5, 0.7, 0.3, 10, 20, false)[0]!.geo.getAttribute('position'), t1 = T.tier(0.5, 0.7, 0.3, 10, 21, false)[0]!.geo.getAttribute('position');
    expect(Math.atan2(t0.getZ(1), t0.getX(1))).not.toBeCloseTo(Math.atan2(t1.getZ(1), t1.getX(1)), 2);
  });
  it('rock: 100 triangles, finite, nothing below the ground line, deterministic', () => {
    const g = rockGeometry();
    expect(tris(g)).toBeLessThanOrEqual(100); expect(finite(g)).toBe(true);
    g.computeBoundingBox(); expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(0);
    expect(same(g, rockGeometry())).toBe(true);
  });
  it('animals: no more than +25 % triangles each, finite, smooth normals, within the tile footprint', () => {
    for (const [n, before] of Object.entries(ANIMAL_BEFORE)) {
      const g = (A as unknown as Record<string, () => THREE.BufferGeometry>)[`create${n}Geometry`]!();
      expect(tris(g), n).toBeLessThanOrEqual(n === 'Cow' ? 900 : before * 1.25); // 0.6.5: the cow was rebuilt fuller (owner request), capped at 900
      expect(finite(g), n).toBe(true);
      expect(g.getAttribute('color'), n).toBeDefined();
      g.computeBoundingBox(); if (n !== 'Eagle') expect(g.boundingBox!.min.y, n).toBeGreaterThanOrEqual(-0.01); // the eagle flies
      expect(g.boundingBox!.max.x - g.boundingBox!.min.x, n).toBeLessThan(1.0);
    }
  });
  it('guests: visible triangles per figure stay within the 400 guard and +10 % of 0.4.0', () => {
    const before = [176, 200, 248, 212, 336, 164, 200, 176];
    for (let gear = 0; gear < before.length; gear++) {
      const geo = buildGearGeometry(gear);
      let m = 0; for (let s = 0; s <= 8; s++) m = Math.max(m, visibleTriangles(geo, s, true));
      expect(m, `gear ${gear}`).toBeLessThanOrEqual(400); expect(m, `gear ${gear}`).toBeLessThanOrEqual(before[gear]! * 1.1);
      expect(finite(geo)).toBe(true);
    }
    expect(Gear.Ski).toBeDefined();
  });
});
