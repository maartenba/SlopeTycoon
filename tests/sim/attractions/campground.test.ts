/** Phase 6 Task 19: campground (Lodging v2: 16 pitches, budget tier, summer only, campfire evening). docs/campground.md */
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../../src/config/buildings';
import { NIGHTLY_RATE, PRICE_TABLE } from '../../../src/config/prices';
import { unlockLevel } from '../../../src/config/unlocks';
import { Grid } from '../../../src/world/Grid';
import { Layer, Networks, NetKind, lineTiles } from '../../../src/world/Networks';
import { Buildings } from '../../../src/sim/Buildings';
import { accessReason } from '../../../src/sim/PlacementRules';
import { seasonOf } from '../../../src/sim/Clock';
import { ATTRACTION_SPECS } from '../../../src/sim/attractions/registry';
import { takesGuestsIn } from '../../../src/sim/attractions/Lodging';
import { CAMP, campFireHappiness } from '../../../src/sim/attractions/Campground';
import { GuestType } from '../../../src/sim/guests/Guest';
import { smokeIntensity } from '../../../src/render/Smoke';
import { harness } from './harness';
import { collectSave, stateHash } from '../../../src/game/saveState';
import { createSim } from '../../../src/game/createSim';
import { findSite, planPathTo } from '../../../src/tutorial/suggest';
import { placeBuilding } from '../../../src/sim/PlaceBuilding';
import { seasonStartDay } from '../../../src/sim/Clock';

const dayOf = (season: string): number => { for (let d = 0; d < 180; d++) if (seasonOf({ day: d }) === season) return d + 3; throw new Error('no day'); };
const EVENING = 18 * 60 + 30;

describe('campground catalog row', () => {
  it('5x4, 16 pitches, budget tier, summer, path + trail access, level 1 (never gated)', () => {
    const d = BUILDINGS.campground!, s = ATTRACTION_SPECS.campground!;
    expect([d.w, d.h, d.capacity, d.category]).toEqual([5, 4, 16, 'lodging']);
    expect([d.access, ...(d.altAccess ?? [])]).toEqual(['path', 'trail']);
    expect(d.season).toBe('summer');
    expect(s.rooms).toBe(16);
    expect(s.tier).toBe('budget');
    expect(s.seasonOpen).toEqual(['summer']);
    expect(s.overnightOnly).toBe(true);
    expect(NIGHTLY_RATE.campground).toEqual({ price: 24, max: 90 }); // chalet 40 x 0.6
    expect(PRICE_TABLE.campground!.category).toBe('lodging');
    expect(unlockLevel('building', 'campground')).toBe(1);
    expect(d.upkeep).toBeGreaterThan(0);
  });
  it('access: a footpath or a hiking trail serves it, nothing does not', () => {
    expect(accessReason(BUILDINGS.campground!)).toBe('Needs a footpath, road or hiking trail next to it');
    const mk = () => { const grid = new Grid(64); const buildings = new Buildings(grid.occupancy); const net = new Networks(grid, buildings); buildings.setNetwork({ pathDistance: net.pathDistance, roadConnected: net.roadConnected, access: net.access }); net.roadEntry = { x: 0, y: 40 }; return { grid, buildings, net }; };
    const bare = mk(), c0 = bare.buildings.add('campground', 30, 20).building;
    bare.buildings.reevaluate();
    expect(c0.active).toBe(false);
    const withPath = mk();
    withPath.net.buildSegment(NetKind.Road, lineTiles({ x: 0, y: 40 }, { x: 29, y: 40 }));
    withPath.net.buildSegment(NetKind.Road, lineTiles({ x: 29, y: 40 }, { x: 29, y: 21 }));
    withPath.net.buildSegment(NetKind.Path, lineTiles({ x: 29, y: 21 }, { x: 29, y: 19 }));
    const c1 = withPath.buildings.add('campground', 30, 20).building;
    withPath.buildings.reevaluate();
    expect(c1.active).toBe(true);
    const withTrail = mk();
    withTrail.net.buildSegment(NetKind.Road, lineTiles({ x: 0, y: 40 }, { x: 29, y: 40 }));
    withTrail.net.buildSegment(NetKind.Road, lineTiles({ x: 29, y: 40 }, { x: 29, y: 25 }));
    withTrail.net.paint(Layer.Hike, lineTiles({ x: 29, y: 25 }, { x: 29, y: 21 }));
    const c2 = withTrail.buildings.add('campground', 30, 20).building;
    withTrail.buildings.reevaluate();
    expect(c2.active).toBe(true);
    expect(withTrail.net.suppliedOnFootOnly(c2.id)).toBe(true); // +25% upkeep (trails-access)
    expect(withPath.net.suppliedOnFootOnly(c1.id)).toBe(false);
  });
});

