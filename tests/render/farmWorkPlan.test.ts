import { describe, expect, it } from 'vitest';
import { FARM_WORK as F } from '../../src/config/farmWork';
import { BLOCK, buildWorkWorld, farmPhase, hayLoadAt, headingAt, loadOf, mayDepart, mustBeHome, newRunner, patchLevel, planHome, planTrip, posAt, stepRunner, tractorCap, type FarmSite, type TripPlan } from '../../src/render/farmWorkPlan';
import { simDayOf } from '../../src/sim/calendar';
import { Grid, TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';

const farm = { id: 7, x: 20, y: 20, w: 6, h: 5 };
const site = (): FarmSite => ({ id: farm.id, gates: [{ x: 23, y: 25.9 }, { x: 20.8, y: 25.9 }, { x: 25.2, y: 25.9 }], park: [{ x: 21.3, y: 23.5 }, { x: 24.9, y: 23.5 }] });
/** A flat 64 map of grass with the farm and some obstacles: a barn row, a pond, a piste strip, a forest block. */
function stage(extra = true) {
  const g = new Grid(64);
  const blds: Array<{ id: number; x: number; y: number; w: number; h: number }> = [farm];
  if (extra) {
    blds.push({ id: 8, x: 28, y: 26, w: 4, h: 4 }, { id: 9, x: 16, y: 28, w: 3, h: 3 });
    for (let y = 30; y < 36; y++) for (let x = 20; x < 30; x++) { g.tileType[y * 64 + x] = TileType.Water; g.occupancy.set(x, y, OccFlag.Water); }
    for (let y = 26; y < 50; y++) { g.occupancy.set(36, y, OccFlag.Piste); g.occupancy.set(37, y, OccFlag.Piste); }
    for (let y = 36; y < 44; y++) for (let x = 14; x < 24; x++) g.tileType[y * 64 + x] = TileType.Forest;
  }
  return { grid: g, world: buildWorkWorld(g, blds) };
}
const samples = (p: TripPlan): Array<[number, number]> => { const out: Array<[number, number]> = []; for (let s = 0; s <= p.total; s += 0.1) { const q = posAt(p, s); out.push([q.x, q.y]); } return out; };

describe('farm work schedule', () => {
  it('runs Jun-Sep only, parks at the season edges', () => {
    const jun = (d: number): number => simDayOf(5, d), sep = (d: number): number => simDayOf(8, d);
    expect(farmPhase(simDayOf(4, 8))).toBe('off'); expect(farmPhase(simDayOf(9, 2))).toBe('off'); expect(farmPhase(simDayOf(0, 5))).toBe('off'); expect(farmPhase(simDayOf(11, 5))).toBe('off');
    expect(farmPhase(jun(1))).toBe('parked'); expect(farmPhase(jun(2))).toBe('parked'); expect(farmPhase(jun(3))).toBe('work');
    expect(farmPhase(simDayOf(6, 8))).toBe('work'); expect(farmPhase(sep(13))).toBe('work'); expect(farmPhase(sep(14))).toBe('parked'); expect(farmPhase(sep(15))).toBe('parked');
  });
  it('leaves in the morning and afternoon, lunches at the farm, is home at night and in rain', () => {
    expect(mayDepart(7.0, 0)).toBe(false); expect(mayDepart(8.0, 0)).toBe(true); expect(mayDepart(12.5, 0)).toBe(false); expect(mayDepart(13.6, 0)).toBe(true); expect(mayDepart(16.5, 0)).toBe(false); expect(mayDepart(22, 0)).toBe(false);
    expect(mayDepart(8.0, 1)).toBe(false); expect(mayDepart(9.2, 1)).toBe(true); // the second tractor starts later
    expect(mustBeHome(10, 'clear')).toBe(false); expect(mustBeHome(10, 'cloudy')).toBe(false); expect(mustBeHome(10, 'rain')).toBe(true); expect(mustBeHome(10, 'storm')).toBe(true); expect(mustBeHome(10, 'snow')).toBe(true);
    expect(mustBeHome(17.6, 'clear')).toBe(true); expect(mustBeHome(3, 'clear')).toBe(true);
  });
  it('caps tractors per tier and Atmosphere level', () => {
    expect(tractorCap('low', 'high')).toBe(1); expect(tractorCap('med', 'high')).toBe(2); expect(tractorCap('high', 'high')).toBe(2);
    expect(tractorCap('high', 'low')).toBe(1); expect(tractorCap('high', 'off')).toBe(0); expect(tractorCap('low', 'off')).toBe(0);
  });
  it('hay load grows monotonically to the cap; patches hold then fade', () => {
    let last = -1; for (let p = 0; p <= 1.0001; p += 0.05) { const l = hayLoadAt(p); expect(l).toBeGreaterThanOrEqual(last); last = l; }
    expect(hayLoadAt(0)).toBe(0); expect(hayLoadAt(1)).toBeCloseTo(F.load.max, 6); expect(hayLoadAt(5)).toBeCloseTo(F.load.max, 6);
    expect(patchLevel(0)).toBe(1); expect(patchLevel(F.patchHold)).toBe(1); expect(patchLevel(F.patchHold + F.patchFade / 2)).toBeCloseTo(0.5, 6); expect(patchLevel(1e6)).toBe(0);
  });
});

describe('farm work world + routes', () => {
  it('blocks water, pistes, forest and steep ground, keeps grass flat', () => {
    const { grid, world } = stage();
    const at = (x: number, y: number): number => world.owner[y * 64 + x]!;
    expect(at(24, 32)).toBe(BLOCK); expect(at(36, 30)).toBe(BLOCK); expect(at(18, 40)).toBe(BLOCK); expect(at(20, 21)).toBe(farm.id + 1); expect(at(30, 27)).toBe(8 + 1);
    expect(at(40, 10)).toBe(0); expect(world.flat[10 * 64 + 40]).toBe(1);
    grid.heights[10 * 65 + 50] = 5; // a steep corner
    const w2 = buildWorkWorld(grid, [farm]); expect(w2.owner[9 * 64 + 49]).toBe(BLOCK);
  });
  it('plans valid trips: never through buildings, water, forest or pistes, rows on flat grass, near the farm', () => {
    const { world } = stage(), s = site();
    let n = 0;
    for (let key = 1; key <= 60; key++) {
      const p = planTrip(world, s, key % 2, key * 104729); if (!p) continue; n++;
      for (const [x, y] of samples(p)) { const o = world.owner[Math.floor(y) * 64 + Math.floor(x)]!; expect(o === 0 || o === farm.id + 1, `tile ${Math.floor(x)},${Math.floor(y)} owner ${o}`).toBe(true); }
      expect(p.rows).toHaveLength(2); expect(p.bales).toHaveLength(F.bales.perPatch);
      for (const r of p.rows) { expect(r.s1).toBeGreaterThan(r.s0); for (const u of [0, 0.5, 1]) { const x = r.x0 + (r.x1 - r.x0) * u, y = r.y0 + (r.y1 - r.y0) * u; expect(world.flat[Math.floor(y) * 64 + Math.floor(x)]).toBe(1); } }
      const d = Math.hypot(p.cx - 23, p.cy - 25.9); expect(d).toBeGreaterThanOrEqual(F.patch.minDist - 0.01); expect(d).toBeLessThanOrEqual(F.patch.maxDist + 0.01);
      for (const b of p.bales) expect(world.owner[Math.floor(b.y) * 64 + Math.floor(b.x)]).toBe(0);
    }
    expect(n).toBeGreaterThan(50);
  });
  it('is deterministic per (key) and varies between keys', () => {
    const { world } = stage(), s = site();
    const a = planTrip(world, s, 0, 12345)!, b = planTrip(world, s, 0, 12345)!;
    expect(b.pts).toEqual(a.pts); expect(b.dwells).toEqual(a.dwells);
    const centres = new Set<string>(); for (let k = 0; k < 20; k++) { const p = planTrip(world, s, 0, 999 + k * 31); if (p) centres.add(`${p.cx.toFixed(1)},${p.cy.toFixed(1)}`); }
    expect(centres.size).toBeGreaterThan(8);
  });
  it('avoids patches that are already there', () => {
    const { world } = stage(), s = site(), a = planTrip(world, s, 0, 4242)!;
    const b = planTrip(world, s, 0, 4242, [{ x: a.cx, y: a.cy }])!;
    expect(Math.hypot(b.cx - a.cx, b.cy - a.cy)).toBeGreaterThanOrEqual(F.patch.avoid);
  });
  it('finds no trip when the farm is walled in', () => {
    const { world } = stage(false), s = site();
    for (let y = 18; y < 30; y++) for (let x = 17; x < 30; x++) { const inside = x >= 20 && x < 26 && y >= 20 && y < 25; if (!inside && (x < 19 || x > 27 || y < 19 || y > 27)) world.owner[y * 64 + x] = BLOCK; }
    for (let y = 18; y < 30; y++) for (let x = 17; x < 30; x++) { const inside = x >= 20 && x < 26 && y >= 20 && y < 25; if (!inside) world.owner[y * 64 + x] = BLOCK; }
    expect(planTrip(world, s, 0, 1)).toBeNull();
  });
});

describe('farm work trip timeline', () => {
  const run = (): { p: TripPlan; loads: number[]; t: number; mown: number[] } => {
    const { world } = stage(), p = planTrip(world, site(), 0, 31337)!, r = newRunner(p), loads: number[] = [], mown: number[] = [];
    let t = 0; while (!r.done && t < 600) { stepRunner(r, 0.1); t += 0.1; loads.push(loadOf(r)); }
    expect(r.done).toBe(true);
    return { p, loads, t, mown };
  };
  it('drives out, mows, loads, comes home and unloads within a sane time', () => {
    const { p, loads, t } = run();
    expect(t).toBeGreaterThan(20); expect(t).toBeLessThan(220);
    expect(Math.max(...loads)).toBeCloseTo(F.load.max, 2); expect(loads[0]).toBe(0); expect(loads[loads.length - 1]).toBeCloseTo(0, 1);
    const peak = loads.indexOf(Math.max(...loads)); for (let i = 1; i <= peak; i++) expect(loads[i]!).toBeGreaterThanOrEqual(loads[i - 1]! - 1e-9); // grows monotonically until the unload
    expect(posAt(p, p.total)).toEqual({ x: site().park[0]!.x, y: site().park[0]!.y }); expect(p.dwells.length).toBe(3);
  });
  it('is the same trip every time (frame-rate independent)', () => {
    const { world } = stage(), p = planTrip(world, site(), 0, 77)!, a = newRunner(p), b = newRunner(p);
    for (let i = 0; i < 400; i++) stepRunner(a, 0.1); for (let i = 0; i < 1600; i++) stepRunner(b, 0.025);
    expect(b.s).toBeCloseTo(a.s, 1); expect(b.dwellIdx).toBe(a.dwellIdx);
  });
  it('turns smoothly: heading never jumps along the route', () => {
    const { world } = stage(), p = planTrip(world, site(), 0, 5)!;
    let last = headingAt(p, 0.3), worst = 0;
    for (let s = 0.3; s < p.total - 0.3; s += 0.05) { const h = headingAt(p, s); let d = Math.abs(h - last); if (d > Math.PI) d = 2 * Math.PI - d; worst = Math.max(worst, d); last = h; }
    expect(worst).toBeLessThan(1.3);
  });
  it('an aborted trip goes home carrying its load and unloads', () => {
    const { world } = stage(), s = site(), p = planTrip(world, s, 1, 321)!, r = newRunner(p);
    while (r.s < p.rows[1]!.s1 - 0.5) stepRunner(r, 0.1);
    const load = loadOf(r), at = posAt(p, r.s), h = planHome(world, s, 1, at, load), hr = newRunner(h);
    expect(h.home).toBe(true); expect(load).toBeGreaterThan(0.5);
    for (const [x, y] of samples(h)) { const o = world.owner[Math.floor(y) * 64 + Math.floor(x)]!; expect(o === 0 || o === farm.id + 1).toBe(true); }
    let g = 0; while (!hr.done && g++ < 5000) stepRunner(hr, 0.1);
    expect(hr.done).toBe(true); expect(posAt(h, h.total)).toEqual({ x: s.park[1]!.x, y: s.park[1]!.y });
  });
});
