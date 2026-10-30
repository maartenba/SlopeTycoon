import { describe, expect, it } from 'vitest';
import { Marketing, campaignById, type MarketingContext } from '../../src/sim/Marketing';
import { Economy } from '../../src/sim/Economy';
import { CAMPAIGNS, MARKETING, SENSITIVITY, AFFORD_SHARE, type DayClass, type FacilityId, type PrereqId, type SeasonKey } from '../../src/config/marketing';
import { CORE_TYPE_COUNT, SHIPPED_TYPES, segmentKey } from '../../src/config/guestTypes';
import { demandMultiplier } from '../../src/sim/Elasticity';
import { makeResort, run } from '../game/harness';
import { ATTRACTION_SPECS } from '../../src/sim/attractions/registry';
import type { AttractionSpec } from '../../src/sim/attractions/Attraction';
import { seasonStartDay } from '../../src/sim/Clock';
import { BUILDINGS, type BuildingDef } from '../../src/config/buildings';

/** Senior + School campaigns (Phase 6 Task 52): Wellness & Views, School Trips, Come by Train retarget. */
interface Opt { season?: SeasonKey; missing?: PrereqId[]; has?: FacilityId[]; stars?: number; dayClass?: DayClass; ratio?: number }
const fixture = (o: Opt = {}) => {
  const date = { year: 0, day: 100 }, economy = new Economy({ money: 100000 });
  const ctx: MarketingContext = {
    season: () => o.season ?? 'winter', stars: () => o.stars ?? 4, has: (f) => (o.has ?? []).includes(f), dayPassRatio: () => o.ratio ?? 1, met: (id) => !(o.missing ?? []).includes(id), dayClass: () => o.dayClass ?? 'regular',
  };
  return { m: new Marketing({ economy, date: () => date, ctx }), date, economy };
};
const SENIOR = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'senior');
const SCHOOL = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'school');

describe('Senior + School campaigns: rows', () => {
  it('Wellness & Views and School Trips carry the planned numbers; the older rows are untouched', () => {
    expect(CAMPAIGNS.slice(0, 11).map((c) => c.id)).toEqual(['families', 'budget', 'vip', 'summer', 'brand', 'train', 'parkJam', 'hikeBike', 'festival', 'summerCamp', 'angler']);
    const w = campaignById('wellness')!, s = campaignById('school')!;
    expect([w.name, w.icon, w.cost, w.durationDays, w.cooldownDays, w.volumeBoost, w.offSeason, w.priceAlign, w.minStars]).toEqual(['Wellness & Views', '🧖', 8000, 21, 21, 0.05, 0.5, 'premium', 3]);
    expect(w.extraTargets).toEqual({ senior: 1.6 }); expect(w.targets).toEqual({ couple: 0.6 });
    expect(w.seasons).toEqual(['summer', 'autumn', 'winter']); // spring at half (offSeason)
    expect(w.prereqs.map((p) => p.id)).toEqual(['poolOrViews', 'dining', 'toilets']);
    expect([s.name, s.icon, s.cost, s.durationDays, s.cooldownDays, s.volumeBoost, s.offSeason, s.priceAlign]).toEqual(['School Trips', '🚌', 4000, 14, 21, 0.1, 0.4, 'cheap']);
    expect(s.extraTargets).toEqual({ school: 2 }); expect(s.seasons).toEqual(['winter', 'summer']);
    expect(s.prereqs.map((p) => p.id)).toEqual(['skiSchool', 'kidsArea', 'cheapLodging']);
    expect(s.dayClassMult).toEqual({ off: 1.5, regular: 1.2, peak: 0.3 });
    expect(s.bonus).toEqual({ id: 'trainCampaign', factor: 1.15 });
  });
  it('Come by Train also targets seniors 0.6 and school groups 0.5, the old targets are unchanged', () => {
    const t = campaignById('train')!;
    expect(t.extraTargets).toEqual({ senior: 0.6, school: 0.5 });
    expect(t.targets).toEqual({ budget: 0.8, solo: 0.4, couple: 0.3 });
  });
  it('the new types price like their segment (Senior = couple, School group = budget); every segment key has a sensitivity', () => {
    expect(segmentKey(SENIOR)).toBe('couple'); expect(segmentKey(SCHOOL)).toBe('budget');
    expect(demandMultiplier(SENIOR, 1.4)).toBeCloseTo(demandMultiplier('couple', 1.4), 9);
    expect(demandMultiplier(SCHOOL, 1.4)).toBeCloseTo(demandMultiplier('budget', 1.4), 9);
    expect(demandMultiplier(SCHOOL, 1.4)).toBeLessThan(demandMultiplier(SENIOR, 1.4)); // a class reacts to a dear pass more
    for (const k of Object.keys(SENSITIVITY)) { expect(SENSITIVITY[k as keyof typeof SENSITIVITY]).toBeGreaterThan(0); expect(AFFORD_SHARE[k as keyof typeof AFFORD_SHARE]).toBeGreaterThan(0); }
  });
});

