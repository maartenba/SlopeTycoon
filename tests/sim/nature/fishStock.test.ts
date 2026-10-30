import { describe, expect, it } from 'vitest';
import { FISH } from '../../../src/config/balance';
import { FishStock, bodySize, nearWater, reachable, sizeFactor, spotsFor, type FishBody } from '../../../src/sim/nature/FishStock';
import { fishBodies } from '../../../src/sim/nature/FishWaters';
import { Rng } from '../../../src/core/Rng';

const N = 64;
const tiles = (x0: number, y0: number, w: number, h: number): number[] => { const o: number[] = []; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) o.push(y * N + x); return o; };
const lake: FishBody = { key: 'l0', kind: 'lake', name: 'Lake 1', tiles: tiles(20, 10, 5, 5) };
const river: FishBody = { key: 'r1', kind: 'river', name: 'River 1', tiles: tiles(30, 5, 1, 12) };

describe('fish stock dynamics (Task 49)', () => {
  it('an unfished water is at the initial stock and is not tracked (no state, no save)', () => {
    const f = new FishStock();
    expect(f.get('l0')).toBe(FISH.initial);
    expect(f.has('l0')).toBe(false);
    expect(f.serialize()).toBeNull();
    expect(f.mean()).toBeNull();
    expect(f.sustainPoints()).toBe(0);
  });

  it('catch & release barely moves the stock, keep depletes it (and small waters deplete faster)', () => {
    const rel = new FishStock(), keep = new FishStock(), smallKeep = new FishStock();
    const rng = new Rng(7);
    for (let i = 0; i < 40; i++) { const u = rng.next(); rel.cast('l0', 25, false, u); keep.cast('l0', 25, true, u); smallKeep.cast('l0', 6, true, u); }
    expect(rel.get('l0')).toBeGreaterThan(FISH.initial - 0.05);
    expect(keep.get('l0')).toBeLessThan(rel.get('l0') - 0.1);
    expect(smallKeep.get('l0')).toBeLessThan(keep.get('l0'));
    expect(sizeFactor(5)).toBe(2); expect(sizeFactor(1000)).toBe(0.25); // clamped
  });

  it('fewer fish bite less often', () => {
    const f = new FishStock();
    let rich = 0, poor = 0;
    f.set('a', 0.9); f.set('b', 0.05);
    const rng = new Rng(3);
    for (let i = 0; i < 400; i++) { const u = rng.next(); if (f.cast('a', 1e9, false, u)) rich++; if (f.cast('b', 1e9, false, u)) poor++; }
    expect(rich).toBeGreaterThan(poor * 2);
  });

  it('regrows logistically to carrying capacity; rivers with flow faster; frozen water not at all', () => {
    const f = new FishStock();
    for (const k of ['l0', 'r1', 'rDry', 'l1']) f.set(k, 0.2);
    const days = 10;
    for (let d = 0; d < days; d++) f.newDay((k) => k === 'l1', (k) => (k === 'r1' ? 2 : 0));
    expect(f.get('l0')).toBeGreaterThan(0.2);
    expect(f.get('r1')).toBeGreaterThan(f.get('l0'));
    expect(f.get('rDry')).toBeCloseTo(f.get('l0'), 6); // a dry river grows like a lake
    expect(f.get('l1')).toBe(0.2); // frozen: no regrowth
    for (let d = 0; d < 400; d++) f.newDay();
    expect(f.get('l0')).toBeGreaterThan(0.99); expect(f.get('l0')).toBeLessThanOrEqual(1);
  });

  it('an emptied water recovers (floor) and "overfished" lists waters below 30 %', () => {
    const f = new FishStock();
    f.set('x', 0); f.set('y', 0.25); f.set('z', 0.6);
    expect(f.overfished().map((o) => o.key)).toEqual(['x', 'y']);
    expect(f.lowest()!.key).toBe('x');
    for (let d = 0; d < 60; d++) f.newDay();
    expect(f.get('x')).toBeGreaterThan(0.1);
  });

  it('sustainability points stay within +/- 2', () => {
    const f = new FishStock();
    f.set('a', 1); expect(f.sustainPoints()).toBeLessThanOrEqual(FISH.sustainMax); expect(f.sustainPoints()).toBeGreaterThan(0);
    f.set('a', 0); expect(f.sustainPoints()).toBe(-FISH.sustainMax);
    f.set('a', 0.6); expect(f.sustainPoints()).toBe(0);
  });

  it('save / load round trip is exact and sorted; reset empties', () => {
    const f = new FishStock(); f.set('r2', 0.4321987); f.set('l0', 0.5);
    const d = f.serialize()!;
    expect(d.s.map(([k]) => k)).toEqual(['l0', 'r2']);
    const g = new FishStock(); g.load(JSON.parse(JSON.stringify(d)));
    expect(g.serialize()).toEqual(d);
    g.reset(); expect(g.serialize()).toBeNull();
  });
});

