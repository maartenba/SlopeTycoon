/** Energy probe (docs/energy.md): yearly lift energy + snowmaking $ of the bot resort, with and without a solar array. `GREEN=1 npx vite-node scripts/analysis/energyLoad.ts`. */
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';

const green = process.env.GREEN === '1';
for (const seed of [61, 7]) {
  const sim = createSim({ size: 64, seed, now: () => 0 }), bot = new Bot(sim, { greenEnergy: green });
  runBot(sim, bot, 4 * 180);
  for (const y of [1, 2, 3]) {
    const rows = bot.rows.filter((r) => r.year === y);
    const sum = (k: string): number => Math.round(rows.reduce((s, r) => s + (r.expense[k] ?? 0), 0));
    console.log(`seed ${seed} y${y}: energy ${sum('energy')} snowmaking ${sum('snowmaking')} upkeep ${sum('upkeep')} net ${Math.round(rows.reduce((s, r) => s + r.net, 0))}`);
  }
  const gens = sim.energy.generators();
  console.log(`   generators ${gens.map((g) => g.type + (g.active ? '' : '(inactive)')).join(',') || '-'} applied ${Math.round(sim.energy.totalApplied)} wasted ${Math.round(sim.energy.totalWasted)} sustain ${sim.sustain.last()?.score} energy part ${sim.sustain.last()?.energy.toFixed(2)}`);
}