describe('Senior + School campaigns: gating', () => {
  it('every missing requirement blocks the start and costs nothing; Show me points at what to build', () => {
    for (const [id, ids] of [['wellness', ['poolOrViews', 'dining', 'toilets']], ['school', ['skiSchool', 'kidsArea', 'cheapLodging']]] as const) {
      for (const miss of ids) {
        const f = fixture({ missing: [miss] });
        expect(f.m.blocker(id), `${id} without ${miss}`).toMatch(/^Requires:/);
        expect(f.m.start(id)).toMatch(/^Requires:/);
        expect(f.economy.money).toBe(100000);
        expect(f.m.canStart(id).checks.find((c) => c.id === miss)).toMatchObject({ ok: false });
      }
      const ok = fixture();
      expect(ok.m.start(id)).toBeNull();
      expect(ok.economy.money).toBe(100000 - campaignById(id)!.cost);
    }
    const f = fixture({ missing: ['poolOrViews', 'toilets', 'cheapLodging'] });
    expect(f.m.canStart('wellness').checks.find((c) => c.id === 'poolOrViews')).toMatchObject({ build: 'viewpoint', show: 'build' });
    expect(f.m.canStart('wellness').checks.find((c) => c.id === 'toilets')).toMatchObject({ build: 'toilets', show: 'build' });
    expect(f.m.canStart('school').checks.find((c) => c.id === 'cheapLodging')).toMatchObject({ build: 'apartment', show: 'build' });
  });
  it('Wellness needs a 3-star resort for full effect and a premium day pass', () => {
    const w = campaignById('wellness')!;
    const good = fixture({ stars: 4, ratio: 1.1 }).m.effectiveness(w);
    expect(fixture({ stars: 2, ratio: 1.1 }).m.effectiveness(w).value).toBeLessThan(good.value);
    expect(fixture({ stars: 4, ratio: 0.6 }).m.effectiveness(w).warnings.some((x) => /too cheap/.test(x))).toBe(true);
    // spring works at half strength, summer / autumn / winter in full
    const sp = fixture({ season: 'spring', stars: 4, ratio: 1.1 }).m.effectiveness(w).value;
    expect(sp / good.value).toBeCloseTo(0.5, 2);
    for (const s of ['summer', 'autumn'] as const) expect(fixture({ season: s, stars: 4, ratio: 1.1 }).m.effectiveness(w).value).toBeCloseTo(good.value, 3);
  });
});

