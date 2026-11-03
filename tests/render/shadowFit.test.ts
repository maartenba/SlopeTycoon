import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  HALF_BASE, HALF_STEP, MAX_HALF, SHADOW_MAP_SIZE, SNAP_TEXELS, fitShadowWindow, lightBasis, quantiseHalf, quantiseSun, shadowDepthRange, shadowStrength, shadowSunDir, windowCovers,
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
    for (const n of [-1, 0, 0.3, 1, 2]) for (const o of [-1, 0, 0.5, 2]) expect(Number.isNaN(shadowStrength(n, o, 0.5))).toBe(false);
  });
});

describe('tier gating', () => {
  it('only the high preset has real shadows', () => {
    expect(QUALITY_PRESETS.low.shadows).toBe(false);
    expect(QUALITY_PRESETS.med.shadows).toBe(false);
    expect(QUALITY_PRESETS.high.shadows).toBe(true);
  });
  it('the receiver shader define follows the tier (low / med keep the original program)', () => {
    const webgl = { render: () => {}, outputColorSpace: THREE.SRGBColorSpace } as unknown as THREE.WebGLRenderer;
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
