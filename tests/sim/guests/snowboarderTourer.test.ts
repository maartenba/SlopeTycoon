/** Phase 6 Tasks 33 + 34 + 53: Snowboarder + Ski tourer guest types, Powder Hounds / Park Jam campaigns (docs/guest-types.md, docs/marketing-pricing.md). */
import { afterEach, describe, expect, it } from 'vitest';
import {
  COND_BACKCOUNTRY, CORE_TYPE_COUNT, SHIPPED_TYPES, TOURER_MAX_DANGER, appealFor, convertShare, coreOf, extraWeight, gearOfType, restoreShippedTypes, segmentKey, typeLabel, type ActiveCtx,
} from '../../../src/config/guestTypes';
import { Rng } from '../../../src/core/Rng';
import { seasonStartDay } from '../../../src/sim/Clock';
import { GuestStore, GuestType } from '../../../src/sim/guests/Guest';
import { Decider, FLATS, routeShape, type LiftInfo } from '../../../src/sim/guests/Decision';
import type { DecisionPort } from '../../../src/sim/guests/AttractionPort';
import type { NavGraph } from '../../../src/sim/guests/NavGraph';
import { Touring, type TouringRoutes } from '../../../src/sim/guests/Tourer';
import { ATTRACTION_SPECS } from '../../../src/sim/attractions/registry';
import { BOARD_OWNERS, ownsGear } from '../../../src/sim/attractions/Rental';
import { appearanceOf, gearFor, Gear, HairStyle, typeGearOf } from '../../../src/render/guestAppearance';
import { Marketing, campaignById, campaignEffectiveness, type MarketingContext } from '../../../src/sim/Marketing';
import { Economy } from '../../../src/sim/Economy';
import { CAMPAIGNS, PREREQ_GRACE_DAYS, type PrereqId } from '../../../src/config/marketing';
import { building, fakeWorld, resetIds, rig, type Rig } from './helpers';
import { createSim } from '../../../src/game/createSim';
import { makeResort } from '../../game/harness';
import { Spawner } from '../../../src/sim/guests/Spawner';
import { stateHash } from '../../../src/sim/Systems';

const BOARDER = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'snowboarder');
const TOURER = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'tourer');
const boarder = SHIPPED_TYPES[BOARDER - CORE_TYPE_COUNT]!;
const tourer = SHIPPED_TYPES[TOURER - CORE_TYPE_COUNT]!;
afterEach(() => restoreShippedTypes());

const ctx = (season: ActiveCtx['season'], level = 99, has: (id: string) => boolean = () => false): ActiveCtx => ({ season, level, hasBuilding: has });

describe('rows', () => {
  it('Snowboarder is index 10, Ski tourer 11; segments, fallbacks, look hooks', () => {
    expect(BOARDER).toBe(10); expect(TOURER).toBe(11);
    expect(typeLabel(BOARDER)).toBe('Snowboarder'); expect(typeLabel(TOURER)).toBe('Ski tourer');
    expect(segmentKey(BOARDER)).toBe('adventure'); expect(segmentKey(TOURER)).toBe('adventure');
    expect(coreOf(BOARDER)).toBe(GuestType.Adventure);
    expect(gearOfType(BOARDER)).toBe('board'); expect(typeGearOf(BOARDER)).toBe('board'); expect(typeGearOf(TOURER)).toBe('ski');
  });
});