describe('Senior + School campaigns: effect on the arrivals', () => {
  it('Wellness lifts seniors (types.senior) and couples; nothing else', () => {
    const f = fixture({ ratio: 1.1 });
    expect(f.m.start('wellness')).toBeNull();
    const e = f.m.effect();
    expect(e.types.senior).toBeGreaterThan(1.8);
    expect(e.types.school).toBeUndefined();
    expect(e.weights.couple).toBeGreaterThan(1.2); expect(e.weights.family).toBe(1);
  });
  it('School Trips: weekdays only (day-class factor), school type only', () => {
    const f = fixture({ dayClass: 'off', ratio: 0.9 });
    f.m.start('school');
    const live = (c: DayClass): number => { const g = fixture({ dayClass: c, ratio: 0.9 }); return g.m.liveFactor(campaignById('school')!); };
    expect(live('off')).toBe(1.5); expect(live('regular')).toBe(1.2); expect(live('peak')).toBe(0.3);
    const eff = (c: DayClass): number => { const g = fixture({ dayClass: c, ratio: 0.9 }); g.m.start('school'); return g.m.effect().types.school! - 1; };
    expect(eff('off')).toBeGreaterThan(eff('regular')); expect(eff('regular')).toBeGreaterThan(eff('peak') * 3);
    expect(eff('peak')).toBeLessThan(eff('off') / 4); // weekends are nearly off
    const e = f.m.effect();
    expect(e.types.school).toBeGreaterThan(2);
    expect(e.types.senior).toBeUndefined();
    expect(e.weights.budget).toBe(1);
  });
  it('School Trips x1.15 with Come by Train running (the train synergy); none without', () => {
    const s = campaignById('school')!;
    const base = fixture({ ratio: 0.9 }).m.effectiveness(s);
    const withTrain = fixture({ ratio: 0.9, has: ['trainCampaign'] }).m.effectiveness(s);
    expect(withTrain.value / base.value).toBeCloseTo(1.15, 1);
    expect(withTrain.factors.some((x) => x.label === 'Facility bonus' && x.factor === 1.15)).toBe(true);
  });
  it('Come by Train lifts seniors and classes a little (types), exactly as before for the segments', () => {
    const f = fixture();
    f.m.start('train');
    const e = f.m.effect();
    expect(e.types.senior).toBeGreaterThan(1.3); expect(e.types.school).toBeGreaterThan(1.2);
    expect(e.weights.budget).toBeGreaterThan(1.5);
  });
  it('the ROI preview counts the extra-type target (not 0 %)', () => {
    const p = fixture({ ratio: 1.1 }).m.preview(campaignById('wellness')!);
    expect(p.targetBoostPct).toBeGreaterThan(100);
    const q = fixture({ ratio: 0.9 }).m.preview(campaignById('school')!);
    expect(q.targetBoostPct).toBeGreaterThan(100);
  });
  it('ends with a tail; nothing stays boosted afterwards', () => {
    const f = fixture({ ratio: 1.1 });
    f.m.start('wellness');
    f.date.day += campaignById('wellness')!.durationDays + MARKETING.tailDays + 1; f.m.update();
    expect(f.m.effect().types.senior).toBeUndefined();
  });
});

describe('Senior + School campaigns in a real sim', () => {
  it('prerequisites follow the real world: toilets / cheap lodging from the village, the pool via the Lodging v2 amenity (any building), viewpoints', () => {
    const sim = makeResort(64, 1, { startDay: seasonStartDay('winter') + 8 }).sim;
    sim.progression.unlockAll = true;
    run(sim, { days: 1 });
    const has = (t: string): boolean => sim.buildings.all().some((b) => b.type === t && b.active);
    const chk = (id: string, pre: string) => sim.marketing.canStart(id).checks.find((c) => c.id === pre)!;
    expect(chk('wellness', 'toilets').ok).toBe(has('toilets'));
    expect(chk('wellness', 'dining').ok).toBe(true);
    expect(chk('school', 'cheapLodging').ok).toBe(has('apartment') || has('campground') || has('baseLodge'));
    expect(chk('school', 'skiSchool').ok).toBe(has('skiSchoolHQ'));
    expect(chk('wellness', 'poolOrViews').ok).toBe(false); // no pool, no viewpoints in the starter village
    // a lodging with the pool amenity (a stand-in for the Luxury Hotel: the prerequisite reads the amenity, not a building id)
    const ID = 'testSpaHotel';
    BUILDINGS[ID] = { ...BUILDINGS.chalet!, id: ID, access: 'none' } as BuildingDef;
    (ATTRACTION_SPECS as Record<string, AttractionSpec>)[ID] = { ...ATTRACTION_SPECS['chalet']!, amenity: 'pool', poolSlots: 4 };
    try {
      const b = sim.buildings.add(ID, 4, 4).building; b.active = true;
      sim.tick(2);
      expect(sim.attractions.all().some((a) => a.spec.amenity === 'pool' && a.b.active)).toBe(true);
      expect(chk('wellness', 'poolOrViews').ok).toBe(true);
      b.active = false;
      expect(chk('wellness', 'poolOrViews').ok).toBe(false);
    } finally { delete BUILDINGS[ID]; delete (ATTRACTION_SPECS as Record<string, AttractionSpec>)[ID]; }
  }, 120_000);
});
