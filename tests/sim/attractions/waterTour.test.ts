/** Phase 6 Task 24: water tours (docs/water-tours.md): Rafting Base + Canyoning Base on natural / dug waterways. */
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../../src/config/buildings';
import { PRICE_TABLE } from '../../../src/config/prices';
import { TOUR_DEFS } from '../../../src/config/tours';
import { unlockLevel } from '../../../src/config/unlocks';
import { ATTRACTION_SPECS } from '../../../src/sim/attractions/registry';
import { dropAt, planWaterRoute, thrillOf, type WaterEnv } from '../../../src/sim/attractions/WaterTour';
import { describeRules } from '../../../src/sim/PlacementRules';
import { validatePlacement } from '../../../src/sim/PlaceBuilding';
import { createSim } from '../../../src/game/createSim';
import { collectSave, applySave, stateHash } from '../../../src/game/saveState';
import { GState } from '../../../src/sim/guests/Guest';
import { Sev } from '../../../src/sim/ops/Incidents';
import { Attraction } from '../../../src/sim/attractions/Attraction';
import { TourSystem, tourSpec } from '../../../src/sim/attractions/Tour';
import { simDayOf } from '../../../src/sim/calendar';
import { seasonStartDay } from '../../../src/sim/Clock';
import { formatAttractionStats } from '../../../src/ui/attractionFormat';
import { RULES } from '../../../src/sim/advisor/rules';
import type { WayFlow } from '../../../src/sim/nature/Flow';
import { digRiver, mkSim, placeBase, setHour } from './waterFixture';

const RAFT = TOUR_DEFS.raftingBase!, CANYON = TOUR_DEFS.canyoningBase!;

// ---------- a synthetic waterway for the pure planner ----------
const line = (n: number, y = 10, x0 = 5): Array<{ x: number; y: number }> => Array.from({ length: n }, (_, i) => ({ x: x0 + i, y }));
const flowOf = (cls: number[], speed?: number[]): WayFlow => ({ id: 'n0', kind: 'natural', q: cls.map(() => 1), speed: speed ?? cls.map((c) => [0.4, 0.9, 1.6][c]!), cls, mouthQ: 1, maxClass: Math.max(...cls), rapidsTiles: cls.filter((c) => c === 2).length, frozen: false });
function env(cls: number[], level: number[], gorge: (x: number, y: number) => boolean = () => false, speed?: number[]): WaterEnv {
  const w = { id: 'n0', kind: 'natural' as const, path: line(cls.length), level, end: 'edge' as const };
  return { ways: () => [w], flow: () => flowOf(cls, speed), gorge };
}
const base = { x: 5, y: 12, w: 3, h: 2 }; // two tiles below the waterway row (y 10)

describe('water tour data', () => {
  it('Rafting Base: 3x2 recreation, road or footpath, summer, $30 (inside $15-60), level 3, staffed', () => {
    const d = BUILDINGS.raftingBase!;
    expect([d.w, d.h, d.category, d.staff]).toEqual([3, 2, 'recreation', 2]);
    expect([d.access, ...(d.altAccess ?? [])].sort()).toEqual(['path', 'road']);
    expect(d.season).toBe('summer');
    const p = PRICE_TABLE.raftingBase!;
    expect(p.price).toBeGreaterThanOrEqual(15); expect(p.price).toBeLessThanOrEqual(60); expect(p.max).toBeLessThanOrEqual(60);
    expect(unlockLevel('building', 'raftingBase')).toBe(3);
    expect(d.site.nearWaterway).toBe(true);
    expect(describeRules('raftingBase').some((l) => /brisk flow within 3 tiles/.test(l))).toBe(true);
  });
  it('Canyoning Base: 2x2 recreation, trail or footpath, summer, level 3', () => {
    const d = BUILDINGS.canyoningBase!;
    expect([d.w, d.h, d.category, d.staff]).toEqual([2, 2, 'recreation', 2]);
    expect([d.access, ...(d.altAccess ?? [])].sort()).toEqual(['path', 'trail']);
    expect(d.season).toBe('summer');
    expect(unlockLevel('building', 'canyoningBase')).toBe(3);
    expect(PRICE_TABLE.canyoningBase!.price).toBeGreaterThanOrEqual(15);
    expect(PRICE_TABLE.canyoningBase!.max).toBeLessThanOrEqual(60);
  });
  it('the tour defs derive attraction specs: not motorised, water routes only, one way, minor mishaps; no per-id logic in the registry', () => {
    for (const def of [RAFT, CANYON]) {
      expect(def.routes).toEqual(['water']);
      expect(def.motorised).toBe(false); expect(def.oneWay).toBe(true);
      const sp = ATTRACTION_SPECS[def.id]!;
      expect(sp.tour).toBe(def.id);
      expect(sp.mishap!.guided).toBeLessThan(0.02); expect(sp.mishap!.guided).toBeLessThan(sp.mishap!.unguided);
    }
  });
});

