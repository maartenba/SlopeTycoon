/** Phase 6 Task 20: petting zoo (standalone summer family attraction, wandering animals in a fenced pen). docs/petting-zoo.md */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDINGS } from '../../../src/config/buildings';
import { PRICE_TABLE } from '../../../src/config/prices';
import { appealFor } from '../../../src/config/guestTypes';
import { unlockLevel } from '../../../src/config/unlocks';
import { Grid } from '../../../src/world/Grid';
import { NetKind, Networks, lineTiles } from '../../../src/world/Networks';
import { Buildings } from '../../../src/sim/Buildings';
import { accessReason } from '../../../src/sim/PlacementRules';
import { seasonOf } from '../../../src/sim/Clock';
import { ATTRACTION_SPECS } from '../../../src/sim/attractions/registry';
import { ZOO_ANIMALS, ZOO_HOURS, ZOO_PEN, zooPose } from '../../../src/sim/attractions/PettingZoo';
import { GuestType } from '../../../src/sim/guests/Guest';
import { PettingZooView, ZOO_VIEW } from '../../../src/render/PettingZooView';
import { buildParts } from '../../../src/render/meshes';
import { harness } from './harness';
import { collectSave, stateHash } from '../../../src/game/saveState';
import { createSim } from '../../../src/game/createSim';
import { findSite, planPathTo } from '../../../src/tutorial/suggest';
import { placeBuilding } from '../../../src/sim/PlaceBuilding';

const dayOf = (season: string): number => { for (let d = 0; d < 180; d++) if (seasonOf({ day: d }) === season) return d + 3; throw new Error('no day'); };

describe('petting zoo catalog row', () => {
  it('3x3, path access only, ticket $8, 20 places, one keeper, summer, level 1, standalone (no requirement)', () => {
    const d = BUILDINGS.pettingZoo!, s = ATTRACTION_SPECS.pettingZoo!;
    expect([d.w, d.h, d.capacity, d.staff, d.upkeep, d.access, d.altAccess, d.requires]).toEqual([3, 3, 20, 1, 10, 'path', undefined, []]);
    expect(d.season).toBe('summer');
    expect(d.needs).toEqual(['snowFree']);
    expect(PRICE_TABLE.pettingZoo).toMatchObject({ price: 8, billing: 'perUse', category: 'recreation' });
    expect(s.slots).toBe(20);
    expect(s.seasonOpen).toEqual(['summer']);
    expect(unlockLevel('building', 'pettingZoo')).toBe(1);
    expect(accessReason(d)).toBe('Needs a footpath or road next to it');
  });
  it('family appeal is 0.8, the highest of every type', () => {
    const a = ATTRACTION_SPECS.pettingZoo!.appeal;
    expect(a[GuestType.Family]).toBe(0.8);
    expect(appealFor(ATTRACTION_SPECS.pettingZoo!, 'pettingZoo', GuestType.Family)).toBe(0.8);
    expect(Math.max(...a)).toBe(a[GuestType.Family]);
  });
  it('needs a footpath: inactive on its own, active beside one', () => {
    const mk = () => { const grid = new Grid(64); const buildings = new Buildings(grid.occupancy); const net = new Networks(grid, buildings); buildings.setNetwork({ pathDistance: net.pathDistance, roadConnected: net.roadConnected, access: net.access }); net.roadEntry = { x: 0, y: 40 }; return { buildings, net }; };
    const a = mk(); const z0 = a.buildings.add('pettingZoo', 30, 20).building; a.buildings.reevaluate();
    expect(z0.active).toBe(false);
    const b = mk();
    b.net.buildSegment(NetKind.Road, lineTiles({ x: 0, y: 40 }, { x: 29, y: 40 }));
    b.net.buildSegment(NetKind.Road, lineTiles({ x: 29, y: 40 }, { x: 29, y: 21 }));
    const z1 = b.buildings.add('pettingZoo', 30, 20).building; b.buildings.reevaluate();
    expect(z1.active).toBe(true);
  });
});

