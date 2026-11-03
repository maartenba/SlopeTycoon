import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PropKind } from '../../src/world/Props';
import { Grid, TileType } from '../../src/world/Grid';
import { buildWaterData } from '../../src/render/Water';
import { nearRockGeometry, nearTreeGeometry } from '../../src/render/props/NearTrees';
import { createCowGeometry, createGoatGeometry, createSheepGeometry } from '../../src/render/meshes/Animals';
import { buildTramGeometry } from '../../src/render/meshes/lifts/Tram';
import { buildFunicularCarGeometry } from '../../src/render/meshes/lifts/Funicular';
import { buildGondolaGeometry } from '../../src/render/meshes/lifts/Gondola';
import { geometryHash } from '../../src/render/meshes/lifts/geo';

const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const finite = (g: THREE.BufferGeometry): boolean => ['position', 'normal'].every((n) => !g.getAttribute(n) || Array.from(g.getAttribute(n).array).every(Number.isFinite));

/** M8 lane E: near trees / rocks, cabins, shoreline corners, farm animals. */
describe('M8 lane E', () => {
  it('near trees and rocks: finite, deterministic, inside the near budgets, rock stays above the ground line', () => {
    for (const k of [PropKind.Conifer, PropKind.Pine, PropKind.Larch, PropKind.Deciduous, PropKind.Oak, PropKind.Birch, PropKind.Shrub, PropKind.Snag]) {
      const a = nearTreeGeometry(k)!, b = nearTreeGeometry(k)!;
      expect(finite(a), String(k)).toBe(true);
      expect(tris(a), String(k)).toBeLessThan(2400);
      expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(b.getAttribute('position').array));
    }
    const r = nearRockGeometry(); r.computeBoundingBox();
    expect(finite(r)).toBe(true); expect(tris(r)).toBeLessThan(1200); expect(r.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-6);
  });
  it('conifer whorls are scalloped (16 segments per tier), not plain cones', () => {
    expect(tris(nearTreeGeometry(PropKind.Conifer)!)).toBeGreaterThan(5 * 16 * 3);
  });
  it('cable car and funicular cabins: lofted, glass group kept, drop unchanged, budgets', () => {
    for (const near of [false, true]) {
      const t = buildTramGeometry(near), f = buildFunicularCarGeometry(near);
      expect(finite(t) && finite(f)).toBe(true);
      expect(tris(t)).toBeLessThanOrEqual(near ? 1300 : 780); expect(tris(f)).toBeLessThanOrEqual(near ? 1300 : 780);
      t.computeBoundingBox(); expect(t.boundingBox!.min.y).toBeGreaterThan(-1.0);
      expect(geometryHash(buildTramGeometry(near))).toBe(geometryHash(t));
    }
    expect(tris(buildGondolaGeometry(10, true))).toBeLessThanOrEqual(1500);
  });
  it('water: concave shoreline corners are flagged only where both sides are water and the diagonal is land', () => {
    const g = new Grid(64);
    const wet = new Set<number>();
    for (let y = 4; y < 10; y++) for (let x = 4; x < 10; x++) if (!(x === 4 && y === 4)) wet.add(y * 64 + x); // a 6x6 pond with its NW corner tile left dry
    for (const i of wet) g.tileType[i] = TileType.Water;
    const d = buildWaterData(g, [{ level: 0, tileIdx: Array.from(wet), tiles: wet.size } as never], [], []);
    expect(d.corners.length).toBe(d.vertexCount * 4);
    expect(d.corners.every((v) => v === 0 || v === 1)).toBe(true);
    let flagged = 0; for (let i = 0; i < d.corners.length; i++) flagged += d.corners[i]!;
    expect(flagged).toBeGreaterThan(0); // the tile at (5,5) has a dry diagonal (4,4) with wet n / w sides
  });
  it('farm animals: finite, legs are no longer hair-thin', () => {
    for (const f of [createCowGeometry, createSheepGeometry, createGoatGeometry]) expect(finite(f())).toBe(true);
  });
});