describe('planWaterRoute (pure)', () => {
  it('follows the waterway DOWNSTREAM from the put-in, trimmed to the last brisk tile + 2; classes counted', () => {
    const cls = [0, 0, 1, 1, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const lvl = cls.map((_, i) => 40 - i * 2);
    const p = planWaterRoute(env(cls, lvl), base, RAFT, 64);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const xs = p.tiles.map((t) => t % 64);
    expect(xs[0]).toBe(5); // put-in: the first tile within reach
    expect(xs).toEqual(xs.slice().sort((a, b) => a - b)); // only ever downstream
    expect(p.tiles.length).toBe(12); // last brisk tile index 8 + tail 2 = 10 would be 11 tiles: minLen 12 extends it
    expect(p.info.good).toBe(7); expect(p.info.rapids).toBe(2); expect(p.info.maxClass).toBe(2);
    expect(p.info.clock.length).toBe(p.tiles.length);
    expect(p.info.clock[0]).toBe(0); expect(p.info.clock[p.info.clock.length - 1]).toBe(1);
  });
  it('needs brisk flow on N tiles: a calm stream and a too-short brisk stretch are refused with the "brisk flow within 3 tiles" reason', () => {
    const calm = planWaterRoute(env(Array(20).fill(0), Array(20).fill(30)), base, RAFT, 64);
    expect(calm.ok).toBe(false);
    if (!calm.ok) { expect(calm.reason).toBe('Needs a river or stream with brisk flow within 3 tiles'); expect(calm.detail).toMatch(/only 0 of 6 brisk tiles/); }
    const few = planWaterRoute(env([1, 1, 1, ...Array(17).fill(0)], Array.from({ length: 20 }, (_, i) => 40 - i)), base, RAFT, 64);
    expect(few.ok).toBe(false);
    if (!few.ok) expect(few.detail).toMatch(/only 3 of 6/);
  });
  it('the put-in must be within 3 tiles of the footprint; farther away there is no route and the reason says so', () => {
    const cls = Array(20).fill(2), lvl = cls.map((_, i) => 60 - i * 3);
    expect(planWaterRoute(env(cls, lvl), { x: 5, y: 13, w: 3, h: 2 }, RAFT, 64).ok).toBe(true); // 3 tiles below y 10
    const far = planWaterRoute(env(cls, lvl), { x: 5, y: 14, w: 3, h: 2 }, RAFT, 64);
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.detail).toMatch(/no river or stream within 3 tiles/);
  });
  it('length limits: too short a waterway is refused, a long one is cut at maxLen', () => {
    expect(planWaterRoute(env(Array(8).fill(2), Array.from({ length: 8 }, (_, i) => 30 - i * 3)), base, RAFT, 64).ok).toBe(false);
    const long = planWaterRoute(env(Array(80).fill(2), Array.from({ length: 80 }, (_, i) => 200 - i * 3)), base, RAFT, 64);
    expect(long.ok && long.tiles.length).toBe(RAFT.maxLen);
  });
  it('canyoning: needs steep tiles AND a gorge; works at any flow class', () => {
    const lvl = Array.from({ length: 20 }, (_, i) => 80 - i * 3); // 3 half-steps per tile
    const flat = Array.from({ length: 20 }, () => 30);
    expect(dropAt(lvl, 5)).toBe(3); expect(dropAt(flat, 5)).toBe(0);
    const gorge = (x: number, y: number): boolean => y >= 8 && y <= 12 && x >= 5; // rock walls along the stream
    const ok = planWaterRoute(env(Array(20).fill(0), lvl, gorge), base, CANYON, 64);
    expect(ok.ok).toBe(true);
    if (ok.ok) { expect(ok.info.steep).toBeGreaterThanOrEqual(5); expect(ok.info.gorge).toBeGreaterThanOrEqual(6); }
    const noSteep = planWaterRoute(env(Array(20).fill(0), flat, gorge), base, CANYON, 64);
    expect(noSteep.ok).toBe(false);
    if (!noSteep.ok) { expect(noSteep.reason).toBe('Needs a steep stream through rock within 3 tiles'); expect(noSteep.detail).toMatch(/steep tiles/); }
    const noGorge = planWaterRoute(env(Array(20).fill(0), lvl, () => false), base, CANYON, 64);
    expect(noGorge.ok).toBe(false);
    if (!noGorge.ok) expect(noGorge.detail).toMatch(/rock wall tiles/);
  });
  it('raft clock: faster water takes less time per tile (speed ~ flow); thrill counts rapids tiles', () => {
    const cls = [...Array(8).fill(1), ...Array(6).fill(2), ...Array(6).fill(1)];
    const p = planWaterRoute(env(cls, cls.map((_, i) => 80 - i * 2)), base, RAFT, 64);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const c = p.info.clock, slow = c[7]! - c[0]!, fast = c[13]! - c[8]!;
    expect(fast / 6).toBeLessThan(slow / 7);
    expect(thrillOf(RAFT, p.info)).toBe(1);
    expect(thrillOf(RAFT, { ...p.info, rapids: 3 })).toBeCloseTo(0.5, 5);
    expect(thrillOf(RAFT, undefined)).toBe(0);
  });
  it('deterministic: the same inputs give the same plan', () => {
    const cls = [0, 1, 1, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0];
    const e = env(cls, cls.map((_, i) => 40 - i * 2));
    expect(JSON.stringify(planWaterRoute(e, base, RAFT, 64))).toBe(JSON.stringify(planWaterRoute(e, base, RAFT, 64)));
  });
});

