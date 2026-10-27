import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { LIFTS } from '../../src/config/lifts';
import { Grid, TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { Networks, NetKind, Layer } from '../../src/world/Networks';
import { Buildings } from '../../src/sim/Buildings';
import { Economy } from '../../src/sim/Economy';
import { validatePlacement, placeBuilding } from '../../src/build/PlacementTool';
import { describeRules, placementHints } from '../../src/sim/PlacementRules';
import { liftAccess } from '../../src/sim/Lift';

const mk = () => {
  const grid = new Grid(64);
  const buildings = new Buildings(grid.occupancy);
  const economy = new Economy({ money: 1e7 });
  const net = new Networks(grid, buildings);
  buildings.setNetwork({ pathDistance: net.pathDistance, roadConnected: net.roadConnected, access: net.access });
  return { grid, buildings, economy, net, env: { grid, buildings, economy } };
};

describe('catalog rule completeness', () => {
  const ids = Object.keys(BUILDINGS);
  it('has 31 entries incl. mountainHut', () => { expect(ids.length).toBeGreaterThanOrEqual(31); expect(ids).toContain('mountainHut'); });
  it.each(ids)('%s has complete rule fields', (id) => {
    const d = BUILDINGS[id]!;
    expect(['road', 'path', 'rail+path', 'pisteEdge', 'none']).toContain(d.access);
    expect(['forbid', 'allow', 'edge']).toContain(d.pisteRule);
    expect(['any', 'flat', 'gentleSlope']).toContain(d.site.slopeKind);
    expect(['default', 'optional', 'never']).toContain(d.site.autoFlatten);
    expect(['never', 'lakeEdge', 'shallow']).toContain(d.site.onWater);
    expect(typeof d.site.maxSlope).toBe('number');
    expect(describeRules(id).length).toBeGreaterThan(3);
    expect(placementHints(id)?.access).toBe(d.access);
  });
  it.each(Object.keys(LIFTS))('lift %s has rule fields', (k) => {
    const l = LIFTS[k as keyof typeof LIFTS];
    expect(l.bottomAccess).toBe('path');
    expect(l.topAccess).toBe('none');
    expect(l.stationPiste).toBe('allow');
  });
});

describe('access rule (never blocks, deactivates)', () => {
  it('road building without road: placeable with Not connected warning, inactive after add', () => {
    const { env, net, buildings } = mk();
    net.roadEntry = { x: 0, y: 20 };
    const r = validatePlacement(env, 'rental', 20, 20, 0);
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/Needs a road next to it/);
    const { building } = buildings.add('rental', 20, 20);
    expect(building.active).toBe(false);
    expect(building.reason).toMatch(/^Needs a road/);
    for (let x = 0; x < 20; x++) net.build(NetKind.Road, x, 20);
    expect(buildings.reevaluate()).toContain(building.id);
    expect(building.active).toBe(true);
  });
  it('path building: a footpath linked to the road is enough; a lone path is not', () => {
    const { env, net } = mk();
    net.roadEntry = { x: 0, y: 19 };
    net.build(NetKind.Path, 20, 19);
    expect(validatePlacement(env, 'cafe', 20, 20, 0).warnings.join()).toMatch(/footpath/);
    for (let x = 0; x <= 19; x++) net.build(NetKind.Road, x, 19);
    expect(validatePlacement(env, 'cafe', 20, 20, 0).warnings).toEqual([]);
    // a road-only type next to just a path (no road) still warns
    expect(validatePlacement(env, 'rental', 20, 20, 0).warnings.join()).toMatch(/a road/);
  });
  it('remote types (none) never warn', () => {
    const { env, net } = mk();
    net.roadEntry = { x: 0, y: 20 };
    for (const id of ['firstAid', 'snowcatOutpost', 'snowCannon', 'warningSign', 'helipad', 'reservoir']) {
      expect(BUILDINGS[id]!.access).toBe('none');
      expect(validatePlacement(env, id, 30, 30, 0).warnings.filter((w) => /^Needs a /.test(w)), id).toEqual([]);
    }
  });
  it('rail+path: needs both', () => {
    const { env, net } = mk();
    net.roadEntry = { x: 0, y: 30 };
    net.railEntry = { x: 0, y: 28 };
    expect(validatePlacement(env, 'trainStation', 20, 30, 0).warnings.join()).toMatch(/a rail line and a footpath/);
  });
  it('shop / chalet / apartment accept a footpath (or road); rental stays road-only', () => {
    const { env, net } = mk();
    net.roadEntry = { x: 0, y: 19 };
    for (let x = 0; x <= 19; x++) net.build(NetKind.Road, x, 19);
    net.build(NetKind.Path, 20, 19);
    for (const id of ['shop', 'chalet', 'apartment']) {
      expect(BUILDINGS[id]!.access).toBe('path');
      expect(validatePlacement(env, id, 20, 20, 0).warnings, id).toEqual([]);
    }
    expect(validatePlacement(env, 'rental', 20, 20, 0).warnings.join()).toMatch(/a road/);
    expect(validatePlacement(env, 'shop', 30, 30, 0).warnings.join()).toMatch(/footpath or road next to it/);
  });
  it('café and stunt park accept a piste edge', () => {
    const { env, net } = mk();
    net.paint(Layer.Ski, [{ x: 22, y: 20 }]);
    expect(validatePlacement(env, 'cafe', 20, 20, 0).warnings).toEqual([]);
    expect(validatePlacement(env, 'stuntPark', 16, 20, 0).warnings).toEqual([]);
  });
  it('Train Station may stand on the end of a rail line (rail kept, counted as connected, undoable by removal)', () => {
    const { env, net, buildings, grid } = mk();
    net.roadEntry = { x: 0, y: 40 };
    net.railEntry = { x: 0, y: 30 };
    for (let x = 0; x <= 21; x++) net.build(NetKind.Rail, x, 30);
    net.build(NetKind.Path, 20, 32); // footpath next to a 4x2 station at (18..21, 30..31)
    for (let x = 0; x <= 20; x++) net.build(NetKind.Path, x, 33);
    const v = validatePlacement(env, 'trainStation', 18, 30, 0);
    expect(v.reasons).not.toContain('Cannot build on a road, path or rail');
    expect(v.ok).toBe(true);
    // a footpath tile inside the footprint is still refused
    net.build(NetKind.Path, 19, 31);
    expect(validatePlacement(env, 'trainStation', 18, 30, 0).reasons).toContain('Cannot build on a road, path or rail');
    net.unbuild(19, 31);
    const r = placeBuilding(env, undefined, 'trainStation', 18, 30, 0);
    expect(r.ok).toBe(true);
    expect(net.kindAt(18, 30)).toBe(NetKind.Rail);
    expect(net.isRailServed(r.building!.id)).toBe(true);
    expect(grid.occupancy.has(18, 30, OccFlag.Building)).toBe(true);
    buildings.remove(r.building!.id);
    expect(net.kindAt(18, 30)).toBe(NetKind.Rail);
    expect(grid.occupancy.has(18, 30, OccFlag.Road)).toBe(true);
    expect(grid.occupancy.has(18, 30, OccFlag.Building)).toBe(false);
  });
  it('Train Station without access shows the placement tip', () => {
    const { env, net } = mk();
    net.railEntry = { x: 0, y: 30 };
    expect(validatePlacement(env, 'trainStation', 20, 40, 0).info.join()).toMatch(/end of a rail line, with a footpath next to it/);
  });
  it('Mountain Hut: piste neighbour OR path satisfies access', () => {
    const { env, net } = mk();
    expect(validatePlacement(env, 'mountainHut', 20, 20, 0).warnings.join()).toMatch(/footpath, road or piste next to it/);
    net.paint(Layer.Ski, [{ x: 22, y: 20 }]);
    expect(validatePlacement(env, 'mountainHut', 20, 20, 0).warnings).toEqual([]);
  });
});

