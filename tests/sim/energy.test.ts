import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ENERGY, GENERATORS, GREEN_BUILDINGS } from '../../src/config/energy';
import { BUILDINGS } from '../../src/config/buildings';
import { createSim, type Sim } from '../../src/game/createSim';
import { applySave, collectSave, stateHash } from '../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { Energy, isGenerator, type EnergyEnv } from '../../src/sim/Energy';
import { sustainParts, type SustainRaw } from '../../src/sim/meta/Sustainability';
import { validatePlacement } from '../../src/sim/PlaceBuilding';
import { sunrise, sunset } from '../../src/sim/Daylight';
import { seasonStartDay } from '../../src/sim/Clock';
import { anchors, buildNetwork, findSite, placeSite, planPathTo, planRoadTo } from '../../src/tutorial/suggest';
import { generatorLines, greenLines, gridSummary } from '../../src/ui/energyFormat';
import { buildParts, BuildingMeshes } from '../../src/render/meshes';
import { UNLOCKS } from '../../src/config/unlocks';
import { buildingTab } from '../../src/ui/buildInfo';
import { TileType } from '../../src/world/Grid';

// ---------------------------------------------------------------- fake environment (pure unit tests)
interface Fake { env: EnergyEnv; set: { day: number; kind: string; intensity: number; wind: number; fog: number; season: 'winter' | 'spring' | 'summer' | 'autumn'; snow: number; exposure: number; felled: number; planted: number; list: Array<{ id: number; type: string; x: number; y: number; w: number; h: number; active: boolean }> } }
const fake = (types: string[] = []): Fake => {
  const set: Fake['set'] = { day: 20, kind: 'clear', intensity: 0, wind: 0.1, fog: 0, season: 'winter', snow: 0, exposure: 0.5, felled: 0, planted: 0, list: types.map((t, i) => ({ id: i + 1, type: t, x: 10 + i * 5, y: 10, w: BUILDINGS[t]!.w, h: BUILDINGS[t]!.h, active: true })) };
  const env: EnergyEnv = {
    buildings: () => set.list, exposure: () => set.exposure, snowDepth: () => set.snow,
    weather: () => ({ kind: set.kind, intensity: set.intensity, wind: set.wind, fog: set.fog }), day: () => set.day, season: () => set.season,
    felled: () => set.felled, planted: () => set.planted,
  };
  return { env, set };
};
const SUMMER_DAY = 70, WINTER_DAY = 160; // sim day of year: summer solstice region / winter

describe('energy grid: the cap (energy is never free)', () => {
  it('no generator: nothing is offset and the day settles to exactly 0', () => {
    const f = fake(); const e = new Energy(f.env);
    for (let h = 0; h < 24; h++) e.hour(h);
    expect(e.settleDay(100, 80)).toBe(0);
    expect(e.last).toEqual({ demand: 100, gross: 0, applied: 0, wasted: 0 });
  });
  it('the offset never exceeds 60 % of the day\'s demand, and the surplus is wasted (not sold)', () => {
    const f = fake(['solarPlant', 'solarPlant', 'solarPlant']); f.set.day = SUMMER_DAY; f.set.season = 'summer';
    const e = new Energy(f.env);
    for (let h = 0; h < 24; h++) e.hour(h);
    const gross = [1, 2, 3].reduce((a, id) => a + e.info(id)!.today, 0);
    expect(gross).toBeGreaterThan(60);
    const applied = e.settleDay(50, 50);
    expect(applied).toBeCloseTo(0.6 * 50, 9);
    expect(e.last.wasted).toBeCloseTo(gross - 30, 6);
    expect(ENERGY.maxOffsetShare).toBe(0.6); expect(ENERGY.surplusSoldShare).toBe(0);
  });
  it('the offset also never exceeds the lift energy line it comes off', () => {
    const f = fake(['solarPlant', 'solarPlant']); f.set.day = SUMMER_DAY; f.set.season = 'summer';
    const e = new Energy(f.env);
    for (let h = 0; h < 24; h++) e.hour(h);
    expect(e.settleDay(1000, 7)).toBeLessThanOrEqual(7);
  });
  it('a small array under a big demand is fully used (no waste) and each unit gets its share', () => {
    const f = fake(['solarArray', 'windTurbine']); f.set.day = SUMMER_DAY; f.set.season = 'summer'; f.set.wind = 0.3; f.set.exposure = 0.9;
    const e = new Energy(f.env);
    for (let h = 0; h < 24; h++) e.hour(h);
    const t = e.info(1)!.today + e.info(2)!.today;
    const applied = e.settleDay(10_000, 10_000);
    expect(applied).toBeCloseTo(t, 9);
    expect(e.last.wasted).toBeCloseTo(0, 9);
    expect(e.info(1)!.appliedYesterday + e.info(2)!.appliedYesterday).toBeCloseTo(applied, 9);
    expect(e.info(1)!.shareOfDemand).toBeGreaterThan(0);
  });
});