describe('water bodies, reach and places', () => {
  it('fishBodies keys: lakes l<i>, ponds p<id>, streams n<i>, rivers r<id>', () => {
    const b = fishBodies(N, [{ tileIdx: [1, 2] }], [{ id: 3, tileIdx: [5] }], [{ path: [{ x: 1, y: 1 }, { x: 2, y: 1 }] }], [{ id: 9, path: [{ x: 4, y: 4 }] }]);
    expect(b.map((x) => x.key)).toEqual(['l0', 'p3', 'n0', 'r9']);
    expect(b[2]!.tiles).toEqual([1 * N + 1, 1 * N + 2]);
    expect(bodySize(b[0]!)).toBe(2); expect(bodySize(b[2]!)).toBe(5); // rivers / streams count 2.5 per tile
  });

  it('a hut must be within 3 tiles of water and reaches water within 20', () => {
    const near = { x: 16, y: 11, w: 2, h: 2 }, far = { x: 3, y: 3, w: 2, h: 2 };
    expect(nearWater(near, [lake], N)).toBe(true); // x 16..17, water from x 20 = 3 tiles
    expect(nearWater({ x: 14, y: 11, w: 2, h: 2 }, [lake], N)).toBe(false);
    expect(nearWater(far, [lake], N)).toBe(false);
    expect(reachable(near, [lake, river], N, () => true).map((b) => b.key)).toEqual(['l0', 'r1']);
    expect(reachable(near, [lake, river], N, (b) => b.kind === 'lake').map((b) => b.key)).toEqual(['l0']);
    expect(reachable({ x: 50, y: 50, w: 2, h: 2 }, [lake], N, () => true)).toEqual([]);
  });

  it('piers give four places each, bank spots need a path tile beside the shore and are capped', () => {
    const hut = { x: 16, y: 11, w: 2, h: 2 };
    const pier = { x: 19, y: 11, w: 1, h: 2 }; // dry tile touching the lake on its east side
    const noPath = spotsFor(hut, [lake], [], N, () => false);
    expect(noPath).toEqual([]);
    const onePier = spotsFor(hut, [lake], [pier], N, () => false);
    expect(onePier.length).toBe(FISH.pierSlots);
    expect(onePier.every((s) => s.kind === 'pier' && s.body === 'l0')).toBe(true);
    const twoPiers = spotsFor(hut, [lake], [pier, { x: 19, y: 13, w: 1, h: 2 }], N, () => false);
    expect(twoPiers.length).toBe(2 * FISH.pierSlots);
    const bank = spotsFor(hut, [lake], [], N, (x, y) => x === 19 && y >= 10 && y <= 14); // a path along the west shore
    expect(bank.length).toBe(5); expect(bank.every((s) => s.kind === 'bank')).toBe(true);
    expect(bank[0]!.heading).toBeCloseTo(0, 6); // faces east, into the lake
    const wide = spotsFor(hut, [lake], [], N, () => true);
    expect(wide.length).toBe(FISH.bankSpotsMax);
    const ice = spotsFor(hut, [lake], [pier], N, () => true, true);
    expect(ice.every((s) => s.kind === 'ice' || s.kind === 'pier')).toBe(true);
  });
});
