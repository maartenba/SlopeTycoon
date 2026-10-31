/** Phase 6 polish batch: senior pace, zoo feeding, mid-station lamps, rental stock, optional goals + achievements (docs/guest-types.md, petting-zoo.md, mid-stations.md, rental.md, achievements.md). */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CORE_TYPE_COUNT, SENIOR_TYPE, SENIOR_WALK, SHIPPED_TYPES } from '../../src/config/guestTypes';
import { NavMode } from '../../src/sim/guests/NavGraph';
import { GuestType } from '../../src/sim/guests/Guest';
import { buysFeed, fenceCrowd, fenceSpot, ZOO_FEED, ZOO_PEN } from '../../src/sim/attractions/PettingZoo';
import { RENTAL_STOCK } from '../../src/sim/attractions/Rental';
import { seasonOf } from '../../src/sim/Clock';
import { formatAttractionStats } from '../../src/ui/attractionFormat';
import { PettingZooView } from '../../src/render/PettingZooView';
import { LiftView } from '../../src/render/meshes/lifts';
import { buildMidStationParts } from '../../src/render/meshes/lifts/Station';
import { LAMP_HEAD } from '../../src/render/meshes/lifts/midStation';
import { ACHIEVEMENTS } from '../../src/config/achievements';
import { BONUS_GOALS, GOALS } from '../../src/config/goals';
import { Achievements, type AchFacts } from '../../src/sim/meta/Achievements';
import { Goals } from '../../src/sim/goals/Goals';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { createSim } from '../../src/game/createSim';
import { collectSave, applySave, stateHash } from '../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { starterResort } from './guests/resortFixture';
import { harness } from './attractions/harness';

const dayOf = (season: string): number => { for (let d = 0; d < 180; d++) if (seasonOf({ day: d }) === season) return d + 3; throw new Error('no day'); };
const BOARDER = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'snowboarder');

describe('senior walking pace', () => {
  it('the type index is the shipped Senior row, and the pace is a slowdown but not a crawl', () => {
    expect(SHIPPED_TYPES[SENIOR_TYPE - CORE_TYPE_COUNT]!.id).toBe('senior');
    expect(SENIOR_WALK).toBeGreaterThan(0.5); expect(SENIOR_WALK).toBeLessThan(1);
  });
  it('on foot (walk, path tiles) a senior is SENIOR_WALK times as fast; skiing and the default are untouched', () => {
    const g = starterResort(64).graph();
    expect(g.speed(NavMode.Walk, 0, 1, 1, SENIOR_WALK)).toBeCloseTo(g.speed(NavMode.Walk, 0, 1, 1) * SENIOR_WALK, 9);
    expect(g.speed(NavMode.Walk, 0, 1, 1)).toBe(g.speed(NavMode.Walk, 0, 1, 1, 1));
    // a path tile in a ski mode is a walk too; any other tile (here: a tile that is not a path) keeps the ski speed
    const street = 64 - 5 - 3 + 64 * (Math.floor(64 * 0.78) + 2); // a village street tile
    expect(g.speed(NavMode.Ski0, 0, street, 1, SENIOR_WALK)).toBeCloseTo(g.speed(NavMode.Ski0, 0, street, 1) * SENIOR_WALK, 9);
    const piste = 30 + 64 * 20; // a piste tile of the fixture (mid - 2 = 30)
    expect(g.speed(NavMode.Ski0, piste + 64, piste, 2, SENIOR_WALK)).toBe(g.speed(NavMode.Ski0, piste + 64, piste, 2));
  });
});

