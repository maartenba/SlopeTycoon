import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import type { GameEvents } from '../../src/core/events';
import { TICKS_PER_DAY } from './harness';

const mk = (money: number) => createSim({ size: 64, seed: 3, money, now: () => 0 });

describe('debt model in the full sim', () => {
  it('negative cash for 90 days never ends the game; overdraft interest is booked; building is blocked', () => {
    const sim = mk(-20000);
    const events: Array<keyof GameEvents> = [];
    for (const k of ['finance:bankrupt', 'finance:declaredBankrupt', 'finance:debtWarning'] as const) sim.bus.on(k, () => events.push(k));
    sim.loop.setSpeed(1);
    for (let t = 0; t < TICKS_PER_DAY * 90; t++) sim.tick(1);
    expect(sim.game.money).toBeLessThan(0);
    expect(sim.finance.status).toBe('debt');
    expect(sim.finance.ended).toBe(false);
    expect(events).not.toContain('finance:bankrupt');
    expect(events.filter((e) => e === 'finance:debtWarning').length).toBeGreaterThan(0);
    expect(events.filter((e) => e === 'finance:debtWarning').length).toBeLessThan(8); // low volume
    expect(sim.economy.expenses.interest).toBeGreaterThan(0);
    expect(sim.economy.charge(1)).toBe(false);
    expect(sim.rating.breakdown().bonusHints.join(' ')).toMatch(/debt/i);
  }, 120000);

  it('declaring bankruptcy ends the game: finance frozen, economy locked, speed 0 and it cannot be restarted', () => {
    const sim = mk(50000);
    const declared: GameEvents['finance:declaredBankrupt'][] = [];
    sim.bus.on('finance:declaredBankrupt', (e) => declared.push(e));
    sim.loop.setSpeed(2);
    sim.tick(10);
    expect(sim.finance.declareBankruptcy()).toBe(true);
    expect(declared).toHaveLength(1);
    expect(declared[0]!.reason).toBe('declared');
    expect(sim.finance.status).toBe('bankrupt');
    expect(sim.loop.speed).toBe(0);
    sim.loop.setSpeed(3);
    expect(sim.loop.speed).toBe(0);
    expect(sim.economy.locked).toBe(true);
    expect(sim.economy.canAfford(1)).toBe(false);
    const m = sim.game.money;
    sim.tick(TICKS_PER_DAY * 3);
    expect(sim.game.money).toBe(m);
  });

  it('startup grace: a fresh game with the starting grace never counts debt in the first days', () => {
    const sim = mk(-100);
    for (let t = 0; t < TICKS_PER_DAY * 10; t++) sim.tick(1);
    expect(sim.finance.negDays).toBe(0);
    expect(sim.finance.status).toBe('ok');
  });
});