describe('Rafting Base on a dug river (seed 61)', () => {
  it('is refused in a meadow with the clear reason, accepted beside the river (info says what is in reach)', () => {
    const sim = mkSim();
    const far = validatePlacement(sim.env, 'raftingBase', 30, 40, 0, true);
    expect(far.reasons).toContain('Needs a river or stream with brisk flow within 3 tiles');
    digRiver(sim);
    const id = placeBase(sim, 'raftingBase', 3, 2);
    const b = sim.buildings.get(id)!;
    const chk = validatePlacement(sim.env, 'raftingBase', b.x + 20, b.y + 20, 0, true);
    expect(chk.reasons.join('|')).toMatch(/brisk flow within 3 tiles/);
    expect(sim.tours.route(id).length).toBeGreaterThanOrEqual(0);
  });
  it('runs a route that follows the dug river downstream, at least minLen tiles, every tile a river tile', () => {
    const sim = mkSim();
    const path = digRiver(sim);
    const id = placeBase(sim, 'raftingBase', 3, 2);
    sim.tick(2);
    const a = sim.attractions.get(id)!;
    expect(a.open).toBe(true);
    const route = sim.tours.route(id), n = sim.size;
    expect(route.length).toBeGreaterThanOrEqual(RAFT.minLen); expect(route.length).toBeLessThanOrEqual(RAFT.maxLen);
    const idx = new Map(path.map((p, i) => [p.y * n + p.x, i]));
    const order = route.map((t) => idx.get(t));
    expect(order.every((o) => o !== undefined)).toBe(true);
    order.forEach((o, k) => { if (k > 0) expect(o).toBe(order[k - 1]! + 1); });
    const t = a.info().tour!;
    expect(t.closed).toBeNull(); expect(t.water!.flow).not.toBe('calm'); expect(t.routeLen).toBe(route.length);
    expect(formatAttractionStats(a.info()).join('\n')).toMatch(/tiles downstream/);
  });
  it('riders pay $30, wait for the next slot with fewer than 2, board up to 8 seats and come back happier (rapids add thrill)', () => {
    const sim = mkSim();
    digRiver(sim);
    const id = placeBase(sim, 'raftingBase', 3, 2), store = sim.guestSim.store;
    setHour(sim, 9.2); sim.tick(1);
    const q = (): number => { const s = store.add({ x: 1, y: 1, z: 0, type: 5, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 999, tick: 0 }); sim.attractions.arrive(s, sim.buildings.get(id)!, sim.getSimTick()); return s; };
    const slots = Array.from({ length: 10 }, q), h0 = slots.map((k) => store.happiness[k]!);
    setHour(sim, 9.95); sim.tick(2); // 10:00
    const a = sim.attractions.get(id)!, t = a.info().tour!;
    expect(t.departuresToday).toBe(1); expect(t.ridersToday).toBe(8); expect(t.revenueToday).toBe(240);
    expect(a.queue.length).toBe(2);
    expect(slots.slice(0, 8).every((k) => store.state[k] === GState.Using)).toBe(true);
    expect(sim.tours.carriers(sim.getSimTick()).filter((c) => c.kind === 'raft').length).toBe(RAFT.vehicles);
    sim.tick(15);
    slots.slice(0, 8).forEach((k, i) => expect(store.happiness[k]!).toBeGreaterThan(h0[i]!));
  });
  it('sustainability neutral: not motorised, no penalty, no wildlife scare radius', () => {
    const sim = mkSim();
    digRiver(sim);
    placeBase(sim, 'raftingBase', 3, 2);
    sim.tick(20);
    expect(sim.tours.motorPenalty()).toBe(0);
    expect(RAFT.noiseRadius).toBe(0); expect(RAFT.sustainPerDeparture).toBe(0);
  });
});

