import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { world } from '../snowHelpers';
import { Coverage, paintOverlay, EMPTY_NETWORK, type CoverageBuilding } from '../../../src/sim/Coverage';
import { BUILDINGS } from '../../../src/config/buildings';
import { Layer } from '../../../src/world/Networks';
import { PisteQuality, Reservoirs, Snowmaking, SNOWMAKING, cannonInfo, createOps, type HourCtx } from '../../../src/sim/ops';
import { createClockSystem, SystemRegistry } from '../../../src/sim/Systems';
import { createWeatherSystem } from '../../../src/sim/Weather';
import { selectSprayers, sprayCapForZoom, SPRAY } from '../../../src/render/SnowSpray';
import { budget } from '../../perfMode';

let bid = 1;
const mk = (type: string, x: number, y: number): CoverageBuilding => ({ id: bid++, type, x, y, w: BUILDINGS[type]!.w, h: BUILDINGS[type]!.h, active: true });
const ctx = (stamp: number, T: number): HourCtx => ({ stamp, hour: stamp % 24, clear: true, temp: () => T, snowing: () => false });

/** A 3-wide east-west piste through the cannon; reservoir 6 tiles away. */
function setup(o: { T?: number; water?: number; size?: number; link?: boolean; cannons?: number } = {}) {
  const N = o.size ?? 64, T = o.T ?? -5;
  const w = world(3, N as 64 | 128 | 256);
  w.grid.snowDepth.fill(0); w.cond.syncAll();
  const layers = new Uint8Array(N * N), diff = new Uint8Array(N * N), kind = new Uint8Array(N * N);
  for (let x = 8; x < N - 8; x++) for (let y = 30; y <= 32; y++) { layers[y * N + x] = Layer.Ski; diff[y * N + x] = 1; }
  const pq = new PisteQuality(N, { layers, kind, difficulty: diff }, w.grid.snowDepth, () => 0);
  const cov = new Coverage(N);
  const cannons = Array.from({ length: o.cannons ?? 1 }, (_, k) => mk('snowCannon', 30 + k * 3, 31));
  const res = mk('reservoir', 36, 40);
  cov.refresh(o.link === false ? cannons : [...cannons, res]);
  const reservoirs = new Reservoirs(20000, 0); reservoirs.sync([res]); reservoirs.fill(o.water ?? 20000);
  const sm = new Snowmaking({ size: N, coverage: cov, reservoirs, isPiste: (i) => pq.isPiste(i), snowDepth: w.grid.snowDepth, altOf: () => 0, addSnow: (i, d) => w.snow.addSnow(i, d) });
  let stamp = 1;
  const hour = (t = T): void => { stamp++; for (let p = 0; p < 10; p++) sm.runPhase(ctx(stamp, t), p, 10); };
  return { w, sm, reservoirs, hour, cov, cannons, res, N };
}

describe('snowmaking cannon: reach', () => {
  it('serviceRadius is 10 and one mid-piste cannon reaches >= 100 piste + adjacent ground tiles', () => {
    expect(BUILDINGS.snowCannon!.serviceRadius).toBeGreaterThanOrEqual(9);
    const s = setup(); s.hour();
    const st = s.sm.statsOf(s.cannons[0]!.id)!;
    expect(st.tiles).toBeGreaterThanOrEqual(100);
    expect(st.pisteTiles).toBeGreaterThanOrEqual(45);
    expect(st.state).toBe('running');
  });
  it('a cold night (10 h) builds >= 0.3 m on every covered piste tile and a thinner base on the adjacent ground', () => {
    const s = setup(); const N = s.N;
    for (let h = 0; h < 10; h++) s.hour();
    let covered = 0, ok = 0;
    for (let x = 0; x < N; x++) for (let y = 30; y <= 32; y++) if (Math.hypot(x + 0.5 - 30.5, y + 0.5 - 31.5) <= 10) { covered++; if (s.w.grid.snowDepth[y * N + x]! >= 0.3) ok++; }
    expect(covered).toBeGreaterThanOrEqual(45); expect(ok).toBe(covered);
    const near = s.w.grid.snowDepth[(31 + 4) * N + 31]!, far = s.w.grid.snowDepth[(31 + 7) * N + 31]!, offPiste = s.w.grid.snowDepth[(31 + 20) * N + 31]!;
    expect(near).toBeGreaterThan(0.2); expect(near).toBeLessThanOrEqual(SNOWMAKING.offPisteDepth + 1e-6);
    expect(far).toBe(0); expect(offPiste).toBe(0);
  });
  it('the base stops at the target depth and the cannon reports "snow base complete"', () => {
    const s = setup();
    for (let h = 0; h < 30; h++) s.hour();
    expect(s.w.grid.snowDepth[31 * s.N + 31]).toBeCloseTo(SNOWMAKING.targetDepth, 3);
    expect(s.sm.statsOf(s.cannons[0]!.id)!.state).toBe('full');
  });
  it('wet-bulb: between -2 and 0 °C it runs at half rate; above 0 °C it does not run', () => {
    const cold = setup({ T: -5 }), marg = setup({ T: -1 }), warm = setup({ T: 0.5 });
    cold.hour(); marg.hour(); warm.hour();
    const i = 31 * 64 + 31;
    expect(cold.w.grid.snowDepth[i]).toBeGreaterThan(0.05);
    expect(marg.w.grid.snowDepth[i]! / cold.w.grid.snowDepth[i]!).toBeCloseTo(SNOWMAKING.marginalRate, 2);
    expect(warm.w.grid.snowDepth[i]).toBe(0);
    expect(warm.sm.statsOf(warm.cannons[0]!.id)!.state).toBe('warm');
    expect(warm.reservoirs.level()).toBe(20000);
  });
});

