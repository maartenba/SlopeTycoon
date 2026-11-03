import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  HALF_BASE, HALF_STEP, MAX_HALF, SHADOW_MAP_SIZE, SNAP_TEXELS, fitShadowWindow, lightBasis, quantiseHalf, quantiseSun, shadowDepthRange, shadowStrength, shadowSunDir, windowCovers, fitPerspectiveWindow, perspectiveRadius,
} from '@/render/shadowFit';
import { ShadowRig } from '@/render/ShadowRig';
import { QUALITY_PRESETS } from '@/config/balance';

const SUN: [number, number, number] = [0.35, 0.83, 0.44];
const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

describe('shadow fit (pure)', () => {
  it('quantiseSun is idempotent, unit length and stays within one step of the input', () => {
    const q = quantiseSun(SUN);
    expect(Math.hypot(...q)).toBeCloseTo(1, 9);
    expect(quantiseSun(q)).toEqual(q.map((v) => v) as typeof q);
    expect(dot(q, SUN) / Math.hypot(...SUN)).toBeGreaterThan(Math.cos((0.7 * Math.PI) / 180));
  });
  it('lightBasis is orthonormal with z toward the sun', () => {
    const { right, up, z } = lightBasis(quantiseSun(SUN));
    expect(dot(right, up)).toBeCloseTo(0, 9); expect(dot(right, z)).toBeCloseTo(0, 9); expect(dot(up, z)).toBeCloseTo(0, 9);
    expect(Math.hypot(...up)).toBeCloseTo(1, 9);
  });
  it('quantiseHalf walks a geometric ladder, never below the base', () => {
    expect(quantiseHalf(1)).toBe(HALF_BASE);
    expect(quantiseHalf(HALF_BASE * HALF_STEP)).toBeCloseTo(HALF_BASE * HALF_STEP, 9);
    for (const n of [11, 30, 77.7, 100]) { const h = quantiseHalf(n); expect(h).toBeGreaterThanOrEqual(n); expect(h / HALF_STEP).toBeLessThan(Math.max(n, HALF_BASE) + 1e-6); }
  });
  it('window centre is texel snapped: panning by less than a cell keeps the exact same window (no swimming)', () => {
    const q = quantiseSun(SUN);
    const a = fitShadowWindow(q, [40, 5, 50], 25)!;
    expect(a).not.toBeNull();
    const cell = a.texel * SNAP_TEXELS;
    expect(Math.abs(a.u / cell - Math.round(a.u / cell))).toBeLessThan(1e-9);
    expect(Math.abs(a.v / cell - Math.round(a.v / cell))).toBeLessThan(1e-9);
    // a pan by a fraction of a cell may land on the same or the next cell, never in between
    for (const d of [0.001, 0.2, 0.49]) {
      const b = fitShadowWindow(q, [40 + d, 5, 50], 25)!;
      expect(b.half).toBe(a.half);
      expect(Math.abs((b.u - a.u) / cell - Math.round((b.u - a.u) / cell))).toBeLessThan(1e-9);
    }
  });
  it('the window covers the footprint it was fitted for and rotation (a circle radius) cannot change it', () => {
    const w = fitShadowWindow(quantiseSun(SUN), [10, 2, -20], 30)!;
    expect(windowCovers(w, [10, 2, -20], 30)).toBe(true);
    expect(windowCovers(w, [10 + 200, 2, -20], 30)).toBe(false);
  });
  it('shadows switch off (null window) when the view is too wide', () => {
    expect(fitShadowWindow(quantiseSun(SUN), [0, 0, 0], MAX_HALF)).toBeNull();
    expect(fitShadowWindow(quantiseSun(SUN), [0, 0, 0], 20)).not.toBeNull();
  });
  it('texel size matches the map size', () => {
    const w = fitShadowWindow(quantiseSun(SUN), [0, 0, 0], 20)!;
    expect(w.texel).toBeCloseTo((2 * w.half) / SHADOW_MAP_SIZE, 12);
  });
  it('depth range is finite, positive and ordered', () => {
    const w = fitShadowWindow(quantiseSun(SUN), [0, 0, 0], 40)!;
    const r = shadowDepthRange(w, -3, 30);
    for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
    expect(r.near).toBeGreaterThan(0); expect(r.far).toBeGreaterThan(r.dist); expect(r.near).toBeLessThan(r.dist);
  });
  it('shadowSunDir lowers the sun but stays a unit vector with the same azimuth', () => {
    const d = shadowSunDir(SUN);
    expect(Math.hypot(...d)).toBeCloseTo(1, 9);
    expect(d[1]).toBeLessThan(SUN[1] / Math.hypot(...SUN));
    expect(Math.atan2(d[2], d[0])).toBeCloseTo(Math.atan2(SUN[2], SUN[0]), 9);
  });
  it('shadowSunDir never gets flatter than the minimum slope (no 10x-long dawn / dusk shadows)', () => {
    for (const el of [0.01, 0.05, 0.15, 0.4, 0.9]) {
      const h = Math.sqrt(1 - el * el), d = shadowSunDir([h * 0.8, el, h * 0.6]);
      const horiz = Math.hypot(d[0], d[2]);
      expect(d[1] / horiz).toBeGreaterThanOrEqual(0.3 - 1e-9);
      expect(Math.hypot(...d)).toBeCloseTo(1, 9);
    }
  });
  it('strength fades with night, weather and a grazing sun, never NaN', () => {
    expect(shadowStrength(0, 0, 0.8)).toBeGreaterThan(0.9);
    expect(shadowStrength(1, 0, 0.8)).toBe(0);
    expect(shadowStrength(0.5, 0, 0.8)).toBeLessThan(shadowStrength(0.2, 0, 0.8));
    expect(shadowStrength(0, 1, 0.8)).toBeLessThan(shadowStrength(0, 0, 0.8));
    expect(shadowStrength(0, 0, 0.05)).toBeLessThan(shadowStrength(0, 0, 0.8));
    // lane E: a grazing dusk sun (real elevation ~0.1) draws clearly fainter shadows than a high one, and the cast direction is never flatter than ~22 degrees
    expect(shadowStrength(0, 0, 0.1)).toBeLessThan(shadowStrength(0, 0, 0.8) * 0.6);
    expect(shadowSunDir([1, 0.02, 0])[1]).toBeGreaterThan(0.36);
    for (const n of [-1, 0, 0.3, 1, 2]) for (const o of [-1, 0, 0.5, 2]) expect(Number.isNaN(shadowStrength(n, o, 0.5))).toBe(false);
  });
});

