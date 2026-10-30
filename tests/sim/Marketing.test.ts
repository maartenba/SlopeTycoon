import { describe, expect, it } from 'vitest';
import { Marketing, campaignById, campaignEffectiveness, type MarketingContext } from '@/sim/Marketing';
import { Economy } from '@/sim/Economy';
import { BUILDINGS } from '@/config/buildings';
import { CAMPAIGNS, MARKETING, PREREQ_GRACE_DAYS, type FacilityId, type PrereqId } from '@/config/marketing';
import { GUEST_TYPE_NAMES } from '@/sim/guests/Guest';
import { makeResort, run } from '../game/harness';
import type { GameEvents } from '@/core/events';

const ctx = (o: { season?: 'winter' | 'summer'; stars?: number; has?: FacilityId[]; ratio?: number; missing?: PrereqId[] } = {}): MarketingContext => ({
  season: () => o.season ?? 'winter', stars: () => o.stars ?? 3, has: (f) => (o.has ?? ['kids', 'altiport', 'luxury', 'summer']).includes(f), dayPassRatio: () => o.ratio ?? 1,
  met: (id) => !(o.missing ?? []).includes(id),
});
const fixture = (c: MarketingContext = ctx(), money = 100000) => {
  const date = { year: 0, day: 250 };
  const economy = new Economy({ money });
  const events: Array<[string, unknown]> = [];
  const bus = { emit: (k: string, p: unknown) => { events.push([k, p]); } } as never;
  const m = new Marketing({ economy, bus, date: () => date, ctx: c });
  return { m, date, economy, events };
};
const advance = (f: ReturnType<typeof fixture>, days: number): void => { f.date.day += days; f.m.update(); };

describe('campaign effectiveness', () => {
  it('missing requirements, wrong season and price misfit all reduce it', () => {
    const fam = campaignById('families')!, sum = campaignById('summer')!, vip = campaignById('vip')!, bud = campaignById('budget')!;
    const noKids = campaignEffectiveness(fam, ctx({ missing: ['kidsArea'] }));
    expect(noKids.value).toBe(0); // hard prerequisite missing
    expect(noKids.warnings.join(' ')).toMatch(/Requires: A kids area/);
    expect(campaignEffectiveness(sum, ctx({ season: 'winter' })).value).toBeLessThan(campaignEffectiveness(sum, ctx({ season: 'summer' })).value * 0.3);
    expect(campaignEffectiveness(vip, ctx({ has: ['altiport'] })).value).toBeGreaterThan(campaignEffectiveness(vip, ctx({ has: ['luxury'] })).value); // altiport bonus
    expect(campaignEffectiveness(vip, ctx({ ratio: 0.6 })).value).toBeLessThan(campaignEffectiveness(vip, ctx({ ratio: 1.2 })).value);
    expect(campaignEffectiveness(bud, ctx({ ratio: 1.8 })).value).toBeLessThan(campaignEffectiveness(bud, ctx({ ratio: 0.8 })).value);
    expect(campaignEffectiveness(fam, ctx({ stars: 5 })).value).toBeGreaterThan(campaignEffectiveness(fam, ctx({ stars: 1 })).value);
  });
});