describe('Snowboarder: carved out of the core draw (shares by season, gating, volume)', () => {
  it('adds no weight of its own, converts in winter / spring / autumn, never in summer', () => {
    for (const s of ['winter', 'spring', 'summer', 'autumn'] as const) expect(extraWeight(boarder, ctx(s))).toBe(0);
    expect(convertShare(boarder, ctx('winter'))).toBeGreaterThan(0.3);
    expect(convertShare(boarder, ctx('spring'))).toBeGreaterThan(0.3);
    expect(convertShare(boarder, ctx('autumn'))).toBeGreaterThan(0.3);
    expect(convertShare(boarder, ctx('summer'))).toBe(0);
  });
  it('the converted share of ALL winter arrivals is about the old cosmetic boarder share (30 %)', () => {
    // from-set weight in TYPE_MIX.winter: solo .2 + couple .2 + budget .15 + adventure .15 = .7
    expect(0.7 * boarder.convert!.share.winter!).toBeGreaterThan(0.27); expect(0.7 * boarder.convert!.share.winter!).toBeLessThan(0.33);
  });
  const fill = (season: 'winter' | 'summer', n: number, seed = 42, v2 = true): { h: number[]; r: Rig } => {
    resetIds();
    const r = rig(fakeWorld([building('baseLodge', 60, 112), building('parking', 60, 100)]), seed);
    r.state.date.day = seasonStartDay(season) + 3;
    r.sim.spawner.typesV2 = v2; r.sim.spawner.levelFn = () => 99;
    r.sim.spawner.benchFill(r.state, n, n);
    const h = new Array<number>(12).fill(0);
    const s = r.sim.store;
    for (let i = 0; i < s.limit; i++) if (s.alive[i]) h[s.type[i]!]!++;
    return { h, r };
  };
  it('about 30 % of the winter arrivals are snowboarders; none in summer; none without the types flag', () => {
    const w = fill('winter', 1500); const tot = w.h.reduce((a, b) => a + b, 0);
    expect(w.h[BOARDER]! / tot).toBeGreaterThan(0.22); expect(w.h[BOARDER]! / tot).toBeLessThan(0.38);
    expect(w.h[GuestType.Family]! / tot).toBeGreaterThan(0.15); // families / VIP are not converted
    expect(fill('summer', 800).h[BOARDER]).toBe(0);
    expect(fill('winter', 600, 42, false).h[BOARDER]).toBe(0);
  });
  it('the level gate applies (minLevel 1 passes; a level-0 game gets none)', () => {
    expect(convertShare(boarder, ctx('winter', 0))).toBe(0);
    expect(convertShare(boarder, ctx('winter', 1))).toBeGreaterThan(0);
  });
  it('a campaign multiplier on the type raises the share (Snowboard Park Jam, Powder Hounds)', () => {
    const base = fill('winter', 1500).h[BOARDER]!;
    resetIds();
    const r = rig(fakeWorld([building('baseLodge', 60, 112), building('parking', 60, 100)]), 42);
    r.state.date.day = seasonStartDay('winter') + 3; r.sim.spawner.typesV2 = true; r.sim.spawner.levelFn = () => 99;
    r.sim.spawner.marketingFn = () => ({ weights: { solo: 1, couple: 1, family: 1, vip: 1, budget: 1, adventure: 1 }, boost: 1, types: { snowboarder: 1.5 } });
    r.sim.spawner.benchFill(r.state, 1500, 1500);
    let n = 0; const s = r.sim.store; for (let i = 0; i < s.limit; i++) if (s.alive[i] && s.type[i] === BOARDER) n++;
    expect(n).toBeGreaterThan(base * 1.2);
  });
  it('is deterministic: the same seed gives the same type histogram', () => {
    expect(fill('winter', 400, 7).h).toEqual(fill('winter', 400, 7).h);
  });
});

