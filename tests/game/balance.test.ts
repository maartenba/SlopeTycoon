import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { Bot, runBot, type BotOptions, type MonthRow } from '../../src/game/bot';
import { makeResort, run, attachCounters } from './harness';
import { LOAN_OFFERS } from '../../src/config/prices';
import { GEAR_OWNERS } from '../../src/config/prices';
import { LIFT_OPS } from '../../src/config/liftOps';
import { DAYS_PER_YEAR, type DifficultyId } from '../../src/config/balance';

/**
 * Balance pass (Task 35, docs/balance.md). Default run = fast checks on a 64 map (~20 s). The 3-year x 3-size x seeds sweep and the
 * difficulty comparison run with `npm run test:balance` (BALANCE=1) and print the per-month tables used in docs/balance.md.
 */
const FULL = !!process.env.BALANCE || !!process.env.BENCH;
const sum = (rows: MonthRow[], f: (r: MonthRow) => number): number => rows.reduce((a, r) => a + f(r), 0);
const year = (rows: MonthRow[], y: number): MonthRow[] => rows.filter((r) => r.year === y);
const winter = (rows: MonthRow[], y: number): MonthRow[] => rows.filter((r) => r.year === y && r.month >= 8);
const summer = (rows: MonthRow[], y: number): MonthRow[] => rows.filter((r) => r.year === y && r.month >= 2 && r.month <= 5);

function play(size: 64 | 128 | 256, seed: number, days: number, o: BotOptions & { difficulty?: DifficultyId } = {}): { sim: Sim; bot: Bot } {
  const sim = createSim({ size, seed, difficulty: o.difficulty, now: () => 0 });
  const bot = new Bot(sim, o);
  runBot(sim, bot, days);
  return { sim, bot };
}
export const table = (rows: MonthRow[]): string => rows.map((r) => `y${r.year} m${String(r.month).padStart(2)} arr${String(r.guests).padStart(5)} ${r.rating}★ inc${String(Math.round(r.incomeTotal)).padStart(7)} exp${String(Math.round(r.expenseTotal)).padStart(7)} net${String(Math.round(r.net)).padStart(7)} cash${String(Math.round(r.cash)).padStart(8)} debt${String(Math.round(r.debt)).padStart(7)} inc#${r.incidents}`).join('\n');

describe('balance: early game and the first two years (64, Normal, bot)', () => {
  const { sim, bot } = play(64, 61, 2 * DAYS_PER_YEAR);
  const rows = bot.rows;

  it('first winter is roughly break-even to clearly-not-runaway positive (operating net of months 9-11)', () => {
    const w = rows.filter((r) => r.year === 1 && r.month >= 9);
    const net = sum(w, (r) => r.net);
    expect(net).toBeGreaterThan(-10_000);
    expect(net).toBeLessThan(100_000); // months 9-11 are 45 days now (15-day months): was 165k for 90 days; measured +61k
    expect(sim.finance.ended).toBe(false);
  });

  it('profit by the end of year 2 (annual net > 0), year 3 positive too (sweep: BALANCE=1)', () => {
    expect(sum(year(rows, 2), (r) => r.net)).toBeGreaterThan(0);
  });

  it('summer is viable but weaker than winter', () => {
    const w = winter(rows, 2), s = summer(rows, 2);
    const wNet = sum(w, (r) => r.net) / w.length, sNet = sum(s, (r) => r.net) / s.length;
    expect(sum(s, (r) => r.incomeTotal)).toBeGreaterThan(0.05 * sum(w, (r) => r.incomeTotal)); // viable: real income
    expect(sNet).toBeGreaterThan(0); // gentler summer (docs/balance.md): a bot with summer attractions earns every summer month (measured +2k..+16k per 15-day month; was -8k..-15k before the off-season demand floor + idle lift energy)
    const autumn = year(rows, 2).filter((r) => r.month === 6 || r.month === 7);
    expect(sum(autumn, (r) => r.net) / autumn.length).toBeGreaterThan(-8_000); // the autumn trough (no snow yet, no summer guests) stays shallow
    expect(sNet).toBeLessThan(wNet); // weaker than winter
  });

  it('rating 3-4.5 stars after year 1 and incidents stay moderate', () => {
    const y2 = year(rows, 2);
    const avg = sum(y2, (r) => r.rating) / y2.length;
    expect(avg).toBeGreaterThanOrEqual(3); expect(avg).toBeLessThanOrEqual(4.5);
    expect(sum(y2, (r) => r.incidents) / y2.length).toBeLessThan(12);
  });

  it('rental still earns with 82 % gear owners', () => {
    expect(GEAR_OWNERS.ski).toBeGreaterThanOrEqual(80); expect(GEAR_OWNERS.ski).toBeLessThanOrEqual(85);
    expect(sum(rows, (r) => r.income.rental ?? 0)).toBeGreaterThan(0);
  });

  it('magnitudes: energy is 3-25 % of lift revenue, wages + upkeep are not trivial', () => {
    const w = winter(rows, 2);
    const lifts = sum(w, (r) => r.income.lifts ?? 0) + sum(w, (r) => r.income.passes ?? 0), energy = sum(w, (r) => r.expense.energy ?? 0);
    expect(energy / lifts).toBeGreaterThan(0.03); expect(energy / lifts).toBeLessThan(0.25);
    expect(sum(w, (r) => (r.expense.upkeep ?? 0) + (r.expense.staff ?? 0)) / sum(w, (r) => r.incomeTotal)).toBeGreaterThan(0.15);
  });
});

