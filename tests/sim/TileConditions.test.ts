import { describe, expect, it } from 'vitest';
import { Grid, TileType } from '../../src/world/Grid';
import { TileConditions } from '../../src/sim/TileConditions';

const mk = () => { const g = new Grid(64); return { g, c: new TileConditions(g) }; };
const set = (g: Grid, c: TileConditions, d: number) => { g.snowDepth[g.tileIndex(5, 5)] = d; c.refreshTile(g.tileIndex(5, 5)); };

describe('TileConditions', () => {
  it('skiable hysteresis: opens >= 30 cm, closes < 15 cm, holds in between', () => {
    const { g, c } = mk();
    set(g, c, 0.2); expect(c.isSkiable(5, 5)).toBe(false);
    set(g, c, 0.3); expect(c.isSkiable(5, 5)).toBe(true);
    set(g, c, 0.2); expect(c.isSkiable(5, 5)).toBe(true);
    set(g, c, 0.15); expect(c.isSkiable(5, 5)).toBe(true);
    set(g, c, 0.14); expect(c.isSkiable(5, 5)).toBe(false);
    set(g, c, 0.29); expect(c.isSkiable(5, 5)).toBe(false);
  });
  it('no toggling while depth wobbles inside the dead band', () => {
    const { g, c } = mk();
    set(g, c, 0.35);
    let flips = 0, prev = c.isSkiable(5, 5);
    for (let h = 0; h < 48; h++) { set(g, c, 0.22 + 0.06 * Math.sin(h)); const s = c.isSkiable(5, 5); if (s !== prev) flips++; prev = s; }
    expect(flips).toBe(0);
  });
  it('hikeable / bikeable / zone, water excluded', () => {
    const { g, c } = mk();
    set(g, c, 0); expect(c.isHikeable(5, 5)).toBe(true); expect(c.isBikeable(5, 5)).toBe(true); expect(c.zone(5, 5)).toBe('meadow');
    set(g, c, 0.08); expect(c.zone(5, 5)).toBe('slush');
    set(g, c, 0.5); expect(c.zone(5, 5)).toBe('snow'); expect(c.isHikeable(5, 5)).toBe(false);
    g.tileType[g.tileIndex(6, 6)] = TileType.Water;
    c.refreshTile(g.tileIndex(6, 6));
    expect(c.isHikeable(6, 6)).toBe(false); expect(c.isSkiable(6, 6)).toBe(false);
    g.setCornerUnchecked(5, 5, 2); g.setCornerUnchecked(6, 5, 2);
    set(g, c, 0); expect(c.isBikeable(5, 5)).toBe(false); // steepness 2 > BIKE_MAX_STEEPNESS
  });
});
