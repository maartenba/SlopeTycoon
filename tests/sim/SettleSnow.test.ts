import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { isWaterType } from '../../src/world/Grid';
import { dayFromSeasonYear, jumpTo, seasonProgress, seasonYear, seasonStartDay, seasonOf } from '../../src/sim/Clock';

type S = ReturnType<typeof createSim>;
function frac(sim: S, lo: number, hi: number): number {
  const g = sim.grid, N = g.size, sc = sim.weather.scale;
  let n = 0, s = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (isWaterType(g.tileType[i]!)) continue;
    const rel = (sim.cond.altitude(x, y) - sc.baseWorld) / sc.reliefWorld;
    if (rel < lo || rel >= hi) continue;
    n++; if (g.snowDepth[i]! > 0.05) s++;
  }
  return n === 0 ? 0 : s / n;
}

describe('instant snow settle (date jumps)', () => {
  for (const size of [64, 128] as const) {
    it(`size ${size}: winter -> summer -> winter`, () => {
      const sim = createSim({ size, seed: 11, now: () => 0 });
      expect(frac(sim, -1, 0.3)).toBeGreaterThan(0.8);
      sim.jumpToDay(60); // mid summer
      expect(sim.game.date.day).toBe(60);
      expect(frac(sim, -1, 0.3)).toBeLessThan(0.01);
      expect(frac(sim, -1, 0.99)).toBeLessThan(0.01);
      expect(frac(sim, -1, 2)).toBeLessThan(0.05);
      sim.jumpToDay(30); // start of summer (next year)
      expect(frac(sim, -1, 0.6)).toBeLessThan(0.05);
      sim.jumpToDay(107); // autumn: peaks first
      expect(frac(sim, 0.85, 2)).toBeGreaterThan(0.3);
      expect(frac(sim, -1, 0.3)).toBeLessThan(0.05);
      sim.jumpToDay(150); // deep winter again
      expect(frac(sim, -1, 0.3)).toBeGreaterThan(0.9);
      sim.tick(480); // the live sim carries on from the settled state
      expect(frac(sim, -1, 0.3)).toBeGreaterThan(0.8);
    }, 60000);
  }

  it('marks every chunk snow-dirty and syncs tile conditions', () => {
    const sim = createSim({ size: 64, seed: 3, now: () => 0 });
    sim.grid.consumeSnowDirtyChunks();
    sim.jumpToDay(60);
    expect(sim.grid.consumeSnowDirtyChunks().length).toBe(sim.grid.chunksPerRow ** 2);
    let open = 0;
    for (let i = 0; i < sim.cond.skiOpen.length; i++) open += sim.cond.skiOpen[i]!;
    expect(open).toBeLessThan(sim.grid.size * sim.grid.size * 0.02);
  });

  it('is deterministic and independent of history', () => {
    const a = createSim({ size: 64, seed: 5, now: () => 0 });
    const b = createSim({ size: 64, seed: 5, now: () => 0 });
    b.tick(2000);
    a.jumpToDay(75); b.jumpToDay(75);
    expect(a.snow.hash()).toBe(b.snow.hash());
    const c = createSim({ size: 64, seed: 5, now: () => 0 });
    c.jumpToDay(75);
    expect(c.snow.hash()).toBe(a.snow.hash());
    expect(c.weather.current).toEqual(a.weather.current);
  });

  it('startSeason summer starts snow-free in summer', () => {
    const sim = createSim({ size: 64, seed: 9, startSeason: 'summer', now: () => 0 });
    expect(seasonOf(sim.game.date)).toBe('summer');
    expect(frac(sim, -1, 0.5)).toBeLessThan(0.01);
    const w = createSim({ size: 64, seed: 9, now: () => 0 });
    expect(seasonOf(w.game.date)).toBe('winter');
  });
});

describe('Clock jump helpers', () => {
  it('jumpTo moves forward only (wraps the year), hour 08:00', () => {
    const d = { year: 0, day: 120, minute: 100, tick: 5 };
    jumpTo(d, 60);
    expect(d).toMatchObject({ year: 1, day: 60, minute: 480 });
    jumpTo(d, 100);
    expect(d).toMatchObject({ year: 1, day: 100 });
  });
  it('dayFromSeasonYear inverts seasonYear (debug slider mapping)', () => {
    for (let day = 0; day < 180; day += 3) {
      expect(dayFromSeasonYear(seasonYear({ day, minute: 0 }))).toBeGreaterThanOrEqual(day - 1);
      expect(dayFromSeasonYear(seasonYear({ day, minute: 0 }))).toBeLessThanOrEqual(day);
    }
    expect(seasonOf({ day: dayFromSeasonYear(0.375) })).toBe('summer');
    expect(seasonOf({ day: dayFromSeasonYear(0.875) })).toBe('winter');
    expect(seasonOf({ day: dayFromSeasonYear(0.625) })).toBe('autumn');
    expect(seasonOf({ day: dayFromSeasonYear(0.125) })).toBe('spring');
  });
  it('seasonProgress', () => {
    expect(seasonProgress({ day: 131 })).toMatchObject({ season: 'winter', day: 12, length: 60, next: 'spring', daysLeft: 49 });
    expect(seasonStartDay('summer')).toBe(30);
    expect(seasonProgress({ day: 179 }).daysLeft).toBe(1);
  });
});
