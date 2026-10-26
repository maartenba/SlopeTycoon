import { describe, it, expect } from 'vitest';
import { KINDS, runAll } from '../perf/liftSampler';
import type { LiftKind } from '../../src/config/lifts';

// Deterministic: seeds 1-20 x sizes 64/128/256, 40 plausible routes per kind per map.
const MIN: Partial<Record<LiftKind, number>> = { tbar: 0.5, chair4: 0.7, gondola6: 0.7, cablecar: 0.7, funicular: 0.5 };

describe('lift placement success on generated maps', () => {
  it('meets per-kind success thresholds on reasonable routes', () => {
    const t = runAll();
    for (const k of KINDS) {
      const x = t[k];
      expect(x.n).toBeGreaterThan(2000);
      expect(x.ok / x.n, `${k} success`).toBeGreaterThanOrEqual(MIN[k]!);
    }
  }, 600000);
});
