import { describe, expect, it } from 'vitest';
import { buildSkiResort } from '../../../scripts/analysis/skiLib';
import { TICKS_PER_DAY, TICKS_PER_SECOND } from '@/config/balance';
import { GState } from '@/sim/guests/Guest';
import { isSkiMode, NavMode } from '@/sim/guests/NavGraph';
import { Act } from '@/sim/guests/Decision';
import { OccFlag } from '@/world/Occupancy';
import { pathPoint, maxChordDeviation } from '@/render/guestPath';
import { WP_MAX } from '@/sim/guests/Guest';

/**
 * On-screen speed budget at 1x (docs/time-flow.md): headless winter starter resort per map size, per-tick displacement x 1.6 ticks/s.
 * Caps (tiles/s, p95): walkers <= 9, skiers <= 10.5 on blue and below / <= 13 on red-black, vehicles <= 12 (the 6-tick, 30-tile approach cap = 8 tiles/s).
 */
const p95 = (a: number[]): number => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!; };
const SOLID = OccFlag.Building | OccFlag.Water;

describe.each([[64, 1], [128, 1], [256, 1337]] as const)('on-screen speed budget at 1x, map %i', (size, seed) => {
  const days = size === 256 ? 2 : 3;
  const { sim } = buildSkiResort(size, seed, size === 64 ? 1 : 2);
  const st = sim.guestSim.store, n = sim.size, occ = sim.grid.occupancy.flags;
  const walk: number[] = [], skiEasy: number[] = [], skiHard: number[] = [], veh: number[] = [];
  let wpGuests = 0, movers = 0, crossings = 0, chordCrossings = 0, maxDev = 0;
  const out = { x: 0, y: 0 };
  const prev = new Map<number, { x: number; y: number }>();
  for (let t = 0; t < days * TICKS_PER_DAY; t++) {
    sim.tick(1);
    for (const v of sim.guestSim.spawner.vehicles) veh.push(v.speed);
    for (let i = 0; i < st.limit; i++) {
      if (!st.alive[i] || (st.state[i] !== GState.Walking && st.state[i] !== GState.Leaving)) continue;
      const d = Math.hypot(st.x[i]! - st.px[i]!, st.y[i]! - st.py[i]!);
      if (d < 1e-3 || d > 25) continue; // not moving / a lift jump
      const m = st.moveMode[i]!;
      if (isSkiMode(m) && st.act[i] === Act.SkiDown) (m <= NavMode.Ski1 ? skiEasy : skiHard).push(d);
      else if (m === NavMode.Walk) walk.push(d);
      movers++;
      const wn = st.wpN[i]!;
      if (wn > 0) {
        wpGuests++;
        maxDev = Math.max(maxDev, maxChordDeviation(st.px[i]!, st.py[i]!, st.x[i]!, st.y[i]!, st.wp, i * WP_MAX * 2, wn));
        for (let k = 1; k < 8; k++) {
          pathPoint(st.px[i]!, st.py[i]!, st.x[i]!, st.y[i]!, st.wp, i * WP_MAX * 2, wn, k / 8, out);
          if (occ[(out.y | 0) * n + (out.x | 0)]! & SOLID) crossings++;
          const cx = st.px[i]! + (st.x[i]! - st.px[i]!) * (k / 8), cy = st.py[i]! + (st.y[i]! - st.py[i]!) * (k / 8);
          if (occ[(cy | 0) * n + (cx | 0)]! & SOLID) chordCrossings++;
        }
      }
    }
  }
  void prev;
  it('walkers p95 <= 9 tiles/s, skiers <= 10.5 (blue and easier; measured 8.6-10.2) / 13 (red, black; 9.7-11.9), vehicles <= 12', () => {
    expect(walk.length).toBeGreaterThan(50);
    const w = p95(walk) * TICKS_PER_SECOND, se = p95(skiEasy) * TICKS_PER_SECOND, sh = p95(skiHard) * TICKS_PER_SECOND, v = Math.max(0, ...veh) * TICKS_PER_SECOND;
    console.log(`[screen-speed] ${size}: walk p95 ${w.toFixed(1)} t/s (n ${walk.length}), ski easy p95 ${se.toFixed(1)} (n ${skiEasy.length}), ski hard p95 ${sh.toFixed(1)} (n ${skiHard.length}), vehicle max ${v.toFixed(1)} (n ${veh.length})`);
    expect(w).toBeLessThanOrEqual(9);
    expect(se).toBeLessThanOrEqual(10.5); expect(sh).toBeLessThanOrEqual(13);
    expect(v).toBeLessThanOrEqual(12);
    expect(w).toBeGreaterThan(1.5); // walkers are not frozen either
  }, 120000);
  it('walkers are drawn along the recorded path: no sampled point lies on a building / water tile', () => {
    expect(movers).toBeGreaterThan(100);
    expect(wpGuests / movers).toBeGreaterThan(0.5); // path-following guests record waypoints
    console.log(`[screen-path] ${size}: path samples on solid tiles ${crossings}, chord samples ${chordCrossings}, max deviation from the chord ${maxDev.toFixed(2)} tiles`);
    expect(crossings).toBe(0);
    expect(crossings).toBeLessThanOrEqual(chordCrossings);
  });
});
