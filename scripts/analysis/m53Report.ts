/** M5.3 readiness numbers: Career sweep (year 1/2/3 net + level days), achievements after a 2-year bot run, year-report determinism. Run: npx vite-node scripts/analysis/m53Report.ts */
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { DAYS_PER_YEAR } from '../../src/config/balance';
import { stateHash } from '../../src/game/saveState';

const run = (size: 64 | 128 | 256, seed: number): ReturnType<typeof createSim> => {
  const sim = createSim({ size, seed, mode: 'career', now: () => 0 });
  const bot = new Bot(sim, { respectUnlocks: true, starterLoan: size === 256 });
  const at: Record<number, string> = {};
  sim.progression.onLevelUp((u) => { at[u.level] = `y${sim.game.date.year}/d${sim.game.date.day}`; });
  runBot(sim, bot, 3 * DAYS_PER_YEAR);
  const net = (y: number): number => Math.round(bot.rows.filter((r) => r.year === y).reduce((a, r) => a + r.net, 0) / 1000);
  console.log(`career ${size}/${seed}: y1 ${net(1)}k y2 ${net(2)}k y3 ${net(3)}k | levels ${JSON.stringify(at)} | final L${sim.progression.level} ${sim.rating.stars.toFixed(1)}* | reports ${sim.yearReports.all().map((r) => `y${r.year}:${r.headline.tier}`).join(',')} | achievements ${sim.achievements.unlockedCount()}`);
  return sim;
};
const only = process.argv[2];
for (const [s, seeds] of [[64, [61, 7]], [128, [61, 7]], [256, [61, 7]]] as Array<[64 | 128 | 256, number[]]>) for (const seed of seeds) {
  if (only && !`${s}/${seed}`.startsWith(only)) continue;
  const sim = run(s, seed);
  if (s === 64 && seed === 61) {
    console.log('achievements 64/61 (3 yr):', sim.achievements.unlockedIds().join(', '));
    const again = run(s, seed);
    console.log('determinism: hash equal', JSON.stringify(stateHash(sim).parts) === JSON.stringify(stateHash(again).parts), '| reports equal', JSON.stringify(sim.yearReports.all()) === JSON.stringify(again.yearReports.all()));
  }
}
