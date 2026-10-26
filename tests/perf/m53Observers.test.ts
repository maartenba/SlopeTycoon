import { describe, it, expect } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { getScenario, scenarioSimOptions } from '../../src/config/scenarios';
import { fillDemoStats } from '../../src/sim/meta/demoStats';
import { buildStarterResort } from '../../src/game/starterResort';
import { GUEST_CAP } from '../../src/config/balance';
import { encodeSave, makeMeta } from '../../src/persist/Serializer';
import { budget } from '../perfMode';

/**
 * M5.3 observer cost (docs/progression.md, 'Cost'): stats capture, achievements, scenario runner and progression on a 256 map with ~3,000 guests,
 * plus the save-size impact of the stats ring buffer + year reports with 30 kB covers + achievementsRun. Numbers are printed; thresholds are generous guards.
 */
const time = (n: number, f: (i: number) => void): number => { const t0 = performance.now(); for (let i = 0; i < n; i++) f(i); return (performance.now() - t0) / n; };

describe('[perf] M5.3 observers (256 map, 3,000 guests)', () => {
  it('[perf] stats capture, achievements, scenario runner and progression stay far below a frame', () => {
    const sim = createSim({ size: 256, seed: 61, now: () => 0 });
    runBot(sim, new Bot(sim, { starterLoan: true }), 30);
    const cap = GUEST_CAP[256];
    for (let i = 0; i < 600 && sim.guestSim.store.count < 3000; i++) { sim.guestSim.spawner.benchFill(sim.game, cap, 300); sim.tick(1); }
    const guests = sim.guestSim.store.count;
    const capture = time(200, () => sim.stats.captureDay());
    const prog = time(200, () => sim.progression.evaluate());
    const day = time(50, () => sim.bus.emit('day:changed', {} as never));
    const arrived = time(3000, () => sim.bus.emit('guest:arrived', { id: 1 } as never)) ;
    const ssim = createSim({ ...scenarioSimOptions(getScenario('alpine-giant')!), now: () => 0 });
    runBot(ssim, new Bot(ssim), 30);
    const scen = time(200, () => ssim.scenario!.evaluate());
    const f = (n: number): string => n.toFixed(4);
    console.log(`[perf-m53] ${guests} guests | stats.captureDay ${f(capture)} ms/day | progression.evaluate ${f(prog)} ms/day | bus day:changed (all listeners incl. achievements, scenario, progression, goals) ${f(day)} ms/day | guest:arrived with achievements listener ${f(arrived * 1000)} us/event (x ~3000/day = ${f(arrived * 3000)} ms/day) | scenario.evaluate ${f(scen)} ms/day`);
    expect(capture).toBeLessThan(budget(2));
    expect(prog).toBeLessThan(budget(2));
    expect(arrived * 3000).toBeLessThan(budget(60));
    expect(scen).toBeLessThan(budget(3));
  }, 300_000);
});

describe('[perf] M5.3 save size with 2 years of stats, year reports with covers, achievementsRun', () => {
  const BYTES: Record<number, number> = { 64: 0.5 * 1048576, 128: 1048576, 256: 3 * 1048576 };
  for (const size of [64, 128, 256] as const) {
    it(`[perf] size ${size}: compressed save stays < ${BYTES[size]! / 1048576} MB`, async () => {
      const sim = createSim({ size, seed: 1337, startDay: 335, now: () => 0, mode: 'sandbox' });
      buildStarterResort(sim);
      const cap = GUEST_CAP[size];
      for (let i = 0; i < 400 && sim.guestSim.store.count < cap * 0.9; i++) {
        if (sim.game.date.minute / 60 >= 7.5 && sim.game.date.minute / 60 <= 16.5) sim.guestSim.spawner.benchFill(sim.game, cap, 300);
        sim.tick(1);
      }
      const meta = makeMeta(sim, 'm53');
      const before = await encodeSave(sim, meta);
      fillDemoStats(sim.stats, 4); sim.yearReports.reset();
      for (const y of [3, 4]) { sim.yearReports.generate(y); sim.yearReports.setCover(y, 'data:image/jpeg;base64,' + 'A'.repeat(29_900)); }
      for (let i = 0; i < 8; i++) sim.yearReports.generate(2); // idempotent: still one entry
      const after = await encodeSave(sim, meta);
      const per = after.stats.perModuleChars;
      console.log(`[perf-m53-save] size ${size}: gzip ${(before.bytes.length / 1024).toFixed(0)} KB -> ${(after.bytes.length / 1024).toFixed(0)} KB (delta ${((after.bytes.length - before.bytes.length) / 1024).toFixed(1)} KB; covers are incompressible-ish base64 here) | raw chars stats ${per.stats ?? 0} yearReports ${per.yearReports ?? 0} achievementsRun ${per.achievementsRun ?? 0} progression ${per.progression ?? 0} scenario ${per.scenario ?? 0}`);
      expect(after.bytes.length).toBeLessThan(BYTES[size]!);
      expect(after.stats.ms).toBeLessThan(budget(2000));
    }, 180_000);
  }
});
