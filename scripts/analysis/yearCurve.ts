/** Prints month -> mean valley temp, snowline (m) per map size, daylight hours (docs/time-flow.md §10 table). `vite-node scripts/analysis/yearCurve.ts` */
import { DAYS_PER_MONTH, RESORT_BASE_ELEVATION_M, TILE_METRES } from '../../src/config/balance';
import { REAL_MONTHS_SHORT, simDayOf } from '../../src/sim/calendar';
import { seasonalValleyTemp, snowlineHeight, worldScaleFor } from '../../src/sim/Season';
import { daylightHours, sunrise, sunset, fmtClock } from '../../src/sim/Daylight';

const sizes = [64, 128, 256] as const;
const mean = (f: (d: number) => number, d0: number): number => { let s = 0; for (let i = 0; i < DAYS_PER_MONTH; i++) s += f(d0 + i + 0.5); return s / DAYS_PER_MONTH; };
console.log('month | valley T (1200 m) | snowline m (64/128/256) | daylight h | sunrise-sunset');
for (let m = 0; m < 12; m++) {
  const d0 = simDayOf(m, 1);
  const t = mean((d) => seasonalValleyTemp({ day: d, minute: 0 }), d0);
  const line = sizes.map((s) => { const sc = worldScaleFor(s); return Math.round(RESORT_BASE_ELEVATION_M + mean((d) => snowlineHeight({ day: d, minute: 0 }, sc), d0) * TILE_METRES); });
  console.log(`${REAL_MONTHS_SHORT[m]} | ${t.toFixed(1)} | ${line.join(' / ')} | ${mean(daylightHours, d0).toFixed(1)} | ${fmtClock(mean(sunrise, d0))}-${fmtClock(mean(sunset, d0))}`);
}
const ex = (name: string, f: (d: number) => number) => { let lo = 0, hi = 0; for (let d = 0; d < 180; d += 0.25) { if (f(d) < f(lo)) lo = d; if (f(d) > f(hi)) hi = d; } console.log(`${name}: min day ${lo}, max day ${hi}`); };
ex('valleyT', (d) => seasonalValleyTemp({ day: d, minute: 0 }));
ex('daylight', daylightHours);
