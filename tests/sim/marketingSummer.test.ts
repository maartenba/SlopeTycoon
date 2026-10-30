import { describe, expect, it } from 'vitest';
import { Marketing, campaignById, type MarketingContext } from '../../src/sim/Marketing';
import { Economy } from '../../src/sim/Economy';
import { ANGLER_CAMPAIGN, CAMPAIGNS, MARKETING, type FacilityId, type PrereqId, type SeasonKey } from '../../src/config/marketing';
import { ICE_FISHING } from '../../src/config/balance';
import { makeResort, run } from '../game/harness';
import { applySave, collectSave, stateHash } from '../../src/game/saveState';
import { seasonStartDay } from '../../src/sim/Clock';
import type { Sim } from '../../src/game/createSim';

/** Summer campaigns (Phase 6 Task 51): Family Summer Camp + Angler's Paradise. */
interface Opt { season?: SeasonKey; missing?: PrereqId[]; has?: FacilityId[]; fish?: number | null }
const fixture = (o: Opt = {}) => {
  const date = { year: 0, day: 250 }, economy = new Economy({ money: 100000 });
  const ctx: MarketingContext = { season: () => o.season ?? 'summer', stars: () => 3, has: (f) => (o.has ?? []).includes(f), dayPassRatio: () => 1, met: (id) => !(o.missing ?? []).includes(id), fishStock: () => (o.fish === undefined ? 0.85 : o.fish) };
  return { m: new Marketing({ economy, date: () => date, ctx }), date, economy };
};

describe('summer campaigns: rows', () => {
  it('the rows carry the planned numbers; the older nine rows are untouched', () => {
    expect(CAMPAIGNS.slice(0, 9).map((c) => c.id)).toEqual(['families', 'budget', 'vip', 'summer', 'brand', 'train', 'parkJam', 'hikeBike', 'festival']);
    const f = campaignById('families')!;
    expect(f.prereqs.map((p) => p.id)).toEqual(['skiSchool', 'kidsArea']);
    const c = campaignById('summerCamp')!, a = campaignById('angler')!;
    expect([c.cost, c.durationDays, c.cooldownDays, c.volumeBoost, c.offSeason, c.priceAlign]).toEqual([6000, 14, 21, 0.08, 0.2, 'cheap']);
    expect(c.targets).toEqual({ family: 1.6 });
    expect(c.seasons).toEqual(['summer']);
    expect(c.prereqs.map((p) => p.id)).not.toContain('skiSchool'); // does not overlap the winter Families campaign
    expect(c.bonus).toEqual({ id: 'pettingZoo', factor: 1.2 });
    expect([a.cost, a.durationDays, a.cooldownDays, a.volumeBoost, a.offSeason]).toEqual([3500, 14, 14, 0.05, 0.3]);
    expect(a.extraTargets).toEqual({ angler: 1.8 });
    expect(a.targets).toMatchObject({ couple: 0.4 });
    expect(a.seasons).toEqual(ICE_FISHING ? ['summer', 'autumn', 'winter'] : ['summer', 'autumn']);
  });
  it('requirements gate the start and cost nothing when unmet', () => {
    const need: Record<string, PrereqId[]> = { summerCamp: ['summerSeason', 'campground', 'kidsOrZoo'], angler: ['tackleHut', 'water'] };
    for (const [id, ids] of Object.entries(need)) {
      expect(campaignById(id)!.prereqs.map((p) => p.id)).toEqual(ids);
      for (const miss of ids) {
        const f = fixture({ missing: [miss] });
        expect(f.m.blocker(id), `${id} without ${miss}`).toMatch(/^Requires:/);
        expect(f.m.start(id)).toMatch(/^Requires:/);
        expect(f.economy.money).toBe(100000);
      }
      const ok = fixture();
      expect(ok.m.start(id), id).toBeNull();
      expect(ok.economy.money).toBe(100000 - campaignById(id)!.cost);
    }
  });
  it('unmet requirements offer Show me (build target or a map hint)', () => {
    const f = fixture({ missing: ['campground', 'kidsOrZoo', 'tackleHut', 'water'] });
    expect(f.m.canStart('summerCamp').checks.find((c) => c.id === 'campground')).toMatchObject({ ok: false, build: 'campground', show: 'build' });
    expect(f.m.canStart('summerCamp').checks.find((c) => c.id === 'kidsOrZoo')).toMatchObject({ ok: false, build: 'pettingZoo', show: 'build' });
    expect(f.m.canStart('angler').checks.find((c) => c.id === 'tackleHut')).toMatchObject({ ok: false, build: 'tackleHut', show: 'build' });
  });
});

