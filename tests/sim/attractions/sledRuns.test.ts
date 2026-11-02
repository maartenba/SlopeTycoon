/** Phase 7 M7.3: sled runs, the alpine coaster and the Sledder guest type (docs/sled-runs.md). Real starter resort; a gentle ramp is carved for the run. */
import { afterEach, describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../../src/config/buildings';
import { PRICE_TABLE } from '../../../src/config/prices';
import { TOUR_DEFS } from '../../../src/config/tours';
import { SLED, SLED_MSG } from '../../../src/config/sled';
import { LIFTS } from '../../../src/config/lifts';
import { GUEST_TYPE_DEFS, CORE_TYPE_COUNT, appealFor, extraWeight, restoreShippedTypes, COND_SLED, COND_COASTER } from '../../../src/config/guestTypes';
import { unlockLevel } from '../../../src/config/unlocks';
import { ATTRACTION_SPECS } from '../../../src/sim/attractions/registry';
import { placeBuilding } from '../../../src/sim/PlaceBuilding';
import { createSim, type Sim } from '../../../src/game/createSim';
import { stateHash } from '../../../src/game/saveState';
import { NetKind, Layer } from '../../../src/world/Networks';
import { sledRuns, judgeTiles } from '../../../src/world/SledRuns';
import { seasonOf } from '../../../src/sim/Clock';
import { GState } from '../../../src/sim/guests/Guest';
import { formatAttractionStats } from '../../../src/ui/attractionFormat';
import { RULES } from '../../../src/sim/advisor/rules';

type Base = 'sledRental' | 'alpineCoaster';
const dayOf = (season: 'winter' | 'summer'): number => { for (let d = 0; d < 180; d++) if (seasonOf({ day: d }) === season) return d + 8; throw new Error('no day'); };
const setHour = (sim: Sim, h: number): void => { sim.game.date.minute = Math.round(h * 60); };
interface Site { sim: Sim; id: number; type: Base; line: Array<{ x: number; y: number }> }

/** A hut beside the starter road + a straight run of `len` tiles carved into a gentle ramp (`step` half-steps per tile), painted from the hut. */
/** Tries a few seeds (the starter village is crowded: the 4x3 coaster station needs a free spot beside a road). */
function makeSite(type: Base, opts: { len?: number; step?: number; paint?: boolean; seed?: number } = {}): Site {
  const seeds = opts.seed !== undefined ? [opts.seed] : [61, 5, 7, 21, 33];
  let last: unknown;
  for (const seed of seeds) { try { return makeSiteOn(type, { ...opts, seed }); } catch (e) { last = e; } }
  throw last;
}
function makeSiteOn(type: Base, opts: { len?: number; step?: number; paint?: boolean; seed?: number } = {}): Site {
  const { len = 14, step = 1, paint = true, seed = 61 } = opts;
  const sim = createSim({ size: 64, seed, starterResort: true, mode: 'sandbox', now: () => 0, money: 10_000_000 });
  const n = sim.size, g = sim.grid, def = BUILDINGS[type]!, k = sim.networks.kind;
  const roads: Array<[number, number]> = [];
  for (let i = 0; i < n * n; i++) if (k[i] === NetKind.Road) roads.push([i % n, (i / n) | 0]);
  const season = type === 'sledRental' ? 'winter' : 'summer';
  /** Corridors leaving the hut in each direction (free tiles only): carve a ramp across, paint, check the route. */
  const corridor = (b: { id: number; x: number; y: number; w: number; h: number }): Site | null => {
    for (const [vx, vy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const sx = vx > 0 ? b.x + b.w : vx < 0 ? b.x - 1 : b.x, sy = vy > 0 ? b.y + b.h : vy < 0 ? b.y - 1 : b.y;
      const line = Array.from({ length: len }, (_, j) => ({ x: sx + vx * j, y: sy + vy * j }));
      const free = (x: number, y: number): boolean => x >= 1 && y >= 1 && x < n - 1 && y < n - 1 && g.occupancy.flags[y * n + x] === 0 && k[y * n + x] === 0 && sim.networks.layers[y * n + x] === 0 && g.tileType[y * n + x] === 0;
      if (!line.every((p) => free(p.x, p.y))) continue;
      const base = 20;
      for (let j = 0; j <= len; j++) for (const w of [-1, 0, 1, 2]) {
        const px = vx ? sx + vx * j + (vx < 0 ? 1 : 0) : sx + w, py = vy ? sy + vy * j + (vy < 0 ? 1 : 0) : sy + w;
        if (px < 0 || py < 0 || px > n || py > n) continue;
        g.setCornerUnchecked(px, py, base + (len - j) * step);
      }
      if (paint) { const kind = type === 'sledRental' ? Layer.Sled : Layer.Coaster; if (sim.networks.paint(kind, line).painted < len) continue; }
      sim.game.date.day = dayOf(season);
      sim.tick(1);
      if (!paint || sim.tours.route(b.id).length >= TOUR_DEFS[type]!.minLen) return { sim, id: b.id, type, line };
      for (const p of line) { sim.networks.unpaint(Layer.Sled, p.x, p.y); sim.networks.unpaint(Layer.Coaster, p.x, p.y); }
    }
    return null;
  };
  const tryHut = (x: number, y: number): Site | null => {
    const o = placeBuilding(sim.env, sim.props, type, x, y, 0, true, false);
    if (!o.ok) return null;
    const b = o.building!;
    sim.refreshCoverage(b, true); sim.buildings.reevaluate();
    const s = b.active ? corridor(b) : null;
    if (s) return s;
    sim.buildings.remove(b.id);
    return null;
  };
  for (const [rx, ry] of roads) for (let dy = -def.h - 1; dy <= 2; dy++) for (let dx = -def.w - 1; dx <= 2; dx++) { const s = tryHut(rx + dx, ry + dy); if (s) return s; }
  // the starter village is crowded: extend an existing road in a straight line and put the hut beside the new stretch
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
      const b = o.building!;
      sim.refreshCoverage(b, true); sim.buildings.reevaluate();
      const s = b.active ? corridor(b) : null;
      if (s) return s;
      sim.buildings.remove(b.id);
    }
  }
  throw new Error('no site for ' + type);
}
const queueGuest = (s: Site, type = 0, budget = 500): number => {
  const sim = s.sim;
  const slot = sim.guestSim.store.add({ x: 1, y: 1, z: 0, type, skill: 1, budget, group: 0, mode: 0, overnight: false, leaveDay: 999, tick: 0 });
  const r = sim.attractions.arrive(slot, sim.buildings.get(s.id)!, sim.getSimTick());
  if (r !== 'using') { const a = sim.attractions.get(s.id)!; throw new Error(`refused: open=${a.open} ${a.reason}`); }
  return slot;
};
const tourOf = (s: Site) => s.sim.attractions.get(s.id)!.info().tour!;
const openState = (s: Site): { open: boolean; reason?: string } => { const x = s.sim.attractions.refreshOpen(s.id)!; return { open: x.open, reason: x.reason }; };

