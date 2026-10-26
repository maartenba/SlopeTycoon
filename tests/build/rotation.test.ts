import { describe, expect, it } from 'vitest';
import { Grid, TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { Buildings, footprintOf } from '../../src/sim/Buildings';
import { Economy } from '../../src/sim/Economy';
import { placeBuilding, validatePlacement, anchorFor, rotateBuilding, validateRotation } from '../../src/sim/PlaceBuilding';

const mk = (money = 100000) => {
  const grid = new Grid(64);
  const buildings = new Buildings(grid.occupancy);
  const economy = new Economy({ money });
  return { grid, buildings, economy, env: { grid, buildings, economy } };
};
const occTiles = (g: Grid): string[] => {
  const out: string[] = [];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (g.occupancy.flags[g.occupancy.index(x, y)]! & OccFlag.Building) out.push(`${x},${y}`);
  return out.sort();
};

describe('building rotation', () => {
  it('swaps the footprint for odd quarter turns (non-square) and keeps it for even ones', () => {
    expect(footprintOf('rental', 0)).toEqual({ w: 3, h: 2 });
    expect(footprintOf('rental', 1)).toEqual({ w: 2, h: 3 });
    expect(footprintOf('rental', 2)).toEqual({ w: 3, h: 2 });
    expect(footprintOf('rental', 3)).toEqual({ w: 2, h: 3 });
  });
  it('placement validation and occupancy use the rotated footprint', () => {
    const { env, grid, buildings } = mk();
    const a = anchorFor('rental', 1, 10, 10);
    const out = placeBuilding(env, undefined, 'rental', a.x, a.y, 1);
    expect(out.ok).toBe(true);
    expect(out.building).toMatchObject({ w: 2, h: 3, rot: 1 });
    expect(occTiles(grid).length).toBe(6);
    // a 3-wide tile row next to it is free only where the *rotated* (2 wide) footprint is
    expect(validatePlacement(env, 'cafe', a.x + 2, a.y, 0).ok).toBe(true);
    expect(validatePlacement(env, 'cafe', a.x + 1, a.y, 0).reasons).toContain('Tile occupied');
    // out of bounds with the rotated size: 3 tall at the bottom edge
    expect(validatePlacement(env, 'rental', 10, 63 - 2, 1).ok).toBe(false);
    expect(buildings.size).toBe(1);
  });
  it('rotates a placed building: occupancy + dimensions update, centre preserved', () => {
    const { env, grid } = mk();
    const placed = placeBuilding(env, undefined, 'rental', 20, 20, 0).building!;
    expect(occTiles(grid)).toEqual(['20,20', '20,21', '21,20', '21,21', '22,20', '22,21']);
    const r = rotateBuilding(env, undefined, placed.id, 1);
    expect(r.ok).toBe(true);
    expect(r.building).toMatchObject({ rot: 1, w: 2, h: 3 });
    const b = env.buildings.get(placed.id)!;
    expect(occTiles(grid).length).toBe(6);
    expect(occTiles(grid)).toEqual(['20,20', '20,21', '20,22', '21,20', '21,21', '21,22'].map((_, i) => `${b.x + (i < 3 ? 0 : 1)},${b.y + (i % 3)}`).sort());
    expect(Math.abs(b.x + b.w / 2 - 21.5)).toBeLessThanOrEqual(0.5); expect(Math.abs(b.y + b.h / 2 - 21)).toBeLessThanOrEqual(0.5); // centre kept within half a tile
    // four turns return to the start, charging nothing
    const money = env.economy.money;
    for (let i = 0; i < 3; i++) expect(rotateBuilding(env, undefined, placed.id, 1).ok).toBe(true);
    expect(env.buildings.get(placed.id)).toMatchObject({ rot: 0, x: 20, y: 20, w: 3, h: 2 });
    expect(env.economy.money).toBe(money);
    expect(occTiles(grid)).toEqual(['20,20', '20,21', '21,20', '21,21', '22,20', '22,21']);
  });
  it('refuses to rotate into occupied tiles, water or steep ground (and changes nothing)', () => {
    const { env, grid } = mk();
    const a = placeBuilding(env, undefined, 'rental', 20, 20, 0).building!;
    placeBuilding(env, undefined, 'cafe', 20, 22, 0); // sits where the rotated footprint (3 tall) would reach
    const before = occTiles(grid);
    const r = rotateBuilding(env, undefined, a.id, 1);
    expect(r.ok).toBe(false); expect(r.reasons).toContain('Tile occupied');
    expect(occTiles(grid)).toEqual(before);
    expect(env.buildings.get(a.id)).toMatchObject({ rot: 0, w: 3, h: 2 });
    // water
    const w = mk();
    const b = placeBuilding(w.env, undefined, 'rental', 30, 30, 0).building!;
    const rot = validateRotation(w.env, b.id, 1);
    w.grid.tileType[w.grid.tileIndex(rot.x, rot.y + 2)] = TileType.Water;
    expect(rotateBuilding(w.env, undefined, b.id, 1).reasons.join()).toMatch(/water/);
    // steep
    const s = mk();
    const c = placeBuilding(s.env, undefined, 'rental', 30, 30, 0).building!;
    const v = validateRotation(s.env, c.id, 1);
    s.grid.setCornerUnchecked(v.x + 1, v.y + 3, 6);
    expect(rotateBuilding(s.env, undefined, c.id, 1).reasons).toContain('Too steep');
    expect(s.buildings.get(c.id)!.rot).toBe(0);
  });
  it('rotating back (-1) works and unknown ids are refused', () => {
    const { env } = mk();
    const a = placeBuilding(env, undefined, 'rental', 20, 20, 0).building!;
    expect(rotateBuilding(env, undefined, a.id, -1).building!.rot).toBe(3);
    expect(rotateBuilding(env, undefined, 999).ok).toBe(false);
  });
});
