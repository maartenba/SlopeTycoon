/** Avalanche survey: `vite-node scripts/analysis/avalancheSurvey.ts [days] [sizes] [seeds]` — releases per winter on real (starter) resorts. */
import { createSim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import { seasonOf } from '../../src/sim/Clock';

const days = Number(process.argv[2] ?? 360);
const sizes = (process.argv[3] ?? '64,128,256').split(',').map(Number) as Array<64 | 128 | 256>;
const seeds = (process.argv[4] ?? '1,2,3').split(',').map(Number);
for (const size of sizes) for (const seed of seeds) {
  const sim = createSim({ size, seed, now: () => 0 });
  buildStarterResort(sim);
  for (const l of sim.lifts.all()) sim.liftOps.setHours(l.id, 6, 22);
  const ev = { unc: 0, ctl: 0, bigUnc: 0, buried: 0, news: 0 };
  const byDay: number[] = [];
  let summer = 0;
  sim.bus.on('incident:avalanche', (e) => {
    if (!e.controlled && !e.quiet) ev.news++;
    if (e.controlled) ev.ctl++; else { ev.unc++; if ((e.tiles ?? 0) >= 8) ev.bigUnc++; ev.buried += e.buried ?? 0; byDay.push(sim.game.date.day); if (seasonOf(sim.game.date) === 'summer') summer++; }
  });
  const t0 = Date.now();
  for (let d = 0; d < days * 240; d++) sim.tick(1);
  const a = sim.safety.avalanche;
  console.log(`size ${size} seed ${seed} days ${days}: uncontrolled ${ev.unc} (>=8 tiles ${ev.bigUnc}, buried ${ev.buried}) controlled ${ev.ctl} newsRows ${ev.news} sloughs ${a.sloughs} summer ${summer} cands ${a.candidateCount} releaseDays(first 12) [${byDay.slice(0, 12).join(',')}] ${(Date.now() - t0) / 1000}s`);
}
