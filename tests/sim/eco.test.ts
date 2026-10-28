import { describe, expect, it } from 'vitest';
import { ECO, ECO_POLICIES, ECO_POLICY_BY_ID } from '../../src/config/eco';
import { BUILDINGS } from '../../src/config/buildings';
import { createSim, type Sim } from '../../src/game/createSim';
import { applySave, collectSave, stateHash } from '../../src/game/saveState';
import { Eco, type EcoSources } from '../../src/sim/meta/Eco';
import { sustainParts, type SustainRaw } from '../../src/sim/meta/Sustainability';
import { seasonStartDay } from '../../src/sim/Clock';
import { anchors, buildNetwork, findSite, placeSite, planPathTo, planRoadTo } from '../../src/tutorial/suggest';
import { ecoModel, ecoParts } from '../../src/ui/ecoFormat';
import { ecoLines } from '../../src/ui/energyFormat';
import { buildParts } from '../../src/render/meshes';
import { UNLOCKS } from '../../src/config/unlocks';

// ---------------------------------------------------------------- unit tests with a fake source
interface Fk { src: EcoSources; set: { centre: boolean; money: number; paid: number; transit: boolean; deficit: number; demand: number; applied: number; certified: number } }
const fake = (): Fk => {
  const set: Fk['set'] = { centre: true, money: 1e6, paid: 0, transit: false, deficit: 100, demand: 100, applied: 40, certified: 0 };
  const src: EcoSources = { centreActive: () => set.centre, funds: () => set.money, pay: (a) => { set.paid += a; set.money -= a; }, transit: () => set.transit, treeDeficit: () => set.deficit, grid: () => ({ demand: set.demand, applied: set.applied }), onCertified: () => { set.certified++; } };
  return { src, set };
};

