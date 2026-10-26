import { describe, expect, it } from 'vitest';
import { world } from '../snowHelpers';
import { Coverage, paintOverlay, EMPTY_NETWORK, QUALITY_RGB, OVERLAY_MODES, type CoverageBuilding } from '../../../src/sim/Coverage';
import { BUILDINGS } from '../../../src/config/buildings';
import { Layer } from '../../../src/world/Networks';
import {
  PisteQuality, PisteTraffic, Q, qualityPreference, qualitySpeedFactor, Grooming, Reservoirs, Snowmaking, createOps, SNOWMAKING, GROOM,
  type HourCtx,
} from '../../../src/sim/ops';
import { createClockSystem, SystemRegistry } from '../../../src/sim/Systems';
import { createWeatherSystem } from '../../../src/sim/Weather';
import { budget } from '../../perfMode';

const N = 64;
let bid = 1;
const mk = (type: string, x: number, y: number, active = true): CoverageBuilding => ({ id: bid++, type, x, y, w: BUILDINGS[type]!.w, h: BUILDINGS[type]!.h, active });

function stubNet(n: number, tiles: Array<[number, number, number]>) {
  const net = { layers: new Uint8Array(n * n), kind: new Uint8Array(n * n), difficulty: new Uint8Array(n * n) };
  for (const [x, y, d] of tiles) { net.layers[y * n + x] = Layer.Ski; net.difficulty[y * n + x] = d; }
  return net;
}
const ctx = (stamp: number, o: Partial<HourCtx> & { T?: number } = {}): HourCtx => ({
  stamp, hour: o.hour ?? stamp % 24, clear: o.clear ?? true, temp: o.temp ?? (() => o.T ?? -3), snowing: o.snowing ?? (() => false),
});

function qWorld(tiles: Array<[number, number, number]>, depth = 1) {
  const w = world(3, N);
  const net = stubNet(N, tiles);
  w.grid.snowDepth.fill(depth);
  const pq = new PisteQuality(N, net, w.grid.snowDepth, () => 100);
  return { w, net, pq };
}

describe('PisteQuality', () => {
  it('snowfall makes powder; ungroomed traffic degrades powder -> packed/bumpy', () => {
    const { pq } = qWorld([[10, 10, 2], [11, 10, 0]]);
    const a = 10 + 10 * N, b = 11 + 10 * N;
    pq.updateRows(0, N, ctx(100, { snowing: () => true }));
    expect(pq.at(a)).toBe(Q.Powder); expect(pq.at(b)).toBe(Q.Powder);
    for (let h = 0; h < 30; h++) { pq.traffic[a] = 3; pq.traffic[b] = 3; pq.updateRows(0, N, ctx(101 + h, { hour: 12 })); }
    expect(pq.at(a)).toBe(Q.Bumpy); // blue tile moguls out
    expect(pq.at(b)).toBe(Q.Packed); // green never moguls
  });
  it('steeper tiles mogul sooner', () => {
    const { pq } = qWorld([[10, 10, 3], [11, 10, 1]]);
    const hard = 10 + 10 * N, mild = 11 + 10 * N;
    pq.updateRows(0, N, ctx(1, { snowing: () => true }));
    let hHard = -1, hMild = -1;
    for (let h = 0; h < 60; h++) {
      pq.traffic[hard] = 2; pq.traffic[mild] = 2; pq.updateRows(0, N, ctx(2 + h, { hour: 12 }));
      if (hHard < 0 && pq.at(hard) === Q.Bumpy) hHard = h;
      if (hMild < 0 && pq.at(mild) === Q.Bumpy) hMild = h;
    }
    expect(hHard).toBeGreaterThanOrEqual(0); expect(hMild).toBeGreaterThan(hHard);
  });
  it('ungroomed pistes get icy over cold clear nights (and stay deterministic)', () => {
    const tiles: Array<[number, number, number]> = [];
    for (let x = 5; x < 45; x++) tiles.push([x, 20, 0]);
    const run = () => {
      const { pq } = qWorld(tiles);
      for (let day = 0; day < 6; day++) for (let h = 0; h < 24; h++) pq.updateRows(0, N, ctx(day * 24 + h, { T: -8 }));
      return pq;
    };
    const pq = run();
    expect(pq.counts()[Q.Icy]).toBeGreaterThan(30);
    expect(run().hash()).toBe(pq.hash());
  });
  it('warm afternoon -> slush, refreeze -> icy (hysteresis)', () => {
    const { pq } = qWorld([[10, 10, 1]]);
    const i = 10 + 10 * N;
    pq.groom(i);
    pq.updateRows(0, N, ctx(10, { hour: 13, T: 3 }));
    expect(pq.at(i)).toBe(Q.Slush);
    pq.updateRows(0, N, ctx(11, { hour: 14, T: 1 })); // inside the dead band: stays slush
    expect(pq.at(i)).toBe(Q.Slush);
    pq.updateRows(0, N, ctx(12, { hour: 20, T: -1 }));
    expect(pq.at(i)).toBe(Q.Icy);
  });
  it('no snow: state is frozen; row slices equal a whole-map update', () => {
    const tiles: Array<[number, number, number]> = [];
    for (let y = 0; y < 40; y += 3) for (let x = 3; x < 50; x++) tiles.push([x, y, (x + y) % 4]);
    const mkp = () => { const r = qWorld(tiles); for (let i = 0; i < N * N; i++) r.pq.traffic[i] = (i * 7) % 5; return r.pq; };
    const a = mkp(), b = mkp();
    for (let h = 0; h < 40; h++) {
      const c = ctx(h, { T: h % 24 < 12 ? -6 : 3, snowing: () => h === 3 });
      a.updateRows(0, N, c);
      for (let y = 0; y < N; y += 5) b.updateRows(y, y + 5, c);
      for (let i = 0; i < N * N; i++) { a.traffic[i] = b.traffic[i] = (i + h) % 4; }
    }
    expect(a.hash()).toBe(b.hash());
  });
  it('PisteTraffic.record feeds the attached counter', () => {
    const { pq } = qWorld([[1, 1, 0]]);
    pq.attachTraffic(); PisteTraffic.record(65); PisteTraffic.record(65);
    expect(pq.traffic[65]).toBe(2);
    PisteTraffic.sink = null; PisteTraffic.record(65);
    expect(pq.traffic[65]).toBe(2);
  });
});