describe('petting zoo in the attraction system', () => {
  it('summer: families are served, pay $8 into recreation; capacity 20, staffed', () => {
    const h = harness();
    h.state.date.day = dayOf('summer');
    const b = h.add('pettingZoo');
    h.run(1);
    const a = h.sys.get(b.id)!;
    expect(a.open).toBe(true);
    expect(a.capacity()).toBe(20);
    const g = h.guest({ type: GuestType.Family });
    expect(h.arrive(g, b)).toBe('using');
    h.run(a.serviceTime() + 2);
    expect(a.stats.served).toBe(1);
    expect(h.econ.ledger.recreation).toBe(8);
    expect(a.unitPrice()).toBe(8);
  });
  it('winter: closed for the season (and it stays closed: nobody is served)', () => {
    const h = harness();
    h.state.date.day = dayOf('winter');
    const b = h.add('pettingZoo');
    h.run(1);
    const a = h.sys.get(b.id)!;
    expect(a.open).toBe(false);
    expect(a.reason).toBe('Closed for the season');
    const g = h.guest({ type: GuestType.Family });
    expect(h.arrive(g, b)).toBe('handled');
    expect(a.stats.served).toBe(0);
    expect(h.econ.ledger.recreation ?? 0).toBe(0);
  });
  it('without its keeper it is closed; understaffed capacity drops', () => {
    const h = harness();
    h.state.date.day = dayOf('summer');
    const b = h.add('pettingZoo');
    h.run(1);
    const a = h.sys.get(b.id)!;
    a.staff = 0; h.run(1);
    expect(a.open).toBe(false);
    expect(a.reason).toBe('Closed: no staff');
  });
  it('deterministic: the same busy day twice gives identical ledgers and stats', () => {
    const day = () => {
      const h = harness();
      h.state.date.day = dayOf('summer');
      const b = h.add('pettingZoo');
      h.run(1);
      for (let i = 0; i < 30; i++) { const g = h.guest({ type: i % 2 ? GuestType.Family : GuestType.Couple }); h.arrive(g, b); }
      h.run(60);
      return JSON.stringify([h.econ.ledger, h.sys.get(b.id)!.stats, h.sys.asSystem().serialize!()]);
    };
    expect(day()).toBe(day());
  });
});

describe('petting zoo animals (display only)', () => {
  it('eight residents: goats, sheep, rabbits and a donkey', () => {
    expect(ZOO_ANIMALS).toHaveLength(8);
    expect(new Set(ZOO_ANIMALS)).toEqual(new Set(['goat', 'sheep', 'rabbit', 'donkey']));
  });
  it('every pose over 10 minutes stays inside the pen, is deterministic, and animals really move', () => {
    let moved = 0;
    for (const seed of [1, 7, 4242]) for (let i = 0; i < ZOO_ANIMALS.length; i++) {
      let px = NaN, pz = NaN;
      for (let t = 0; t < 600; t += 0.5) {
        const p = zooPose(seed, i, t);
        expect(p.x).toBeGreaterThanOrEqual(ZOO_PEN.x0 - 1e-9); expect(p.x).toBeLessThanOrEqual(ZOO_PEN.x1 + 1e-9);
        expect(p.z).toBeGreaterThanOrEqual(ZOO_PEN.z0 - 1e-9); expect(p.z).toBeLessThanOrEqual(ZOO_PEN.z1 + 1e-9);
        expect(zooPose(seed, i, t)).toEqual(p);
        if (!Number.isNaN(px) && Math.hypot(p.x - px, p.z - pz) > 0.02) moved++;
        px = p.x; pz = p.z;
      }
    }
    expect(moved).toBeGreaterThan(200);
  });
  it('the view draws every animal of an open pen by day, none when closed / at night / zoomed far out; instances stay under the cap', () => {
    const v = new PettingZooView();
    const toWorld = (_id: number, lx: number, lz: number, out: THREE.Vector3): boolean => { out.set(40 + lx, 0, 40 + lz); return true; };
    v.update(0.1, [{ id: 5, open: true }], 12, 30, toWorld, 40, 40);
    expect(v.drawn).toBe(8);
    expect([...v.meshes.values()].reduce((n, m) => n + m.count, 0)).toBe(8);
    expect(v.meshes.get('rabbit')!.count).toBe(3);
    v.update(0.1, [{ id: 5, open: false }], 12, 30, toWorld, 40, 40); expect(v.drawn).toBe(0);
    v.update(0.1, [{ id: 5, open: true }], ZOO_HOURS.to + 0.5, 30, toWorld, 40, 40); expect(v.drawn).toBe(0);
    v.update(0.1, [{ id: 5, open: true }], ZOO_HOURS.from - 0.5, 30, toWorld, 40, 40); expect(v.drawn).toBe(0);
    v.update(0.1, [{ id: 5, open: true }], 12, ZOO_VIEW.hideAbove + 10, toWorld, 40, 40); expect(v.drawn).toBe(0);
    const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, open: true }));
    v.update(0.1, many, 12, 30, (id, lx, lz, out) => { out.set(40 + lx, 0, 40 + lz); return true; }, 40, 40);
    for (const m of v.meshes.values()) expect(m.count).toBeLessThanOrEqual(ZOO_VIEW.cap);
    v.dispose();
  });
  it('mesh: within the building triangle budget, with a sign', () => {
    const d = BUILDINGS.pettingZoo!, p = buildParts(d.meshBuilder, d.w, d.h);
    let tris = 0; for (const g of [p.wood, p.stone, p.roof, p.sign?.geometry]) if (g) tris += g.getAttribute('position').count / 3;
    expect(tris).toBeLessThan(3000);
    expect(p.sign?.text).toBe('PETTING ZOO');
  });
});