const fakeGl = (): THREE.WebGLRenderer => ({ render: () => {}, outputColorSpace: THREE.SRGBColorSpace, getRenderTarget: () => null, setRenderTarget: () => {}, clear: () => {} }) as unknown as THREE.WebGLRenderer;

describe('perspective fit (ride / photo / walk)', () => {
  const q = quantiseSun(SUN);
  it('radius grows with eye height, is finite for bad input and capped', () => {
    expect(perspectiveRadius(0)).toBeLessThan(perspectiveRadius(30));
    expect(perspectiveRadius(1e9)).toBeLessThanOrEqual(90);
    expect(perspectiveRadius(NaN)).toBe(perspectiveRadius(0));
    expect(perspectiveRadius(-5)).toBe(perspectiveRadius(0));
  });
  it('covers the near slice around the camera, texel snapped, no NaN', () => {
    const w = fitPerspectiveWindow(q, [40.3, 6, 21.7], 4, 2048)!;
    expect(w).not.toBeNull();
    for (const v of [w.u, w.v, w.half, w.texel, w.w]) expect(Number.isFinite(v)).toBe(true);
    expect(windowCovers(w, [40.3, 4, 21.7], perspectiveRadius(2))).toBe(true);
    const cell = w.texel * SNAP_TEXELS;
    expect(Math.abs(w.u / cell - Math.round(w.u / cell))).toBeLessThan(1e-6);
    expect(w.half).toBeLessThanOrEqual(MAX_HALF);
  });
  it('is yaw / pitch independent (it only depends on the camera position) and keeps the same lattice when it refits', () => {
    const a = fitPerspectiveWindow(q, [40.3, 6, 21.7], 4)!, b = fitPerspectiveWindow(q, [40.3, 6, 21.7], 4)!;
    expect(a).toEqual(b);
    const c = fitPerspectiveWindow(q, [70.1, 6, 40.2], 4)!; // a refit far away: same half, so the shadow texels stay on the same lattice
    expect(c.half).toBe(a.half);
    const cell = a.texel * SNAP_TEXELS;
    expect(Math.abs((c.u - a.u) / cell - Math.round((c.u - a.u) / cell))).toBeLessThan(1e-6);
  });
  it('a gondola high above the ground still fits under MAX_HALF', () => {
    expect(fitPerspectiveWindow(q, [100, 60, 100], 20)).not.toBeNull();
  });
});

