import { DAYS_PER_YEAR } from '@/config/balance';
import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { buildDemoResort, spawnGuests } from '../../src/game/demoResort';
import { stateHash } from '../../src/sim/Systems';
import { GState } from '../../src/sim/guests/Guest';
import { isSkiMode } from '../../src/sim/guests/NavGraph';

const build = (size: 64 | 128, seed: number, level: 'starter' | 'medium' | 'large' = 'large') => {
  const sim = createSim({ size, seed, startSeason: 'winter', now: () => 0 });
  const report = buildDemoResort(sim, level);
  return { sim, report };
};

describe('buildDemoResort', () => {
  it('is deterministic: same seed -> same report and same sim hash', () => {
    const a = build(64, 7), b = build(64, 7);
    expect(a.report).toEqual(b.report);
    expect(stateHash(a.sim.game, a.sim.registry)).toBe(stateHash(b.sim.game, b.sim.registry));
  });

  it('builds the full showcase on 64 and 128 (4 lift kinds, pistes, trails, village, no failures)', () => {
    for (const size of [64, 128] as const) {
      const { sim, report } = build(size, 7);
      expect(report.failures, `size ${size}`).toEqual([]);
      expect(report.lifts.map((l) => l.kind)).toEqual(['tbar', 'chair4d', 'chair8b', 'gondola6']);
      expect(report.pisteTiles).toBeGreaterThan(150);
      expect(report.hikeTiles).toBeGreaterThan(10);
      expect(report.mtbTiles).toBeGreaterThan(10);
      expect(report.pisteMids.length).toBe(4);
      for (const t of ['baseLodge', 'chalet', 'apartment', 'lodge', 'mountainHut', 'skiSchoolHQ', 'magicCarpet', 'ticketOffice', 'rental', 'shop', 'parking', 'trainStation', 'patrolHub', 'firstAid', 'groomerGarage', 'snowcatOutpost', 'snowCannon', 'reservoir', 'rangerStation', 'alpineFarm']) {
        expect(sim.buildings.all().some((b) => b.type === t), `${t} on ${size}`).toBe(true);
      }
      expect(sim.buildings.all().filter((b) => !b.active).map((b) => `${size} ${b.type}: ${b.reason}`)).toEqual([]);
    }
  });

  it('is free (funds unchanged) and idempotent-ish: a second run adds no lifts and no duplicate core buildings', () => {
    const { sim } = build(64, 7, 'medium');
    const money = sim.game.money, lifts = sim.lifts.all().length, parking = sim.buildings.all().filter((b) => b.type === 'parking').length;
    const r2 = buildDemoResort(sim, 'medium');
    expect(sim.game.money).toBe(money);
    expect(sim.lifts.all().length).toBe(lifts);
    expect(r2.lifts).toEqual([]);
    expect(sim.buildings.all().filter((b) => b.type === 'parking').length).toBe(parking);
  });

  it('reports failures instead of throwing (no base lodge)', () => {
    const sim = createSim({ size: 64, seed: 7, lodge: false, now: () => 0 });
    const r = buildDemoResort(sim, 'large');
    expect(r.failures.length).toBeGreaterThan(0);
    expect(r.failures.join(' ')).toMatch(/lodge/i);
    expect(r.lifts).toEqual([]);
  });

  it('levels scale: starter < medium < large', () => {
    const n = (l: 'starter' | 'medium' | 'large'): number => build(64, 7, l).sim.buildings.all().length;
    expect(n('starter')).toBeLessThan(n('medium'));
    expect(n('medium')).toBeLessThan(n('large'));
  });
});

describe('buildDemoResort on other seeds (debug populate must work anywhere)', () => {
  for (const [size, seed] of [[64, 1], [64, 5], [64, 42], [128, 1337], [128, 9]] as const) {
    it(`size ${size} seed ${seed}: builds lifts + pistes, never throws, leaves no inactive building`, () => {
      const { sim, report } = build(size, seed, 'medium');
      expect(report.lifts.length).toBeGreaterThanOrEqual(2);
      expect(report.pisteTiles).toBeGreaterThan(100);
      expect(sim.buildings.all().filter((b) => !b.active).map((b) => `${b.type}: ${b.reason}`)).toEqual([]);
      expect(Array.isArray(report.failures)).toBe(true);
    });
  }
});

describe('demo resort smoke (128, several days)', () => {
  it('guests >= 150 at peak, lifts run, ski runs happen, nothing goes NaN, no exceptions', () => {
    const { sim } = build(128, 7);
    sim.jumpToDay(135, 9);
    const rides = { n: 0 };
    const prev = sim.guestWorld.onLiftRide;
    sim.guestWorld.onLiftRide = (l, id) => { rides.n++; prev?.(l, id); };
    spawnGuests(sim, 260, 'skiers', 1);
    const st = sim.guestSim.store;
    let peak = 0, skiing = 0, nan = 0, lastTop = -1;
    for (let day = 0; day < 4; day++) {
      for (let k = 0; k < 240; k++) {
        sim.tick(1);
        peak = Math.max(peak, st.count);
        const hr = sim.game.date.minute / 60, abs = sim.game.date.year * DAYS_PER_YEAR + sim.game.date.day;
        if (hr >= 8.5 && hr < 12 && abs !== lastTop) { lastTop = abs; if (260 - st.count > 15) spawnGuests(sim, 260 - st.count, 'skiers', 10 + day); }
        if (k % 20 === 0) for (let i = 0; i < st.limit; i++) if (st.alive[i]) {
          if (!Number.isFinite(st.x[i]!) || !Number.isFinite(st.y[i]!) || !Number.isFinite(st.z[i]!)) nan++;
          if (st.state[i] === GState.Walking && isSkiMode(st.moveMode[i]!)) skiing++;
        }
      }
    }
    expect(nan).toBe(0);
    expect(peak).toBeGreaterThanOrEqual(150);
    expect(rides.n).toBeGreaterThan(50);
    expect(skiing).toBeGreaterThan(0);
    expect(sim.lifts.all().some((l) => l.open)).toBe(true);
    expect(Number.isFinite(sim.game.money)).toBe(true);
  }, 120000);
});

describe('spawnGuests', () => {
  it('adds guests with a private RNG (deterministic, sim RNG state untouched)', () => {
    const a = build(64, 7).sim, b = build(64, 7).sim;
    const before = a.game.rng.getState();
    expect(spawnGuests(a, 40, 'mixed', 3)).toBe(40);
    expect(spawnGuests(b, 40, 'mixed', 3)).toBe(40);
    expect(a.game.rng.getState()).toBe(before);
    expect(Array.from(a.guestSim.store.x.slice(0, 40))).toEqual(Array.from(b.guestSim.store.x.slice(0, 40)));
  });
});
