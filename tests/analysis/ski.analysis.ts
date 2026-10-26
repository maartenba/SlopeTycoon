import { describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { EXPLORE, NAV_SPEED, NAV_SPEED_LEGACY } from '../../src/config/balance';
import { buildSkiResort, measureSki, type Size } from '../../scripts/analysis/skiLib';

/** Ski exploration analysis (docs/ski-exploration.md). `npm run analysis:ski`. Env: SKI_SIZES=64,128,256 SKI_SEEDS=1,2 SKI_DAYS=3 SKI_LIFTS=1,5 SKI_OUT=path.json */
const env = process.env;
const sizes = (env.SKI_SIZES ?? '64,128,256').split(',').map(Number) as Size[];
const seeds = (env.SKI_SEEDS ?? '1,7').split(',').map(Number);
const days = Number(env.SKI_DAYS ?? 3);
const liftSets = (env.SKI_LIFTS ?? '0,5').split(',').map(Number); // 0 = default starter

describe.runIf(env.SKI_ANALYSIS === '1')('ski exploration analysis', () => {
  it('runs', () => {
    const out: unknown[] = [];
    for (const size of sizes) for (const lf of liftSets) for (const seed of seeds) {
      const { sim } = buildSkiResort(size, seed, lf || (size >= 256 ? 2 : 1));
      const base = env.SKI_BASELINE === '1'; // A/B: the pre-exploration behaviour (no exploration, legacy speeds and pauses)
      sim.guestSim.exploration.enabled = !base;
      const ns = NAV_SPEED as unknown as { walk: number; skiBase: number; skiFlat: number }, ex = EXPLORE as unknown as { visitPause: number[]; runPause: number[] };
      const keep = { ...ns, visit: [...ex.visitPause], run: [...ex.runPause] };
      if (base) { Object.assign(ns, NAV_SPEED_LEGACY); ex.visitPause = [10, 40]; ex.runPause = [2, 8]; }
      const m = measureSki(sim, days, size, seed);
      Object.assign(ns, { walk: keep.walk, skiBase: keep.skiBase, skiFlat: keep.skiFlat }); ex.visitPause = keep.visit; ex.runPause = keep.run;
      out.push(m);
      // eslint-disable-next-line no-console
      console.log(`[${size}/s${seed}] lifts ${m.lifts} pistes ${m.pistes} guests ${m.guests} skiers ${m.skiers}: runs/gd ${m.runsPerGuestDay.toFixed(1)} (day guests >=4h: ${m.runsFull.toFixed(1)}, n=${m.fullSkiers}) pistes/gd ${m.distinctPistes.toFixed(2)} 1-piste ${(m.piste1Share * 100).toFixed(0)}% giniPiste ${m.giniPiste.toFixed(2)} giniTile ${m.giniTile.toFixed(2)} ridden>=10% ${(m.shareRidden10 * 100).toFixed(0)}% cover ${(m.coverage * 100).toFixed(0)}% min/run ${m.minPerRun.toFixed(0)} min/100m ${m.minPer100mDrop.toFixed(1)} drop ${m.meanDropM.toFixed(0)}m queue ${m.queueMinPerRide.toFixed(1)}min firstLift ${m.firstLiftMin.toFixed(0)}min rides/lift ${m.ridesPerLift.join('/')}\n   share ${Object.entries(m.timeShare).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', ')}`);
    }
    const path = env.SKI_OUT ?? 'scripts/analysis/out/ski.json';
    mkdirSync(path.replace(/\/[^/]+$/, ''), { recursive: true });
    writeFileSync(path, JSON.stringify(out));
  });
}, 3_000_000);
