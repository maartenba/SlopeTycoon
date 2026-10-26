import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BuildingMeshes } from '@/render/meshes';
import { MaterialGuard, type GuardRenderer } from '@/render/MaterialGuard';

function resolve(src: string): string {
  let out = src;
  for (let i = 0; i < 20 && /#include </.test(out); i++) {
    out = out.replace(/#include <([\w/]+)>/g, (_m, n: string) => (THREE.ShaderChunk as Record<string, string>)[n] ?? `@@UNRESOLVED:${n}@@`);
  }
  return out;
}
const balanced = (s: string, a: string, b: string): boolean => s.split(a).length === s.split(b).length;

describe('patched building shaders (string-level sanity, no GL)', () => {
  const meshes = new BuildingMeshes();
  const g = meshes.create('baseLodge');
  const mats = g.children.map((c) => (c as THREE.Mesh).material as THREE.MeshLambertMaterial).filter((m) => m.vertexColors);

  it('has patched materials', () => { expect(mats.length).toBeGreaterThan(0); });

  for (const variant of ['USE_COLOR', 'USE_COLOR_ALPHA']) {
    it(`fragment compiles textually with ${variant} (vColor may be vec3 or vec4)`, () => {
      for (const m of mats) {
        const sh = { uniforms: {} as Record<string, unknown>, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
        const origF = resolve(sh.fragmentShader);
        m.onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer);
        const f = resolve(sh.fragmentShader), v = resolve(sh.vertexShader);
        expect(f).not.toContain('@@UNRESOLVED');
        expect(v).not.toContain('@@UNRESOLVED');
        expect(balanced(f, '{', '}') && balanced(f, '(', ')')).toBe(true);
        expect(balanced(v, '{', '}')).toBe(true);
        // Every line we injected must treat vColor as swizzled (r186 declares vec4 under USE_COLOR_ALPHA).
        const orig = new Set(origF.split('\n'));
        const injected = f.split('\n').filter((l) => !orig.has(l));
        expect(injected.length).toBeGreaterThan(0);
        for (const l of injected) expect(l).not.toMatch(/vColor(?!\.)/);
        // Declared uniforms/varyings are unique and the vertex shader provides every varying we read.
        const decl = (s: string, kw: string): string[] => [...s.matchAll(new RegExp(`^${kw} \\w+ (\\w+);`, 'gm'))].map((x) => x[1]!);
        for (const kw of ['uniform', 'varying']) { const d = decl(f, kw); expect(new Set(d).size).toBe(d.length); }
        expect(v).toMatch(/varying float vUp;/);
        expect(f).toMatch(/varying float vUp;/);
        void variant;
      }
    });
  }
});

describe('MaterialGuard', () => {
  it('reports a failed program and falls back the patch of built-in materials', () => {
    const scene = new THREE.Scene();
    const bad = new THREE.MeshLambertMaterial();
    let patched = true;
    bad.onBeforeCompile = (): void => { patched = true; };
    const sm = new THREE.ShaderMaterial();
    const ok = new THREE.MeshBasicMaterial();
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), bad), new THREE.Mesh(new THREE.BufferGeometry(), sm), new THREE.Mesh(new THREE.BufferGeometry(), ok));
    const fail = { currentProgram: { diagnostics: { runnable: false, programLog: 'boom' } } };
    const gl: GuardRenderer = { debug: { onShaderError: null }, properties: { get: (m) => (m === bad || m === sm ? fail : {}) } };
    const guard = new MaterialGuard(gl, scene, 1);
    const seen: string[] = [];
    guard.onProblem = (p): void => { seen.push(p.material); };
    const err = console.error; console.error = (): void => {};
    guard.tick(); guard.tick();
    console.error = err;
    expect(guard.count).toBe(2);
    expect(seen.sort()).toEqual(['MeshLambertMaterial', 'ShaderMaterial']);
    expect(guard.summary()).toContain('Render problems: 2');
    patched = false;
    bad.onBeforeCompile({} as never, null as never);
    expect(patched).toBe(false); // patch removed
    expect([...guard.problems.values()].find((p) => p.material === 'ShaderMaterial')?.fallback).toBe(false);
  });
});