describe('qualityPreference', () => {
  it('experts like powder/bumpy, beginners want groomed, icy hurts everyone (beginners most)', () => {
    expect(qualityPreference(3, Q.Powder)).toBeGreaterThan(qualityPreference(3, Q.Groomed));
    expect(qualityPreference(3, Q.Bumpy)).toBeGreaterThan(qualityPreference(0, Q.Bumpy));
    expect(qualityPreference(0, Q.Groomed)).toBeGreaterThan(qualityPreference(0, Q.Powder));
    expect(qualityPreference(0, Q.Groomed)).toBeGreaterThan(qualityPreference(0, Q.Bumpy));
    expect(qualityPreference(1, Q.Groomed)).toBeGreaterThan(0.5); expect(qualityPreference(1, Q.Packed)).toBeGreaterThan(0.5);
    for (let s = 0; s < 4; s++) expect(qualityPreference(s, Q.Icy)).toBeLessThan(0);
    expect(qualityPreference(0, Q.Icy)).toBeLessThan(qualityPreference(3, Q.Icy));
    expect(qualityPreference(2, Q.None)).toBe(0);
    expect(qualitySpeedFactor(Q.Groomed)).toBeGreaterThan(qualitySpeedFactor(Q.Bumpy));
  });
});

describe('overlay painter', () => {
  it('paints quality colours per state', () => {
    const q = new Uint8Array(N * N); q[5] = Q.Powder; q[6] = Q.Groomed; q[7] = Q.Packed; q[8] = Q.Icy; q[9] = Q.Bumpy;
    const out = new Uint8Array(N * N * 4);
    paintOverlay(out, N, 'quality', new Coverage(N), EMPTY_NETWORK, [], null, q);
    for (let i = 5; i <= 9; i++) { expect([out[i * 4], out[i * 4 + 1], out[i * 4 + 2]]).toEqual(QUALITY_RGB[q[i]!]); expect(out[i * 4 + 3]).toBeGreaterThan(0); }
    expect(out[3]).toBe(0);
    expect(OVERLAY_MODES).toContain('quality');
    paintOverlay(out, N, 'quality', new Coverage(N), EMPTY_NETWORK, [], null, null);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});

describe('Grooming', () => {
  const setup = (depth: number, outpostAt: [number, number] = [20, 20]) => {
    const tiles: Array<[number, number, number]> = [];
    for (let x = 10; x < 30; x++) tiles.push([x, 24, 1]); // in range of outpost
    for (let x = 10; x < 20; x++) tiles.push([x, 60, 1]); // far away
    const { w, pq } = qWorld(tiles, depth);
    for (let i = 0; i < N * N; i++) if (pq.isPiste(i)) pq.state[i] = Q.Icy;
    const cov = new Coverage(N);
    const garage = mk('groomerGarage', 40, 40), outpost = mk('snowcatOutpost', outpostAt[0], outpostAt[1]);
    cov.refresh([garage, outpost]);
    const costs: Array<[string, number]> = [], nights: Array<{ vehicles: number; tiles: number }> = [];
    const g = new Grooming({ size: N, quality: pq, coverage: cov, snowDepth: w.grid.snowDepth, buildings: () => [garage, outpost], onCost: (c, a) => costs.push([c, a]), onNight: (r) => nights.push(r) });
    const night = () => { for (let t = 0; t < 100; t++) { const h = 22 + t / 10; g.update(h >= 24 ? 6 : 5, h % 24); } g.update(6, 12); };
    return { pq, g, night, costs, nights, outpost, garage };
  };
  it('a night with coverage + a vehicle grooms in-range pistes; out-of-range stay ungroomed', () => {
    const { pq, night, nights, costs } = setup(1);
    night();
    for (let x = 10; x < 30; x++) expect(pq.at(x + 24 * N)).toBe(Q.Groomed);
    for (let x = 10; x < 20; x++) expect(pq.at(x + 60 * N)).toBe(Q.Icy);
    expect(nights.length).toBe(1); expect(nights[0]!.tiles).toBe(20); expect(nights[0]!.vehicles).toBeGreaterThan(0);
    expect(costs.some(([c]) => c === 'wages')).toBe(true); expect(costs.some(([c]) => c === 'fuel')).toBe(true);
  });
  it('no snow -> no grooming', () => {
    const { pq, night, nights } = setup(0.05);
    night();
    expect(pq.counts()[Q.Groomed]).toBe(0); expect(nights.every((n) => n.tiles === 0) || nights.length === 0).toBe(true);
  });
  it('zero vehicles -> no grooming; capacity limits tiles per night', () => {
    const a = setup(1);
    a.g.setVehicles(a.outpost.id, 0); a.g.setVehicles(a.garage.id, 0);
    a.night();
    expect(a.pq.counts()[Q.Groomed]).toBe(0);
    const b = setup(1);
    b.g.setVehicles(b.outpost.id, 1); b.g.setVehicles(b.garage.id, 0);
    expect(GROOM.capacity).toBeGreaterThanOrEqual(20);
    b.night(); expect(b.nights[0]!.vehicles).toBe(1); expect(b.g.groomedLastNight(b.outpost.id)).toBe(20);
  });
  it('tiles are groomed progressively as the cat passes', () => {
    const { pq, g } = setup(1);
    g.update(5, 22); g.update(5, 22.1);
    const mid = pq.counts()[Q.Groomed];
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(20);
  });
});

describe('Reservoirs + Snowmaking', () => {
  it('reservoir consume / refill / summer rate', () => {
    const r = new Reservoirs(1000, 0.5);
    r.sync([{ id: 1, type: 'reservoir', active: true }, { id: 2, type: 'snowCannon', active: true }, { id: 3, type: 'reservoir', active: false }]);
    expect(r.count).toBe(1); expect(r.level()).toBe(500); expect(r.capacity()).toBe(1000);
    expect(r.consume(200)).toBe(200); expect(r.level()).toBe(300);
    expect(r.consume(1000)).toBe(300); expect(r.has()).toBe(false);
    r.refillDay('winter', { kind: 'clear', intensity: 0, valleyT: -5 });
    const winter = r.level();
    expect(winter).toBe(SNOWMAKING.streamPerDay);
    r.consume(winter);
    r.refillDay('summer', { kind: 'clear', intensity: 0, valleyT: 15 });
    expect(r.level()).toBeGreaterThan(winter * 3);
    r.fill(1e9); expect(r.level()).toBe(1000);
  });

  const setup = (T: number, water: number) => {
    const w = world(3, N);
    w.grid.snowDepth.fill(0); w.cond.syncAll();
    const net = stubNet(N, [[30, 30, 1], [31, 30, 1], [34, 30, 1], [50, 50, 1]]);
    const pq = new PisteQuality(N, net, w.grid.snowDepth, () => 0);
    const cov = new Coverage(N);
    const cannon = mk('snowCannon', 30, 30), res = mk('reservoir', 36, 30);
    cov.refresh([cannon, res]);
    const reservoirs = new Reservoirs(1000, 0); reservoirs.sync([res]); reservoirs.fill(water);
    const costs: Array<[string, number]> = [];
    const sm = new Snowmaking({
      size: N, coverage: cov, reservoirs, isPiste: (i) => pq.isPiste(i), snowDepth: w.grid.snowDepth, altOf: () => 0,
      addSnow: (i, d) => w.snow.addSnow(i, d), onCost: (c, a) => costs.push([c, a]),
    });
    const hour = () => { for (let p = 0; p < 10; p++) sm.runPhase(ctx(1, { T }), p, 10); };
    return { w, sm, reservoirs, hour, costs, cov };
  };
  it('cannon coverage: only linked pistes in radius', () => {
    const { cov } = setup(-5, 500);
    expect(cov.isCovered('snowmaking', 31, 30)).toBe(true); expect(cov.isCovered('snowmaking', 50, 50)).toBe(false);
  });
  it('adds depth only when cold and reservoir has water; consumes water; bills energy', () => {
    const idx = 31 + 30 * N, far = 50 + 50 * N;
    const cold = setup(-5, 500); cold.hour();
    expect(cold.w.grid.snowDepth[idx]).toBeGreaterThan(0.02); expect(cold.w.grid.snowDepth[far]).toBe(0);
    expect(cold.reservoirs.level()).toBeLessThan(500); expect(cold.sm.waterUsedTotal).toBeGreaterThan(0);
    cold.sm.flushCosts(); expect(cold.costs[0]![0]).toBe('energy');
    const warm = setup(1, 500); warm.hour();
    expect(warm.w.grid.snowDepth[idx]).toBe(0); expect(warm.reservoirs.level()).toBe(500);
    const dry = setup(-5, 0); dry.hour();
    expect(dry.w.grid.snowDepth[idx]).toBe(0);
  });
  it('stops at the target depth; partial water gives partial snow', () => {
    const idx = 31 + 30 * N;
    const a = setup(-5, 1000);
    for (let h = 0; h < 40; h++) a.hour();
    expect(a.w.grid.snowDepth[idx]).toBeCloseTo(SNOWMAKING.targetDepth, 3);
    const lim = setup(-5, 8); lim.hour();
    expect(lim.reservoirs.level()).toBeCloseTo(0, 5);
    expect(lim.w.grid.snowDepth[idx]).toBeLessThan(SNOWMAKING.perHour);
  });
});

function sim(seed: number, size: 64 | 128 | 256, days: number, tick?: (t: number) => void) {
  const w = world(seed, size);
  const net = stubNet(size, []);
  for (let y = 0; y < size; y += 4) for (let x = 4; x < size - 4; x++) { net.layers[y * size + x] = Layer.Ski; net.difficulty[y * size + x] = (x + y) % 4; }
  const cov = new Coverage(size);
  const blds = [mk('groomerGarage', 20, 20), mk('snowcatOutpost', 30, 30), mk('snowCannon', 40, 8), mk('reservoir', 44, 10)];
  cov.refresh(blds);
  const costs: Record<string, number> = {};
  const ops = createOps({ grid: w.grid, cond: w.cond, weather: w.weather, snow: w.snow, coverage: cov, net, buildings: () => blds, onCost: (c, a) => { costs[c] = (costs[c] ?? 0) + a; } });
  const reg = new SystemRegistry(() => performance.now());
  reg.register(createClockSystem());
  reg.register(createWeatherSystem(w.weather, w.snow));
  reg.register(ops.system);
  for (let t = 0; t < days * 240; t++) { reg.update(w.state, t); tick?.(t); }
  return { ops, w, reg, costs };
}

describe('ops system', () => {
  it('deterministic: same seed -> same quality hash after N days; different seed differs', () => {
    const a = sim(11, 64, 6), b = sim(11, 64, 6), c = sim(12, 64, 6);
    expect(a.ops.quality.hash()).toBe(b.ops.quality.hash());
    expect(a.w.snow.hash()).toBe(b.w.snow.hash());
    expect(c.w.snow.hash()).not.toBe(a.w.snow.hash());
  });
  it('serialize/load roundtrips state', () => {
    const a = sim(5, 64, 3);
    const data = JSON.parse(JSON.stringify(a.ops.system.serialize!()));
    const b = sim(5, 64, 0);
    b.ops.system.load!(data);
    expect(b.ops.quality.hash()).toBe(a.ops.quality.hash());
    expect(b.ops.reservoirs.level()).toBeCloseTo(a.ops.reservoirs.level(), 6);
  });
  it('[perf] per-tick cost on 256 is within budget (ops < 1 ms avg)', () => {
    let best = Infinity;
    for (let r = 0; r < 3; r++) {
      const s = sim(3, 256, 0);
      s.w.grid.snowDepth.fill(1);
      for (let t = 0; t < 240; t++) s.reg.update(s.w.state, t);
      const st = s.reg.stats().find((x) => x.id === 'ops')!;
      best = Math.min(best, st.avgMs);
    }
    // eslint-disable-next-line no-console
    console.log(`ops avg per tick on 256: ${best.toFixed(3)} ms`);
    expect(best).toBeLessThan(budget(1));
  });
});
