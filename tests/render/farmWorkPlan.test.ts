import { describe, expect, it } from 'vitest';
import { FARM_WORK as F } from '../../src/config/farmWork';
import { smoothYaw, paceRate, paceSpeed, planDuration, tripGameHours, BLOCK, buildWorkWorld, farmPhase, hayLoadAt, headingAt, loadOf, mayDepart, mustBeHome, newRunner, patchLevel, planHome, planTrip, posAt, stepRunner, tractorCap, type FarmSite, type TripPlan } from '../../src/render/farmWorkPlan';
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
      const d = Math.hypot(p.cx - 23, p.cy - 25.9); expect(d).toBeGreaterThanOrEqual(F.patch.minDist - 1.5); expect(d).toBeLessThanOrEqual(F.patch.maxDist + 0.01);
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

describe('farm work pace is calm', () => {
  const { world } = stage();
  it('drive speed in tiles per real second stays <= ~1.4 at 1x and <= ~2.4 at 3x; paceSpeed softens the multiplier', () => {
    expect(F.speed.drive * F.pace.maxRate).toBeLessThanOrEqual(1.4); expect(F.speed.drive * F.pace.maxRate * paceSpeed(3)).toBeLessThanOrEqual(2.4);
    expect(paceSpeed(1)).toBe(1); expect(paceSpeed(0.5)).toBe(1); expect(paceSpeed(3)).toBeGreaterThan(1.4); expect(paceSpeed(3)).toBeLessThan(2);
    for (let k = 0; k < 8; k++) { const plan = planTrip(world, site(), 0, 900 + k); if (plan) { const rate = paceRate(plan); expect(F.speed.drive * rate).toBeLessThanOrEqual(1.4); } }
  });
});
describe('farm work pace and gap', () => {
  const { world } = stage();
  it('a trip lasts ~2-3 game hours at any speed: the pace rate is clamped and stable', () => {
    for (let k = 0; k < 6; k++) {
      const plan = planTrip(world, site(), 0, 500 + k); if (!plan) continue;
      const r = paceRate(plan); expect(r).toBeGreaterThanOrEqual(1); expect(r).toBeLessThanOrEqual(F.pace.maxRate);
      const gh = tripGameHours(plan); expect(gh).toBeGreaterThan(1.5); expect(gh).toBeLessThan(F.pace.tripHours * 1.6 + 6);
      if (r < F.pace.maxRate && r > 1) expect(gh).toBeCloseTo(F.pace.tripHours, 5);
      expect(newRunner(plan).rate).toBe(r); expect(planDuration(plan)).toBeGreaterThan(20);
    }
  });
  it('2-3 trips fit a working day: the last departure + a trip ends before the evening rule', () => {
    expect(F.hours.lastDepart + F.pace.tripHours).toBeLessThan(F.hours.home);
    expect(mayDepart(13.7, 0)).toBe(true); expect(mayDepart(15.5, 0)).toBe(false);
    const day = F.hours.home - F.hours.earliest; expect(day / (F.pace.tripHours + 1.2)).toBeGreaterThanOrEqual(2);
  });
  it('trips pass the fence gap on the way out and back, and the square bales are a pure function of the key', () => {
    const s: FarmSite = { ...site(), gap: { x: 23, y: 24.8 } };
    const a = planTrip(world, s, 0, 11), b = planTrip(world, s, 0, 11); expect(a).not.toBeNull(); expect(b!.pts).toEqual(a!.pts);
    const near = (p: TripPlan): number => { let n = 0; for (let i = 0; i < p.pts.length; i += 2) if (Math.hypot(p.pts[i]! - 23, p.pts[i + 1]! - 24.8) < 1e-6) n++; return n; };
    expect(near(a!)).toBe(2); expect(a!.squares.length).toBe(F.bales.square.perPatch); expect(a!.squares).toEqual(b!.squares);
    for (const q of a!.squares) { expect(Number.isFinite(q.x + q.y + q.yaw)).toBe(true); }
    const home = planHome(world, s, 0, { x: 30, y: 40 }, 0.5); expect(near(home)).toBe(1);
  });
});

describe('smoothYaw (drawn heading easing)', () => {
  it('snaps without a previous value, on snap, and keeps the previous value at dt 0', () => {
    expect(smoothYaw(undefined, 1.2, 0.03, 0.16)).toBe(1.2);
    expect(smoothYaw(0.3, 1.2, 0.03, 0.16, true)).toBe(1.2);
    expect(smoothYaw(0.3, 1.2, 0, 0.16)).toBe(0.3);
  });
  it('eases the shortest way round, never overshoots, converges, and caps the per-frame turn', () => {
    let y = 3.0; const target = -3.0; // the short way is through pi, 0.28 rad apart
    for (let i = 0; i < 4; i++) { const n = smoothYaw(y, target, 1 / 30, 0.16); const dBefore = Math.abs(((target - y + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI), dAfter = Math.abs(((target - n + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI); expect(dAfter).toBeLessThanOrEqual(dBefore + 1e-12); y = n; }
    let a = 0; const t0 = 0.66; for (let i = 0; i < 2; i++) a = smoothYaw(a, t0, 1 / 30, 0.16);
    expect(a).toBeLessThan(0.66 * 0.6); // a 0.66 rad corner that used to be done in 2 frames now takes much longer
    for (let i = 0; i < 60; i++) a = smoothYaw(a, t0, 1 / 30, 0.16);
    expect(a).toBeCloseTo(t0, 3);
  });
  it('turn rate at 30 fps for a 0.66 rad corner stays under 4 rad/s (was ~10 rad/s at 3x)', () => {
    let a = 0, worst = 0; for (let i = 0; i < 30; i++) { const n = smoothYaw(a, 0.66, 1 / 30, 0.16); worst = Math.max(worst, Math.abs(n - a) * 30); a = n; }
    expect(worst).toBeLessThan(4);
  });
  it('is finite for any input', () => { expect(Number.isFinite(smoothYaw(NaN, 1, 0.03, 0.16))).toBe(true); expect(Number.isFinite(smoothYaw(0, NaN, 0.03, 0.16))).toBe(true); });
});
