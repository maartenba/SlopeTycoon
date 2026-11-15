import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { COW_MOTION_GLSL, COW_PART, COW_PIVOT, GOAT_PIVOT, MOTION_SCALE, SHEEP_PIVOT, bellAngle, cowPhase, earAngle, motionFade, motionGlsl, tailAngle } from '../../src/render/cowMotion';
import { createCowGeometry, createGoatGeometry, createSheepGeometry } from '../../src/render/meshes/Animals';
import { NatureView } from '../../src/render/NatureView';

describe('cow micro-animation', () => {
  it('phase is a stable hash of the id in [0, 2pi) and varies', () => {
    const s = new Set<string>();
    for (let id = 0; id < 200; id++) { const p = cowPhase(id); expect(p).toBe(cowPhase(id)); expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(Math.PI * 2 + 1e-9); s.add(p.toFixed(3)); }
    expect(s.size).toBeGreaterThan(150);
  });
  it('angles are finite, bounded and actually move', () => {
    let tMax = 0, eMax = 0, bMax = 0, tMin = 9, bMin = 9;
    for (let t = 0; t < 120; t += 0.05) {
      const ph = cowPhase(7), ta = tailAngle(t, ph), ea = earAngle(t, ph, 1), er = earAngle(t, ph, -1), ba = bellAngle(t, ph);
      for (const v of [ta, ea, er, ba]) expect(Number.isFinite(v)).toBe(true);
      tMax = Math.max(tMax, Math.abs(ta)); eMax = Math.max(eMax, Math.abs(ea)); bMax = Math.max(bMax, Math.abs(ba)); tMin = Math.min(tMin, Math.abs(ta)); bMin = Math.min(bMin, Math.abs(ba));
    }
    expect(tMax).toBeGreaterThan(0.2); expect(tMax).toBeLessThan(0.8);
    expect(eMax).toBeGreaterThan(0.1); expect(eMax).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(bMax).toBeGreaterThan(0.1); expect(bMax).toBeLessThan(0.25);
    expect(tMin).toBeLessThan(0.05); expect(bMin).toBeLessThan(0.05);
  });
  it('ears twitch only now and then (mostly still)', () => {
    let still = 0, n = 0;
    for (let t = 0; t < 200; t += 0.1) { n++; if (Math.abs(earAngle(t, 1.2, 1)) < 0.02) still++; }
    expect(still / n).toBeGreaterThan(0.6);
  });
  it('the animated cow keeps the triangle budget, tags every vertex, and the parts sit at their pivots', () => {
    const g = createCowGeometry(true, true), plain = createCowGeometry();
    expect(g.getAttribute('position').count).toBe(plain.getAttribute('position').count);
    expect(g.getAttribute('position').count / 3).toBeLessThanOrEqual(900);
    const part = g.getAttribute('aPart'), pos = g.getAttribute('position'); expect(part.count).toBe(pos.count);
    const seen = new Set<number>(); for (let i = 0; i < part.count; i++) seen.add(part.getX(i));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
    const box = (id: number): THREE.Box3 => { const b = new THREE.Box3(); for (let i = 0; i < part.count; i++) if (part.getX(i) === id) b.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, i)); return b; };
    for (const [id, key] of [[COW_PART.tail, 'tail'], [COW_PART.earL, 'earL'], [COW_PART.earR, 'earR'], [COW_PART.bell, 'bell']] as const) {
      const b = box(id), p = COW_PIVOT[key], pv = new THREE.Vector3(...p);
      expect(b.clone().expandByScalar(0.06).containsPoint(pv), key).toBe(true);
    }
    expect(COW_MOTION_GLSL.apply).toContain('0.36'); expect(COW_MOTION_GLSL.apply).not.toMatch(/\d\.0, \d\.\d+\.0/);
  });
  it('the cow layer stays ONE instanced draw, reduced motion zeroes the uniform', () => {
    const v = new NatureView(() => 0), m = v.meshes.get('cow')!;
    expect(m.geometry.getAttribute('aPhase')).toBeTruthy();
    v.reduced = true; v.update(0.1, [{ id: 3, species: 'cow', x: 5, y: 5, heading: 0, hidden: false, mode: 0, phase: 0 } as never], 5, 5, 30);
    expect(m.count).toBe(1);
    expect((v as unknown as { cowUniforms: { uCowMotion: { value: number } } }).cowUniforms.uCowMotion.value).toBe(0);
    v.reduced = false; v.update(0.1, [], 5, 5, 30);
    expect((v as unknown as { cowUniforms: { uCowMotion: { value: number } } }).cowUniforms.uCowMotion.value).toBe(1);
  });
  it('the normals rotate with the moving parts (same angle function, pivot-free) and the depth pass shares the material', () => {
    const g = motionGlsl(COW_PIVOT);
    expect(g.normal).toContain('objectNormal'); expect(g.normal).toContain('cmAngle()'); expect(g.apply).toContain('cmAngle()');
    expect(g.normal).toContain('cmRotX(objectNormal, vec3(0.0)'); expect(g.normal).toContain('cmRotZ(objectNormal, vec3(0.0)');
    const v = new NatureView(() => 0), mat = v.meshes.get('cow')!.material as THREE.MeshLambertMaterial;
    const sh = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <beginnormal_vertex>\n#include <begin_vertex>\nvoid main() {' };
    (mat.onBeforeCompile as (s: unknown) => void)(sh);
    expect(sh.vertexShader).toContain('objectNormal = '); expect(sh.vertexShader.indexOf('cmAngle')).toBeGreaterThan(-1);
    expect(sh.uniforms.uCowT).toBeTruthy(); // the shadow depth pass draws this very material: the cast shadow follows the animated pose
  });
  it('sheep (ears) and goats (tail) share the builder, keep their budgets, are one draw each, and move subtly', () => {
    const sheep = createSheepGeometry(true), goat = createGoatGeometry(true);
    for (const [g, parts] of [[sheep, [2, 3]], [goat, [1]]] as const) {
      const part = g.getAttribute('aPart'); const seen = new Set<number>(); for (let i = 0; i < part.count; i++) seen.add(part.getX(i));
      for (const p of parts) expect(seen.has(p)).toBe(true);
      expect(g.getAttribute('position').count / 3).toBeLessThanOrEqual(900);
    }
    expect(createSheepGeometry().getAttribute('position').count).toBe(sheep.getAttribute('position').count);
    expect(SHEEP_PIVOT.earL[0]).toBeGreaterThan(0); expect(GOAT_PIVOT.tail[2]).toBeLessThan(0); expect(MOTION_SCALE.sheep).toBeLessThanOrEqual(1);
    const v = new NatureView(() => 0); for (const sp of ['cow', 'sheep', 'goat'] as const) expect(v.meshes.get(sp)!.geometry.getAttribute('aPhase')).toBeTruthy();
  });
  it('close-zoom amplitude is visible but subtle: the tail tip swings 2-12 cm-equivalents (0.04-0.13 tiles) and the bell tip under 0.02 tiles', () => {
    let tip = 0, bell = 0; for (let t = 0; t < 60; t += 0.05) { tip = Math.max(tip, Math.abs(tailAngle(t, 1.1)) * 0.22); bell = Math.max(bell, Math.abs(bellAngle(t, 1.1)) * 0.06); }
    expect(tip).toBeGreaterThan(0.04); expect(tip).toBeLessThan(0.13); expect(bell).toBeLessThan(0.02);
  });
});

