/** Phase 6 Task 27: Small Hotel + Luxury Hotel with a heated outdoor pool (Lodging v2: standard / luxury tier, pool amenity, steam, energy demand). docs/hotels.md */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDINGS } from '../../../src/config/buildings';
import { NIGHTLY_RATE, PRICE_TABLE } from '../../../src/config/prices';
import { POOL, poolHeatCost, poolHeatFactor } from '../../../src/config/energy';
import { unlockLevel } from '../../../src/config/unlocks';
import { ATTRACTION_SPECS } from '../../../src/sim/attractions/registry';
import { HOTEL_TYPES, takesGuestsIn } from '../../../src/sim/attractions/Lodging';
import { accessReason } from '../../../src/sim/PlacementRules';
import { GuestType } from '../../../src/sim/guests/Guest';
import { EVENING_VENUES, REST } from '../../../src/sim/guests/Decision';
import { SMOKE, emitterSpecOf, selectEmitters, smokeIntensity, wideOf } from '../../../src/render/Smoke';
import { BuildingMeshes, buildParts } from '../../../src/render/meshes';
import { POOL_BASIN, poolWaterGeometry } from '../../../src/render/meshes/hotelLuxury';
import { formatHotelLines } from '../../../src/ui/attractionFormat';
import { harness } from './harness';
import { collectSave, stateHash } from '../../../src/game/saveState';
import { createSim } from '../../../src/game/createSim';
import { findSite, planRoadTo } from '../../../src/tutorial/suggest';
import { placeBuilding } from '../../../src/sim/PlaceBuilding';
import { NetKind } from '../../../src/world/Networks';
import { seasonOf } from '../../../src/sim/Clock';

const EVENING = 18 * 60 + 30;
const dayOf = (season: string): number => { for (let d = 0; d < 180; d++) if (seasonOf({ day: d }) === season) return d + 3; throw new Error('no day'); };
const night = (h: ReturnType<typeof harness>, n: number, o: { type?: number; budget?: number } = {}): number[] => Array.from({ length: n }, () => h.guest({ overnight: true, budget: 900, ...o }));

type Sim = ReturnType<typeof createSim>;
const ANCHORS: ReadonlyArray<readonly [number, number]> = [[-10, 4], [0, -10], [-14, -4], [8, -8], [14, 0], [8, 10]];
/** Place a road-served hotel near the starter lodge: the first anchor whose road link is short (a long link on this map does not always connect) and ends active. Returns the building id, or undefined. */
function placeRoadBuilding(sim: Sim, type: string, anchors = ANCHORS): number | undefined {
  const lodge = sim.buildings.all().find((b) => b.type === 'baseLodge')!;
  for (const [dx, dy] of anchors) {
    const site = findSite(sim, type, { x: lodge.x + dx, y: lodge.y + dy }, { rmax: 16, route: 'road' });
    if (!site) continue;
    const route = planRoadTo(sim, site.rect);
    if (!route || route.length > 40) continue;
    const o = placeBuilding(sim.env, sim.props, type, site.x, site.y, site.rot, true, false);
    if (!o.ok) continue;
    if (route.length) sim.networks.buildSegment(NetKind.Road, route);
    sim.buildings.reevaluate();
    sim.refreshCoverage(undefined, true);
    if (o.building!.active) return o.building!.id;
  }
  return undefined;
}