describe('summer campaigns: effectiveness', () => {
  it('Family Summer Camp: summer only, petting zoo bonus', () => {
    const base = fixture().m.effectiveness(campaignById('summerCamp')!).value;
    expect(base).toBeGreaterThan(0.5);
    expect(fixture({ season: 'winter' }).m.effectiveness(campaignById('summerCamp')!).value).toBeCloseTo(base * 0.2, 2);
    const zoo = fixture({ has: ['pettingZoo'] }).m.effectiveness(campaignById('summerCamp')!);
    expect(zoo.value / base).toBeCloseTo(1.2, 1);
    expect(zoo.factors.some((x) => x.label === 'Facility bonus')).toBe(true);
  });
  it("Angler's Paradise: fish stock factor, season, overfished warning", () => {
    const a = campaignById('angler')!;
    const healthy = fixture({ fish: 0.9 }).m.effectiveness(a).value;
    const lean = fixture({ fish: 0.4 }).m.effectiveness(a);
    expect(lean.value / healthy).toBeCloseTo(0.4 / ANGLER_CAMPAIGN.fullStock, 1);
    expect(lean.factors.some((x) => x.label === 'Fish stock')).toBe(true);
    const poor = fixture({ fish: 0.1 }).m.effectiveness(a);
    expect(poor.warnings.some((w) => /Overfished/.test(w))).toBe(true);
    expect(poor.value / healthy).toBeCloseTo(ANGLER_CAMPAIGN.floor, 1); // floored, never zero by stock alone
    expect(fixture({ fish: null }).m.effectiveness(a).value).toBeCloseTo(healthy * 1, 0); // no stock reading = no factor
    const autumn = fixture({ season: 'autumn', fish: 0.9 }).m.effectiveness(a).value, winter = fixture({ season: 'winter', fish: 0.9 }).m.effectiveness(a).value, spring = fixture({ season: 'spring', fish: 0.9 }).m.effectiveness(a).value;
    expect(autumn).toBeCloseTo(healthy, 2);
    if (ICE_FISHING) expect(winter).toBeCloseTo(healthy * 0.5, 2);
    expect(spring).toBeCloseTo(healthy * 0.3, 2);
  });
  it('effect(): the Angler campaign lifts only the angler type (plus a little couple / solo); the camp lifts families', () => {
    const f = fixture();
    expect(f.m.start('angler')).toBeNull();
    const e = f.m.effect();
    expect(e.types.angler).toBeGreaterThan(1.5);
    expect(e.weights.couple).toBeGreaterThan(1);
    expect(e.weights.family).toBe(1);
    const g = fixture();
    g.m.start('summerCamp');
    const e2 = g.m.effect();
    expect(e2.weights.family).toBeGreaterThan(1.5);
    expect(Object.keys(e2.types)).toEqual(['school']); // school groups come along on a summer camp (+0.4 x effectiveness)
    expect(e2.types.school).toBeGreaterThan(1.2); expect(e2.types.school).toBeLessThan(1.5);
    expect(e2.boost).toBeGreaterThan(1);
    // ends: the tail decays, then it is gone
    g.date.day += campaignById('summerCamp')!.durationDays + MARKETING.tailDays + 1; g.m.update();
    expect(g.m.effect().weights.family).toBe(1);
  });
  it('serialises and loads a running campaign', () => {
    const f = fixture();
    f.m.start('angler');
    const g = fixture();
    g.m.load(JSON.parse(JSON.stringify(f.m.serialize())));
    expect(g.m.running().map((r) => r.id)).toEqual(['angler']);
    expect(g.m.effect().types.angler).toBe(f.m.effect().types.angler);
  });
});

