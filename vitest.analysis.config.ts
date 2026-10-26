import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Opt-in analysis runs (`npm run analysis:hiking`): long headless simulations that print tables; never part of `npm test`. */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/analysis/**/*.analysis.ts'],
    env: { HIKING_ANALYSIS: '1' },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 3_600_000,
  },
});
