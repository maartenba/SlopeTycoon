import { describe, expect, it } from 'vitest';
import { world } from '../snowHelpers';
import { Coverage, type CoverageBuilding } from '../../../src/sim/Coverage';
import { BUILDINGS } from '../../../src/config/buildings';
import { Layer } from '../../../src/world/Networks';
import { PisteQuality, Reservoirs, Snowmaking, SNOWMAKING, cannonInfo, type HourCtx } from '../../../src/sim/ops';
import { makeResort, run, TICKS_PER_DAY } from '../../game/harness';
import { applySave, stateHash } from '../../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../../src/persist/Serializer';
import { createSim } from '../../../src/game/createSim';

let bid = 1000;
const mk = (type: string, x: number, y: number): CoverageBuilding => ({ id: bid++, type, x, y, w: BUILDINGS[type]!.w, h: BUILDINGS[type]!.h, active: true });
const ctx = (stamp: number, T: number): HourCtx => ({ stamp, hour: stamp % 24, clear: true, temp: () => T, snowing: () => false });

/** East-west piste at altitude 0; `snowline` (world altitude) and `high` (°C daily peak) are adjustable. */
function setup(o: { T?: number; cannons?: number } = {}) {
  const N = 64, T = o.T ?? -5;
  const w = world(3, N);
  w.grid.snowDepth.fill(0); w.cond.syncAll();
  const layers = new Uint8Array(N * N), diff = new Uint8Array(N * N), kind = new Uint8Array(N * N);
  for (let x = 8; x < N - 8; x++) for (let y = 30; y <= 32; y++) { layers[y * N + x] = Layer.Ski; diff[y * N + x] = 1; }
  const pq = new PisteQuality(N, { layers, kind, difficulty: diff }, w.grid.snowDepth, () => 0);
  const cov = new Coverage(N);
  const cannons = Array.from({ length: o.cannons ?? 1 }, (_, k) => mk('snowCannon', 30 + k * 3, 31));
  const res = mk('reservoir', 36, 40);
  cov.refresh([...cannons, res]);
  const reservoirs = new Reservoirs(20000, 0); reservoirs.sync([res]); reservoirs.fill(20000);
  const wx = { snowline: -10, high: 0 };
  const sm = new Snowmaking({ size: N, coverage: cov, reservoirs, isPiste: (i) => pq.isPiste(i), snowDepth: w.grid.snowDepth, altOf: () => 0, addSnow: (i, d) => w.snow.addSnow(i, d), snowline: () => wx.snowline, dailyHigh: () => wx.high });
  let stamp = 1;
  const hour = (t = T): void => { stamp++; for (let p = 0; p < 10; p++) sm.runPhase(ctx(stamp, t), p, 10); };
  return { sm, hour, cannons, reservoirs, wx, grid: w.grid, res };
}
const deps = (s: ReturnType<typeof setup>) => ({ sm: s.sm, reservoirs: s.reservoirs, reservoirCentres: [{ x: s.res.x + 2, y: s.res.y + 2 }], pipeRange: 24, altM: 1450, tempNow: -5, snowlineM: 1420, highNow: 6 });
const b = (s: ReturnType<typeof setup>, k = 0) => ({ ...s.cannons[k]!, active: true });
const snowSum = (s: ReturnType<typeof setup>): number => s.grid.snowDepth.reduce((a, v) => a + v, 0);

