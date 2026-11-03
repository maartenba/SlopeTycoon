import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { buildParts } from '../../src/render/meshes';
import { FLAT_SNOW_UV, PartBuilder } from '../../src/render/meshes/common';
import { geometryHash } from '../../src/render/meshes/lifts/geo';

const tris = (g?: THREE.BufferGeometry | null): number => (g ? (g.index ? g.index.count : g.getAttribute('position').count) / 3 : 0);
const finite = (g: THREE.BufferGeometry): boolean => ['position', 'normal'].every((n) => !g.getAttribute(n) || Array.from(g.getAttribute(n).array).every(Number.isFinite));
const parts = (id: keyof typeof BUILDINGS): THREE.BufferGeometry[] => {
  const d = BUILDINGS[id]!;
  return Object.values(buildParts(d.id, d.w, d.h) as unknown as Record<string, THREE.BufferGeometry | undefined>).filter((g): g is THREE.BufferGeometry => g instanceof THREE.BufferGeometry);
};

/** M8 lane G (render only): plane detail, bed shader. */
describe('M8 lane G: Altiport plane detail', () => {
  it('grew by at most +150 triangles over the lane D mesh (2396), is finite and deterministic, keeps its parts (no new draw call)', () => {
    const a = parts('altiport' as never), b = parts('altiport' as never);
    const t = a.reduce((s, g) => s + tris(g), 0);
    expect(t).toBeGreaterThan(2396);
    expect(t).toBeLessThanOrEqual(2396 + 150 + 40); // lane I: +34 for the larger plane (apron pad, wing tips)
    for (const g of a) expect(finite(g)).toBe(true);
    expect(a.length).toBe(b.length);
    a.forEach((g, i) => expect(geometryHash(g)).toBe(geometryHash(b[i]!)));
  });
});

describe('M8 lane G: terrain bed shader', () => {
  it('masks the lake bed by the water share and fades the rest to shore sand (drawn only, world-space noise)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/render/TerrainMesh.ts', 'utf8');
    expect(src).toContain('bedM = smoothstep(0.7, 1.0, vWet.x');
    expect(src).toContain('(1.0 - bedM) * 0.9');
  });
});

describe('M8 lane G: seamless snow / ice surfaces, sweep fixes', () => {
  it('flatUv samples ONE texel for every vertex (no seams, no tile pattern)', () => {
    const b = new PartBuilder(2, 2);
    b.cyl(0, 0, 0, 1, 0.1, 0xffffff, 'stone', 12, { flatUv: FLAT_SNOW_UV });
    const g = (b.finish() as unknown as { stone: THREE.BufferGeometry }).stone;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) { expect(uv.getX(i)).toBeCloseTo(FLAT_SNOW_UV[0], 5); expect(uv.getY(i)).toBeCloseTo(FLAT_SNOW_UV[1], 5); }
  });
  for (const id of ['kidsGround', 'snowCannon', 'iceRink', 'tackleHut', 'smallHydro']) {
    it(`${id} is finite, deterministic and in budget (<= 3400 triangles)`, () => {
      const a = parts(id as never), c = parts(id as never);
      expect(a.reduce((t, g) => t + tris(g), 0)).toBeLessThanOrEqual(3400);
      a.forEach((g, i) => { expect(finite(g)).toBe(true); expect(geometryHash(g)).toBe(geometryHash(c[i]!)); });
    });
  }
  it('Small Hydro penstock rests on its saddles (lowest part of the pipe within the saddle height) and the Tackle Hut roof shutters are slim', () => {
    const d = BUILDINGS['smallHydro' as never]!;
    const g = (buildParts(d.id, d.w, d.h) as unknown as { stone: THREE.BufferGeometry }).stone;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    let pipeMaxY = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 0.35 && pos.getZ(i) < -0.4 && pos.getZ(i) > -0.7) pipeMaxY = Math.max(pipeMaxY, pos.getY(i));
    expect(pipeMaxY).toBeLessThan(0.6); // it floated at y ~1.1 before
    const th = BUILDINGS['tackleHut' as never]!, tg = buildParts(th.id, th.w, th.h) as unknown as Record<string, THREE.BufferGeometry | undefined>;
    const box = new THREE.Box3();
    for (const v of Object.values(tg)) if (v instanceof THREE.BufferGeometry) { v.computeBoundingBox(); box.union(v.boundingBox!); }
    expect(box.max.x - box.min.x).toBeLessThan(2.4); // the 1.0-wide shutters used to push it to 2.5+
  });
});