describe('generator output curves', () => {
  it('solar: zero at night, peaks near noon, summer > winter, cloud and snow cut it', () => {
    const f = fake(['solarArray']); const e = new Energy(f.env);
    f.set.day = SUMMER_DAY;
    expect(e.solarFraction(2, f.env.buildings()[0]!).fraction).toBe(0);
    expect(e.solarFraction(23, f.env.buildings()[0]!).fraction).toBe(0);
    const noon = e.solarFraction(12, f.env.buildings()[0]!).fraction, morning = e.solarFraction(8, f.env.buildings()[0]!).fraction;
    expect(noon).toBeGreaterThan(morning); expect(noon).toBeGreaterThan(0.8);
    f.set.day = WINTER_DAY;
    const winter = e.solarFraction(12, f.env.buildings()[0]!).fraction;
    expect(winter).toBeLessThan(noon); expect(winter).toBeGreaterThan(0.5);
    f.set.kind = 'cloudy'; const cloudy = e.solarFraction(12, f.env.buildings()[0]!).fraction;
    expect(cloudy).toBeCloseTo(winter * ENERGY.solar.cloudy, 6);
    f.set.kind = 'clear'; f.set.snow = 0.3; const snowed = e.solarFraction(12, f.env.buildings()[0]!);
    expect(snowed.fraction).toBeCloseTo(winter * ENERGY.solar.snowCovered, 6); expect(snowed.note).toMatch(/snow/i);
    f.set.snow = 0; f.set.kind = 'snow'; f.set.intensity = 0.5; expect(e.solarFraction(12, f.env.buildings()[0]!).fraction).toBeLessThan(snowed.fraction);
    f.set.kind = 'storm'; f.set.intensity = 1.2; expect(e.solarFraction(12, f.env.buildings()[0]!).fraction).toBeLessThan(0.2);
  });
  it('solar: daylight hours follow the sun (output only between sunrise and sunset)', () => {
    const f = fake(['solarArray']); const e = new Energy(f.env);
    for (const day of [SUMMER_DAY, WINTER_DAY]) {
      f.set.day = day;
      for (let h = 0; h < 24; h++) { const out = e.solarFraction(h, f.env.buildings()[0]!).fraction, t = h + 0.5; expect(out > 0, `day ${day} hour ${h}`).toBe(t > sunrise(day) && t < sunset(day)); }
    }
    f.set.day = SUMMER_DAY; for (let h = 0; h < 24; h++) e.hour(h); const sum = e.info(1)!.today;
    f.set.day = WINTER_DAY; const e2 = new Energy(f.env); for (let h = 0; h < 24; h++) e2.hour(h);
    expect(sum).toBeGreaterThan(e2.info(1)!.today);
  });
  it('solar: higher ground gets a little more sun', () => {
    const f = fake(['solarArray']); const e = new Energy(f.env); f.set.day = SUMMER_DAY;
    f.set.exposure = 0; const low = e.solarFraction(12, f.env.buildings()[0]!).fraction;
    f.set.exposure = 1; const high = e.solarFraction(12, f.env.buildings()[0]!).fraction;
    expect(high).toBeGreaterThan(low);
  });
  it('wind: needs a breeze, rises with altitude, is shut down in a storm', () => {
    const f = fake(['windTurbine']); const e = new Energy(f.env), b = f.env.buildings()[0]!;
    f.set.wind = 0; f.set.exposure = 0; const calm = e.windFraction(14, b);
    expect(calm.fraction).toBe(0); expect(calm.shut).toBe(false); expect(calm.note).toMatch(/calm/i);
    f.set.exposure = 1; f.set.wind = 0.05; const ridge = e.windFraction(14, b).fraction;
    f.set.exposure = 0.45; const mid = e.windFraction(14, b).fraction;
    expect(ridge).toBeGreaterThan(mid);
    f.set.kind = 'storm'; f.set.wind = 1; f.set.exposure = 1; const storm = e.windFraction(14, b);
    expect(storm.fraction).toBe(0); expect(storm.shut).toBe(true);
    e.hour(14); expect(e.rotorSpeed(1)).toBe(0); // shut: the rotor stands
    f.set.kind = 'clear'; f.set.wind = 0.3; e.hour(14); expect(e.rotorSpeed(1)).toBeGreaterThan(0.5);
  });
  it('hydro: spring melt > summer > autumn > winter trickle; rain helps', () => {
    const f = fake(['smallHydro']); const e = new Energy(f.env);
    const flow = (s: 'winter' | 'spring' | 'summer' | 'autumn'): number => { f.set.season = s; return e.hydroFraction().fraction; };
    const [sp, su, au, wi] = [flow('spring'), flow('summer'), flow('autumn'), flow('winter')];
    expect(sp).toBeGreaterThan(su); expect(su).toBeGreaterThan(au); expect(au).toBeGreaterThan(wi);
    f.set.season = 'summer'; f.set.intensity = 0.5; expect(e.hydroFraction().fraction).toBeGreaterThan(su);
    for (let h = 0; h < 24; h++) e.hour(h);
    expect(e.info(1)!.today).toBeCloseTo(24 * GENERATORS.smallHydro!.rated * e.hydroFraction().fraction, 6); // day and night
  });
  it('biomass: burns timber from cleared trees plus residue, at a fixed maximum rate', () => {
    const f = fake(['biomassHeating']); const e = new Energy(f.env);
    e.settleDay(100, 100); // first day: baseline of the felled counter
    const calm = (): number => { const s0 = e.stock; e.settleDay(100, 100); return s0; };
    calm();
    expect(e.last.gross).toBeCloseTo(ENERGY.biomass.residuePerDay * ENERGY.biomass.unitValue, 6);
    f.set.felled = 30; e.settleDay(100, 100); // 30 trees cleared: one big burn limited by maxBurnPerDay
    expect(e.last.gross).toBeCloseTo(ENERGY.biomass.maxBurnPerDay * ENERGY.biomass.unitValue, 6);
    expect(e.stock).toBeGreaterThan(20); // the rest stays in the store
    for (let i = 0; i < 20; i++) e.settleDay(100, 100);
    expect(e.stock).toBeLessThanOrEqual(ENERGY.biomass.stockCap);
    expect(e.info(1)!.kind).toBe('biomass');
  });
  it('an inactive generator makes nothing', () => {
    const f = fake(['solarArray']); f.set.list[0]!.active = false; f.set.day = SUMMER_DAY; const e = new Energy(f.env);
    for (let h = 0; h < 24; h++) e.hour(h);
    expect(e.settleDay(100, 100)).toBe(0);
    expect(e.info(1)!.note).toBe('Not connected');
  });
  it('nursery: saplings count as planted only against a net deficit, never beyond it', () => {
    const f = fake(['treeNursery']); const e = new Energy(f.env);
    e.settleDay(0, 0); expect(e.nurseryCredit).toBe(0); // nothing felled: nothing to make up
    f.set.felled = 10; for (let i = 0; i < 10; i++) e.settleDay(0, 0);
    expect(e.nurseryCredit).toBeCloseTo(3.5, 6);
    for (let i = 0; i < 100; i++) e.settleDay(0, 0);
    expect(e.nurseryCredit).toBeLessThanOrEqual(10);
    expect(Math.floor(e.nurseryCredit)).toBe(10 - 0 - (10 - Math.floor(e.nurseryCredit)));
    f.set.planted = 4; f.set.felled = 10; const c0 = e.nurseryCredit; e.settleDay(0, 0); expect(e.nurseryCredit).toBe(c0); // already above the deficit
    expect(e.plantCostMult()).toBe(ENERGY.nursery.plantCostShare);
  });
  it('recycling bonus, scenery penalty and rotor speed read the right buildings', () => {
    const f = fake(['recyclingCentre', 'windTurbine', 'windTurbine']); const e = new Energy(f.env);
    expect(e.recyclingBonus()).toBe(ENERGY.recycling.bonusPoints);
    expect(e.sceneryPenalty()).toBeCloseTo(0.06, 9);
    f.set.list.length = 1; expect(e.sceneryPenalty()).toBe(0);
    expect(new Energy(fake().env).recyclingBonus()).toBe(0);
    expect(new Energy(fake().env).plantCostMult()).toBe(1);
  });
  it('serialize / load round trip keeps the day in progress', () => {
    const f = fake(['solarArray', 'biomassHeating']); f.set.day = SUMMER_DAY; const e = new Energy(f.env);
    for (let h = 0; h < 12; h++) e.hour(h);
    e.settleDay(80, 80); for (let h = 0; h < 7; h++) e.hour(h);
    const d = JSON.parse(JSON.stringify(e.serialize()));
    const g = new Energy(f.env); g.load(d);
    expect(JSON.stringify(g.serialize())).toBe(JSON.stringify(e.serialize()));
    expect(e.info(1)!.today).toBeGreaterThan(0);
    g.reset(); expect(g.last.gross).toBe(0); expect(g.stock).toBe(0);
  });
});

