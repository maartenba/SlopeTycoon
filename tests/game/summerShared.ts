import { expect, it, describe } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { Bot, type MonthRow } from '../../src/game/bot';
import { DAYS_PER_YEAR } from '../../src/config/balance';

/**
 * Gentler summer (docs/balance.md): a WINTER-FOCUSED resort (chain of lifts + pistes + restaurant + ski school, starter loan + a small loan, NO
 * summer attractions, the lifts are left on the default schedule) must get through its first summer and autumn without going broke.
 */
const LIFTS: Record<64 | 128 | 256, number> = { 64: 2, 128: 3, 256: 4 };
export const sum = (rows: MonthRow[], f: (r: MonthRow) => number): number => rows.reduce((a, r) => a + f(r), 0);

function winterResort(size: 64 | 128 | 256, seed: number, difficulty?: 'normal' | 'challenging'): { sim: Sim; bot: Bot } {
  const sim = createSim({ size, seed, difficulty, now: () => 0 });
  const bot = new Bot(sim, { starterLoan: true, expand: false, marketing: false, starterOpts: { lifts: LIFTS[size], attractions: 3 } });
  sim.bus.on('finance:monthClosed', () => bot.snapshotMonth());
  bot.takeLoan('small');
  return { sim, bot };
}

/** The gentle-summer sweep, one registration per size so vitest runs the sizes in parallel files (summer.test.ts, summer.gentle256.test.ts). */
export function registerGentleSummer(sizes: ReadonlyArray<64 | 128 | 256>): void {
describe('gentler summer: a winter-focused resort with the starter loan survives its first summer', () => {
  for (const size of sizes) {
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
}
