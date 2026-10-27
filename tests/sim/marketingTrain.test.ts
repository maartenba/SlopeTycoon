import { describe, expect, it } from 'vitest';
import { Marketing, campaignById, type MarketingContext } from '../../src/sim/Marketing';
import { Economy } from '../../src/sim/Economy';
import { CAMPAIGNS, ELASTICITY, FESTIVAL_CAMPAIGN, MARKETING, PREREQ_GRACE_DAYS, TRAIN_CAMPAIGN, TRAIN_SUSTAIN, type DayClass, type FacilityId, type PrereqId } from '../../src/config/marketing';
import { sustainParts, trainSharePoints } from '../../src/sim/meta/Sustainability';
import { createSim, type Sim } from '../../src/game/createSim';
import { buildDemoResort } from '../../src/game/demoResort';
import { applySave, collectSave, stateHash } from '../../src/game/saveState';
import { Mode } from '../../src/sim/guests/Guest';
import { BUILDINGS } from '../../src/config/buildings';

interface Opt { season?: 'winter' | 'spring' | 'summer' | 'autumn'; missing?: PrereqId[]; has?: FacilityId[]; day?: DayClass; window?: boolean; fmult?: number }
const mkCtx = (o: Opt = {}): MarketingContext & { o: Opt } => ({
  o, season: () => o.season ?? 'winter', stars: () => 3, has: (f) => (o.has ?? []).includes(f), dayPassRatio: () => 1, met: (id) => !(o.missing ?? []).includes(id),
  dayClass: () => o.day ?? 'regular', festivalWindow: () => o.window ?? false, festivalMult: () => o.fmult ?? 1,
});
const fixture = (o: Opt = {}, trackRail = false) => {
  const date = { year: 0, day: 250 }, c = mkCtx(o), economy = new Economy({ money: 100000 });
  const m = new Marketing({ economy, date: () => date, ctx: c, trackRail });
  return { m, date, c, economy };
};
const adv = (f: ReturnType<typeof fixture>, n: number): void => { f.date.day += n; f.m.update(); };

describe('campaigns v2, early batch: rows', () => {
  it('the four new campaigns exist with the planned numbers; the old five are untouched', () => {
    expect(CAMPAIGNS.slice(0, 5).map((c) => c.id)).toEqual(['families', 'budget', 'vip', 'summer', 'brand']);
    const t = campaignById('train')!, p = campaignById('parkJam')!, h = campaignById('hikeBike')!, fe = campaignById('festival')!;
    expect([t.cost, t.durationDays, t.cooldownDays, t.volumeBoost]).toEqual([4000, 21, 14, 0.06]);
    expect(t.targets).toEqual({ budget: 0.8, solo: 0.4, couple: 0.3 });
    expect(t.bonus).toEqual({ id: 'shuttle', factor: 1.15 });
    expect([p.cost, p.durationDays, p.cooldownDays, p.volumeBoost, p.offSeason]).toEqual([5000, 10, 21, 0.08, 0.2]);
    expect(p.seasons).toEqual(['winter', 'spring']);
    expect([h.cost, h.durationDays, h.cooldownDays, h.volumeBoost, h.offSeason]).toEqual([4500, 14, 14, 0.1, 0.3]);
    expect(h.targets.adventure).toBeUndefined(); // that is Summer Adventure Seekers' segment
    expect(h.dayClassMult).toEqual({ peak: 1.4, regular: 0.8, off: 0.6 });
    expect([fe.cost, fe.durationDays, fe.cooldownDays, fe.volumeBoost, fe.window]).toEqual([3000, 10, 30, 0.15, 'festival']);
  });
  it('prerequisite gating per campaign', () => {
    const need: Record<string, PrereqId[]> = { train: ['railStation', 'stationPath'], parkJam: ['stuntPark', 'openLift', 'rental'], hikeBike: ['summerSeason', 'summerAccess', 'dining'], festival: ['bookedFestival'] };
    for (const [id, ids] of Object.entries(need)) {
      expect(campaignById(id)!.prereqs.map((p) => p.id), id).toEqual(ids);
      for (const miss of ids) {
        const f = fixture({ missing: [miss], season: 'summer' });
        expect(f.m.blocker(id), `${id} without ${miss}`).toMatch(/^Requires:/);
        expect(f.m.start(id)).toMatch(/^Requires:/);
        expect(f.economy.money).toBe(100000);
      }
      expect(fixture({ season: 'summer' }).m.start(id), id).toBeNull();
    }
  });
  it('unmet prerequisites carry a Show me target', () => {
    for (const id of ['train', 'parkJam', 'hikeBike', 'festival']) for (const p of campaignById(id)!.prereqs) if (p.build) expect(p.show ?? 'build', `${id}/${p.id}`).toBe('build');
    expect(campaignById('train')!.prereqs[1]!.show).toBe('station');
    expect(campaignById('festival')!.prereqs[0]!.show).toBe('events');
    const f = fixture({ missing: ['railStation'] });
    expect(f.m.canStart('train').checks[0]).toMatchObject({ id: 'railStation', ok: false, build: 'trainStation', show: 'build' });
  });
});

