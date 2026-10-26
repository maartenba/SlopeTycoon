import { describe, it, expect } from 'vitest';
import { GuestStore } from '../../../src/sim/guests/Guest';
import { LiftQueues, type QueueCallbacks } from '../../../src/sim/guests/LiftQueue';
import { Fixture } from './resortFixture';
import { LIFT_SECONDS_PER_TICK } from '../../../src/config/balance';

function setup(kind: 'chair4' | 'tbar' | 'gondola6' | 'cablecar' = 'chair4', mode: 'ski' | 'foot' | 'mixed' = 'ski', n = 400) {
  const f = new Fixture(64);
  const lift = f.addLift(kind, 20, 50, 20, 10, mode);
  const store = new GuestStore(n);
  const q = new LiftQueues(store, () => f.liftList);
  const slots: number[] = [];
  for (let i = 0; i < n; i++) slots.push(store.add({ x: 20, y: 50, z: 0, type: 0, skill: 1, budget: 100, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0 }));
  const log = { boarded: [] as number[], done: [] as Array<{ slot: number; tick: number }>, released: [] as Array<{ slot: number; reason: string }>, tick: 0 };
  const cb: QueueCallbacks = {
    done: (slot) => log.done.push({ slot, tick: log.tick }),
    released: (slot, _l, reason) => log.released.push({ slot, reason }),
    moved: () => undefined,
    boarded: (_l, slot) => log.boarded.push(slot),
  };
  return { f, lift, store, q, slots, log, cb };
}

describe('lift queues', () => {
  it('boards at the lift throughput (carriers/hour x capacity) and in FIFO order', () => {
    const { lift, q, slots, log, cb } = setup('chair4', 'ski');
    for (const s of slots.slice(0, 300)) expect(q.join(lift.id, 0, s, 'ski', 0, 1e9)).toBe('ok');
    expect(q.queueLength(lift.id)).toBe(300);
    const rate = q.ratePerTick(lift);
    const ticks = 20;
    for (let t = 1; t <= ticks; t++) { log.tick = t; q.update(t, cb); }
    expect(log.boarded.length).toBeGreaterThan(rate * ticks * 0.8 - 4);
    expect(log.boarded.length).toBeLessThan(rate * ticks * 1.2 + 4);
    expect(log.boarded).toEqual(slots.slice(0, log.boarded.length)); // FIFO
    expect(q.queueLength(lift.id)).toBe(300 - log.boarded.length);
    // riders/hour counter feeds the economy
    expect(lift.riders!.total).toBe(log.boarded.length);
    expect(lift.riders!.perHour).toBeGreaterThan(0);
  });

  it('ride time = ride seconds / LIFT_SECONDS_PER_TICK, guests emerge at the top', () => {
    const { lift, q, slots, log, cb } = setup('chair4', 'ski');
    q.join(lift.id, 0, slots[0]!, 'ski', 0, 1e9);
    const dur = q.rideTicks(lift);
    expect(dur).toBeGreaterThanOrEqual(2);
    for (let t = 1; t <= dur + 3; t++) { log.tick = t; q.update(t, cb); }
    expect(log.done).toHaveLength(1);
    expect(log.done[0]!.tick - 1).toBeGreaterThanOrEqual(dur - 1);
    expect(dur * LIFT_SECONDS_PER_TICK).toBeGreaterThanOrEqual(5);
  });

  it('long expected waits make guests balk', () => {
    const { lift, q, slots } = setup('tbar', 'ski');
    let res = '';
    for (const s of slots) { res = q.join(lift.id, 0, s, 'ski', 0, 30); if (res !== 'ok') break; }
    expect(res).toBe('balk');
    expect(q.queueLength(lift.id)).toBeGreaterThan(0);
    expect(q.waitTicks(lift.id)).toBeLessThanOrEqual(30 + 2);
  });

  it('impatient guests leave the queue', () => {
    const { lift, q, slots, log, cb } = setup('tbar', 'ski');
    for (const s of slots.slice(0, 40)) expect(q.join(lift.id, 0, s, 'ski', 0, 12)).not.toBe('closed');
    const before = q.queueLength(lift.id);
    lift.speed = 0.25; // the lift slows down: the promised wait no longer holds
    for (let t = 1; t <= 60; t++) { log.tick = t; q.update(t, cb); }
    expect(log.released.some((r) => r.reason === 'impatient')).toBe(true);
    expect(q.queueLength(lift.id)).toBeLessThan(before);
  });

  it('a closed lift releases its queue and refuses new riders', () => {
    const { f, lift, q, slots, log, cb } = setup('chair4', 'ski');
    for (const s of slots.slice(0, 40)) q.join(lift.id, 0, s, 'ski', 0, 1e9);
    f.liftList[0]!.open = false;
    log.tick = 1; q.update(1, cb);
    expect(q.queueLength(lift.id)).toBe(0);
    expect(log.released.filter((r) => r.reason === 'closed')).toHaveLength(40);
    expect(q.join(lift.id, 0, slots[50]!, 'ski', 1, 1e9)).toBe('closed');
  });

  it('bikes only ride bike-capable lifts in foot/mixed mode; skiers need ski/mixed mode', () => {
    const t = setup('tbar', 'ski');
    expect(t.q.join(t.lift.id, 0, t.slots[0]!, 'bike', 0, 1e9)).toBe('mode');
    const c = setup('chair4', 'ski');
    expect(c.q.join(c.lift.id, 0, c.slots[0]!, 'bike', 0, 1e9)).toBe('mode'); // ski-mode chairlift carries no bikes
    const cf = setup('chair4', 'foot');
    expect(cf.q.join(cf.lift.id, 0, cf.slots[0]!, 'bike', 0, 1e9)).toBe('ok');
    expect(cf.q.join(cf.lift.id, 0, cf.slots[1]!, 'ski', 0, 1e9)).toBe('mode');
    const fu = setup('gondola6', 'mixed');
    expect(fu.q.join(fu.lift.id, 0, fu.slots[0]!, 'bike', 0, 1e9)).toBe('ok');
    expect(fu.q.join(fu.lift.id, 0, fu.slots[1]!, 'ski', 0, 1e9)).toBe('ok');
  });

  it('queue length and wait are exposed for the inspector / overlay', () => {
    const { lift, q, slots } = setup('chair4', 'ski');
    for (const s of slots.slice(0, 25)) q.join(lift.id, 0, s, 'ski', 0, 1e9);
    const sum = q.summary();
    expect(sum[0]!.liftId).toBe(lift.id);
    expect(sum[0]!.up).toBe(25);
    expect(sum[0]!.waitTicks).toBeGreaterThan(0);
  });
});
