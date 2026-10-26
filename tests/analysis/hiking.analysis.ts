import { describe, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildHikingResort, runScenario, summarise, speedTable, type RunResult, type Scenario, type Size } from '../../scripts/analysis/hikingLib';
import * as bal from '../../src/config/balance';

// GUEST_DUSK_HOUR is a primitive export: the mock module object is mutable so the what-if can move the dusk time at runtime (nothing in src/ changes).
vi.mock('../../src/config/balance', async (orig) => ({ ...(await orig<typeof import('../../src/config/balance')>()) }));
const setDusk = (h: number): void => { (bal as unknown as { GUEST_DUSK_HOUR: number }).GUEST_DUSK_HOUR = h; };

/**
 * Hiking analysis (docs/hiking-analysis.md). Run with `npm run analysis:hiking` (this file is NOT picked up by `npm test`: *.analysis.ts).
 * Env: HIKING_SIZES=64,128,256  HIKING_SEEDS=1,2,3  HIKING_DAYS=10  HIKING_SCENARIOS=baseline,speed3,...  HIKING_OUT=path.json
 */
const env = process.env;
const sizes = (env.HIKING_SIZES ?? '64,128,256').split(',').map(Number) as Size[];
const seeds = (env.HIKING_SEEDS ?? '11,23,37').split(',').map(Number);
const days = Number(env.HIKING_DAYS ?? 10);
export const SCENARIOS: Scenario[] = [
  { id: 'legacy', label: 'BEFORE: pre-excursion behaviour (uniform random goal, NavMovement)', legacy: true },
  { id: 'new', label: 'AFTER: excursion model + appeal goals + foot lift first' },
  { id: 'baseline', label: 'Baseline (lifts 08:30-17:00, dusk 17:00, hike 0.4 t/tick)' },
  { id: 'speed3', label: '(a) hike speed x3 (1.2 t/tick)', hikeSpeed: 3 },
  { id: 'speed10', label: '(a) hike speed x10 (4 t/tick)', hikeSpeed: 10 },
  { id: 'dusk1930', label: '(b) summer day: dusk 19:30, lifts 08:00-19:30', dusk: 19.5, liftHours: [8, 19.5] },
  { id: 'summit', label: '(c) hikers pick top-third goals (lift used when cheaper)', summitGoals: true },
  { id: 'overnight', label: '(d) multi-day: hikers stay 2 days, sleep out (hut/lodging abstraction)', overnightHikers: true },
  { id: 'excursion', label: '(e) excursion: path covered in ~30 ticks (3 h) regardless of scale', excursionEtaTicks: 30 },
  { id: 'combo', label: 'combo: dusk 19:30 + lifts to 19:30 + speed x3 + summit goals', dusk: 19.5, liftHours: [8, 19.5], hikeSpeed: 3, summitGoals: true },
  { id: 'speed10summit', label: '(a+c) hike speed x10 + top-third goals', hikeSpeed: 10, summitGoals: true },
  { id: 'excSummit', label: '(e+c) excursion (~30 ticks) + top-third goals', excursionEtaTicks: 30, summitGoals: true },
  { id: 'excSummitLate', label: '(e+c+b) excursion + top-third goals + dusk 19:30/lifts to 19:30', excursionEtaTicks: 30, summitGoals: true, dusk: 19.5, liftHours: [8, 19.5] },
];
const only = env.HIKING_SCENARIOS?.split(',');

describe.runIf(env.HIKING_ANALYSIS === '1')('hiking analysis', () => {
  it('runs', () => {
    const out: { speed: unknown; infos: unknown[]; summaries: unknown[]; raw: Record<string, unknown> } = { speed: speedTable(), infos: [], summaries: [], raw: {} };
    for (const size of sizes) {
      for (const sc of SCENARIOS) {
        if (only && !only.includes(sc.id)) continue;
        const runs: RunResult[] = [];
        for (const seed of seeds) {
          const { sim, info } = buildHikingResort(size, seed, { defaultHours: true });
          if (sc.id === 'baseline') out.infos.push(info);
          runs.push(runScenario(sim, info, sc, days, setDusk));
        }
        const s = summarise(runs);
        out.summaries.push(s);
        // eslint-disable-next-line no-console
        console.log(`[${size}] ${sc.id}: hikers ${s.hikers}, top3 ${(s.top3 * 100).toFixed(0)}%, summit ${(s.summit * 100).toFixed(0)}%, meanMaxRel ${(s.meanMaxRel * 100).toFixed(0)}%, attempts ${s.attempts} done ${s.completed}, ms/tick ${s.msPerTick.toFixed(2)}, liftShare ${(s.liftRideShareHikers * 100).toFixed(0)}%, income ${s.income.toFixed(0)}, q ${s.meanQueueMinPerGuest.toFixed(1)}m, exc ${JSON.stringify(runs.reduce((o, r) => { for (const [k, v] of Object.entries(r.exc)) o[k] = (o[k] ?? 0) + v; return o; }, {} as Record<string, number>))}`);
        if (sc.id === 'baseline') out.raw[`${size}`] = runs.map((r) => ({ seed: r.seed, arrivalHist: r.arrivalHist, attempts: r.attempts.slice(0, 400) }));
      }
    }
    setDusk(17);
    const path = env.HIKING_OUT ?? 'scripts/analysis/out/hiking.json';
    mkdirSync(path.replace(/\/[^/]+$/, ''), { recursive: true });
    writeFileSync(path, JSON.stringify(out));
  });
});
