import { it } from 'vitest';
import { runAll, report } from './liftSampler';

// Logs the lift success-rate table (always passes). Run: npx vitest run tests/perf/liftMeasure.test.ts
it('measures lift success rates', () => {
  console.log('\n' + report(runAll()));
}, 600000);
