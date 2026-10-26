import { DAYS_PER_YEAR } from '../../src/config/balance';
import { Grid } from '../../src/world/Grid';
import { VALLEY_BASE } from '../../src/world/TerrainGen';
import { createGameState } from '../../src/core/GameState';
import { Weather, SnowCover } from '../../src/sim/Weather';
import { TileConditions } from '../../src/sim/TileConditions';
import { worldScaleFor } from '../../src/sim/Season';
import { terrainRelief } from '../../src/world/TerrainGen';

/** Smooth ramp rising along +x from the valley floor to the full relief (±1 half-step per vertex). */
export function rampGrid(size: 64 | 128 | 256 = 64): Grid {
  const g = new Grid(size);
  const relief = terrainRelief(size);
  for (let vy = 0; vy <= size; vy++) for (let vx = 0; vx <= size; vx++) g.setCornerUnchecked(vx, vy, VALLEY_BASE + Math.round((vx / size) * relief));
  g.consumeDirtyChunks();
  return g;
}

export function world(seed = 7, size: 64 | 128 | 256 = 64, grid = rampGrid(size)) {
  const scale = worldScaleFor(size);
  const state = createGameState(seed, size);
  state.date.minute = 0;
  const weather = new Weather(seed, scale, state.date);
  const cond = new TileConditions(grid);
  const snow = new SnowCover(grid, cond, weather);
  snow.seed(state.date);
  return { grid, scale, state, weather, cond, snow };
}

/** Advance whole days with the full-map daily update (day index = year*1000+day, like the weather system). */
export function runDays(w: ReturnType<typeof world>, days: number): void {
  const d = w.state.date;
  for (let i = 0; i < days; i++) {
    w.snow.stepDay(d.year * 1000 + d.day);
    d.day++;
    if (d.day >= DAYS_PER_YEAR) { d.day = 0; d.year++; }
    w.weather.rollDay(d);
  }
}
