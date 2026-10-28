/** Phase 6 Task 5: generic tour attraction system (docs/tours.md). Uses a TEST-ONLY dummy tour (no catalogue building yet). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILDINGS, type BuildingDef } from '../../../src/config/buildings';
import { PRICE_TABLE } from '../../../src/config/prices';
import { TOUR_DEFS, TOURS, type TourDef } from '../../../src/config/tours';
import { ATTRACTION_SPECS } from '../../../src/sim/attractions/registry';
import { planRoute, tourSpec, TourSystem } from '../../../src/sim/attractions/Tour';
import { Attraction } from '../../../src/sim/attractions/Attraction';
import { placeBuilding } from '../../../src/sim/PlaceBuilding';
import { createSim, type Sim } from '../../../src/game/createSim';
import { collectSave, applySave, stateHash } from '../../../src/game/saveState';
import { NetKind } from '../../../src/world/Networks';
import { formatAttractionStats } from '../../../src/ui/attractionFormat';
import { GState } from '../../../src/sim/guests/Guest';
import { sustainParts } from '../../../src/sim/meta/Sustainability';

const TEST_TOUR = 'testTour';
const DEF: TourDef = {
  id: TEST_TOUR, routes: ['path'], motorised: false, minLen: 6, maxLen: 14, durationTicks: 15, intervalTicks: 20, firstHour: 9, lastHour: 15,
  seats: 4, minRiders: 1, seasons: ['winter', 'spring', 'summer', 'autumn'], maxWind: 0.8, maxInstability: 0.6, appeal: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
  happiness: 0.1, sustainPerDeparture: 0.2, noiseRadius: 6, vehicle: 'sleigh', vehicles: 2,
};

beforeAll(() => {
  BUILDINGS[TEST_TOUR] = { ...BUILDINGS.cafe!, id: TEST_TOUR, name: 'Test tour', w: 2, h: 2, cost: 100, upkeep: 5, staff: 1, capacity: 4, access: 'none', altAccess: [], pisteRule: 'forbid', site: { ...BUILDINGS.cafe!.site, autoFlatten: 'default' } } as BuildingDef;
  PRICE_TABLE[TEST_TOUR] = { price: 20, max: 60, billing: 'perUse', category: 'recreation' };
  TOUR_DEFS[TEST_TOUR] = DEF;
  (ATTRACTION_SPECS as Record<string, unknown>)[TEST_TOUR] = tourSpec(DEF);
});
afterAll(() => { delete BUILDINGS[TEST_TOUR]; delete PRICE_TABLE[TEST_TOUR]; delete TOUR_DEFS[TEST_TOUR]; delete (ATTRACTION_SPECS as Record<string, unknown>)[TEST_TOUR]; });

interface Site { sim: Sim; id: number; path: Array<{ x: number; y: number }> }
/** A sim with a dummy tour base and a straight footpath of `len` tiles leading away from it (winter). */
function makeSite(len = 10, seed = 61): Site {
  const sim = createSim({ size: 64, seed, now: () => 0, money: 1_000_000 });
  const n = sim.size;
  for (let y = 10; y < n - 10; y++) for (let x = 10; x < n - 26; x++) {
    const path: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < len; k++) path.push({ x: x + 2 + k, y });
    if (!path.every((t) => sim.networks.canBuild(NetKind.Path, t.x, t.y).ok)) continue;
    const o = placeBuilding(sim.env, sim.props, TEST_TOUR, x, y, 0, true, false);
    if (!o.ok) continue;
    if (!path.every((t) => sim.networks.build(NetKind.Path, t.x, t.y))) throw new Error('path failed');
    sim.refreshCoverage(o.building!, true); sim.buildings.reevaluate();
    sim.game.date.day = 20; // winter (Sep-Dec in the authored calendar is checked by the def's seasons: all open)
    return { sim, id: o.building!.id, path };
  }
  throw new Error('no site');
}

