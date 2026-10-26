import { describe, it } from 'vitest';
import { fmt, runBench } from './bench';

// Full benchmark: `BENCH=1 npx vitest run tests/perf/bench.test.ts`. Prints one JSON line per size (paste into docs/perf.md).
describe.skipIf(!process.env.BENCH)('benchmark (BENCH=1)', () => {
  for (const size of [64, 128, 256] as const) {
    it(`size ${size}`, () => {
      const best = [runBench({ size }), runBench({ size })].sort((a, b) => a.tickAtCap.avg - b.tickAtCap.avg)[0]!;
      console.log(fmt(best));
      console.log('BENCH_JSON ' + JSON.stringify(best));
    }, 300000);
  }
});
