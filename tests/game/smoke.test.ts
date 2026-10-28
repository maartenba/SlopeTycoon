import { describe, expect, it } from 'vitest';
import { attachCounters, fullHash, makeResort, run, scanProblems, StallTracker, GState } from './harness';
import { createSim, EXPECTED_SYSTEM_IDS } from '../../src/game/createSim';
import { Buildings } from '../../src/sim/Buildings';
import { LiftStore } from '../../src/sim/Lift';

const SEEDS: Record<64 | 128 | 256, number[]> = { 64: [1, 7, 1337], 128: [1, 42], 256: [1337] };
const SIZES = [64, 128, 256] as const;
/** Idle 840 (was 480): an overnight family can keep its kid idling in the lodge for up to three nights (~750 ticks; seen with the 150 s-day pacing). Idle 480 earlier: family kids (controlled by the family system, so never put to Sleeping) idle through the night in the lodge: 250-360 consecutive ticks depending on arrival hour (daylight arrival window). */
/** Max consecutive ticks a guest may sit in the same state/activity/tile (Sleeping excluded: nights are long). */
const STALL_LIMIT: Record<number, number> = { [GState.Walking]: 120, [GState.Idle]: 840, [GState.Leaving]: 120, [GState.Queueing]: 1500, [GState.Riding]: 300, [GState.Using]: 300, [GState.Injured]: 900 };

describe('createSim composition', () => {
  it('registers every system in order and exposes the wired sim objects', () => {
    const sim = createSim({ size: 64, seed: 3 });
    expect(sim.registry.ids()).toEqual([...EXPECTED_SYSTEM_IDS]);
    for (const id of EXPECTED_SYSTEM_IDS) {
      expect(sim.registry.get(id), id).toBeDefined();
    }
    expect(sim.buildings.all().some((b) => b.type === 'baseLodge')).toBe(true);
    expect(sim.networks.roadEntry).toBeTruthy();
    expect(sim.registry.get('ops')).toBe(sim.ops.system);
    expect(sim.registry.get('rating')).toBeDefined();
    expect(sim.guestWorld.nav?.()).toBe(sim.navWorld);
  });
});

describe('starter resort', () => {
  for (const size of SIZES) {
    it(`builds a complete connected resort at ${size}`, () => {
      const { sim, report } = makeResort(size, SEEDS[size][0]!);
      expect(report.failures).toEqual([]);
      expect(report.lifts.length).toBeGreaterThanOrEqual(size === 256 ? 2 : 1);
      expect(report.pisteTiles).toBeGreaterThan(30);
      for (const t of ['parking', 'ticketOffice', 'lodge', 'skiSchoolHQ', 'magicCarpet', 'patrolHub', 'firstAid', 'groomerGarage', 'reservoir', 'snowCannon']) expect(report.placed[t], t).toBeGreaterThan(0);
      const inactive = sim.buildings.all().filter((b) => !b.active).map((b) => `${b.type}: ${b.reason}`);
      expect(inactive).toEqual([]);
      expect(sim.lifts.all().every((l) => l.open)).toBe(true);
      // the parking sits on a road that is connected to the road entry
      const parking = sim.buildings.all().filter((b) => b.type === 'parking');
      expect(parking.length).toBeGreaterThan(0);
      for (const p of parking) { expect(p.active, `parking ${p.reason}`).toBe(true); expect(sim.networks.serves('road', p), 'parking road').toBe(true); }
    });
  }
});

describe('full-game smoke (3 days, max catch-up)', () => {
  for (const size of SIZES) for (const seed of SEEDS[size]) {
    it(`size ${size} seed ${seed}: runs clean, guests ride, money/ledger consistent, deterministic`, () => {
      const { sim } = makeResort(size, seed);
      const c = attachCounters(sim);
      const stall = new StallTracker(sim);
      const m0 = sim.game.money, inc0 = sim.economy.lifetimeIncome(), exp0 = sim.economy.lifetimeExpense();
      const problems = run(sim, { days: 3, stall });
      expect(problems).toEqual([]);

      expect(c.events['guest:arrived'] ?? 0).toBeGreaterThan(0);
      expect(c.rides).toBeGreaterThan(0);
      for (const k of ['money:changed', 'day:changed', 'ops:grooming']) expect(c.events[k] ?? 0, k).toBeGreaterThan(0);
      expect(c.events['weather:changed'] ?? 0).toBeGreaterThanOrEqual(0);

      // ledger consistency: no construction/loans during the run, so cash change == income - expense (to the cent)
      const dMoney = sim.game.money - m0, dLedger = sim.economy.lifetimeIncome() - inc0 - (sim.economy.lifetimeExpense() - exp0);
      expect(dMoney).not.toBe(0);
      expect(Math.abs(dMoney - dLedger)).toBeLessThan(0.05);

      // no softlocks
      for (const [s, lim] of Object.entries(STALL_LIMIT)) expect(stall.maxRun[Number(s)] ?? 0, `state ${s}: ${stall.worst[Number(s)]}`).toBeLessThan(lim);

      // determinism: identical build + run -> identical hash
      const h1 = fullHash(sim);
      const b = makeResort(size, seed).sim;
      run(b, { days: 3, scanEvery: 1000 });
      expect(fullHash(b)).toBe(h1);
    }, 120000);
  }
});

