import { describe, expect, it } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { createDefaultRegistry, stateHash } from '../../src/sim/Systems';
import { Weather, SnowCover, createWeatherSystem, meltFactor, WaterStock } from '../../src/sim/Weather';
import { TileConditions } from '../../src/sim/TileConditions';
import { worldScaleFor } from '../../src/sim/Season';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { DAYS_PER_YEAR, SYSTEM_BUDGET_MS, TICKS_PER_SECOND } from '../../src/config/balance';
import { rampGrid, runDays, world } from './snowHelpers';
import { budget } from '../perfMode';

describe('Weather', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const run = (seed: number) => {
      const sc = worldScaleFor(64), d = { year: 1, day: 120, minute: 0, tick: 0 };
      const w = new Weather(seed, sc, d);
      const out: string[] = [];
      for (let i = 0; i < 120; i++) { d.day = (d.day + 1) % DAYS_PER_YEAR; w.rollDay(d); out.push(`${w.current.kind}:${w.current.valleyT.toFixed(3)}`); }
      return out.join('|');
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });
  it('produces snow in winter and mixes in rain only in warm seasons; temperature follows the season', () => {
    const sc = worldScaleFor(64), d = { year: 1, day: 0, minute: 0, tick: 0 };
    const w = new Weather(3, sc, d);
    const kinds = new Map<string, number>(), winterT: number[] = [], summerT: number[] = [];
    for (let i = 0; i < DAYS_PER_YEAR * 4; i++) {
      d.day = (d.day + 1) % DAYS_PER_YEAR; w.rollDay(d);
      kinds.set(w.current.kind, (kinds.get(w.current.kind) ?? 0) + 1);
      if (d.day >= 135 && d.day < 165) { winterT.push(w.current.valleyT); expect(['rain', 'storm']).not.toContain(w.current.kind); }
      if (d.day >= 50 && d.day < 70) { summerT.push(w.current.valleyT); expect(['snow', 'heavySnow']).not.toContain(w.current.kind); }
    }
    for (const k of ['clear', 'cloudy', 'snow', 'heavySnow', 'rain']) expect(kinds.get(k) ?? 0).toBeGreaterThan(0);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(summerT)).toBeGreaterThan(avg(winterT) + 12);
  });
  it('lapse rate: higher tiles are colder; hourly swing peaks in the afternoon', () => {
    const sc = worldScaleFor(64), w = new Weather(1, sc, { year: 1, day: 50, minute: 0, tick: 0 });
    expect(w.temperatureAt(sc.baseWorld + 10)).toBeLessThan(w.temperatureAt(sc.baseWorld));
    expect(w.valleyTempAt(15)).toBeGreaterThan(w.valleyTempAt(3));
  });
});

