import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { APRES_NOTES as A, ApresNotesView, beatPhase, beatPulse, hash01, noteState, notesForQuality, stepLevel, viewFade } from '../../src/render/ApresNotes';

describe('apres notes (pure animation)', () => {
  it('is deterministic: same id / time / index => same state; different bars differ', () => {
    expect(noteState(12.3, 7, 2, 6)).toEqual(noteState(12.3, 7, 2, 6));
    expect(noteState(12.3, 7, 2, 6)).not.toEqual(noteState(12.3, 8, 2, 6));
    expect(hash01(5, 9)).toBe(hash01(5, 9));
  });
  it('notes rise, fade in and out, stay near the roof', () => {
    let maxY = 0, seen = 0;
    for (let t = 0; t < 40; t += 0.05) { const s = noteState(t, 3, 0, 6); if (!s) continue; seen++; maxY = Math.max(maxY, s.dy); expect(s.alpha).toBeGreaterThan(0); expect(s.alpha).toBeLessThanOrEqual(A.alpha + 1e-9); expect(Math.abs(s.dx)).toBeLessThanOrEqual(A.spread + A.sway + 1e-9); expect(s.dy).toBeGreaterThanOrEqual(0); expect(s.dy).toBeLessThanOrEqual(A.rise + 1e-9); }
    expect(seen).toBeGreaterThan(0); expect(maxY).toBeGreaterThan(A.rise * 0.5);
  });
  it('the beat pulse peaks on the beat, decays to ~0 and repeats every 60 / bpm seconds; reduced motion = 0', () => {
    const beat = 60 / A.bpm;
    expect(beatPulse(0, 0)).toBeCloseTo(1, 6);
    expect(beatPulse(beat, 0)).toBeCloseTo(1, 6);
    expect(beatPulse(beat * 0.5, 0)).toBeCloseTo(0.125, 6);
    expect(beatPulse(beat * 0.99, 0)).toBeLessThan(0.01);
    expect(beatPhase(beat * 3.25, 0)).toBeCloseTo(0.25, 6);
    for (let t = 0; t < 5; t += 0.07) { expect(beatPulse(t, 0.3)).toBeGreaterThanOrEqual(0); expect(beatPulse(t, 0.3)).toBeLessThanOrEqual(1); expect(beatPulse(t, 0.3, true)).toBe(0); }
  });
  it('reduced motion is static: same notes at any time, no pulse', () => {
    const a = [0, 1, 2].map((i) => noteState(0, 4, i, 6, true)), b = [0, 1, 2].map((i) => noteState(99.7, 4, i, 6, true));
    expect(a).toEqual(b); expect(a.every((s) => !!s)).toBe(true);
    expect(noteState(0, 4, 3, 6, true)).toBeNull();
  });
  it('open / closed gating: the level fades in and out, never past 0..1', () => {
    let l = 0; for (let i = 0; i < 100; i++) l = stepLevel(l, true, 0.05); expect(l).toBe(1);
    for (let i = 0; i < 100; i++) l = stepLevel(l, false, 0.05); expect(l).toBe(0);
    expect(stepLevel(0, true, A.fade / 2)).toBeCloseTo(0.5, 6);
  });
  it('quality tiers and the camera distance', () => {
    expect(notesForQuality(0.35)).toBe(2); expect(notesForQuality(0.7)).toBe(4); expect(notesForQuality(1)).toBe(6); expect(notesForQuality(0)).toBe(0);
    expect(viewFade(A.nearView)).toBe(1); expect(viewFade(A.farView)).toBe(0); expect(viewFade(60)).toBeGreaterThan(0); expect(viewFade(60)).toBeLessThan(1);
  });
  it('the view: nothing when closed or far, notes when open and near, none after it closes, one mesh (one draw call)', () => {
    const v = new ApresNotesView(); const bars = [{ id: 1, x: 5, y: 2, z: 5 }];
    expect(v.group.children.length).toBe(1); expect(v.mesh).toBeInstanceOf(THREE.Mesh);
    v.update(0.1, 30, [], false, 6); expect(v.drawn).toBe(0); expect(v.mesh.visible).toBe(false);
    for (let i = 0; i < 40; i++) v.update(0.1, 30, bars, false, 6); expect(v.drawn).toBeGreaterThan(0); expect(v.drawn).toBeLessThanOrEqual(6); expect(v.mesh.visible).toBe(true);
    v.update(0.1, 90, bars, false, 6); expect(v.drawn).toBe(0);
    v.update(0.1, 30, bars, false, 0); expect(v.drawn).toBe(0);
    for (let i = 0; i < 40; i++) v.update(0.1, 30, bars, true, 6); expect(v.drawn).toBe(3);
    for (let i = 0; i < 40; i++) v.update(0.1, 30, [], false, 6); expect(v.drawn).toBe(0); expect(v.mesh.visible).toBe(false);
  });
});

