import { it } from 'vitest';
import { seedsMean } from './terrainMetrics';
it('report', () => {
  if (!process.env.TREPORT) return;
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  for (const n of [64, 128, 256] as const) {
    const { mean: m, worst: w } = seedsMean(n, seeds);
    const f = (x: number): string => x.toFixed(3);
    console.log(`N=${n} mean=${f(m.mean)} med=${f(m.median)}(worst ${f(w.median!)}) ge1.5=${f(m.ge15)}(w ${f(w.ge15!)}) eq2=${f(m.eq2)}(w ${f(w.eq2!)}) beg=${f(m.beginner)} int=${f(m.intermediate)} adv=${f(m.advanced)} exp=${f(m.expert)} b+i=${f(m.beginner + m.intermediate)}(min ${f(w.flat!)}) benches=${m.benches.toFixed(1)}(min ${w.benches}) grad=${f(m.gradient)} flank30=${f(m.flank30)}`);
  }
}, 120000);