/** Real sim: a summer starter resort (seed 1, 64) with a Tackle hut beside the lake. */
const resort = (): Sim =>
  makeResort(64, 1, { startDay: seasonStartDay('summer') + 5, starter: { extra: (k) => {
    const lk = k.sim.terrainInfo.lakes.flatMap((l) => l.tileIdx).map((i) => ({ x: i % k.sim.size, y: (i / k.sim.size) | 0 })).sort((a, b) => Math.hypot(a.x - k.lc.x, a.y - k.lc.y) - Math.hypot(b.x - k.lc.x, b.y - k.lc.y))[0]!;
    k.placeConnected('tackleHut', lk.x - 2, lk.y, 6);
  } } }).sim;

describe('summer campaigns in a real sim', () => {
  it('Angler gating follows the real hut and the water stock', () => {
    const sim = resort();
    sim.progression.unlockAll = true;
    run(sim, { days: 1 });
    const hut = sim.buildings.all().find((b) => b.type === 'tackleHut')!;
    expect(hut.active).toBe(true);
    const a = sim.marketing.canStart('angler');
    expect(a.checks.map((c) => [c.id, c.ok])).toEqual([['tackleHut', true], ['water', true]]);
    // every water it reaches is overfished below the threshold -> the 'water' prerequisite fails
    for (const b of sim.anglingPlanner.plan(hut).bodies) sim.fishStock.set(b.key, ANGLER_CAMPAIGN.minStock - 0.1);
    expect(sim.marketing.canStart('angler').checks.find((c) => c.id === 'water')!.ok).toBe(false);
    expect(sim.marketing.effectiveness(campaignById('angler')!).value).toBe(0);
    for (const b of sim.anglingPlanner.plan(hut).bodies) sim.fishStock.set(b.key, 0.9);
    expect(sim.marketing.canStart('angler').ok).toBe(true);
    // without a hut: tackleHut + water both fail
    sim.buildings.remove(hut.id); sim.refreshCoverage(undefined, true); run(sim, { days: 1 });
    expect(sim.marketing.canStart('angler').checks.map((c) => c.ok)).toEqual([false, false]);
  }, 120_000);

  it('Summer Camp is not blocked by a missing Ski School and needs the campground + a kids area or zoo', () => {
    const sim = resort();
    sim.progression.unlockAll = true;
    run(sim, { days: 1 });
    expect(sim.buildings.all().some((b) => b.type === 'skiSchoolHQ')).toBe(true); // the starter has one; the campaign must not care
    const ids = (): string[] => sim.marketing.canStart('summerCamp').checks.filter((c) => !c.ok).map((c) => c.id);
    expect(ids()).toContain('campground');
    expect(sim.marketing.canStart('summerCamp').checks.map((c) => c.id)).not.toContain('skiSchool');
  }, 120_000);

  it("Angler's Paradise brings more anglers than the same resort without it (A/B)", () => {
    const count = (camp: boolean): number => {
      const s = resort(); s.progression.unlockAll = true; run(s, { days: 1 }); s.game.money = 80_000;
      let n = 0;
      s.bus.on('guest:arrived', (e) => { const sl = s.guestSim.store.slotOf(e.id); if (sl >= 0 && s.guestSim.store.type[sl] === 7) n++; });
      if (camp) expect(s.marketing.start('angler')).toBeNull();
      run(s, { days: 12 });
      return n;
    };
    const base = count(false), withCamp = count(true);
    console.log(`[angler campaign] anglers arrived: ${base} -> ${withCamp}`);
    expect(withCamp).toBeGreaterThan(base);
  }, 240_000);

  it('a running Angler campaign is deterministic and survives a save round-trip', () => {
    const play = (): Sim => { const s = resort(); s.progression.unlockAll = true; run(s, { days: 1 }); s.game.money = 50_000; expect(s.marketing.start('angler')).toBeNull(); run(s, { days: 3 }); return s; };
    const a = play(), b = play();
    const pa = stateHash(a).parts, pb = stateHash(b).parts;
    expect(Object.keys(pa).filter((k) => pa[k] !== pb[k])).toEqual([]);
    const snap = structuredClone(collectSave(a));
    applySave(b, snap as never);
    expect(b.marketing.running().map((r) => r.id)).toEqual(['angler']);
    expect(stateHash(b).hash ?? stateHash(b).parts.marketing).toBeDefined();
  }, 240_000);
});
