/** One source of truth for 'Not connected' (PlacementRules access rule + Networks.accessProblem): remote types never warn, others name their real requirement. */
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { Grid } from '../../src/world/Grid';
import { Networks, NetKind, lineTiles } from '../../src/world/Networks';
import { Buildings } from '../../src/sim/Buildings';
import { networkProviderFrom } from '../../src/build/NetworkAdapter';
import { accessReason } from '../../src/sim/PlacementRules';

const mk = () => {
  const grid = new Grid(64);
  const buildings = new Buildings(grid.occupancy);
  const net = new Networks(grid, buildings);
  buildings.setNetwork({ pathDistance: net.pathDistance, roadConnected: net.roadConnected, access: net.access });
  net.roadEntry = { x: 0, y: 40 };
  net.railEntry = { x: 0, y: 44 };
  return { grid, buildings, net };
};
const linkByRoad = (net: Networks): void => { net.buildSegment(NetKind.Road, lineTiles({ x: 0, y: 40 }, { x: 29, y: 40 })); net.buildSegment(NetKind.Road, lineTiles({ x: 29, y: 40 }, { x: 29, y: 20 })); };
const ids = Object.keys(BUILDINGS);
const remote = ids.filter((id) => BUILDINGS[id]!.access === 'none');
const road = ids.filter((id) => BUILDINGS[id]!.access === 'road');
const path = ids.filter((id) => BUILDINGS[id]!.access === 'path');

describe('remote types (access none) never show a not-connected warning', () => {
  it('the catalog really has remote types (outpost, first aid, cannon, sign, helipad, reservoir)', () => {
    for (const t of ['snowcatOutpost', 'firstAid', 'snowCannon', 'warningSign', 'helipad', 'reservoir']) expect(remote, t).toContain(t);
  });
  it.each(remote)('%s: isolated in the middle of nowhere: no access problem, inactivity (if any) is never about access', (t) => {
    const { buildings, net } = mk();
    const { building } = buildings.add(t, 30, 20);
    expect(net.accessProblem(building.id)).toBeNull();
    expect(networkProviderFrom(net).isConnectedBuilding(building.id)).toBe(true);
    expect(building.reason ?? '').not.toMatch(/not connected/i);
    expect(accessReason(BUILDINGS[t]!)).toBe('');
  });
});

describe('road and path types warn only when truly unserved, with their own requirement', () => {
  it.each(road)('%s needs a road: isolated → "needs a road"; a road fixes it; a lone footpath does not', (t) => {
    const { buildings, net } = mk();
    const { building: b } = buildings.add(t, 30, 20);
    if (BUILDINGS[t]!.altAccess?.includes('path')) {
      expect(net.accessProblem(b.id)).toMatch(/^Needs a (road or footpath|footpath or road) next to it$/);
      return;
    }
    expect(net.accessProblem(b.id)).toBe('Needs a road next to it');
    net.buildSegment(NetKind.Path, lineTiles({ x: 0, y: 19 }, { x: 40, y: 19 })); // a lone footpath touching the building, not linked to the road entry
    expect(net.accessProblem(b.id)).not.toBeNull();
    buildings.reevaluate();
    expect(b.active).toBe(false);
    expect(b.reason).toBe('Needs a road next to it');
    linkByRoad(net);
    expect(net.accessProblem(b.id)).toBeNull();
    buildings.reevaluate();
    expect(b.reason ?? '').not.toMatch(/not connected/i); // (shuttle types may still wait for a depot: not an access matter)
  });
  it.each(path)('%s needs a footpath (a road also counts): "needs a footpath or road"', (t) => {
    const { buildings, net } = mk();
    const { building: b } = buildings.add(t, 30, 20);
    const p = net.accessProblem(b.id);
    expect(p).toMatch(/^Needs a footpath, road( or piste)? next to it|^Needs a (footpath or road|road or footpath) next to it/);
    expect(p).not.toMatch(/road entry/);
    linkByRoad(net);
    expect(net.accessProblem(b.id)).toBeNull();
  });
  it('the connectivity overlay provider agrees with the access rule, not with raw road connectivity', () => {
    const { buildings, net } = mk();
    const out = buildings.add('snowcatOutpost', 10, 10).building;
    const shop = buildings.add('shop', 30, 20).building;
    const p = networkProviderFrom(net);
    expect(p.isConnectedBuilding(out.id)).toBe(true);
    expect(net.isConnected(out.id)).toBe(false); // the raw walk network says no: it is the wrong question for a remote type
    expect(p.isConnectedBuilding(shop.id)).toBe(false);
  });
});