describe('campaign prerequisites (hard)', () => {
  it('every campaign lists prerequisites with human-readable labels', () => {
    for (const c of CAMPAIGNS) { expect(c.prereqs.length, c.id).toBeGreaterThan(0); for (const p of c.prereqs) expect(p.label[0], p.label).toBe(p.label[0]!.toUpperCase()); }
  });
  it('canStart reports each missing item; start refuses without charging', () => {
    const f = fixture(ctx({ missing: ['skiSchool', 'kidsArea'] }));
    const c = f.m.canStart('families');
    expect(c.ok).toBe(false);
    expect(c.missing).toEqual(['Ski School HQ', 'A kids area (Kids Ground, Playground or Magic Carpet)']);
    expect(c.checks.map((x) => x.ok)).toEqual([false, false]);
    expect(f.m.start('families')).toBe('Requires: Ski School HQ, A kids area (Kids Ground, Playground or Magic Carpet)');
    expect(f.economy.money).toBe(100000);
    expect(f.m.running()).toHaveLength(0);
    expect(f.m.blocker('families')).toMatch(/^Requires:/);
    expect(f.m.canStart('brand')).toMatchObject({ ok: true, missing: [] });
    expect(f.m.canStart('nope').ok).toBe(false);
  });
  it.each([
    ['families', ['skiSchool'], /Ski School HQ/], ['budget', ['parking'], /Parking/], ['budget', ['openLift'], /open lift/i], ['budget', ['piste'], /open piste/i],
    ['vip', ['vipAccess'], /Altiport, Luxury Hotel or/], ['vip', ['rating'], /3★/], ['vip', ['dining'], /restaurant/i],
    ['summer', ['summerSeason'], /Summer season/], ['summer', ['summerAttraction'], /Adventure Park or an MTB trail/], ['summer', ['summerAccess'], /bike-capable lift or a hiking trail/], ['summer', ['rental'], /Rental/],
    ['brand', ['openLift'], /open lift/i], ['brand', ['dining'], /restaurant/i],
  ] as Array<[string, PrereqId[], RegExp]>)('%s is refused without %s', (id, missing, re) => {
    const f = fixture(ctx({ missing }));
    expect(f.m.start(id)).toMatch(re);
  });
  it('a running campaign is paused when a prerequisite disappears, resumes when it returns and is cancelled after the grace days', () => {
    let missing: PrereqId[] = [];
    const c = ctx(); c.met = (id) => !missing.includes(id);
    const f = fixture(c);
    expect(f.m.start('families')).toBeNull();
    expect(f.m.effect().weights.family).toBeGreaterThan(1.5);
    missing = ['skiSchool']; advance(f, 1);
    expect(f.m.running()[0]!.lapsed).toBe(1);
    expect(f.m.effect().weights.family).toBe(1); // paused: no effect
    missing = []; advance(f, 1);
    expect(f.m.running()[0]!.lapsed).toBe(0);
    expect(f.m.effect().weights.family).toBeGreaterThan(1.5); // resumed
    missing = ['skiSchool'];
    for (let d = 0; d < PREREQ_GRACE_DAYS; d++) advance(f, 1);
    expect(f.m.running()).toHaveLength(1);
    advance(f, 1);
    expect(f.m.running()).toHaveLength(0);
    const ev = f.events.find((e) => e[0] === 'marketing:cancelled')![1] as GameEvents['marketing:cancelled'];
    expect(ev).toMatchObject({ id: 'families', name: 'Families', reason: 'Requires: Ski School HQ' });
    expect(f.m.records()[0]!.cancelled).toMatch(/Ski School/);
    expect(f.m.start('families')).toMatch(/Requires|Cooling/);
    expect(f.events.filter((e) => e[0].startsWith('marketing:'))).toHaveLength(2); // started + cancelled (low volume)
  });
  it('paused state survives a JSON roundtrip', () => {
    let missing: PrereqId[] = [];
    const c = ctx(); c.met = (id) => !missing.includes(id);
    const f = fixture(c); f.m.start('families'); missing = ['kidsArea']; advance(f, 1);
    const g = fixture(c); g.m.load(JSON.parse(JSON.stringify(f.m.serialize())));
    expect(g.m.running()[0]!.lapsed).toBe(1); expect(g.m.running()[0]!.lapsedWhy).toEqual(['A kids area (Kids Ground, Playground or Magic Carpet)']);
  });
});

