import { describe, expect, it } from 'vitest';
import { Grid, isWaterType } from '../../src/world/Grid';
import { generateTerrain } from '../../src/world/TerrainGen';
import { world, runDays } from './snowHelpers';
import { DAYS_PER_YEAR } from '../../src/config/balance';

/** Fraction of land tiles with snow > 5 cm inside an altitude band (fraction of relief above the valley floor). */
function snowFraction(w: ReturnType<typeof world>, lo: number, hi: number): number {
  const g = w.grid, N = g.size;
  let n = 0, s = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (isWaterType(g.tileType[i]!)) continue;
    const rel = (w.cond.altitude(x, y) - w.scale.baseWorld) / w.scale.reliefWorld;
    if (rel < lo || rel >= hi) continue;
    n++; if (g.snowDepth[i]! > 0.05) s++;
  }
  return n === 0 ? 0 : s / n;
}

/** Whole-year headless run on real generated terrain (no render): seasonal snow behaviour must match the plan. */
describe('seasonal snow cover (summer must be snow-free)', () => {
  for (const size of [64, 128, 256] as const) {
    for (const seed of [3, 11, 29]) {
      it(`size ${size} seed ${seed}`, () => {
        const grid = new Grid(size);
        generateTerrain(grid, seed);
        const w = world(seed, size, grid);
        const at = (day: number): void => { const d = w.state.date; const n = (day - d.day + DAYS_PER_YEAR) % DAYS_PER_YEAR; if (n > 0) runDays(w, n); };
        at(150); // deep winter (new games start on day 120 = early winter)
        expect(snowFraction(w, -1, 0.3)).toBeGreaterThan(0.9);
        at(30); // start of summer: lower 60 % of the relief is bare, only the highest slopes keep snow
        expect(snowFraction(w, -1, 0.6)).toBeLessThan(0.05);
        at(60); // mid summer
        expect(snowFraction(w, -1, 0.3)).toBeLessThan(0.01);
        expect(snowFraction(w, -1, 2)).toBeLessThan(0.05);
        at(75); // late summer: almost none anywhere
        expect(snowFraction(w, -1, 2)).toBeLessThan(0.01);
        at(100); // 11 Oct (calendar fix: the real Alpine autumn): valley still clear
        expect(snowFraction(w, -1, 0.3)).toBeLessThan(0.06);
        at(107); // 3 Nov: peaks first (first snow at altitude late Oct / Nov); a cold snap may already whiten the valley (mean valley temperature ~3 C in early Nov)
        expect(snowFraction(w, 0.85, 2)).toBeGreaterThan(0.3);
        at(120); // winter returns to the valley (1 Dec: valley mean ~0 C, calendar fix: was 0.8 when Nov was warm)
        expect(snowFraction(w, -1, 0.3)).toBeGreaterThan(0.7);
      }, 60000);
    }
  }
});
