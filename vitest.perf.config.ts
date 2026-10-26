import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Timing tests only (names tagged "[perf]"), strict thresholds, one test file at a time in a single fork. */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    testNamePattern: '\\[perf\\]',
    env: { PERF: '1' },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 120000,
  },
});