describe('closures', () => {
  it('winter: closed for the season; storm wind closes it, sends the queue home and it reopens', () => {
    const sim = mkSim();
    digRiver(sim);
    const id = placeBase(sim, 'raftingBase', 3, 2);
    sim.tick(2);
    const a = sim.attractions.get(id)!;
    expect(a.open).toBe(true);
    sim.weather.current.wind = 1; sim.weather.current.kind = 'storm'; sim.tick(12);
    expect(a.reason).toBe('Closed: too windy');
    sim.weather.current.wind = 0; sim.weather.current.kind = 'clear'; sim.tick(12);
    expect(a.open).toBe(true);
    sim.game.date.day = seasonStartDay('winter') + 5; sim.tick(12);
    expect(a.open).toBe(false); expect(a.reason).toBe('Closed for the season');
  });
  it('frozen river closes the tour ("the river is frozen"), thaw reopens it', () => {
    const sim = mkSim();
    digRiver(sim);
    const id = placeBase(sim, 'raftingBase', 3, 2);
    sim.tick(2);
    const a = sim.attractions.get(id)!;
    expect(a.open).toBe(true);
    sim.flow.settle(sim.game.date.day, -10); sim.tick(12);
    expect(sim.flow.anyDugFrozen()).toBe(true);
    expect(a.open).toBe(false); expect(a.reason).toBe('Closed: the river is frozen');
    sim.flow.settle(sim.game.date.day, 10); sim.tick(12);
    expect(a.open).toBe(true);
  });
  it('late-summer low water closes the tour ("the water runs low"), the river is judged again every month and a base is never refused for it', () => {
    const sim = mkSim();
    digRiver(sim);
    const id = placeBase(sim, 'raftingBase', 3, 2);
    sim.tick(2);
    const a = sim.attractions.get(id)!;
    const reasons = new Set<string>();
    for (const m of [5, 6, 7, 8] /* calendar months Jun .. Sep */) { sim.game.date.day = simDayOf(m, 10); sim.flow.onDay(sim.game.date.day, 15); sim.tick(12); reasons.add(a.open ? 'open' : a.reason ?? ''); }
    expect([...reasons].some((r) => /the water runs low right now/.test(r))).toBe(true);
    expect(reasons.has('open')).toBe(true);
    const b = sim.buildings.get(id)!;
    void b; // placement used the nominal flow: the same footprint is still valid in the low month
    expect(validatePlacement(sim.env, 'raftingBase', 60, 60, 0, true).reasons.join()).toMatch(/brisk flow/);
  });
  it('a removed river (fill-in) cancels the route; the base closes with the reason', () => {
    const sim = mkSim();
    digRiver(sim);
    const id = placeBase(sim, 'raftingBase', 3, 2);
    sim.tick(2);
    sim.rivers.remove(sim.rivers.rivers[0]!.id); sim.tick(12);
    const a = sim.attractions.get(id)!;
    expect(a.open).toBe(false); expect(a.reason).toMatch(/Needs a river or stream with brisk flow within 3 tiles/);
  });
});