const setHour = (sim: Sim, h: number): void => { sim.game.date.minute = Math.round(h * 60); };
const addGuest = (sim: Sim, budget = 500): number => {
  const slot = sim.guestSim.store.add({ x: 1, y: 1, z: 0, type: 0, skill: 1, budget, group: 0, mode: 0, overnight: false, leaveDay: 99, tick: 0 });
  return slot;
};
/** Put a guest into the base's queue exactly like the decision logic does. */
const queueGuest = (s: Site, budget = 500): number => {
  const slot = addGuest(s.sim, budget);
  const b = s.sim.buildings.get(s.id)!;
  const r = s.sim.attractions.arrive(slot, b, s.sim.getSimTick());
  if (r !== 'using') { const a = s.sim.attractions.get(s.id)!; throw new Error(`refused: open=${a.open} ${a.reason} active=${b.active} ${b.reason} serving=${s.sim.attractions.serving(s.id)} price=${a.unitPrice()} budget=${s.sim.guestSim.store.budget[slot]}`); }
  return slot;
};
const tourOf = (s: Site) => s.sim.attractions.get(s.id)!.info().tour!;

describe('route planner (pure)', () => {
  const line = (n: number) => (x: number, y: number): boolean => y === 5 && x >= 3 && x < 3 + n;
  it('finds the shortest path to the farthest tile, from the tiles touching the base', () => {
    const r = planRoute(line(10), { x: 1, y: 5, w: 2, h: 2 }, 32, 4, 20);
    expect(r.ok && r.tiles.length).toBe(10);
    expect(r.ok && r.tiles[0]).toBe(5 * 32 + 3);
  });
  it('respects minLen / maxLen and gives a reason when no route fits', () => {
    expect(planRoute(line(3), { x: 1, y: 5, w: 2, h: 2 }, 32, 6, 20).ok).toBe(false);
    const cap = planRoute(line(30), { x: 1, y: 5, w: 2, h: 2 }, 32, 4, 12);
    expect(cap.ok && cap.tiles.length).toBe(12);
    const none = planRoute(() => false, { x: 1, y: 5, w: 2, h: 2 }, 32, 4, 12);
    expect(none.ok).toBe(false);
  });
  it('is deterministic and picks the longer branch at a fork', () => {
    const fork = (x: number, y: number): boolean => (y === 5 && x >= 3 && x < 8) || (x === 7 && y > 5 && y < 12) || (x === 7 && y < 5 && y > 3);
    const a = planRoute(fork, { x: 1, y: 5, w: 2, h: 2 }, 32, 4, 30), b = planRoute(fork, { x: 1, y: 5, w: 2, h: 2 }, 32, 4, 30);
    expect(a).toEqual(b);
    expect(a.ok && a.tiles[a.tiles.length - 1]).toBe(11 * 32 + 7);
  });
});