describe('Snowboarder: park, rental, look, render', () => {
  it('loves the Stunt Park more than any core type does; dislikes kids venues', () => {
    const spec = ATTRACTION_SPECS.stuntPark!;
    const b = appealFor(spec, 'stuntPark', BOARDER)!;
    for (let c = 0; c < CORE_TYPE_COUNT; c++) expect(b).toBeGreaterThan(spec.appeal[c]!);
    expect(appealFor(ATTRACTION_SPECS.kidsGround!, 'kidsGround', BOARDER)!).toBeLessThan(0.2);
  });
  it('park usage rises with the boarder share (stunt-park activity picks)', () => {
    resetIds();
    const park = building('stuntPark', 60, 60), rink = building('iceRink', 62, 60);
    const port: DecisionPort = {
      accepts: () => true, canUse: () => true, queueLength: () => 0, unitPrice: () => 12, needsGear: () => false, bedsFree: () => 0,
      appeal: (id, type) => (id === park.id ? appealFor(ATTRACTION_SPECS.stuntPark!, 'stuntPark', type) ?? 0.25 : 0.55),
    };
    const d = new Decider(() => null);
    d.port = port; d.refresh([park, rink]);
    const uses = (type: number): number => {
      const rng = new Rng(11); const s = new GuestStore(400); let n = 0;
      for (let k = 0; k < 200; k++) {
        const g = s.add({ x: 61, y: 62, z: 0, type, skill: 2, budget: 400, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0.1 });
        s.id[g] = 5000 + k;
        if (d.choose(s, g, rng, 10).building?.type === 'stuntPark') n++;
      }
      return n;
    };
    const sb = uses(BOARDER), solo = uses(GuestType.Solo), adv = uses(GuestType.Adventure);
    expect(sb).toBeGreaterThan(solo); expect(sb).toBeGreaterThanOrEqual(adv);
    // a mix with a bigger boarder share fills the park more
    const mixUse = (share: number): number => Math.round(share * sb + (1 - share) * solo);
    expect(mixUse(0.4)).toBeGreaterThan(mixUse(0.1));
  });
  it('rents boards: fewer boarders bring their own (55 %) than skiers do, so the rental sees them', () => {
    let own = 0; for (let id = 1; id <= 2000; id++) if (ownsGear(id, 'board')) own++;
    expect(own / 2000).toBeGreaterThan(BOARD_OWNERS / 100 - 0.05); expect(own / 2000).toBeLessThan(BOARD_OWNERS / 100 + 0.05);
    let ski = 0; for (let id = 1; id <= 2000; id++) if (ownsGear(id, 'ski')) ski++;
    expect(own).toBeLessThan(ski);
  });
  it('needsGear reads the type: a boarder rents far more often than a skier (full AttractionSystem)', () => {
    const sim = createSim({ size: 64, seed: 61 });
    const sys = sim.attractions;
    let boardNeed = 0, skiNeed = 0;
    const s = sim.guestSim.store;
    for (let k = 0; k < 400; k++) {
      const a = s.add({ x: 5, y: 5, z: 0, type: BOARDER, skill: 1, budget: 300, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0.1 });
      const c = s.add({ x: 5, y: 5, z: 0, type: GuestType.Solo, skill: 1, budget: 300, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0.1 });
      if (sys.needsGear(s.id[a]!, 'ski')) boardNeed++;
      if (sys.needsGear(s.id[c]!, 'ski')) skiNeed++;
    }
    expect(boardNeed).toBeGreaterThan(skiNeed * 1.5);
  });
  it('look: purple tops, beanies over helmets in winter, a board; render reads the type, isBoarder is the old-save fallback', () => {
    let beanies = 0, purple = 0;
    for (let id = 1; id <= 400; id++) {
      const a = appearanceOf(id, BOARDER, true);
      if (a.hairStyle === HairStyle.Beanie) beanies++;
      if (a.top === 9) purple++;
    }
    expect(beanies / 400).toBeGreaterThan(0.5); expect(purple / 400).toBeGreaterThan(0.5);
    const solo = Array.from({ length: 400 }, (_, i) => appearanceOf(i + 1, GuestType.Solo, true).hairStyle === HairStyle.Beanie).filter(Boolean).length;
    expect(beanies).toBeGreaterThan(solo * 1.3);
    // boarders ride boards on every id; a core guest of a NEW game is on skis (typeGear 'ski'), an old-save guest keeps the cosmetic share
    for (let id = 1; id <= 50; id++) expect(gearFor(0, 3, id, 0, typeGearOf(BOARDER))).toBe(Gear.Board);
    let oldBoards = 0; for (let id = 1; id <= 300; id++) if (gearFor(0, 3, id, 0, undefined) === Gear.Board) oldBoards++;
    expect(oldBoards / 300).toBeGreaterThan(0.2);
  });
});

