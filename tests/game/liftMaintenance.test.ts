import { describe, expect, it } from 'vitest';
import { makeResort, run, TICKS_PER_DAY } from './harness';
import { createSim, type Sim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { applySave, stateHash } from '../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { DAYS_PER_YEAR } from '../../src/config/balance';

const step = (s: Sim, n: number): void => { s.ops.quality.attachTraffic(); s.tick(n); };

describe('planned lift maintenance in a running game', () => {
  it('Auto: every lift is serviced in April, only while empty, guests are never stranded, and it is booked as maintenance', () => {
    const { sim } = makeResort(64, 1, { startDay: 100 }); // ~80 days before 1 April: past the 60-day commissioning gap
    const started: Array<{ id: number; riders: number; queue: number }> = [], done: number[] = [];
    sim.bus.on('lift:serviceStarted', (e) => started.push({ id: e.id, riders: sim.guestSim.queues.ridersOn(e.id), queue: sim.guestSim.queues.queueLength(e.id, 0) }));
    sim.bus.on('lift:serviced', (e) => done.push(e.id));
    let soon = 0; sim.bus.on('ops:serviceSoon', () => soon++);
    expect(run(sim, { days: 100 })).toEqual([]);
    const n = sim.lifts.all().length;
    expect(n).toBeGreaterThan(0);
    expect(started.length).toBe(n); expect(done.length).toBe(n); expect(soon).toBe(1);
    for (const s of started) { expect(s.riders).toBe(0); expect(s.queue).toBe(0); }
    for (const l of sim.lifts.all()) { expect(l.ops!.maint!.count).toBe(1); expect(l.ops!.fault).toBeNull(); }
  });
  it('save -> load in the middle of a service continues bit-identically', async () => {
    const { sim } = makeResort(64, 1, { startDay: 160 });
    let guard = 0;
    while (!sim.lifts.all().some((l) => l.ops?.fault?.kind === 'service') && guard++ < 30 * TICKS_PER_DAY) step(sim, 10);
    expect(sim.lifts.all().some((l) => l.ops?.fault?.kind === 'service')).toBe(true);
    const { bytes } = await encodeSave(sim, makeMeta(sim, 't'), { compress: true, yieldBetween: false });
    const { envelope } = await decodeSave(bytes, { yieldBetween: false });
    const restored = createSim({ size: envelope.mapSize, seed: envelope.seed, now: () => 0, fromSave: structuredClone(envelope.modules) });
    applySave(sim, structuredClone(envelope.modules));
    for (let d = 0; d < 4 * TICKS_PER_DAY; d += 40) {
      step(sim, 40); step(restored, 40);
      const a = stateHash(sim).parts, b = stateHash(restored).parts;
      expect(Object.keys(a).filter((k) => a[k] !== b[k])).toEqual([]);
    }
    expect(restored.liftOps.getPolicy()).toBe('auto');
  });
  it('an old save (lifts without maintenance data) loads as Auto with no sudden overdue state or service', () => {
    const { sim } = makeResort(64, 1, { startDay: 100 });
    run(sim, { days: 1 });
    for (const l of sim.lifts.all()) { l.ops!.ageDays = 300; delete l.ops!.maint; }
    run(sim, { days: 2 });
    for (const l of sim.lifts.all()) { expect(l.ops!.maint).toBeTruthy(); expect(sim.liftOps.serviceStatus(l).state).toBe('ok'); expect(l.ops!.fault?.kind).not.toBe('service'); }
  });
  it('a v1 save (module versions 1, no maintenance data) loads as Auto and keeps behaving', async () => {
    const { sim } = makeResort(64, 1, { startDay: 100 });
    run(sim, { days: 1 });
    const { bytes } = await encodeSave(sim, makeMeta(sim, 't'), { compress: false, yieldBetween: false });
    const { envelope } = await decodeSave(bytes, { yieldBetween: false });
    const mods = structuredClone(envelope.modules) as unknown as { lifts: { v: number; data: { items: Array<{ ops: Record<string, unknown> }> } }; 'sys.economy': { v: number; data: { liftOps: Record<string, unknown> } } };
    for (const l of mods.lifts.data.items) delete l.ops.maint;
    delete mods['sys.economy'].data.liftOps.policy; mods.lifts.v = 1; mods['sys.economy'].v = 1;
    const old = createSim({ size: envelope.mapSize, seed: envelope.seed, now: () => 0, fromSave: mods as never });
    expect(old.liftOps.getPolicy()).toBe('auto');
    expect(run(old, { days: 2 })).toEqual([]);
    for (const l of old.lifts.all()) { expect(l.ops!.maint!.count).toBe(0); expect(old.liftOps.serviceStatus(l).state).toBe('ok'); }
  });
  it('bot economy stays sane: a year of Auto maintenance costs little compared with the run', () => {
    const play = (policy: 'auto' | 'manual'): { money: number; svc: number; cost: number } => {
      const s = createSim({ size: 64, seed: 61, now: () => 0 });
      s.liftOps.setPolicy(policy);
      let svc = 0, cost = 0; s.bus.on('lift:serviceStarted', (e) => { svc++; cost += e.cost; });
      runBot(s, new Bot(s), DAYS_PER_YEAR + 60);
      return { money: s.game.money, svc, cost };
    };
    const auto = play('auto'), manual = play('manual');
    expect(auto.svc).toBeGreaterThan(0); expect(manual.svc).toBe(0);
    expect(auto.cost).toBeLessThan(Math.max(8000, auto.money * 0.2));
    expect(auto.money).toBeGreaterThan(manual.money * 0.8 - 5000);
    // eslint-disable-next-line no-console
    console.log(`bot 64/61 240 d: auto money ${Math.round(auto.money)} (${auto.svc} services, $${Math.round(auto.cost)}), manual money ${Math.round(manual.money)}`);
  }, 120000);
});