describe('tour base in the sim', () => {
  it('plans a route along the attached footpath and the base is a tour attraction', () => {
    const s = makeSite(10);
    setHour(s.sim, 6); s.sim.tick(1);
    expect(s.sim.tours.route(s.id).length).toBe(10);
    const a = s.sim.attractions.get(s.id)!;
    expect(a.spec.tour).toBe(TEST_TOUR);
    expect(a.open).toBe(true);
  });

  it('boards at the scheduled departure only: seats cap the riders, the rest wait for the next one; riders pay and return happier', () => {
    const s = makeSite(10), { sim } = s;
    setHour(sim, 8.2); sim.tick(1);
    const slots = [0, 1, 2, 3, 4, 5].map(() => queueGuest(s));
    const store = sim.guestSim.store, b0 = slots.map((k) => store.budget[k]!), h0 = slots.map((k) => store.happiness[k]!);
    sim.tick(3); // still before 09:00: nobody left
    expect(tourOf(s).departuresToday).toBe(0);
    setHour(sim, 8.95); sim.tick(2);
    let t = tourOf(s);
    expect(t.departuresToday).toBe(1);
    expect(t.ridersToday).toBe(4); // seats
    expect(t.revenueToday).toBe(80);
    expect(t.riding).toBe(4);
    expect(slots.filter((k) => store.budget[k]! < 500).length).toBe(4); // charged on boarding
    expect(sim.attractions.get(s.id)!.queue.length).toBe(2);
    expect(slots.slice(0, 4).every((k) => store.state[k] === GState.Using)).toBe(true);
    // the ride takes 15 ticks (1.5 h): back by 10:30; the next departure is 20 ticks (2 h) after the first
    sim.tick(16);
    const back = slots.slice(0, 4);
    expect(back.every((k) => store.state[k] !== GState.Using)).toBe(true);
    for (const k of back) expect(store.happiness[k]!).toBeGreaterThan(h0[slots.indexOf(k)]!);
    expect(sim.attractions.get(s.id)!.stats.served).toBe(4);
    expect(tourOf(s).riding).toBe(0);
    setHour(sim, 10.7); sim.tick(1);
    expect(tourOf(s).departuresToday).toBe(1); // 11:00 not yet
    expect(tourOf(s).next).toEqual({ hour: 11, tomorrow: false });
    setHour(sim, 10.98); sim.tick(2);
    t = tourOf(s);
    expect(t.departuresToday).toBe(2);
    expect(t.ridersToday).toBe(6);
    expect(t.revenueToday).toBe(120);
    expect(sim.attractions.get(s.id)!.queue.length).toBe(0);
    void b0;
  });

  it('an empty departure does not leave and burns its slot: a guest arriving after 09:00 waits for 11:00', () => {
    const s = makeSite(10), { sim } = s;
    setHour(sim, 8.6); sim.tick(1);
    sim.tick(4); // crosses 09:00 with an empty queue
    expect(tourOf(s).departuresToday).toBe(0);
    queueGuest(s);
    sim.tick(3);
    expect(tourOf(s).departuresToday).toBe(0);
    setHour(sim, 10.7); sim.tick(1);
    queueGuest(s);
    sim.tick(4); // crosses 11:00
    const t = tourOf(s);
    expect(t.departuresToday).toBe(1);
    expect(t.ridersToday).toBe(2);
  });

  it('after the last departure guests are turned away instead of queueing, and the schedule rolls to tomorrow', () => {
    const s = makeSite(10), { sim } = s;
    setHour(sim, 16.5); sim.tick(1);
    expect(sim.attractions.serving(s.id)).toBe(false);
    expect(tourOf(s).next).toEqual({ hour: 9, tomorrow: true });
    const slot = addGuest(sim);
    sim.attractions.arrive(slot, sim.buildings.get(s.id)!, sim.getSimTick());
    expect(sim.attractions.get(s.id)!.queue.length).toBe(0);
    expect(sim.attractions.get(s.id)!.stats.turnedAway).toBe(1);
  });
});