/** A tiny fake nav graph for routeShape: a column of piste tiles with a chosen altitude profile. */
const fakeNav = (alts: number[], width = 1): NavGraph => {
  const n = 16;
  const alt = new Map<number, number>();
  const piste = new Set<number>();
  alts.forEach((a, y) => { for (let x = 0; x < width; x++) { alt.set(y * n + 4 + x, a); piste.add(y * n + 4 + x); } });
  return { size: n, isPiste: (t: number) => piste.has(t), tileAltitude: (t: number) => alt.get(t) ?? 0 } as unknown as NavGraph;
};
const column = (ys: number[]): number[] => ys.map((y) => y * 16 + 4);

describe('Snowboarder: flats and catwalks', () => {
  it('flat detection: a stretch of >= minRun consecutive tiles with a tiny drop counts, short flats and steep runs do not', () => {
    const steep = Array.from({ length: 20 }, (_, i) => 10 - i * 0.2);
    expect(routeShape(fakeNav(steep), column(steep.map((_, i) => i))).flat).toBe(0);
    const longFlat = [...steep.slice(0, 6), ...Array(8).fill(steep[5]!), ...steep.slice(6, 12).map((v) => v - 0.2)];
    const sh = routeShape(fakeNav(longFlat), column(longFlat.map((_, i) => i)));
    expect(sh.flat).toBeGreaterThan(0.3);
    const shortFlat = [...steep.slice(0, 6), ...Array(FLATS.minRun - 2).fill(steep[5]!), ...steep.slice(6, 14).map((v) => v - 0.1)];
    expect(routeShape(fakeNav(shortFlat), column(shortFlat.map((_, i) => i))).flat).toBe(0);
  });
  it('width: a 3-wide piste is wider than a 1-wide one', () => {
    const a = Array.from({ length: 12 }, (_, i) => 10 - i);
    expect(routeShape(fakeNav(a, 3), column(a.map((_, i) => i))).wide).toBeGreaterThan(routeShape(fakeNav(a, 1), column(a.map((_, i) => i))).wide);
  });
  const lift = (id: number, flat: number, wide: number): LiftInfo => ({ lift: { id } as never, skiDescent: [true, true, true, true], bikeDescent: false, topDepth: 0.7, bottomX: 50, bottomY: 50, flat: [flat, flat, flat, flat], wide: [wide, wide, wide, wide] });
  it('boarders avoid the catwalk-heavy run; skiers do not care', () => {
    const d = new Decider(() => null);
    d.lifts = [lift(1, 0.8, 0.3), lift(2, 0, 0.3)];
    const flats = boarder.flats!;
    const share = (useFlats: boolean): number => {
      const rng = new Rng(3); let n = 0;
      for (let k = 0; k < 300; k++) if (d.pickSkiLift(1, 50, 50, rng, -1, useFlats ? flats : undefined)!.lift.id === 2) n++;
      return n / 300;
    };
    expect(share(true)).toBeGreaterThan(0.95);
    expect(share(false)).toBeGreaterThan(0.3); expect(share(false)).toBeLessThan(0.7);
  });
  it('boarders like the wide run when the flats are equal', () => {
    const d = new Decider(() => null);
    d.lifts = [lift(1, 0, 0.2), lift(2, 0, 0.8)];
    const rng = new Rng(5); let wide = 0;
    for (let k = 0; k < 300; k++) if (d.pickSkiLift(1, 50, 50, rng, -1, boarder.flats)!.lift.id === 2) wide++;
    expect(wide / 300).toBeGreaterThan(0.75);
  });
  it('a small happiness hit per run, proportional to the flat share (core types: none)', () => {
    resetIds();
    const r = rig(fakeWorld([building('baseLodge', 60, 112)]));
    const sim = r.sim as unknown as { finishRun(i: number, rng: Rng): void; injuryMult: number };
    sim.injuryMult = 0;
    r.sim.decider.lifts = [{ lift: { id: 7 } as never, skiDescent: [true, true, true, true], bikeDescent: false, topDepth: 0.7, bottomX: 0, bottomY: 0, flat: [0.5, 0.5, 0.5, 0.5], wide: [0.3, 0.3, 0.3, 0.3] }];
    const s = r.sim.store;
    const mk = (type: number): number => { const g = s.add({ x: 10, y: 10, z: 0, type, skill: 1, budget: 300, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0.1, happiness: 0.8 }); s.liftId[g] = 7; return g; };
    const a = mk(BOARDER), b = mk(GuestType.Solo);
    sim.finishRun(a, r.state.rng); sim.finishRun(b, r.state.rng);
    expect(s.happiness[b]).toBeCloseTo(0.8, 5);
    const loss = 0.8 - s.happiness[a]!;
    expect(loss).toBeGreaterThan(0.02); expect(loss).toBeLessThan(0.08); // small
  });
});