describe('receiver adoption (tier gating)', () => {
  const lambert = (): THREE.MeshLambertMaterial => {
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
    m.onBeforeCompile = (s): void => { s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n/*own*/'); };
    m.customProgramCacheKey = (): string => 'own-key';
    return m;
  };
  it('Lambert materials are untouched until High, patched + defined on High, and restored exactly when High goes off', () => {
    const scene = new THREE.Scene();
    const m = lambert(), orig = m.onBeforeCompile, key = m.customProgramCacheKey;
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m));
    const rig = new ShadowRig(fakeGl(), scene);
    expect(m.onBeforeCompile).toBe(orig);
    rig.setEnabled(true);
    expect(m.onBeforeCompile).not.toBe(orig);
    expect(m.defines && 'USE_SHADOWS' in m.defines).toBe(true);
    expect(m.customProgramCacheKey()).toBe('own-key|sunrecv');
    const sh = { vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <aomap_fragment>', uniforms: {} as Record<string, unknown> };
    (m.onBeforeCompile as (s: unknown, r: unknown) => void)(sh, null);
    expect(sh.fragmentShader).toContain('/*own*/'); // the material's own patch still runs
    expect(sh.fragmentShader).toContain('recvShadow(vSWp');
    expect(sh.vertexShader).toContain('vSWp = ');
    expect(sh.uniforms).toHaveProperty('tShadow');
    rig.setEnabled(false);
    expect(m.onBeforeCompile).toBe(orig);
    expect(m.customProgramCacheKey).toBe(key);
    expect(m.defines === undefined || !('USE_SHADOWS' in m.defines)).toBe(true);
    rig.dispose();
  });
  it('transparent materials, noShadow roots and plain ShaderMaterials are not adopted; flagged ShaderMaterials are', () => {
    const scene = new THREE.Scene();
    const tr = new THREE.MeshLambertMaterial({ transparent: true }), plain = new THREE.ShaderMaterial({ uniforms: {} });
    const flagged = new THREE.ShaderMaterial({ uniforms: {} }); flagged.userData.shadowRecv = true;
    const hidden = new THREE.MeshLambertMaterial(), g = new THREE.Group(); g.userData.noShadow = true;
    const mk = (m: THREE.Material): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);
    scene.add(mk(tr), mk(plain), mk(flagged)); g.add(mk(hidden)); scene.add(g);
    const rig = new ShadowRig(fakeGl(), scene);
    rig.setEnabled(true);
    for (const m of [tr, plain, hidden]) expect('USE_SHADOWS' in ((m as THREE.ShaderMaterial).defines ?? {})).toBe(false);
    expect('USE_SHADOWS' in (flagged.defines ?? {})).toBe(true);
    expect(flagged.uniforms.uShadowM).toBe(rig.uniforms.uShadowM);
    rig.setEnabled(false);
    expect('USE_SHADOWS' in (flagged.defines ?? {})).toBe(false);
    rig.dispose();
  });
});

describe('tier gating', () => {
  it('only the high preset has real shadows', () => {
    expect(QUALITY_PRESETS.low.shadows).toBe(false);
    expect(QUALITY_PRESETS.med.shadows).toBe(false);
    expect(QUALITY_PRESETS.high.shadows).toBe(true);
  });
  it('the receiver shader define follows the tier (low / med keep the original program)', () => {
    const webgl = fakeGl();
    const rig = new ShadowRig(webgl, new THREE.Scene());
    const m = new THREE.ShaderMaterial({ uniforms: {}, vertexShader: 'void main(){}', fragmentShader: 'void main(){}' });
    rig.addReceiver(m);
    expect(m.defines && 'USE_SHADOWS' in m.defines).toBeFalsy();
    rig.setEnabled(true);
    expect('USE_SHADOWS' in (m.defines ?? {})).toBe(true);
    expect(rig.uniforms.tShadow.value).not.toBeNull();
    rig.setEnabled(false);
    expect('USE_SHADOWS' in (m.defines ?? {})).toBe(false);
    expect(rig.uniforms.tShadow.value).toBeNull();
    expect(rig.uniforms.uShadowP.value.x).toBe(0);
    rig.dispose();
  });
});
