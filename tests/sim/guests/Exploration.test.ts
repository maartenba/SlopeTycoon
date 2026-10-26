import { describe, expect, it } from 'vitest';
import { buildSkiResort, measureSki, gini } from '../../../scripts/analysis/skiLib';
import { EXPLORE, NAV_SPEED, NAV_SPEED_LEGACY } from '@/config/balance';
import { Exploration } from '@/sim/guests/Exploration';
import { GuestStore } from '@/sim/guests/Guest';
import { GuestType } from '@/sim/guests/Guest';
import { pisteReport } from '@/sim/PisteStats';

/**
 * Skier exploration (docs/ski-exploration.md), fixed seeds, thresholds with margin. Measured (4 winter days, bot resort 5 lifts, mean of seeds 1/7):
 * before: 64: runs/guest-day 1.8, pistes/guest-day 1.4, 1-piste share 60 %; 128: 1.5 / 1.3 / 74 %.  after: 64: 4.4 / 3.1 / 5 %; 128: 3.1 / 2.3 / 9 %.
 */
describe('Exploration: lift memory / novelty', () => {
  const mk = (skill: number): { s: GuestStore; i: number; e: Exploration } => {
    const s = new GuestStore(8), i = s.add({ x: 1, y: 1, z: 0, type: GuestType.Solo, skill, budget: 100, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0 });
    return { s, i, e: new Exploration(() => null, 16) };
  };
  it('remembers the last three lifts (newest first) and penalises re-riding them, most for the most recent', () => {
    const { s, i, e } = mk(2);
    e.remember(s, i, 4); e.remember(s, i, 5); e.remember(s, i, 6); e.remember(s, i, 7);
    expect([s.recA[i], s.recB[i], s.recC[i]]).toEqual([8, 7, 6]);
    expect(e.noveltyPenalty(s, i, 7)).toBeGreaterThan(e.noveltyPenalty(s, i, 6));
    expect(e.noveltyPenalty(s, i, 6)).toBeGreaterThan(e.noveltyPenalty(s, i, 5));
    expect(e.noveltyPenalty(s, i, 4)).toBe(0); // forgotten
    expect(e.noveltyPenalty(s, i, 99)).toBe(0);
  });
  it('experts / intermediates care more than beginners; disabling it removes the term', () => {
    const a = mk(0), b = mk(2);
    a.e.remember(a.s, a.i, 1); b.e.remember(b.s, b.i, 1);
    expect(b.e.noveltyPenalty(b.s, b.i, 1)).toBeGreaterThan(a.e.noveltyPenalty(a.s, a.i, 1));
    b.e.enabled = false; expect(b.e.noveltyPenalty(b.s, b.i, 1)).toBe(0);
  });
  it('slot reuse clears the memory (new guest) and the memory is part of the saved columns', () => {
    const { s, i, e } = mk(1);
    e.remember(s, i, 3); s.via[i] = 77;
    const saved = s.serialize(); expect(saved.cols.recA![i]).toBe(4); expect(saved.cols.via![i]).toBe(77);
    s.remove(i); const j = s.add({ x: 1, y: 1, z: 0, type: GuestType.Solo, skill: 1, budget: 100, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0 });
    expect([s.recA[j], s.recB[j], s.recC[j], s.via[j]]).toEqual([0, 0, 0, 0]);
    const t = new GuestStore(8); t.load(saved); expect(t.recA[i]).toBe(4); expect(t.via[i]).toBe(77);
  });
  it('gini helper', () => { expect(gini([1, 1, 1, 1])).toBeCloseTo(0, 9); expect(gini([0, 0, 0, 10])).toBeCloseTo(0.75, 9); });
});

describe('Exploration: piste report counts runs', () => {
  it('runsToday sums the per-tile counters over the piste tiles', () => {
    const e = new Exploration(() => null, 8);
    e.recordVia(3); e.recordVia(3); e.recordVia(10);
    expect(e.runsAt([1, 3, 4])).toBe(2);
    const comp = { id: 1, tiles: [3, 10], count: 2, topAlt: 2, bottomAlt: 1, top: { x: 0, y: 0 }, bottom: { x: 1, y: 1 }, touchesLift: true, touchesPath: true, touchesBuilding: false, main: true, disconnected: false } as never;
    const r = pisteReport(comp, { difficulty: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1], quality: { at: () => 0 }, status: () => undefined, runsAt: (t) => e.runsAt(t) });
    expect(r.runsToday).toBe(3);
  });
});