describe('closures', () => {
  const open = (s: Site) => { const a = s.sim.attractions.refreshOpen(s.id)!; return { open: a.open, reason: a.reason }; };
  it('storm wind closes the tour, sends the queue home, lets rides in progress finish, and it reopens', () => {
    const s = makeSite(10), { sim } = s, store = sim.guestSim.store;
    setHour(sim, 8.6); sim.tick(1);
    const rider = queueGuest(s);
    sim.tick(3); // crosses 09:00 // 09:00 departure takes the rider
    expect(store.state[rider]).toBe(GState.Using);
    const waiter = queueGuest(s);
    sim.weather.current.wind = 1; sim.weather.current.kind = 'storm';
    sim.tick(TOURS.checkEvery);
    expect(open(s)).toEqual({ open: false, reason: 'Closed: too windy' });
    expect(store.state[waiter]).not.toBe(GState.Using); // queue released, no death, no loss
    expect(store.alive[waiter]).toBe(1);
    expect(store.state[rider]).toBe(GState.Using); // the ride in progress is not cut short
    sim.tick(16);
    expect(store.state[rider]).not.toBe(GState.Using);
    expect(store.alive[rider]).toBe(1);
    expect(sim.attractions.get(s.id)!.stats.served).toBe(1);
    sim.weather.current.wind = 0; sim.weather.current.kind = 'clear';
    sim.tick(TOURS.checkEvery + 1);
    expect(open(s).open).toBe(true);
  });

  it('avalanche instability on a route tile closes it (and a quiet slope does not)', () => {
    const s = makeSite(10), { sim } = s;
    setHour(sim, 6); sim.tick(1);
    expect(open(s).open).toBe(true);
    const tile = sim.tours.route(s.id)[4]!;
    sim.safety.avalanche.inst[tile] = 0.3;
    sim.tick(TOURS.checkEvery + 1);
    expect(open(s).open).toBe(true);
    sim.safety.avalanche.inst[tile] = 1.4;
    sim.tick(TOURS.checkEvery + 1);
    expect(open(s)).toEqual({ open: false, reason: 'Closed: avalanche danger on the route' });
    sim.safety.avalanche.inst[tile] = 0;
    sim.tick(TOURS.checkEvery + 1);
    expect(open(s).open).toBe(true);
  });

  it('a season outside the def closes it ("Closed for the season")', () => {
    TOUR_DEFS[TEST_TOUR] = { ...DEF, seasons: ['summer'] };
    try {
      const s = makeSite(10), { sim } = s;
      sim.game.date.day = 10; // winter in the authored calendar (see Clock): the def only runs in summer
      sim.tick(1);
      expect(open(s)).toEqual({ open: false, reason: 'Closed for the season' });
      sim.game.date.day = 40; // June = summer (day 0 = 1 April)
      sim.tick(1);
      expect(open(s).open).toBe(true);
    } finally { TOUR_DEFS[TEST_TOUR] = DEF; }
  });

  it('removing a route tile breaks the route: too short = closed, nobody hurt, riders finish; the route comes back when rebuilt', () => {
    const s = makeSite(10), { sim } = s, store = sim.guestSim.store;
    setHour(sim, 8.6); sim.tick(1);
    const rider = queueGuest(s);
    sim.tick(3); // crosses 09:00
    expect(store.state[rider]).toBe(GState.Using);
    const cut = s.path[2]!; // 3 tiles remain next to the base (< minLen 6)
    sim.networks.unbuild(cut.x, cut.y);
    sim.tick(1);
    expect(sim.tours.route(s.id)).toEqual([]); // 3 tiles left: no valid route
    expect(open(s).open).toBe(false);
    expect(open(s).reason).toMatch(/^Closed: Needs a connected route/);
    expect(store.state[rider]).toBe(GState.Using);
    sim.tick(16);
    expect(store.alive[rider]).toBe(1);
    expect(store.state[rider]).not.toBe(GState.Using);
    sim.networks.build(NetKind.Path, cut.x, cut.y);
    sim.tick(TOURS.checkEvery + 1);
    expect(open(s).open).toBe(true);
    expect(sim.tours.route(s.id).length).toBe(10);
  });

  it('removing the base cancels the tour: queue and riders go home, state is dropped', () => {
    const s = makeSite(10), { sim } = s, store = sim.guestSim.store;
    setHour(sim, 8.6); sim.tick(1);
    const rider = queueGuest(s);
    sim.tick(3); // crosses 09:00
    const waiter = queueGuest(s);
    expect(sim.tours.isEmpty).toBe(false);
    sim.buildings.remove(s.id);
    sim.tick(2);
    for (const k of [rider, waiter]) { expect(store.alive[k]).toBe(1); expect(store.state[k]).not.toBe(GState.Using); }
    expect(sim.tours.isEmpty).toBe(true);
    expect(sim.tours.carriers(sim.getSimTick())).toEqual([]);
  });
});