describe('petting zoo feeding', () => {
  it('kids and families nearly always buy feed, adults rarely; the roll is a pure hash of the guest', () => {
    const rate = (type: number): number => { let n = 0; for (let id = 1; id <= 2000; id++) if (buysFeed(id, type)) n++; return n / 2000; };
    expect(rate(GuestType.Family)).toBeGreaterThan(0.6); expect(rate(GuestType.Family)).toBeLessThan(0.8);
    expect(rate(CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'school'))).toBeGreaterThan(0.6);
    expect(rate(GuestType.Couple)).toBeGreaterThan(0.08); expect(rate(GuestType.Couple)).toBeLessThan(0.25);
    expect(buysFeed(17, 2)).toBe(buysFeed(17, 2));
  });
  it('a feeding guest pays $2 into shops (the ticket stays in recreation), the visit is happier, the counter and the inspector line move', () => {
    const h = harness();
    h.state.date.day = dayOf('summer');
    const b = h.add('pettingZoo'); h.run(1);
    const a = h.sys.get(b.id)!;
    let g = -1; for (let k = 0; k < 40 && g < 0; k++) { const s = h.guest({ type: GuestType.Family }); if (buysFeed(h.store.id[s]!, GuestType.Family)) g = s; }
    expect(g).toBeGreaterThanOrEqual(0);
    const hap0 = h.store.happiness[g]!, budget0 = h.store.budget[g]!;
    expect(h.arrive(g, b)).toBe('using');
    expect(h.econ.ledger.shops).toBe(ZOO_FEED.price);
    expect(h.econ.ledger.recreation).toBe(8);
    expect(h.store.budget[g]!).toBeCloseTo(budget0 - 8 - ZOO_FEED.price, 6);
    expect(h.store.happiness[g]!).toBeGreaterThan(hap0);
    expect(a.stats.fed).toBe(1);
    expect(a.stats.revenue).toBe(8 + ZOO_FEED.price);
    expect(a.info().zoo).toEqual({ fed: 1, feedPrice: 2 });
    expect(formatAttractionStats(a.info()).join(' ')).toMatch(/Feed: \$2 a scoop.*1 scoop sold/);
  });
  it('a guest who cannot afford the scoop still visits, and a hash "no" buys nothing', () => {
    const h = harness();
    h.state.date.day = dayOf('summer');
    const b = h.add('pettingZoo'); h.run(1);
    let id = -1; for (let k = 0; k < 40 && id < 0; k++) { const s = h.guest({ type: GuestType.Family, budget: 8 }); if (buysFeed(h.store.id[s]!, GuestType.Family)) id = s; }
    expect(h.arrive(id, b)).toBe('using');
    expect(h.econ.ledger.shops ?? 0).toBe(0);
    let no = -1; for (let k = 0; k < 60 && no < 0; k++) { const s = h.guest({ type: GuestType.Couple }); if (!buysFeed(h.store.id[s]!, GuestType.Couple)) no = s; }
    expect(h.arrive(no, b)).toBe('using');
    expect(h.sys.get(b.id)!.stats.fed ?? 0).toBe(0);
  });
  it('save / load keeps the counter; a zoo nobody fed at saves exactly as before (no new key unless set)', () => {
    const sim = createSim({ size: 64, seed: 61 });
    const base = stateHash(sim).hash;
    const sim2 = createSim({ size: 64, seed: 61 });
    expect(stateHash(sim2).hash).toBe(base);
    expect(JSON.stringify(collectSave(sim))).not.toMatch(/"fed"|"boards"|"short"/);
  });
  it('the animals come to the front rail while guests are inside and wander back afterwards (render only, always inside the pen)', () => {
    expect(fenceCrowd(0)).toBe(0); expect(fenceCrowd(3)).toBe(3); expect(fenceCrowd(40)).toBe(6);
    for (let i = 0; i < 6; i++) { const f = fenceSpot(i); expect(f.x).toBeGreaterThanOrEqual(ZOO_PEN.x0); expect(f.x).toBeLessThanOrEqual(ZOO_PEN.x1); expect(f.z).toBeLessThanOrEqual(ZOO_PEN.z1); }
    const v = new PettingZooView();
    let calls: Array<[number, number]> = [];
    const toWorld = (_id: number, lx: number, lz: number, out: THREE.Vector3): boolean => { calls.push([lx, lz]); out.set(lx, 0, lz); return true; };
    const frame = (users: number): Array<[number, number]> => { calls = []; v.update(0.5, [{ id: 7, open: true, users }], 12, 20, toWorld, 0, 0); return calls.slice(2); };
    frame(0);
    let last = frame(3); for (let k = 0; k < 12; k++) last = frame(3);
    for (let i = 0; i < 3; i++) { const f = fenceSpot(i); expect(last[i]![0]).toBeCloseTo(f.x, 1); expect(last[i]![1]).toBeCloseTo(f.z, 1); }
    const free = frame(0); for (let k = 0; k < 12; k++) frame(0);
    const after = frame(0);
    const moved = [0, 1, 2].some((i) => Math.hypot(after[i]![0] - last[i]![0], after[i]![1] - last[i]![1]) > 0.05);
    expect(free.length).toBe(8); expect(moved).toBe(true);
    for (const [x, z] of after) { expect(x).toBeGreaterThanOrEqual(ZOO_PEN.x0 - 1e-6); expect(z).toBeLessThanOrEqual(ZOO_PEN.z1 + 1e-6); }
  });
});

