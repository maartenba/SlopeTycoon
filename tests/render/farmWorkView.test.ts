import { describe, expect, it } from 'vitest';
import { FARM_WORK as F } from '../../src/config/farmWork';
import { FarmWorkView, type FarmWorkCtx } from '../../src/render/FarmWorkView';
import { buildWorkWorld, type FarmSite } from '../../src/render/farmWorkPlan';
import { simDayOf } from '../../src/sim/calendar';
import { Grid } from '../../src/world/Grid';

const site = (id: number, ox: number, oy: number): FarmSite => ({ id, gates: [{ x: ox + 3, y: oy + 5.9 }, { x: ox + 0.8, y: oy + 5.9 }, { x: ox + 5.2, y: oy + 5.9 }], park: [{ x: ox + 1.3, y: oy + 3.5 }, { x: ox + 4.9, y: oy + 3.5 }] });
const grid = new Grid(64);
const farms = [{ id: 1, x: 10, y: 10, w: 6, h: 5 }, { id: 2, x: 40, y: 12, w: 6, h: 5 }];
const world = buildWorkWorld(grid, farms);
const mk = (): FarmWorkView => new FarmWorkView(() => 0, () => [{ id: 1, site: site(1, 10, 10) }, { id: 2, site: site(2, 40, 12) }], () => world, 1234);
const JUN = simDayOf(6, 8), WINTER = simDayOf(0, 8);
const ctx = (o: Partial<FarmWorkCtx> = {}): FarmWorkCtx => ({ day: JUN, hour: 9, weather: 'clear', cap: 2, reduced: false, fast: false, viewHeight: 40, focus: { x: 25, z: 15 }, exhaust: true, ...o });
const run = (v: FarmWorkView, secs: number, c: FarmWorkCtx, dt = 0.05): void => { for (let t = 0; t < secs; t += dt) v.update(dt, c); };

describe('FarmWorkView', () => {
  it('shows nothing outside summer, with Atmosphere Off, and when far away', () => {
    for (const c of [ctx({ day: WINTER }), ctx({ cap: 0 })]) { const v = mk(); run(v, 5, c); expect(v.stats.tractors).toBe(0); expect(v.group.visible).toBe(false); expect(v.liveries.reduce((n, m) => n + m.count, 0)).toBe(0); }
    const v = mk(); run(v, 5, ctx({ viewHeight: 300 })); expect(v.group.visible).toBe(false);
    run(v, 2, ctx()); expect(v.group.visible).toBe(true);
  });
  it('caps tractors per farm and lets them fade in parked', () => {
    for (const cap of [1, 2]) { const v = mk(); run(v, 4, ctx({ cap })); expect(v.liveries.reduce((n, m) => n + m.count, 0)).toBe(2 * cap); expect(v.trailers.count).toBe(2 * cap); for (const s of v.snapshot()) expect(s.presence).toBe(1); }
  });
  it('starts trips in the morning and keeps every tractor off buildings', () => {
    const v = mk(); const c = ctx({ hour: 9 });
    run(v, 30, c); const seen: Array<[number, number]> = [];
    for (let i = 0; i < 400; i++) { v.update(0.1, c); for (const s of v.snapshot()) seen.push([s.x, s.y]); }
    expect(v.stats.trips).toBeGreaterThan(0);
    for (const [x, y] of seen) { const o = world.owner[Math.floor(y) * 64 + Math.floor(x)]!; expect(o === 0 || o === 1 + 1 || o === 2 + 1, `${x},${y}`).toBe(true); }
    expect(v.working().length).toBeGreaterThan(0);
  });
  it('keeps tractors parked at night, in rain and at fast speed', () => {
    for (const c of [ctx({ hour: 22 }), ctx({ weather: 'rain' }), ctx({ fast: true }), ctx({ reduced: true }), ctx({ hour: 12.5 })]) { const v = mk(); run(v, 40, c); expect(v.stats.trips).toBe(0); expect(v.working().length).toBe(0); }
  });
  it('sends working tractors home in rain and at the end of the day, carrying the load', () => {
    for (const bad of [ctx({ weather: 'storm' }), ctx({ hour: 18 })]) {
      const v = mk(); v.force({ day: JUN, hour: 10, at: ['mowB', 'mowB'] }); run(v, 1, ctx()); expect(v.working().length).toBe(4);
      v.force(null); // released with trips running: the natural rules apply again
      run(v, 200, bad); expect(v.working().length).toBe(0);
    }
  });
  it('force() places tractors mid-trip with a load, bales and stripes', () => {
    const v = mk(); v.force({ day: JUN, hour: 10, at: ['mowA', 'mowB'] }); run(v, 1, ctx());
    const s = v.snapshot(); expect(s.filter((t) => t.onTrip).length).toBe(4); expect(v.stats.stripes).toBeGreaterThan(0);
    expect(Math.max(...s.map((t) => t.load))).toBeGreaterThan(0.3);
    run(v, 1, ctx()); expect(v.bales.count).toBeGreaterThan(0);
  });
  it('is frame-rate independent and deterministic', () => {
    const a = mk(), b = mk(), c = ctx();
    for (const v of [a, b]) v.force({ day: JUN, hour: 10, at: [0.3, 0.6] });
    run(a, 12, c, 0.05); run(b, 12, c, 0.025);
    const sa = a.snapshot(), sb = b.snapshot(); expect(sb.length).toBe(sa.length);
    sa.forEach((s, i) => { expect(sb[i]!.x).toBeCloseTo(s.x, 0); expect(sb[i]!.y).toBeCloseTo(s.y, 0); });
    const c1 = mk(), c2 = mk(); for (const v of [c1, c2]) v.force({ day: JUN, hour: 10, at: [0.4, 0.4] }); run(c1, 5, c, 0.05); run(c2, 5, c, 0.05);
    expect(c2.snapshot()).toEqual(c1.snapshot());
  });
  it('emits exhaust only with the exhaust flag and stays inside the instance caps', () => {
    const a = mk(), b = mk(); for (const v of [a, b]) v.force({ day: JUN, hour: 10, at: [0.3, 0.6] });
    run(a, 6, ctx({ exhaust: true })); run(b, 6, ctx({ exhaust: false }));
    expect(a.stats.puffs).toBeGreaterThan(0); expect(b.stats.puffs).toBe(0); expect(b.exhaust.visible).toBe(false);
    expect(a.liveries.reduce((n, m) => n + m.count, 0)).toBeLessThanOrEqual(F.caps.tractors); expect(a.stripes.count).toBeLessThanOrEqual(F.caps.stripes);
    expect(a.group.children.length + a.fx.children.length).toBe(8); // 3 livery meshes (empty ones are not drawn), hay loaves, trailers, bales, stripes, exhaust
  });
  it('patches fade after the tractors leave', () => {
    const v = mk(); v.force({ day: JUN, hour: 10, at: ['mowB', 'mowB'] }); run(v, 1, ctx());
    expect(v.stats.stripes).toBeGreaterThan(0);
    v.force(null); run(v, 3, ctx({ cap: 0, day: WINTER })); // everything gets sent home and removed
    run(v, F.patchHold + F.patchFade + 5, ctx({ cap: 0, day: WINTER }), 0.1);
    expect(v.stripes.count).toBe(0); expect(v.bales.count).toBe(0);
  });
});