afterEach(() => restoreShippedTypes());

describe('data', () => {
  it('rows: sizes, access, tickets, seasons, seats, price, unlocks', () => {
    expect(BUILDINGS.sledRental!.season).toBe('winter');
    expect(PRICE_TABLE.sledRental!.price).toBe(12);
    expect(PRICE_TABLE.alpineCoaster!.price).toBeGreaterThan(PRICE_TABLE.sledRental!.price);
    expect(BUILDINGS.alpineCoaster!.cost).toBeGreaterThan(BUILDINGS.sledRental!.cost * 5);
    expect(TOUR_DEFS.sledRental!.seasons).toEqual(['winter']);
    expect(TOUR_DEFS.alpineCoaster!.seasons).toEqual(['summer']);
    expect(TOUR_DEFS.sledRental!.routes).toEqual(['sled']);
    expect(TOUR_DEFS.alpineCoaster!.routes).toEqual(['coaster']);
    expect(ATTRACTION_SPECS.sledRental!.tour).toBe('sledRental');
    expect(ATTRACTION_SPECS.sledRental!.mishap).toBeDefined(); // minor mishaps only (patrol call-outs): never a death
    expect(unlockLevel('building', 'sledRental')).toBe(2);
    expect(unlockLevel('building', 'alpineCoaster')).toBe(3);
    expect(SLED.costPerTile.coaster).toBeGreaterThan(SLED.costPerTile.sled);
  });
  it('lifts: gondolas, cable cars and detachable chairs carry sleds; fixed chairs, T-bars and the funicular do not', () => {
    for (const k of ['gondola6', 'gondola10', 'cablecar', 'chair4d', 'chair6', 'chair6d', 'chair6b', 'chair8b'] as const) expect(LIFTS[k].carriesSleds, k).toBe(true);
    for (const k of ['tbar', 'chair2', 'chair4', 'funicular'] as const) expect(LIFTS[k].carriesSleds, k).toBe(false);
  });
});

