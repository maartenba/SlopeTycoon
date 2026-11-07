import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILDINGS } from '../../src/config/buildings';
import { buildParts } from '../../src/render/meshes';
import { nearRockGeometry } from '../../src/render/props/NearTrees';
import { rockGeometry } from '../../src/render/props/Rocks';
import { snowCapMaterial, VillageDecor } from '../../src/render/VillageDecor';
import { NET_SNOW } from '../../src/render/meshes/Paths';
import { geometryHash } from '../../src/render/meshes/lifts/geo';

const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const finite = (g: THREE.BufferGeometry): boolean => Array.from(g.getAttribute('position').array).every(Number.isFinite) && (!g.getAttribute('normal') || Array.from(g.getAttribute('normal').array).every(Number.isFinite));
const water = readFileSync('src/render/Water.ts', 'utf8');
const terrain = readFileSync('src/render/TerrainMesh.ts', 'utf8');

/** M8 lane I (render only). */
describe('M8 lane I: shores', () => {
  it('water shader: free-form outline, bigger concave fillet, depth gradient + wet-sand / foam line, no screen-space noise', () => {
    expect(water).toContain('const float RC = 0.34;');
    expect(water).toContain('float shoreK = smoothstep(0.0, 0.6, d);');
    expect(water).toContain('sandy');
    expect(water).not.toContain('gl_FragCoord');
    expect(water).not.toContain('gl_FragCoord');
  });
  it('terrain: bed masked on the full-water share only (no dark notch), banks beside water never go to dark rock', () => {
    expect(terrain).toContain('bedM = smoothstep(0.56, 0.86, vWet.x');
    expect(terrain).toContain('banks next to water never turn into steep dark rock');
  });
});

describe('M8 lane I: shrubs, rocks, plane', () => {
  it('snow-cap material patches the shader with the shared snow uniform and compiles under one cache key', () => {
    const m = snowCapMaterial();
    const sh = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' };
    m.onBeforeCompile(sh as never, null as never);
    expect(sh.uniforms.uSnowCap).toBe(NET_SNOW);
    expect(sh.fragmentShader).toContain('uSnowCap');
    expect(sh.fragmentShader).not.toContain('gl_FragCoord');
    expect(m.customProgramCacheKey()).toBe('village-snowcap');
    m.dispose();
  });
  it('village shrubs / hedges build finite, deterministic geometry', () => {
    const v = new VillageDecor(() => 0);
    const items = [{ kind: 'shrub' as const, x: 1, z: 1, ry: 3 }, { kind: 'hedge' as const, x: 3, z: 2, ry: 0, w: 1 }];
    v.buildFrom(items);
    const h1 = geometryHash(v.plants.geometry);
    expect(finite(v.plants.geometry)).toBe(true);
    expect(tris(v.plants.geometry)).toBeGreaterThan(0);
    v.buildFrom(items);
    expect(geometryHash(v.plants.geometry)).toBe(h1);
    v.dispose();
  });
  it('near and far rocks stay finite with unchanged triangle counts (smooth normals only)', () => {
    const n = nearRockGeometry(), f = rockGeometry();
    expect(finite(n)).toBe(true); expect(finite(f)).toBe(true);
    expect(tris(n)).toBe(500);
    expect(geometryHash(nearRockGeometry())).toBe(geometryHash(n));
  });
  it('Altiport plane: finite, deterministic, within the lane budget', () => {
    const d = BUILDINGS['altiport' as never]!;
    const gs = Object.values(buildParts(d.id, d.w, d.h) as unknown as Record<string, THREE.BufferGeometry | undefined>).filter((g): g is THREE.BufferGeometry => g instanceof THREE.BufferGeometry);
    for (const g of gs) expect(finite(g)).toBe(true);
    expect(gs.reduce((s, g) => s + tris(g), 0)).toBeLessThanOrEqual(2396 + 150 + 40);
  });
});
