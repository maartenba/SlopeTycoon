import { describe, expect, it } from 'vitest';
import { FrameStats, PerfBench, defaultSchedule, type BenchDriver, type BenchSample } from '../../src/render/PerfStats';
import { GRAPHICS_QUALITIES, QUALITY_PRESETS, defaultQuality, pixelRatioFor } from '../../src/config/balance';
import { SystemRegistry } from '../../src/sim/Systems';

describe('FrameStats', () => {
  it('avg fps, p99 and the 1 % low', () => {
    const s = new FrameStats(1000);
    for (let i = 0; i < 99; i++) s.push(10);
    s.push(50);
    const r = s.summary();
    expect(r.frames).toBe(100);
    expect(r.avgMs).toBeCloseTo(10.4, 5);
    expect(r.fps).toBeCloseTo(1000 / 10.4, 3);
    expect(r.fpsLow1).toBeCloseTo(20, 5); // slowest 1 % of 100 frames = the single 50 ms frame
    expect(r.maxMs).toBe(50);
  });
  it('ring buffer keeps the newest frames and ignores garbage', () => {
    const s = new FrameStats(4);
    for (const v of [100, 100, 100, 100, 10, 10, 10, 10, NaN, -1, 0]) s.push(v);
    expect(s.count).toBe(4);
    expect(s.summary().avgMs).toBe(10);
    expect(new FrameStats().summary().fps).toBe(0);
  });
});

describe('PerfBench', () => {
  const sample: BenchSample = { calls: 50, triangles: 200000, geometries: 30, textures: 12, tickAvgMs: 0.5, tickP95Ms: 1.2, guests: 900, heapMB: 80 };
  const mk = (): { drv: BenchDriver; log: string[] } => {
    const log: string[] = [];
    return { log, drv: { setSpeed: (s) => log.push(`speed ${s}`), setView: (v, p) => { if (p === 0) log.push(`view ${v}`); }, restore: () => log.push('restore'), sample: () => sample } };
  };
  it('runs the near/mid/far x speed 1/3 schedule, restores, and prints a table + JSON', () => {
    const { drv, log } = mk();
    const b = new PerfBench(drv, defaultSchedule(1000));
    let now = 0;
    b.start(now);
    while (!b.done && now < 20000) { now += 16; b.frame(now, 16); }
    expect(b.done).toBe(true);
    expect(b.results.map((r) => `${r.view}@${r.speed}`)).toEqual(['near@1', 'mid@1', 'far@1', 'near@3', 'mid@3', 'far@3']);
    expect(log.filter((l) => l.startsWith('speed')).length).toBe(6);
    expect(log[log.length - 1]).toBe('restore');
    for (const r of b.results) { expect(r.fps).toBeGreaterThan(55); expect(r.calls).toBe(50); expect(r.guests).toBe(900); }
    expect(b.table().split('\n')).toHaveLength(7);
    expect(JSON.parse(b.json()).results).toHaveLength(6);
  });
  it('default flythrough is ~20 s per speed', () => {
    expect(defaultSchedule().filter((s) => s.speed === 1).reduce((a, s) => a + s.ms, 0)).toBeGreaterThan(19000);
  });
  it('cancel restores immediately', () => {
    const { drv, log } = mk();
    const b = new PerfBench(drv, defaultSchedule(1000));
    b.start(0); b.frame(100, 16); b.cancel();
    expect(b.active).toBe(false);
    expect(log[log.length - 1]).toBe('restore');
  });
});

describe('graphics quality presets', () => {
  it('shadows only on high; presets get monotonically more expensive', () => {
    expect(QUALITY_PRESETS.low.shadows).toBe(false);
    expect(QUALITY_PRESETS.med.shadows).toBe(false);
    const k: Array<keyof typeof QUALITY_PRESETS.low> = ['pixelRatioCap', 'lodScale', 'treeDensity', 'particles', 'guestFarScale'];
    for (const key of k) for (let i = 1; i < GRAPHICS_QUALITIES.length; i++) expect(QUALITY_PRESETS[GRAPHICS_QUALITIES[i]!][key] as number).toBeGreaterThanOrEqual(QUALITY_PRESETS[GRAPHICS_QUALITIES[i - 1]!][key] as number);
  });
  it('default by map size / dpr, never high, pixel ratio capped', () => {
    expect(defaultQuality(256, 1)).toBe('low');
    expect(defaultQuality(128, 1)).toBe('med');
    expect(defaultQuality(64, 2)).toBe('med');
    expect(defaultQuality(64, 3)).toBe('low');
    expect(pixelRatioFor('low', 3)).toBe(1);
    expect(pixelRatioFor('med', 3)).toBe(1.5);
    expect(pixelRatioFor('high', 3)).toBe(2);
    expect(pixelRatioFor('high', 1)).toBe(1);
  });
});

describe('SystemRegistry profiler', () => {
  it('tickStats + topSystems', () => {
    let t = 0;
    const r = new SystemRegistry(() => t);
    r.register({ id: 'clock', update: () => { t += 1; } });
    r.register({ id: 'guests', update: () => { t += 3; } });
    const st = { } as never;
    for (let i = 0; i < 10; i++) r.update(st, i);
    expect(r.tickStats().avgMs).toBe(4);
    expect(r.topSystems(1)[0]!.id).toBe('guests');
  });
});
