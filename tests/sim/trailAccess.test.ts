/** Phase 6 Task 2: the `trail` access kind (attached Hike / MTB components) + the remote-supply upkeep surcharge. docs/trails-access.md */
import { describe, expect, it } from 'vitest';
import { BUILDINGS, type BuildingDef } from '../../src/config/buildings';
import { REMOTE_SUPPLY_MULT } from '../../src/config/balance';
import { Grid } from '../../src/world/Grid';
import { Layer, Networks, NetKind, lineTiles } from '../../src/world/Networks';
import { Buildings } from '../../src/sim/Buildings';
import { accessReason, accessSatisfied, isAccessReason, suppliedOnFootOnly } from '../../src/sim/PlacementRules';
import { createSim } from '../../src/game/createSim';

const mk = () => {
  const grid = new Grid(64);
  const buildings = new Buildings(grid.occupancy);
  const net = new Networks(grid, buildings);
  buildings.setNetwork({ pathDistance: net.pathDistance, roadConnected: net.roadConnected, access: net.access });
  net.roadEntry = { x: 0, y: 40 };
  return { grid, buildings, net };
};
const def = (access: BuildingDef['access'], altAccess?: BuildingDef['altAccess']): BuildingDef => ({ ...BUILDINGS.cafe!, access, altAccess });
const rect = (x: number, y: number) => ({ x, y, w: 2, h: 2 });

describe('trail access kind', () => {
  it('an attached trail (touching the walk network) serves a building beside it; an island trail does not', () => {
    const { net } = mk();
    net.buildSegment(NetKind.Path, lineTiles({ x: 0, y: 40 }, { x: 20, y: 40 }));
    net.paint(Layer.Hike, lineTiles({ x: 20, y: 39 }, { x: 20, y: 20 })); // touches the path end
    net.paint(Layer.Mtb, lineTiles({ x: 50, y: 10 }, { x: 50, y: 30 })); // island, nobody can walk to it
    const trailOnly = def('trail');
    expect(accessSatisfied(trailOnly, net.access, rect(21, 25))).toBe(true);
    expect(accessSatisfied(trailOnly, net.access, rect(51, 20))).toBe(false);
    expect(accessSatisfied(trailOnly, net.access, rect(30, 30))).toBe(false);
  });
  it('trail tiles over a stream (bridge) still count', () => {
    const { net, grid } = mk();
    net.buildSegment(NetKind.Path, lineTiles({ x: 0, y: 40 }, { x: 20, y: 40 }));
    net.paint(Layer.Hike, lineTiles({ x: 20, y: 39 }, { x: 20, y: 20 }));
    grid.tileType[grid.tileIndex(20, 30)] = 6; // stream tile under the trail
    expect(accessSatisfied(def('trail'), net.access, rect(21, 25))).toBe(true);
  });
  it('reason text is exact and still isAccessReason', () => {
    expect(accessReason(def('trail', ['path']))).toBe('Needs a footpath, road or hiking trail next to it');
    expect(accessReason(def('path', ['pisteEdge', 'trail']))).toBe('Needs a footpath, road, hiking trail or piste next to it');
    expect(accessReason(def('trail'))).toBe('Needs a hiking trail next to it');
    for (const r of ['Needs a footpath, road or piste next to it', 'Needs a road next to it', 'Needs a rail line and a footpath next to it', 'Needs a footpath, road, hiking trail or piste next to it']) expect(isAccessReason(r), r).toBe(true);
    expect(isAccessReason('Needs a depot')).toBe(false);
  });
  it('supplied-on-foot only when no footpath / road touches the footprint', () => {
    const { net } = mk();
    net.buildSegment(NetKind.Path, lineTiles({ x: 0, y: 40 }, { x: 20, y: 40 }));
    net.paint(Layer.Hike, lineTiles({ x: 20, y: 39 }, { x: 20, y: 20 }));
    const d = def('path', ['trail', 'pisteEdge']);
    expect(suppliedOnFootOnly(d, net.access, rect(21, 25))).toBe(true); // trail only
    expect(suppliedOnFootOnly(d, net.access, rect(19, 38))).toBe(false); // trail AND the path: not remote
    expect(suppliedOnFootOnly(d, net.access, rect(40, 5))).toBe(false); // not served at all (inactive, not 'remote')
    expect(suppliedOnFootOnly(def('road'), net.access, rect(21, 25))).toBe(false); // no trail/piste alt
    expect(suppliedOnFootOnly(def('none'), net.access, rect(21, 25))).toBe(false);
  });
});

