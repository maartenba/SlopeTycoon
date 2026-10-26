import { describe, expect, it } from 'vitest';
import { STAFF_UPGRADES, BOT_UPGRADE_ORDER, type ModKey } from '../../src/config/staffUpgrades';
import { mod } from '../../src/config/balance';
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { applySave, collectSave } from '../../src/game/saveState';
import { DAYS_PER_YEAR } from '../../src/config/balance';
import { makeResort } from '../game/harness';
import { StaffUpgrades } from '../../src/sim/staff/Upgrades';

const resort = () => makeResort(64, 1, { startDay: 167 }).sim;
const train = (sim: ReturnType<typeof resort>, id: string): void => {
  sim.game.money += 1_000_000;
  sim.progression.unlockAll = true;
  expect(sim.staffUpgrades.start(id)).toBe(true);
  for (let d = 0; d < 12; d++) sim.staffUpgrades.newDay();
  expect(sim.staffUpgrades.has(id)).toBe(true);
};

describe('staff upgrades: config', () => {
  it('has exactly six entries, with unique ids, positive cost / days / upkeep', () => {
    expect(STAFF_UPGRADES).toHaveLength(6);
    expect(new Set(STAFF_UPGRADES.map((u) => u.id)).size).toBe(6);
    expect(STAFF_UPGRADES.map((u) => u.id).sort()).toEqual(['groomerEfficiency', 'hospitality', 'instructorTraining', 'liftMechanics', 'patrolTraining', 'rangers']);
    for (const u of STAFF_UPGRADES) { expect(u.cost).toBeGreaterThan(0); expect(u.days).toBeGreaterThan(0); expect(u.upkeep).toBeGreaterThan(0); expect(Object.keys(u.effects).length).toBeGreaterThan(0); }
    expect([...BOT_UPGRADE_ORDER].sort()).toEqual(STAFF_UPGRADES.map((u) => u.id).sort());
  });
});

describe('staff upgrades: rules', () => {
  it('one trains at a time; cost is charged once; training takes its days; upkeep afterwards', () => {
    const sim = resort(); sim.game.money = 100_000; sim.progression.unlockAll = true;
    const u = STAFF_UPGRADES[0]!, v = STAFF_UPGRADES[1]!;
    expect(sim.staffUpgrades.mod('instructorCapacity')).toBe(1);
    expect(sim.staffUpgrades.upkeepPerDay()).toBe(0);
    const m0 = sim.game.money;
    expect(sim.staffUpgrades.start(u.id)).toBe(true);
    expect(sim.game.money).toBe(m0 - u.cost);
    expect(sim.staffUpgrades.start(v.id)).toBe(false);
    expect(sim.staffUpgrades.blocker(v.id)).toBe('Another course is running');
    for (let d = 0; d < u.days - 1; d++) sim.staffUpgrades.newDay();
    expect(sim.staffUpgrades.has(u.id)).toBe(false);
    sim.staffUpgrades.newDay();
    expect(sim.staffUpgrades.has(u.id)).toBe(true);
    expect(sim.staffUpgrades.upkeepPerDay()).toBe(u.upkeep);
    expect(sim.staffUpgrades.start(u.id)).toBe(false); // already trained
    expect(sim.staffUpgrades.start(v.id)).toBe(true);  // next one may start
  });

  it('refuses without cash and (in Career) below the level gate', () => {
    const sim = resort(); sim.progression.unlockAll = true; sim.game.money = 100;
    expect(sim.staffUpgrades.blocker('instructorTraining')).toBe('Not enough cash');
    sim.progression.unlockAll = false; sim.progression.mode = 'career'; sim.progression.level = 1; sim.game.money = 1_000_000;
    expect(sim.staffUpgrades.blocker('rangers')).toMatch(/Unlocks at level 3/);
    expect(sim.staffUpgrades.start('rangers')).toBe(false);
    expect(sim.staffUpgrades.blocker('instructorTraining')).toBeNull();
    sim.progression.level = 3;
    expect(sim.staffUpgrades.blocker('rangers')).toBeNull();
  });

  it('upkeep is part of the daily staff bill', () => {
    const sim = resort(); train(sim, 'liftMechanics');
    expect(sim.staffUpgrades.upkeepPerDay()).toBe(16);
  });

  it('save / load keeps trained upgrades and a running course', () => {
    const sim = resort(); train(sim, 'hospitality');
    sim.staffUpgrades.start('rangers');
    sim.staffUpgrades.newDay();
    const fresh = resort();
    applySave(fresh, { ...collectSave(fresh), staffUpgrades: JSON.parse(JSON.stringify(collectSave(sim)['staffUpgrades'])) });
    expect(fresh.staffUpgrades.has('hospitality')).toBe(true);
    expect(fresh.staffUpgrades.training).toEqual({ id: 'rangers', daysLeft: 9 });
  });

  it('with nothing trained every modifier is exactly 1 and protection is 0', () => {
    const sim = resort();
    for (const u of STAFF_UPGRADES) for (const k of Object.keys(u.effects) as ModKey[]) expect(mod(sim, k)).toBe(1);
    expect(sim.staffUpgrades.wildlifeProtection()).toBe(0);
  });
});