describe('Marketing lifecycle', () => {
  it('pays upfront into the marketing ledger and emits typed started/ended events', () => {
    const f = fixture();
    expect(f.m.start('families')).toBeNull();
    expect(f.economy.expenses.marketing).toBe(6000);
    expect(f.economy.money).toBe(94000);
    expect(f.events[0]).toEqual(['marketing:started', expect.objectContaining({ id: 'families', name: 'Families', cost: 6000, days: 14 })]);
    for (let i = 0; i < 5; i++) { f.m.recordArrival(2); advance(f, 1); }
    expect(f.events.filter((e) => e[0] === 'marketing:ended')).toHaveLength(0);
    advance(f, 10);
    const ended = f.events.find((e) => e[0] === 'marketing:ended')![1] as GameEvents['marketing:ended'];
    expect(ended.id).toBe('families'); expect(ended.arrivals).toBe(5);
    expect(f.events.filter((e) => e[0].startsWith('marketing:'))).toHaveLength(2); // low volume: start + end only
  });
  it('rejects when cash is short, running, cooling down, or at the concurrency cap', () => {
    const poor = fixture(ctx(), 100);
    expect(poor.m.start('families')).toBe('Not enough cash');
    const f = fixture();
    expect(f.m.start('families')).toBeNull();
    expect(f.m.start('families')).toBe('Already running');
    expect(f.m.start('brand')).toBeNull();
    expect(f.m.start('budget')).toMatch(/At most 2/);
    advance(f, 14); // families ended
    expect(f.m.start('families')).toMatch(/Cooling down/);
    advance(f, 14);
    expect(f.m.start('families')).toBeNull();
  });
  it('effect: target type share up, decays after the end, back to neutral; stacking has diminishing returns', () => {
    const f = fixture();
    f.m.start('families');
    const one = f.m.effect();
    expect(one.weights.family).toBeGreaterThan(1.5);
    expect(one.weights.solo).toBe(1);
    expect(one.boost).toBeGreaterThan(1);
    f.m.start('brand');
    const two = f.m.effect();
    const brandAlone = fixture(); brandAlone.m.start('brand');
    expect(two.boost - 1).toBeLessThan((one.boost - 1) + (brandAlone.m.effect().boost - 1)); // diminishing
    advance(f, 16);
    const tail = f.m.effect();
    expect(tail.weights.family).toBeGreaterThan(1);
    expect(tail.weights.family).toBeLessThan(one.weights.family);
    advance(f, MARKETING.tailDays);
    expect(f.m.effect().weights.family).toBe(1);
    expect(f.m.effect().boost).toBe(1);
  });
  it('measures uplift against the baseline moving average and keeps history', () => {
    const f = fixture();
    for (let d = 0; d < 10; d++) { for (let i = 0; i < 20; i++) f.m.recordArrival(i % 6); advance(f, 1); }
    f.m.recordArrival(0); // roll into the current day
    expect(f.m.baselinePerDay()).toBeCloseTo(20, 0);
    f.m.start('brand');
    for (let d = 0; d < 10; d++) { for (let i = 0; i < 25; i++) f.m.recordArrival(i % 6); advance(f, 1); }
    const rec = f.m.records()[0]!;
    expect(rec.id).toBe('brand');
    expect(rec.uplift).toBeGreaterThan(30);
    expect(rec.upliftPct).toBeGreaterThan(15);
  });
  it('previews ROI from the baseline and survives a JSON roundtrip', () => {
    const f = fixture();
    expect(f.m.preview(CAMPAIGNS[0]!).extraGuests).toBeNull(); // no data yet
    for (let d = 0; d < 6; d++) { for (let i = 0; i < 30; i++) f.m.recordArrival(2); advance(f, 1); }
    f.m.recordArrival(2);
    const p = f.m.preview(campaignById('families')!);
    expect(p.extraGuests![0]).toBeGreaterThan(0);
    expect(p.extraGuests![1]).toBeGreaterThan(p.extraGuests![0]);
    expect(p.costPerGuest).toBeGreaterThan(0);
    f.m.start('families');
    const g = fixture(); g.m.load(JSON.parse(JSON.stringify(f.m.serialize())));
    expect(g.m.effect()).toEqual(f.m.effect());
    expect(g.m.running()).toHaveLength(1);
  });
});

