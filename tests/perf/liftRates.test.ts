import { it } from 'vitest';
import { runAll, report } from './liftSampler';

// Logs success rates: no props, forest lane ON, forest lane OFF (always passes). Run: npx vitest run tests/perf/liftRates.test.ts
it('measures lift success rates (3 modes)', () => {
  console.log('\nNO PROPS\n' + report(runAll([64, 128, 256], 20, 40, false)));
  console.log('\nFOREST LANE ON\n' + report(runAll([64, 128, 256], 20, 40, true, true)));
  console.log('\nFOREST LANE OFF\n' + report(runAll([64, 128, 256], 20, 40, true, false)));
}, 1800000);
