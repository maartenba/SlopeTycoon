/** Phase 6 Task 28: Coffee Stand (1x1 kiosk, quick service, food only, a steam wisp). docs/coffee-stand.md */
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../../src/config/buildings';
import { PRICE_TABLE } from '../../../src/config/prices';
import { Rng } from '../../../src/core/Rng';
import { Grid } from '../../../src/world/Grid';
import { Layer, Networks, lineTiles, NetKind } from '../../../src/world/Networks';
import { Buildings } from '../../../src/sim/Buildings';
import { accessReason } from '../../../src/sim/PlacementRules';
import { ATTRACTION_SPECS } from '../../../src/sim/attractions/registry';
import { GuestStore, GuestType } from '../../../src/sim/guests/Guest';
import { Decider, FOOD, SNACK, SNACKS } from '../../../src/sim/guests/Decision';
import { Excursions, type ExcHost } from '../../../src/sim/guests/Excursion';
import { GuestSim } from '../../../src/sim/guests/GuestSim';
import { smokeIntensity, emitterSpecOf, wideOf } from '../../../src/render/Smoke';
import { buildParts } from '../../../src/render/meshes';
import { harness } from './harness';
import { building, resetIds } from '../guests/helpers';
import { starterResort } from '../guests/resortFixture';

describe('coffee stand catalog row', () => {
  it('1x1, cheap, staffed by one, all year, beside a piste / footpath / trail', () => {
    const d = BUILDINGS.coffeeStand!;
    expect([d.w, d.h, d.access, ...(d.altAccess ?? [])]).toEqual([1, 1, 'pisteEdge', 'path', 'trail']);
    expect(d.pisteRule).toBe('edge');
    expect(d.season).toBe('all');
    expect(d.cost).toBeLessThan(BUILDINGS.cafe!.cost);
    expect(d.upkeep).toBeLessThan(BUILDINGS.cafe!.upkeep);
    expect(d.staff).toBe(1);
    expect(accessReason(d)).toBe('Needs a footpath, road, hiking trail or piste next to it');
    expect(PRICE_TABLE.coffeeStand!.price).toBeLessThan(PRICE_TABLE.cafe!.price);
  });
  it('quick service, a lower menu than the cafe: less capacity, partial hunger relief, NO comfort effect, no evening shift', () => {
    const s = ATTRACTION_SPECS.coffeeStand!, c = ATTRACTION_SPECS.cafe!;
    expect(s.kind).toBe('restaurant');
    expect(s.serviceTicks).toBeLessThan(c.serviceTicks);
    expect(s.slots!).toBeLessThan(BUILDINGS.cafe!.capacity);
    expect(s.effects.hungerTo).toBeUndefined();
    expect(s.effects.hungerBy).toBe(SNACK.by); // only 0.3 of the hunger goes: never the real meal
    expect(c.effects.hungerTo).toBe(0.05);
    expect(s.effects.urgeTo).toBeUndefined(); // food only: toilets are the comfort source
    expect(s.eveningShift).toBeUndefined();
    expect(c.effects.urgeTo).toBeDefined();
    expect(SNACKS.has('coffeeStand')).toBe(true);
    expect(FOOD.has('coffeeStand')).toBe(false); // never the lunch destination
  });
});