describe('campground in the attraction system', () => {
  const night = (h: ReturnType<typeof harness>, n: number, o: { type?: number } = {}): number[] => Array.from({ length: n }, () => h.guest({ overnight: true, budget: 500, ...o }));

  it('summer: 16 campers sleep there at $24 a night, the 17th gets no pitch; winter: closed for the season, no check-ins, no rooms counted', () => {
    const h = harness();
    h.state.date.day = dayOf('summer');
    const b = h.add('campground');
    h.run(1);
    expect(h.sys.lodgingCapacity()).toBe(16);
    h.state.date.minute = EVENING;
    night(h, 17);
    h.run(1);
    expect(h.sys.rooms.occupied(b.id)).toBe(16);
    expect(h.sys.get(b.id)!.stats.nights).toBe(16);
    expect(h.econ.ledger.lodging).toBe(16 * 24);

    const w = harness();
    w.state.date.day = dayOf('winter');
    const wb = w.add('campground');
    w.run(1);
    w.state.date.minute = EVENING;
    night(w, 5);
    w.run(1);
    expect(w.sys.get(wb.id)!.open).toBe(false);
    expect(w.sys.get(wb.id)!.reason).toBe('Closed for the season');
    expect(w.sys.rooms.occupied(wb.id)).toBe(0);
    expect(w.econ.ledger.lodging).toBe(0);
    expect(w.sys.lodgingCapacity()).toBe(0);
  });

  it('budget / adventure guests pitch their tent first, a VIP never does; chalets stay the default for everyone else', () => {
    const h = harness();
    h.state.date.day = dayOf('summer');
    const chalet = h.add('chalet', 4, 4), camp = h.add('campground', 12, 4);
    h.run(1);
    h.state.date.minute = EVENING;
    const budget = h.guest({ overnight: true, type: GuestType.Budget }), vip = h.guest({ overnight: true, type: GuestType.VIP }), solo = h.guest({ overnight: true, type: GuestType.Solo });
    h.run(1);
    expect(h.sys.rooms.roomOf(h.store.id[budget]!)).toBe(camp.id);
    expect(h.sys.rooms.roomOf(h.store.id[vip]!)).toBe(chalet.id);
    expect(h.sys.rooms.roomOf(h.store.id[solo]!)).toBe(chalet.id);
    // a campground alone never takes the VIP
    const v = harness();
    v.state.date.day = dayOf('summer');
    const only = v.add('campground');
    v.run(1);
    v.state.date.minute = EVENING;
    const g = v.guest({ overnight: true, type: GuestType.VIP });
    v.run(1);
    expect(v.sys.rooms.roomOf(v.store.id[g]!)).toBeUndefined();
    expect(v.sys.rooms.occupied(only.id)).toBe(0);
  });

  it('campfire evening: campers gain happiness once per evening, more with toilets within reach, less (a grumble) without', () => {
    const gain = (withToilets: boolean): number => {
      const h = harness();
      h.state.date.day = dayOf('summer');
      h.add('campground', 12, 12);
      if (withToilets) h.add('toilets', 12 + CAMP.toiletRadius - 3, 12);
      h.run(1);
      h.state.date.minute = EVENING;
      const g = h.guest({ overnight: true });
      const slot = g;
      h.store.happiness[slot] = 0.5;
      h.run(1); // check-in (18:30)
      expect(h.store.happiness[slot]).toBe(0.5); // the fire starts at 19:00
      h.state.date.minute = 19 * 60 + 5;
      h.run(1);
      const after = h.store.happiness[slot]! - 0.5;
      h.run(5);
      expect(h.store.happiness[slot]! - 0.5).toBeCloseTo(after, 6); // once
      return after;
    };
    const w = gain(true), wo = gain(false);
    expect(w).toBeCloseTo(campFireHappiness(true), 5);
    expect(wo).toBeCloseTo(campFireHappiness(false), 5);
    expect(w).toBeGreaterThan(wo);
    expect(campFireHappiness(false)).toBeGreaterThan(0 - CAMP.noToiletMalus - 1e-9);
  });

  it('inspector data: pitches, campers tonight, toilets in reach', () => {
    const h = harness();
    h.state.date.day = dayOf('summer');
    const b = h.add('campground', 12, 12);
    h.run(1);
    expect(h.sys.campInfo(b.id)).toEqual({ pitches: 16, used: 0, toilets: false, fires: 0 });
    h.add('toilets', 14, 18);
    h.state.date.minute = EVENING;
    night(h, 3);
    h.run(1);
    expect(h.sys.campInfo(b.id)).toMatchObject({ used: 3, toilets: true });
    expect(h.sys.campInfo(999)).toBeUndefined();
    expect(h.sys.campInfo(h.add('chalet').id)).toBeUndefined();
  });

  it('deterministic: the same evening twice gives the same ledger, happiness and serialised state; a save keeps the fire marker', () => {
    const run = () => {
      const h = harness();
      h.state.date.day = dayOf('summer');
      h.add('campground', 12, 12); h.add('toilets', 14, 18); h.add('chalet', 4, 4);
      h.run(1);
      h.state.date.minute = EVENING;
      night(h, 20, { type: GuestType.Budget });
      h.run(1);
      h.state.date.minute = 20 * 60;
      h.run(3);
      return { h, snap: JSON.stringify([h.sys.asSystem().serialize!(), h.econ.ledger, [...h.store.happiness.slice(0, 20)]]) };
    };
    const a = run(), b = run();
    expect(a.snap).toBe(b.snap);
    const saved = a.h.sys.asSystem().serialize!() as { gather?: number };
    expect(saved.gather).toBeGreaterThanOrEqual(0);
    // load -> the same evening does not light a second fire
    const c = run();
    c.h.sys.asSystem().load!(JSON.parse(JSON.stringify(saved)));
    const before = c.h.store.happiness[0]!;
    c.h.run(3);
    expect(c.h.store.happiness[0]).toBe(before);
  });

  it('worlds without a campground serialise exactly as before (no gather marker, no fire counters)', () => {
    const h = harness();
    h.add('chalet');
    h.run(1);
    h.state.date.minute = 20 * 60;
    h.guest({ overnight: true });
    h.run(5);
    expect(Object.keys(h.sys.asSystem().serialize!() as object)).not.toContain('gather');
  });
});