describe('campaigns in the full sim', () => {
  const share = (sim: ReturnType<typeof makeResort>['sim'], n: number): Record<string, number> => {
    const st = sim.guestSim.store, counts: Record<string, number> = {};
    sim.guestSim.spawner.benchFill(sim.game, n, n);
    let tot = 0;
    for (let i = 0; i < st.limit; i++) if (st.alive[i]) { const k = GUEST_TYPE_NAMES[st.type[i]!]!; counts[k] = (counts[k] ?? 0) + 1; tot++; }
    for (const k of Object.keys(counts)) counts[k] = counts[k]! / tot;
    return counts;
  };
  it('A/B across seeds: a Families campaign raises the family share; reverts after the end', () => {
    for (const seed of [1, 7, 1337]) {
      const base = makeResort(64, seed).sim, camp = makeResort(64, seed).sim;
      expect(camp.marketing.start('families')).toBeNull();
      const a = share(base, 400), b = share(camp, 400);
      expect(b.family!, `seed ${seed}`).toBeGreaterThan(a.family! + 0.04);
      // after end + tail: neutral again
      camp.game.date.day += 14 + MARKETING.tailDays + 1;
      camp.marketing.update();
      expect(camp.marketing.effect().weights.family).toBe(1);
    }
  });
  it('without a ski school / kids area the campaign cannot start (hard prerequisite)', () => {
    const { sim } = makeResort(64, 3);
    const withKids = sim.marketing.preview(campaignById('families')!).effectiveness.value;
    expect(withKids).toBeGreaterThan(0);
    for (const b of sim.buildings.all()) if (['skiSchoolHQ', 'kidsGround', 'playground', 'magicCarpet'].includes(b.type)) b.active = false;
    const without = sim.marketing.preview(campaignById('families')!).effectiveness;
    expect(without.value).toBe(0);
    expect(without.warnings.join(' ')).toMatch(/Requires: Ski School HQ/);
    expect(sim.marketing.start('families')).toMatch(/^Requires: Ski School HQ/);
  });
  it('books cost under the marketing ledger and emits events through the real bus', () => {
    const { sim } = makeResort(64, 5);
    const got: string[] = [];
    sim.bus.on('marketing:started', (e) => got.push(`s:${e.id}`));
    sim.bus.on('marketing:ended', (e) => got.push(`e:${e.id}`));
    const before = sim.economy.expenses.marketing;
    expect(sim.marketing.start('brand')).toBeNull();
    expect(sim.economy.expenses.marketing - before).toBe(2500);
    run(sim, { days: 11 });
    expect(got).toEqual(['s:brand', 'e:brand']);
  });
  it('60-day run: during the campaign window arrivals exceed the run without; the measured uplift is positive', () => {
    let withC = 0, without = 0, upl = 0;
    // The default starter has one Parking whose capacity throttles arrivals (demand > supply); widen it so demand shows up in arrivals.
    const parking = BUILDINGS.parking!, cap0 = parking.capacity;
    (parking as { capacity: number }).capacity = cap0 * 12;
    try {
    for (const seed of [1, 42]) {
      for (const camp of [false, true]) {
        const { sim } = makeResort(64, seed);
        let arrivals = 0;
        sim.bus.on('guest:arrived', () => { arrivals++; });
        run(sim, { days: 6, scanEvery: 4000 }); arrivals = 0;
        if (camp) { sim.marketing.start('brand'); sim.marketing.start('families'); }
        run(sim, { days: 14, scanEvery: 4000 });
        if (camp) { withC += arrivals; run(sim, { days: 40, scanEvery: 4000 }); upl += sim.marketing.records().reduce((a, r) => a + (r.uplift ?? 0), 0); expect(sim.marketing.records().length).toBe(2); } else without += arrivals;
      }
    }
    } finally { (parking as { capacity: number }).capacity = cap0; }
    expect(withC).toBeGreaterThan(without * 1.03);
    expect(upl).toBeGreaterThan(0);
  }, 120000);
  it('marketing + pricing state survives a registry JSON roundtrip', () => {
    const { sim } = makeResort(64, 2);
    sim.marketing.start('brand'); sim.priceApi.set('dayPass', 60);
    const snap = JSON.parse(JSON.stringify(sim.registry.serialize()));
    const other = makeResort(64, 2).sim;
    other.registry.load(snap);
    expect(other.marketing.running()).toHaveLength(1);
    expect(other.pricing.get('dayPass')).toBe(60);
  });
});
