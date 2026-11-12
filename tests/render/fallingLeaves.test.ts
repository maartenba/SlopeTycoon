import { describe, expect, it } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { PropKind, PropStore } from '../../src/world/Props';
import { LEAVES } from '../../src/config/leaves';
import { FallingLeaves, autumnPhase, collectSources, fallTime, gust, leafColour, leafCountFor, leafDensity, leafPose, leafViewFade, seasonLeafStrength, stillPose, type LeafContext } from '../../src/render/FallingLeaves';

const mkProps = (): PropStore => {
  const grid = new Grid(64);
  const props = new PropStore(grid);
  for (let i = 0; i < 40; i++) props.add(i % 3 === 0 ? PropKind.Larch : i % 3 === 1 ? PropKind.Birch : PropKind.Conifer, 20 + (i % 8), 20 + Math.floor(i / 8), 0.5, 0.5, 1, 0, i);
  return props;
};
const ctx = (o: Partial<LeafContext> = {}): LeafContext => ({ season: 0.625, precip: 'none', intensity: 0, wind: 0.2, enabled: true, reduced: false, viewHeight: 30, perspective: false, focus: { x: 24, z: 22 }, bufferHeight: 1080, quality: 'high', ...o });

describe('falling leaves: pure maths', () => {
  it('seasonal curve: zero outside autumn, peak mid-autumn, fading toward winter', () => {
    for (const t of [0, 0.1, 0.3, 0.49, 0.75, 0.9, 0.999]) expect(seasonLeafStrength(t)).toBe(0);
    expect(autumnPhase(0.4)).toBe(-1);
    expect(seasonLeafStrength(0.5)).toBe(0);
    const mid = seasonLeafStrength(0.625);
    expect(mid).toBeCloseTo(1, 6);
    expect(seasonLeafStrength(0.72)).toBeLessThan(mid * 0.5);
    expect(seasonLeafStrength(0.505)).toBeLessThan(mid);
    expect(seasonLeafStrength(0.749)).toBeLessThan(0.01);
    for (let t = 0; t <= 1; t += 0.01) { const s = seasonLeafStrength(t); expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThanOrEqual(1); }
  });
  it('weather damps (rain, snow), wind lifts, never past 1 or NaN', () => {
    const dry = leafDensity(0.6, 'none', 0, 0);
    expect(leafDensity(0.6, 'rain', 1, 0)).toBeLessThan(dry);
    expect(leafDensity(0.6, 'snow', 1, 0)).toBeLessThan(leafDensity(0.6, 'rain', 1, 0));
    expect(leafDensity(0.6, 'none', 0, 1)).toBeGreaterThanOrEqual(dry);
    expect(leafDensity(0.3, 'none', 0, 1)).toBe(0);
    for (const p of ['none', 'rain', 'snow'] as const) for (const w of [0, 0.5, 1]) for (const i of [0, 0.5, 1]) { const d = leafDensity(0.63, p, i, w); expect(Number.isFinite(d)).toBe(true); expect(d).toBeLessThanOrEqual(1); }
  });
  it('a leaf falls from the crown to the ground, lies and fades, then is recycled; deterministic', () => {
    const h = 1.5, f = fallTime(3, h, 0.2);
    let last = Infinity;
    for (let a = 0.01; a < f; a += 0.05) { const p = leafPose(a, 3, h, 5, 0.2)!; expect(p.up).toBeLessThanOrEqual(last + 1e-9); last = p.up; expect(p.landed).toBe(false); expect(p.alpha).toBeLessThanOrEqual(LEAVES.alpha + 1e-9); expect(p.squash).toBeGreaterThan(0.1); }
    const g = leafPose(f + 0.1, 3, h, 5, 0.2)!;
    expect(g.landed).toBe(true); expect(g.up).toBe(0);
    expect(leafPose(f + LEAVES.groundTime + 0.01, 3, h, 5, 0.2)).toBeNull();
    expect(leafPose(-1, 3, h, 5, 0.2)).toBeNull();
    expect(leafPose(1, 3, h, 5, 0.2)).toEqual(leafPose(1, 3, h, 5, 0.2));
    expect(f).toBeGreaterThan(h / (LEAVES.fall[1] * 1.5) - 1e-9); expect(f).toBeLessThan(h / (LEAVES.fall[0]) + 1e-9);
  });
  it('wind drifts leaves downwind (+x), more with more wind; no NaN', () => {
    const calm = leafPose(1.5, 5, 2, 3, 0)!, windy = leafPose(1.5, 5, 2, 3, 1)!;
    expect(Math.abs(windy.dx - calm.dx)).toBeGreaterThan(0.1);
    for (let t = 0; t < 50; t += 0.7) { const g = gust(t); expect(g).toBeGreaterThanOrEqual(0); expect(g).toBeLessThanOrEqual(1); }
    for (let i = 0; i < 300; i++) { const p = leafPose(0.5 + (i % 7) * 0.4, i, 1.2 + (i % 5) * 0.3, i * 0.37, (i % 11) / 10); if (p) for (const v of Object.values(p)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true); }
  });
  it('reduced motion: still scatter on the ground, constant in time', () => {
    for (let i = 0; i < 50; i++) { const s = stillPose(i); expect(s.landed).toBe(true); expect(s.up).toBe(0); expect(Math.hypot(s.dx, s.dz)).toBeLessThanOrEqual(LEAVES.stillRadius + 1e-9); expect(stillPose(i)).toEqual(s); }
  });
  it('tier counts and the view fade', () => {
    expect([leafCountFor('low'), leafCountFor('med'), leafCountFor('high')]).toEqual([40, 120, 260]);
    expect(leafViewFade(30)).toBe(1); expect(leafViewFade(200)).toBe(0);
    expect(leafViewFade(85)).toBeGreaterThan(0); expect(leafViewFade(85)).toBeLessThan(1);
  });
  it('palette colours are stable and inside 0..1', () => { for (let i = 0; i < 100; i++) { const c = leafColour(i); expect(leafColour(i)).toBe(c); for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); } } });
});

