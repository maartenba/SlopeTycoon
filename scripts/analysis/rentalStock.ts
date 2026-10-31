/**
 * Rental stock check (docs/rental.md): peak skis / boards out and shortages for the standard bot. Usage: `npx vite-node scripts/analysis/rentalStock.ts`.
 */
import { createSim } from '../../src/game/createSim';
import { Bot } from '../../src/game/bot';

for (const [size, seed, days] of [[64, 61, 360], [128, 7, 180], [64, 5, 180]] as const) {
  const sim = createSim({ size, seed, now: () => 0 });
  const bot = new Bot(sim, {});
  let peakS = 0, peakB = 0, rentals = 0;
  for (let d = 0; d < days; d++) {
    bot.daily();
    for (let t = 0; t < 24; t++) { sim.tick(10); const st = sim.attractions.rentalStock(); peakS = Math.max(peakS, st.skis.out); peakB = Math.max(peakB, st.boards.out); rentals = Math.max(rentals, st.skis.cap / 30); }
  }
  const st = sim.attractions.rentalStock();
  console.log(`${size}/${seed} ${days}d rentals ${rentals} peak skis out ${peakS} boards out ${peakB} shortages ${st.short} money ${sim.game.money.toFixed(0)}`);
}