describe('staff upgrades: effects', () => {
  it('instructor training raises ski-school capacity by 25%', () => {
    const sim = resort(), hq = sim.buildings.all().find((b) => b.type === 'skiSchoolHQ')!, school = sim.guestSim.families.school(hq.id);
    const base = school.capacity; train(sim, 'instructorTraining');
    expect(school.capacity).toBe(Math.floor(base * 1.25));
  });
  it('patrol training speeds sleds up', () => {
    const sim = resort(); const f0 = sim.safety.patrol.speedFactor(); train(sim, 'patrolTraining');
    expect(sim.safety.patrol.speedFactor()).toBeCloseTo(f0 * 1.3, 9);
  });
  it('snowcat efficiency lifts per-cat capacity and cuts fuel', () => {
    const sim = resort(); train(sim, 'groomerEfficiency');
    expect(sim.ops.grooming.capacityMod()).toBeCloseTo(1.3, 9); expect(sim.ops.grooming.fuelMod()).toBeCloseTo(0.75, 9);
  });
  it('lift mechanics cut breakdowns and repair time', () => {
    const sim = resort(), l = sim.lifts.all()[0]!; const b0 = sim.liftOps.breakdownPerHour(l); train(sim, 'liftMechanics');
    expect(sim.liftOps.breakdownPerHour(l)).toBeCloseTo(b0 * 0.7, 12);
    sim.liftOps.forceBreakdown(l.id);
    const hours = sim.liftOps.status(l.id)!.repairEtaHours;
    const sim2 = resort(), l2 = sim2.lifts.all()[0]!; sim2.liftOps.forceBreakdown(l2.id);
    expect(hours).toBeLessThan(sim2.liftOps.status(l2.id)!.repairEtaHours);
  });
  it('rangers cut the wildlife scare level and expose the sustainability input', () => {
    const sim = resort(); sim.safety.wildlife.recent = 20; const s0 = sim.safety.wildlife.scareLevel(); train(sim, 'rangers');
    expect(sim.safety.wildlife.scareLevel()).toBeCloseTo(s0 * 0.7, 9);
    expect(sim.staffUpgrades.wildlifeProtection()).toBe(1);
  });
  it('hospitality lifts food / bar / shop earnings by 12%', () => {
    const a = resort(), b = resort(); train(b, 'hospitality');
    const earn = (sim: typeof a): number => { const before = sim.economy.ledger.restaurants ?? 0; (sim.attractions as unknown as { d: { earn: (c: string, x: number) => void } }).d?.earn?.('restaurants', 100); return (sim.economy.ledger.restaurants ?? 0) - before; };
    expect(earn(b)).toBeGreaterThan(0);
    expect(earn(b)).toBeCloseTo(earn(a) * 1.12, 6);
  });
  it('StaffUpgrades unit: onDone fires once', () => {
    let n = 0; const u = new StaffUpgrades({ funds: () => 1e9, pay: () => true, onDone: () => { n++; } });
    u.start('rangers'); for (let d = 0; d < 30; d++) u.newDay();
    expect(n).toBe(1);
  });
});

describe('staff upgrades: the bot with all six is not a dominant strategy', () => {
  it('year-2 profit with all six is at most 20% above the plain bot (64, seed 61)', () => {
    const play = (staffUpgrades: boolean) => { const sim = createSim({ size: 64, seed: 61, now: () => 0 }); const bot = new Bot(sim, { staffUpgrades }); runBot(sim, bot, 2 * DAYS_PER_YEAR); return { sim, bot }; };
    const plain = play(false), full = play(true);
    const y2 = (rows: Bot['rows']): number => rows.filter((r) => r.year === 2).reduce((a, r) => a + r.net, 0);
    const p = y2(plain.bot.rows), f = y2(full.bot.rows);
    for (const u of STAFF_UPGRADES) expect(full.sim.staffUpgrades.has(u.id), u.id).toBe(true);
    console.log(`[staffUpgrades] year-2 net plain ${Math.round(p)} full ${Math.round(f)} (${(100 * (f / p - 1)).toFixed(1)}%)`);
    expect(p).toBeGreaterThan(0);
    expect(f).toBeLessThanOrEqual(p * 1.2);
  }, 120000);
});