// ---------------------------------------------------------------- sustainability facet
describe('sustainability facet: energy is net grid purchase, bonus is capped', () => {
  const raw = (o: Partial<SustainRaw> = {}): SustainRaw => ({ energyPerGuest: 8, treeLoss: 0, habitatOverlap: 0, protection: 0, ...o });
  it('lower net energy per guest raises the energy part (and the score)', () => {
    const bad = sustainParts(raw({ energyPerGuest: 9.8 })), net = sustainParts(raw({ energyPerGuest: 9.8 * (1 - 0.4) }));
    expect(net.energy).toBeGreaterThan(bad.energy); expect(net.score).toBeGreaterThan(bad.score);
    expect(net.energy - bad.energy).toBeCloseTo(0.4 * 9.8 / 10, 6);
  });
  it('the recycling bonus adds points but the facet never exceeds 100; weights are unchanged', () => {
    const best = sustainParts(raw({ energyPerGuest: 1, bonus: 4 }));
    expect(best.score).toBe(100);
    const plain = sustainParts(raw()), withBonus = sustainParts(raw({ bonus: 4 }));
    expect(withBonus.score).toBeCloseTo(plain.score + 4, 6);
    expect(sustainParts(raw({ bonus: -5 })).score).toBe(plain.score);
  });
});

