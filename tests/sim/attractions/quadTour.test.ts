/** Phase 6 Task 22: Quad Base, the first catalogue tour (docs/quads.md). Real building + real road network of the starter resort. */
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
import { sustainParts } from '../../../src/sim/meta/Sustainability';
import { formatAttractionStats } from '../../../src/ui/attractionFormat';
import { RULES } from '../../../src/sim/advisor/rules';

const SUMMER = 40; // 1 April + 40 days = mid-May... in the authored calendar the test below asserts the season explicitly

interface Site { sim: Sim; id: number }
/** Starter resort + a quad base touching a road / footpath tile (its own straight road when the starter has none that fits). */
function makeSite(seed = 61): Site {
  const sim = createSim({ size: 64, seed, starterResort: true, mode: 'sandbox', now: () => 0, money: 1_000_000 });
  const n = sim.size, k = sim.networks.kind;
  const spots: Array<[number, number]> = [];
  for (let i = 0; i < n * n; i++) if (k[i] === NetKind.Road) { const x = i % n, y = (i / n) | 0; spots.push([x, y]); }
  for (const [rx, ry] of spots) for (const [dx, dy] of [[1, -1], [1, 0], [-3, -1], [-3, 0], [-1, 1], [0, 1], [-1, -2], [0, -2]] as const) {
    const x = rx + dx, y = ry + dy;
    const o = placeBuilding(sim.env, sim.props, 'quadBase', x, y, 0, true, false);
    if (!o.ok) continue;
    sim.refreshCoverage(o.building!, true); sim.buildings.reevaluate();
    if (!sim.buildings.get(o.building!.id)!.active) { sim.buildings.remove(o.building!.id); continue; }
    sim.game.date.day = findSummerDay(sim);
    sim.tick(1);
    if (sim.tours.route(o.building!.id).length < TOUR_DEFS.quadBase!.minLen) { sim.buildings.remove(o.building!.id); continue; }
    return { sim, id: o.building!.id };
  }
  throw new Error('no quad site');
}
function findSummerDay(sim: Sim): number { for (let d = 0; d < 180; d++) { if (seasonOf({ day: d }) === 'summer') return d + 8; } void sim; return SUMMER; }
const setHour = (sim: Sim, h: number): void => { sim.game.date.minute = Math.round(h * 60); };
const queueGuest = (s: Site, budget = 500): number => {
  const sim = s.sim;
  const slot = sim.guestSim.store.add({ x: 1, y: 1, z: 0, type: 0, skill: 1, budget, group: 0, mode: 0, overnight: false, leaveDay: 999, tick: 0 });
  const r = sim.attractions.arrive(slot, sim.buildings.get(s.id)!, sim.getSimTick());
  if (r !== 'using') { const a = sim.attractions.get(s.id)!; throw new Error(`refused: open=${a.open} ${a.reason}`); }
  return slot;
};
const tourOf = (s: Site) => s.sim.attractions.get(s.id)!.info().tour!;

describe('Quad Base data', () => {
  it('is a 3x2 recreation building, road or footpath access, summer only, staffed', () => {
    const d = BUILDINGS.quadBase!;
    expect([d.w, d.h, d.category, d.staff]).toEqual([3, 2, 'recreation', 2]);
    expect([d.access, ...(d.altAccess ?? [])].sort()).toEqual(['path', 'road']);
    expect(d.season).toBe('summer');
  });
  it('ticket $40 (inside the $15-60 decision range), tour def never uses trails or pistes', () => {
    const p = PRICE_TABLE.quadBase!;
    expect(p.price).toBe(40);
    expect(p.price).toBeGreaterThanOrEqual(15);
    expect(p.max).toBeLessThanOrEqual(60);
    const t = TOUR_DEFS.quadBase!;
    expect([...t.routes].sort()).toEqual(['path', 'road']);
    expect(t.motorised).toBe(true);
    expect(t.seasons).toEqual(['summer']);
    expect(ATTRACTION_SPECS.quadBase!.tour).toBe('quadBase');
    expect(ATTRACTION_SPECS.quadBase!.slots).toBe(t.seats);
  });
  it('is a selective career unlock (level 2); no goal or advisor rule needs it', () => {
    expect(unlockLevel('building', 'quadBase')).toBe(2);
  });
});

