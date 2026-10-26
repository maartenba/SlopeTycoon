import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { Bot, type MonthRow } from '../../src/game/bot';
import { DIFFICULTY, DAYS_PER_YEAR, OFFSEASON_RELIEF } from '../../src/config/balance';
import { DEBT, SUPPORT_LOAN } from '../../src/config/prices';
import { seasonStartDay } from '../../src/sim/Clock';
import { offSeasonNoLiftFactor, SEASON_RATE } from '../../src/sim/guests/Spawner';
import { Finance } from '../../src/sim/Finance';
import { Economy } from '../../src/sim/Economy';
import { Loans } from '../../src/sim/Loans';
import { createGameState } from '../../src/core/GameState';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { RULES } from '../../src/sim/advisor/rules';

/**
 * Gentler summer (docs/balance.md): a WINTER-FOCUSED resort (chain of lifts + pistes + restaurant + ski school, starter loan + a small loan, NO
 * summer attractions, the lifts are left on the default schedule) must get through its first summer and autumn without going broke.
 */
const LIFTS: Record<64 | 128 | 256, number> = { 64: 2, 128: 3, 256: 4 };
const sum = (rows: MonthRow[], f: (r: MonthRow) => number): number => rows.reduce((a, r) => a + f(r), 0);

function winterResort(size: 64 | 128 | 256, seed: number, difficulty?: 'normal' | 'challenging'): { sim: Sim; bot: Bot } {
  const sim = createSim({ size, seed, difficulty, now: () => 0 });
  const bot = new Bot(sim, { starterLoan: true, expand: false, marketing: false, starterOpts: { lifts: LIFTS[size], attractions: 3 } });
  sim.bus.on('finance:monthClosed', () => bot.snapshotMonth());
  bot.takeLoan('small');
  return { sim, bot };
}

describe('gentler summer: a winter-focused resort with the starter loan survives its first summer', () => {
  for (const size of [64, 128, 256] as const) {
    for (const seed of [61, 7, 1337]) {
      it(`${size} seed ${seed}: cash never below -$100k, no bankruptcy, summer + autumn net >= -$5k per month`, () => {
        const { sim, bot } = winterResort(size, seed);
        const ev: string[] = [];
        for (const k of ['finance:bankrupt', 'finance:declaredBankrupt'] as const) sim.bus.on(k, () => ev.push(k));
        let minCash = Infinity;
        for (let d = 0; d < DAYS_PER_YEAR + 150; d++) {
          if (d === DAYS_PER_YEAR) sim.game.money = 10_000; // stress: the player has spent the winter profit by spring
          sim.tick(240);
          if (d >= DAYS_PER_YEAR) minCash = Math.min(minCash, sim.game.money);
        }
        expect(ev).toEqual([]);
        expect(sim.finance.ended).toBe(false);
        expect(minCash).toBeGreaterThan(-100_000);
        const off = bot.rows.filter((r) => r.year === 2 && r.month >= 2 && r.month <= 7); // summer (2-5) + autumn (6-7)
        expect(off.length).toBe(6);
        expect(sum(off, (r) => r.net) / off.length).toBeGreaterThan(-5_000);
      }, 240_000);
    }
  }
});