describe('eco: policies, costs, caps (unit)', () => {
  it('config: five policies with a fee, a running cost and a trade-off; totals sit in the brief (setup $15-25k, running $60-150/day, max ~25-30 points)', () => {
    expect(ECO_POLICIES.length).toBe(5);
    for (const p of ECO_POLICIES) { expect(p.fee).toBeGreaterThan(0); expect(p.perDay).toBeGreaterThan(0); expect(p.points).toBeGreaterThan(0); expect(p.tradeoff.length).toBeGreaterThan(10); expect(ECO_POLICY_BY_ID[p.id]).toBe(p); }
    const perDay = BUILDINGS.ecoCentre!.upkeep + ECO_POLICIES.reduce((a, p) => a + p.perDay, 0) + ECO.cert.perDay;
    expect(perDay).toBeGreaterThanOrEqual(60); expect(perDay).toBeLessThanOrEqual(150);
    expect(BUILDINGS.ecoCentre!.cost).toBeGreaterThanOrEqual(15_000); expect(BUILDINGS.ecoCentre!.cost).toBeLessThanOrEqual(25_000);
    const max = Eco.maxPossible();
    expect(max).toBeGreaterThanOrEqual(25); expect(max).toBeLessThanOrEqual(ECO.maxPoints);
  });
  it('nothing on, or no centre: every effect is exactly neutral', () => {
    const f = fake(); const e = new Eco(f.src);
    expect([e.groomFuelMod(), e.snowEnergyMod(), e.liftEnergyMod(), e.restaurantMod(), e.arrivalMult()]).toEqual([1, 1, 1, 1, 1]);
    expect(e.points()).toBe(0); expect(e.upkeepPerDay()).toBe(0); expect(e.treeCredit()).toBe(0);
    for (const p of ECO_POLICIES) e.start(p.id);
    f.set.centre = false; // the centre is gone: policies pause, cost nothing and give nothing
    expect([e.groomFuelMod(), e.snowEnergyMod(), e.liftEnergyMod(), e.restaurantMod(), e.arrivalMult(), e.points(), e.upkeepPerDay()]).toEqual([1, 1, 1, 1, 1, 0, 0]);
    expect(e.blocker('carFree')).toMatch(/Eco Centre/);
  });
  it('starting pays the fee once, running cost and points follow, switching off keeps the fee gone', () => {
    const f = fake(); const e = new Eco(f.src);
    expect(e.start('electricFleet')).toBe(true);
    expect(f.set.paid).toBe(ECO_POLICY_BY_ID.electricFleet!.fee);
    expect(e.start('electricFleet')).toBe(false); // already running: no second charge
    expect(f.set.paid).toBe(ECO_POLICY_BY_ID.electricFleet!.fee);
    expect(e.groomFuelMod()).toBe(ECO.groomFuelMult);
    expect(e.upkeepPerDay()).toBe(ECO_POLICY_BY_ID.electricFleet!.perDay);
    expect(e.points()).toBe(ECO_POLICY_BY_ID.electricFleet!.points);
    expect(e.stop('electricFleet')).toBe(true);
    expect(e.groomFuelMod()).toBe(1); expect(e.upkeepPerDay()).toBe(0);
  });
  it('cannot start without cash', () => {
    const f = fake(); f.set.money = 100; const e = new Eco(f.src);
    expect(e.blocker('habitat')).toBe('Not enough cash'); expect(e.start('habitat')).toBe(false);
    expect(e.views().find((v) => v.id === 'habitat')!.state).toBe('poor');
    expect(e.startCert()).toBe('Not enough cash');
  });
  it('each policy has its effect: fuel, energy, restaurants, arrivals (transit softens the dip)', () => {
    const f = fake(); const e = new Eco(f.src);
    e.start('smartSnow'); e.start('localProduce'); e.start('carFree');
    expect(e.snowEnergyMod()).toBe(ECO.smartSnowMult); expect(e.liftEnergyMod()).toBe(ECO.smartLiftMult); expect(e.restaurantMod()).toBe(ECO.produceRestaurantMult);
    expect(e.arrivalMult()).toBe(ECO.carFreeArrivals);
    f.set.transit = true; expect(e.arrivalMult()).toBe(ECO.carFreeArrivalsTransit);
    expect(ECO.carFreeArrivalsTransit).toBeGreaterThan(ECO.carFreeArrivals);
  });
  it('habitat policy credits saplings only against the net deficit', () => {
    const f = fake(); const e = new Eco(f.src); e.start('habitat');
    f.set.deficit = 100;
    for (let d = 0; d < 10; d++) e.newDay();
    expect(e.treeCredit()).toBeCloseTo(10 * ECO.habitatSaplingsPerDay, 5);
    f.set.deficit = 5; for (let d = 0; d < 10; d++) e.newDay();
    expect(e.treeCredit()).toBeLessThanOrEqual(12.01); // deficit (5) is already covered by the credit: no growth
    f.set.deficit = 0; const before = e.treeCredit(); e.newDay(); expect(e.treeCredit()).toBe(before);
  });
  it('points are bounded by ECO.maxPoints and the facet never exceeds 100', () => {
    const f = fake(); const e = new Eco(f.src);
    for (const p of ECO_POLICIES) e.start(p.id);
    expect(e.points()).toBe(ECO_POLICIES.reduce((a, p) => a + p.points, 0));
    const poor: SustainRaw = { energyPerGuest: 9, treeLoss: 0.12, habitatOverlap: 0.14, protection: 0 };
    const base = sustainParts(poor).score;
    const full = sustainParts({ ...poor, eco: Eco.maxPossible() }).score;
    expect(full - base).toBeGreaterThanOrEqual(24); expect(full - base).toBeLessThanOrEqual(ECO.maxPoints);
    console.log(`[eco] poor resort facet ${base} -> ${full} (+${(full - base).toFixed(1)}) with everything on; rating points = x0.08 = +${((full - base) * 0.08).toFixed(2)}`);
    expect(sustainParts({ ...poor, eco: 999 }).score - base).toBeLessThanOrEqual(ECO.maxPoints + 1e-9);
    expect(sustainParts({ energyPerGuest: 1, treeLoss: 0, habitatOverlap: 0, protection: 1, bonus: 4, train: 3, eco: 30 }).score).toBe(100);
    expect(sustainParts({ ...poor, eco: -5 }).score).toBe(base);
  });
  it('certification needs 3 policies + renewable share, held for N days; it is lost and re-earned', () => {
    const f = fake(); const e = new Eco(f.src);
    expect(e.startCert()).toBeNull();
    for (let d = 0; d < 60; d++) e.newDay(); // no policies: never
    expect(e.certified).toBe(false);
    e.start('electricFleet'); e.start('carFree'); e.start('smartSnow');
    f.set.applied = 5; // 5 % share: too low
    for (let d = 0; d < 60; d++) e.newDay();
    expect(e.certified).toBe(false); expect(e.certView().share.have).toBeLessThan(ECO.cert.renewableShare);
    f.set.applied = 40;
    let day = 0; while (!e.certified && day < 200) { e.newDay(); day++; }
    expect(e.certified).toBe(true); expect(f.set.certified).toBe(1);
    expect(e.points()).toBe(ECO_POLICY_BY_ID.electricFleet!.points + ECO_POLICY_BY_ID.carFree!.points + ECO_POLICY_BY_ID.smartSnow!.points + ECO.cert.points);
    expect(e.arrivalMult()).toBeCloseTo(ECO.carFreeArrivals * ECO.cert.arrivals, 9);
    e.stop('smartSnow'); e.newDay(); expect(e.certified).toBe(false); // below 3 policies
    expect(e.certView().ever).toBe(true);
    e.start('smartSnow'); let again = 0; while (!e.certified && again < 50) { e.newDay(); again++; }
    expect(e.certified).toBe(true); expect(f.set.certified).toBe(1); // the milestone fires once
  });
  it('save round-trip; untouched = null (omitted from the hash)', () => {
    const f = fake(); const e = new Eco(f.src);
    expect(e.serialize()).toBeNull();
    e.start('habitat'); e.start('carFree'); e.startCert(); for (let d = 0; d < 20; d++) e.newDay();
    const snap = JSON.parse(JSON.stringify(e.serialize()));
    const g = fake(); const r = new Eco(g.src); r.load(snap);
    expect(JSON.stringify(r.serialize())).toBe(JSON.stringify(e.serialize()));
    expect(r.has('habitat')).toBe(true); expect(r.treeCredit()).toBe(e.treeCredit());
    r.load(null); expect(r.serialize()).toBeNull(); expect(r.activeCount()).toBe(0);
  });
});