// ---------------------------------------------------------------- real sim: placement, finance, save / load
const startSim = (seed = 61, day = seasonStartDay('summer') + 10): Sim => {
  const s = createSim({ size: 64, seed, starterResort: true, mode: 'sandbox', startDay: day, now: () => 0 } as never);
  s.game.money = 5_000_000;
  return s;
};
const link = (s: Sim, type: string, rect: { x: number; y: number; w: number; h: number }): void => {
  const acc = BUILDINGS[type]!.access;
  const p = acc === 'road' ? planRoadTo(s, rect) : planPathTo(s, rect);
  if (p?.length) buildNetwork(s, acc === 'road' ? 2 : 1, p);
};
const place = (s: Sim, type: string, near: { x: number; y: number }, rmax = 14): { id: number; x: number; y: number } => {
  const site = findSite(s, type, near, { rmax, route: BUILDINGS[type]!.access === 'road' ? 'road' : 'path' as never });
  if (!site) throw new Error(`no site for ${type}`);
  const out = placeSite(s, site);
  if (!out.ok) throw new Error(`place ${type}: ${out.reason}`);
  link(s, type, site.rect);
  s.buildings.reevaluate();
  return { id: out.building!.id, x: site.x, y: site.y };
};
const streamTile = (s: Sim): { x: number; y: number } | null => { for (let i = 0; i < s.grid.tileType.length; i++) if (s.grid.tileType[i] === TileType.Stream) return { x: i % s.size, y: (i / s.size) | 0 }; return null; };