describe('Tourism Board off-season support loan', () => {
  const inSeason = (season: 'spring' | 'summer' | 'autumn' | 'winter', money = -2_000): Sim => {
    const sim = createSim({ size: 64, seed: 3, money, now: () => 0 });
    sim.game.date.day = seasonStartDay(season) + 5;
    sim.tick(240 * 20); // past the 14 grace days
    return sim;
  };
  it('is offered once at the first negative-cash moment in summer or autumn: free, 12 months, <= $40k, ignores the debt cap', () => {
    const sim = inSeason('summer', 500);
    expect(sim.loans.supportState).toBe('none');
    expect(sim.loans.offers(sim.creditCtx()).some((o) => o.id === 'support')).toBe(false);
    sim.game.money = -3_000; sim.tick(240 * 3);
    expect(sim.loans.supportState).toBe('open');
    const o = sim.loans.offers(sim.creditCtx()).find((x) => x.id === 'support')!;
    expect(o).toBeTruthy();
    expect(o.ratePct).toBe(0); expect(o.termMonths).toBe(SUPPORT_LOAN.termMonths); expect(o.amount).toBeLessThanOrEqual(40_000); expect(o.amount).toBeGreaterThanOrEqual(15_000);
    expect(o.available).toBe(true);
    const before = sim.game.money;
    const r = sim.loans.take('support', sim.creditCtx(), { year: 1, month: 3 });
    expect(r.ok).toBe(true);
    expect(sim.game.money).toBe(before + o.amount);
    expect(sim.loans.supportState).toBe('taken');
    expect(sim.loans.active()[0]!.rateBp).toBe(0);
    // paid back with zero interest
    const pay = sim.loans.active()[0]!.instalment / 100;
    expect(pay * SUPPORT_LOAN.termMonths).toBeCloseTo(o.amount, 0);
    // never again, even after another dip
    sim.game.money = -3_000; sim.tick(240 * 3);
    expect(sim.loans.offers(sim.creditCtx()).some((x) => x.id === 'support')).toBe(false);
  });
  it('the starter loan is still available after taking the support loan', () => {
    const sim = inSeason('autumn');
    expect(sim.loans.supportOpen).toBe(true);
    expect(sim.loans.take('support', sim.creditCtx(), { year: 1, month: 7 }).ok).toBe(true);
    expect(sim.loans.offers(sim.creditCtx()).find((x) => x.id === 'starter')!.available).toBe(true);
  });
  it('winter debt does not trigger it; an open offer lapses when winter starts; save/load keeps the state', () => {
    const w = inSeason('winter');
    expect(w.loans.supportState).toBe('none');
    const a = inSeason('autumn');
    expect(a.loans.supportOpen).toBe(true);
    const saved = JSON.parse(JSON.stringify(a.loans.serialize()));
    const b = createSim({ size: 64, seed: 3, now: () => 0 });
    b.loans.load(saved);
    expect(b.loans.supportOpen).toBe(true);
    a.game.date.day = seasonStartDay('winter');
    a.tick(240 * 2);
    expect(a.loans.supportState).toBe('expired');
    expect(a.loans.offers(a.creditCtx()).some((x) => x.id === 'support')).toBe(false);
  });
  it('the advisor mentions it while the offer is open', () => {
    const sim = inSeason('summer');
    sim.advisor.evaluate(true);
    expect(sim.advisor.ranked().find((x) => x.id === 'cash.debt')?.why).toMatch(/support loan/);
  });
});

describe('Ranger Rudi: "Summer is coming" cash advice', () => {
  it('fires in the last 20 days of spring with the amount to save; quiet when the cash is there; gone when summer starts', () => {
    const sim = createSim({ size: 64, seed: 3, starterResort: true, startSeason: 'winter', now: () => 0 } as never);
    sim.tick(240 * 3);
    sim.game.date.day = seasonStartDay('summer') - 10; sim.game.money = 900;
    sim.advisor.evaluate(true);
    const a = sim.advisor.ranked().find((x) => x.id === 'cash.summerBuffer');
    expect(a).toBeTruthy(); expect(a!.why).toMatch(/Summer starts in 10 days/); expect(a!.why).toMatch(/\$[\d,]+/);
    sim.game.money = 5_000_000; sim.advisor.evaluate(true);
    expect(sim.advisor.ranked().some((x) => x.id === 'cash.summerBuffer')).toBe(false);
    sim.game.money = 900; sim.game.date.day = seasonStartDay('spring') + 5; sim.advisor.evaluate(true);
    expect(sim.advisor.ranked().some((x) => x.id === 'cash.summerBuffer')).toBe(false);
    expect(RULES.some((r) => r.id === 'cash.summerBuffer')).toBe(true);
  });
});

describe('off-season relief: mothballed winter buildings and seasonal furlough', () => {
  it('summer: winter-only buildings pay a quarter of their upkeep and closed venues furlough their staff', () => {
    const sim = createSim({ size: 128, seed: 61, now: () => 0 });
    new Bot(sim, { starterLoan: true, expand: false, marketing: false });
    sim.game.date.day = seasonStartDay('summer') + 2;
    sim.tick(240 * 8);
    expect(sim.relief.mothball).toBeGreaterThan(0);
    expect(sim.relief.furlough).toBeGreaterThan(0);
    expect(OFFSEASON_RELIEF.winterOnlyUpkeepShare).toBeLessThan(0.5);
  });
  it('winter: no mothball relief for the same buildings', () => {
    const sim = createSim({ size: 128, seed: 61, now: () => 0 });
    new Bot(sim, { starterLoan: true, expand: false, marketing: false });
    sim.game.date.day = seasonStartDay('winter') + 2;
    sim.tick(240 * 4);
    expect(sim.relief.mothball).toBe(0);
  });
  it('idle lifts draw only a share of the energy of busy ones', async () => {
    const { LIFT_OPS } = await import('../../src/config/liftOps');
    expect(LIFT_OPS.idleEnergyShare).toBeGreaterThan(0.2); expect(LIFT_OPS.idleEnergyShare).toBeLessThan(0.6);
  });
});

