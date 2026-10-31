/**
 * Bot economy replay (M6.5 STOP, docs/balance.md): money after N days for the standard bot on three resorts, plus the 128 / 7 summer-plan summer income
 * with / without the summer plan. Run at two commits and compare. Usage: `npx vite-node scripts/analysis/botReplay.ts`.
 */
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { DAYS_PER_YEAR } from '../../src/config/balance';

for (const [size, seed, days] of [[64, 61, 360], [128, 7, 180], [64, 5, 180]] as const) {
  const sim = createSim({ size, seed, now: () => 0 });
  runBot(sim, new Bot(sim, {}), days);
  console.log(`bot ${size}/${seed} ${days}d money ${sim.game.money.toFixed(2)}`);
}
for (const summer of [false, true]) {
  const sim = createSim({ size: 128, seed: 7, now: () => 0 });
  const bot = new Bot(sim, { respectUnlocks: true, reserve: 2_000, summerLifts: 'keep', summer, starterOpts: { lifts: 2, attractions: 1, toilet: true } });
  sim.bus.on('finance:monthClosed', () => bot.snapshotMonth());
  for (let d = 0; d < 2 * DAYS_PER_YEAR + 1; d++) { bot.daily(); sim.tick(240); }
  const inc = bot.rows.filter((r) => r.year === 2 && r.month >= 2 && r.month <= 5).reduce((a, r) => a + r.incomeTotal, 0);
  console.log(`summer plan ${summer} 128/7 summer income y2 ${inc.toFixed(0)} money ${sim.game.money.toFixed(0)}`);
}