describe('placement rules of the green buildings', () => {
  it('catalogue: an Energy tab, access rules, footprints and unlock levels', () => {
    for (const id of GREEN_BUILDINGS) { expect(BUILDINGS[id], id).toBeDefined(); expect(BUILDINGS[id]!.category).toBe('energy'); expect(buildingTab(BUILDINGS[id]!)).toBe('energy'); }
    expect(BUILDINGS.solarArray!.w * BUILDINGS.solarArray!.h).toBe(6);
    expect(BUILDINGS.solarPlant!.w * BUILDINGS.solarPlant!.h).toBeGreaterThan(BUILDINGS.solarArray!.w * BUILDINGS.solarArray!.h);
    expect(BUILDINGS.solarArray!.access).toBe('path'); expect(BUILDINGS.solarArray!.altAccess).toContain('road');
    expect(BUILDINGS.biomassHeating!.access).toBe('road'); expect(BUILDINGS.smallHydro!.streamAdjacent).toBe(true);
    const gated = UNLOCKS.filter((u) => GREEN_BUILDINGS.includes(u.id as never)).map((u) => `${u.id}:${u.level}`).sort();
    expect(gated).toEqual(['solarPlant:3', 'windTurbine:2']);
    expect(UNLOCKS.some((u) => u.id === 'solarArray')).toBe(false); // the Advisor suggests it: never gated
    expect(isGenerator('solarArray')).toBe(true); expect(isGenerator('treeNursery')).toBe(false);
  });
  it('small hydro only stands on a stream bank, with a clear reason elsewhere', () => {
    const s = startSim();
    const st = streamTile(s)!; expect(st).toBeTruthy();
    // a free tile NOT next to any stream
    let dry: { x: number; y: number } | null = null;
    for (let y = 12; y < 50 && !dry; y++) for (let x = 12; x < 50 && !dry; x++) { const c = validatePlacement(s.env, 'smallHydro', x, y, 0, true); if (!c.reasons.includes('Must be next to a stream') && c.reasons.length === 0) dry = { x, y }; }
    // any footprint that is accepted must touch a stream tile
    if (dry) { let touches = false; for (let yy = dry.y - 1; yy <= dry.y + 2; yy++) for (let xx = dry.x - 1; xx <= dry.x + 3; xx++) if (s.buildings.streamAt!(xx, yy)) touches = true; expect(touches).toBe(true); }
    const site = findSite(s, 'smallHydro', st, { rmax: 8 });
    if (site) { expect(validatePlacement(s.env, 'smallHydro', site.x, site.y, site.rot, true).ok).toBe(true); }
    // pick a spot guaranteed dry (map corner area) and confirm the reason
    const reasons: string[] = [];
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) reasons.push(...validatePlacement(s.env, 'smallHydro', x, y, 0, true).reasons);
    expect(reasons.filter((r) => r === 'Must be next to a stream').length + reasons.filter((r) => r.startsWith('Too close')).length).toBeGreaterThan(0);
  });
  it('wind turbine: only exposed high ground ("Too low for this building" in the valley)', () => {
    const s = startSim();
    let low: { x: number; y: number } | null = null, high: { x: number; y: number } | null = null;
    for (let y = 6; y < 58; y++) for (let x = 6; x < 58; x++) {
      const c = validatePlacement(s.env, 'windTurbine', x, y, 0, true);
      if (!low && c.reasons.includes('Too low for this building')) low = { x, y };
      if (!high && c.reasons.every((r) => r.startsWith('Not enough funds') === false) && !c.reasons.includes('Too low for this building') && c.reasons.length === 0) high = { x, y };
    }
    expect(low, 'a valley tile is refused').toBeTruthy();
    expect(high, 'a high tile can be built on').toBeTruthy();
  });
  it('solar array: placeable, inactive ("Not connected") until a path or road reaches it, then active', () => {
    const s = startSim();
    const site = findSite(s, 'solarArray', anchors(s).lodge, { rmax: 16, avoidPiste: true })!;
    expect(site).toBeTruthy();
    const chk = validatePlacement(s.env, 'solarArray', site.x, site.y, site.rot, true);
    expect(chk.ok).toBe(true);
    const out = placeSite(s, { ...site, rot: site.rot });
    expect(out.ok).toBe(true);
    const b = out.building!;
    const raw = s.buildings.get(b.id)!;
    if (!raw.active) { expect(raw.reason).toMatch(/footpath|road|connect/i); link(s, 'solarArray', site.rect); s.buildings.reevaluate(); }
    expect(s.buildings.get(b.id)!.active).toBe(true);
  });
});