describe('piste rule', () => {
  it('forbids ordinary buildings on piste, allows carpet/cannon/sign/stunt park', () => {
    const { env, net } = mk();
    net.paint(Layer.Ski, [{ x: 20, y: 20 }, { x: 21, y: 20 }, { x: 20, y: 21 }, { x: 21, y: 21 }]);
    expect(validatePlacement(env, 'cafe', 20, 20, 0).reasons).toContain('Cannot build on a piste');
    expect(validatePlacement(env, 'mountainHut', 20, 20, 0).reasons).toContain('Cannot build on a piste');
    expect(validatePlacement(env, 'firstAid', 20, 20, 0).reasons).toContain('Cannot build on a piste');
    expect(validatePlacement(env, 'snowCannon', 20, 20, 0).reasons).not.toContain('Cannot build on a piste');
    expect(validatePlacement(env, 'warningSign', 20, 20, 0).reasons).not.toContain('Cannot build on a piste');
    expect(validatePlacement(env, 'stuntPark', 20, 20, 0).reasons).not.toContain('Cannot build on a piste');
  });
  it('piste painting is blocked over normal buildings but allowed over pisteRule=allow buildings', () => {
    const { net, buildings } = mk();
    buildings.add('cafe', 10, 10);
    buildings.add('warningSign', 30, 30);
    expect(net.canPaint(10, 10).ok).toBe(false);
    expect(net.canPaint(30, 30).ok).toBe(true);
  });
  it('Hut edge rule: beside a piste is fine', () => {
    const { env, net } = mk();
    net.paint(Layer.Ski, [{ x: 19, y: 20 }]);
    expect(validatePlacement(env, 'firstAid', 20, 20, 0).reasons).not.toContain('Cannot build on a piste');
  });
});