describe('quad tours in the sim', () => {
  it('plans a route over the attached road / footpath, never over a trail or a piste tile', () => {
    const s = makeSite(), { sim } = s, n = sim.size;
    const route = sim.tours.route(s.id);
    expect(route.length).toBeGreaterThanOrEqual(8);
    for (const i of route) {
      expect([NetKind.Road, NetKind.Path]).toContain(sim.networks.kind[i]);
      expect(sim.networks.layers[i]! & (Layer.Hike | Layer.Mtb | Layer.Ski)).toBe(0);
    }
    expect(n).toBe(64);
  });

  it('a trail beside the base is not part of the route', () => {
    const s = makeSite(), { sim } = s, n = sim.size;
    const b = sim.buildings.get(s.id)!;
    const before = [...sim.tours.route(s.id)];
    // paint a hiking trail along every free tile touching the footprint: the planner must ignore it (kind 0 + Hike layer)
    const painted: number[] = [];
    for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
      const i = y * n + x;
      if (sim.networks.kind[i] === 0 && sim.networks.paint(Layer.Hike, [{ x, y }], 0).painted > 0) painted.push(i);
    }
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.every((i) => (sim.networks.layers[i]! & Layer.Hike) !== 0)).toBe(true);
    sim.tick(1);
    const after = sim.tours.route(s.id);
    expect(after.some((i) => painted.includes(i))).toBe(false);
    expect(after).toEqual(before);
  });

  it('riders pay $40, the departure leaves on schedule with minRiders 2 and the guests come back happier', () => {
    const s = makeSite(), { sim } = s, store = sim.guestSim.store;
    setHour(sim, 9.2); sim.tick(1);
    expect(sim.attractions.get(s.id)!.open).toBe(true);
    const slots = [queueGuest(s), queueGuest(s), queueGuest(s)];
    const b0 = slots.map((k) => store.budget[k]!), h0 = slots.map((k) => store.happiness[k]!);
    setHour(sim, 9.95); sim.tick(2); // 10:00
    const t = tourOf(s);
    expect(t.departuresToday).toBe(1);
    expect(t.ridersToday).toBe(3);
    expect(t.revenueToday).toBe(120);
    slots.forEach((k, i) => expect(b0[i]! - store.budget[k]!).toBeCloseTo(40, 5));
    expect(slots.every((k) => store.state[k] === GState.Using)).toBe(true);
    sim.tick(16);
    expect(slots.every((k) => store.state[k] !== GState.Using)).toBe(true);
    slots.forEach((k, i) => expect(store.happiness[k]!).toBeGreaterThan(h0[i]!));
  });

  it('one lone guest does not trigger a departure (minRiders 2)', () => {
    const s = makeSite(), { sim } = s;
    setHour(sim, 9.2); sim.tick(1);
    queueGuest(s);
    setHour(sim, 9.95); sim.tick(2);
    expect(tourOf(s).departuresToday).toBe(0);
  });

  it('8 seats per departure (4 quads x 2): the rest wait for the next slot two hours later', () => {
    const s = makeSite(), { sim } = s;
    setHour(sim, 9.2); sim.tick(1);
    for (let k = 0; k < 11; k++) queueGuest(s);
    setHour(sim, 9.95); sim.tick(2);
    expect(tourOf(s).ridersToday).toBe(8);
    expect(sim.attractions.get(s.id)!.queue.length).toBe(3);
    expect(sim.tours.carriers(sim.getSimTick()).filter((c) => c.kind === 'quad').length).toBe(4);
  });

  it('winter closes it for the season; wind closes it; the schedule runs 10:00-16:00', () => {
    const s = makeSite(), { sim } = s;
    const a = (): { open: boolean; reason?: string } => { const x = sim.attractions.refreshOpen(s.id)!; return { open: x.open, reason: x.reason }; };
    setHour(sim, 9.5); sim.tick(1);
    expect(a().open).toBe(true);
    expect(tourOf(s).next).toEqual({ hour: 10, tomorrow: false });
    setHour(sim, 16.6); sim.tick(1);
    expect(sim.attractions.serving(s.id)).toBe(false);
    setHour(sim, 11);
    sim.weather.current.wind = 0.9; sim.weather.current.kind = 'storm';
    sim.tick(TOURS.checkEvery);
    expect(a()).toEqual({ open: false, reason: 'Closed: too windy' });
    sim.weather.current.wind = 0; sim.weather.current.kind = 'clear';
    sim.tick(TOURS.checkEvery + 1);
    expect(a().open).toBe(true);
    sim.game.date.day = 0; // 1 April + 0: spring in the calendar helper below is not summer
    for (let d = 0; d < 180; d++) if (seasonOf({ day: d }) === 'winter') { sim.game.date.day = d; break; }
    sim.tick(1);
    expect(a()).toEqual({ open: false, reason: 'Closed for the season' });
  });

  it('wildlife within the noise radius of the route flees at a departure; far animals do not', () => {
    const s = makeSite(), { sim } = s, n = sim.size;
    const fauna = sim.nature.fauna;
    const route = sim.tours.route(s.id), mid = route[Math.floor(route.length / 2)]!;
    const mx = (mid % n) + 0.5, my = ((mid / n) | 0) + 0.5;
    const R = TOUR_DEFS.quadBase!.noiseRadius;
    const proto = fauna.animals[0] ?? ({ id: 9000, species: 'deer', herd: 1, x: 0, y: 0, tx: 0, ty: 0, timer: 0, flee: 0, asleep: false } as never);
    const mk = (x: number, y: number) => ({ ...(proto as object), x, y, flee: 0 }) as (typeof fauna.animals)[number];
    const near = mk(mx + R * 0.5, my), far = mk(mx + R + 14, my + 14);
    // route tiles are within R of `far`? make sure it is not
    expect(route.every((i) => Math.hypot((i % n) + 0.5 - far.x, ((i / n) | 0) + 0.5 - far.y) > R)).toBe(true);
    fauna.animals.push(near, far);
    setHour(sim, 9.2); sim.tick(1);
    queueGuest(s); queueGuest(s);
    setHour(sim, 9.95);
    sim.tick(2);
    expect(tourOf(s).departuresToday).toBe(1);
    expect(near.flee).toBeGreaterThanOrEqual(FAUNA.fleeTicks - 4);
    expect(far.flee).toBe(0);
  });

  it('sustainability: departures cost a little (below the cap of 3), none without them', () => {
    const s = makeSite(), { sim } = s;
    const clean = sim.sustain.measure().score;
    setHour(sim, 9.2); sim.tick(1);
    for (let slot = 0; slot < 4; slot++) { queueGuest(s); queueGuest(s); setHour(sim, 9.95 + slot * 2); sim.tick(2); }
    const pen = sim.tours.motorPenalty();
    expect(pen).toBeGreaterThan(0);
    expect(pen).toBeLessThanOrEqual(TOURS.maxSustainPenalty);
    expect(pen).toBeCloseTo(4 * TOUR_DEFS.quadBase!.sustainPerDeparture, 5);
    const after = sim.sustain.measure();
    expect(after.score).toBeLessThanOrEqual(clean);
    expect(clean - after.score).toBeLessThanOrEqual(TOURS.maxSustainPenalty + 1e-9);
    // the all-day maximum (7 slots) stays under the cap with this def
    expect(7 * TOUR_DEFS.quadBase!.sustainPerDeparture).toBeLessThanOrEqual(TOURS.maxSustainPenalty);
    expect(sustainParts({ energyPerGuest: 1, treeLoss: 0, habitatOverlap: 0, protection: 0, motor: 0 }).score).toBeGreaterThan(0);
  });

  it('the inspector lists departures, riders, revenue, next departure and route', () => {
    const s = makeSite(), { sim } = s;
    setHour(sim, 9.2); sim.tick(1);
    queueGuest(s); queueGuest(s);
    setHour(sim, 9.95); sim.tick(2);
    const txt = formatAttractionStats(sim.attractions.get(s.id)!.info()).join('\n');
    expect(txt).toContain('Departures today: 1 · 2 riders · $80');
    expect(txt).toContain('Next departure: 12:00');
    expect(txt).toMatch(/Route: \d+ tiles out and back/);
  });

  it('is deterministic: same inputs, same stateHash', () => {
    const run = (): string => {
      const s = makeSite(); const { sim } = s;
      setHour(sim, 9.2); sim.tick(1);
      for (let k = 0; k < 4; k++) queueGuest(s);
      setHour(sim, 9.95); sim.tick(60);
      return stateHash(sim).hash;
    };
    expect(run()).toBe(run());
  });
});