describe('far-zoom fade of the bell and tail (no 1 px shimmer)', () => {
  it('is 1 up close, 0 far away, monotone, smooth, bell before tail, finite', () => {
    for (const part of ['bell', 'tail'] as const) {
      let prev = 1.0001;
      for (let h = 0; h <= 140; h += 0.5) { const f = motionFade(h, part); expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThanOrEqual(1); expect(f).toBeLessThanOrEqual(prev + 1e-12); expect(prev - f).toBeLessThan(0.08); prev = f; }
      expect(motionFade(10, part)).toBe(1); expect(motionFade(120, part)).toBe(0);
    }
    expect(motionFade(34, 'bell')).toBeLessThan(motionFade(34, 'tail')); // the bell has already faded where the tail still swings
    expect(motionFade(NaN, 'bell')).toBe(0);
  });
  it('the view feeds the uniforms: bell 1 close, 0 at far zoom, reduced motion 0', () => {
    const v = new NatureView(() => 0), u = (): { uCowMotion: { value: number }; uCowBell: { value: number } } => (v as unknown as { cowUniforms: ReturnType<typeof u> }).cowUniforms;
    v.update(0.1, [], 5, 5, 20); expect(u().uCowBell.value).toBe(1); expect(u().uCowMotion.value).toBe(1);
    v.update(0.1, [], 5, 5, 60); expect(u().uCowBell.value).toBe(0); expect(u().uCowMotion.value).toBeGreaterThan(0);
    v.reduced = true; v.update(0.1, [], 5, 5, 20); expect(u().uCowBell.value).toBe(0);
  });
});
