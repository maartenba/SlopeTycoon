/**
 * Difficulty targets (M7.1 Task 7.1.4, docs/economy-audit.md "Difficulty targets"): `npm run analysis:difficulty [-- --seeds 61,7,5,23,42 --size 64]`.
 * Per difficulty and seed, the default bot (career, unlock-respecting, lifts left on like a human) plays 3 years; prints profit by year, the summer (months 2-5) net per month,
 * the lowest cash and whether the resort went bankrupt. The balance suite (tests/game/balance.test.ts, BALANCE=1) asserts the bands.
 */
import { createSim } from '../../src/game/createSim';
import { Bot, runBot, WISHES } from '../../src/game/bot';
import { DAYS_PER_YEAR, type DifficultyId } from '../../src/config/balance';

const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1]! : d; };
const seeds = arg('seeds', '61,7,5,23,42').split(',').map(Number);
const size = Number(arg('size', '64')) as 64 | 128;
const k = (n: number): string => `${n >= 0 ? '+' : ''}${(n / 1000).toFixed(1)}k`;
const winterOnly = new Set(['adventurePark', 'beach', 'boatRental', 'alpineFarm']);

for (const difficulty of ['relaxed', 'normal', 'challenging'] as DifficultyId[]) for (const human of [false, true]) {
  const out: string[] = [];
  let bankrupt = 0;
  for (const seed of seeds) {
    const sim = createSim({ size, seed, difficulty, now: () => 0 });
    const bot = new Bot(sim, human
      ? { respectUnlocks: true, reserve: 2_000, summerLifts: 'keep', policy: { id: 'human', wishes: WISHES.filter(([t]) => !winterOnly.has(t)) }, starterOpts: { lifts: 1, attractions: 0, toilet: true } }
      : { respectUnlocks: true });
    let min = sim.game.money;
    runBot(sim, bot, 3 * DAYS_PER_YEAR, () => { min = Math.min(min, sim.game.money); });
    const net = (y: number): number => bot.rows.filter((r) => r.year === y).reduce((a, r) => a + r.net, 0);
    const s2 = bot.rows.filter((r) => r.year === 2 && r.month >= 2 && r.month <= 5);
    const sn = s2.reduce((a, r) => a + r.net, 0) / Math.max(1, s2.length);
    if (sim.finance.ended) bankrupt++;
    out.push(`${seed}: y1 ${k(net(1))} y2 ${k(net(2))} y3 ${k(net(3))} summer/mo ${k(sn)} min cash ${k(min)}${sim.finance.ended ? ' BANKRUPT' : ''}`);
  }
  console.log(`${difficulty}${human ? ' (human-like: no summer attractions, lifts left on, reserve 2k)' : ''}: bankrupt ${bankrupt}/${seeds.length}\n  ${out.join('\n  ')}`);
}