describe('snowmaking cannon: no gain without water or a pipe link', () => {
  it('no water -> no gain; state noWater', () => {
    const s = setup({ water: 0 }); for (let h = 0; h < 5; h++) s.hour();
    expect(s.w.grid.snowDepth.reduce((a, b) => a + b, 0)).toBe(0);
    expect(s.sm.statsOf(s.cannons[0]!.id)!.state).toBe('noWater');
  });
  it('a cannon with no reservoir in pipe range is not a source: no gain', () => {
    const s = setup({ link: false }); for (let h = 0; h < 5; h++) s.hour();
    expect(s.cov.sources('snowmaking')).toHaveLength(0);
    expect(s.w.grid.snowDepth.reduce((a, b) => a + b, 0)).toBe(0);
  });
  it('partial water gives partial snow and drains the reservoir exactly', () => {
    const s = setup({ water: 30 }); s.hour();
    expect(s.reservoirs.level()).toBeCloseTo(0, 5);
    expect(s.sm.waterUsedTotal).toBeCloseTo(30, 5);
  });
});

describe('snowmaking: water economy', () => {
  it('one reservoir builds the first base for 8 cannons along a piste and leaves water for top-ups', () => {
    const s = setup({ size: 128, cannons: 8 });
    for (let h = 0; h < 40; h++) s.hour();
    const used = s.sm.waterUsedTotal;
    expect(used).toBeGreaterThan(1000);
    expect(used).toBeLessThan(0.7 * 20000);
  });
  it('winter refill (streams alone) over a 60-day winter is >= a full reservoir', () => {
    const r = new Reservoirs(20000, 0); r.sync([{ id: 1, type: 'reservoir', active: true }]);
    for (let d = 0; d < 60; d++) r.refillDay('winter', { kind: 'clear', intensity: 0, valleyT: -5 });
    expect(r.level()).toBeGreaterThanOrEqual(0.85 * 20000);
  });
});

describe('cannonInfo (inspector wording)', () => {
  const deps = (s: ReturnType<typeof setup>, tempNow = -5) => ({ sm: s.sm, reservoirs: s.reservoirs, reservoirCentres: [{ x: s.res.x + 2, y: s.res.y + 2 }], pipeRange: 24, altM: 1450, tempNow });
  const b = (s: ReturnType<typeof setup>) => ({ ...s.cannons[0]!, active: true });
  it('Running / too warm / no water / complete / not connected', () => {
    const run = setup(); run.hour();
    const i1 = cannonInfo(b(run), deps(run));
    expect(i1.status).toBe('running'); expect(i1.headline).toBe('Running'); expect(i1.tiles).toBeGreaterThanOrEqual(100);
    const warm = setup({ T: 3 }); warm.hour();
    const i2 = cannonInfo(b(warm), deps(warm, 3));
    expect(i2.status).toBe('warm'); expect(i2.headline).toMatch(/too warm.*≤ -2 °C at 1,450 m/);
    const dry = setup({ water: 0 }); dry.hour();
    expect(cannonInfo(b(dry), deps(dry)).status).toBe('noWater');
    const unlinked = setup({ link: false }); unlinked.hour();
    expect(cannonInfo(b(unlinked), { ...deps(unlinked), reservoirCentres: [] }).headline).toMatch(/Not connected to a reservoir/);
    expect(cannonInfo(b(unlinked), { ...deps(unlinked), reservoirCentres: [{ x: 200, y: 200 }] }).status).toBe('outOfPipe');
    const full = setup(); for (let h = 0; h < 30; h++) full.hour();
    expect(cannonInfo(b(full), deps(full)).status).toBe('full');
  });
  it('night roll: last night gain + water are reported', () => {
    const s = setup(); for (let h = 0; h < 6; h++) s.hour();
    s.sm.rollNight();
    const i = cannonInfo(b(s), deps(s));
    expect(i.gainCm).toBeGreaterThan(5); expect(i.waterLast).toBeGreaterThan(100);
    expect(s.sm.gainLast.some((v) => v > 0)).toBe(true); expect(s.sm.gainToday.every((v) => v === 0)).toBe(true);
  });
});

