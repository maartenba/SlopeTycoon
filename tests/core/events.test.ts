import { describe, expect, it } from 'vitest';
import { EventBus } from '@/core/EventBus';
import { EventLog } from '@/core/EventLog';
import { GAME_EVENT_NAMES, EVENT_NAMES_EXHAUSTIVE, type GameEvents } from '@/core/events';
import { createDefaultRegistry } from '@/sim/Systems';
import { createGameState } from '@/core/GameState';
import { Economy } from '@/sim/Economy';

describe('typed game events', () => {
  it('rejects unknown events and wrong payloads at compile time', () => {
    const bus = new EventBus<GameEvents>();
    bus.emit('money:changed', { money: 1, delta: 1 });
    // @ts-expect-error unknown event name
    bus.emit('nope:event', {});
    // @ts-expect-error wrong payload shape
    bus.emit('money:changed', 5);
    // @ts-expect-error missing field
    bus.emit('guest:left', { id: 1 });
    // @ts-expect-error invalid enum value
    bus.emit('speed:changed', { speed: 7, previous: 0 });
    // @ts-expect-error unknown event in on()
    bus.on('unknown', () => {});
    bus.on('building:placed', (p) => { const n: number = p.id; void n; });
    expect(EVENT_NAMES_EXHAUSTIVE).toBe(true);
    expect(new Set(GAME_EVENT_NAMES).size).toBe(GAME_EVENT_NAMES.length);
  });

  it('Economy emits money:changed with a signed delta', () => {
    const bus = new EventBus<GameEvents>();
    const got: Array<{ money: number; delta: number }> = [];
    bus.on('money:changed', (e) => got.push(e));
    const s = createGameState(1, 64, 1000);
    const eco = new Economy(s, (money, delta) => bus.emit('money:changed', { money, delta }));
    eco.charge(300);
    eco.refund(50);
    expect(got).toEqual([{ money: 700, delta: -300 }, { money: 750, delta: 50 }]);
  });

  it('season system emits season:changed on a month boundary', () => {
    const bus = new EventBus<GameEvents>();
    const seen: string[] = [];
    bus.on('season:changed', (e) => seen.push(`${e.previous}>${e.season}`));
    const reg = createDefaultRegistry(bus);
    const s = createGameState(1, 64);
    s.date.day = 29; s.date.minute = 1000;
    reg.update(s, 1); // primes the season system (no event on first sight)
    s.date.minute = 1434; // last tick of spring
    reg.update(s, 2);
    expect(seen).toEqual(['spring>summer']);
  });
});

describe('EventLog', () => {
  it('keeps the last 200, filters by prefix, pauses and clears', () => {
    const bus = new EventBus<GameEvents>();
    const log = new EventLog(bus);
    for (let i = 0; i < 250; i++) bus.emit('guest:arrived', { id: i });
    bus.emit('time:hour', { hour: 3 });
    expect(log.size).toBe(200);
    expect(log.entries('guest:').length).toBe(199);
    expect(log.entries('time:').length).toBe(1);
    log.paused = true;
    bus.emit('time:hour', { hour: 4 });
    expect(log.entries('time:').length).toBe(1);
    log.paused = false;
    log.clear();
    expect(log.size).toBe(0);
    log.dispose();
    bus.emit('time:hour', { hour: 5 });
    expect(log.size).toBe(0);
  });
});