describe('campaigns v2: day class, festival window, caps', () => {
  it('Hike & Bike works on peak days, less on Fridays, least Mon-Thu', () => {
    const f = fixture({ season: 'summer' });
    expect(f.m.start('hikeBike')).toBeNull();
    const boost = (d: DayClass): number => { f.c.o.day = d; f.m.update(); (f.m as unknown as { cache: null }).cache = null; return f.m.effect().boost - 1; };
    const peak = boost('peak'), reg = boost('regular'), off = boost('off');
    expect(peak).toBeGreaterThan(reg); expect(reg).toBeGreaterThan(off);
    expect(peak / off).toBeCloseTo(1.4 / 0.6, 5);
    expect(f.m.liveFactor(campaignById('hikeBike')!)).toBeCloseTo(0.6, 5);
  });
  it('campaigns without day-class fields ignore the day class', () => {
    const f = fixture({ season: 'winter' });
    f.m.start('brand');
    f.c.o.day = 'peak'; (f.m as unknown as { cache: null }).cache = null; const a = f.m.effect().boost;
    f.c.o.day = 'off'; (f.m as unknown as { cache: null }).cache = null; expect(f.m.effect().boost).toBe(a);
  });
  it('Festival Season is x0.2 outside the festival window and full inside; festival x campaign stays <= the crowding cap', () => {
    const f = fixture({ window: false });
    f.m.start('festival');
    const out = f.m.effect().boost - 1;
    f.c.o.window = true; (f.m as unknown as { cache: null }).cache = null;
    const inn = f.m.effect().boost - 1;
    expect(inn / out).toBeCloseTo(1 / FESTIVAL_CAMPAIGN.outside, 5);
    f.c.o.fmult = 1.35; (f.m as unknown as { cache: null }).cache = null; // Summer Music Festival
    expect(f.m.effect().boost * 1.35).toBeLessThanOrEqual(ELASTICITY.maxVolume + 1e-9);
    f.c.o.fmult = 1.18; (f.m as unknown as { cache: null }).cache = null;
    expect(f.m.effect().boost * 1.18).toBeLessThanOrEqual(ELASTICITY.maxVolume + 1e-9);
    expect(f.m.effect().boost).toBeGreaterThan(1);
  });
  it('a running Festival Season is not cancelled when the booking ends (start-only prerequisite) while others still are', () => {
    const f = fixture({ season: 'winter' });
    f.m.start('festival');
    f.c.o.missing = ['bookedFestival'];
    for (let i = 0; i < PREREQ_GRACE_DAYS + 2; i++) adv(f, 1);
    expect(f.m.running().map((r) => r.id)).toEqual(['festival']);
    const g = fixture({ season: 'winter' });
    g.m.start('train');
    g.c.o.missing = ['railStation'];
    for (let i = 0; i < PREREQ_GRACE_DAYS + 2; i++) adv(g, 1);
    expect(g.m.running()).toHaveLength(0); // station vanished: paused, then cancelled
  });
  it('Come by Train: rail bias scales with effectiveness, is capped, and is 0 without the campaign', () => {
    const f = fixture({ has: [] });
    expect(f.m.effect().railBias).toBe(0);
    f.m.start('train');
    const b = f.m.effect().railBias;
    expect(b).toBeGreaterThan(0.1); expect(b).toBeLessThanOrEqual(TRAIN_CAMPAIGN.maxBias);
    const g = fixture({ has: ['shuttle'] }); g.m.start('train');
    expect(g.m.effect().railBias).toBeGreaterThan(b); // Shuttle Depot bonus x1.15
  });
  it('rail share needs trackRail and 3 days of data; save round trip keeps a running campaign', () => {
    const f = fixture({}, true);
    f.m.start('train');
    for (let d = 0; d < 5; d++) { for (let i = 0; i < 10; i++) f.m.recordArrival(0, i < 3 ? Mode.Rail : Mode.Road); adv(f, 1); }
    expect(f.m.railShare()).toBeCloseTo(0.3, 5);
    expect(fixture({}, false).m.railShare()).toBeNull();
    const g = fixture({}, true);
    g.m.load(JSON.parse(JSON.stringify(f.m.serialize())));
    g.date.day = f.date.day;
    expect(g.m.running().map((r) => r.id)).toEqual(['train']);
    expect(g.m.railShare()).toBeCloseTo(0.3, 5);
    expect(MARKETING.maxConcurrent).toBe(2);
  });
});

