import { describe, expect, it } from 'vitest';
import { buildSkiResort } from '../../scripts/analysis/skiLib';
import { TICKS_PER_DAY } from '@/config/balance';
import { GState } from '@/sim/guests/Guest';
import { isSkiMode } from '@/sim/guests/NavGraph';
import { Act } from '@/sim/guests/Decision';

/**
 * Real playthrough of pistes-as-runs (docs/runs.md): bot-built winter resort with joined pistes (several runs per lift), 60 days.
 * Measures the distribution of skier passes (a pass = a guest entering a run) over the runs, stuck guests, and that a player closure is respected.
 */
describe('runs playthrough [perf]', () => {
  it('60 winter days: passes spread over several runs, nobody is stuck, a closed run sees no new entries', () => {
    const { sim } = buildSkiResort(128, 7, 4, { day: 135 });
    const st = sim.guestSim.store, n = sim.size;
    const runs0 = sim.runIndex.runs();
    expect(runs0.length).toBeGreaterThanOrEqual(3);
    const passes = new Map<number, number>(); // persistent run id -> passes
    const lastRun = new Map<number, number>();
    const stillTicks = new Map<number, number>(); let maxStill = 0;
    const lastPos = new Map<number, number>();
    let closedId = -1, entriesToClosed = 0;
    const idCache = new Map<unknown, number>(); let cacheNet: unknown = null;
    const idOf = (r: { tiles: number[] }): number => {
      const net = sim.runIndex.network();
      if (net !== cacheNet) { cacheNet = net; idCache.clear(); for (const x of sim.runList()) idCache.set(x.tileIdx[0], x.id); }
      return idCache.get(r.tiles[0]) ?? -1;
    };
    const days = 60;
    for (let t = 0; t < days * TICKS_PER_DAY; t++) {
      if (t === 20 * TICKS_PER_DAY) { // close the busiest run so far
        const best = [...passes].sort((a, b) => b[1] - a[1])[0];
        if (best) { closedId = best[0]; sim.setRunClosed(closedId, true); }
      }
      sim.tick(1);
      for (let i = 0; i < st.limit; i++) {
        if (!st.alive[i]) continue;
        const id = st.id[i]!;
        const skiing = st.state[i] === GState.Walking && isSkiMode(st.moveMode[i]!) && st.act[i] === Act.SkiDown;
        const tile = (st.y[i]! | 0) * n + (st.x[i]! | 0);
        if (skiing) {
          const r = sim.runIndex.runOfTile(tile);
          const rid = r ? idOf(r) : -1;
          if (rid >= 0 && lastRun.get(id) !== rid) {
            lastRun.set(id, rid);
            passes.set(rid, (passes.get(rid) ?? 0) + 1);
            if (rid === closedId) entriesToClosed++;
          }
        } else lastRun.delete(id);
        // stuck: a walking / skiing guest that does not move for 400 ticks (~4 minutes of game time at 1x is normal queueing: only non-queue states count)
        if (st.state[i] === GState.Walking) {
          const key = Math.round(st.x[i]! * 4) * 100000 + Math.round(st.y[i]! * 4);
          if (lastPos.get(id) === key) { const c = (stillTicks.get(id) ?? 0) + 1; stillTicks.set(id, c); if (c > maxStill) maxStill = c; }
          else { lastPos.set(id, key); stillTicks.set(id, 0); }
        }
      }
    }
    const list = [...passes].sort((a, b) => b[1] - a[1]);
    const total = list.reduce((a, [, v]) => a + v, 0);
    console.log(`[runs-playthrough] ${runs0.length} runs, ${total} passes, ranked: ${list.map(([id, v]) => `#${id}:${v} (${((v / total) * 100).toFixed(0)}%)`).join(' ')}; closed run #${closedId} entries after closing: ${entriesToClosed}; longest still-walk ${maxStill} ticks`);
    expect(closedId).toBeGreaterThan(0);
    expect(entriesToClosed).toBe(0);
    expect(total).toBeGreaterThan(100);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0]![1] / total).toBeLessThan(0.85); // not all on one run
    expect(maxStill).toBeLessThan(TICKS_PER_DAY / 2);
  }, 300000);
});