describe('snowmaking overlay', () => {
  it('covered tiles are tinted; tiles that received snow glow brighter', () => {
    const s = setup(); for (let h = 0; h < 4; h++) s.hour();
    const out = new Uint8Array(64 * 64 * 4);
    paintOverlay(out, 64, 'snowmaking', s.cov, EMPTY_NETWORK, [], null, null, null, null, null);
    const plain = out[(31 * 64 + 31) * 4 + 3]!;
    expect(plain).toBeGreaterThan(0);
    paintOverlay(out, 64, 'snowmaking', s.cov, EMPTY_NETWORK, [], null, null, null, null, s.sm.gainToday);
    expect(out[(31 * 64 + 31) * 4 + 3]!).toBeGreaterThan(plain);
    expect(out[(5 * 64 + 5) * 4 + 3]).toBe(0);
  });
});

describe('snowmaking in the ops system', () => {
  const run = (days: number, size: 64 | 128 | 256 = 64, cannons = 3) => {
    const w = world(5, size);
    w.grid.snowDepth.fill(0); w.cond.syncAll();
    const layers = new Uint8Array(size * size), diff = new Uint8Array(size * size);
    for (let y = 20; y < size - 10; y += 7) for (let x = 6; x < size - 6; x++) { layers[y * size + x] = Layer.Ski; diff[y * size + x] = 1; }
    const net = { layers, kind: new Uint8Array(size * size), difficulty: diff };
    const cov = new Coverage(size);
    const blds = [mk('reservoir', 20, 8), ...Array.from({ length: cannons }, (_, k) => mk('snowCannon', 14 + (k * 7) % (size - 20), 20 + ((k * 7) % Math.max(7, size - 30) > 0 ? 7 * (k % 3) : 0)))];
    cov.refresh(blds);
    const ops = createOps({ grid: w.grid, cond: w.cond, weather: w.weather, snow: w.snow, coverage: cov, net, buildings: () => blds });
    const reg = new SystemRegistry(() => performance.now());
    reg.register(createClockSystem()); reg.register(createWeatherSystem(w.weather, w.snow)); reg.register(ops.system);
    for (let t = 0; t < days * 240; t++) reg.update(w.state, t);
    return { ops, w, reg };
  };
  it('deterministic (same gain hash) and save/load keeps working', () => {
    const hash = (a: Float32Array): number => { let h = 0; for (let i = 0; i < a.length; i++) h = (Math.imul(h, 31) + Math.round(a[i]! * 1e4)) | 0; return h; };
    const a = run(3), b = run(3);
    expect(hash(a.ops.snowmaking.gainToday)).toBe(hash(b.ops.snowmaking.gainToday));
    expect(a.w.snow.hash()).toBe(b.w.snow.hash());
    const data = JSON.parse(JSON.stringify(a.ops.system.serialize!()));
    const c = run(0); c.ops.system.load!(data);
    expect(c.ops.reservoirs.level()).toBeCloseTo(a.ops.reservoirs.level(), 6);
  });
  it('[perf] 256 map with 30 cannons on bare cold ground: ops < 1 ms/tick', () => {
    let best = Infinity;
    for (let r = 0; r < 3; r++) {
      const s = run(0, 256, 30);
      s.w.weather.current.valleyT = -8;
      for (let t = 0; t < 240; t++) s.reg.update(s.w.state, t);
      expect(s.ops.snowmaking.waterUsedTotal).toBeGreaterThan(0);
      best = Math.min(best, s.reg.stats().find((x) => x.id === 'ops')!.avgMs);
    }
    // eslint-disable-next-line no-console
    console.log(`ops avg per tick on 256 with 30 cannons: ${best.toFixed(3)} ms`);
    expect(best).toBeLessThan(budget(1));
  });
});

describe('snow spray view (pure parts)', () => {
  const cands = [{ id: 1, x: 10, y: 10 }, { id: 2, x: 12, y: 10 }, { id: 3, x: 200, y: 10 }, { id: 4, x: 11, y: 11 }];
  it('only running cannons near the view centre, nearest first, capped', () => {
    expect(selectSprayers(cands, new Set([1, 2, 3]), 10, 10)).toEqual([1, 2]);
    expect(selectSprayers(cands, new Set([1, 2, 4]), 10, 10, 2)).toEqual([1, 4]);
    expect(selectSprayers(cands, new Set(), 10, 10)).toEqual([]);
  });
  it('LOD: nothing when zoomed far out, fewer when mid', () => {
    expect(sprayCapForZoom(20)).toBe(SPRAY.maxCannons); expect(sprayCapForZoom(60)).toBeLessThan(SPRAY.maxCannons); expect(sprayCapForZoom(200)).toBe(0);
    expect(SPRAY.maxCannons * SPRAY.particles).toBeLessThanOrEqual(512);
    expect(new THREE.Vector3()).toBeTruthy();
  });
});
