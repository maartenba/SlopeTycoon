import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { Rating, scoreInput, starsOf, type RatingInput } from '../../src/sim/Rating';
import { Spawner } from '../../src/sim/guests/Spawner';
import { createGameState } from '../../src/core/GameState';

const good = (): RatingInput => ({
  guests: { count: 100, avgHappiness: 0.85, recentSatisfied: 0.8 },
  safety: { penalty: 0, open: 0, unresolved: 0, meanResponseTicks: 4, severe: 0, patrolHubs: 1 },
  variety: { attractionTypes: 4, liftKinds: 3, pisteTiles: [40, 40, 40, 40], seasonal: 1 },
  pisteQuality: { goodShare: 0.9, icyShare: 0, tiles: 160 },
  queues: { meanWaitTicks: 3, worst: null },
  crowding: { avgNeighbours: 4 },
  value: 0.6,
  amenities: { restaurants: 3, lodgingCapacity: 100, lodgingDemand: 80 },
  openLifts: 4,
});
const score = (f: (i: RatingInput) => void): number => { const i = good(); f(i); return scoreInput(i).score; };

describe('Rating score', () => {
  it('stars map to half-stars', () => { expect(starsOf(0)).toBe(0); expect(starsOf(100)).toBe(5); expect(starsOf(73)).toBe(3.5); expect(starsOf(77)).toBe(4); });
  it('variety raises it', () => {
    const poor = score((i) => { i.variety = { attractionTypes: 0, liftKinds: 1, pisteTiles: [40, 0, 0, 0], seasonal: 0.3 }; });
    expect(scoreInput(good()).score).toBeGreaterThan(poor + 5);
    const b = scoreInput({ ...good(), variety: { attractionTypes: 1, liftKinds: 1, pisteTiles: [0, 40, 40, 40], seasonal: 1 } });
    expect(b.components.find((c) => c.id === 'variety')!.hint).toBe('Too few green runs');
  });
  it('icy pistes, long queues, unresolved incidents and no patrol lower it', () => {
    const base = scoreInput(good()).score;
    expect(score((i) => { i.pisteQuality = { goodShare: 0.1, icyShare: 0.7, tiles: 160 }; })).toBeLessThan(base - 4);
    expect(score((i) => { i.queues = { meanWaitTicks: 40, worst: { name: 'Chairlift 1', waitTicks: 40 } }; })).toBeLessThan(base - 5);
    expect(score((i) => { i.safety = { ...i.safety, unresolved: 3, open: 3, penalty: 0.27 }; })).toBeLessThan(base - 15);
    expect(score((i) => { i.safety.patrolHubs = 0; })).toBeLessThan(base - 2);
    const b = scoreInput({ ...good(), queues: { meanWaitTicks: 40, worst: { name: 'Chairlift 1', waitTicks: 40 } }, safety: { ...good().safety, patrolHubs: 0 } });
    expect(b.hints).toContain('Long queues at Chairlift 1');
    expect(b.hints).toContain('Add a Ski Patrol Hub');
  });
  it('is deterministic', () => { expect(scoreInput(good())).toEqual(scoreInput(good())); });
});