import { pennantSway as _ps, glowPulse as _gp, coneThrob as _ct, APRES_NOTES as _AN } from '../../src/render/ApresNotes';
describe('apres decoration extras (pure)', () => {
  it('sway is bounded, deterministic, differs per building, zero under reduced motion', () => {
    for (let t = 0; t < 20; t += 0.37) { const v = _ps(t, 7, 3); expect(Math.abs(v)).toBeLessThanOrEqual(_AN.pennantSway + 1e-9); expect(v).toBe(_ps(t, 7, 3)); expect(_ps(t, 7, 3, true)).toBe(0); }
    expect(_ps(1.3, 7, 3)).not.toBe(_ps(1.3, 8, 3));
  });
  it('glow pulses at the bar beat within its depth and is steady when reduced', () => {
    const beat = 60 / _AN.bpm; let lo = 9, hi = -9;
    for (let t = 0; t < beat; t += beat / 50) { const g = _gp(t, 5); lo = Math.min(lo, g); hi = Math.max(hi, g); expect(g).toBeGreaterThan(0); expect(g).toBeLessThanOrEqual(1 + 1e-9); expect(_gp(t + beat, 5)).toBeCloseTo(g, 6); }
    expect(hi - lo).toBeGreaterThan(_AN.glowDepth * 0.8);
    expect(_gp(0, 5, true)).toBe(_gp(9, 5, true));
  });
  it('throb peaks at the beat, decays, rests at 1 when reduced; no NaN', () => {
    for (let t = 0; t < 10; t += 0.13) { const v = _ct(t, 3); expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(1 + _AN.coneDepth + 1e-9); expect(_ct(t, 3, true)).toBe(1); }
  });
});

describe('apres decoration extras in the layer', () => {
  it('extras add one glow + pennants per open bar (Medium / High), none on Low, still under reduced motion; no NaN', () => {
    const bar = [{ id: 3, x: 10, y: 2, z: 10, type: 'apresBar', yaw: 0.4 }];
    const count = (extras: boolean, reduced = false): { n: number; kinds: number[] } => {
      const v = new ApresNotesView();
      for (let i = 0; i < 20; i++) v.update(0.1, 20, bar, reduced, 4, undefined, extras);
      const info = (v.geo as unknown as { getAttribute(n: string): { array: Float32Array } }).getAttribute('aInfo').array, kinds: number[] = [];
      for (let j = 0; j < v.drawn; j++) { kinds.push(info[j * 4 + 3]!); for (let q = 0; q < 4; q++) expect(Number.isFinite(info[j * 4 + q])).toBe(true); }
      return { n: v.drawn, kinds };
    };
    const lo = count(false), hi = count(true);
    expect(lo.kinds.every((k) => k === 0)).toBe(true);
    expect(hi.kinds.filter((k) => k === 1).length).toBe(1);
    expect(hi.kinds.filter((k) => k === 2).length).toBe(_AN.pennants);
    expect(hi.n).toBeGreaterThan(lo.n);
    const a = count(true, true), b = count(true, true);
    expect(a).toEqual(b);
  });
});