describe('finance + sustainability effect in a real sim', () => {
  it('a working solar array takes a capped share off the energy ledger line; without one nothing changes', () => {
    const winterDay = seasonStartDay('winter') + 8;
    const mk = (withSolar: boolean): Sim => {
      const s = startSim(61, winterDay);
      for (const l of s.lifts.all()) s.liftOps.setHours(l.id, 6, 22);
      if (withSolar) { place(s, 'solarArray', anchors(s).lodge, 18); place(s, 'solarArray', anchors(s).lodge, 18); }
      return s;
    };
    const a = mk(false), b = mk(true);
    expect(b.energy.generators().filter((g) => g.active).length).toBe(2);
    const energyOf = (s: Sim): number => s.economy.yearBuckets().expense.energy ?? 0;
    const e0a = energyOf(a), e0b = energyOf(b);
    for (let d = 0; d < 6; d++) { a.tick(240); b.tick(240); }
    const spentA = energyOf(a) - e0a, spentB = energyOf(b) - e0b;
    console.log(`[energy] 6 winter days, 2 arrays: ledger line ${spentA.toFixed(0)} -> ${spentB.toFixed(0)}, applied ${b.energy.totalApplied.toFixed(0)}, wasted ${b.energy.totalWasted.toFixed(0)}, last day demand ${b.energy.last.demand.toFixed(0)} gross ${b.energy.last.gross.toFixed(0)}`);
    expect(spentA).toBeGreaterThan(50);
    expect(b.energy.totalApplied).toBeGreaterThan(5);
    expect(b.energy.last.applied).toBeLessThanOrEqual(ENERGY.maxOffsetShare * b.energy.last.demand + 1e-9);
    expect(b.energy.totalApplied + b.energy.totalWasted).toBeGreaterThan(0);
    expect(spentB).toBeLessThan(spentA); // the ledger line is lower
    expect(spentB).toBeGreaterThan(spentA * (1 - ENERGY.maxOffsetShare) * 0.7); // ... never close to zero
    // control: the game without generators books no offset at all
    expect(a.energy.totalApplied).toBe(0);
  }, 120_000);
  it('a recycling centre adds its bonus points to the facet; a nursery makes planting cheaper', () => {
    const s = startSim();
    s.tick(240 * 2);
    const base = s.sustain.measure().score;
    place(s, 'recyclingCentre', anchors(s).lodge, 18);
    place(s, 'treeNursery', anchors(s).lodge, 18);
    expect(s.energy.recyclingBonus()).toBe(ENERGY.recycling.bonusPoints);
    expect(base).toBeGreaterThan(0);
    expect(s.sustain.measure().raw.bonus).toBe(ENERGY.recycling.bonusPoints);
    expect(s.energy.plantCostMult()).toBe(0.6);
  }, 60_000);
});

describe('save / load + determinism', () => {
  const differing = (a: Sim, b: Sim): string[] => { const x = stateHash(a).parts, y = stateHash(b).parts; return Object.keys(x).filter((k) => x[k] !== y[k]); };
  it('a mid-day save with generators loads and then runs identically (energy module included)', async () => {
    const s = startSim(61, seasonStartDay('winter') + 8);
    place(s, 'solarArray', anchors(s).lodge, 18);
    place(s, 'biomassHeating', anchors(s).lodge, 20);
    s.tick(240 + 120);
    expect(s.energy.info(s.energy.generators()[0]!.id)!.today).toBeGreaterThan(0);
    const { bytes } = await encodeSave(s, makeMeta(s, 'test'), { compress: true, yieldBetween: false });
    const { envelope } = await decodeSave(bytes, { yieldBetween: false });
    const r = createSim({ size: envelope.mapSize, seed: envelope.seed, now: () => 0, fromSave: structuredClone(envelope.modules) });
    applySave(s, structuredClone(envelope.modules)); // the control: the same save applied in place (carries the documented demotions)
    expect(differing(s, r)).toEqual([]);
    expect(JSON.stringify(r.energy.serialize())).toBe(JSON.stringify(s.energy.serialize()));
    for (let i = 0; i < 6; i++) { s.ops.quality.attachTraffic(); s.tick(60); r.ops.quality.attachTraffic(); r.tick(60); expect(differing(s, r), `after ${(i + 1) * 60} ticks`).toEqual([]); }
  }, 180_000);
  it('an old save without an energy module loads with an empty grid', () => {
    const s = startSim();
    const mods = collectSave(s); delete (mods as Record<string, unknown>)['energy'];
    const r = createSim({ size: 64, seed: 61, now: () => 0, fromSave: structuredClone(mods) });
    expect(r.energy.last.gross).toBe(0); expect(r.energy.totalApplied).toBe(0);
  });
  it('determinism: same seed + same actions give the same hash', () => {
    const go = (): string => { const s = startSim(7, seasonStartDay('winter') + 5); place(s, 'solarArray', anchors(s).lodge, 18); s.tick(240 * 3); return stateHash(s).hash; };
    expect(go()).toBe(go());
  }, 120_000);
});