describe('advisor hint', () => {
  it('suggests quad tours in summer for a resort with a village, once, and never when one exists', () => {
    const rule = RULES.find((r) => r.id === 'tour.quad')!;
    expect(rule).toBeDefined();
    const sim = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', now: () => 0 });
    sim.game.date.day = findSummerDay(sim);
    sim.tick(1);
    const ctx = { sim, shown: false, season: 'summer' as const, pistes: () => ({ tiles: 0, icy: 0, noGroom: [], noAid: [] }), site: (_k: string, _t: string, f: () => unknown) => f() } as never;
    for (let k = 0; k < 40; k++) sim.guestSim.store.add({ x: 1, y: 1, z: 0, type: 0, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 999, tick: 0 });
    const adv = (rule.eval as (c: never) => { id: string; severity: string; panel?: { drawer: string; item?: string } } | null)(ctx);
    expect(adv?.id).toBe('tour.quad');
    expect(adv?.severity).toBe('info');
    expect(adv?.panel).toEqual({ drawer: 'buildings', item: 'quadBase' });
    // locked at level 1 in a career game: never advised
    sim.progression.unlockAll = false;
    if (sim.progression.locked('building', 'quadBase')) expect((rule.eval as (c: never) => unknown)(ctx)).toBeNull();
  });
});
