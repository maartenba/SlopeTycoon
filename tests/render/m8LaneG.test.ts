import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { buildParts } from '../../src/render/meshes';
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
    expect(t).toBeLessThanOrEqual(2396 + 150);
    for (const g of a) expect(finite(g)).toBe(true);
    expect(a.length).toBe(b.length);
    a.forEach((g, i) => expect(geometryHash(g)).toBe(geometryHash(b[i]!)));
  });
});

describe('M8 lane G: terrain bed shader', () => {
  it('masks the lake bed by the water share and fades the rest to shore sand (drawn only, world-space noise)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/render/TerrainMesh.ts', 'utf8');
    expect(src).toContain('bedM = smoothstep(0.36, 0.62, vWet.x');
    expect(src).toContain('(1.0 - bedM) * 0.9');
  });
});