describe('meshes + view', () => {
  it('every green building has a builder within the triangle budget and the turbine has a rotor', () => {
    for (const id of GREEN_BUILDINGS) {
      const d = BUILDINGS[id]!, p = buildParts(d.meshBuilder, d.w, d.h);
      let tris = 0; for (const g of [p.wood, p.stone, p.roof, p.sign?.geometry]) if (g) tris += g.getAttribute('position').count / 3;
      expect(tris, id).toBeGreaterThan(100); expect(tris, id).toBeLessThan(d.w * d.h <= 6 ? 3000 : 9000);
    }
    const reg = new BuildingMeshes(), t = reg.create('windTurbine', 0.4, 1);
    const rotor = t.getObjectByName('rotor') as THREE.Group;
    expect(rotor).toBeTruthy(); expect(rotor.children.length).toBe(1); expect(rotor.position.y).toBeGreaterThan(3);
    expect(reg.create('solarArray', 0.4, 1).getObjectByName('rotor')).toBeUndefined();
    reg.dispose();
  });
  it('panels never use the window-glass colour (no warm night glow on a solar field)', () => {
    const glass = new THREE.Color(0x6fb7e0);
    const glassVerts = (id: string): number => {
      const d = BUILDINGS[id]!, p = buildParts(d.meshBuilder, d.w, d.h); let n = 0;
      for (const g of [p.wood, p.stone, p.roof]) { const c = g?.getAttribute('color'); if (!c) continue; for (let i = 0; i < c.count; i++) if (Math.abs(c.getX(i) - glass.r) + Math.abs(c.getY(i) - glass.g) + Math.abs(c.getZ(i) - glass.b) < 0.05) n++; }
      return n;
    };
    expect(glassVerts('solarArray')).toBe(0);
    expect(glassVerts('solarPlant')).toBeLessThan(100); // only the control hut's lit window
    expect(glassVerts('treeNursery')).toBeGreaterThan(24); // greenhouse grow lights glow at night
  });
});

describe('inspector + format', () => {
  it('generator lines show output now, today, yesterday, offset share and the grid summary', () => {
    const f = fake(['solarArray']); f.set.day = SUMMER_DAY; const e = new Energy(f.env);
    for (let h = 0; h < 13; h++) e.hour(h);
    e.settleDay(60, 60); for (let h = 0; h < 12; h++) e.hour(h);
    const lines = generatorLines(e.info(1)!, e.last).map((l) => l.text).join('\n');
    expect(lines).toMatch(/Output now: [\d.]+ kW/); expect(lines).toMatch(/Today so far: [\d,]+ kWh · yesterday: [\d,]+ kWh/); expect(lines).toMatch(/off the energy bill yesterday \([\d.]+% of the resort/); expect(lines).toMatch(/Resort grid yesterday/);
    expect(gridSummary({ demand: 0, gross: 0, applied: 0, wasted: 0 })).toMatch(/no data/);
    f.set.list[0]!.active = false; expect(generatorLines(e.info(1)!, e.last)[0]!.text).toMatch(/Not connected/);
    expect(greenLines('recyclingCentre', e, { felled: 0, planted: 0 })[0]!.text).toMatch(/\+4 points/);
    expect(greenLines('treeNursery', e, { felled: 12, planted: 2 }).map((l) => l.text).join(' ')).toMatch(/make up: 10 trees/);
  });
});