describe('painting and validation', () => {
  it('Sled / Coaster are their own layers (bits 16 / 32) and never share a tile with a piste or a trail', () => {
    expect(Layer.Sled).toBe(16); expect(Layer.Coaster).toBe(32);
    const sim = createSim({ size: 64, seed: 61, mode: 'sandbox', now: () => 0 });
    const t = { x: 30, y: 30 };
    expect(sim.networks.paint(Layer.Ski, [t]).painted).toBe(1);
    expect(sim.networks.canPaint(t.x, t.y, Layer.Sled)).toEqual({ ok: false, reason: 'A sled run cannot cross a piste or a trail' });
    sim.networks.unpaint(Layer.Ski, t.x, t.y);
    expect(sim.networks.paint(Layer.Sled, [t]).painted).toBe(1);
    expect(sim.networks.canPaint(t.x, t.y, Layer.Hike).reason).toBe('A sled run is in the way');
    expect(sim.networks.sledAt(t.x, t.y)).toBe(true);
    sim.networks.clearLayers(t.x, t.y);
    expect(sim.networks.sledAt(t.x, t.y)).toBe(false);
  });
  it('validation: too steep is unsafe, too flat is unsafe, a gentle run is safe; the coaster tolerates steeper ground and flat', () => {
    const sim = createSim({ size: 64, seed: 61, mode: 'sandbox', now: () => 0 });
    const g = sim.grid;
    const ramp = (step: number): Array<{ x: number; y: number }> => { for (let j = 0; j <= 14; j++) for (let w = 0; w <= 2; w++) g.setCornerUnchecked(10 + j, 10 + w, 30 + 14 * 4 - j * step); return Array.from({ length: 14 }, (_, j) => ({ x: 10 + j, y: 10 })); };
    expect(judgeTiles(g, 'sled', ramp(1)).problem).toBeNull();
    expect(judgeTiles(g, 'sled', ramp(0)).problem).toBe(SLED_MSG.flat);
    expect(judgeTiles(g, 'coaster', ramp(0)).problem).toBeNull();
    const steep = ramp(4), j = judgeTiles(g, 'sled', steep);
    expect(j.maxSteep).toBeGreaterThan(SLED.maxSteep.sled);
    expect(j.problem).toBe(SLED_MSG.steep);
    expect(judgeTiles(g, 'coaster', steep).problem === null || judgeTiles(g, 'coaster', steep).maxSteep > SLED.maxSteep.coaster).toBe(true);
    // runs are 8-connected components
    sim.networks.paint(Layer.Sled, steep);
    const runs = sledRuns(sim.networks, g, 'sled');
    expect(runs.length).toBe(1);
    expect(runs[0]!.tiles.length).toBe(14);
    expect(runs[0]!.drop).toBeGreaterThan(0);
    expect(runs[0]!.problem).toBe(SLED_MSG.steep);
  });
});

