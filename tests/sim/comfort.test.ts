import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { GuestStore } from '../../src/sim/guests/Guest';
import { NEEDS, tickNeeds, happinessTarget, NEUTRAL_ENV } from '../../src/sim/guests/Needs';
import { BUILDINGS } from '../../src/config/buildings';
import { ATTRACTION_SPECS } from '../../src/sim/attractions/registry';

const mkStore = (): { s: GuestStore; i: number } => {
  const s = new GuestStore(8);
  const i = s.add({ x: 1, y: 1, z: 0, type: 0, skill: 1, mode: 0, budget: 500, group: 0, overnight: false, leaveDay: 99, tick: 0 } as never);
  return { s, i };
};

describe('comfort need (Phase 6 Task 7)', () => {
  it('the urge only grows when the need is on (flag off = old needs)', () => {
    const a = mkStore(), b = mkStore();
    for (let k = 0; k < 100; k++) { tickNeeds(a.s, a.i, { ...NEUTRAL_ENV }); tickNeeds(b.s, b.i, { ...NEUTRAL_ENV, comfort: true }); }
    expect(a.s.urge[a.i]).toBe(0);
    expect(b.s.urge[b.i]!).toBeGreaterThan(0.3);
  });
  it('an unmet urge costs happiness, capped', () => {
    const t0 = happinessTarget(0, 0, NEUTRAL_ENV, 0), t1 = happinessTarget(0, 0, NEUTRAL_ENV, 1);
    expect(t0 - t1).toBeGreaterThan(0.1);
    expect(t0 - t1).toBeLessThanOrEqual(NEEDS.urgePenalty + 1e-9);
  });
  it('hash / save stay identical while nobody has an urge, and an old save loads comfortable', () => {
    const a = mkStore(), b = mkStore();
    expect(a.s.hash()).toBe(b.s.hash());
    expect(a.s.serialize().cols.urge).toBeUndefined();
    b.s.urge[b.i] = 0.7;
    const d = b.s.serialize();
    expect(d.cols.urge![b.i]).toBeCloseTo(0.7);
    const c = new GuestStore(8); c.load(d); expect(c.urge[b.i]).toBeCloseTo(0.7);
    const old = a.s.serialize(); const e = new GuestStore(8); e.load(old); expect(e.urge[a.i]).toBe(0);
  });
  it('toilets: 1x1, path / trail / piste edge, free, upkeep 3, 4 slots', () => {
    const d = BUILDINGS.toilets!;
    expect([d.w, d.h, d.upkeep]).toEqual([1, 1, 3]);
    expect([d.access, ...(d.altAccess ?? [])].sort()).toEqual(['pisteEdge', 'path', 'trail'].sort());
    expect(ATTRACTION_SPECS.toilets!.slots).toBe(4);
    expect(ATTRACTION_SPECS.toilets!.effects.urgeTo).toBe(0);
  });
  it('the starter resort gets one free toilet; guests use it and the urge drops', () => {
    const sim = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', now: () => 0 });
    expect(sim.buildings.all().filter((b) => b.type === 'toilets')).toHaveLength(1);
    const off = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', comfortNeed: false, now: () => 0 });
    expect(off.buildings.all().filter((b) => b.type === 'toilets')).toHaveLength(0);
    sim.tick(240 * 4);
    const t = sim.attractions.all().find((a) => a.b.type === 'toilets')!;
    expect(t.stats.served).toBeGreaterThan(0);
  });
  it('guests in need walk to the toilet and are relieved; without one they stay desperate', () => {
    // a handful of guests is awake at this hour: average a few seeds so a different arrival draw (new guest types) cannot flip a 3-guest sample
    const run = (withToilet: boolean): number => [61, 7, 5].reduce((a, seed) => a + runOne(withToilet, seed), 0) / 3;
    const runOne = (withToilet: boolean, seed: number): number => {
      const sim = createSim({ size: 64, seed, starterResort: true, mode: 'sandbox', now: () => 0 });
      if (!withToilet) { for (const b of sim.buildings.all().filter((x) => x.type === 'toilets')) sim.buildings.remove(b.id); sim.refreshCoverage(undefined, true); }
      sim.tick(240 * 6 + 120);
      const s = sim.guestSim.store;
      for (let i = 0; i < s.limit; i++) if (s.alive[i]) s.urge[i] = 0.9;
      const ids = new Set<number>(); for (let i = 0; i < s.limit; i++) if (s.alive[i]) ids.add(s.id[i]!);
      sim.tick(40);
      let u = 0, n = 0;
      for (const id of ids) { const i = s.slotOf(id); if (i >= 0 && !sim.guestSim.families.controls(i)) { u += s.urge[i]!; n++; } } // kids of a family / school class are driven by the family system (never walk to a toilet themselves)
      return n ? u / n : 1;
    };
    expect(run(true)).toBeLessThan(run(false) - 0.05);
  });
});