// ---------------------------------------------------------------- real sim
const startSim = (seed = 61, day = seasonStartDay('winter') + 8): Sim => {
  const s = createSim({ size: 64, seed, starterResort: true, mode: 'sandbox', startDay: day, now: () => 0 } as never);
  s.game.money = 5_000_000;
  return s;
};
const placeCentre = (s: Sim): number => {
  const site = findSite(s, 'ecoCentre', anchors(s).lodge, { rmax: 24, route: 'road' as never });
  if (!site) throw new Error('no site');
  const out = placeSite(s, site);
  if (!out.ok) throw new Error(out.reason);
  const p = planRoadTo(s, site.rect) ?? planPathTo(s, site.rect);
  if (p?.length) buildNetwork(s, 2, p);
  s.buildings.reevaluate();
  return out.building!.id;
};

describe('eco in a real sim', () => {
  it('catalogue: level-gated at 4, one centre, a mesh within budget', () => {
    expect(UNLOCKS.find((u) => u.id === 'ecoCentre')?.level).toBe(ECO.centreLevel);
    expect(BUILDINGS.ecoCentre!.maxCount).toBe(1); expect(BUILDINGS.ecoCentre!.category).toBe('energy');
    const d = BUILDINGS.ecoCentre!, p = buildParts(d.meshBuilder, d.w, d.h);
    let tris = 0; for (const g of [p.wood, p.stone, p.roof, p.sign?.geometry]) if (g) tris += g.getAttribute('position').count / 3;
    console.log(`[eco] Eco Centre mesh triangles: ${Math.round(tris)}`);
    expect(tris).toBeGreaterThan(200); expect(tris).toBeLessThan(9000);
  });
  it('a game without the centre is untouched: no eco module in the hash, neutral multipliers', () => {
    const s = startSim();
    expect(s.eco.enabled).toBe(false); expect(s.eco.arrivalMult()).toBe(1);
    expect(stateHash(s).parts['eco']).toBeUndefined();
  });
  it('with a working centre the policies cost money daily, take effect and raise the facet; closing the centre pauses them', () => {
    const a = startSim(), b = startSim();
    placeCentre(b);
    expect(b.eco.enabled).toBe(true);
    const before = b.sustain.measure().score;
    for (const p of ECO_POLICIES) expect(b.eco.start(p.id)).toBe(true);
    expect(b.eco.upkeepPerDay()).toBe(ECO_POLICIES.reduce((x, p) => x + p.perDay, 0));
    expect(b.sustain.measure().raw.eco).toBe(b.eco.points());
    expect(b.sustain.measure().score).toBeGreaterThanOrEqual(before);
    const upkeepOf = (s: Sim): number => s.economy.yearBuckets().expense.upkeep ?? 0;
    const u0a = upkeepOf(a), u0b = upkeepOf(b);
    for (let d = 0; d < 3; d++) { a.tick(240); b.tick(240); }
    const extra = (upkeepOf(b) - u0b) - (upkeepOf(a) - u0a);
    // 3 days of: centre upkeep + all policy running costs (the fees were paid before the snapshot)
    expect(extra).toBeGreaterThan(3 * b.eco.upkeepPerDay() * 0.9);
    // the centre is demolished: policies pause, no running cost, nothing in the facet
    const id = b.buildings.all().find((x) => x.type === 'ecoCentre')!.id; b.buildings.remove(id);
    expect(b.eco.enabled).toBe(false); expect(b.eco.points()).toBe(0); expect(b.eco.upkeepPerDay()).toBe(0); expect(b.eco.arrivalMult()).toBe(1);
  }, 120_000);
  it('electric groomers really cut the fuel bill', () => {
    const s = startSim(); placeCentre(s);
    const base = s.ops.grooming.fuelMod();
    s.eco.start('electricFleet');
    expect(s.ops.grooming.fuelMod()).toBeCloseTo(base * ECO.groomFuelMult, 9);
    s.eco.stop('electricFleet');
    expect(s.ops.grooming.fuelMod()).toBe(base);
  });
  it('save / load keeps the programme and continues identically', () => {
    const s = startSim(); placeCentre(s);
    s.eco.start('electricFleet'); s.eco.start('habitat'); s.eco.startCert();
    s.tick(240 * 2);
    const mods = JSON.parse(JSON.stringify(collectSave(s)));
    expect(mods['eco']).toBeTruthy();
    const r = createSim({ size: 64, seed: 61, now: () => 0, fromSave: structuredClone(mods) });
    expect(JSON.stringify(r.eco.serialize())).toBe(JSON.stringify(s.eco.serialize())); expect(r.eco.certView().on).toBe(true);
    applySave(s, structuredClone(mods));
    expect(stateHash(s).parts['eco']).toBe(stateHash(r).parts['eco']);
  }, 120_000);
  it('an old save without the eco module loads cleanly (module omitted, defaults)', () => {
    const s = startSim(); const mods = collectSave(s); delete (mods as Record<string, unknown>)['eco'];
    const r = createSim({ size: 64, seed: 61, now: () => 0, fromSave: structuredClone(mods) });
    expect(r.eco.activeCount()).toBe(0); expect(r.eco.serialize()).toBeNull();
  });
  it('determinism: same seed + same actions give the same hash', () => {
    const go = (): string => { const s = startSim(7); placeCentre(s); s.eco.start('carFree'); s.eco.start('smartSnow'); s.tick(240 * 3); return stateHash(s).hash; };
    expect(go()).toBe(go());
  }, 120_000);
});