describe('Snow cover', () => {
  it('winter: snow everywhere, deepest high; melt slower on north-facing tiles', () => {
    const w = world(11);
    runDays(w, 30); // winter: day 120 -> 150
    const hi = w.cond.depth(60, 30), lo = w.cond.depth(3, 30);
    expect(hi).toBeGreaterThan(0.3);
    expect(lo).toBeGreaterThanOrEqual(0);
    const g = new Grid(64);
    // tile A: rises toward +y (downhill faces north), tile B: rises toward -y (faces south); same altitude
    g.setCornerUnchecked(11, 11, 20); g.setCornerUnchecked(12, 11, 20); g.setCornerUnchecked(11, 12, 21); g.setCornerUnchecked(12, 12, 21);
    g.setCornerUnchecked(31, 31, 21); g.setCornerUnchecked(32, 31, 21); g.setCornerUnchecked(31, 32, 20); g.setCornerUnchecked(32, 32, 20);
    expect(meltFactor(g, 11, 11, 0.5)).toBeLessThan(meltFactor(g, 31, 31, 0.5));
  });
  it('only marks snow chunks dirty (no height rebuild)', () => {
    const w = world(11);
    w.grid.consumeSnowDirtyChunks(); w.grid.consumeDirtyChunks();
    runDays(w, 3);
    expect(w.grid.consumeDirtyChunks()).toEqual([]);
    expect(w.grid.consumeSnowDirtyChunks().length).toBeGreaterThan(0);
  });
  it('snowmaking adds depth in cannon coverage only when cold and the reservoir has water', () => {
    const mk = (water: number, valleyT: number) => {
      const grid = rampGrid(64), cond = new TileConditions(grid), sc = worldScaleFor(64);
      const weather = new Weather(1, sc, { year: 1, day: 150, minute: 0, tick: 0 });
      weather.current = { ...weather.current, kind: 'clear', intensity: 0, valleyT };
      const cover = new Uint8Array(64 * 64); cover[grid.tileIndex(10, 10)] = 1;
      const stock = new WaterStock(1000, 0); stock.level = water;
      const snow = new SnowCover(grid, cond, weather, { snowmaking: () => cover, water: stock });
      snow.updateRows(0, 64, 1);
      return { d: grid.snowDepth[grid.tileIndex(10, 10)]!, d2: grid.snowDepth[grid.tileIndex(11, 10)]!, stock };
    };
    const ok = mk(500, -10);
    expect(ok.d).toBeGreaterThan(0.2); expect(ok.d2).toBe(0); expect(ok.stock.level).toBeLessThan(500);
    expect(mk(0, -10).d).toBe(0);
    expect(mk(500, 8).d).toBe(0);
  });
  it('same seed -> same snow hash after N days, different seed differs', () => {
    const a = world(21), b = world(21), c = world(22);
    runDays(a, 75); runDays(b, 75); runDays(c, 75);
    expect(a.snow.hash()).toBe(b.snow.hash());
    expect(a.snow.hash()).not.toBe(c.snow.hash());
  });
  it('is independent of step size: per-tick row slices (weather system) == whole-day updates', () => {
    const days = 20;
    const whole = world(33);
    runDays(whole, days);
    const sliced = world(33);
    const reg = createDefaultRegistry();
    reg.replace(createWeatherSystem(sliced.weather, sliced.snow));
    sliced.state.date.tick = 0;
    // clock system advances state.date; day boundaries land on tick multiples of 240
    for (let t = 0; t < 240 * days + 1; t++) reg.update(sliced.state, t);
    // the extra tick rolled day `days` but its first slice covers zero rows, so the maps must match exactly
    expect(sliced.snow.hash()).toBe(whole.snow.hash());
  });
  it('stateHash stays deterministic with the weather system registered', () => {
    const run = () => {
      const w = world(40);
      const reg = createDefaultRegistry();
      reg.replace(createWeatherSystem(w.weather, w.snow));
      for (let t = 0; t < 240 * 5; t++) reg.update(w.state, t);
      return stateHash(w.state, reg) + w.snow.hash();
    };
    expect(run()).toBe(run());
  });
  it('emits weather:changed on kind changes', () => {
    const w = world(41);
    const bus = new EventBus<GameEvents>();
    const seen: string[] = [];
    bus.on('weather:changed', (e) => seen.push(e.kind));
    const reg = createDefaultRegistry(bus);
    reg.replace(createWeatherSystem(w.weather, w.snow, { bus }));
    for (let t = 0; t < 240 * 30; t++) reg.update(w.state, t);
    expect(seen.length).toBeGreaterThan(2);
  });
  it('[perf] 256 map: snow update per tick within the system budget (measured)', () => {
    const w = world(5, 256);
    const reg = createDefaultRegistry();
    reg.replace(createWeatherSystem(w.weather, w.snow));
    const times: number[] = [];
    const sys = reg.get('weather')!;
    for (let t = 0; t < 240 * 3; t++) {
      // advance the clock via the registry's clock system, time only the weather system
      reg.get('clock')!.update(w.state, t);
      const t0 = performance.now();
      sys.update(w.state, t);
      times.push(performance.now() - t0);
    }
    const sorted = [...times].sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    // eslint-disable-next-line no-console
    console.log(`[perf] 256 snow/weather system per tick: avg ${avg.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, max ${sorted[sorted.length - 1]!.toFixed(3)} ms (budget ${SYSTEM_BUDGET_MS} ms; ${TICKS_PER_SECOND} ticks/s)`);
    expect(p95).toBeLessThan(budget(SYSTEM_BUDGET_MS));
  });
});