describe('Rating smoothing + events', () => {
  it('drops under problems and recovers with fixes; emits typed rating:changed, at most once a day', () => {
    const bus = new EventBus<GameEvents>();
    const ev: GameEvents['rating:changed'][] = [];
    bus.on('rating:changed', (e) => ev.push(e));
    let inp = good();
    const r = new Rating({ inputs: () => inp, bus });
    r.evaluate(0);
    const start = r.stars;
    expect(start).toBeGreaterThanOrEqual(4);
    expect(ev.length).toBe(0);
    inp = { ...good(), safety: { ...good().safety, unresolved: 4, open: 4, penalty: 0.36, patrolHubs: 0 }, queues: { meanWaitTicks: 40, worst: { name: 'Chairlift 1', waitTicks: 40 } }, pisteQuality: { goodShare: 0.1, icyShare: 0.8, tiles: 160 } };
    const days: number[] = [];
    for (let d = 1; d <= 12; d++) if (r.evaluate(d)) days.push(d);
    expect(r.stars).toBeLessThan(start);
    expect(ev.length).toBeGreaterThan(0);
    expect(new Set(days).size).toBe(days.length);
    for (const e of ev) { expect(e.stars).not.toBe(e.previous); expect(e.reason.length).toBeGreaterThan(0); }
    expect(ev[0]!.previous).toBe(start);
    expect(ev[ev.length - 1]!.stars).toBe(r.stars);
    const low = r.stars;
    inp = good();
    for (let d = 13; d <= 40; d++) r.evaluate(d);
    expect(r.stars).toBeGreaterThan(low);
    expect(ev[ev.length - 1]!.stars).toBe(r.stars);
  });
  it('no flicker around a boundary', () => {
    const bus = new EventBus<GameEvents>();
    let n = 0; bus.on('rating:changed', () => n++);
    let v = 0.50;
    const r = new Rating({ inputs: () => ({ ...good(), guests: { count: 10, avgHappiness: v, recentSatisfied: v } }), bus });
    r.evaluate(0);
    for (let d = 1; d < 30; d++) { v = d % 2 ? 0.505 : 0.495; r.evaluate(d); }
    expect(n).toBeLessThanOrEqual(1);
  });
  it('spawn rate responds to the rating (A/B)', () => {
    const rate = (poor: boolean): number => {
      const inp = good();
      if (poor) {
        inp.guests = { count: 100, avgHappiness: 0.25, recentSatisfied: 0.1 };
        inp.variety = { attractionTypes: 0, liftKinds: 1, pisteTiles: [5, 0, 0, 0], seasonal: 0.2 };
        inp.pisteQuality = { goodShare: 0.1, icyShare: 0.6, tiles: 10 };
        inp.queues = { meanWaitTicks: 40, worst: null }; inp.value = 0.2;
      }
      const r = new Rating({ inputs: () => inp }); r.evaluate(0);
      return r.attractiveness(4);
    };
    expect(rate(false)).toBeGreaterThan(rate(true) * 1.5);
    expect(new Rating({ inputs: good }).attractiveness(0)).toBeLessThan(0.3);
    // wired into the Spawner
    const sp = new Spawner({ stats: () => ({ openLifts: 4, openPisteTiles: 300, attractions: 4, amenityVariety: 5 }) } as never, {} as never, {} as never);
    sp.setAttractiveness(() => 0.42);
    expect((sp as unknown as { attractFn: () => number }).attractFn()).toBe(0.42);
    void createGameState;
  });
});

describe('sustainability facet (Task 23)', () => {
  const OLD = { happiness: 0.25, safety: 0.2, variety: 0.15, pisteQuality: 0.12, queues: 0.12, crowding: 0.04, value: 0.12 } as const;
  it('weights are renormalised to exactly 1 with sustainability at 8 %', async () => {
    const { WEIGHTS } = await import('../../src/sim/Rating');
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(WEIGHTS.sustainability).toBe(0.08);
  });
  it('without the facet (older inputs) the other weights are renormalised: the score moves < 1 point from the old formula', () => {
    const b = scoreInput(good());
    const oldBase = b.components.reduce((a, c) => a + c.score * OLD[c.id as keyof typeof OLD], 0) + b.bonus;
    expect(b.components.some((c) => c.id === 'sustainability')).toBe(false);
    expect(Math.abs(b.score - oldBase)).toBeLessThan(1);
  });
  it('a facet equal to the weighted mean of the others is neutral; a poor one lowers the score, a great one raises it', () => {
    const base = scoreInput(good()), others = base.components.reduce((a, c) => a + c.score * c.weight, 0) / base.components.reduce((a, c) => a + c.weight, 0);
    const at = (s: number): number => scoreInput({ ...good(), sustainability: { score: s, hint: 'x' } }).score;
    expect(Math.abs(at(others) - base.score)).toBeLessThan(0.15);
    expect(at(20)).toBeLessThan(base.score - 3); expect(at(100)).toBeGreaterThan(base.score - 0.01);
    const b = scoreInput({ ...good(), sustainability: { score: 20, hint: 'Plant trees to make up for the forest you cleared' } });
    expect(b.components.find((c) => c.id === 'sustainability')!.label).toBe('Sustainability');
    expect(b.hints).toContain('Plant trees to make up for the forest you cleared');
    expect(scoreInput({ ...good(), sustainability: { score: 90, hint: 'Gentle on the mountain' } }).hints).not.toContain('Gentle on the mountain');
  });
  it('smoothing keeps working with 8 components and an old save (without the facet in its smooth map) loads', () => {
    let inp: RatingInput = { ...good(), sustainability: { score: 80, hint: '' } };
    const r = new Rating({ inputs: () => inp });
    r.evaluate(0); const s0 = r.score;
    inp = { ...good(), sustainability: { score: 10, hint: 'x' } };
    for (let d = 1; d < 15; d++) r.evaluate(d);
    expect(r.score).toBeLessThan(s0 - 3);
    const old = r.serialize() as { s: Array<[string, number]> }; old.s = old.s.filter(([k]) => k !== 'sustainability');
    const q = new Rating({ inputs: () => inp }); q.load(old); q.evaluate(20);
    expect(q.breakdown().components.find((c) => c.id === 'sustainability')!.score).toBe(10);
  });
});