describe('site rule', () => {
  const slope = (grid: Grid) => { for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) grid.setCornerUnchecked(vx, vy, Math.floor(vx / 2)); };
  it('cannon and sign accept any slope and never flatten', () => {
    const { env, grid } = mk();
    for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) grid.setCornerUnchecked(vx, vy, vx % 2 ? 2 : 0);
    for (const id of ['snowCannon', 'warningSign']) {
      const r = validatePlacement(env, id, 20, 20, 0, true);
      expect(r.reasons, id).not.toContain('Too steep');
      expect(r.flatten, id).toBe(false);
    }
  });
  it('ordinary buildings: too steep without flatten, ok with flatten, and the flatten cost is previewed', () => {
    const { env, grid } = mk();
    grid.setCornerUnchecked(21, 21, 2);
    expect(validatePlacement(env, 'chalet', 20, 20, 0).reasons).toContain('Too steep');
    const r = validatePlacement(env, 'chalet', 20, 20, 0, true);
    expect(r.ok).toBe(true);
    expect(r.flattenCost).toBeGreaterThan(0);
  });
  it('flatten refused when unaffordable', () => {
    const { env, grid, economy } = mk();
    grid.setCornerUnchecked(21, 21, 2);
    (economy as unknown as { state: { money: number } }).state.money = BUILDINGS.chalet!.cost + 1;
    expect(validatePlacement(env, 'chalet', 20, 20, 0, true).reasons.join()).toMatch(/funds/);
  });
  it('Magic Carpet needs a gentle slope: flat and steep rejected, gentle accepted, never flattened', () => {
    const { env, grid } = mk();
    // carpet is 1x6 (rot 0): runs along y
    const flat = validatePlacement(env, 'magicCarpet', 20, 20, 0, true);
    expect(flat.reasons).toContain('Needs a gentle, uniform slope');
    expect(flat.flatten).toBe(false);
    for (let vy = 20; vy <= 26; vy++) for (const vx of [20, 21]) grid.setCornerUnchecked(vx, vy, Math.floor((vy - 20) / 2));
    const ok = validatePlacement(env, 'magicCarpet', 20, 20, 0, true);
    expect(ok.reasons.filter((r) => /slope|steep/i.test(r))).toEqual([]);
    expect(ok.flatten).toBe(false);
    slope(grid); // cross-slope along x only → carpet is 1 wide, spread along its axis is 0
    expect(validatePlacement(env, 'magicCarpet', 20, 20, 0).reasons).toContain('Needs a gentle, uniform slope');
  });
  it('Beach/Boat Rental need a lake shore', () => {
    const { env, grid, buildings } = mk();
    expect(validatePlacement(env, 'beach', 20, 20, 0).reasons).toContain('Must be next to a lake');
    grid.tileType[grid.tileIndex(24, 20)] = TileType.Water;
    grid.occupancy.set(24, 20, OccFlag.Water);
    buildings.lakeTiles = [{ x: 24, y: 20 }];
    expect(validatePlacement(env, 'beach', 20, 20, 0).ok).toBe(true);
  });
  it('rock tiles are refused except for huts/cannons', () => {
    const { env, grid } = mk();
    grid.tileType[grid.tileIndex(20, 20)] = TileType.Rock;
    expect(validatePlacement(env, 'chalet', 20, 20, 0).reasons).toContain('Cannot build on bare rock');
    expect(validatePlacement(env, 'snowCannon', 20, 20, 0).reasons).not.toContain('Cannot build on bare rock');
  });
});