describe('seasonal room counts (spawner overnight cap, rating amenities)', () => {
  it('a closed campground adds no rooms; chalets and apartments always do', () => {
    expect(takesGuestsIn('campground', 'summer')).toBe(true);
    for (const s of ['winter', 'spring', 'autumn'] as const) expect(takesGuestsIn('campground', s)).toBe(false);
    for (const s of ['winter', 'spring', 'summer', 'autumn'] as const) { expect(takesGuestsIn('chalet', s)).toBe(true); expect(takesGuestsIn('apartment', s)).toBe(true); expect(takesGuestsIn('baseLodge', s)).toBe(true); }
  });
});

describe('campfire smoke', () => {
  it('burns on summer evenings whatever the temperature, not in winter, not at noon', () => {
    const at = (hour: number, season: string, temp = 18): number => smokeIntensity('campground', true, temp, hour, 0.6, 0.5, season);
    expect(at(20, 'summer')).toBeGreaterThan(0.3);
    expect(at(20, 'summer', 24)).toBeGreaterThan(0.3); // not tied to the cold
    expect(at(13, 'summer')).toBe(0);
    expect(at(20, 'winter', -5)).toBe(0);
    expect(smokeIntensity('campground', false, 10, 20, 1, 0.5, 'summer')).toBe(0);
  });
});

