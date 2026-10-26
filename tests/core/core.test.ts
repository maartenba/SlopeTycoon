import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import { Rng } from '../../src/core/Rng';
import { IdGenerator } from '../../src/core/ids';
import { createGameState } from '../../src/core/GameState';

describe('Rng', () => {
  it('is deterministic', () => {
    const a = new Rng(42), b = new Rng(42);
    const sa = Array.from({ length: 20 }, () => a.next());
    const sb = Array.from({ length: 20 }, () => b.next());
    expect(sa).toEqual(sb);
  });
  it('restores state', () => {
    const a = new Rng(7);
    a.next();
    const st = a.getState();
    const seq = [a.next(), a.next(), a.int(1, 6)];
    const b = new Rng(0);
    b.setState(st);
    expect([b.next(), b.next(), b.int(1, 6)]).toEqual(seq);
  });
});

describe('EventBus', () => {
  it('unsubscribes', () => {
    const bus = new EventBus<{ x: number }>();
    let n = 0;
    const off = bus.on('x', (v) => (n += v));
    bus.emit('x', 1);
    off();
    bus.emit('x', 1);
    expect(n).toBe(1);
  });
});

describe('ids/state', () => {
  it('ids serialize', () => {
    const g = new IdGenerator();
    g.next();
    const h = new IdGenerator();
    h.setState(g.getState());
    expect(h.next()).toBe(2);
  });
  it('creates state', () => {
    expect(createGameState(1, 256).mapSize).toBe(256);
  });
});
