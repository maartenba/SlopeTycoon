/** One verdict: Buildings.active/reason, Networks.accessProblem, the inspector text and attraction open state never disagree (mountain hut regression). */
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { Grid } from '../../src/world/Grid';
import { Layer, Networks, NetKind, lineTiles } from '../../src/world/Networks';
import { Buildings } from '../../src/sim/Buildings';
import { accessReason, isAccessReason } from '../../src/sim/PlacementRules';
import { harness } from './attractions/harness';

const mk = () => {
  const grid = new Grid(64);
  const buildings = new Buildings(grid.occupancy);
  const net = new Networks(grid, buildings);
  buildings.setNetwork({ pathDistance: net.pathDistance, roadConnected: net.roadConnected, access: net.access });
  net.roadEntry = { x: 0, y: 40 };
  net.railEntry = { x: 0, y: 44 };
  return { grid, buildings, net };
};
const pisteTiles = lineTiles({ x: 33, y: 10 }, { x: 33, y: 30 });
const NEEDS = 'Needs a footpath, road or piste next to it';

describe('accessReason wording (generated from the rule)', () => {
  it('lists every real option, sentence case, no "Not connected" prefix', () => {
    expect(accessReason(BUILDINGS.mountainHut!)).toBe(NEEDS);
    expect(accessReason(BUILDINGS.magicCarpet!)).toBe(NEEDS);
    expect(accessReason(BUILDINGS.apresBar!)).toBe('Needs a road or footpath next to it');
    expect(accessReason(BUILDINGS.alpineFarm!)).toBe('Needs a footpath or road next to it');
  });
  it('every building with access has an access-reason that isAccessReason recognises', () => {
    for (const [id, d] of Object.entries(BUILDINGS)) {
      const r = accessReason(d);
      if (d.access === 'none') { expect(r, id).toBe(''); continue; }
      expect(isAccessReason(r), `${id}: ${r}`).toBe(true);
      expect(r, id).not.toMatch(/not connected|^needs/);
    }
    expect(accessReason(BUILDINGS.trainStation ?? BUILDINGS.baseLodge!)).toMatch(/^Needs a /);
  });
});

describe('mountain hut: status, reason and access verdict always agree', () => {
  const agree = (buildings: Buildings, net: Networks, id: number): void => {
    const b = buildings.get(id)!, p = net.accessProblem(id);
    expect(b.active, `active=${b.active} reason=${b.reason} problem=${p}`).toBe(p === null);
    expect(b.reason ?? null).toBe(p);
  };
  it('beside a piste (no path) is active; erasing the piste makes it inactive with the same text; a path or undo fixes it', () => {
    const { buildings, net } = mk();
    net.paint(Layer.Ski, pisteTiles);
    const { building: h } = buildings.add('mountainHut', 34, 18);
    buildings.reevaluate();
    agree(buildings, net, h.id);
    expect(h.active).toBe(true);
    net.beginJournal();
    for (const t of pisteTiles) net.unpaint(Layer.Ski, t.x, t.y);
    const diff = net.endJournal();
    buildings.reevaluate();
    agree(buildings, net, h.id);
    expect(h.active).toBe(false);
    expect(h.reason).toBe(NEEDS);
    net.restore(diff); // undo
    buildings.reevaluate();
    agree(buildings, net, h.id);
    expect(h.active).toBe(true);
    for (const t of pisteTiles) net.unpaint(Layer.Ski, t.x, t.y);
    net.buildSegment(NetKind.Road, lineTiles({ x: 0, y: 40 }, { x: 29, y: 40 }));
    net.buildSegment(NetKind.Road, lineTiles({ x: 29, y: 40 }, { x: 29, y: 19 }));
    const built = net.buildSegment(NetKind.Path, lineTiles({ x: 30, y: 19 }, { x: 33, y: 19 }));
    expect(built.length).toBeGreaterThan(0);
    buildings.reevaluate();
    agree(buildings, net, h.id);
    expect(h.active).toBe(true); // a footpath alone is enough
  });
  it('a loaded save never trusts the stored status (stale active flag is re-derived)', () => {
    const { buildings, net } = mk();
    const data = [{ id: 7, type: 'mountainHut', x: 34, y: 18, rot: 0, w: 2, h: 2, active: true }];
    buildings.restore(data as never, 8);
    buildings.reevaluate();
    agree(buildings, net, 7);
    expect(buildings.get(7)!.active).toBe(false);
  });
});

describe('attraction open state is live, not cached from the last tick', () => {
  it('refreshOpen reflects a status change immediately (paused game / just painted piste)', () => {
    const h = harness();
    const b = h.add('iceRink');
    b.active = false; b.reason = NEEDS;
    h.run(1);
    expect(h.sys.get(b.id)!.info().open).toBe(false);
    b.active = true; b.reason = undefined; // network changed, no sim tick yet
    expect(h.sys.get(b.id)!.info().open).toBe(false); // cached...
    expect(h.sys.refreshOpen(b.id)!.info().open).toBe(true); // ...but the inspector path refreshes first
    b.active = false; b.reason = NEEDS;
    expect(h.sys.refreshOpen(b.id)!.info().reason).toBe(`Inactive: ${NEEDS}`);
  });
});
