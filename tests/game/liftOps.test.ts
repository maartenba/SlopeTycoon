import { DAYS_PER_YEAR } from '@/config/balance';
import { describe, expect, it } from 'vitest';
import { attachCounters, fullHash, makeResort, run, scanProblems, StallTracker, TICKS_PER_DAY } from './harness';
import { LIFT_OPS } from '../../src/config/liftOps';
import type { Sim } from '../../src/game/createSim';

const worn = (sim: Sim): void => { for (const l of sim.lifts.all()) { sim.liftOps.ops(l).condition = 30; } };

describe('lift operations in the full sim', () => {
  it('a year on the starter resort with breakdowns on: no NaN, no stuck lifts/strands, breakdowns happen and get repaired', () => {
    const { sim } = makeResort(64, 1, { defaultHours: true });
    worn(sim);
    const c = attachCounters(sim);
    const ev = { broken: 0, repaired: 0, stranded: 0 };
    sim.bus.on('lift:broken', () => ev.broken++); sim.bus.on('lift:repaired', () => ev.repaired++); sim.bus.on('incident:stranded', () => ev.stranded++);
    const stall = new StallTracker(sim);
    const problems = run(sim, { days: DAYS_PER_YEAR, scanEvery: 240, stall });
    expect(problems).toEqual([]);
    expect(ev.broken).toBeGreaterThan(0);
    // every breakdown but a possibly in-progress one has been repaired
    expect(ev.repaired).toBeGreaterThanOrEqual(ev.broken - sim.lifts.size);
    for (const l of sim.lifts.all()) {
      const f = sim.liftOps.ops(l).fault;
      if (f) expect(f.endTick - sim.game.date.tick).toBeLessThan(TICKS_PER_DAY * 2);
      expect(Number.isFinite(sim.liftOps.ops(l).condition)).toBe(true);
    }
    expect(sim.safety.incidents.open.filter((i) => i.kind === 'stranded' && sim.safety.incidents.nowTick - i.createdTick > 100)).toEqual([]);
    expect(Number.isFinite(sim.game.money)).toBe(true);
    expect(sim.economy.expenses.maintenance).toBeGreaterThan(0);
    expect(c.rides).toBeGreaterThan(0);
    expect(scanProblems(sim)).toEqual([]);
  }, 400000);

  it('is deterministic: two identical runs with breakdowns end in the same state', () => {
    const go = (): string => { const { sim } = makeResort(64, 7, { defaultHours: true }); worn(sim); run(sim, { days: 40, scanEvery: 1000 }); return fullHash(sim) + JSON.stringify(sim.lifts.all().map((l) => sim.liftOps.ops(l).breakdowns)); };
    expect(go()).toBe(go());
  }, 120000);

  it('stranded guests on a broken lift are evacuated by the real patrol; without a patrol hub the crew does it later', () => {
    const trial = (patrol: boolean): { evac: number; stranded: number; guestsLeftOnCable: number } => {
      const { sim } = makeResort(64, 1, { defaultHours: true });
      if (!patrol) for (const b of sim.buildings.all().filter((x) => ['patrolHub', 'firstAid', 'helipad'].includes(x.type))) sim.buildings.remove(b.id);
      sim.safety.resync();
      const lift = sim.lifts.all()[0]!;
      // run until somebody is riding
      let guard = 0;
      while (sim.guestSim.queues.ridersOn(lift.id) < 2 && guard++ < TICKS_PER_DAY * 3) sim.tick(1);
      const stranded = sim.guestSim.queues.ridersOn(lift.id);
      expect(stranded).toBeGreaterThanOrEqual(2);
      const t0 = sim.game.date.tick;
      expect(sim.liftOps.forceBreakdown(lift.id)).toBe(true);
      let evac = -1;
      for (let t = 0; t < 100 && evac < 0; t++) { sim.tick(1); if (lift.evac || !sim.liftOps.ops(lift).fault) evac = sim.game.date.tick - t0; }
      sim.tick(2);
      return { evac, stranded, guestsLeftOnCable: sim.guestSim.queues.ridersOn(lift.id) };
    };
    const a = trial(true), b = trial(false);
    expect(a.evac).toBeGreaterThan(0);
    expect(b.evac).toBeGreaterThan(0);
    expect(a.evac).toBeLessThanOrEqual(b.evac);
    expect(b.evac).toBeLessThanOrEqual(LIFT_OPS.stranded.selfEvacTicksNoWorkshop + 2);
    expect(a.guestsLeftOnCable).toBeLessThanOrEqual(a.stranded);
  }, 120000);

  it('without a workshop repairs use the slower contractor timing (A/B is covered in LiftOps.test.ts)', () => {
    const { sim } = makeResort(64, 1, { defaultHours: true });
    const lift = sim.lifts.all()[0]!;
    sim.liftOps.ops(lift).condition = 50;
    sim.tick(5);
    sim.liftOps.forceBreakdown(lift.id);
    const st = sim.liftOps.status(lift.id)!;
    expect(st.hasWorkshop).toBe(false);
    expect(st.repairEtaHours).toBeGreaterThan(5);
  }, 60000);

  it('guests do not queue at closed lifts: closing a lift empties its queue', () => {
    const { sim } = makeResort(64, 1, { defaultHours: true });
    const lift = sim.lifts.all()[0]!;
    let g = 0;
    while (sim.guestSim.queues.queueLength(lift.id) + sim.guestSim.queues.ridersOn(lift.id) < 3 && g++ < TICKS_PER_DAY * 3) sim.tick(1);
    sim.liftOps.setMode(lift.id, 'closed');
    sim.tick(2);
    expect(lift.open).toBe(false);
    expect(sim.guestSim.queues.queueLength(lift.id)).toBe(0);
  }, 60000);
});