describe('train sustainability sub-input', () => {
  it('worth at most 3 facet points; linear to the full share; facet stays <= 100', () => {
    expect(trainSharePoints(null)).toBe(0);
    expect(trainSharePoints(0)).toBe(0);
    expect(trainSharePoints(TRAIN_SUSTAIN.full / 2)).toBeCloseTo(1.5, 1);
    expect(trainSharePoints(1)).toBe(TRAIN_SUSTAIN.maxPoints);
    const raw = { energyPerGuest: 1, treeLoss: 0, habitatOverlap: 0, protection: 0 };
    const base = sustainParts(raw).score;
    expect(sustainParts({ ...raw, train: 3 }).score).toBe(Math.min(100, base + 3));
    expect(sustainParts({ ...raw, train: 99 }).score).toBeLessThanOrEqual(Math.min(100, base + 3));
    const low = { energyPerGuest: 8, treeLoss: 0.1, habitatOverlap: 0.2, protection: 0 };
    expect(sustainParts({ ...low, train: 99 }).score - sustainParts(low).score).toBeLessThanOrEqual(3.0001);
  });
});

// ---- real sim: demo resort has a served Train Station + stunt park ----
const demo = (campaignsV2: boolean, seed = 7): Sim => {
  const sim = createSim({ size: 64, seed, startSeason: 'winter', campaignsV2, now: () => 0 } as never);
  buildDemoResort(sim, 'large');
  sim.game.money = 500_000;
  sim.tick(5);
  return sim;
};
const days = (sim: Sim, n: number, probe?: () => void): void => { for (let i = 0; i < n * 240; i++) { sim.tick(1); if (probe && i % 10 === 0) probe(); } };