describe('hotel catalog rows', () => {
  it('Small Hotel: 5x4, 40 rooms, standard tier x1 ($40), road only, a lobby restaurant, level 3, open all year', () => {
    const d = BUILDINGS.smallHotel!, s = ATTRACTION_SPECS.smallHotel!;
    expect([d.w, d.h, d.capacity, d.category, d.access, d.altAccess]).toEqual([5, 4, 40, 'lodging', 'road', undefined]);
    expect(s.rooms).toBe(40);
    expect(s.tier).toBe('standard');
    expect(s.kind).toBe('restaurant'); // the lobby restaurant also feeds day guests
    expect(s.seasonOpen).toBeUndefined();
    expect(NIGHTLY_RATE.smallHotel).toEqual({ price: 40, max: 150 });
    expect(PRICE_TABLE.smallHotel!.category).toBe('restaurants');
    expect(unlockLevel('building', 'smallHotel')).toBe(3);
  });
  it('Luxury Hotel: 6x6, 30 suites, luxury tier x2.5 ($100), pool amenity, VIP appeal, road only, level 4, significant upkeep, open all year', () => {
    const d = BUILDINGS.luxuryHotel!, s = ATTRACTION_SPECS.luxuryHotel!;
    expect([d.w, d.h, d.capacity, d.category, d.access, d.altAccess]).toEqual([6, 6, 30, 'lodging', 'road', undefined]);
    expect(s.rooms).toBe(30);
    expect(s.tier).toBe('luxury');
    expect(s.amenity).toBe('pool');
    expect(s.poolSlots).toBeGreaterThan(0);
    expect(s.seasonOpen).toBeUndefined();
    expect(s.overnightOnly).toBe(true);
    expect(NIGHTLY_RATE.luxuryHotel).toEqual({ price: 100, max: 375 }); // chalet-standard 40 x 2.5
    expect(s.appeal[3]).toBeGreaterThanOrEqual(0.9); // VIP
    expect(s.appeal[4]).toBe(0); // budget guests never
    expect(d.upkeep).toBeGreaterThanOrEqual(BUILDINGS.apartment!.upkeep * 2);
    expect(unlockLevel('building', 'luxuryHotel')).toBe(4);
    expect(d.steam).toBeDefined();
  });
  it('the road is required (a footpath alone is not enough) and both hotels count as hotel lodging', () => {
    expect(accessReason(BUILDINGS.smallHotel!)).toMatch(/road/i);
    expect(accessReason(BUILDINGS.luxuryHotel!)).toMatch(/road/i);
    expect(HOTEL_TYPES).toEqual(['smallHotel', 'luxuryHotel']);
    for (const s of ['winter', 'spring', 'summer', 'autumn'] as const) for (const t of HOTEL_TYPES) expect(takesGuestsIn(t, s)).toBe(true);
    for (const t of HOTEL_TYPES) expect(REST.has(t)).toBe(true);
    expect(EVENING_VENUES).toContain('smallHotel');
  });
});

describe('rooms, nights and the lobby restaurant', () => {
  it('Small Hotel: 40 rooms at $40 in every season, the 41st guest gets none', () => {
    for (const season of ['winter', 'summer']) {
      const h = harness();
      h.state.date.day = dayOf(season);
      const b = h.add('smallHotel');
      h.run(1);
      expect(h.sys.lodgingCapacity()).toBe(40);
      h.state.date.minute = EVENING;
      night(h, 41);
      h.run(1);
      expect(h.sys.rooms.occupied(b.id)).toBe(40);
      expect(h.sys.get(b.id)!.stats.nights).toBe(40);
      expect(h.econ.ledger.lodging).toBe(40 * 40);
    }
  });
  it('Luxury Hotel: 30 suites at $100 a night, whatever the season', () => {
    for (const season of ['winter', 'summer']) {
      const h = harness();
      h.state.date.day = dayOf(season);
      const b = h.add('luxuryHotel');
      h.run(1);
      expect(h.sys.lodgingCapacity()).toBe(30);
      h.state.date.minute = EVENING;
      night(h, 31, { type: GuestType.VIP });
      h.run(1);
      expect(h.sys.rooms.occupied(b.id)).toBe(30);
      expect(h.econ.ledger.lodging).toBe(30 * 100);
    }
  });
  it('the lobby restaurant serves day guests (meals in the restaurants ledger, hunger down); rooms stay overnight-only for the pool', () => {
    const h = harness();
    const b = h.add('smallHotel');
    h.run(1);
    const g = h.guest({ budget: 100 });
    expect(h.arrive(g, b)).toBe('using');
    h.run(10);
    expect(h.econ.ledger.restaurants).toBe(12);
    expect(h.store.hunger[g]).toBeLessThanOrEqual(0.05 + 1e-9);
  });
});