describe('TourSystem with synthetic deps (water / motorised / fauna)', () => {
  const N = 32;
  const base = { id: 7, type: TEST_TOUR, x: 1, y: 5, w: 2, h: 2, active: true, rot: 0 } as never;
  const mk = (over: Partial<import('../../../src/sim/attractions/Tour').TourDeps> = {}, def: Partial<TourDef> = {}) => {
    const d = { ...DEF, ...def };
    TOUR_DEFS[TEST_TOUR] = d;
    const deps = {
      size: N, allows: (k: string, x: number, y: number) => (k === 'path' || k === 'water') && y === 5 && x >= 3 && x < 15, isPiste: () => false, version: () => 1,
      instability: () => 0, weather: () => ({ wind: 0 }), ...over,
    } as import('../../../src/sim/attractions/Tour').TourDeps;
    const tours = new TourSystem(deps);
    const a = new Attraction(base, tourSpec(d));
    tours.setContext({ tick: 100, day: 20, absDay: 20, hour: 10 });
    return { tours, a, d };
  };
  afterAll(() => { TOUR_DEFS[TEST_TOUR] = DEF; });

  it('water routes: stub says how to get a river; a working validator closes the tour when the water is frozen', () => {
    const stub = mk({}, { routes: ['water'] });
    expect(stub.tours.closed(stub.a)).toBe(`Closed: ${TOURS.waterStub}`);
    // a validator that accepts water tiles (what Task 24 will provide) + frozen verdicts
    let frozen = false;
    const ok = mk({ frozen: () => frozen }, { routes: ['water', 'path'] });
    expect(ok.tours.closed(ok.a)).toBeNull();
    frozen = true;
    ok.tours.setContext({ tick: 200, day: 20, absDay: 20, hour: 10 });
    expect(ok.tours.closed(ok.a)).toBe('Closed: the river is frozen');
  });

  it('motorised tours never route over piste tiles and scare wildlife along the route at each departure', () => {
    const calls: Array<[number, number, number]> = [];
    const m = mk({ isPiste: (x) => x === 9, disturb: (x, y, r) => { calls.push([x, y, r]); } }, { motorised: true, noiseRadius: 5, minLen: 4 });
    expect(m.tours.closed(m.a)).toBeNull();
    expect(m.tours.route(7).length).toBe(6); // tiles 3..8: stops in front of the piste at x = 9
    expect(m.tours.route(7).every((i) => i % N !== 9)).toBe(true);
    m.tours.departed(m.a, 3, 60, 15);
    expect(calls.length).toBe(Math.ceil(6 / TOURS.noiseEvery));
    expect(calls.every((c) => c[2] === 5)).toBe(true);
    const quiet = mk({ isPiste: (x) => x === 9, disturb: (x, y, r) => { calls.push([x, y, r]); } }, { motorised: false, minLen: 4 });
    const before = calls.length;
    expect(quiet.tours.closed(quiet.a)).toBeNull();
    quiet.tours.departed(quiet.a, 3, 60, 15);
    expect(calls.length).toBe(before); // quiet tours leave wildlife alone
    expect(quiet.tours.route(7).length).toBe(12); // may cross x = 9
  });

  it('sustainability: the motorised penalty is capped at 3 points, 4 scooters all day stay below it, quiet tours cost nothing', () => {
    const m = mk({}, { motorised: true, firstHour: 8, lastHour: 17, intervalTicks: 10, sustainPerDeparture: 0.2 });
    m.tours.closed(m.a);
    for (let k = 0; k < 10; k++) m.tours.departed(m.a, 8, 160, 8); // a departure every hour, 08:00-17:00
    expect(m.tours.motorPenalty()).toBe(2);
    expect(m.tours.motorPenalty()).toBeLessThanOrEqual(3);
    for (let k = 0; k < 100; k++) m.tours.departed(m.a, 8, 160, 8);
    expect(m.tours.motorPenalty()).toBe(TOURS.maxSustainPenalty);
    const q = mk({}, { motorised: false });
    q.tours.closed(q.a); q.tours.departed(q.a, 4, 80, 8);
    expect(q.tours.motorPenalty()).toBe(0);
    // the facet: exactly the penalty, never more than 3, and nothing changes without it
    const raw = { energyPerGuest: 1, treeLoss: 0, habitatOverlap: 0.1, protection: 0 };
    const base0 = sustainParts(raw).score;
    expect(sustainParts({ ...raw, motor: 0 }).score).toBe(base0);
    expect(base0 - sustainParts({ ...raw, motor: 2 }).score).toBeCloseTo(2, 5);
    expect(base0 - sustainParts({ ...raw, motor: 99 }).score).toBeCloseTo(3, 5);
  });

  it('cosmetic carriers are capped, follow the route out and back, and cost nothing without rides', () => {
    const m = mk({}, { vehicles: 3 });
    m.tours.closed(m.a);
    expect(m.tours.carriers(100)).toEqual([]);
    m.tours.departed(m.a, 6, 120, 20); // ride [100, 120)
    const mid = m.tours.carriers(110), start = m.tours.carriers(101), end = m.tours.carriers(119);
    expect(mid.length).toBe(3);
    expect(Math.max(...mid.map((c) => c.x))).toBeGreaterThan(Math.max(...start.map((c) => c.x)));
    expect(Math.max(...end.map((c) => c.x))).toBeLessThan(Math.max(...mid.map((c) => c.x)));
    expect(mid[0]!.kind).toBe('sleigh');
    for (let k = 0; k < 40; k++) m.tours.departed(m.a, 6, 120, 20);
    expect(m.tours.carriers(110).length).toBeLessThanOrEqual(TOURS.maxCarriers);
    expect(m.tours.carriers(110, [], 5).length).toBe(5);
    expect(m.tours.carriers(130)).toEqual([]); // rides ended
  });

  it('[perf] 20 tour bases cost well under 0.2 ms per tick (closed + due + info)', () => {
    const m = mk({});
    const bases = Array.from({ length: 20 }, (_, k) => new Attraction({ ...(base as object), id: 100 + k, y: 5 } as never, tourSpec(m.d)));
    let best = Infinity;
    for (let rep = 0; rep < 5; rep++) {
      const t0 = performance.now();
      for (let tick = 0; tick < 2000; tick++) {
        m.tours.setContext({ tick, day: 20, absDay: 20, hour: 9 + (tick % 240) / 10 / 1.2 % 8 });
        for (const a of bases) { m.tours.closed(a); m.tours.due(a, 3); }
      }
      best = Math.min(best, (performance.now() - t0) / 2000);
    }
    expect(best).toBeLessThan(0.2);
  });
});