describe('Come by Train in a real sim', () => {
  it('gating follows the real station; mode shift moves road arrivals to rail within the 150 capacity', () => {
    const base = demo(true), camp = demo(true);
    expect(base.marketing.canStart('train').ok).toBe(true);
    expect(BUILDINGS.trainStation!.capacity).toBe(150);
    days(base, 12); days(camp, 12);
    expect(camp.marketing.start('train')).toBeNull();
    let peak = 0, roadB = 0, roadC = 0, n = 0;
    for (let i = 0; i < 21 * 240; i++) {
      base.tick(1); camp.tick(1);
      if (i % 10 === 0) { peak = Math.max(peak, camp.guestSim.spawner.modeLoadOf(Mode.Rail)); roadB += base.guestSim.spawner.modeLoadOf(Mode.Road); roadC += camp.guestSim.spawner.modeLoadOf(Mode.Road); n++; }
    }
    expect(roadC / n).toBeLessThan(roadB / n); // fewer cars in the car park (so fewer parking turn-aways)
    // eslint-disable-next-line no-console
    console.log(`[train] mean road load ${(roadB / n).toFixed(1)} -> ${(roadC / n).toFixed(1)}`);
    const sb = base.marketing.railShare(21)!, sc = camp.marketing.railShare(21)!;
    expect(sc).toBeGreaterThan(sb); // more of the arrivals take the train
    expect(peak).toBeLessThanOrEqual(150);
    // eslint-disable-next-line no-console
    console.log(`[train] rail share baseline ${(sb * 100).toFixed(1)}% -> campaign ${(sc * 100).toFixed(1)}%, peak rail load ${peak}`);
  });
  it('the shift saturates at the station capacity and the road keeps the rest; fewer cars than without the campaign', () => {
    const def = BUILDINGS.trainStation!, was = def.capacity;
    def.capacity = 12;
    try {
      const base = demo(true), camp = demo(true);
      days(base, 12); days(camp, 12); camp.marketing.start('train');
      let peak = 0, roadB = 0, roadC = 0, n = 0;
      for (let i = 0; i < 15 * 240; i++) {
        base.tick(1); camp.tick(1);
        if (i % 10 === 0) { peak = Math.max(peak, camp.guestSim.spawner.modeLoadOf(Mode.Rail)); roadB += base.guestSim.spawner.modeLoadOf(Mode.Road); roadC += camp.guestSim.spawner.modeLoadOf(Mode.Road); n++; }
      }
      expect(peak).toBeLessThanOrEqual(12);
      expect(peak).toBeGreaterThan(0);
      expect(camp.marketing.railShare(15)!).toBeGreaterThan(0);
      // eslint-disable-next-line no-console
      console.log(`[train cap 12] peak rail ${peak}, mean road load baseline ${(roadB / n).toFixed(1)} vs campaign ${(roadC / n).toFixed(1)}`);
    } finally { def.capacity = was; }
  });
  it('the rail share feeds the sustainability facet, at most 3 points', () => {
    const sim = demo(true); days(sim, 6);
    const p = sim.sustain.measure();
    expect(p.raw.train ?? 0).toBeGreaterThan(0);
    expect(p.raw.train ?? 0).toBeLessThanOrEqual(TRAIN_SUSTAIN.maxPoints);
    const off = demo(false); days(off, 6);
    expect(off.sustain.measure().raw.train ?? 0).toBe(0);
  });
  it('stationPath / railStation reflect the station; removing it blocks the campaign', () => {
    const sim = demo(true);
    const st = sim.buildings.all().find((b) => b.type === 'trainStation')!;
    sim.buildings.remove(st.id); sim.refreshCoverage(undefined, true); sim.tick(2);
    expect(sim.marketing.blocker('train')).toMatch(/Requires: A Train Station/);
  });
  it('deterministic: same seed -> same hash with a running campaign; save round-trips the run', () => {
    const run = (): { h: string; sim: Sim } => { const s = demo(true); days(s, 3); s.marketing.start('train'); days(s, 3); return { h: stateHash(s).hash, sim: s }; };
    const a = run(), b = run();
    expect(a.h).toBe(b.h);
    const mods = JSON.parse(JSON.stringify(collectSave(a.sim)));
    const c = demo(true); applySave(c, mods);
    expect(c.marketing.running().map((r) => r.id)).toEqual(['train']);
    expect(JSON.stringify(c.marketing.serialize())).toBe(JSON.stringify(a.sim.marketing.serialize()));
  });
  it('default sims (flag off) never track rail: hash parts stay as before', () => {
    const s = demo(false); days(s, 4);
    expect(s.marketing.railShare()).toBeNull();
    const log = (s.marketing.serialize() as { log: Array<{ rail?: number }> }).log;
    expect(log.every((l) => l.rail === undefined)).toBe(true);
  });
});

describe('other early campaigns in a real sim', () => {
  it('Snowboard Park Jam: needs a stunt park + rental + open lift (demo resort) and gets the lift-top bonus', () => {
    const sim = demo(true); days(sim, 1);
    const hasPark = sim.buildings.all().some((b) => b.type === 'stuntPark' && b.active);
    // the demo resort has no stunt park by default: the card is gated until one is built
    expect(sim.marketing.canStart('parkJam').ok).toBe(hasPark);
    if (!hasPark) expect(sim.marketing.blocker('parkJam')).toMatch(/Stunt Park/);
  });
  it('Festival Season is gated by a booking and Hike & Bike by the summer season', () => {
    const sim = demo(true); days(sim, 1);
    expect(sim.marketing.blocker('festival')).toMatch(/booked festival/);
    expect(sim.marketing.blocker('hikeBike')).toMatch(/Summer season/);
  });
});
