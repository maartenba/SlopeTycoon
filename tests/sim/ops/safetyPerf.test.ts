import { describe, expect, it } from 'vitest';
import { rampGrid } from '../snowHelpers';
import { FakeGuests, mkB, mkSafety, run } from './safetyHelpers';
import { budget } from '../../perfMode';

describe('safety perf', () => {
  it('[perf] 256 map, 3,000 guests, live incidents + animals + avalanche slices: avg per-tick cost < 1.5 ms', () => {
    const N = 256, g = rampGrid(256);
    g.snowDepth.fill(1.2);
    const guests = new FakeGuests(N);
    for (let k = 0; k < 3000; k++) guests.add(k + 1, 5 + ((k * 37) % 240), 5 + ((k * 91) % 240), k % 5 === 0);
    const weather = { current: { intensity: 0.5, kind: 'snow' }, temperatureAt: () => -4 };
    const m = mkSafety({
      size: 256, guests, seed: 4, buildings: [mkB('patrolHub', 120, 120), mkB('helipad', 130, 130), mkB('firstAid', 100, 100), mkB('warningSign', 50, 50)],
      forest: new Uint8Array(N * N).fill(220), season: () => 'summer',
      avalanche: { grid: g, weather, altitude: () => 100, addSnow: () => {}, isPiste: () => false },
    });
    m.safety.resync(); m.safety.wildlife.refresh();
    let id = 4000;
    const times: number[] = [];
    let t = 0;
    for (let k = 0; k < 480; k++) {
      if (k % 12 === 0) { guests.add(id, 100 + (k % 50), 100 + (k % 40)); m.safety.incidents.report('injury', 100 + (k % 50), 100 + (k % 40), k % 3, id++); }
      const t0 = performance.now(); t = run(m.safety, 1, t); times.push(performance.now() - t0);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`safety (incidents+patrol+heli+avalanche+wildlife) 256 map, 3000 guests: avg ${avg.toFixed(3)} ms/tick, max ${Math.max(...times).toFixed(2)} ms, candidates ${m.safety.avalanche.candidateCount}, animals ${m.safety.wildlife.animals.length}`);
    expect(avg).toBeLessThan(budget(1.5));
  });
});