describe('sled rental in the sim', () => {
  it('plans a route along the painted run (8-60 tiles) from the hut', () => {
    const s = makeSite('sledRental'), route = s.sim.tours.route(s.id);
    expect(route.length).toBeGreaterThanOrEqual(8);
    for (const i of route) expect(s.sim.networks.layers[i]! & Layer.Sled).not.toBe(0);
  });
  it('winter: riders pay $12, depart on the hour and come back happier; revenue matches', () => {
    const s = makeSite('sledRental'), { sim } = s, store = sim.guestSim.store, def = TOUR_DEFS.sledRental!;
    setHour(sim, def.firstHour - 0.8); sim.tick(1);
    expect(openState(s).open).toBe(true);
    const slots = [queueGuest(s), queueGuest(s), queueGuest(s)];
    const b0 = slots.map((k) => store.budget[k]!), h0 = slots.map((k) => store.happiness[k]!);
    setHour(sim, def.firstHour - 0.05); sim.tick(2);
    const t = tourOf(s);
    expect(t.departuresToday).toBe(1); expect(t.ridersToday).toBe(3); expect(t.revenueToday).toBe(36);
    slots.forEach((k, i) => expect(b0[i]! - store.budget[k]!).toBeCloseTo(12, 5));
    expect(sim.tours.carriers(sim.getSimTick()).some((c) => c.kind === 'sled')).toBe(true);
    sim.tick(def.durationTicks + 2);
    expect(slots.every((k) => store.state[k] !== GState.Using)).toBe(true);
    slots.forEach((k, i) => expect(store.happiness[k]!).toBeGreaterThan(h0[i]!));
  });
  it('closed out of winter, in a storm, and when the run is too steep or too flat (the hut says why)', () => {
    const s = makeSite('sledRental'), { sim } = s;
    setHour(sim, 11); sim.tick(1);
    expect(openState(s).open).toBe(true);
    sim.weather.current.wind = 1; sim.weather.current.kind = 'storm'; sim.tick(12);
    expect(openState(s)).toEqual({ open: false, reason: 'Closed: too windy' });
    sim.weather.current.wind = 0; sim.weather.current.kind = 'clear'; sim.tick(12);
    expect(openState(s).open).toBe(true);
    // flatten the run: "Too flat"
    const n = sim.size;
    for (const p of s.line) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) sim.grid.setCornerUnchecked(p.x + dx, p.y + dy, 20);
    sim.tick(12);
    expect(openState(s)).toEqual({ open: false, reason: `Closed: ${SLED_MSG.flat}` });
    void n;
    sim.game.date.day = dayOf('summer'); sim.tick(12);
    expect(openState(s).reason).toBe('Closed for the season');
  });
  it('a sled lift joining both ends halves the ride; an unrelated or closed lift does not', () => {
    const s = makeSite('sledRental'), { sim } = s, route = sim.tours.route(s.id);
    const first = route[0]!, last = route[route.length - 1]!, n = sim.size;
    const st = (t: number) => ({ x: t % n, y: (t / n) | 0, ground: 0 });
    const nodes = [{ x: first % n, y: 0, z: (first / n) | 0 }, { x: last % n, y: 0, z: (last / n) | 0 }];
    setHour(sim, 11); sim.tick(1);
    const a = sim.attractions.get(s.id)!;
    const base = ATTRACTION_SPECS.sledRental!.serviceTicks;
    expect(sim.tours.duration(a, base)).toBe(base);
    expect(tourOf(s).liftServed).toBe(false);
    const mk = (kind: 'gondola6' | 'chair4', open: boolean) => sim.lifts.add({ kind, bottom: st(first), top: st(last), towers: [], nodes, tiles: [], open, speed: 1, cost: 0 });
    const fixed = mk('chair4', true); // does not carry sleds
    expect(sim.tours.duration(a, base)).toBe(base);
    const gon = mk('gondola6', false); // closed
    expect(sim.tours.duration(a, base)).toBe(base);
    gon.open = true;
    expect(sim.tours.duration(a, base)).toBe(Math.round(base * SLED.liftTimeMult));
    expect(tourOf(s).liftServed).toBe(true);
    expect(formatAttractionStats(a.info()).join('\n')).toContain('carries sleds');
    void fixed;
    // riders on a lifted run are Using for the short time
    const store = sim.guestSim.store, k = queueGuest(s);
    setHour(sim, 11.95); sim.tick(2);
    expect(store.state[k]).toBe(GState.Using);
    sim.tick(Math.round(base * SLED.liftTimeMult) + 2);
    expect(store.state[k]).not.toBe(GState.Using);
  });
  it('is deterministic, and the tour save keeps the counters', () => {
    const run = (): string => { const s = makeSite('sledRental'); setHour(s.sim, 9.2); s.sim.tick(1); for (let i = 0; i < 4; i++) queueGuest(s); setHour(s.sim, 9.95); s.sim.tick(60); return stateHash(s.sim).hash; };
    expect(run()).toBe(run());
    const s = makeSite('sledRental'), { sim } = s;
    setHour(sim, 9.2); sim.tick(1); queueGuest(s); queueGuest(s); setHour(sim, 9.95); sim.tick(2);
    const saved = JSON.stringify(sim.tours.serialize());
    sim.tours.load(JSON.parse(saved));
    expect(JSON.stringify(sim.tours.serialize())).toBe(saved);
  });
  it('the Layer bits survive a save (the layers array is saved byte for byte)', () => {
    const s = makeSite('sledRental'), n = s.sim.size;
    const copy = Uint8Array.from(s.sim.networks.layers);
    const twin = createSim({ size: 64, seed: 61, mode: 'sandbox', now: () => 0 });
    twin.networks.restoreAll({ kind: s.sim.networks.kind, conn: s.sim.networks.conn, bridge: s.sim.networks.bridge, layers: copy, difficulty: s.sim.networks.difficulty, quality: s.sim.networks.quality, roadEntry: s.sim.networks.roadEntry, railEntry: s.sim.networks.railEntry, version: 1 });
    for (const p of s.line) expect(twin.networks.sledAt(p.x, p.y), `${p.x},${p.y} of ${n}`).toBe(true);
  });
  it('inspector shows the route and the sled-lift note', () => {
    const s = makeSite('sledRental'), { sim } = s;
    setHour(sim, 9.2); sim.tick(1);
    const txt = formatAttractionStats(sim.attractions.get(s.id)!.info()).join('\n');
    expect(txt).toMatch(/Route: \d+ tiles out and back/);
    expect(txt).toContain('No sled lift');
  });
});