describe('Ski tourer', () => {
  const view = (routes: Array<{ id: number; open: boolean; danger: number; tiles: number[] }>): TouringRoutes => ({
    openRoutes: () => routes.filter((x) => x.open),
    dangerOf: (id) => routes.find((x) => x.id === id)?.danger ?? 0,
    isOpen: (id) => routes.find((x) => x.id === id)?.open ?? false,
    routeTiles: (id) => routes.find((x) => x.id === id)?.tiles ?? [],
  });
  it('appears only while an open route below danger 4 exists (the @backcountryRoute gate); winter + spring, level 2', () => {
    expect(extraWeight(tourer, ctx('winter', 99, () => false))).toBe(0);
    expect(extraWeight(tourer, ctx('winter', 99, (id) => id === COND_BACKCOUNTRY))).toBeGreaterThan(0);
    expect(extraWeight(tourer, ctx('spring', 99, (id) => id === COND_BACKCOUNTRY))).toBeGreaterThan(0);
    expect(extraWeight(tourer, ctx('summer', 99, () => true))).toBe(0);
    expect(extraWeight(tourer, ctx('winter', 1, () => true))).toBe(0);
  });
  it('Touring skips routes at danger >= 4 even when they are open (the override is ignored)', () => {
    const t = new Touring();
    expect(t.hasSafeRoute()).toBe(false);
    t.attach(view([{ id: 1, open: true, danger: TOURER_MAX_DANGER, tiles: [1, 2] }, { id: 2, open: true, danger: 5, tiles: [3] }, { id: 3, open: false, danger: 2, tiles: [4] }]));
    expect(t.safeRoutes()).toEqual([]); expect(t.hasSafeRoute()).toBe(false); expect(t.goalTiles(() => 0)).toEqual([]);
    t.attach(view([{ id: 1, open: true, danger: 3, tiles: [10, 11, 12, 13, 14, 15, 16, 17] }, { id: 2, open: true, danger: 4, tiles: [99] }]));
    expect(t.safeRoutes()).toEqual([1]);
    const g = t.goalTiles((tile) => tile); // altitude = tile index: the summit (17) first
    expect(g[0]).toBe(17); expect(g).not.toContain(99); expect(g.length).toBeLessThanOrEqual(3);
  });
  it('the Decider only lists goals of safe routes and clears them when the danger rises (refresh)', () => {
    let danger = 2;
    const d = new Decider(() => null);
    d.touring.attach({ openRoutes: () => [{ id: 1 }], dangerOf: () => danger, isOpen: () => true, routeTiles: () => [5, 6] });
    expect(d.touring.goalTiles((t) => t).length).toBeGreaterThan(0);
    danger = 4;
    expect(d.touring.goalTiles((t) => t)).toEqual([]);
  });
  it('is inert without a backcountry: the spawner draws no tourers; with the flag it does', () => {
    const histogramTourers = (flag: boolean): number => {
      resetIds();
      const r = rig(fakeWorld([building('baseLodge', 60, 112), building('parking', 60, 100)]), 9);
      r.state.date.day = seasonStartDay('winter') + 3; r.sim.spawner.typesV2 = true; r.sim.spawner.levelFn = () => 99;
      if (flag) r.sim.spawner.flagsFn = () => [COND_BACKCOUNTRY];
      r.sim.spawner.benchFill(r.state, 1500, 1500);
      let n = 0; const s = r.sim.store; for (let i = 0; i < s.limit; i++) if (s.alive[i] && s.type[i] === TOURER) n++;
      return n;
    };
    expect(histogramTourers(false)).toBe(0);
    expect(histogramTourers(true)).toBeGreaterThan(20);
  });
  it('low spend, huts loved, bright shell + a backpack', () => {
    expect(tourer.budget![1]).toBeLessThan(250);
    expect(tourer.appeal!.mountainHut).toBeGreaterThanOrEqual(1.5);
    for (let id = 1; id <= 40; id++) expect(appearanceOf(id, TOURER, true).pack).toBe(true);
  });
  it('the full sim with the backcountry attached but no route painted never makes a tourer (a few days)', () => {
    const sim = createSim({ size: 64, seed: 61 });
    expect(sim.guestSim.decider.touring.attached).toBe(true); expect(sim.backcountry.count).toBe(0);
    for (let i = 0; i < 3000; i++) sim.registry.update(sim.game, sim.game.date.tick + 1);
    const s = sim.guestSim.store; let n = 0;
    for (let i = 0; i < s.limit; i++) if (s.alive[i] && s.type[i] === TOURER) n++;
    expect(n).toBe(0);
    expect(typeof stateHash(sim.game, sim.registry)).toBe('string');
  });
});

