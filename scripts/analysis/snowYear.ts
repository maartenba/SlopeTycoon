/**
 * Whole-year snow table (docs/time-flow.md section 10): per real month, the mean snow depth (m) of land tiles in three altitude bands
 * (low < 0.15 of the relief, mid 0.4-0.6, high > 0.85), plus first / last skiable day of the low band. Headless sim, no guests, year 2 (after a settled year 1).
 * `vite-node scripts/analysis/snowYear.ts [size] [seed...]`
 */
import { createSim } from '../../src/game/createSim';
import { isWaterType } from '../../src/world/Grid';
import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../../src/config/balance';
import { SIM_MONTHS_SHORT, dayOfYearLabel } from '../../src/sim/calendar';

const size = Number(process.argv[2] ?? 128) as 64 | 128 | 256;
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [3, 11, 29];
const bands: Array<[string, number, number]> = [['low', -1, 0.15], ['mid', 0.4, 0.6], ['high', 0.85, 2]];
const monthly = bands.map(() => Array.from({ length: 12 }, () => ({ s: 0, n: 0 })));
const firstLast: Array<{ first: number[]; last: number[] }> = [];
const snowlineM: number[][] = Array.from({ length: 12 }, () => []);
for (const seed of seeds) {
  const sim = createSim({ size, seed, now: () => 0 });
  const g = sim.grid, N = g.size, sc = sim.weather.scale;
  const idx = bands.map(([, lo, hi]) => { const a: number[] = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x; if (isWaterType(g.tileType[i]!)) continue; const rel = (sim.cond.altitude(x, y) - sc.baseWorld) / sc.reliefWorld; if (rel >= lo && rel < hi) a.push(i); } return a; });
  const lowSkiDays: number[] = [];
  for (let day = 0; day < 2 * DAYS_PER_YEAR; day++) {
    sim.tick(240);
    if (day < DAYS_PER_YEAR) continue;
    const d = sim.game.date.day, m = Math.floor(d / DAYS_PER_MONTH); // sim month 0 = April
    bands.forEach((_, b) => { let s = 0; for (const i of idx[b]!) s += g.snowDepth[i]!; const mean = s / Math.max(1, idx[b]!.length); monthly[b]![m]!.s += mean; monthly[b]![m]!.n++; if (b === 0 && mean >= 0.3) lowSkiDays.push(d); });
    snowlineM[m]!.push(sim.weather.current.snowline);
  }
  // year 2 runs 1 April -> 31 March: the season that ENDS this spring (days < 90) and the one that STARTS this autumn (days >= 90)
  const first = lowSkiDays.find((d) => d >= 90) ?? -1, last = [...lowSkiDays].reverse().find((d) => d < 90) ?? -1;
  firstLast.push({ first: [first], last: [last] });
}
console.log(`size ${size}, seeds ${seeds.join(',')}: mean snow depth (m) by band; skiable (mean >= 0.3 m) low-band days: ${firstLast.map((f) => `season ends ${f.last[0]! >= 0 ? dayOfYearLabel(f.last[0]!) : '-'} / next starts ${f.first[0]! >= 0 ? dayOfYearLabel(f.first[0]!) : '-'}`).join('; ')}`);
console.log('month | low | mid | high');
for (let m = 0; m < 12; m++) {
  console.log(`${SIM_MONTHS_SHORT[m]} | ${bands.map((_, b) => (monthly[b]![m]!.s / Math.max(1, monthly[b]![m]!.n)).toFixed(2)).join(' | ')}`);
}
