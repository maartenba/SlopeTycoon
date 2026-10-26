import { describe, expect, it } from 'vitest';
import { Layer } from '../../src/world/Networks';
import { difficultyFromMask, fillGroundMask, pisteWeight, sampleMask } from '../../src/render/groundMask';
import { layoutVillage } from '../../src/render/VillageDecor';
import { decorCircles } from '../../src/render/view/WalkMode';
import { CABLE_RADIUS } from '../../src/render/meshes/lifts/Cable';
import { C } from '../../src/render/meshes/common';
import { lightingAt, luminance } from '../../src/render/Lighting';

const N = 16;
const mkNet = (): { size: number; layers: Uint8Array; difficulty: Uint8Array } => ({ size: N, layers: new Uint8Array(N * N), difficulty: new Uint8Array(N * N) });
const sat = (hex: number): number => { const r = (hex >> 16) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255, mx = Math.max(r, g, b); return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx; };

describe('ground mask (soft piste / trail / contact data)', () => {
  const net = mkNet();
  for (let y = 2; y < 12; y++) { net.layers[y * N + 8] = Layer.Ski; net.difficulty[y * N + 8] = 2; }
  net.layers[5 * N + 3] = Layer.Mtb;
  const data = new Uint8Array(N * N * 4);
  fillGroundMask(data, net, [{ x: 12, y: 12, w: 2, h: 2 }]);

  it('maps layers to channels and footprints to alpha', () => {
    expect(data[(5 * N + 8) * 4]).toBe(255);
    expect(data[(5 * N + 3) * 4 + 1]).toBe(255);
    expect(data[(5 * N + 3) * 4]).toBe(0);
    expect(data[(12 * N + 12) * 4 + 3]).toBe(255);
    expect(data[(5 * N + 8) * 4 + 3]).toBe(0);
  });
  it('bilinear smoothing: 1 on the run centre, monotone fall-off to 0 over one tile, no hard step', () => {
    const v = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((d) => sampleMask(data, N, 0, 8.5 + d, 6.5));
    expect(v[0]).toBeCloseTo(1, 5);
    for (let i = 1; i < v.length; i++) expect(v[i]!).toBeLessThan(v[i - 1]!);
    expect(sampleMask(data, N, 0, 9.5, 6.5)).toBeCloseTo(0, 5);
    expect(sampleMask(data, N, 0, 3.5, 6.5)).toBe(0);
    // the edge band is genuinely soft: the weight passes through intermediate values
    const w = [0.15, 0.25, 0.35, 0.45].map((d) => pisteWeight(sampleMask(data, N, 0, 8.5 + d, 6.5)));
    expect(w.some((x) => x > 0.05 && x < 0.95)).toBe(true);
    expect(pisteWeight(0)).toBe(0); expect(pisteWeight(1)).toBe(1);
  });
  it('difficulty survives bilinear blending (premultiplied channel)', () => {
    const ski = sampleMask(data, N, 0, 8.8, 6.5), pre = sampleMask(data, N, 2, 8.8, 6.5);
    expect(difficultyFromMask(ski, pre)).toBe(2);
    expect(difficultyFromMask(0, 0)).toBe(-1);
  });
  it('contact mask is non-zero only on / near footprints', () => {
    expect(sampleMask(data, N, 3, 13, 13)).toBe(1);
    expect(sampleMask(data, N, 3, 2, 2)).toBe(0);
  });
});

describe('village layout: plaza + gardens', () => {
  const lodge = { x: 30, y: 20, w: 4, h: 3 };
  const homes = [{ x: 24, y: 28, w: 3, h: 3 }, { x: 38, y: 27, w: 3, h: 4 }];
  const free = { size: 64, blocked: () => false };
  it('adds a fountain, cobbles, awnings and garden items, deterministically', () => {
    const a = layoutVillage(lodge, free, homes), b = layoutVillage(lodge, free, homes);
    expect(a).toEqual(b);
    const kinds = new Set(a.map((i) => i.kind));
    for (const k of ['fountain', 'cobble', 'awning', 'tree', 'bed', 'fence', 'shrub']) expect(kinds.has(k as never)).toBe(true);
  });
  it('never draws a decorative parking lot (a grey pad with no road read as a broken, unconnected Parking building)', () => {
    const kinds = new Set(layoutVillage(lodge, free, homes).map((i) => i.kind as string));
    expect(kinds.has('lot')).toBe(false);
    expect(kinds.has('stall')).toBe(false);
  });
  it('respects occupancy: nothing is placed on blocked tiles (single-point items)', () => {
    const blocked = (i: number): boolean => i % 64 >= 36;
    for (const it of layoutVillage(lodge, { size: 64, blocked }, homes)) {
      if (it.kind === 'cobble' || it.kind === 'fence' || it.kind === 'lot') continue;
      expect(blocked(Math.floor(it.z) * 64 + Math.floor(it.x))).toBe(false);
    }
  });
  it('solid decor gets walk collision circles, flat decor does not', () => {
    const items = layoutVillage(lodge, free, homes);
    const circles = decorCircles(items.filter((i) => i.kind === 'fountain'));
    expect(circles.length).toBeGreaterThan(0);
    expect(decorCircles(items.filter((i) => i.kind === 'cobble' || i.kind === 'bed' || i.kind === 'fence'))).toHaveLength(0);
  });
  it('plaza on existing paths: a fountain still fits when only paths (not solids) are in the way', () => {
    const items = layoutVillage(lodge, { size: 64, blocked: () => true, solid: () => false }, []);
    expect(items.filter((i) => i.kind === 'fountain')).toHaveLength(1);
    expect(layoutVillage(lodge, { size: 64, blocked: () => true, solid: () => true }, []).some((i) => i.kind === 'fountain')).toBe(false);
  });
  it('without homes the layout is the lodge-only village (+ square)', () => {
    expect(layoutVillage(lodge, free).some((i) => i.kind === 'tree')).toBe(false);
  });
});

describe('calmer look', () => {
  it('cable strands are never thinner than 0.03 tiles', () => { expect(CABLE_RADIUS).toBeGreaterThanOrEqual(0.03); expect(CABLE_RADIUS).toBeLessThanOrEqual(0.045); });
  it('roof colours are softened (saturation <= 0.6; was up to 0.77)', () => {
    for (const k of ['roofRed', 'roofBlue', 'roofBrown', 'roofGreen'] as const) expect(sat(C[k])).toBeLessThanOrEqual(0.6);
  });
  it('noon shader lighting keeps a soft ambient share (ambient >= 45 % of sun luminance)', () => {
    const p = lightingAt(12);
    expect(luminance(p.shaderSky)).toBeGreaterThan(0.45 * luminance(p.shaderSun));
  });
});