describe('snowmaking: per-cannon switch and global mode', () => {
  it('default mode is On and nothing is switched off', () => {
    const s = setup(); expect(s.sm.mode).toBe('on'); expect(s.sm.serializeState()).toBeUndefined();
    s.hour(); expect(s.sm.statsOf(s.cannons[0]!.id)!.state).toBe('running');
  });
  it('a switched-off cannon makes no snow, uses no water or energy, and reports Off by you; the others keep running', () => {
    const s = setup({ cannons: 2 });
    s.sm.setCannon(s.cannons[0]!.id, false);
    s.hour();
    expect(s.sm.statsOf(s.cannons[0]!.id)!.state).toBe('off'); expect(s.sm.statsOf(s.cannons[1]!.id)!.state).toBe('running');
    expect(cannonInfo(b(s), deps(s))).toMatchObject({ status: 'off', switchedOff: true }); expect(cannonInfo(b(s), deps(s)).headline).toMatch(/^Off by you/);
    // same hour with both off: nothing at all
    const t = setup({ cannons: 2 }); t.sm.setAll(t.cannons.map((c) => c.id), false); t.hour();
    expect(snowSum(t)).toBe(0); expect(t.reservoirs.level()).toBe(20000); expect(t.sm.pendingEnergy).toBe(0); expect(t.sm.activeLastHour).toBe(0);
    t.sm.setAll(t.cannons.map((c) => c.id), true); t.hour(); expect(t.sm.activeLastHour).toBe(2);
  });
  it('mode Off mothballs everything; turning cannons on again lifts a global Off', () => {
    const s = setup(); s.sm.setMode('off'); s.hour();
    expect(snowSum(s)).toBe(0); expect(s.sm.isMothballed(s.cannons[0]!.id)).toBe(true); expect(s.sm.statsOf(s.cannons[0]!.id)!.state).toBe('off');
    expect(cannonInfo(b(s), deps(s)).status).toBe('off');
    s.sm.setAll([s.cannons[0]!.id], true); expect(s.sm.mode).toBe('on'); s.hour(); expect(s.sm.statsOf(s.cannons[0]!.id)!.state).toBe('running');
  });
  it('Auto pauses when the snowline is above the covered pistes, with the snowline in the status line, and resumes when it falls', () => {
    const s = setup(); s.sm.setMode('auto');
    s.wx.snowline = 5; s.wx.high = 0; s.hour();
    expect(s.sm.statsOf(s.cannons[0]!.id)!.state).toBe('paused'); expect(snowSum(s)).toBe(0);
    expect(cannonInfo(b(s), deps(s)).headline).toBe('Paused: snowline above this piste (1,420 m)');
    s.wx.snowline = -1; s.hour(); expect(s.sm.statsOf(s.cannons[0]!.id)!.state).toBe('running');
  });
  it('Auto pauses when the daily high is above +4 °C and resumes when it cools', () => {
    const s = setup(); s.sm.setMode('auto');
    s.wx.high = 4.5; s.hour();
    expect(s.sm.statsOf(s.cannons[0]!.id)!.state).toBe('paused'); expect(cannonInfo(b(s), deps(s)).headline).toMatch(/^Paused: too warm.*6\.0 °C/);
    s.wx.high = 4; s.hour(); expect(s.sm.statsOf(s.cannons[0]!.id)!.state).toBe('running');
  });
  it('Auto while the hour is too warm (night not cold enough) says "waiting for cold"; mode On keeps the classic wording', () => {
    const s = setup({ T: 3 }); s.sm.setMode('auto'); s.hour();
    expect(cannonInfo(b(s), deps(s)).headline).toMatch(/^Auto: waiting for cold/);
    const t = setup({ T: 3 }); t.hour(); expect(cannonInfo(b(t), deps(t)).headline).toMatch(/^Idle: too warm/);
  });
  it('mode On ignores the snowline and the daily high (classic behaviour)', () => {
    const s = setup(); s.wx.snowline = 50; s.wx.high = 20; s.hour();
    expect(s.sm.statsOf(s.cannons[0]!.id)!.state).toBe('running');
  });
  it('threshold constant and serialize/load round trip', () => {
    expect(SNOWMAKING.autoMaxHigh).toBe(4); expect(SNOWMAKING.mothballUpkeepShare).toBe(0.15);
    const s = setup(); s.sm.setMode('auto'); s.sm.setCannon(7, false);
    const d = s.sm.serializeState()!; expect(d).toEqual({ mode: 'auto', off: [7] });
    const t = setup(); t.sm.loadState(JSON.parse(JSON.stringify(d))); expect(t.sm.mode).toBe('auto'); expect(t.sm.isSwitchedOff(7)).toBe(true);
    t.sm.loadState(undefined); expect(t.sm.mode).toBe('on'); expect(t.sm.offCount()).toBe(0);
    t.sm.loadState({ mode: 'bogus' as never }); expect(t.sm.mode).toBe('on');
  });
});

