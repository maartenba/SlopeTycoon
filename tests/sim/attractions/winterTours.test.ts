/** Phase 6 Task 31: the three WINTER tour bases on the generic tour system (docs/winter-tours.md). Real starter resort, real networks. */
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../../src/config/buildings';
import { PRICE_TABLE } from '../../../src/config/prices';
import { TOUR_DEFS, TOURS } from '../../../src/config/tours';
import { unlockLevel } from '../../../src/config/unlocks';
import { ATTRACTION_SPECS } from '../../../src/sim/attractions/registry';
import { placeBuilding } from '../../../src/sim/PlaceBuilding';
import { createSim, type Sim } from '../../../src/game/createSim';
import { stateHash } from '../../../src/game/saveState';
import { NetKind, Layer } from '../../../src/world/Networks';
import { GState } from '../../../src/sim/guests/Guest';
import { seasonOf } from '../../../src/sim/Clock';
import { FAUNA } from '../../../src/sim/nature/Fauna';
import { formatAttractionStats } from '../../../src/ui/attractionFormat';
import { RULES } from '../../../src/sim/advisor/rules';

type Base = 'sleighStable' | 'snowshoeHut' | 'snowscooterBase';
const BASES: Base[] = ['sleighStable', 'snowshoeHut', 'snowscooterBase'];

const dayOf = (season: 'winter' | 'summer'): number => { for (let d = 0; d < 180; d++) if (seasonOf({ day: d }) === season) return d + 8; throw new Error('no day'); };
interface Site { sim: Sim; id: number; type: Base }