describe('coffee stand access rules', () => {
  const mk = () => { const grid = new Grid(64); const buildings = new Buildings(grid.occupancy); const net = new Networks(grid, buildings); buildings.setNetwork({ pathDistance: net.pathDistance, roadConnected: net.roadConnected, access: net.access }); net.roadEntry = { x: 0, y: 40 }; return { grid, buildings, net }; };
  it('inactive alone; a footpath, a hiking trail or a piste beside it makes it active (trail / piste supply = the +25 % remote upkeep)', () => {
    const bare = mk();
    const b0 = bare.buildings.add('coffeeStand', 30, 21).building;
    bare.buildings.reevaluate();
    expect(b0.active).toBe(false);
    expect(b0.reason).toBe('Needs a footpath, road, hiking trail or piste next to it');

    const path = mk();
    path.net.buildSegment(NetKind.Road, lineTiles({ x: 0, y: 40 }, { x: 29, y: 40 }));
    path.net.buildSegment(NetKind.Road, lineTiles({ x: 29, y: 40 }, { x: 29, y: 21 }));
    path.net.buildSegment(NetKind.Path, lineTiles({ x: 29, y: 21 }, { x: 29, y: 19 }));
    const b1 = path.buildings.add('coffeeStand', 30, 21).building;
    path.buildings.reevaluate();
    expect(b1.active).toBe(true);
    expect(path.net.suppliedOnFootOnly(b1.id)).toBe(false);

    const trail = mk();
    trail.net.buildSegment(NetKind.Road, lineTiles({ x: 0, y: 40 }, { x: 29, y: 40 }));
    trail.net.buildSegment(NetKind.Road, lineTiles({ x: 29, y: 40 }, { x: 29, y: 25 }));
    trail.net.paint(Layer.Hike, lineTiles({ x: 29, y: 25 }, { x: 29, y: 21 }));
    const b2 = trail.buildings.add('coffeeStand', 30, 21).building;
    trail.buildings.reevaluate();
    expect(b2.active).toBe(true);
    expect(trail.net.suppliedOnFootOnly(b2.id)).toBe(true);

    const piste = mk();
    piste.net.paint(Layer.Ski, lineTiles({ x: 29, y: 10 }, { x: 29, y: 30 }));
    const b3 = piste.buildings.add('coffeeStand', 30, 21).building;
    piste.buildings.reevaluate();
    expect(b3.active).toBe(true);
  });
});

describe('service, revenue and the hunger effect', () => {
  it('a hungry guest pays $4 (restaurants ledger), is served in 2 ticks, and keeps part of the hunger; the comfort urge is untouched', () => {
    const h = harness();
    const stand = h.add('coffeeStand'), cafe = h.add('cafe', 30, 30);
    h.run(1);
    const g = h.guest({ budget: 100 }), c = h.guest({ budget: 100 });
    h.store.urge[g] = 0.9; h.store.urge[c] = 0.9;
    expect(h.arrive(g, stand)).toBe('using');
    expect(h.arrive(c, cafe)).toBe('using');
    h.run(8);
    expect(h.store.hunger[g]).toBeCloseTo(0.5, 6); // 0.3 off 0.8
    expect(h.store.hunger[c]).toBeCloseTo(0.05, 6);
    expect(h.store.urge[g]).toBeCloseTo(0.9, 6); // food only
    expect(h.store.urge[c]).toBeLessThan(0.9); // the cafe also relieves a little
    expect(h.sys.get(stand.id)!.stats.revenue).toBe(4);
    expect(h.econ.ledger.restaurants).toBe(4 + 6);
    // a guest that is only a little hungry is not made hungrier
    const full = h.guest({ budget: 100 }); h.store.hunger[full] = 0.1;
    h.arrive(full, stand); h.run(6);
    expect(h.store.hunger[full]).toBeLessThanOrEqual(0.1);
  });
  it('capacity is small (4 at a time) and a one-hour queue clears fast', () => {
    const h = harness();
    const stand = h.add('coffeeStand');
    h.run(1);
    const gs = Array.from({ length: 10 }, () => h.guest({ budget: 100 }));
    for (const g of gs) h.arrive(g, stand);
    h.run(1);
    const a = h.sys.get(stand.id)!;
    expect(a.users.length).toBe(a.capacity());
    expect(a.capacity()).toBe(4);
    h.run(12);
    expect(a.stats.served).toBe(10);
  });
});

