import { describe, expect, it } from 'vitest';
import { GState } from '../../../src/sim/guests/Guest';
import { QUEUE_PATIENCE_TICKS } from '../../../src/sim/attractions/AttractionSystem';
import { harness } from './harness';
import { budget } from '../../perfMode';

function setup() {
  const h = harness();
  const b = h.add('rental');
  h.run(1);
  const a = h.sys.get(b.id)!;
  a.setStaff(1); // capacity 4, queue max 10
  return { h, b, a };
}

describe('queues', () => {
  it('fills slots, queues FIFO up to the limit, then balks', () => {
    const { h, b, a } = setup();
    expect(a.capacity()).toBe(4);
    expect(a.queueMax()).toBe(10);
    const gs = Array.from({ length: 20 }, () => h.guest());
    const res = gs.map((g) => h.arrive(g, b));
    expect(res.filter((r) => r === 'using')).toHaveLength(14);
    expect(res.filter((r) => r === 'handled')).toHaveLength(6);
    expect(a.usersNow).toBe(4);
    expect(a.queueLength).toBe(10);
    expect(a.stats.balked).toBe(6);
    expect(h.sys.queueLength(b.id)).toBe(10);
    // FIFO: the 5th guest (first queued) is admitted before the 6th
    const first = h.store.id[gs[4]!]!, second = h.store.id[gs[5]!]!;
    expect(a.queue[0]!.id).toBe(first);
    h.run(a.serviceTime() + 1);
    expect(a.users.map((u) => u.id)).toContain(first);
    expect(a.users.map((u) => u.id)).toContain(second);
    expect(a.stats.served).toBe(4);
  });

  it('queued guests lose patience and leave the queue', () => {
    const { h, b, a } = setup();
    for (let i = 0; i < 5; i++) h.arrive(h.guest(), b);
    expect(a.queueLength).toBe(1);
    const waiting = h.store.slotOf(a.queue[0]!.id);
    h.tick += QUEUE_PATIENCE_TICKS; // time passes while the 4 users are still being served
    a.users.forEach((u) => { u.end = h.tick + 1000; });
    h.run(1);
    expect(a.stats.reneged).toBe(1);
    expect(a.queueLength).toBe(0);
    expect(h.store.state[waiting]).toBe(GState.Idle);
  });

  it('guests that cannot afford the price are turned away without paying', () => {
    const { h, b, a } = setup();
    const g = h.guest({ budget: 1 });
    expect(h.arrive(g, b)).toBe('handled');
    expect(a.stats.turnedAway).toBe(1);
    expect(h.econ.ledger.rental).toBe(0);
  });

  it('guests pulled away (leaving) are dropped from queue and slots', () => {
    const { h, b, a } = setup();
    const gs = Array.from({ length: 6 }, () => h.guest());
    gs.forEach((g) => h.arrive(g, b));
    h.store.state[gs[0]!] = GState.Leaving;
    h.store.state[gs[5]!] = GState.Leaving;
    h.run(1);
    expect(a.usersNow).toBe(4);
    expect(a.queueLength).toBe(0);
  });

  it('is deterministic: same inputs, same results', () => {
    const run = (): string => {
      const { h, b, a } = setup();
      for (let i = 0; i < 25; i++) { h.arrive(h.guest(), b); h.run(1); }
      h.run(30);
      return `${a.stats.served}|${a.stats.balked}|${a.stats.revenue}|${h.store.hash()}`;
    };
    expect(run()).toBe(run());
  });

  it('[perf] time slicing: a big crowd keeps per-tick cost small', () => {
    const h = harness();
    const bs = ['beach', 'iceRink', 'stuntPark', 'adventurePark', 'playground', 'cafe', 'lodge', 'shop'].map((t, i) => h.add(t, 5 + i * 6, 20));
    h.run(1);
    for (let i = 0; i < 380; i++) h.arrive(h.guest(), bs[i % bs.length]!);
    let best = Infinity;
    for (let r = 0; r < 5; r++) { const t0 = performance.now(); h.run(20); best = Math.min(best, (performance.now() - t0) / 20); }
    expect(best).toBeLessThan(budget(5)); // ms per tick
  });
});