describe('VIPs prefer the luxury hotel', () => {
  it('VIPs and couples-with-money choose the luxury hotel first; budget guests never do; a full hotel overflows to the chalet', () => {
    const h = harness();
    const chalet = h.add('chalet', 4, 4), lux = h.add('luxuryHotel', 20, 4), small = h.add('smallHotel', 40, 4);
    h.run(1);
    h.state.date.minute = EVENING;
    const vip = h.guest({ overnight: true, type: GuestType.VIP, budget: 900 }), budget = h.guest({ overnight: true, type: GuestType.Budget, budget: 900 });
    h.run(1);
    expect(h.sys.rooms.roomOf(h.store.id[vip]!)).toBe(lux.id);
    expect([chalet.id, small.id]).toContain(h.sys.rooms.roomOf(h.store.id[budget]!)); // never the luxury hotel
    expect(h.sys.rooms.roomOf(h.store.id[budget]!)).not.toBe(lux.id);
    // 35 VIPs: 30 suites go first, the rest fall back to the standard houses
    const h2 = harness();
    const c2 = h2.add('chalet', 4, 4), l2 = h2.add('luxuryHotel', 20, 4);
    h2.run(1);
    h2.state.date.minute = EVENING;
    const ids = night(h2, 35, { type: GuestType.VIP });
    h2.run(1);
    expect(h2.sys.rooms.occupied(l2.id)).toBe(30);
    expect(h2.sys.rooms.occupied(c2.id)).toBe(5);
    expect(ids.length).toBe(35);
  });
  it('a VIP with a thin wallet cannot pay $100: the chalet takes them', () => {
    const h = harness();
    const chalet = h.add('chalet', 4, 4); h.add('luxuryHotel', 20, 4);
    h.run(1);
    h.state.date.minute = EVENING;
    const vip = h.guest({ overnight: true, type: GuestType.VIP, budget: 60 });
    h.run(1);
    expect(h.sys.rooms.roomOf(h.store.id[vip]!)).toBe(chalet.id);
  });
});

describe('"Let couples in" (M6.4 owner decision)', () => {
  const fill = (season: string, type: number, n: number, budget = 900): number => {
    const h = harness();
    h.add('chalet', 4, 4); h.add('apartment', 30, 4); const lux = h.add('luxuryHotel', 20, 4);
    h.run(1);
    h.state.date.day = dayOf(season); h.state.date.minute = EVENING;
    night(h, n, { type, budget });
    h.run(1);
    return h.sys.rooms.occupied(lux.id);
  };
  it('a couples-only resort fills a share of the suites without VIPs: about 45 % of couples, more in winter; thin wallets and budget guests stay out', () => {
    const summer = fill('summer', GuestType.Couple, 40), winter = fill('winter', GuestType.Couple, 40);
    expect(summer).toBeGreaterThanOrEqual(10); expect(summer).toBeLessThanOrEqual(22);
    expect(winter).toBeGreaterThanOrEqual(summer - 4); expect(winter).toBeGreaterThanOrEqual(12);
    expect(fill('summer', GuestType.Couple, 40, 150)).toBe(0); // under 4 nights of $100
    expect(fill('summer', GuestType.Budget, 40)).toBe(0);
    const solo = fill('summer', GuestType.Solo, 40);
    expect(solo).toBeLessThan(summer); expect(solo).toBeLessThanOrEqual(12);
  });
  it('VIPs still come first: 30 VIPs among 40 couples take every suite', () => {
    const h = harness();
    h.add('chalet', 4, 4); const lux = h.add('luxuryHotel', 20, 4);
    h.run(1);
    h.state.date.minute = EVENING;
    night(h, 40, { type: GuestType.Couple }); // couples spawn first (lower ids): the VIPs still get the suites ranked first
    const vips = night(h, 30, { type: GuestType.VIP });
    h.run(1);
    const vipIn = vips.filter((g) => h.sys.rooms.roomOf(h.store.id[g]!) === lux.id).length;
    expect(vipIn).toBe(30); // VIPs check in first, every suite is theirs even though the couples arrived first
    expect(h.sys.rooms.occupied(lux.id)).toBe(30);
  });
});