describe('cross checks', () => {
  it('streams, roads/paths, rail, lift corridors and the map edge block', () => {
    const { env, grid, net } = mk();
    grid.tileType[grid.tileIndex(20, 20)] = TileType.Stream;
    grid.occupancy.set(20, 20, OccFlag.Water);
    expect(validatePlacement(env, 'cafe', 20, 20, 0).reasons).toContain('Cannot build on a stream');
    net.roadEntry = { x: 30, y: 30 };
    net.build(NetKind.Road, 30, 30);
    net.build(NetKind.Path, 40, 40);
    expect(validatePlacement(env, 'cafe', 30, 30, 0).reasons).toContain('Cannot build on a road, path or rail');
    expect(validatePlacement(env, 'cafe', 40, 40, 0).reasons).toContain('Cannot build on a road, path or rail');
    grid.occupancy.set(50, 50, OccFlag.Lift, 7);
    expect(validatePlacement(env, 'cafe', 50, 50, 0).reasons).toContain('Blocked by a lift line');
    expect(validatePlacement(env, 'cafe', 0, 5, 0).reasons).toContain('Too close to the map edge');
    expect(validatePlacement(env, 'cafe', 62, 5, 0).reasons).toContain('Too close to the map edge');
  });
  it('maxCount: one Base Lodge', () => {
    const { env, buildings } = mk();
    buildings.add('baseLodge', 10, 10);
    expect(validatePlacement(env, 'baseLodge', 30, 30, 0).reasons).toContain('Only one Base Lodge allowed');
  });
  it('lists ALL failing rules at once', () => {
    const { env, grid, buildings } = mk();
    grid.tileType[grid.tileIndex(1, 1)] = TileType.Rock;
    buildings.add('cafe', 1, 1);
    const r = validatePlacement(env, 'magicCarpet', 1, 1, 0);
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
    expect(r.reasons).toEqual(expect.arrayContaining(['Tile occupied', 'Cannot build on bare rock']));
  });
  it('Snow cannon needs a Reservoir within pipe range', () => {
    const { env, buildings } = mk();
    buildings.add('reservoir', 2, 2);
    expect(validatePlacement(env, 'snowCannon', 10, 10, 0).reasons).not.toContain('Needs Reservoir or Lake');
    expect(validatePlacement(env, 'snowCannon', 60, 60, 0).reasons).toContain('Needs Reservoir or Lake');
  });
  it('flatten tolerates footpaths in the ring but not neighbouring buildings', () => {
    const { env, grid, net, buildings } = mk();
    grid.setCornerUnchecked(20, 23, 2);
    net.build(NetKind.Path, 19, 21);
    const r = validatePlacement(env, 'chalet', 20, 20, 0, true);
    expect(r.ok).toBe(true);
    buildings.add('shop', 19, 23);
    expect(validatePlacement(env, 'chalet', 20, 20, 0, true).reasons.join()).toMatch(/Cannot flatten|Too steep/);
  });
  it('placeBuilding with flatten reports touched chunks', () => {
    const { env, grid } = mk();
    grid.setCornerUnchecked(21, 21, 2);
    const out = placeBuilding(env, undefined, 'chalet', 20, 20, 0, true);
    expect(out.ok).toBe(true);
    expect(out.touchedChunks.length).toBeGreaterThan(0);
  });
});

describe('lift access', () => {
  it('bottom needs footpath; top never', () => {
    const { net, grid } = mk();
    net.roadEntry = { x: 0, y: 20 };
    const b = { x: 10, y: 20 }, t = { x: 40, y: 40 };
    expect(liftAccess(net.access, 'chair4', b, t).join()).toMatch(/bottom station needs footpath/);
    for (let x = 0; x < 10; x++) net.build(NetKind.Path, x, 20);
    expect(liftAccess(net.access, 'chair4', b, t)).toEqual([]);
    expect(liftAccess(undefined, 'gondola6', b, t)).toEqual([]);
    void grid;
  });
});

describe('describeRules / placementHints', () => {
  it('produce readable lines', () => {
    expect(describeRules('snowCannon')).toEqual(expect.arrayContaining(['Any slope', 'Never changes terrain', 'May be built on a piste']));
    expect(describeRules('rental')).toEqual(expect.arrayContaining(['Needs road access', 'Auto-flatten on by default']));
    expect(describeRules('mountainHut').join()).toMatch(/piste/);
    expect(placementHints('cafe')).toMatchObject({ access: 'path', pisteRule: 'forbid' });
    expect(placementHints('nope')).toBeNull();
  });
});
