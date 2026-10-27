import { it } from 'vitest';
import { measureHeights, summarize } from './liftHeights';
import { KINDS } from './liftSampler';
import type { LiftKind } from '../../src/config/lifts';

const ALL: LiftKind[] = [...KINDS.filter((k) => k !== 'funicular'), 'chair6', 'gondola10'];
// Logs the tower-height distribution (always passes). Run: npx vitest run tests/perf/liftHeights.test.ts
it('measures tower heights', () => {
  for (const lane of [true, false]) {
    const s = measureHeights([64, 128, 256], 12, 30, lane, ALL);
    console.log(`\nlane ${lane ? 'ON' : 'OFF'}\n` + summarize(s, ALL));
    if (lane) console.log(s.filter((x) => x.ok).sort((a, b) => b.h - a.h).slice(0, 8).map((x) => `${x.kind} size${x.size} seed${x.seed} h=${x.h.toFixed(2)} span=${x.span.toFixed(1)} towers=${x.n} ${JSON.stringify(x.route)}`).join('\n'));
  }
}, 900000);
