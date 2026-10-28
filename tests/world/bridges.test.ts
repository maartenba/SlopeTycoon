import { describe, expect, it } from 'vitest';
import { Grid, TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { Buildings } from '../../src/sim/Buildings';
import { Layer, NetKind, Networks, ROAD_START_MSG, TRAIL_ORPHAN_MSG } from '../../src/world/Networks';
import { bridgeSupports, planBridge } from '../../src/world/Bridges';
import { BRIDGES, BRIDGE_KINDS, BRIDGE_MSG, type BridgeKind } from '../../src/config/bridges';

/** Flat 64 world, a vertical stream of `width` water tiles at x = 20.., with a footpath / road / trail landing on the west bank (19, 30). */
const world = (width = 1, type: number = TileType.Stream) => {
  const grid = new Grid(64);
  const net = new Networks(grid, new Buildings(grid.occupancy));
  for (let y = 10; y < 50; y++) for (let x = 20; x < 20 + width; x++) { grid.tileType[grid.tileIndex(x, y)] = type; grid.occupancy.set(x, y, OccFlag.Water); }
  net.build(NetKind.Path, 18, 30); // anchors paths / trails on the west bank
  net.roadEntry = { x: 19, y: 30 }; // anchors roads
  return { grid, net };
};
const A = { x: 19, y: 30 };
const Bk = (width: number) => ({ x: 20 + width, y: 30 });

describe('planBridge: each kind places within its limits and fails with the right reason beyond', () => {
  for (const kind of BRIDGE_KINDS) {
    const spec = BRIDGES[kind];
    it(`${kind}: spans 1..${spec.maxSpan} are fine and priced, ${spec.maxSpan + 1} is too long`, () => {
      for (let w = 1; w <= spec.maxSpan; w++) {
        const { grid, net } = world(w);
        const p = planBridge(net, grid, kind, A, Bk(w));
        expect(p.reason, `${kind} span ${w}`).toBeUndefined();
        expect(p.ok).toBe(true);
        expect(p.span.length).toBe(w);
        expect(p.spanCost).toBe(w * spec.costPerTile);
        expect(p.deck).toBe(spec.clearance); // flat world: the deck floats `clearance` half-steps over the water
        expect(p.supports).toEqual(bridgeSupports(w));
      }
      const { grid, net } = world(spec.maxSpan + 1);
      expect(planBridge(net, grid, kind, A, Bk(spec.maxSpan + 1))).toMatchObject({ ok: false, reason: BRIDGE_MSG.tooLong(spec.maxSpan) });
    });
  }
  it('the config rows are the planned ones', () => {
    expect(BRIDGES.footbridge).toMatchObject({ layer: 'path', maxSpan: 4, costPerTile: 150, clearance: 1 });
    expect(BRIDGES.hikeBridge).toMatchObject({ layer: 'hike', maxSpan: 4, costPerTile: 120, clearance: 1 });
    expect(BRIDGES.mtbBridge).toMatchObject({ layer: 'mtb', maxSpan: 4, costPerTile: 140, clearance: 1 });
    expect(BRIDGES.roadBridge).toMatchObject({ layer: 'road', maxSpan: 3, costPerTile: 600, clearance: 2 });
  });
  it('supports: every second span tile and always the last', () => {
    expect([1, 2, 3, 4, 5].map((n) => bridgeSupports(n))).toEqual([[0], [0, 1], [0, 2], [0, 2, 3], [0, 2, 4]]);
  });
  it('cost adds the new bank tiles as ordinary path tiles (x multiplier)', () => {
    const { grid, net } = world(2);
    const p = planBridge(net, grid, 'footbridge', A, Bk(2), 2);
    expect(p.newBanks).toEqual([A, Bk(2)]);
    expect(p.cost).toBe(2 * 2 * 150 + 2 * 20 * 2); // span + two bank tiles, all x2
  });
  it('rail stays refused: planBridge("rail") and the rail network itself', () => {
    const { grid, net } = world(1);
    expect(planBridge(net, grid, 'rail', A, Bk(1))).toMatchObject({ ok: false, reason: 'Rail cannot cross water' });
    net.railEntry = { x: 19, y: 20 }; net.kind[20 * 64 + 19] = NetKind.Rail; grid.occupancy.set(19, 20, OccFlag.Road);
    expect(net.canBuild(NetKind.Rail, 20, 20)).toMatchObject({ ok: false });
    const lake = world(2, TileType.Water);
    lake.net.kind[25 * 64 + 19] = NetKind.Rail; lake.net.railEntry = { x: 19, y: 25 };
    expect(lake.net.canBuild(NetKind.Rail, 20, 25)).toMatchObject({ ok: false, reason: 'Water' });
  });
});

describe('planBridge: reasons', () => {
  const kind: BridgeKind = 'footbridge';
  it('not straight / nothing to bridge / banks in the water / blocked / unanchored', () => {
    const { grid, net } = world(1);
    expect(planBridge(net, grid, kind, A, { x: 21, y: 31 }).reason).toBe(BRIDGE_MSG.straight);
    expect(planBridge(net, grid, kind, A, { x: 20, y: 30 }).reason).toBe(BRIDGE_MSG.nothing); // adjacent banks: no span
    expect(planBridge(net, grid, kind, { x: 30, y: 30 }, { x: 32, y: 30 }).reason).toBe(BRIDGE_MSG.nothing); // dry land
    expect(planBridge(net, grid, kind, { x: 20, y: 30 }, { x: 22, y: 30 }).reason).toBe(BRIDGE_MSG.ends); // a bank tile is water
    net.build(NetKind.Path, 20, 20); // something under the span
    expect(planBridge(net, grid, kind, { x: 19, y: 20 }, { x: 21, y: 20 }).reason).toBe(BRIDGE_MSG.blocked);
    const far = planBridge(net, grid, kind, { x: 19, y: 40 }, { x: 21, y: 40 });
    expect(far.reason).toBe('Paths must connect to a path, road or building');
  });
  it('a span tile of dry ground that is only a slope is not a gap', () => {
    const { grid, net } = world(1);
    grid.tileType[grid.tileIndex(21, 30)] = TileType.Grass; grid.occupancy.clear(21, 30, OccFlag.Water);
    // water (20,30) then dry (21,30) at bank height: a mixed span with a dry flat tile
    expect(planBridge(net, grid, kind, A, { x: 22, y: 30 }).reason).toBe(BRIDGE_MSG.notGap);
  });
  it('a real gap (a depression between two higher banks) is bridgeable; the deck sits at the higher bank', () => {
    const { grid, net } = world(1);
    for (let y = 10; y < 50; y++) { grid.tileType[grid.tileIndex(20, y)] = TileType.Grass; grid.occupancy.clear(20, y, OccFlag.Water); }
    // flat banks at height 6 (tiles 19 and 23), a pit of height 0 between them (tiles 20..22)
    for (let vy = 30; vy <= 31; vy++) [6, 6, 0, 0, 6, 6].forEach((h, k) => grid.setCornerUnchecked(19 + k, vy, h));
    const p = planBridge(net, grid, kind, A, { x: 23, y: 30 });
    expect(p.reason).toBeUndefined();
    expect(p.deck).toBe(6); // the deck rests on the banks (no water: no clearance)
    expect(p.rise).toBe(0);
    // a plain slope is not a gap
    for (let vy = 30; vy <= 31; vy++) [6, 6, 5, 4, 3, 3].forEach((h, k) => grid.setCornerUnchecked(19 + k, vy, h));
    expect(planBridge(net, grid, kind, A, { x: 23, y: 30 }).reason).toBe(BRIDGE_MSG.nothing);
  });
  it('banks lower than the water clearance needs: Too low over the water', () => {
    const { grid, net } = world(3);
    for (let vy = 30; vy <= 31; vy++) for (const vx of [21, 22]) grid.setCornerUnchecked(vx, vy, 6); // the middle water tile stands well above both (flat) banks
    expect(planBridge(net, grid, kind, A, Bk(3)).reason).toBe(BRIDGE_MSG.low);
  });
  it('road bridges need flat banks and a road link', () => {
    const { grid, net } = world(1);
    expect(planBridge(net, grid, 'roadBridge', A, Bk(1)).ok).toBe(true);
    grid.setCornerUnchecked(21, 30, 1); grid.setCornerUnchecked(22, 30, 0); grid.setCornerUnchecked(21, 31, 0); grid.setCornerUnchecked(22, 31, 0); // east bank tile (21,30): spread 1 is fine
    expect(planBridge(net, grid, 'roadBridge', A, Bk(1)).ok).toBe(true);
    grid.setCornerUnchecked(21, 30, 2);
    expect(planBridge(net, grid, 'roadBridge', A, Bk(1)).reason).toBe(BRIDGE_MSG.flatEnds);
    const off = world(1); off.net.roadEntry = { x: 5, y: 5 };
    expect(planBridge(off.net, off.grid, 'roadBridge', A, Bk(1)).reason).toBe(ROAD_START_MSG);
  });
  it('trail bridges: banks must not be water and need a path or trail to attach to', () => {
    const { grid, net } = world(2);
    expect(planBridge(net, grid, 'hikeBridge', A, Bk(2)).ok).toBe(true);
    expect(planBridge(net, grid, 'mtbBridge', A, Bk(2)).ok).toBe(true);
    const far = planBridge(net, grid, 'hikeBridge', { x: 19, y: 45 }, { x: 22, y: 45 });
    expect(far.reason).toBe(TRAIL_ORPHAN_MSG);
  });
});

describe('building, bulldozing and the data', () => {
  it('a footbridge: span tiles are footpath + bridge flag + id; the banks join; the network stays connected', () => {
    const { grid, net } = world(2);
    const plan = planBridge(net, grid, 'footbridge', A, Bk(2));
    const b = net.buildBridge(plan)!;
    expect(b.kind).toBe('footbridge');
    expect(net.bridgeTiles).toBe(2);
    for (const t of b.span) { expect(net.kindAt(t.x, t.y)).toBe(NetKind.Path); expect(net.bridge[net.idxOf(t.x, t.y)]).toBe(1); expect(net.bridgeAt(t.x, t.y)!.id).toBe(b.id); }
    expect(net.kindAt(A.x, A.y)).toBe(NetKind.Path);
    expect(net.pathDistance(A, Bk(2), 10)).toBeLessThan(Infinity);
    expect(net.liveBridges().map((x) => x.id)).toEqual([b.id]);
  });
  it('bulldozing any span tile removes the whole bridge and leaves the banks; undo (journal restore) brings it back', () => {
    const { grid, net } = world(3);
    const b = net.buildBridge(planBridge(net, grid, 'footbridge', A, Bk(3)))!;
    net.beginJournal();
    expect(net.unbuild(b.span[1]!.x, b.span[1]!.y)).toBe(NetKind.Path);
    const diff = net.endJournal();
    expect(net.bridgeTiles).toBe(0);
    for (const t of b.span) { expect(net.kindAt(t.x, t.y)).toBe(0); expect(net.bridge[net.idxOf(t.x, t.y)]).toBe(0); }
    expect(net.kindAt(A.x, A.y)).toBe(NetKind.Path); // banks stay
    expect(net.liveBridges()).toEqual([]);
    net.restore(diff);
    expect(net.bridgeTiles).toBe(3);
    expect(net.liveBridges().map((x) => x.id)).toEqual([b.id]);
    expect(net.kindAt(b.span[2]!.x, b.span[2]!.y)).toBe(NetKind.Path);
  });
  it('trail bridges paint the layer on the span (also on lake tiles) and bulldoze whole through the layer', () => {
    const { grid, net } = world(2, TileType.Water);
    const b = net.buildBridge(planBridge(net, grid, 'hikeBridge', A, Bk(2)))!;
    for (const t of b.span) { expect(net.layers[net.idxOf(t.x, t.y)]! & Layer.Hike).toBeTruthy(); expect(net.kindAt(t.x, t.y)).toBe(0); }
    expect(net.clearLayers(b.span[0]!.x, b.span[0]!.y)).toBe(true);
    for (const t of b.span) expect(net.layers[net.idxOf(t.x, t.y)]).toBe(0);
    expect(net.bridgeTiles).toBe(0);
  });
  it('deckY: flat over the span, ramping on the banks, null elsewhere', () => {
    const { grid, net } = world(2);
    const b = net.buildBridge(planBridge(net, grid, 'footbridge', A, Bk(2)))!;
    const L = b.deck * 0.5;
    expect(net.deckY(20.5, 30.5)).toBeCloseTo(L, 6);
    expect(net.deckY(21.5, 30.5)).toBeCloseTo(L, 6);
    expect(net.deckY(19.5, 30.5)).toBeCloseTo(0, 6); // bank centre: ground level
    expect(net.deckY(19.75, 30.5)!).toBeGreaterThan(0); expect(net.deckY(19.75, 30.5)!).toBeLessThan(L);
    expect(net.deckY(10.5, 30.5)).toBeNull();
    expect(net.deckY(19.2, 30.5)).toBeNull(); // the far half of the bank tile stays on the ground
  });
});