describe('balance: the early loan is meaningful (128, tutorial-style starter chain)', () => {
  it('without the loan the chain leaves little cash; with it there is room to grow', () => {
    const a = new Bot(createSim({ size: 128, seed: 61, now: () => 0 })), b = new Bot(createSim({ size: 128, seed: 61, now: () => 0 }), { starterLoan: true });
    const starter = LOAN_OFFERS.find((o) => o.id === 'starter')!.baseAmount;
    expect(a.sim.game.money).toBeLessThan(35_000); // can't afford the next lift (+ piste) or a second lodge soon
    expect(b.sim.game.money - a.sim.game.money).toBeCloseTo(starter, -2);
    expect(b.sim.game.money).toBeGreaterThan(60_000);
    expect(a.report?.failures).toEqual([]);
  });
});

describe('balance: no runaway exploits (64, one winter)', () => {
  const base = sum(play(64, 61, DAYS_PER_YEAR * 2 / 3).bot.rows, (r) => r.net);
  it('extreme price strategies cannot beat the baseline by more than 1.6x', () => {
    for (const [name, f] of [['max prices', 100], ['min prices', 0.3], ['x2 markups', 2]] as const) {
      const { bot } = play(64, 61, DAYS_PER_YEAR * 2 / 3, { prices: (s) => { s.priceApi.set('dayPass', Math.min(s.pricing.maxOf('dayPass'), s.pricing.defaultOf('dayPass') * Math.min(f, 2.67))); if (f <= 1) s.priceApi.preset(f); else s.priceApi.preset(Math.min(f, 1.6)); } });
      const net = sum(bot.rows, (r) => r.net);
      expect(net, name).toBeLessThan(Math.max(base, 20_000) * 1.6);
    }
  });
  it('loan cycling (take everything, repay at once) never creates money', () => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0 });
    const before = sim.game.money;
    for (let i = 0; i < 25; i++) {
      for (const o of sim.loans.offers(sim.creditCtx())) if (o.available) sim.loans.take(o.id, sim.creditCtx(), { year: 1, month: 8 });
      for (const l of [...sim.loans.active()]) sim.loans.repay(l.id);
    }
    expect(sim.loans.totalDebt()).toBe(0);
    expect(sim.game.money).toBeLessThanOrEqual(before);
    // a starter loan held all winter costs interest: the loan is never profitable by itself
    const a = play(64, 61, 75, { starterLoan: true }), b = play(64, 61, 75);
    const money = (x: { sim: Sim }): number => x.sim.game.money - x.sim.loans.totalDebt();
    expect(money(a)).toBeLessThan(money(b) + 5_000);
  });
});