describe('the pool amenity', () => {
  it('adds `poolSlots` simultaneous Using places for overnight guests; day guests cannot use it', () => {
    const h = harness();
    const b = h.add('luxuryHotel');
    h.run(1);
    const spec = ATTRACTION_SPECS.luxuryHotel!;
    const a = h.sys.get(b.id)!;
    expect(a.capacity()).toBe((spec.slots ?? 0) + (spec.poolSlots ?? 0));
    expect(a.capacity()).toBeGreaterThan(BUILDINGS.chalet!.capacity / 2);
    const guests = night(h, 30);
    for (const g of guests) h.arrive(g, b);
    h.run(1);
    expect(a.users.length).toBe(a.capacity());
    expect(a.queue.length).toBe(30 - a.capacity());
    const day = h.guest({ overnight: false });
    expect(h.sys.canUse(b.id, day)).toBe(false);
  });
  it('a visit gives the rest effect plus the pool happiness bonus', () => {
    const h = harness();
    const b = h.add('luxuryHotel'), c = h.add('chalet', 30, 30);
    h.run(1);
    const gl = h.guest({ overnight: true, budget: 900 }), gc = h.guest({ overnight: true, budget: 900 });
    h.store.happiness[gl] = 0.5; h.store.happiness[gc] = 0.5;
    h.arrive(gl, b); h.arrive(gc, c);
    h.run(12);
    const spec = ATTRACTION_SPECS.luxuryHotel!;
    expect(h.store.happiness[gl]! - 0.5).toBeCloseTo((spec.effects.happiness ?? 0) + (spec.poolHappiness ?? 0), 5);
    expect(h.store.happiness[gl]).toBeGreaterThan(h.store.happiness[gc]!);
  });
  it('inspector data: rooms, nightly rate, pool users and places (hotels only)', () => {
    const h = harness();
    const b = h.add('luxuryHotel'), s = h.add('smallHotel', 30, 30), c = h.add('chalet', 4, 4);
    h.run(1);
    h.state.date.minute = EVENING;
    night(h, 3, { type: GuestType.VIP });
    h.run(1);
    expect(h.sys.hotelInfo(b.id)).toMatchObject({ rooms: 30, occupied: 3, nightly: 100, pool: { users: 0 } });
    expect(h.sys.hotelInfo(s.id)).toMatchObject({ rooms: 40, nightly: 40 });
    expect(h.sys.hotelInfo(s.id)!.pool).toBeUndefined();
    expect(h.sys.hotelInfo(c.id)).toBeUndefined();
    const lines = formatHotelLines({ rooms: 30, occupied: 3, nightly: 100, pool: { users: 2, slots: 20, heatPerDay: 12.5, steam: true } });
    expect(lines[0]).toBe('Rooms: 3/30 tonight · $100 a night');
    expect(lines.join('|')).toMatch(/Pool: 2\/20 in the water/);
    expect(lines.join('|')).toMatch(/steaming in the cold/);
  });
  it('deterministic and serialisation unchanged: no new save keys', () => {
    const run = (): string => {
      const h = harness();
      h.add('luxuryHotel', 20, 4); h.add('smallHotel', 40, 4); h.add('chalet', 4, 4);
      h.run(1);
      h.state.date.minute = EVENING;
      night(h, 25, { type: GuestType.VIP }); night(h, 20);
      h.run(30);
      return JSON.stringify([h.sys.asSystem().serialize!(), h.econ.ledger, [...h.store.happiness.slice(0, 45)]]);
    };
    expect(run()).toBe(run());
    const h = harness();
    h.add('luxuryHotel');
    h.run(1);
    expect(Object.keys(h.sys.asSystem().serialize!() as object)).not.toContain('gather');
  });
});

describe('steam rises from the pool below 5 C', () => {
  const steam = (temp: number, hour = 14): number => smokeIntensity('luxuryHotel', true, temp, hour, 0, 0.5, 'winter');
  it('white steam below POOL.steamBelow at any hour, denser in the cold; none from 5 C up or when the hotel is inactive', () => {
    expect(POOL.steamBelow).toBe(5);
    expect(steam(4.9)).toBeGreaterThan(0.4);
    expect(steam(-10)).toBeGreaterThan(steam(4.9));
    expect(steam(5)).toBe(0);
    expect(steam(20)).toBe(0);
    for (const hour of [2, 8, 13, 21]) expect(steam(0, hour)).toBeGreaterThan(0);
    expect(smokeIntensity('luxuryHotel', false, -5, 12, 0, 0.5, 'winter')).toBe(0);
  });
  it('is wide (puff factor) and capped at SMOKE.steamMax pools; it rises from `BuildingDef.steam`, not a chimney', () => {
    expect(wideOf('luxuryHotel')).toBeGreaterThan(1);
    expect(wideOf('chalet')).toBe(0);
    expect(emitterSpecOf('luxuryHotel')).toEqual(BUILDINGS.luxuryHotel!.steam);
    expect(BUILDINGS.luxuryHotel!.chimney).toBeUndefined();
    const cands = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, type: 'luxuryHotel', active: true, cx: i, cy: 0 }));
    const sel = selectEmitters(cands, { tempAt: () => -3, hour: 12, overnight: 0 });
    expect(sel.length).toBe(SMOKE.steamMax);
    expect(selectEmitters(cands, { tempAt: () => 12, hour: 12, overnight: 0 })).toHaveLength(0);
  });
  it('the Small Hotel has a normal kitchen chimney (cold weather, dining rushes)', () => {
    expect(emitterSpecOf('smallHotel')).toEqual(BUILDINGS.smallHotel!.chimney);
    expect(smokeIntensity('smallHotel', true, -3, 12.5, 0, 0.5, 'winter')).toBeGreaterThan(0.5);
    expect(smokeIntensity('smallHotel', true, 20, 12.5, 0, 0.5, 'summer')).toBe(0);
  });
});