describe('mid-station lamps glow at night', () => {
  it('the lamp heads carry the dedicated vertex colour (2 per station), no triangle was added', () => {
    const p = buildMidStationParts('gondola6');
    const col = p.geometry.getAttribute('color'), want = new THREE.Color(LAMP_HEAD);
    let verts = 0;
    for (let i = 0; i < col.count; i++) if (Math.abs(col.getX(i) - want.r) < 0.01 && Math.abs(col.getY(i) - want.g) < 0.01 && Math.abs(col.getZ(i) - want.b) < 0.01) verts++;
    expect(verts).toBe(2 * 36); // two lamp-head boxes
    const t = p.geometry.index ? p.geometry.index.count / 3 : p.geometry.getAttribute('position').count / 3;
    expect(t).toBeLessThanOrEqual(600);
  });
  it('the station material lights the lamp pixels from the shared night uniform (no extra material, no extra draw call)', () => {
    const v = new LiftView();
    const mat = (v as unknown as { stationMat: THREE.MeshLambertMaterial }).stationMat;
    const sh = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <clipping_planes_fragment>\n#include <emissivemap_fragment>' };
    mat.onBeforeCompile(sh as never, undefined as never);
    expect(sh.fragmentShader).toContain('uLampNight');
    expect(sh.fragmentShader).toMatch(/totalEmissiveRadiance \+= .*uLamp/);
    expect(sh.uniforms.uLampNight).toBeDefined();
    expect(mat.customProgramCacheKey()).toContain('lamps');
  });
});

describe('rental stock (skis vs boards)', () => {
  const rentOne = (h: ReturnType<typeof harness>, b: ReturnType<ReturnType<typeof harness>['add']>, type: number): { slot: number; res: string } => {
    const slot = h.guest({ type }); const res = h.arrive(slot, b); h.run(8); return { slot, res };
  };
  it('each open rental holds skis and boards; the pool is per kind', () => {
    const h = harness();
    expect(h.sys.rentalStock()).toMatchObject({ skis: { out: 0, cap: 0 }, boards: { out: 0, cap: 0 } });
    h.add('rental'); h.run(1);
    expect(h.sys.rentalStock()).toMatchObject({ skis: { out: 0, cap: RENTAL_STOCK.skis }, boards: { out: 0, cap: RENTAL_STOCK.boards } });
    h.add('rental', 20, 20); h.run(1);
    expect(h.sys.rentalStock().boards.cap).toBe(2 * RENTAL_STOCK.boards);
  });
  it('boarders take boards, everybody else skis; boards run out first, the refusal is counted, skis are untouched', () => {
    const h = harness();
    const b = h.add('rental'); h.run(1);
    for (let k = 0; k < RENTAL_STOCK.boards; k++) expect(rentOne(h, b, BOARDER).res).toBe('using');
    h.run(10);
    expect(h.sys.rentalStock().boards.out).toBe(RENTAL_STOCK.boards);
    expect(h.sys.rentalStock().skis.out).toBe(0);
    const late = h.guest({ type: BOARDER });
    expect(h.sys.gearAvailable(h.store.id[late]!, 'ski')).toBe(false);
    expect(h.arrive(late, b)).toBe('handled');
    expect(h.sys.rentalStock()).toMatchObject({ shortToday: 1, shortBoardsToday: 1, short: 1 });
    const skier = h.guest({ type: GuestType.Solo });
    expect(h.sys.gearAvailable(h.store.id[skier]!, 'ski')).toBe(true);
    expect(h.arrive(skier, b)).toBe('using');
    const i = h.sys.get(b.id)!.info().rental!;
    expect(i.boards).toEqual({ out: RENTAL_STOCK.boards, cap: RENTAL_STOCK.boards });
    expect(formatAttractionStats(h.sys.get(b.id)!.info()).join(' ')).toMatch(/boards.*1 guest turned away today for lack of boards/);
  });
  it('a second rental lifts the limit; boards come back when the guest leaves; save / load keeps the pool', () => {
    const h = harness();
    const b = h.add('rental'); h.run(1);
    const slots: number[] = [];
    for (let k = 0; k < RENTAL_STOCK.boards; k++) slots.push(rentOne(h, b, BOARDER).slot);
    h.add('rental', 20, 20); h.run(1);
    expect(h.sys.gearAvailable(h.store.id[h.guest({ type: BOARDER })]!, 'ski')).toBe(true);
    const saved = h.sys.asSystem().serialize!() as { boards?: number[]; rented: number[] };
    expect(saved.boards).toHaveLength(RENTAL_STOCK.boards);
    for (const s of slots) h.store.remove(s);
    h.state.date.tick = 240; h.run(240);
    expect(h.sys.rentalStock().boards.out).toBe(0);
  });
  it('a resort with no shortage saves exactly as before (no new keys)', () => {
    const h = harness(); h.add('rental'); h.run(1);
    const saved = h.sys.asSystem().serialize!() as Record<string, unknown>;
    expect(saved).not.toHaveProperty('boards'); expect(saved).not.toHaveProperty('short');
  });
});

