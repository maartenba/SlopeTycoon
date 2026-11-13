import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { COW_MOTION_GLSL, COW_PART, COW_PIVOT, bellAngle, cowPhase, earAngle, tailAngle } from '../../src/render/cowMotion';
import { createCowGeometry } from '../../src/render/meshes/Animals';
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
});