describe('balance: lift hours and arrival capacity', () => {
  it('default lift hours cover guests arriving until ~15:30', () => {
    expect(LIFT_OPS.defaultFrom).toBeLessThanOrEqual(8.5); expect(LIFT_OPS.defaultTo).toBeGreaterThanOrEqual(17);
  });
  for (const size of [64, 128, 256] as const) {
    it(`rides occur with the DEFAULT lift hours on a ${size} map`, () => {
      // Size independent: arrivals are spread over ~08-16 h and the first ride follows within a few hours even on 256 (docs/balance.md #10).
      const { sim } = makeResort(size, size === 256 ? 1337 : 7, { defaultHours: true, startDay: 167 });
      const c = attachCounters(sim);
      expect(run(sim, { days: 6 })).toEqual([]);
      expect(c.rides).toBeGreaterThanOrEqual(20);
    });
  }
  it('capacity-limited regime is NOT the normal regime: winter peak guests stay below parking capacity (1 parking = 200)', () => {
    const { sim } = makeResort(64, 61, { startDay: 167, defaultHours: true });
    let peak = 0;
    for (let d = 0; d < 20; d++) for (let t = 0; t < 24; t++) { sim.tick(10); peak = Math.max(peak, sim.guestSim.store.count); }
    expect(peak).toBeLessThan(160);
  });
});

describe.skipIf(!FULL)('[balance] 3-year sweep (BALANCE=1): sizes x seeds x difficulty', () => {
  const cases: Array<[64 | 128 | 256, number, boolean]> = [[64, 61, false], [64, 7, false], [128, 61, false], [128, 7, false], [256, 61, true], [256, 7, true]];
  for (const [size, seed, loan] of cases) {
    it(`${size} seed ${seed}: year-2 profit, year-3 profit, sane rating, never bankrupt`, () => {
      const { sim, bot } = play(size, seed, 3 * DAYS_PER_YEAR, { starterLoan: loan });
      console.log(`[balance] ${size} seed ${seed}${loan ? ' (starter loan)' : ''}\n${table(bot.rows)}`);
      expect(sim.finance.ended).toBe(false);
      expect(sum(year(bot.rows, 2), (r) => r.net)).toBeGreaterThan(0);
      expect(sum(year(bot.rows, 3), (r) => r.net)).toBeGreaterThan(0);
      const stars = sum(year(bot.rows, 2), (r) => r.rating) / 12;
      expect(stars).toBeGreaterThanOrEqual(3); expect(stars).toBeLessThanOrEqual(4.5);
    }, 600_000);
  }
  it('difficulty ordering (64): relaxed > normal > challenging, and challenging is still profitable in year 2', () => {
    const net = (d: DifficultyId): number => sum(year(play(64, 61, 2 * DAYS_PER_YEAR, { difficulty: d }).bot.rows, 2), (r) => r.net);
    const r = net('relaxed'), n = net('normal'), c = net('challenging');
    console.log(`[balance] difficulty year-2 net: relaxed ${Math.round(r)} normal ${Math.round(n)} challenging ${Math.round(c)}`);
    expect(r).toBeGreaterThan(n); expect(n).toBeGreaterThan(c); expect(c).toBeGreaterThan(0);
  }, 600_000);
});