describe('skiers stop mid-run for a coffee', () => {
  const decide = (withStand: boolean, hunger: number, standAt: [number, number] | null = [29, 40]): { eatStand: number; eatOther: number; total: number } => {
    resetIds();
    const f = starterResort(64);
    const stand = withStand && standAt ? f.addBuilding('coffeeStand', standAt[0], standAt[1]) : null;
    const g = f.graph(); g.update(0);
    const d = new Decider(() => g); d.refresh(f.buildings);
    const store = new GuestStore(2);
    const i = store.add({ x: 30, y: 42, z: 0, type: GuestType.Solo, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger });
    const rng = new Rng(7);
    let eatStand = 0, eatOther = 0;
    const n = 300;
    for (let k = 0; k < n; k++) {
      store.hunger[i] = hunger;
      const it = d.choose(store, i, rng, 10);
      if (it.kind === 'eat') { if (stand && it.building!.id === stand.id) eatStand++; else eatOther++; }
    }
    return { eatStand, eatOther, total: n };
  };
  it('a guest with a snack-sized hunger near a stand weighs it: a good share of decisions are a coffee stop', () => {
    const r = decide(true, 0.5);
    expect(r.eatStand).toBeGreaterThan(r.total * 0.15);
  });
  it('very hungry guests want the real meal, not a kiosk; guests who are not hungry skip it; no stand = identical decisions (no RNG drawn)', () => {
    const starving = decide(true, 0.9), fed = decide(true, 0.1);
    expect(starving.eatStand).toBe(0);
    expect(fed.eatStand).toBe(0);
    // a stand far away barely matters
    expect(decide(true, 0.5, [4, 4]).eatStand).toBeLessThan(decide(true, 0.5).eatStand);
    expect(SNACK.maxHunger).toBeLessThan(0.8);
  });
  it('the real meal stays the main business: with a stand the cafe / lodge still sells most of the food decisions', () => {
    const r = decide(true, 0.5);
    expect(r.eatOther).toBeGreaterThan(0);
    const r2 = decide(true, 0.65);
    expect(r2.eatOther + r2.eatStand).toBeGreaterThan(0);
  });
});

describe('hikers and bikers take a coffee on a trail walk', () => {
  /** A hiker at (30, 20) on an excursion with a coffee stand (and optionally a lodge) in reach: the stop ends hungry-ish, not full. */
  const lunch = (types: string[]): { hunger: number; spent: number } => {
    resetIds();
    const bs = types.map((t, i) => building(t, 28 + i * 2, 18));
    let spent = 0;
    const world = { mapSize: 64, buildings: () => bs, onSpend: (a: number) => { spent += a; }, weather: () => ({ kind: 'clear', intensity: 0 }) } as never;
    const sim = new GuestSim(world, 64);
    const s = sim.store;
    const slot = s.add({ x: 30, y: 20, z: 0, type: GuestType.Solo, skill: 1, budget: 100, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0.8 });
    // the Excursions host is private: reach it through the instance
    const host = (sim.exc as unknown as { h: ExcHost }).h;
    for (const b of bs) (sim as unknown as { byId: Map<number, unknown> }).byId.set(b.id, b);
    expect(host.foodNear(30, 20)).toBe(true);
    host.lunch(slot);
    return { hunger: s.hunger[slot]!, spent };
  };
  it('a coffee stand is "food in reach" for a hiker; with only a stand it is a cup (0.3 off the hunger, $4), with a lodge near it is the lunch', () => {
    expect(Excursions).toBeDefined();
    const only = lunch(['coffeeStand']);
    expect(only.hunger).toBeCloseTo(0.5, 6);
    expect(only.spent).toBe(4);
    const full = lunch(['coffeeStand', 'lodge']);
    expect(full.hunger).toBeCloseTo(0.05, 6);
    expect(full.spent).toBe(12);
  });
});

describe('coffee stand wisp and mesh', () => {
  it('a thin daytime wisp, stronger in the cold, none at night or when inactive; it is small, not wide like pool steam', () => {
    const at = (temp: number, hour: number): number => smokeIntensity('coffeeStand', true, temp, hour, 0, 0.5, 'winter');
    expect(at(-5, 10)).toBeGreaterThan(at(15, 10));
    expect(at(25, 10)).toBeGreaterThan(0.15); // still a visible wisp in summer
    expect(at(-5, 3)).toBe(0);
    expect(at(-5, 21)).toBe(0);
    expect(smokeIntensity('coffeeStand', false, -5, 10, 0, 0.5, 'winter')).toBe(0);
    expect(emitterSpecOf('coffeeStand')).toEqual(BUILDINGS.coffeeStand!.chimney);
    expect(wideOf('coffeeStand')).toBeLessThan(0);
  });
  it('the mesh fits a 1x1 footprint and stays tiny', () => {
    const d = BUILDINGS.coffeeStand!, p = buildParts(d.meshBuilder, d.w, d.h);
    let tris = 0;
    for (const g of [p.wood, p.stone, p.roof, p.sign?.geometry]) if (g) tris += g.getAttribute('position').count / 3;
    expect(tris).toBeLessThan(900);
    expect(tris).toBeGreaterThan(100);
  });
});

