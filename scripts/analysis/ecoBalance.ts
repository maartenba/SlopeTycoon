/**
 * Eco programme balance (docs/eco.md): bot with and without `eco`, 3 years, per seed (SIZE env default 64, SEEDS env default 61,7).
 * Prints year-3 net, mean stars, sustainability facet, eco points, certificate day and the net difference (target: |diff| <= 10 % in year 3).
 * Usage: `npx vite-node scripts/analysis/ecoBalance.ts`.
 */
import { createSim } from '../../src/game/createSim';
import { Bot, runBot, type MonthRow } from '../../src/game/bot';
import { DAYS_PER_YEAR } from '../../src/config/balance';

const SIZE = Number(process.env.SIZE ?? 64) as 64 | 128 | 256;
const sum = (rows: MonthRow[], f: (r: MonthRow) => number): number => rows.reduce((a, r) => a + f(r), 0);
const run = (seed: number, eco: boolean | 'build') => {
  const sim = createSim({ size: SIZE, seed, now: () => 0 }), bot = new Bot(sim, { eco, greenEnergy: true });
  let certDay = -1, facet = 0, n = 0;
  runBot(sim, bot, 3 * DAYS_PER_YEAR, (d) => { if (certDay < 0 && sim.eco.certified) certDay = d; if (d >= 2 * DAYS_PER_YEAR) { facet += sim.sustain.last()?.score ?? 0; n++; } });
  const y = (k: number): MonthRow[] => bot.rows.filter((r) => r.year === k);
  return { net3: sum(y(3), (r) => r.net), inc3: sum(y(3), (r) => r.incomeTotal), exp3: sum(y(3), (r) => r.expenseTotal), net2: sum(y(2), (r) => r.net), stars3: sum(y(3), (r) => r.rating) / 12, facet3: facet / Math.max(1, n), guests3: sum(y(3), (r) => r.guests), certDay, pts: sim.eco.points(), pol: sim.eco.activeCount(), cash: sim.game.money, share: sim.eco.renewableShare() };
};
console.log('seed  mode  net2     net3     inc3     guests3 stars3 facet3 ecoPts pol cert@day share');
for (const seed of (process.env.SEEDS ?? '61,7').split(',').map(Number)) {
  const p = run(seed, false), a = run(seed, 'build'), b = run(seed, true);
  for (const [m, r] of [['plain', p], ['build', a], ['eco ', b]] as const) console.log(`${String(seed).padEnd(5)} ${m}  ${r.net2.toFixed(0).padStart(7)} ${r.net3.toFixed(0).padStart(8)} ${r.inc3.toFixed(0).padStart(8)} ${String(r.guests3).padStart(7)} ${r.stars3.toFixed(2)}   ${r.facet3.toFixed(1).padStart(5)} ${r.pts.toFixed(1).padStart(5)} ${r.pol}   ${String(r.certDay).padStart(4)}  ${r.share.toFixed(2)}`);
  console.log(`      y3 net diff: vs plain ${(100 * (b.net3 - p.net3) / Math.abs(p.net3)).toFixed(1)} %, vs buildings-only ${(100 * (b.net3 - a.net3) / Math.abs(a.net3)).toFixed(1)} %`);
}