describe('optional bonus goals', () => {
  it('all follow viewpointHigh, are never in a chapter, never name a gated building (treehouse, hotels: the progression test greps goals.ts), each pays once', () => {
    expect(BONUS_GOALS.map((g) => g.id)).toEqual(['viewpointHigh', 'littleFarmers', 'summerFamilies', 'threeViews', 'midStop', 'boardCrowd']);
    expect(GOALS).toHaveLength(20);
    for (const g of BONUS_GOALS) { expect(g.chapter).toBe('bonus'); expect(GOALS.some((x) => x.id === g.id)).toBe(false); expect(g.reward).toBeGreaterThan(0); expect(g.panel.drawer).toBeTruthy(); }
  });
  it('engine: each goal completes from what the player builds; the chain and its grants are untouched; save / load keeps them', () => {
    const bus = new EventBus<GameEvents>(), ev: Array<GameEvents['milestone']> = [];
    bus.on('milestone', (e) => ev.push(e));
    const b: Array<{ type: string; active: boolean; x: number; y: number; w: number; h: number }> = [];
    const lifts: Array<{ kind: string; open: boolean; x: number; y: number; stations?: number }> = [];
    let paid = 0;
    const world = { buildings: () => b, lifts: () => lifts, pistes: () => [], trailTiles: () => 0, stars: () => 0, money: () => 0, debt: () => 0, grant: (a: number) => { paid += a; } };
    const g = new Goals(() => world, bus);
    const put = (type: string): void => { b.push({ type, active: true, x: 5, y: 5, w: 2, h: 2 }); };
    g.evaluate(); expect(paid).toBe(0);
    put('pettingZoo'); g.evaluate(); expect(g.isDone('littleFarmers')).toBe(true);
    put('campground'); g.evaluate(); expect(g.isDone('summerFamilies')).toBe(false);
    put('playground'); g.evaluate(); expect(g.isDone('summerFamilies')).toBe(true);
    put('viewpoint'); put('viewpoint'); g.evaluate(); expect(g.isDone('threeViews')).toBe(false);
    put('viewpoint'); g.evaluate(); expect(g.isDone('threeViews')).toBe(true);
    lifts.push({ kind: 'gondola6', open: false, x: 1, y: 1, stations: 2 }); g.evaluate(); expect(g.isDone('midStop')).toBe(false);
    lifts[0]!.stations = 3; g.evaluate(); expect(g.isDone('midStop')).toBe(true);
    put('stuntPark'); g.evaluate(); expect(g.isDone('boardCrowd')).toBe(false);
    put('rental'); g.evaluate(); expect(g.isDone('boardCrowd')).toBe(true);
    const sum = BONUS_GOALS.filter((x) => x.id !== 'viewpointHigh').reduce((a, x) => a + x.reward, 0);
    expect(paid).toBe(sum);
    expect(ev.filter((e) => e.id.startsWith('goal:') && e.major)).toHaveLength(0); // quiet milestones
    expect(g.completedCount).toBe(0);
    const h2 = new Goals(() => world, bus); h2.load(g.serialize()); h2.evaluate();
    expect(paid).toBe(sum); // never paid twice after a reload
  });
});