describe('off-season demand floor', () => {
  it('no-open-lift factor: 0.15 for a bare resort, grows with amenities and attractions, capped', () => {
    expect(offSeasonNoLiftFactor({ amenityVariety: 0, attractions: 0 })).toBeCloseTo(0.15, 5);
    expect(offSeasonNoLiftFactor({ amenityVariety: 4, attractions: 0 })).toBeGreaterThan(0.4);
    expect(offSeasonNoLiftFactor({ amenityVariety: 4, attractions: 3 })).toBeGreaterThan(offSeasonNoLiftFactor({ amenityVariety: 4, attractions: 0 }));
    expect(offSeasonNoLiftFactor({ amenityVariety: 20, attractions: 20 })).toBeLessThanOrEqual(0.6);
  });
  it('seasons keep their order; a village with amenities draws >= 40 % of the winter rate in summer and autumn', () => {
    const f = offSeasonNoLiftFactor({ amenityVariety: 4, attractions: 3 });
    expect(SEASON_RATE.winter).toBe(1);
    expect(SEASON_RATE.summer * f).toBeGreaterThan(0.25); // lifts closed
    expect(SEASON_RATE.summer).toBeGreaterThan(SEASON_RATE.autumn);
    expect(SEASON_RATE.autumn).toBeGreaterThanOrEqual(0.4);
  });
  it('in the game: a closed-lift village still gets guests in summer', () => {
    const sim = createSim({ size: 128, seed: 61, now: () => 0 });
    const bot = new Bot(sim, { starterLoan: true, expand: false, marketing: false });
    void bot;
    sim.game.date.day = seasonStartDay('summer') + 3;
    let n = 0; sim.bus.on('guest:arrived', () => { n++; });
    sim.tick(240 * 10);
    expect(n).toBeGreaterThanOrEqual(25);
  });
});

describe('debt model: foreclosure is far more forgiving', () => {
  it('Normal / Relaxed never foreclose automatically; Challenging only after a year below -$150k', () => {
    expect(DIFFICULTY.normal.foreclosureDays).toBe(0); expect(DIFFICULTY.relaxed.foreclosureDays).toBe(0);
    expect(DIFFICULTY.challenging.foreclosureDays).toBeGreaterThanOrEqual(DAYS_PER_YEAR * 2 - 1); // 360 = two 180-day years? one in-game year is 180 days
    expect(DIFFICULTY.challenging.foreclosureFloor).toBeGreaterThanOrEqual(150_000);
    expect(DEBT.autoBankruptcyFloor).toBeGreaterThanOrEqual(150_000);
  });
  const mk = (days: number, floor: number, money: number) => {
    const state = createGameState(1, 64, money);
    const bus = new EventBus<GameEvents>();
    const economy = new Economy(state);
    const finance = new Finance({ economy, loans: new Loans(economy, bus), bus, costs: () => ({ buildings: 0, lifts: 0, staff: 0 }), autoBankruptcyDays: days, autoBankruptcyFloor: floor });
    state.date.day = 0; finance.update(state);
    return { state, finance, run: (n: number) => { for (let i = 0; i < n; i++) { state.date.day++; finance.update(state); } } };
  };
  it('a Normal-difficulty resort at -$400k stays open for 3 years; a Challenging one above the floor too; below the floor it ends after 360 days', () => {
    const normal = mk(DIFFICULTY.normal.foreclosureDays, DIFFICULTY.normal.foreclosureFloor, -400_000);
    normal.run(3 * DAYS_PER_YEAR); expect(normal.finance.status).toBe('debt');
    const shallow = mk(DIFFICULTY.challenging.foreclosureDays, DIFFICULTY.challenging.foreclosureFloor, -100_000);
    shallow.run(3 * DAYS_PER_YEAR); expect(shallow.finance.status).toBe('debt');
    const deep = mk(DIFFICULTY.challenging.foreclosureDays, DIFFICULTY.challenging.foreclosureFloor, -400_000);
    deep.run(DIFFICULTY.challenging.foreclosureDays - 5); expect(deep.finance.status).toBe('debt');
    deep.run(20); expect(deep.finance.status).toBe('bankrupt');
  });
  it('in the full sim the difficulty reaches the finance system (Normal: off)', () => {
    const a = createSim({ size: 64, seed: 3, difficulty: 'normal', now: () => 0 });
    const b = createSim({ size: 64, seed: 3, difficulty: 'challenging', now: () => 0 });
    expect((a.finance as unknown as { autoDays: number }).autoDays).toBe(0);
    expect((b.finance as unknown as { autoDays: number }).autoDays).toBe(DIFFICULTY.challenging.foreclosureDays);
  });
});