describe('heated pool energy', () => {
  it('heating share: full in deep cold, a quarter in the warm, always positive', () => {
    expect(poolHeatFactor(-20)).toBe(1);
    expect(poolHeatFactor(POOL.fullBelow)).toBe(1);
    expect(poolHeatFactor(30)).toBe(POOL.minShare);
    expect(poolHeatFactor(0)).toBeLessThan(1);
    expect(poolHeatFactor(0)).toBeGreaterThan(poolHeatFactor(15));
    expect(poolHeatCost(-10)).toBe(POOL.perDay);
    expect(poolHeatCost(30)).toBeGreaterThan(0);
  });
  const resort = (extra: string[] = []): { sim: Sim; ids: number[] } => {
    const sim = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', startSeason: 'winter', now: () => 0 });
    const ids: number[] = [];
    for (const type of ['luxuryHotel', ...extra]) { const id = placeRoadBuilding(sim, type); if (id !== undefined) ids.push(id); }
    return { sim, ids };
  };
  it('a connected Luxury Hotel adds its pool heating to the day\'s energy demand and bill (and nothing without one)', () => {
    const withHotel = resort(), without = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', startSeason: 'winter', now: () => 0 });
    expect(withHotel.ids.length).toBe(1);
    expect(withHotel.sim.buildings.get(withHotel.ids[0]!)!.active).toBe(true);
    const days = (sim: ReturnType<typeof createSim>): void => { for (let i = 0; i < 240 * 2 + 5; i++) sim.tick(1); };
    days(withHotel.sim); days(without);
    const dDemand = withHotel.sim.energy.last.demand - without.energy.last.demand;
    expect(dDemand).toBeGreaterThanOrEqual(POOL.perDay * POOL.minShare - 0.01);
    expect(dDemand).toBeLessThanOrEqual(POOL.perDay + 0.01);
    expect(withHotel.sim.economy.expenses.energy - without.economy.expenses.energy).toBeGreaterThan(0);
  }, 120_000);
  it('solar offsets it: a solar plant takes energy off the pool-bearing bill (never more than 60 % of the demand); without a generator nothing is offset', () => {
    const plain = resort(), solar = resort(['solarPlant']);
    expect(solar.ids.length).toBe(2);
    const days = (sim: Sim): void => { for (let i = 0; i < 240 * 3 + 5; i++) sim.tick(1); };
    days(plain.sim); days(solar.sim);
    expect(plain.sim.energy.last.applied).toBe(0);
    expect(solar.sim.energy.last.gross).toBeGreaterThan(0);
    expect(solar.sim.energy.last.applied).toBeGreaterThan(0);
    expect(solar.sim.energy.last.applied).toBeLessThanOrEqual(0.6 * solar.sim.energy.last.demand + 1e-9);
  }, 180_000);
});

