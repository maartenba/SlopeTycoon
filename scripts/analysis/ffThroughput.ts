/** Fast-forward throughput (headless sim only, no rendering): game days per real second at a resort with guests at/near the cap. Run: npx vite-node scripts/analysis/ffThroughput.ts (env SIZES=64,128,256 SEED=61 DAYS=20 WARM=150) */
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { FastForward, absoluteDay } from '../../src/core/FastForward';

const sizes = (process.env.SIZES ?? '64,128,256').split(',').map(Number) as Array<64 | 128 | 256>;
const seed = Number(process.env.SEED) || 61;
const days = Number(process.env.DAYS) || 20;
for (const size of sizes) {
  const sim = createSim({ size, seed, now: () => 0 });
  const bot = new Bot(sim, { respectUnlocks: true });
  runBot(sim, bot, Number(process.env.WARM) || 150); // build the resort and let guests arrive
  const ff = new FastForward({ now: () => performance.now(), step: () => { sim.loop.stepOnce(); }, date: () => sim.game.date, blocked: () => null, hidden: () => false });
  const d0 = absoluteDay(sim.game.date);
  const t0 = performance.now(), ticks0 = sim.loop.tickCount;
  ff.start('event');
  let f = 0;
  while (ff.active && absoluteDay(sim.game.date) - d0 < days && f++ < 1e7) ff.frame();
  const secs = (performance.now() - t0) / 1000, d = absoluteDay(sim.game.date) - d0, n = sim.loop.tickCount - ticks0;
  ff.cancel();
  console.log(`size ${size}: ${sim.guestSim.store.count} guests now, ${d.toFixed(1)} days in ${secs.toFixed(1)} s = ${(d / secs).toFixed(1)} days/s (${((secs * 1000) / n).toFixed(2)} ms/tick); a 60-day winter ≈ ${(60 / (d / secs)).toFixed(0)} s, a 180-day year ≈ ${(180 / (d / secs)).toFixed(0)} s`);
}