describe('Exploration: measured on the winter bot resort (fixed seeds)', () => {
  it('skiers spread over the pistes, ride several of them per day, and complete more runs than before', () => {
    // measured with the 150 s day (docs/time-flow.md): 64/1 2.45 pistes, 20 % one-piste, 2.55 runs; 64/7 2.2, 31 %, 1.97; 128/1 1.9, 50 %, 1.8 (walking-bound)
    for (const [size, seed, minPistes, minRuns, maxOne] of [[64, 1, 2.0, 2.2, 0.35], [64, 7, 2.0, 1.8, 0.4], [128, 1, 1.6, 1.5, 0.6]] as const) {
      const { sim } = buildSkiResort(size, seed, 5);
      const m = measureSki(sim, 4, size, seed);
      expect(m.pistes, `${size}/${seed} pistes`).toBeGreaterThanOrEqual(4);
      expect(m.skiers, `${size}/${seed} skiers`).toBeGreaterThan(15);
      expect(m.distinctPistes, `${size}/${seed} pistes per guest`).toBeGreaterThan(minPistes);
      expect(m.piste1Share, `${size}/${seed} one-piste share`).toBeLessThan(maxOne);
      expect(m.giniPiste, `${size}/${seed} gini pistes`).toBeLessThan(0.5);
      expect(m.shareRidden10, `${size}/${seed} pistes ridden by >=10% of skiers`).toBeGreaterThanOrEqual(0.75);
      expect(m.runsPerGuestDay, `${size}/${seed} runs`).toBeGreaterThan(minRuns);
      expect(sim.guestSim.exploration.withVia, 'via lines used').toBeGreaterThan(20);
    }
  }, 120000);
  it('single-lift starter resort: one line per lift is no more (tile coverage and tile spread improve)', () => {
    const run = (on: boolean): ReturnType<typeof measureSki> => {
      const { sim } = buildSkiResort(128, 1, 1);
      sim.guestSim.exploration.enabled = on;
      return measureSki(sim, 4, 128, 1);
    };
    const on = run(true), off = run(false);
    expect(on.coverage).toBeGreaterThan(off.coverage * 1.15);
    expect(on.giniTile).toBeLessThan(off.giniTile);
  }, 120000);
  it('A/B vs the legacy speeds + no exploration: faster runs, and (with the 150 s day) still >2 runs per guest-day', () => {
    const ns = NAV_SPEED as unknown as { walk: number; skiBase: number; skiFlat: number }, ex = EXPLORE as unknown as { visitPause: number[]; runPause: number[] };
    const keep = { ...ns, v: [...ex.visitPause], r: [...ex.runPause] };
    const run = (legacy: boolean): ReturnType<typeof measureSki> => {
      const { sim } = buildSkiResort(64, 1, 1);
      if (legacy) { Object.assign(ns, NAV_SPEED_LEGACY); ex.visitPause = [10, 40]; ex.runPause = [2, 8]; sim.guestSim.exploration.enabled = false; }
      try { return measureSki(sim, 4, 64, 1); } finally { Object.assign(ns, { walk: keep.walk, skiBase: keep.skiBase, skiFlat: keep.skiFlat }); ex.visitPause = keep.v; ex.runPause = keep.r; }
    };
    const after = run(false), before = run(true);
    // the 150 s day (docs/time-flow.md) trades runs per day for watchable speeds: ~-40 % vs the 24 s-day arcade speeds on the 64 map
    expect(after.runsPerGuestDay).toBeGreaterThan(before.runsPerGuestDay * 0.45);
    expect(after.runsPerGuestDay).toBeGreaterThan(2);
    expect(after.minPerRun).toBeLessThan(before.minPerRun * 0.8);
  }, 120000);
  it('is deterministic (same seed -> identical metrics)', () => {
    const a = measureSki(buildSkiResort(64, 7, 5).sim, 2, 64, 7), b = measureSki(buildSkiResort(64, 7, 5).sim, 2, 64, 7);
    expect(a).toEqual(b);
  }, 120000);
});