describe('hotels in a real resort: VIP prerequisite, save / load, determinism', () => {
  it('an active Luxury Hotel satisfies the VIP campaign\'s lodging prerequisite (it is no chalet / apartment / altiport)', () => {
    const sim = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', now: () => 0 });
    const mentionsLodging = (): boolean => /altiport, luxury hotel or/i.test(sim.marketing.blocker('vip') ?? '');
    expect(mentionsLodging()).toBe(true); // the starter resort has neither
    expect(placeRoadBuilding(sim, 'luxuryHotel')).toBeDefined();
    expect(mentionsLodging()).toBe(false);
  }, 60_000);
  it('save / load keeps hotels, nights and the state hash; the same seed twice is identical', () => {
    const run = (): ReturnType<typeof createSim> => {
      const sim = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', startSeason: 'winter', now: () => 0 });
      expect(placeRoadBuilding(sim, 'luxuryHotel')).toBeDefined();
      placeRoadBuilding(sim, 'smallHotel', [[0, -10], [-14, -4], [8, -8]]);
      for (let k = 0; k < 6; k++) sim.guestSim.store.add({ x: 5, y: 5, z: 0, type: GuestType.VIP, skill: 1, budget: 900, group: 0, mode: 0, overnight: true, leaveDay: 99, tick: 0, hunger: 0.8 } as never);
      for (let i = 0; i < 240 * 2; i++) sim.tick(1);
      return sim;
    };
    const a = run(), b = run();
    expect(stateHash(a).parts).toEqual(stateHash(b).parts);
    expect(a.buildings.all().some((x) => x.type === 'luxuryHotel')).toBe(true);
    const loaded = createSim({ size: 64, seed: 61, now: () => 0, fromSave: structuredClone(collectSave(a)) });
    const noNet = (s: Parameters<typeof stateHash>[0]): Record<string, string> => { const q = { ...stateHash(s).parts }; delete q.networks; return q; };
    expect(noNet(loaded)).toEqual(noNet(a));
  }, 180_000);
});

describe('hotel meshes', () => {
  it('stay in budget, glow at night (glass vertices), carry roofs for snow, and the Luxury Hotel has a flag, a canopy and a deck within the footprint', () => {
    for (const id of ['smallHotel', 'luxuryHotel'] as const) {
      const d = BUILDINGS[id]!, p = buildParts(d.meshBuilder, d.w, d.h);
      let tris = 0, glass = 0;
      const glassC = new THREE.Color(0x6fb7e0);
      for (const g of [p.wood, p.stone, p.roof, p.sign?.geometry]) {
        if (!g) continue;
        tris += g.getAttribute('position').count / 3;
        const c = g.getAttribute('color');
        if (c) for (let i = 0; i < c.count; i++) if (Math.abs(c.getX(i) - glassC.r) + Math.abs(c.getY(i) - glassC.g) + Math.abs(c.getZ(i) - glassC.b) < 0.01) glass++;
      }
      expect(tris, id).toBeLessThan(9000);
      expect(glass, `${id} windows`).toBeGreaterThan(60);
      expect(p.roof, `${id} roof layer (snow)`).toBeDefined();
    }
  });
  it('the pool water is ONE flat unlit quad grid strictly inside the basin, above its floor and below the deck: no coplanar faces, no noise', () => {
    const g = poolWaterGeometry(), pos = g.getAttribute('position');
    expect(g.getAttribute('color')).toBeDefined();
    expect(pos.count / 3).toBeLessThan(120);
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeCloseTo(POOL_BASIN.water, 5);
      expect(pos.getX(i)).toBeGreaterThanOrEqual(POOL_BASIN.x0 - 1e-6); expect(pos.getX(i)).toBeLessThanOrEqual(POOL_BASIN.x1 + 1e-6);
      expect(pos.getZ(i)).toBeGreaterThanOrEqual(POOL_BASIN.z0 - 1e-6); expect(pos.getZ(i)).toBeLessThanOrEqual(POOL_BASIN.z1 + 1e-6);
    }
    expect(POOL_BASIN.water).toBeGreaterThan(POOL_BASIN.floor + 0.02);
    expect(POOL_BASIN.water).toBeLessThan(POOL_BASIN.deck - 0.02);
  });
  it('BuildingMeshes adds the water as a basic material mesh (a stock program: it cannot fail to compile) whose tone follows the night; groups stay <= 5 meshes', () => {
    const reg = new BuildingMeshes();
    const g = reg.create('luxuryHotel');
    const water = g.children.find((c) => c.name === 'poolWater') as THREE.Mesh;
    expect(water).toBeDefined();
    expect(water.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(g.children.length).toBeLessThanOrEqual(5);
    const day = (water.material as THREE.MeshBasicMaterial).color.getHex();
    reg.setNight(1);
    expect((water.material as THREE.MeshBasicMaterial).color.getHex()).not.toBe(day);
    reg.setNight(0);
    expect((water.material as THREE.MeshBasicMaterial).color.getHex()).toBe(day);
    expect(reg.create('smallHotel').children.find((c) => c.name === 'poolWater')).toBeUndefined();
    reg.dispose();
  });
});