describe('Campaigns: Powder Hounds + Park Jam retarget (Task 53)', () => {
  const mctx = (o: { missing?: PrereqId[]; powder?: boolean } = {}): MarketingContext => ({
    season: () => 'winter', stars: () => 3, has: () => false, dayPassRatio: () => 1, met: (id) => !(o.missing ?? []).includes(id), powderDay: () => o.powder ?? false,
  });
  const fixture = (c: MarketingContext) => {
    const date = { year: 0, day: 20 };
    const m = new Marketing({ economy: new Economy({ money: 100000 }), date: () => date, ctx: c });
    return { m, date, adv: (d: number) => { date.day += d; m.update(); } };
  };
  const powder = campaignById('powder')!;
  it('the row: $5,500 / 10 d / 21 d cooldown, +0.06, winter, tourer 1.6 snowboarder 0.5 adventure 0.4, prereqs backcountry + patrol + dining', () => {
    expect(powder.cost).toBe(5500); expect(powder.durationDays).toBe(10); expect(powder.cooldownDays).toBe(21); expect(powder.volumeBoost).toBe(0.06);
    expect(powder.seasons).toEqual(['winter']); expect(powder.offSeason).toBe(0.1); expect(powder.extraTargets).toEqual({ tourer: 1.6, snowboarder: 0.5 }); expect(powder.targets).toEqual({ adventure: 0.4 });
    expect(powder.prereqs.map((p) => p.id)).toEqual(['backcountry', 'patrol', 'dining']);
    expect(powder.powderMult).toBe(1.3);
  });
  it('is refused without an open route below danger 4, a Patrol Hub or a place to eat', () => {
    for (const m of ['backcountry', 'patrol', 'dining'] as const) expect(fixture(mctx({ missing: [m] })).m.start('powder')).toMatch(/Requires/);
    expect(fixture(mctx()).m.start('powder')).toBeNull();
  });
  it('powder days boost the live effect x1.3; ordinary days do not', () => {
    const a = fixture(mctx({ powder: true })), b = fixture(mctx({ powder: false }));
    a.m.start('powder'); b.m.start('powder');
    const ta = a.m.effect().types.tourer! - 1, tb = b.m.effect().types.tourer! - 1;
    expect(ta / tb).toBeCloseTo(1.3, 2);
    expect(a.m.effect().boost - 1).toBeCloseTo((b.m.effect().boost - 1) * 1.3, 3);
  });
  it('pauses while every route is closed for avalanche danger (prereq lapse), resumes after, cancels after the grace days', () => {
    let missing: PrereqId[] = [];
    const c = mctx(); c.met = (id) => !missing.includes(id);
    const f = fixture(c);
    expect(f.m.start('powder')).toBeNull();
    expect(f.m.effect().types.tourer!).toBeGreaterThan(1.5);
    missing = ['backcountry']; f.adv(1);
    expect(f.m.running()[0]!.lapsed).toBe(1);
    expect(f.m.effect().types.tourer ?? 1).toBe(1);
    missing = []; f.adv(1); expect(f.m.effect().types.tourer!).toBeGreaterThan(1.5);
    missing = ['backcountry'];
    for (let d = 0; d < PREREQ_GRACE_DAYS + 1; d++) f.adv(1);
    expect(f.m.running()).toHaveLength(0);
  });
  it('works only in winter (x0.1 elsewhere) and its copy never mentions death', () => {
    const e = campaignEffectiveness(powder, { ...mctx(), season: () => 'summer' });
    expect(e.value).toBeLessThan(campaignEffectiveness(powder, mctx()).value * 0.2);
    expect(`${powder.name} ${powder.blurb} ${powder.prereqs.map((p) => p.label).join(' ')} ${powder.segment}`).not.toMatch(/death|dead|die|kill|fatal|bur(y|ied)|avalanche victim/i);
  });
  it('Snowboard Park Jam is retargeted to the Snowboarder (1.4) + adventure 0.4', () => {
    const p = campaignById('parkJam')!;
    expect(p.extraTargets).toEqual({ snowboarder: 1.4 }); expect(p.targets).toEqual({ adventure: 0.4 });
    const f = fixture(mctx()); expect(f.m.start('parkJam')).toBeNull();
    expect(f.m.effect().types.snowboarder!).toBeGreaterThan(1.3);
  });
  it('every campaign still lists labelled prerequisites', () => {
    for (const c of CAMPAIGNS) for (const p of c.prereqs) expect(p.label.length).toBeGreaterThan(3);
  });
});