describe('remote-supply upkeep', () => {
  const place = (remoteSupply: boolean, withPath: boolean) => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0, remoteSupply });
    // a free 6x6 patch far from everything
    const N = sim.size, occ = sim.grid.occupancy.flags;
    let px = -1, py = -1;
    outer: for (let y = 4; y < N - 8; y++) for (let x = 4; x < N - 8; x++) {
      let ok = true;
      for (let j = 0; j < 7 && ok; j++) for (let i = 0; i < 7; i++) if (occ[sim.grid.tileIndex(x + i, y + j)] !== 0 || sim.networks.pisteAt(x + i, y + j) || sim.networks.kindAt(x + i, y + j)) { ok = false; break; }
      if (ok) { px = x; py = y; break outer; }
    }
    expect(px).toBeGreaterThan(0);
    sim.networks.paint(Layer.Hike, lineTiles({ x: px, y: py }, { x: px, y: py + 6 }));
    if (withPath) { sim.networks.roadEntry = { x: px + 3, y: py + 6 }; sim.networks.buildSegment(NetKind.Path, lineTiles({ x: px + 3, y: py + 6 }, { x: px + 3, y: py + 3 })); }
    const { building } = sim.buildings.add('mountainHut', px + 1, py + 2);
    sim.buildings.reevaluate();
    return { sim, id: building.id };
  };
  const upkeepOf = (sim: ReturnType<typeof createSim>): number => { const m0 = sim.game.money; sim.finance.endDay(); return m0 - sim.game.money; };

  it('+25% only when no path / road is present and the flag is on', () => {
    const off = place(false, false), on = place(true, false), onPath = place(true, true);
    expect(on.sim.networks.suppliedOnFootOnly(on.id)).toBe(true);
    expect(onPath.sim.networks.suppliedOnFootOnly(onPath.id)).toBe(false);
    const hut = BUILDINGS.mountainHut!.upkeep * on.sim.difficulty.upkeep;
    const a = upkeepOf(off.sim), b = upkeepOf(on.sim), c = upkeepOf(onPath.sim);
    expect(b - a).toBeCloseTo(hut * (REMOTE_SUPPLY_MULT - 1), 1);
    expect(c - a).toBeLessThan(1e-6 + 0.01);
  });
});

describe('approved access-table rows (D-P9, Task 3)', () => {
  const kinds = (id: string) => [BUILDINGS[id]!.access, ...(BUILDINGS[id]!.altAccess ?? [])];
  it('trail added: Mountain Hut, Ranger Station, Adventure Park, Alpine Farm', () => {
    for (const id of ['mountainHut', 'rangerStation', 'adventurePark', 'alpineFarm']) expect(kinds(id), id).toContain('trail');
  });
  it('pisteEdge added: Café, Stunt Park', () => {
    for (const id of ['cafe', 'stuntPark']) expect(kinds(id), id).toContain('pisteEdge');
  });
  it('NEW-c rows still accept a footpath (and a road counts as one); hotels / lodges stay road-only', () => {
    const { net } = mk();
    net.buildSegment(NetKind.Path, lineTiles({ x: 0, y: 40 }, { x: 20, y: 40 }));
    for (const id of ['shop', 'chalet', 'apartment']) {
      expect(kinds(id), id).toContain('path');
      expect(accessSatisfied(BUILDINGS[id]!, net.access, rect(10, 41)), id).toBe(true);
    }
    for (const id of ['baseLodge', 'lodge', 'rental', 'parking', 'groomerGarage', 'liftWorkshop', 'altiport']) { expect(kinds(id), id).toEqual(['road']); expect(kinds(id)).not.toContain('trail'); }
  });
  it('the Ranger Station stays ungated (goal / advisor dependency)', async () => {
    const { UNLOCKS } = await import('../../src/config/unlocks');
    expect(JSON.stringify(UNLOCKS)).not.toMatch(/rangerStation/);
  });
});