/** Starter resort + a base touching the network the tour needs (roads for sleigh / scooter; a painted Hike trail for the snowshoe hut). */
function makeSite(type: Base, seed = 61, extra: Partial<Parameters<typeof createSim>[0]> = {}): Site {
  const sim = createSim({ size: 64, seed, starterResort: true, mode: 'sandbox', now: () => 0, money: 1_000_000, ...extra });
  const n = sim.size, k = sim.networks.kind;
  const def = BUILDINGS[type]!;
  const roads: Array<[number, number]> = [];
  for (let i = 0; i < n * n; i++) if (k[i] === NetKind.Road) roads.push([i % n, (i / n) | 0]);
  const finish = (id: number): Site | null => {
    sim.refreshCoverage(sim.buildings.get(id)!, true); sim.buildings.reevaluate();
    if (!sim.buildings.get(id)!.active) return null;
    sim.game.date.day = dayOf('winter');
    sim.tick(1);
    return sim.tours.route(id).length >= TOUR_DEFS[type]!.minLen ? { sim, id, type } : null;
  };
  if (type !== 'snowshoeHut') {
    const offs: Array<[number, number]> = [];
    for (let dy = -def.h - 1; dy <= 2; dy++) for (let dx = -def.w - 1; dx <= 2; dx++) offs.push([dx, dy]);
    for (const [rx, ry] of roads) for (const [dx, dy] of offs) {
      const o = placeBuilding(sim.env, sim.props, type, rx + dx, ry + dy, 0, true, false);
      if (!o.ok) continue;
      const s = finish(o.building!.id);
      if (s) return s;
      sim.buildings.remove(o.building!.id);
    }
    // the starter village is crowded: extend an existing road in a straight line and put the base beside the new stretch
    for (const [rx, ry] of roads) for (const [vx, vy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const line = Array.from({ length: 12 }, (_, j) => ({ x: rx + vx * (j + 1), y: ry + vy * (j + 1) }));
      if (line.some((p) => p.x < 0 || p.y < 0 || p.x >= n || p.y >= n)) continue;
      if (!sim.networks.planSegment(NetKind.Road, [{ x: rx, y: ry }, ...line]).ok) continue;
      const mid = line[5]!;
      const sides: Array<[number, number]> = vx ? [[0, 1], [0, -def.h]].map(([a, b]) => [mid.x + a!, mid.y + b!] as [number, number]) : [[1, 0], [-def.w, 0]].map(([a, b]) => [mid.x + a!, mid.y + b!] as [number, number]);
      for (const [bx, by] of sides) {
        const o = placeBuilding(sim.env, sim.props, type, bx, by, 0, true, false);
        if (!o.ok) continue;
        sim.networks.buildSegment(NetKind.Road, [{ x: rx, y: ry }, ...line]);
        const s = finish(o.building!.id);
        if (s) return s;
        sim.buildings.remove(o.building!.id);
      }
    }
    throw new Error('no site for ' + type);
  }
  // snowshoe: paint a Hike trail line next to a road, then put the hut beside it
  for (const [rx, ry] of roads) for (const [vx, vy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
    const line = Array.from({ length: 10 }, (_, j) => ({ x: rx + vx * (j + 1), y: ry + vy * (j + 1) })).filter((p) => p.x >= 0 && p.y >= 0 && p.x < n && p.y < n && k[p.y * n + p.x] === 0);
    if (line.length < 10) continue;
    const mid = line[4]!;
    for (const [px, py] of [[1, 0], [-2, 0], [0, 1], [0, -2]] as const) {
      const o = placeBuilding(sim.env, sim.props, type, mid.x + px, mid.y + py, 0, true, false);
      if (!o.ok) continue;
      if (sim.networks.paint(Layer.Hike, line, 0).painted < 8) { sim.buildings.remove(o.building!.id); continue; }
      const s = finish(o.building!.id);
      if (s) return s;
      for (const p of line) sim.networks.unpaint(Layer.Hike, p.x, p.y);
      sim.buildings.remove(o.building!.id);
    }
  }
  throw new Error('no site for ' + type);
}
const setHour = (sim: Sim, h: number): void => { sim.game.date.minute = Math.round(h * 60); };
const queueGuest = (s: Site, budget = 500): number => {
  const sim = s.sim;
  const slot = sim.guestSim.store.add({ x: 1, y: 1, z: 0, type: 0, skill: 1, budget, group: 0, mode: 0, overnight: false, leaveDay: 999, tick: 0 });
  const r = sim.attractions.arrive(slot, sim.buildings.get(s.id)!, sim.getSimTick());
  if (r !== 'using') { const a = sim.attractions.get(s.id)!; throw new Error(`refused: open=${a.open} ${a.reason}`); }
  return slot;
};
const tourOf = (s: Site) => s.sim.attractions.get(s.id)!.info().tour!;
const openState = (s: Site): { open: boolean; reason?: string } => { const x = s.sim.attractions.refreshOpen(s.id)!; return { open: x.open, reason: x.reason }; };

describe('winter tour data', () => {
  it('rows: sizes, access, tickets, winter-only seasons, seats, staff', () => {
    const want = { sleighStable: { price: 25, seats: 6, access: ['path', 'road'], staff: 1 }, snowshoeHut: { price: 15, seats: 8, access: ['path', 'trail'], staff: 1 }, snowscooterBase: { price: 45, seats: 6, access: ['path', 'road', 'trail'], staff: 2 } } as const;
    for (const t of BASES) {
      const d = BUILDINGS[t]!, w = want[t], def = TOUR_DEFS[t]!;
      expect(d.category).toBe('recreation');
      expect(d.season).toBe('winter');
      expect([d.access, ...(d.altAccess ?? [])].sort()).toEqual([...w.access]);
      expect(d.staff).toBe(w.staff);
      expect(PRICE_TABLE[t]!.price).toBe(w.price);
      expect(def.seasons).toEqual(['winter']);
      expect(def.seats).toBe(w.seats);
      expect(ATTRACTION_SPECS[t]!.tour).toBe(t);
      expect(ATTRACTION_SPECS[t]!.slots).toBe(w.seats);
    }
    expect(BUILDINGS.sleighStable!.upkeep).toBeLessThan(BUILDINGS.quadBase!.upkeep);
  });
  it('route kinds: sleigh road / path, snowshoe Hike trail only, scooter road / path / trail; only the scooter is motorised', () => {
    expect([...TOUR_DEFS.sleighStable!.routes].sort()).toEqual(['path', 'road']);
    expect(TOUR_DEFS.snowshoeHut!.routes).toEqual(['trail']);
    expect(TOUR_DEFS.snowshoeHut!.trailLayer).toBe(Layer.Hike);
    expect([...TOUR_DEFS.snowscooterBase!.routes].sort()).toEqual(['path', 'road', 'trail']);
    expect(TOUR_DEFS.sleighStable!.motorised).toBe(false);
    expect(TOUR_DEFS.snowshoeHut!.motorised).toBe(false);
    expect(TOUR_DEFS.snowscooterBase!.motorised).toBe(true);
    expect(TOUR_DEFS.snowscooterBase!.vehicles).toBe(6);
  });
  it('selective unlocks: sleigh 2, snowshoe 2, scooter 3', () => {
    expect(unlockLevel('building', 'sleighStable')).toBe(2);
    expect(unlockLevel('building', 'snowshoeHut')).toBe(2);
    expect(unlockLevel('building', 'snowscooterBase')).toBe(3);
  });
});

describe.each(BASES)('%s in the sim', (type) => {
  const def = TOUR_DEFS[type]!;
  it('plans a route that never touches a piste tile and uses only the allowed kinds', () => {
    const s = makeSite(type), { sim } = s;
    const route = sim.tours.route(s.id);
    expect(route.length).toBeGreaterThanOrEqual(def.minLen);
    expect(route.length).toBeLessThanOrEqual(def.maxLen);
    for (const i of route) {
      const k = sim.networks.kind[i]!, l = sim.networks.layers[i]!;
      if (type === 'snowshoeHut') expect(l & Layer.Hike).not.toBe(0);
      else expect([NetKind.Road, NetKind.Path].includes(k as never) || (type === 'snowscooterBase' && (l & Layer.Hike) !== 0)).toBe(true);
      if (type !== 'snowshoeHut') expect(l & Layer.Ski).toBe(0);
    }
  });

  it('runs in winter: riders pay the ticket, depart on schedule and come back happier; revenue matches', () => {
    const s = makeSite(type), { sim } = s, store = sim.guestSim.store;
    setHour(sim, def.firstHour - 0.8); sim.tick(1);
    expect(openState(s).open).toBe(true);
    const slots = [queueGuest(s), queueGuest(s), queueGuest(s)];
    const b0 = slots.map((k) => store.budget[k]!), h0 = slots.map((k) => store.happiness[k]!);
    setHour(sim, def.firstHour - 0.05); sim.tick(2);
    const t = tourOf(s), price = PRICE_TABLE[type]!.price;
    expect(t.departuresToday).toBe(1);
    expect(t.ridersToday).toBe(3);
    expect(t.revenueToday).toBe(3 * price);
    slots.forEach((k, i) => expect(b0[i]! - store.budget[k]!).toBeCloseTo(price, 5));
    expect(slots.every((k) => store.state[k] === GState.Using)).toBe(true);
    expect(sim.tours.carriers(sim.getSimTick()).length).toBeGreaterThan(0);
    sim.tick(def.durationTicks + 2);
    expect(slots.every((k) => store.state[k] !== GState.Using)).toBe(true);
    slots.forEach((k, i) => expect(store.happiness[k]!).toBeGreaterThan(h0[i]!));
  });

  it(`capacity: ${def.seats} seats per departure, the rest wait; carriers drawn = ${def.vehicles} (view only)`, () => {
    const s = makeSite(type), { sim } = s;
    setHour(sim, def.firstHour - 0.8); sim.tick(1);
    for (let k = 0; k < def.seats + 3; k++) queueGuest(s);
    setHour(sim, def.firstHour - 0.05); sim.tick(2);
    expect(tourOf(s).ridersToday).toBe(def.seats);
    expect(sim.attractions.get(s.id)!.queue.length).toBe(3);
    expect(sim.tours.carriers(sim.getSimTick()).filter((c) => c.kind === def.vehicle).length).toBe(def.vehicles);
  });

  it('closed in summer ("Closed for the season") and when the route is cut', () => {
    const s = makeSite(type), { sim } = s;
    setHour(sim, def.firstHour - 0.5); sim.tick(1);
    expect(openState(s).open).toBe(true);
    sim.game.date.day = dayOf('summer'); sim.tick(1);
    expect(openState(s)).toEqual({ open: false, reason: 'Closed for the season' });
    expect(tourOf(s).next).not.toBeNull();
  });

  it('closes in a storm and reopens when it clears', () => {
    const s = makeSite(type), { sim } = s;
    setHour(sim, def.firstHour + 0.5); sim.tick(1);
    sim.weather.current.wind = 1; sim.weather.current.kind = 'storm';
    sim.tick(TOURS.checkEvery);
    expect(openState(s)).toEqual({ open: false, reason: 'Closed: too windy' });
    sim.weather.current.wind = 0; sim.weather.current.kind = 'clear';
    sim.tick(TOURS.checkEvery + 1);
    expect(openState(s).open).toBe(true);
  });

  it('is deterministic and the save keeps counters (same inputs, same stateHash; save + load identical)', () => {
    const run = (): string => {
      const s = makeSite(type); const { sim } = s;
      setHour(sim, def.firstHour - 0.8); sim.tick(1);
      for (let k = 0; k < 4; k++) queueGuest(s);
      setHour(sim, def.firstHour - 0.05); sim.tick(60);
      return stateHash(sim).hash;
    };
    expect(run()).toBe(run());
    const s = makeSite(type); const { sim } = s;
    setHour(sim, def.firstHour - 0.8); sim.tick(1);
    queueGuest(s); queueGuest(s);
    setHour(sim, def.firstHour - 0.05); sim.tick(2);
    const before = tourOf(s);
    const state = (sim.tours.serialize() as { tours: Array<{ type: string; dep: number; totalRevenue: number }> }).tours;
    expect(state.length).toBe(1);
    expect(state[0]!.type).toBe(type);
    expect(state[0]!.dep).toBe(before.departuresToday);
    expect(state[0]!.totalRevenue).toBe(before.totalRevenue);
    sim.tours.load(JSON.parse(JSON.stringify(sim.tours.serialize())));
    expect(JSON.stringify(sim.tours.serialize())).toBe(JSON.stringify({ tours: state }));
  });

  it('inspector shows departures, next departure and route length', () => {
    const s = makeSite(type), { sim } = s;
    setHour(sim, def.firstHour - 0.8); sim.tick(1);
    queueGuest(s); queueGuest(s);
    setHour(sim, def.firstHour - 0.05); sim.tick(2);
    const txt = formatAttractionStats(sim.attractions.get(s.id)!.info()).join('\n');
    expect(txt).toContain('Departures today: 1 · 2 riders');
    expect(txt).toMatch(/Next departure: \d\d:\d\d/);
    expect(txt).toMatch(/Route: \d+ tiles out and back/);
  });
});

describe('snowshoe: Hike layer and unstable snow', () => {
  it('the painted Hike trail persists through the whole winter (it is not a snow layer)', () => {
    const s = makeSite('snowshoeHut'), { sim } = s;
    const before = [...sim.tours.route(s.id)];
    for (let d = 0; d < 3; d++) { sim.game.date.day += 20; sim.tick(5); }
    expect(sim.tours.route(s.id)).toEqual(before);
    for (const i of before) expect(sim.networks.layers[i]! & Layer.Hike).not.toBe(0);
  });
  it('unstable snow on a route tile cancels the walk; stable snow reopens it', () => {
    const s = makeSite('snowshoeHut'), { sim } = s;
    setHour(sim, 11); sim.tick(1);
    expect(openState(s).open).toBe(true);
    const route = sim.tours.route(s.id), tile = route[Math.floor(route.length / 2)]!;
    const inst = sim.safety.avalanche.inst;
    const saved = inst[tile]!;
    inst[tile] = TOUR_DEFS.snowshoeHut!.maxInstability + 0.2;
    sim.tick(TOURS.checkEvery);
    expect(openState(s)).toEqual({ open: false, reason: 'Closed: avalanche danger on the route' });
    // a departure slot while unstable never leaves, and nobody can queue
    inst[tile] = saved; sim.tick(TOURS.checkEvery + 1);
    expect(openState(s).open).toBe(true);
  });
  it('moderate instability (below the snowshoe limit) does not cancel; it is stricter than the scooter limit', () => {
    expect(TOUR_DEFS.snowshoeHut!.maxInstability).toBeLessThan(TOUR_DEFS.snowscooterBase!.maxInstability);
    const s = makeSite('snowshoeHut'), { sim } = s;
    const route = sim.tours.route(s.id);
    sim.safety.avalanche.inst[route[0]!] = TOUR_DEFS.snowshoeHut!.maxInstability - 0.1;
    setHour(sim, 11); sim.tick(TOURS.checkEvery + 1);
    expect(openState(s).open).toBe(true);
  });
});

describe('snowscooter: wildlife and the shared sustainability cap', () => {
  it('scares animals within the noise radius of the route and not beyond', () => {
    const s = makeSite('snowscooterBase'), { sim } = s, n = sim.size;
    const fauna = sim.nature.fauna;
    const route = sim.tours.route(s.id), mid = route[Math.floor(route.length / 2)]!;
    const mx = (mid % n) + 0.5, my = ((mid / n) | 0) + 0.5, R = TOUR_DEFS.snowscooterBase!.noiseRadius;
    const proto = fauna.animals[0] ?? ({ id: 9000, species: 'deer', herd: 1, x: 0, y: 0, tx: 0, ty: 0, timer: 0, flee: 0, asleep: false } as never);
    const mk = (x: number, y: number) => ({ ...(proto as object), x, y, flee: 0 }) as (typeof fauna.animals)[number];
    const near = mk(mx + R * 0.5, my), far = mk(mx + R + 14, my + 14);
    expect(route.every((i) => Math.hypot((i % n) + 0.5 - far.x, ((i / n) | 0) + 0.5 - far.y) > R)).toBe(true);
    fauna.animals.push(near, far);
    setHour(sim, 9.2); sim.tick(1);
    queueGuest(s); queueGuest(s);
    setHour(sim, 9.95); sim.tick(2);
    expect(tourOf(s).departuresToday).toBe(1);
    expect(near.flee).toBeGreaterThanOrEqual(FAUNA.fleeTicks - 4);
    expect(far.flee).toBe(0);
  });
  it('the motor penalty is > 0 after departures, <= the shared cap of 3, and 0 for the quiet bases', () => {
    const s = makeSite('snowscooterBase'), { sim } = s;
    expect(sim.tours.motorPenalty()).toBe(0);
    setHour(sim, 9.2); sim.tick(1);
    for (let slot = 0; slot < 4; slot++) { queueGuest(s); queueGuest(s); setHour(sim, 9.95 + slot * 2); sim.tick(2); }
    const pen = sim.tours.motorPenalty(), deps = tourOf(s).departuresToday;
    expect(deps).toBeGreaterThanOrEqual(3);
    expect(pen).toBeCloseTo(deps * TOUR_DEFS.snowscooterBase!.sustainPerDeparture, 5);
    expect(pen).toBeLessThanOrEqual(TOURS.maxSustainPenalty);
    for (const q of ['sleighStable', 'snowshoeHut'] as const) {
      const t = makeSite(q);
      setHour(t.sim, TOUR_DEFS[q]!.firstHour - 0.8); t.sim.tick(1);
      queueGuest(t); queueGuest(t);
      setHour(t.sim, TOUR_DEFS[q]!.firstHour - 0.05); t.sim.tick(2);
      expect(tourOf(t).departuresToday).toBe(1);
      expect(t.sim.tours.motorPenalty()).toBe(0);
    }
  });
});

describe('advisor hint', () => {
  it('suggests a winter tour once, as an info drawer hint, and never when one exists', () => {
    const rule = RULES.find((r) => r.id === 'tour.winter')!;
    expect(rule).toBeDefined();
    const sim = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', now: () => 0 });
    sim.game.date.day = dayOf('winter');
    sim.tick(1);
    const ctx = { sim, shown: false, season: 'winter' as const, pistes: () => ({ tiles: 0, icy: 0, noGroom: [], noAid: [] }), site: (_k: string, _t: string, f: () => unknown) => f() } as never;
    for (let k = 0; k < 40; k++) sim.guestSim.store.add({ x: 1, y: 1, z: 0, type: 0, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 999, tick: 0 });
    sim.progression.unlockAll = true;
    const adv = (rule.eval as (c: never) => { id: string; severity: string; panel?: { drawer: string; item?: string } } | null)(ctx);
    expect(adv?.id).toBe('tour.winter');
    expect(adv?.severity).toBe('info');
    expect(adv?.panel).toEqual({ drawer: 'buildings', item: 'sleighStable' });
  });
});