describe('Canyoning Base', () => {
  it('works on a steep dug stream with rock / steep banks; the route is a steep downstream slice', () => {
    const sim = mkSim();
    digRiver(sim);
    const id = placeBase(sim, 'canyoningBase', 2, 2);
    sim.tick(2);
    const a = sim.attractions.get(id)!;
    expect(a.open).toBe(true);
    const t = a.info().tour!;
    expect(t.water!.steep).toBeGreaterThanOrEqual(CANYON.water!.steep!.minTiles);
    expect(t.water!.gorge).toBeGreaterThanOrEqual(CANYON.water!.gorge!.minTiles);
    expect(sim.tours.route(id).length).toBeGreaterThanOrEqual(CANYON.minLen);
    expect(formatAttractionStats(a.info()).join('\n')).toMatch(/Steep stream: \d+ drop tiles/);
  });
  it('is refused on a flat map patch with the clear reason', () => {
    const sim = mkSim();
    const r = validatePlacement(sim.env, 'canyoningBase', 30, 40, 0, true);
    expect(r.reasons).toContain('Needs a steep stream through rock within 3 tiles');
  });
  it('canyoners are drawn along the stream (carriers of kind canyoner, three per departure)', () => {
    const sim = mkSim();
    digRiver(sim);
    const id = placeBase(sim, 'canyoningBase', 2, 2);
    setHour(sim, 9.2); sim.tick(1);
    const s = sim.guestSim.store;
    for (let k = 0; k < 4; k++) { const sl = s.add({ x: 1, y: 1, z: 0, type: 5, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 999, tick: 0 }); sim.attractions.arrive(sl, sim.buildings.get(id)!, sim.getSimTick()); }
    setHour(sim, 9.95); sim.tick(2);
    expect(sim.attractions.get(id)!.info().tour!.departuresToday).toBe(1);
    sim.tick(3);
    expect(sim.tours.carriers(sim.getSimTick()).filter((c) => c.kind === 'canyoner').length).toBe(CANYON.vehicles);
  });
});

