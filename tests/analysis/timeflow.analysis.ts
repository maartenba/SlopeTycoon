import { describe, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as bal from '../../src/config/balance';
import { MODELS, modelAtSize, trace, applyModel, speedCatalog, clockMaths, pacingTable, type Hooks, type Size, type TraceResult } from '../../scripts/analysis/timeflowLib';
import { buildHikingResort, runScenario, summarise } from '../../scripts/analysis/hikingLib';

const trip = vi.hoisted(() => ({ max: 6 }));
vi.mock('../../src/config/balance', async (orig) => ({ ...(await orig<typeof import('../../src/config/balance')>()) }));
vi.mock('../../src/sim/guests/Arrivals', async (orig) => {
  const o = await orig<typeof import('../../src/sim/guests/Arrivals')>();
  return { ...o, tripPlan: (total: number, base: number) => { const dist = Math.max(0, total - o.VEHICLE_MAX_ROUTE_TILES); return { dist, speed: Math.max(base, (total - dist) / trip.max) }; } };
});
const hooks: Hooks = {
  setLiftSecPerTick: (v) => { (bal as unknown as { LIFT_SECONDS_PER_TICK: number }).LIFT_SECONDS_PER_TICK = v; },
  setVehicleTripTicks: (v) => { trip.max = v; },
};

/**
 * Time-flow analysis (docs/time-flow.md). `npm run analysis:timeflow` (NOT part of `npm test`: *.analysis.ts, env-gated).
 * Env: TIMEFLOW_SIZES=64,128,256  TIMEFLOW_SEEDS=11  TIMEFLOW_DAYS=4  TIMEFLOW_MODELS=M0,A,...  TIMEFLOW_HIKE_DAYS=6 (0 = skip hiking)  TIMEFLOW_OUT=path.json
 */
const env = process.env;
const sizes = (env.TIMEFLOW_SIZES ?? '64,128,256').split(',').map(Number) as Size[];
const seeds = (env.TIMEFLOW_SEEDS ?? '11').split(',').map(Number);
const days = Number(env.TIMEFLOW_DAYS ?? 4);
const hikeSeeds = (env.TIMEFLOW_HIKE_SEEDS ?? '11,23,37,41').split(',').map(Number);
const hikeDays = Number(env.TIMEFLOW_HIKE_DAYS ?? 6);
const only = env.TIMEFLOW_MODELS?.split(',');
const f = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');

describe.runIf(env.TIMEFLOW_ANALYSIS === '1')('time-flow analysis', () => {
  it('runs', () => {
    const out: Record<string, unknown> = { catalog: speedCatalog(), clock: [24, 60, 120, 240, 300].map((d) => ({ d, ...clockMaths(d) })), pacing: Object.fromEntries(MODELS.map((m) => [m.id, pacingTable(m.daySeconds)])) };
    const traces: TraceResult[] = [], hikes: unknown[] = [];
    for (const size of sizes) {
      for (const m0 of MODELS) {
        if (only && !only.includes(m0.id)) continue;
        const m = modelAtSize(m0, size);
        for (const seed of seeds) {
          const tr = trace({ size, seed, days, model: m, lifts: size === 64 ? 1 : 2, hooks });
          traces.push(tr);
          // eslint-disable-next-line no-console
          console.log(`[${size}] ${m.id}: guests/day ${f(tr.guestsPerDay)}, walk ${f(tr.speeds.walk!.mean, 2)} t/tick (p95 ${f(tr.speeds.walk!.p95, 2)}), ski-blue ${f(tr.speeds['ski-blue']!.mean, 2)}, presence ${f(tr.presenceH)} h, walk share ${f(tr.walkShare * 100, 0)}%, runs/skier ${f(tr.runsPerSkier)}, rides/guest ${f(tr.ridesPerGuest)}, income/day ${f(tr.incomePerDay, 0)}, stars ${tr.stars}, queue ${f(tr.queueMinPerGuest)} min, ${f(tr.msPerTick, 2)} ms/tick, lag p95 ${f(tr.chase.p95LagS)} s`);
        }
        if (hikeDays > 0) for (const seed of hikeSeeds) {
          const { sim, info } = buildHikingResort(size, seed, { defaultHours: true });
          const restore = applyModel(m, hooks);
          try {
            const r = runScenario(sim, info, { id: m.id, label: m.label }, hikeDays);
            const s = summarise([r]);
            hikes.push({ size, seed, model: m.id, hikers: s.hikers, attempts: s.attempts, completed: s.completed, top3: s.top3, summit: s.summit, stayH: s.stayH, income: s.income, meanAttemptHours: s.meanAttemptHours, queueMin: s.meanQueueMinPerGuest, msPerTick: s.msPerTick, guests: s.guests });
            // eslint-disable-next-line no-console
            console.log(`[${size}] ${m.id} HIKE: hikers ${s.hikers}, attempts ${s.attempts}, done ${s.completed}, top3 ${f(s.top3 * 100, 0)}%, stay ${f(s.stayH)} h, attempt ${f(s.meanAttemptHours)} h, income ${f(s.income, 0)}`);
          } finally { restore(); }
        }
      }
    }
    out.traces = traces; out.hikes = hikes;
    const path = env.TIMEFLOW_OUT ?? 'scripts/analysis/out/timeflow.json';
    mkdirSync(path.replace(/\/[^/]+$/, ''), { recursive: true });
    writeFileSync(path, JSON.stringify(out, null, 1));
  });
});