describe('falling leaves: sources + layer', () => {
  it('collects only shedding trees near the focus, nearest first, capped', () => {
    const props = mkProps();
    const all = collectSources(props, 24, 22, 20, 100);
    expect(all.length).toBeGreaterThan(20); expect(all.length).toBeLessThan(40); // conifers excluded
    expect(collectSources(props, 24, 22, 20, 5)).toHaveLength(5);
    expect(collectSources(props, 60, 60, 3, 10)).toHaveLength(0);
    const d = (s: { x: number; z: number }): number => Math.hypot(s.x - 24, s.z - 22);
    for (let i = 1; i < all.length; i++) expect(d(all[i]!)).toBeGreaterThanOrEqual(d(all[i - 1]!) - 1e-9);
  });
  it('tier gating, season gating, Atmosphere Off and the view fade', () => {
    const props = mkProps();
    const run = (c: LeafContext, steps = 120): FallingLeaves => { const l = new FallingLeaves(props); for (let i = 0; i < steps; i++) l.update(1 / 30, c); return l; };
    expect(run(ctx({ quality: 'high' })).drawn).toBeGreaterThan(40);
    const lo = run(ctx({ quality: 'low' })).drawn, hi = run(ctx({ quality: 'high' })).drawn, md = run(ctx({ quality: 'med' })).drawn;
    expect(lo).toBeLessThanOrEqual(40); expect(lo).toBeLessThan(md); expect(md).toBeLessThanOrEqual(120); expect(md).toBeLessThan(hi); expect(hi).toBeLessThanOrEqual(260);
    for (const s of [0.1, 0.375, 0.8, 0.9]) { const l = run(ctx({ season: s })); expect(l.drawn).toBe(0); expect(l.mesh.visible).toBe(false); }
    const off = run(ctx({ enabled: false })); expect(off.drawn).toBe(0); expect(off.mesh.visible).toBe(false);
    expect(run(ctx({ viewHeight: 200 })).drawn).toBe(0);
    expect(run(ctx({ precip: 'snow', intensity: 1 })).drawn).toBeLessThan(hi);
    expect(run(ctx({ force: 30, season: 0.1 })).drawn).toBeGreaterThan(5); // QA force ignores the season
  });
  it('deterministic under a fixed clock; reduced motion is static; positions finite and above ground', () => {
    const props = mkProps();
    const a = new FallingLeaves(props), b = new FallingLeaves(props);
    for (let i = 0; i < 200; i++) { a.update(1 / 30, ctx()); b.update(1 / 30, ctx()); }
    expect(Array.from(a.geo.getAttribute('aPos').array.slice(0, 300))).toEqual(Array.from(b.geo.getAttribute('aPos').array.slice(0, 300)));
    for (const v of a.geo.getAttribute('aPos').array) expect(Number.isFinite(v)).toBe(true);
    for (const v of a.geo.getAttribute('aInfo').array) expect(Number.isFinite(v)).toBe(true);
    const r1 = new FallingLeaves(props), r2 = new FallingLeaves(props);
    r1.update(0.016, ctx({ reduced: true })); for (let i = 0; i < 100; i++) r2.update(0.1, ctx({ reduced: true }));
    expect(r1.drawn).toBeGreaterThan(20); expect(r2.drawn).toBe(r1.drawn);
    expect(Array.from(r1.geo.getAttribute('aPos').array.slice(0, 90))).toEqual(Array.from(r2.geo.getAttribute('aPos').array.slice(0, 90)));
  });
  it('is one instanced draw: a single mesh, never more instances than the largest tier', () => {
    const l = new FallingLeaves(mkProps());
    expect(l.group.children).toHaveLength(1); expect(l.capacity).toBe(260); expect(l.geo.instanceCount).toBe(260);
  });
});