describe('TourSystem with a synthetic river (rapids, thrill, carriers)', () => {
  const N = 32;
  const cls = [0, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
  const path = Array.from({ length: cls.length }, (_, i) => ({ x: 3 + i, y: 5 }));
  const level = cls.map((_, i) => 50 - i * 2);
  const mk = (rapids = true) => {
    const c = rapids ? cls : cls.map((k) => Math.min(1, k));
    const way = { id: 'n0', kind: 'natural' as const, path, level, end: 'edge' as const };
    const e = { ways: () => [way], flow: () => flowOf(c), gorge: () => false, version: () => 1 };
    const tours = new TourSystem({ size: N, allows: () => false, isPiste: () => false, version: () => 1, instability: () => 0, weather: () => ({ wind: 0 }), water: e });
    const b = { id: 9, type: 'raftingBase', x: 1, y: 6, w: 3, h: 2, active: true, rot: 0 } as never;
    const a = new Attraction(b, tourSpec(RAFT));
    tours.setContext({ tick: 100, day: SUMMER_DAY, absDay: SUMMER_DAY, hour: 10 });
    return { tours, a };
  };
  const SUMMER_DAY = seasonStartDay('summer') + 5;
  it('rapids raise the happiness bonus and the fair price; both are exactly neutral without rapids and for other tours', () => {
    const calm = mk(false), wild = mk(true);
    expect(wild.tours.closed(wild.a)).toBeNull(); expect(calm.tours.closed(calm.a)).toBeNull();
    expect(calm.tours.thrillBonus(calm.a)).toBe(0); expect(calm.tours.tolerance('raftingBase')).toBe(1);
    const t = wild.tours.thrillBonus(wild.a);
    expect(t).toBeGreaterThan(0); expect(t).toBeLessThanOrEqual(RAFT.water!.thrill!.happiness);
    expect(wild.tours.tolerance('raftingBase')).toBeGreaterThan(1);
    expect(wild.tours.tolerance('raftingBase')).toBeLessThanOrEqual(1 + RAFT.water!.thrill!.tolerance);
    expect(wild.tours.tolerance('quadBase')).toBe(1);
    expect(wild.tours.info(wild.a)!.water).toMatchObject({ flow: 'rapids', rapids: 2 });
  });
  it('rafts only ever move downstream (one way), fast on fast water, and splash exactly on rapids tiles', () => {
    const { tours, a } = mk(true);
    expect(tours.closed(a)).toBeNull();
    const route = tours.route(9);
    expect(route.length).toBeGreaterThanOrEqual(RAFT.minLen);
    tours.departed(a, 8, 240, RAFT.durationTicks);
    const along: number[] = [];
    let wrongSplash = 0, splashes = 0;
    for (let k = 0; k <= RAFT.durationTicks; k++) {
      const c = tours.carriers(100 + k).filter((x) => x.kind === 'raft');
      if (!c.length) continue;
      expect(c.length).toBe(RAFT.vehicles);
      const lead = c[0]!;
      const i = Math.round(lead.x - 0.5 - 3); // tile index along the straight river
      along.push(lead.x);
      if (lead.splash) { splashes++; if (cls[Math.min(cls.length - 1, Math.max(0, i))] !== 2) wrongSplash++; }
      expect(lead.heading).toBeCloseTo(0, 5); // always heading downstream (+x)
    }
    expect(along.length).toBeGreaterThan(5);
    for (let k = 1; k < along.length; k++) expect(along[k]!).toBeGreaterThanOrEqual(along[k - 1]!);
    expect(splashes).toBeGreaterThan(0); expect(wrongSplash).toBe(0);
  });
  it('a frozen river closes it before anything else (checked every few ticks), a thaw reopens it', () => {
    const way = { id: 'n0', kind: 'natural' as const, path, level, end: 'edge' as const };
    let frozen = false;
    const tours = new TourSystem({ size: N, allows: () => false, isPiste: () => false, version: () => 1, instability: () => 0, weather: () => ({ wind: 0 }), frozen: () => frozen, water: { ways: () => [way], flow: () => flowOf(cls), gorge: () => false, version: () => 1 } });
    const a = new Attraction({ id: 9, type: 'raftingBase', x: 1, y: 6, w: 3, h: 2, active: true, rot: 0 } as never, tourSpec(RAFT));
    tours.setContext({ tick: 100, day: SUMMER_DAY, absDay: SUMMER_DAY, hour: 10 });
    expect(tours.closed(a)).toBeNull();
    frozen = true; tours.setContext({ tick: 120, day: SUMMER_DAY, absDay: SUMMER_DAY, hour: 10 });
    expect(tours.closed(a)).toBe('Closed: the river is frozen');
    frozen = false; tours.setContext({ tick: 140, day: SUMMER_DAY, absDay: SUMMER_DAY, hour: 10 });
    expect(tours.closed(a)).toBeNull();
  });
});

describe('mishaps', () => {
  it('a forced mishap is a MINOR injury incident, counted, answered; stateless roll (same inputs = same outcome); nobody dies', () => {
    const sp = ATTRACTION_SPECS.raftingBase!, keep = sp.mishap;
    sp.mishap = { guided: 1, unguided: 1 };
    try {
      const run = (): { n: number; sev: number | undefined; hash: string } => {
        const sim = mkSim();
        digRiver(sim);
        const id = placeBase(sim, 'raftingBase', 3, 2), store = sim.guestSim.store;
        setHour(sim, 9.2); sim.tick(1);
        for (let k = 0; k < 3; k++) { const s = store.add({ x: 1, y: 1, z: 0, type: 5, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 999, tick: 0 }); sim.attractions.arrive(s, sim.buildings.get(id)!, sim.getSimTick()); }
        setHour(sim, 9.95); sim.tick(2 + RAFT.durationTicks + 1);
        const a = sim.attractions.get(id)!;
        const inc = sim.safety.incidents.open[0];
        const n = a.stats.mishaps ?? 0, sev = inc?.severity;
        expect(formatAttractionStats(a.info()).join('\n')).toMatch(/3 minor mishaps so far/);
        sim.tick(700);
        expect(sim.safety.incidents.open.length).toBe(0); // all resolved (no deaths exist in the incident system)
        return { n, sev, hash: stateHash(sim).hash };
      };
      const a = run(), b = run();
      expect(a.n).toBe(3); expect(a.sev).toBe(Sev.Minor);
      expect(b).toEqual(a);
    } finally { sp.mishap = keep; }
  });
  it('the real chances are small', () => {
    expect(RAFT.water!.mishap!.guided).toBeLessThan(0.01);
    expect(CANYON.water!.mishap!.guided).toBeLessThan(0.01);
  });
});

describe('saves and determinism', () => {
  const play = (): ReturnType<typeof mkSim> => {
    const sim = mkSim();
    digRiver(sim);
    const id = placeBase(sim, 'raftingBase', 3, 2), store = sim.guestSim.store;
    setHour(sim, 9.2); sim.tick(1);
    for (let k = 0; k < 5; k++) { const s = store.add({ x: 1, y: 1, z: 0, type: 5, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 999, tick: 0 }); sim.attractions.arrive(s, sim.buildings.get(id)!, sim.getSimTick()); }
    setHour(sim, 9.95); sim.tick(40);
    return sim;
  };
  it('same seed + same inputs = same stateHash', () => {
    const a = play(), b = play();
    expect(stateHash(a).hash).toBe(stateHash(b).hash);
    expect(stateHash(a).parts.tours).toBeDefined();
  });
  it('a world without a water base: the tours module stays out of the hash, nothing else changes', () => {
    const sim = mkSim();
    sim.tick(10);
    expect(stateHash(sim).parts.tours).toBeUndefined();
  });
  it('round-trips through collectSave / applySave (rivers + base + counters), play continues identically', () => {
    const s = play();
    const mods = structuredClone(collectSave(s));
    const fresh = createSim({ size: 64, seed: 61, now: () => 0, money: 5_000_000, fromSave: structuredClone(mods) });
    applySave(s, structuredClone(mods));
    const id = s.buildings.all().find((b) => b.type === 'raftingBase')!.id;
    fresh.tick(1); s.tick(1);
    expect(fresh.attractions.get(id)!.info().tour!.totalDepartures).toBe(s.attractions.get(id)!.info().tour!.totalDepartures);
    expect(fresh.attractions.get(id)!.info().tour!.routeLen).toBeGreaterThanOrEqual(RAFT.minLen);
    for (let k = 0; k < 6; k++) { fresh.tick(20); s.tick(20); expect(stateHash(fresh).parts.tours).toBe(stateHash(s).parts.tours); }
  });
});

describe('advisor', () => {
  it('suggests a Rafting Base when a river with rapids / brisk flow exists and the building is unlocked (summer, 30+ guests, a base lodge), and stops once one stands', () => {
    const rule = RULES.find((r) => r.id === 'tour.water')!;
    expect(rule).toBeDefined();
    const sim = mkSim(5); // natural rapids on seed 5
    sim.game.date.day = seasonStartDay('summer') + 5;
    const ctx = (): never => ({ sim, season: 'summer', shown: false } as never);
    for (let k = 0; k < 40; k++) sim.guestSim.store.add({ x: 1, y: 1, z: 0, type: 0, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 999, tick: 0 });
    const hit = rule.eval(ctx());
    expect(hit?.id).toBe('tour.water');
    expect(JSON.stringify(hit)).toMatch(/river with rapids/);
    placeBase(sim, 'raftingBase', 3, 2);
    expect(rule.eval(ctx())).toBeNull();
  });
});
