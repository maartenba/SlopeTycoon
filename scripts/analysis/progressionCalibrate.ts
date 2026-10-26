/** Prints the per-month progression inputs (stars, lifetime guests, best day, rolling profit, chapters) for the balance bot: tool for tuning src/config/progression.ts. Run: npx vite-node scripts/analysis/progressionCalibrate.ts (env SIZE, SEED) */
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { DAYS_PER_YEAR } from '../../src/config/balance';

const size = (Number(process.env.SIZE) || 64) as 64 | 128 | 256;
const seed = Number(process.env.SEED) || 61;
const sim = createSim({ size, seed, now: () => 0 });
const bot = new Bot(sim, { respectUnlocks: true });
sim.progression.onLevelUp((u) => console.log(`>>> LEVEL ${u.level} (${u.name}) on game day ${sim.game.date.year}/${sim.game.date.day} (play day ${sim.getSimTick() / 240})`));
let m = 0;
sim.bus.on('finance:monthClosed', () => {
  const rs = sim.economy.reports(), last12 = rs.slice(-12);
  const chapters = sim.goals.chapters.filter((c) => sim.goals.chapterDone(c.id)).length;
  console.log(`#${String(++m).padStart(2)} y${rs[rs.length - 1]!.year} m${String(rs[rs.length - 1]!.month).padStart(2)} stars ${sim.rating.stars} lifetime ${sim.goals.facts.lifetime} bestDay ${sim.goals.facts.bestDay} profitMonths ${sim.goals.facts.profitMonths} net12 ${Math.round(last12.reduce((a, r) => a + r.net, 0))} rev12 ${Math.round(last12.reduce((a, r) => a + r.incomeTotal, 0))} chapters ${chapters} level ${sim.progression.level}`);
});
runBot(sim, bot, 3 * DAYS_PER_YEAR);