describe('full-game smoke (30 days across a season boundary)', () => {
  for (const size of [64, 128] as const) {
    it(`size ${size}: winter -> spring, new year, month closes`, () => {
      const { sim } = makeResort(size, SEEDS[size][0]!, { startDay: 170 });
      const c = attachCounters(sim);
      const stall = new StallTracker(sim);
      const problems = run(sim, { days: 30, scanEvery: 120, stall });
      expect(problems).toEqual([]);
      expect(sim.game.date.year).toBe(2);
      expect(c.events['season:changed'] ?? 0).toBeGreaterThanOrEqual(1);
      expect(c.events['year:changed'] ?? 0).toBe(1);
      expect(c.events['month:changed'] ?? 0).toBeGreaterThanOrEqual(1);
      expect(c.events['finance:monthClosed'] ?? 0).toBeGreaterThanOrEqual(1);
      expect(c.events['day:changed'] ?? 0).toBeGreaterThanOrEqual(29);
      expect(c.events['ops:grooming'] ?? 0).toBeGreaterThan(0);
      expect(c.events['guest:arrived'] ?? 0).toBeGreaterThan(0);
      expect(c.rides).toBeGreaterThan(0);
      // (lift:opened/closed used to be asserted for 128 here, but only fired because avalanches closed pistes all winter; avalanches are rare now.)
      for (const [s, lim] of Object.entries(STALL_LIMIT)) expect(stall.maxRun[Number(s)] ?? 0, `state ${s}: ${stall.worst[Number(s)]}`).toBeLessThan(lim);
      expect(scanProblems(sim)).toEqual([]);
    }, 240000);
  }
});

describe('serialise roundtrip', () => {
  it('registry + buildings + lifts survive JSON and reload into an identical fresh sim', () => {
    const { sim } = makeResort(64, 5);
    run(sim, { days: 1.5, scanEvery: 1000 });
    const data = JSON.parse(JSON.stringify(sim.registry.serialize())) as Record<string, unknown>;
    expect(Object.keys(data).length).toBeGreaterThan(3);
    const blds = JSON.parse(JSON.stringify(sim.buildings.serialize()));
    const lifts = JSON.parse(JSON.stringify(sim.lifts.serialize()));
    expect(() => new Buildings(sim.grid.occupancy).load(blds)).not.toThrow();
    expect(() => new LiftStore(sim.grid.occupancy).load(lifts)).not.toThrow();
    // reload into a twin built the same way (fresh terrain + starter)
    const twin = makeResort(64, 5).sim;
    twin.game.date = { ...sim.game.date };
    twin.game.money = sim.game.money;
    twin.game.rng.setState(sim.game.rng.getState());
    twin.registry.load(data);
    const again = JSON.parse(JSON.stringify(twin.registry.serialize())) as Record<string, unknown>;
    // every system except `guests` round-trips exactly. Guests: riders/queuers are demoted to Idle on load (lift queues are not
    // persisted, by design), so compare idempotence instead: save(load(save)) is a fixed point.
    for (const k of Object.keys(data)) if (k !== 'guests') expect(JSON.stringify(again[k]), `system ${k}`).toBe(JSON.stringify(data[k]));
    const twin2 = makeResort(64, 5).sim;
    twin2.registry.load(again);
    expect(JSON.stringify(twin2.registry.serialize().guests)).toBe(JSON.stringify(again.guests));
    expect(twin.guestSim.store.count).toBe(sim.guestSim.store.count);
  }, 60000);
});

describe('early-game finances', () => {
  it('fresh game, no player actions: never bankrupt in the first year, money > 0 for 120 days, no finance:bankrupt event', () => {
    const sim = createSim({ size: 128, seed: 1, now: () => 0 });
    let bankrupt = 0;
    sim.bus.on('finance:bankrupt', () => bankrupt++);
    expect(sim.game.money).toBe(150000);
    for (let d = 1; d <= 365; d++) {
      run(sim, { days: 1 });
      if (d <= 120) { expect(sim.game.money, `day ${d}`).toBeGreaterThan(0); expect(bankrupt).toBe(0); }
    }
    expect(bankrupt).toBe(0);
    expect(sim.finance.status).toBe('ok');
  }, 60000);

  it('starter resort over 60 days has guests and revenue', () => {
    const { sim } = makeResort(128, 1);
    let arrived = 0;
    sim.bus.on('guest:arrived', () => arrived++);
    const before = sim.game.money;
    run(sim, { days: 60 });
    expect(arrived).toBeGreaterThan(0);
    expect(sim.game.money).toBeGreaterThan(before);
  }, 60000);
});