describe('campground in a real resort', () => {
  it('a connected campground houses campers on summer nights, closes when winter comes, reopens next summer, and survives save / load', () => {
    const build = (): { sim: ReturnType<typeof createSim>; id: number } => {
      const sim = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', startSeason: 'summer', now: () => 0 });
      const lodge = sim.buildings.all().find((b) => b.type === 'baseLodge')!;
      const site = findSite(sim, 'campground', { x: lodge.x + 6, y: lodge.y + 8 }, { rmax: 24, route: 'path' })!;
      expect(site).toBeTruthy();
      const o = placeBuilding(sim.env, sim.props, 'campground', site.x, site.y, site.rot, true, false);
      expect(o.ok).toBe(true);
      const route = planPathTo(sim, site.rect);
      if (route?.length) sim.networks.buildSegment(NetKind.Path, route);
      sim.buildings.reevaluate();
      sim.refreshCoverage(undefined, true);
      return { sim, id: o.building!.id };
    };
    const night = (sim: ReturnType<typeof createSim>, n: number): void => {
      const st = sim.guestSim.store;
      for (let k = 0; k < n; k++) st.add({ x: 5, y: 5, z: 0, type: GuestType.Budget, skill: 1, budget: 400, group: 0, mode: 0, overnight: true, leaveDay: 99, tick: 0, hunger: 0.8 } as never);
    };
    const { sim, id } = build();
    sim.tick(2); // the attraction system learns the date on its first update
    expect(sim.attractions.refreshOpen(id)!.open).toBe(true);
    night(sim, 10);
    const a = sim.attractions.get(id)!;
    for (let i = 0; i < 240 * 3 && a.stats.nights === 0; i++) sim.tick(1); // until the first check-in (18:00)
    expect(a.stats.nights).toBeGreaterThan(0);
    expect(sim.attractions.rooms.occupied(id)).toBeGreaterThan(0);
    expect(sim.attractions.campInfo(id)!.pitches).toBe(16);
    // save / load keeps the building and its nights
    const loaded = createSim({ size: 64, seed: 61, now: () => 0, fromSave: structuredClone(collectSave(sim)) });
    const noNet = (sim: Parameters<typeof stateHash>[0]): Record<string, string> => { const q = { ...stateHash(sim).parts }; delete q.networks; return q; };
    const pa = noNet(sim), pb = noNet(loaded); // (networks differs after any sandbox reload: unrelated)
    expect(pb).toEqual(pa);
    const capSummer = sim.attractions.lodgingCapacity();
    // winter: closed for the season, and the spawner counts no rooms from it
    sim.jumpToDay(seasonStartDay('winter') + 5, 12);
    sim.tick(10);
    expect(sim.attractions.refreshOpen(id)!.reason).toBe('Closed for the season');
    expect(sim.attractions.lodgingCapacity()).toBe(capSummer - 16); // its pitches are no rooms in winter
    sim.jumpToDay(seasonStartDay('summer') + 40, 12);
    sim.tick(10);
    expect(sim.attractions.refreshOpen(id)!.open).toBe(true);
  }, 120_000);
});