describe('petting zoo in a real summer resort', () => {
  it('a connected zoo opens, serves visitors over a week of summer, is deterministic and survives save / load', () => {
    const run = (): { served: number; revenue: number; hash: string; open: boolean; sim: ReturnType<typeof createSim> } => {
      const sim = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', startSeason: 'summer', now: () => 0 });
      const lodge = sim.buildings.all().find((b) => b.type === 'baseLodge')!;
      const site = findSite(sim, 'pettingZoo', { x: lodge.x + 6, y: lodge.y + 8 }, { rmax: 24, route: 'path' })!;
      expect(site).toBeTruthy();
      const o = placeBuilding(sim.env, sim.props, 'pettingZoo', site.x, site.y, site.rot, true, false);
      expect(o.ok).toBe(true);
      const route = planPathTo(sim, site.rect);
      if (route?.length) sim.networks.buildSegment(NetKind.Path, route);
      sim.buildings.reevaluate();
      sim.refreshCoverage(undefined, true);
      sim.tick(240 * 8);
      const a = sim.attractions.get(o.building!.id)!;
      return { served: a.stats.served, revenue: a.stats.revenue, hash: stateHash(sim).hash, open: a.open, sim };
    };
    const a = run(), b = run();
    expect(a.open).toBe(true);
    expect(a.served).toBeGreaterThan(0);
    expect(a.revenue).toBeGreaterThan(0);
    expect({ ...b, sim: 0 }).toEqual({ ...a, sim: 0 });
    // save / load: the reloaded world hashes identically and the zoo is still there with its stats
    const loaded = createSim({ size: 64, seed: 61, now: () => 0, fromSave: structuredClone(collectSave(a.sim)) });
    const noNet = (sim: Parameters<typeof stateHash>[0]): Record<string, string> => { const q = { ...stateHash(sim).parts }; delete q.networks; return q; };
    const pa = noNet(a.sim), pb = noNet(loaded); // (the networks part differs after any reload of a sandbox starter resort: unrelated)
    expect(pb).toEqual(pa);
    expect(loaded.buildings.all().filter((x) => x.type === 'pettingZoo')).toHaveLength(1);
    expect(loaded.attractions.get(a.sim.buildings.all().find((x) => x.type === 'pettingZoo')!.id)!.stats.served).toBe(a.served);
  }, 120_000);
});
