import { describe, expect, it } from 'vitest';
import { NIGHTLY_RATE } from '../../../src/config/prices';
import { RoomBook } from '../../../src/sim/attractions/Lodging';
import { GState } from '../../../src/sim/guests/Guest';
import { harness } from './harness';

describe('lodging', () => {
  it('overnight guests check in to open lodging with capacity; nightly revenue; the rest get no room', () => {
    const h = harness();
    const b = h.add('chalet'); // 12 rooms
    h.run(1);
    h.state.date.minute = 18 * 60 + 30;
    const gs = Array.from({ length: 15 }, () => h.guest({ overnight: true }));
    h.run(1);
    const a = h.sys.get(b.id)!;
    expect(h.sys.rooms.occupied(b.id)).toBe(12);
    expect(a.stats.nights).toBe(12);
    expect(h.econ.ledger.lodging).toBe(12 * NIGHTLY_RATE.chalet!.price);
    expect(gs.filter((g) => h.sys.rooms.roomOf(h.store.id[g]!) === b.id)).toHaveLength(12);
    expect(h.sys.lodgingCapacity()).toBe(12);
    h.run(3);
    expect(h.econ.ledger.lodging).toBe(12 * NIGHTLY_RATE.chalet!.price); // once per night
  });

  it('closed lodging sells nothing; day guests cannot use rooms; returning guests pay per night', () => {
    const h = harness();
    const b = h.add('apartment');
    h.status.set(b.id, { open: false, reason: 'Closed: test' });
    h.run(1);
    h.state.date.minute = 19 * 60;
    h.guest({ overnight: true });
    h.run(1);
    expect(h.econ.ledger.lodging).toBe(0);
    expect(h.sys.lodgingCapacity()).toBe(0);
    h.status.delete(b.id);
    h.run(1);
    const day = h.guest();
    expect(h.sys.canUse(b.id, day)).toBe(false);
    expect(h.arrive(day, h.buildings[0]!)).toBe('handled');
    expect(h.store.state[day]).not.toBe(GState.Using);
    // next evening the same guest pays again
    h.state.date.day++;
    h.run(1);
    expect(h.sys.get(b.id)!.stats.nights).toBe(1);
    h.state.date.day++;
    h.run(1);
    expect(h.sys.get(b.id)!.stats.nights).toBe(2);
  });

  it('base lodge doubles as dining and 20 rooms', () => {
    const h = harness();
    const b = h.add('baseLodge');
    h.state.date.minute = 18 * 60;
    h.guest({ overnight: true });
    h.run(1);
    expect(h.sys.get(b.id)!.spec.rooms).toBe(20);
    expect(h.sys.rooms.occupied(b.id)).toBe(1);
  });

  it('room book purges departed guests', () => {
    const rb = new RoomBook();
    rb.assign(1, 7); rb.assign(2, 7);
    rb.purge((g) => g === 1, () => true);
    expect(rb.occupied(7)).toBe(1);
    rb.purge(() => true, () => false);
    expect(rb.total()).toBe(0);
  });
});