describe('save / load + real resort', () => {
  it('Spawner remembers the legacy-boarder cut-off: new games 0, a save without the field resolves to the guests already there', () => {
    resetIds();
    const r = rig(fakeWorld([building('baseLodge', 60, 112)]));
    const sp = r.sim.spawner;
    expect(sp.legacyBoarderBelow).toBe(0);
    const saved = JSON.parse(JSON.stringify(sp.serialize())) as { legacyBelow?: number };
    expect(saved.legacyBelow).toBe(0);
    const old = { ...saved }; delete old.legacyBelow;
    r.sim.store.add({ x: 1, y: 1, z: 0, type: 0, skill: 1, budget: 1, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0 });
    r.sim.store.add({ x: 1, y: 1, z: 0, type: 0, skill: 1, budget: 1, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0 });
    const sp2 = new Spawner(r.world, r.sim.store, r.sim.hash);
    sp2.load(old);
    expect(sp2.legacyBoarderBelow).toBe(r.sim.store.nextGuestId); // ids 1, 2 exist: both keep the cosmetic boarders
    sp2.load(saved);
    expect(sp2.legacyBoarderBelow).toBe(0);
  });
  it('a real winter resort: boarders arrive, the decider knows the lifts\' flat / wide shape, the sim stays deterministic and clean', () => {
    const go = (): { hash: string; boarders: number; shaped: boolean; runs: number } => {
      const { sim } = makeResort(64, 61);
      for (let i = 0; i < 4 * 240; i++) sim.registry.update(sim.game, sim.game.date.tick + 1);
      const s = sim.guestSim.store; let b = 0;
      for (let i = 0; i < s.limit; i++) if (s.alive[i] && s.type[i] === BOARDER) b++;
      return { hash: stateHash(sim.game, sim.registry), boarders: b, shaped: sim.guestSim.decider.lifts.some((l) => !!l.flat && !!l.wide), runs: sim.guestSim.runsCompleted };
    };
    const a = go(), c = go();
    expect(a.hash).toBe(c.hash);
    expect(a.boarders).toBeGreaterThan(0);
    expect(a.shaped).toBe(true);
    expect(a.runs).toBeGreaterThan(0);
  });
});
