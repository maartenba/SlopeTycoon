import { describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildHikingResort, runScenario, summarise, type RunResult, type Size } from '../../scripts/analysis/hikingLib';

/**
 * Hunger audit (docs/hiking.md 'Hunger audit'). `npm run analysis:hunger` (not picked up by `npm test`).
 * Env: HIKING_SIZES  HIKING_SEEDS  HIKING_DAYS  HIKING_OUT. Runs each resort WITH a summit mountain hut and WITHOUT any hut ('nohut').
 */
const env = process.env;
const sizes = (env.HIKING_SIZES ?? '64,128,256').split(',').map(Number) as Size[];
const seeds = (env.HIKING_SEEDS ?? '11,23,37').split(',').map(Number);
const days = Number(env.HIKING_DAYS ?? 6);
describe.runIf(env.HUNGER_ANALYSIS === '1')('hunger audit', () => {
  it('runs', () => {
    const summaries: unknown[] = [];
    for (const size of sizes) for (const [hut, hungry] of [[true, 0], [false, 0], [true, 0.3], [false, 0.3]] as const) {
      const runs: RunResult[] = [];
      for (const seed of seeds) { const { sim, info } = buildHikingResort(size, seed, { defaultHours: true, noHut: !hut }); runs.push(runScenario(sim, info, { id: `${hut ? 'hut' : 'nohut'}${hungry ? '+hungry' : ''}`, label: '', arriveHungry: hungry }, days)); }
      const s = summarise(runs);
      summaries.push(s);
      // eslint-disable-next-line no-console
      console.log(`[${size}] ${hut ? 'hut' : 'nohut'}${hungry ? '+hungry' : ''}: ${JSON.stringify(s.hunger)}`);
    }
    const path = env.HIKING_OUT ?? 'scripts/analysis/out/hunger.json';
    mkdirSync(path.replace(/\/[^/]+$/, ''), { recursive: true });
    writeFileSync(path, JSON.stringify({ summaries }));
  });
});