describe('determinism and saves', () => {
  const play = (s: Site): void => {
    setHour(s.sim, 8.9); s.sim.tick(1);
    for (let k = 0; k < 6; k++) queueGuest(s);
    s.sim.tick(60);
    for (let k = 0; k < 3; k++) queueGuest(s);
    s.sim.tick(80);
  };
  it('same seed + same inputs = same stateHash (incl. the tours module)', () => {
    const a = makeSite(10), b = makeSite(10);
    play(a); play(b);
    expect(tourOf(a).totalDepartures).toBeGreaterThan(0);
    expect(stateHash(a.sim).hash).toBe(stateHash(b.sim).hash);
    expect(stateHash(a.sim).parts.tours).toBeDefined();
  });
  it('a resort without a tour base leaves the module out of stateHash (older goldens stay identical) but still saves it', () => {
    const sim = createSim({ size: 64, seed: 3, now: () => 0 });
    sim.tick(5);
    expect(stateHash(sim).parts.tours).toBeUndefined();
    expect(collectSave(sim).tours).toEqual({ v: 1, data: null });
  });
  it('round-trips through collectSave / applySave: counters survive, riders are released, play continues identically to the control', () => {
    const s = makeSite(10);
    play(s);
    const before = tourOf(s);
    expect(before.totalDepartures).toBeGreaterThan(0);
    const mods = structuredClone(collectSave(s.sim));
    const fresh = createSim({ size: 64, seed: 61, now: () => 0, money: 1_000_000, fromSave: structuredClone(mods) });
    const ctl = s.sim;
    applySave(ctl, structuredClone(mods)); // control: the live sim with the documented demotions
    const a = fresh.attractions.get(s.id)!, c = ctl.attractions.get(s.id)!;
    fresh.tick(1); ctl.tick(1);
    expect(a.info().tour!.totalDepartures).toBe(before.totalDepartures);
    expect(a.info().tour!.totalRevenue).toBe(before.totalRevenue);
    expect(a.info().tour!.departuresToday).toBe(c.info().tour!.departuresToday);
    expect(a.info().tour!.riding).toBe(0); // rides in progress are not restored
    for (let k = 0; k < 8; k++) { fresh.tick(20); ctl.tick(20); expect(stateHash(fresh).parts.tours, `after ${(k + 1) * 20} ticks`).toBe(stateHash(ctl).parts.tours); }
  });
  it('the tours module serialises to plain JSON data', () => {
    const s = makeSite(10);
    play(s);
    expect(JSON.parse(JSON.stringify(collectSave(s.sim).tours))).toEqual(collectSave(s.sim).tours);
  });
});

describe('tour inspector', () => {
  it('shows departures today, riders, revenue, next departure and the route', () => {
    const s = makeSite(10), { sim } = s;
    setHour(sim, 8.6); sim.tick(1);
    queueGuest(s); queueGuest(s);
    sim.tick(3);
    const lines = formatAttractionStats(sim.attractions.get(s.id)!.info());
    expect(lines.join('\n')).toContain('Departures today: 1 · 2 riders · $40');
    expect(lines.join('\n')).toContain('Next departure: 11:00');
    expect(lines.join('\n')).toContain('Route: 10 tiles out and back');
  });
});