describe('eco: breakdown model and inspector lines', () => {
  it('parts add up: energy 40 + trees 30 + habitat 30 weights x 100, eco term bounded', () => {
    const parts = sustainParts({ energyPerGuest: 4, treeLoss: 0.05, habitatOverlap: 0.1, protection: 0, eco: 12 });
    const rows = ecoParts(parts, 12);
    expect(rows.map((r) => r.id)).toEqual(['energy', 'trees', 'habitat', 'bonus', 'eco']);
    expect(rows[0]!.max).toBe(40); expect(rows[1]!.max).toBe(30); expect(rows[4]!.max).toBe(ECO.maxPoints);
    for (const r of rows) { expect(r.points).toBeGreaterThanOrEqual(0); expect(r.points).toBeLessThanOrEqual(r.max); expect(r.tip.length).toBeGreaterThan(20); }
    const f = fake(); const e = new Eco(f.src);
    const m = ecoModel({ enabled: true, parts, policies: e.views(), cert: e.certView(), ecoPoints: 0, perDay: 0 });
    expect(m.policies.length).toBe(5); expect(m.perDayAll).toBe(ECO_POLICIES.reduce((a, p) => a + p.perDay, 0) + ECO.cert.perDay);
  });
  it('inspector lines explain an unconnected and a running centre', () => {
    const f = fake(); const e = new Eco(f.src);
    expect(ecoLines(e, 60)[0]!.text).toMatch(/No policy running/);
    e.start('carFree'); expect(ecoLines(e, 60)[0]!.text).toMatch(/1 of 5 policies running/);
    f.set.centre = false; expect(ecoLines(e, 60)[0]!.tone).toBe('bad');
  });
});
