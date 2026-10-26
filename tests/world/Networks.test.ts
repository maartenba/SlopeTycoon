import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { Buildings } from '../../src/sim/Buildings';
import { Networks, NetKind, Layer, lineTiles, checkRunway, difficultyFromSteepness, Conn } from '../../src/world/Networks';

const mk = () => {
  const grid = new Grid(64);
  const buildings = new Buildings(grid.occupancy);
  const net = new Networks(grid, buildings);
  buildings.setNetwork({ pathDistance: net.pathDistance, roadConnected: net.roadConnected });
  return { grid, buildings, net };
};
const P = NetKind.Path, R = NetKind.Road;

describe('Networks', () => {
  it('draws L-shaped paths with edge connections and removes them', () => {
    const { net, grid } = mk();
    expect(net.buildSegment(P, lineTiles({ x: 2, y: 2 }, { x: 5, y: 4 })).length).toBe(6);
    expect(net.conn[grid.tileIndex(3, 2)]).toBe(Conn.E | Conn.W);
    expect(net.conn[grid.tileIndex(5, 2)]).toBe(Conn.W | Conn.S);
    expect(net.unbuild(3, 2)).toBe(P);
    expect(net.conn[grid.tileIndex(2, 2)]).toBe(0);
    expect(net.consumeDirtyChunks().length).toBeGreaterThan(0);
  });
  it('rejects water, buildings, steep roads; roads need the entry', () => {
    const { net, grid, buildings } = mk();
    grid.tileType[grid.tileIndex(10, 10)] = 2;
    expect(net.canBuild(P, 10, 10).ok).toBe(false);
    buildings.add('cafe', 20, 20);
    expect(net.canBuild(P, 20, 20).ok).toBe(false);
    expect(net.canBuild(R, 30, 30).ok).toBe(false);
    net.roadEntry = { x: 30, y: 63 };
    expect(net.canBuild(R, 30, 63).ok).toBe(true);
    grid.setCornerUnchecked(31, 63, 2);
    grid.setCornerUnchecked(31, 64, 2);
    expect(net.canBuild(R, 30, 63).ok).toBe(false);
    expect(net.canBuild(P, 30, 63).ok).toBe(true); // full slope ok for paths
  });
  it('streams get bridges for paths; rail cannot cross', () => {
    const { net, grid } = mk();
    grid.tileType[grid.tileIndex(8, 8)] = 6;
    expect(net.build(P, 8, 8)).toBe(true);
    expect(net.bridge[grid.tileIndex(8, 8)]).toBe(1);
    grid.tileType[grid.tileIndex(9, 8)] = 6;
    net.railEntry = { x: 9, y: 8 };
    expect(net.canBuild(NetKind.Rail, 9, 8).ok).toBe(false);
  });
  it('bounded BFS pathDistance respects maxTiles', () => {
    const { net, buildings } = mk();
    const a = buildings.add('baseLodge', 10, 10).building;
    const b = buildings.add('cafe', 10 + a.w + 11, 10).building;
    net.buildSegment(P, lineTiles({ x: a.x + a.w, y: 10 }, { x: b.x - 1, y: 10 }));
    const len = b.x - 1 - (a.x + a.w) + 1;
    expect(net.pathDistance(a, b, 100)).toBe(len + 1);
    expect(net.pathDistance(a, b, len + 1)).toBe(len + 1);
    expect(net.pathDistance(a, b, len)).toBe(Infinity);
    expect(net.pathDistance(a, a, 0)).toBe(0);
    net.unbuild(a.x + a.w + 3, 10);
    expect(net.pathDistance(a, b, 100)).toBe(Infinity);
  });
  it('flags disconnected buildings relative to road entry', () => {
    const { net, buildings } = mk();
    net.roadEntry = { x: 5, y: 63 };
    const b = buildings.add('cafe', 5, 58).building;
    expect(net.isConnected(b.id)).toBe(false);
    net.buildSegment(R, lineTiles({ x: 5, y: 63 }, { x: 5, y: 60 }));
    expect(net.isConnected(b.id)).toBe(true);
    net.unbuild(5, 62);
    expect(net.isConnected(b.id)).toBe(false);
    expect(net.disconnected([b.id])).toEqual([b.id]);
  });
  it('station active state updates live as paths are drawn/removed', () => {
    const { net, buildings } = mk();
    const lodge = buildings.add('baseLodge', 10, 10).building;
    const st = buildings.add('trainStation', lodge.x + lodge.w + 3, 14).building;
    expect(buildings.get(st.id)!.active).toBe(false); // real network: no path yet
    net.buildSegment(P, lineTiles({ x: lodge.x + lodge.w, y: 10 }, { x: st.x + 1, y: 13 }, true));
    const changed = buildings.reevaluate();
    expect(buildings.get(st.id)!.active).toBe(true);
    expect(changed).toContain(st.id);
    net.unbuild(lodge.x + lodge.w + 1, 13);
    expect(buildings.reevaluate()).toContain(st.id);
    expect(buildings.get(st.id)!.active).toBe(false);
  });
  it('roadConnected for depot/station via entry road', () => {
    const { net, buildings } = mk();
    net.roadEntry = { x: 20, y: 63 };
    const dep = buildings.add('shuttleDepot', 22, 58).building;
    const st = buildings.add('trainStation', 14, 58).building;
    expect(net.roadConnected(st, dep)).toBe(false);
    net.buildSegment(R, lineTiles({ x: 20, y: 63 }, { x: 20, y: 59 }));
    net.buildSegment(R, lineTiles({ x: 20, y: 59 }, { x: 21, y: 59 }));
    net.buildSegment(R, lineTiles({ x: 20, y: 61 }, { x: 18, y: 61 }));
    net.buildSegment(R, lineTiles({ x: 18, y: 61 }, { x: 18, y: 59 }));
    expect(net.roadConnected(st, dep)).toBe(true);
  });
  it('pistes: multiple layers per tile, auto difficulty with override', () => {
    const { net, grid } = mk();
    expect(difficultyFromSteepness(0)).toBe(0);
    expect(difficultyFromSteepness(3)).toBe(3);
    expect(net.paint(Layer.Ski, [{ x: 1, y: 1 }, { x: 2, y: 1 }]).difficulty).toBe(0);
    net.paint(Layer.Mtb, [{ x: 1, y: 1 }], 3);
    const i = grid.tileIndex(1, 1);
    expect(net.layers[i]).toBe(Layer.Ski | Layer.Mtb);
    expect(net.difficulty[i]).toBe(3);
    net.unpaint(Layer.Ski, 1, 1);
    expect(net.layers[i]).toBe(Layer.Mtb);
  });
  it('rail must start at railEntry and serve a station; runway checks flatness', () => {
    const { net, grid, buildings } = mk();
    net.railEntry = { x: 40, y: 63 };
    expect(net.canBuild(NetKind.Rail, 40, 60).ok).toBe(false);
    expect(net.buildSegment(NetKind.Rail, lineTiles({ x: 40, y: 63 }, { x: 40, y: 59 })).length).toBe(5);
    const st = buildings.add('trainStation', 41, 58).building;
    expect(net.isRailServed(st.id)).toBe(true);
    net.unbuild(40, 59);
    expect(net.isRailServed(st.id)).toBe(false);
    expect(checkRunway(grid, 2, 2, 8, 3).ok).toBe(true);
    grid.setCornerUnchecked(5, 3, 2);
    expect(checkRunway(grid, 2, 2, 8, 3).ok).toBe(false);
  });
  it('initial stubs connect entries toward the village', () => {
    const { net, buildings } = mk();
    const lodge = buildings.add('baseLodge', 28, 50).building;
    const r = net.placeInitialStubs({ x: 26, y: 63 }, { x: 38, y: 63 }, { x: 32, y: 53 }, lodge);
    expect(r.road).toBeGreaterThan(0);
    expect(r.rail).toBeGreaterThan(0);
    expect(net.isConnected(lodge.id)).toBe(true);
  });
});

import { generateTerrain } from '../../src/world/TerrainGen';
describe('initial stubs on generated terrain', () => {
  for (const size of [64, 128] as const) {
    it(`size ${size}: road stub reaches the village`, () => {
      const grid = new Grid(size);
      const info = generateTerrain(grid, 1337);
      const buildings = new Buildings(grid.occupancy);
      const lodge = buildings.add('baseLodge', info.villageAnchor.x - 2, info.villageAnchor.y - 2).building;
      const net = new Networks(grid, buildings);
      const r = net.placeInitialStubs(info.roadEntry, info.railEntry, info.villageAnchor, lodge);
      expect(r.road).toBeGreaterThan(0);
      expect(net.isConnected(lodge.id)).toBe(true);
    });
  }
});
