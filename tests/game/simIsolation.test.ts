/** Two sims in one process are independent: no module-level state leaks between createSim instances (0.8.3). */
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { placeBuilding } from '../../src/sim/PlaceBuilding';
import { Layer } from '../../src/world/Networks';
import { fullHash } from './harness';

const mk = (seed: number): Sim => createSim({ size: 64, seed, starterResort: true, mode: 'sandbox', now: () => 0, money: 5e6 } as never);
const top = (s: Sim) => [...s.runIndex.runs()].sort((a, b) => b.dropM - a.dropM)[0]!;

/** The race-day scenario of `analysis:race --raceday 1`: a red course, huts, a booked Saturday, run to it. Returns hash + the Saturday's income. */
function raceDay(seed: number): { hash: string; income: number } {
  const s = mk(seed); s.game.date.day = 120; const n = s.size;
  const run = top(s);
  s.networks.paint(Layer.Ski, run.tiles.map((t) => ({ x: t % n, y: (t / n) | 0 })), 2);
  const p = top(s).poly;
  const put = (type: 'startHut' | 'timingHut', tiles: number[]): void => {
    for (const t of tiles) for (let k = 1; k <= 3; k++) for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== k) continue;
      if (placeBuilding(s.env, s.props, type, (t % n) + dx, ((t / n) | 0) + dy, 0, true, false).ok) { s.buildings.reevaluate(); s.refreshCoverage(undefined, true); return; }
    }
  };
  put('startHut', [p[1]!, p[0]!, p[2]!]); put('timingHut', [p[p.length - 2]!, p[p.length - 1]!, p[p.length - 3]!]);
  s.tick(1);
  const id = s.names.pisteId(top(s)); s.setRunCourse(id, true);
  const abs = (): number => s.game.date.year * 180 + s.game.date.day;
  s.tick(240 * 3); s.runSettings.noteGroomed(id, abs());
  let d = abs() + 3; while (((d % 7) + 7) % 7 !== 5) d++;
  s.bookRaceDay(id, d);
  while (abs() < d) { s.runSettings.noteGroomed(id, abs()); s.tick(1); }
  const a = s.economy.lifetimeIncome(); while (abs() === d) s.tick(1);
  return { hash: fullHash(s), income: s.economy.lifetimeIncome() - a };
}

describe('sim isolation', () => {
  it('A, B, A in one process: identical hashes (plain sim)', () => {
    const run = (seed: number): string => { const s = mk(seed); s.tick(240 * 20); return fullHash(s); };
    const a1 = run(61), b = run(5), a2 = run(61), b2 = run(5);
    expect(a2).toBe(a1); expect(b2).toBe(b); expect(a1).not.toBe(b);
  });
  it('A, B, A in one process: the race-day scenario is identical', () => {
    const a1 = raceDay(61), b = raceDay(5), a2 = raceDay(61);
    expect(a2).toEqual(a1); expect(b.hash).not.toBe(a1.hash);
  });
});

describe('sim isolation, interleaved', () => {
  it('the race-day scenario is unchanged by a second live sim created before it ticks (the 0.8.2 analysis:race leak: PisteTraffic.sink was process-wide)', () => {
    const alone = raceDay(61);
    const other = mk(5); other.tick(240 * 2); // alive and mid-run while the scenario builds and runs
    expect(raceDay(61)).toEqual(alone);
    other.tick(240);
  });
  it('two live sims of one seed advanced alternately match a solo run', () => {
    const solo = mk(61); solo.tick(240 * 15); const want = fullHash(solo);
    const a = mk(61); a.tick(240 * 3); const b = mk(61); // b is created after a has already ticked
    for (let i = 0; i < 15; i++) { if (i >= 3) a.tick(240); b.tick(240); }
    expect(fullHash(a)).toBe(want); expect(fullHash(b)).toBe(want);
  });
});