describe.skipIf(!FULL)('[balance] goal grants (M5.1): the bot does not game goals', () => {
  for (const [size, seed, loan] of [[64, 61, false], [128, 61, false], [256, 61, true]] as Array<[64 | 128 | 256, number, boolean]>) {
    it(`${size} seed ${seed}: grants are <= 10 % of year-1 revenue and year 2 is profitable without them`, () => {
      const { bot } = play(size, seed, 2 * DAYS_PER_YEAR, { starterLoan: loan });
      const grant = (y: number): number => sum(year(bot.rows, y), (r) => r.income.grant ?? 0);
      const rev = (y: number): number => sum(year(bot.rows, y), (r) => r.incomeTotal);
      const net = (y: number): number => sum(year(bot.rows, y), (r) => r.net);
      console.log(`[balance] grants ${size}/${seed}: y1 net ${Math.round(net(1))} (grants ${Math.round(grant(1))}, ${(100 * grant(1) / Math.max(1, rev(1))).toFixed(1)} % of revenue, net w/o grants ${Math.round(net(1) - grant(1))}); y2 net ${Math.round(net(2))} (grants ${Math.round(grant(2))}, net w/o grants ${Math.round(net(2) - grant(2))})`);
      expect(grant(1)).toBeLessThanOrEqual(0.1 * rev(1));
      expect(net(2) - grant(2)).toBeGreaterThan(0);
    }, 600_000);
  }
});

describe.skipIf(!FULL)('[balance] Career with respectUnlocks (M5.3): the gating does not hurt the economy', () => {
  for (const [size, seed] of [[64, 61], [128, 7], [256, 7]] as Array<[64 | 128 | 256, number]>) {
    it(`${size} seed ${seed}: profit by year 2 on Normal, level 4 reached in year 2`, () => {
      const sim = createSim({ size, seed, mode: 'career', now: () => 0 });
      const bot = new Bot(sim, { respectUnlocks: true });
      const at: Record<number, string> = {};
      sim.progression.onLevelUp((u) => { at[u.level] = `y${sim.game.date.year}/d${sim.game.date.day}`; });
      runBot(sim, bot, 3 * DAYS_PER_YEAR);
      const net = (y: number): number => sum(year(bot.rows, y), (r) => r.net);
      console.log(`[balance] career ${size}/${seed}: levels ${JSON.stringify(at)}; y2 net ${Math.round(net(2))}, y3 net ${Math.round(net(3))}`);
      expect(net(2)).toBeGreaterThan(0);
      expect(net(3)).toBeGreaterThan(0);
      expect(sim.progression.level).toBeGreaterThanOrEqual(4);
      expect(at[4]).toBeDefined();
    }, 600_000);
  }
});

describe.skipIf(!FULL)('[balance] everything on (M5.4 closing sweep): automatic events, story guests, rivals, six staff upgrades, green bot', () => {
  const cases: Array<[64 | 128 | 256, number, boolean]> = [[64, 61, false], [64, 7, false], [128, 61, false], [128, 7, false], [256, 61, true], [256, 7, true]];
  for (const [size, seed, loan] of cases) {
    it(`${size} seed ${seed}: profit by year 2 and 3 holds with every depth system active`, () => {
      const sim = createSim({ size, seed, now: () => 0 });
      const bot = new Bot(sim, { starterLoan: loan, staffUpgrades: true });
      runBot(sim, bot, 3 * DAYS_PER_YEAR);
      const net = (y: number): number => sum(year(bot.rows, y), (r) => r.net);
      const stars = sum(year(bot.rows, 2), (r) => r.rating) / 12;
      console.log(`[balance] all-on ${size}/${seed}${loan ? ' (starter loan)' : ''}: y1 ${Math.round(net(1))} y2 ${Math.round(net(2))} y3 ${Math.round(net(3))} ($), y2 stars ${stars.toFixed(2)}, rivals share ${(100 * sim.rivals.share).toFixed(0)} %, upgrades ${sim.staffUpgrades.has('rangers') ? 'trained' : 'partial'}`);
      expect(sim.finance.ended).toBe(false);
      expect(net(2)).toBeGreaterThan(0);
      expect(net(3)).toBeGreaterThan(0);
      expect(stars).toBeGreaterThanOrEqual(3); expect(stars).toBeLessThanOrEqual(4.6);
    }, 900_000);
  }
});