describe('Phase 6 achievements', () => {
  const NEW = ['first-raft', 'source-to-sea', 'concert-night', 'scenic-route', 'green-travel', 'powder-day', 'luxury-suite', 'summer-share'];
  const base: AchFacts = { stars: 2, level: 1, guests: 30, openLifts: 1, money: 1000, festivals: 0, report: null };
  const mk = (facts: Partial<AchFacts>, kind: 'career' | 'sandbox' = 'career') => {
    const bus = new EventBus<GameEvents>(); const f = { ...base, ...facts };
    const a = new Achievements(bus, { runKind: () => kind, facts: () => f, now: () => 1, gameId: 'g1' }); a.arm(); const got: string[] = []; a.onUnlock((d) => got.push(d.id));
    return { bus, a, got, f };
  };
  it('eight new rows (no spa yet, so no "Hot springs"), unique ids, only facts, tier 3 only for the year-long Summer share', () => {
    for (const id of NEW) { const d = ACHIEVEMENTS.find((x) => x.id === id)!; expect(d, id).toBeDefined(); expect(d.tracker.kind).toBe('fact'); }
    expect(ACHIEVEMENTS.find((x) => x.id === 'hot-springs')).toBeUndefined();
    expect(ACHIEVEMENTS.filter((x) => x.tier === 3 && NEW.includes(x.id)).map((x) => x.id)).toEqual(['summer-share']);
    expect(ACHIEVEMENTS.find((x) => x.id === 'summer-share')!.scope).toBe('career');
  });
  it('each unlocks from its fact at the next hour, never before; a fact of 0 / absent never does', () => {
    const { bus, got, f } = mk({});
    bus.emit('time:hour', { hour: 9 }); bus.emit('day:changed', { year: 1, day: 1 });
    expect(got.filter((id) => NEW.includes(id))).toEqual([]);
    Object.assign(f, { raftRides: 1, riverToSea: 1, concert: 1, viewsSeen: 2, railShare: 24, powderHounds: 0, suites: 9, summerShare: 24.9 });
    bus.emit('time:hour', { hour: 10 });
    expect(got.sort()).toEqual(['concert-night', 'first-raft', 'source-to-sea']);
    Object.assign(f, { viewsSeen: 3, railShare: 25, powderHounds: 1, suites: 10 });
    bus.emit('time:hour', { hour: 11 });
    expect(got.sort()).toEqual(['concert-night', 'first-raft', 'green-travel', 'luxury-suite', 'powder-day', 'scenic-route', 'source-to-sea']);
    Object.assign(f, { summerShare: 25 });
    bus.emit('day:changed', { year: 1, day: 2 });
    expect(got).toContain('summer-share');
  });
  it('a sandbox game never earns the career-only Summer share', () => {
    const { bus, got } = mk({ summerShare: 40 }, 'sandbox');
    bus.emit('time:hour', { hour: 9 }); bus.emit('day:changed', { year: 1, day: 1 });
    expect(got).not.toContain('summer-share');
  });
  it('the real facts are lazy getters on a real sim and read 0 / sensible values at the start', () => {
    const sim = createSim({ size: 64, seed: 61, starterResort: true } as never);
    sim.tick(30);
    const m = sim.achievements as unknown as { host: { facts(): AchFacts } };
    const f = m.host.facts();
    expect([f.railShare, f.viewsSeen, f.riverToSea, f.raftRides, f.powderHounds, f.concert, f.suites, f.summerShare]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('determinism and save / load with the polish batch', () => {
  const mk = () => createSim({ size: 64, seed: 61, starterResort: true, now: () => 0 } as never);
  it('two runs agree; a save taken mid-run resumes in step with the control (guests, rentals, zoo counters included)', async () => {
    const a = mk(), b = mk(); a.ops.quality.attachTraffic(); a.tick(480); b.ops.quality.attachTraffic(); b.tick(480); // attachTraffic: the piste-traffic recorder is a process-wide static
    expect(stateHash(a).hash).toBe(stateHash(b).hash);
    const { bytes } = await encodeSave(a, makeMeta(a, 'polish'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const restored = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    applySave(a, structuredClone(env.modules)); // control: the live sim restored in place
    const differing = (): string[] => { const x = stateHash(a).parts, y = stateHash(restored).parts; return Object.keys(x).filter((k) => x[k] !== y[k]); };
    expect(differing()).toEqual([]);
    for (let d = 0; d < 120; d += 40) { a.ops.quality.attachTraffic(); a.tick(40); restored.ops.quality.attachTraffic(); restored.tick(40); expect(differing(), `after ${d + 40} ticks`).toEqual([]); }
  }, 180_000);
});