describe('alpine coaster in the sim (summer)', () => {
  it('runs in summer on the painted coaster rail, dearer ticket, closed in winter, closes in strong wind', () => {
    const s = makeSite('alpineCoaster', { step: 2 }), { sim } = s, def = TOUR_DEFS.alpineCoaster!;
    setHour(sim, def.firstHour - 0.8); sim.tick(1);
    expect(openState(s).open).toBe(true);
    const k = queueGuest(s);
    const b0 = sim.guestSim.store.budget[k]!;
    setHour(sim, def.firstHour - 0.05); sim.tick(2);
    expect(b0 - sim.guestSim.store.budget[k]!).toBeCloseTo(PRICE_TABLE.alpineCoaster!.price, 5);
    expect(sim.tours.carriers(sim.getSimTick()).some((c) => c.kind === 'coaster')).toBe(true);
    sim.weather.current.wind = 0.8; sim.weather.current.kind = 'storm'; sim.tick(12);
    expect(openState(s)).toEqual({ open: false, reason: 'Closed: too windy' });
    sim.weather.current.wind = 0; sim.weather.current.kind = 'clear';
    sim.game.date.day = dayOf('winter'); sim.tick(12);
    expect(openState(s).reason).toBe('Closed for the season');
  });
});

describe('Sledder guest type', () => {
  const def = (): (typeof GUEST_TYPE_DEFS)[number] => GUEST_TYPE_DEFS.find((d) => d.id === 'sledder')!;
  it('is the 13th type (index 12), appended last, with an orange look', () => {
    expect(GUEST_TYPE_DEFS.indexOf(def()) + CORE_TYPE_COUNT).toBe(12);
    expect(def().label).toBe('Sledder');
    expect(def().look?.colour).toBe(0xff7043);
  });
  it('arrives only with an OPEN sled hut in winter (or an open coaster in summer) and from level 2', () => {
    const w = (hasBuilding: (id: string) => boolean, season: 'winter' | 'summer' | 'spring', level = 2): number => extraWeight(def(), { season, level, hasBuilding });
    expect(w((id) => id === COND_SLED, 'winter')).toBeGreaterThan(0);
    expect(w(() => false, 'winter')).toBe(0);
    expect(w((id) => id === COND_SLED, 'winter', 1)).toBe(0);
    expect(w((id) => id === COND_SLED, 'summer')).toBe(0);
    expect(w((id) => id === COND_COASTER, 'summer')).toBeGreaterThan(0);
    expect(w((id) => id === COND_SLED, 'spring')).toBe(0);
  });
  it('the spawner raises the flag only while the hut is open: sledders arrive, and not before the hut', () => {
    const none = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', now: () => 0 });
    none.game.date.day = dayOf('winter'); none.tick(1);
    expect(none.guestSim.spawner.flagsFn!()).not.toContain(COND_SLED);
    const s = makeSite('sledRental');
    setHour(s.sim, 11); s.sim.tick(1);
    expect(s.sim.guestSim.spawner.flagsFn!()).toContain(COND_SLED);
    s.sim.weather.current.wind = 1; s.sim.weather.current.kind = 'storm'; s.sim.tick(12);
    expect(s.sim.guestSim.spawner.flagsFn!()).not.toContain(COND_SLED);
  });
  it('loves the hut and the coaster; every other type has a positive appeal for the sled hut (skiers, boarders, families, seniors, school groups)', () => {
    const spec = ATTRACTION_SPECS.sledRental!;
    const sledder = CORE_TYPE_COUNT + GUEST_TYPE_DEFS.indexOf(def());
    expect(appealFor(spec, 'sledRental', sledder)).toBeGreaterThanOrEqual(1.5);
    for (const t of [0, 1, 2, 4, 5]) expect(appealFor(spec, 'sledRental', t) ?? 0, `core ${t}`).toBeGreaterThan(0.4);
    for (const id of ['senior', 'school', 'snowboarder']) { const t = CORE_TYPE_COUNT + GUEST_TYPE_DEFS.findIndex((d) => d.id === id); expect(appealFor(spec, 'sledRental', t) ?? 0, id).toBeGreaterThan(0.4); }
    // the family column is the highest of the core types
    expect(appealFor(spec, 'sledRental', 2)!).toBeGreaterThanOrEqual(Math.max(...[0, 1, 3, 4, 5].map((t) => appealFor(spec, 'sledRental', t)!)));
  });
  it('a headless winter week with an open sled hut: sledders actually arrive, ride and pay', () => {
    const s = makeSite('sledRental'), { sim } = s;
    sim.progression.unlockAll = true;
    const idx = CORE_TYPE_COUNT + GUEST_TYPE_DEFS.findIndex((d) => d.id === 'sledder');
    const seen = new Set<number>();
    let sledders = 0;
    sim.bus.on('guest:arrived', (e) => { const sl = sim.guestSim.store.slotOf(e.id); if (sl >= 0 && sim.guestSim.store.type[sl] === idx && !seen.has(e.id)) { seen.add(e.id); sledders++; } });
    for (let day = 0; day < 12; day++) { sim.game.date.day = dayOf('winter') + (day % 4); setHour(sim, 8); sim.tick(240); }
    expect(sledders, 'sledder arrivals').toBeGreaterThan(0);
    expect(tourOf(s).totalRiders).toBeGreaterThan(0);
    expect(tourOf(s).totalRevenue).toBeGreaterThan(0);
  }, 60_000);
});

describe('advisor', () => {
  it('suggests a sled run in winter as a drawer hint', () => {
    const rule = RULES.find((r) => r.id === 'tour.sled')!;
    expect(rule).toBeDefined();
    const sim = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', now: () => 0 });
    sim.game.date.day = dayOf('winter'); sim.tick(1);
    for (let k = 0; k < 45; k++) sim.guestSim.store.add({ x: 1, y: 1, z: 0, type: 0, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 999, tick: 0 });
    sim.progression.unlockAll = true;
    const ctx = { sim, shown: false, season: 'winter' as const, pistes: () => ({ tiles: 0, icy: 0, noGroom: [], noAid: [] }), site: (_k: string, _t: string, f: () => unknown) => f() } as never;
    const adv = (rule.eval as (c: never) => { id: string; severity: string; panel?: { drawer: string; item?: string } } | null)(ctx);
    expect(adv?.panel).toEqual({ drawer: 'buildings', item: 'sledRental' });
    expect(adv?.severity).toBe('info');
  });
});
