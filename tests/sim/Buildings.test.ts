import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { Buildings } from '../../src/sim/Buildings';
import { Economy } from '../../src/sim/Economy';
import { bulldoze } from '../../src/build/Bulldoze';

const mk = () => {
  const grid = new Grid(64);
  const buildings = new Buildings(grid.occupancy);
  const state = { money: 10000 };
  return { grid, buildings, state, economy: new Economy(state) };
};

describe('Buildings store', () => {
  it('writes occupancy with entity id and flag; at() finds by tile', () => {
    const { grid, buildings } = mk();
    const { building } = buildings.add('cafe', 5, 5);
    for (const [x, y] of [[5, 5], [6, 6]] as const) {
      expect(grid.occupancy.has(x, y, OccFlag.Building)).toBe(true);
      expect(grid.occupancy.entityId[grid.occupancy.index(x, y)]).toBe(building.id);
      expect(buildings.at(x, y)?.id).toBe(building.id);
    }
    expect(grid.occupancy.isFree(7, 5)).toBe(true);
  });
  it('rotation swaps footprint', () => {
    const { grid, buildings } = mk();
    buildings.add('magicCarpet', 10, 10, 1); // 1x6 -> 6x1
    expect(grid.occupancy.has(15, 10, OccFlag.Building)).toBe(true);
    expect(grid.occupancy.has(10, 11, OccFlag.Building)).toBe(false);
  });
  it('serialises round-trip', () => {
    const { buildings, grid } = mk();
    buildings.add('baseLodge', 2, 2);
    buildings.add('cafe', 20, 20, 1);
    const data = JSON.parse(JSON.stringify(buildings.serialize()));
    const b2 = new Buildings(new Grid(64).occupancy);
    b2.load(data);
    expect(b2.serialize()).toEqual(buildings.serialize());
    expect(grid.size).toBe(64);
  });
});

describe('Bulldoze', () => {
  it('refunds 50%, frees tiles', () => {
    const { grid, buildings, state, economy } = mk();
    const { building } = buildings.add('cafe', 5, 5); // cost 2500
    const r = bulldoze(buildings, economy, building.id);
    expect(r.ok).toBe(true);
    expect(r.refund).toBe(1250);
    expect(state.money).toBe(11250);
    expect(grid.occupancy.isFree(5, 5)).toBe(true);
    expect(grid.occupancy.entityId[grid.occupancy.index(5, 5)]).toBe(0);
    expect(buildings.size).toBe(0);
    expect(bulldoze(buildings, economy, building.id).ok).toBe(false);
  });
  it('cascades dependents inactive', () => {
    const { buildings, economy } = mk();
    const hq = buildings.add('skiSchoolHQ', 0, 0).building;
    const carpet = buildings.add('magicCarpet', 10, 10).building;
    expect(carpet.reason).toBeUndefined();
    expect(carpet.active).toBe(true);
    const r = bulldoze(buildings, economy, hq.id);
    expect(r.changed.map((c) => c.id)).toContain(carpet.id);
    expect(buildings.get(carpet.id)?.active).toBe(false);
    expect(buildings.get(carpet.id)?.reason).toMatch(/Ski School/);
  });
});

describe('Economy', () => {
  it('charge refuses when poor, emits on change, season hook', () => {
    let last = -1;
    const st = { money: 100 };
    const e = new Economy(st, (m) => { last = m; });
    expect(e.charge(150)).toBe(false);
    expect(st.money).toBe(100);
    expect(e.charge(40)).toBe(true);
    expect(last).toBe(60);
    expect(e.constructionMultiplier()).toBe(1);
    e.setSeasonHook(() => 0.5);
    expect(e.constructionMultiplier()).toBe(0.5);
  });
});