describe('snowmaking mode in the full sim', () => {
  const cannonIds = (sim: ReturnType<typeof makeResort>['sim']): number[] => sim.buildings.all().filter((x) => x.type === 'snowCannon').map((x) => x.id);

  it('mothballed cannons cost 15% upkeep (less than running ones), default costs unchanged', () => {
    const a = makeResort(64, 7, { startDay: 167 }).sim, c = makeResort(64, 7, { startDay: 167 }).sim;
    expect(cannonIds(a).length).toBeGreaterThan(0);
    c.ops.snowmaking.setAll(cannonIds(c), false);
    run(a, { days: 2 }); run(c, { days: 2 });
    expect(c.economy.expenses.upkeep).toBeLessThan(a.economy.expenses.upkeep);
    const full = cannonIds(a).reduce((t) => t + BUILDINGS.snowCannon!.upkeep, 0) * a.difficulty.upkeep;
    const saved = a.economy.expenses.upkeep - c.economy.expenses.upkeep;
    expect(saved).toBeGreaterThan(0.5 * full); expect(saved).toBeLessThanOrEqual(2 * full * 0.85 + 1e-6);
  });

  it('the default (On, nothing off) saves no snowmaking data, so existing saves and hashes are unchanged', () => {
    const { sim } = makeResort(64, 3, { startDay: 167 });
    expect((sim.ops.system.serialize!() as { sm?: unknown }).sm).toBeUndefined();
    sim.ops.snowmaking.setMode('auto');
    expect((sim.ops.system.serialize!() as { sm?: unknown }).sm).toEqual({ mode: 'auto', off: [] });
  });

  it('save/load keeps the mode and switches; the loaded sim stays identical to the control', async () => {
    const { sim } = makeResort(64, 3, { startDay: 167 });
    run(sim, { days: 1.2 });
    const ids = cannonIds(sim); sim.ops.snowmaking.setMode('auto'); if (ids[0] !== undefined) sim.ops.snowmaking.setCannon(ids[0], false);
    const { bytes } = await encodeSave(sim, makeMeta(sim, 't'), { compress: true, yieldBetween: false });
    const { envelope } = await decodeSave(bytes, { yieldBetween: false });
    expect(envelope.modules['sys.ops']).toBeDefined();
    const restored = createSim({ size: envelope.mapSize, seed: envelope.seed, now: () => 0, fromSave: structuredClone(envelope.modules) });
    expect(restored.ops.snowmaking.mode).toBe('auto'); expect(restored.ops.snowmaking.isSwitchedOff(ids[0]!)).toBe(true);
    applySave(sim, structuredClone(envelope.modules));
    for (let d = 0; d < 2 * TICKS_PER_DAY; d += 40) {
      sim.ops.quality.attachTraffic(); sim.tick(40); restored.ops.quality.attachTraffic(); restored.tick(40);
      const x = stateHash(sim).parts, y = stateHash(restored).parts;
      expect(Object.keys(x).filter((k) => x[k] !== y[k])).toEqual([]);
    }
  });

  it('a pre-feature save (no snowmaking data) loads as On / all cannons on', () => {
    const { sim } = makeResort(64, 3, { startDay: 167 });
    const data = JSON.parse(JSON.stringify(sim.ops.system.serialize!())) as { sm?: unknown };
    delete data.sm; sim.ops.snowmaking.setMode('off');
    sim.ops.system.load!(data);
    expect(sim.ops.snowmaking.mode).toBe('on'); expect(sim.ops.snowmaking.offCount()).toBe(0);
  });

  it('deterministic: same seed + same inputs give the same hash', () => {
    const go = (): string => { const { sim } = makeResort(64, 5, { startDay: 167 }); sim.ops.snowmaking.setMode('auto'); run(sim, { days: 2 }); return JSON.stringify(stateHash(sim).parts); };
    expect(go()).toBe(go());
  });

  it('advisor: warm resort on On -> "snowmaking is wasting money"; Auto/Off silences it; cold snap with cannons off -> "turn snowmaking on"', () => {
    const { sim } = makeResort(64, 3, { startDay: 167 });
    const ids = (): string[] => { sim.advisor.evaluate(true, true); return sim.advisor.ranked().map((a) => a.id); };
    sim.weather.current.snowline = 1e6; // above every piste
    expect(ids()).toContain('snow.mode');
    const a = sim.advisor.ranked().find((x) => x.id === 'snow.mode')!;
    expect(a.why.toString()).toMatch(/wasting money/);
    sim.ops.snowmaking.setMode('auto'); expect(ids()).not.toContain('snow.mode');
    sim.ops.snowmaking.setMode('off'); expect(ids()).not.toContain('snow.mode'); // warm: staying off is right
    sim.weather.current.snowline = -1e6; sim.weather.current.valleyT = -15; // cold snap
    expect(ids()).toContain('snow.mode');
    expect(JSON.stringify(sim.advisor.ranked().find((x) => x.id === 'snow.mode'))).toMatch(/Cold snap/);
    sim.ops.snowmaking.setMode('on'); expect(ids()).not.toContain('snow.mode');
  });
});