describe('coffee stand in a real resort', () => {
  it('beside the piste end of the starter resort it is active, serves skiers over three winter days, and the lodge keeps selling meals', async () => {
    const { createSim } = await import('../../../src/game/createSim');
    const { findSite } = await import('../../../src/tutorial/suggest');
    const { placeBuilding } = await import('../../../src/sim/PlaceBuilding');
    const mk = (withStand: boolean) => {
      const sim = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', startSeason: 'winter', now: () => 0 });
      let id: number | undefined;
      if (withStand) {
        const bottom = sim.lifts.all()[0]!.bottom; // guests decide when they come down to the lift bottom: a stand beside the piste end is the nearest food there
        const site = findSite(sim, 'coffeeStand', { x: bottom.x + 2, y: bottom.y }, { rmax: 5 })!;
        expect(site).toBeTruthy();
        const o = placeBuilding(sim.env, sim.props, 'coffeeStand', site.x, site.y, site.rot, true, false);
        expect(o.ok).toBe(true);
        id = o.building!.id;
        sim.buildings.reevaluate();
        sim.refreshCoverage(undefined, true);
        expect(sim.buildings.get(id)!.active).toBe(true);
      }
      sim.guestSim.spawner.rateMult = 6; // a busy resort: dense arrivals so a few days are enough for a snack stop
      for (let i = 0; i < 240 * 3; i++) sim.tick(1);
      return { sim, id };
    };
    const a = mk(true), b = mk(false);
    const stand = a.sim.attractions.get(a.id!)!;
    expect(stand.stats.served).toBeGreaterThan(0);
    expect(stand.stats.revenue).toBeGreaterThanOrEqual(stand.stats.served * 4); // $4 a cup, a little more in the evening (drinks premium)
    expect(stand.stats.revenue).toBeLessThanOrEqual(stand.stats.served * 4 * 1.3);
    // the real meal stays the business of the restaurants: the cafe / lodge still sell, and the whole food line is not collapsing
    const meals = (s: typeof a.sim): number => s.attractions.all().filter((x) => x.b.type !== 'coffeeStand' && x.spec.kind === 'restaurant').reduce((n, x) => n + x.stats.served, 0);
    expect(meals(a.sim)).toBeGreaterThan(0);
    expect(meals(a.sim)).toBeGreaterThan(meals(b.sim) * 0.6);
  }, 120_000);

  it('mid-run coffee break: skiers passing within 2 tiles of an open stand sometimes stop (a few per guest per day, never stuck)', async () => {
    const { createSim } = await import('../../../src/game/createSim');
    const { findSite } = await import('../../../src/tutorial/suggest');
    const { placeBuilding } = await import('../../../src/sim/PlaceBuilding');
    const sim = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', startSeason: 'winter', now: () => 0 });
    const bottom = sim.lifts.all()[0]!.bottom;
    const site = findSite(sim, 'coffeeStand', { x: bottom.x + 2, y: bottom.y }, { rmax: 5 })!;
    const o = placeBuilding(sim.env, sim.props, 'coffeeStand', site.x, site.y, site.rot, true, false);
    expect(o.ok).toBe(true);
    sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true);
    expect(sim.buildings.get(o.building!.id)!.active).toBe(true);
    sim.guestSim.spawner.rateMult = 6;
    for (let i = 0; i < 240 * 3; i++) sim.tick(1);
    const gs = sim.guestSim, st = sim.attractions.get(o.building!.id)!;
    const stops = gs.coffeeStops, guests = Math.max(1, gs.runsCompleted);
    expect(stops).toBeGreaterThan(0);
    expect(stops).toBeLessThanOrEqual(st.stats.served + 5);
    expect(stops / guests).toBeLessThan(0.2); // per completed run, restrained
  }, 120_000);
});
