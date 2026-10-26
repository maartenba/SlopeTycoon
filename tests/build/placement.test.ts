import { describe, it, expect } from 'vitest';
import { Grid, TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { Buildings } from '../../src/sim/Buildings';
import { Economy } from '../../src/sim/Economy';
import { PropStore } from '../../src/world/Props';
import { validatePlacement, placeBuilding, anchorFor } from '../../src/build/PlacementTool';

const mk = (money = 100000) => {
  const grid = new Grid(64);
  const buildings = new Buildings(grid.occupancy);
  const state = { money };
  const economy = new Economy(state);
  return { grid, buildings, state, economy, env: { grid, buildings, economy } };
};

describe('validatePlacement', () => {
  it('accepts flat free ground', () => {
    const { env } = mk();
    expect(validatePlacement(env, 'cafe', 5, 5, 0).ok).toBe(true);
  });
  it('rejects out of bounds', () => {
    const { env } = mk();
    expect(validatePlacement(env, 'cafe', 63, 63, 0).reasons).toContain('Out of bounds');
    expect(validatePlacement(env, 'cafe', -1, 0, 0).ok).toBe(false);
  });
  it('rejects overlap', () => {
    const { env, buildings } = mk();
    buildings.add('cafe', 5, 5);
    expect(validatePlacement(env, 'shop', 6, 6, 0).reasons).toContain('Tile occupied');
    expect(validatePlacement(env, 'shop', 7, 5, 0).ok).toBe(true);
  });
  it('never builds on water; lakeEdge types go on the dry shore', () => {
    const { env, grid, buildings } = mk();
    grid.tileType[grid.tileIndex(5, 5)] = TileType.Water;
    grid.occupancy.set(5, 5, OccFlag.Water);
    buildings.lakeTiles = [{ x: 5, y: 5 }];
    expect(validatePlacement(env, 'cafe', 5, 5, 0).reasons).toContain('Cannot build on water');
    expect(validatePlacement(env, 'boatRental', 5, 5, 0).reasons).toContain('Cannot build on water');
    expect(validatePlacement(env, 'boatRental', 6, 5, 0).ok).toBe(true); // dry, touching the lake
  });
  it('rejects steep unless auto-flatten; flatten adds cost and works', () => {
    const { env, grid } = mk();
    grid.setCornerUnchecked(6, 6, 2);
    const steep = validatePlacement(env, 'cafe', 5, 5, 0);
    expect(steep.reasons).toContain('Too steep');
    const flat = validatePlacement(env, 'cafe', 5, 5, 0, true);
    expect(flat.ok).toBe(true);
    expect(flat.flatten).toBe(true);
    expect(flat.flattenCost).toBeGreaterThan(0);
    expect(grid.getCorner(6, 6)).toBe(2); // preview rolled back
    const out = placeBuilding(env, undefined, 'cafe', 5, 5, 0, true);
    expect(out.ok).toBe(true);
    expect(grid.getCorner(6, 6)).toBeLessThanOrEqual(1);
    expect(env.economy.money).toBe(100000 - 2500 - flat.flattenCost);
  });
  it('rejects locked and insufficient funds', () => {
    const { env } = mk(1000);
    expect(validatePlacement(env, 'magicCarpet', 5, 5, 0).reasons.join()).toMatch(/Ski School/);
    expect(validatePlacement(env, 'cafe', 5, 5, 0).reasons.join()).toMatch(/funds/);
  });
  it('applies the construction multiplier', () => {
    const { env, economy } = mk();
    economy.setSeasonHook(() => 0.5);
    expect(validatePlacement(env, 'cafe', 5, 5, 0).cost).toBe(1250);
  });
});

describe('placeBuilding', () => {
  it('writes occupancy, charges, removes props, blocks overlap', () => {
    const { env, grid, state } = mk();
    const props = new PropStore(grid);
    props.add(0, 6, 6, 0.5, 0.5, 1, 0, 1);
    props.add(0, 20, 20, 0.5, 0.5, 1, 0, 1);
    const out = placeBuilding(env, props, 'cafe', 5, 5, 0);
    expect(out.ok).toBe(true);
    expect(state.money).toBe(97500);
    expect(props.count()).toBe(1);
    expect(grid.occupancy.has(6, 6, OccFlag.Building)).toBe(true);
    const again = placeBuilding(env, props, 'cafe', 5, 5, 0);
    expect(again.ok).toBe(false);
    expect(state.money).toBe(97500);
  });
  it('anchorFor centres footprint', () => {
    expect(anchorFor('baseLodge', 0, 10, 10)).toEqual({ x: 9, y: 9 });
    expect(anchorFor('cafe', 0, 10, 10)).toEqual({ x: 10, y: 10 });
  });
});
