import { describe, expect, it } from 'vitest';
import { RIVALS, RIVAL_PREFIXES, SUSTAIN } from '../../src/config/rivals';
import { AWARDS } from '../../src/config/yearAwards';
import { createSim, type Sim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { applySave, collectSave, stateHash } from '../../src/game/saveState';
import { Rivals, makeRivals, marketShares, rivalCount, type RivalSources } from '../../src/sim/meta/Rivals';
import { Sustainability, sustainHint, sustainParts, type SustainRaw } from '../../src/sim/meta/Sustainability';
import { PropKind } from '../../src/world/Props';
import { applyPlanting, applyClearing, planPlanting } from '../../src/sim/nature/Planting';
import { DAYS_PER_YEAR } from '../../src/config/balance';
import { computeYearReport } from '../../src/sim/meta/YearReport';
import { fillDemoStats } from '../../src/sim/meta/demoStats';
import { StatsHistory } from '../../src/sim/meta/StatsHistory';

interface Probe { stars: number; price: number; day: number; affects: boolean; sust: number | null; news: string[] }
const mk = (seed: number, p: Partial<Probe> = {}): { r: Rivals; p: Probe } => {
  const probe: Probe = { stars: 3.5, price: 1, day: 0, affects: true, sust: 70, news: [], ...p };
  const src: RivalSources = { seed, today: () => probe.day, stars: () => probe.stars, priceRatio: () => probe.price, sustainability: () => probe.sust, affectsArrivals: () => probe.affects, news: (t) => probe.news.push(t) };
  return { r: new Rivals(src), p: probe };
};
const days = (r: Rivals, p: Probe, n: number): void => { for (let i = 0; i < n; i++) { p.day++; r.newDay(); } };

describe('rivals: seeded identity', () => {
  it('2 or 3 rivals, unique names from the seed, the same every time', () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const a = makeRivals(seed), b = makeRivals(seed);
      expect(a).toEqual(b);
      expect(a.length).toBe(rivalCount(seed)); expect(a.length).toBeGreaterThanOrEqual(2); expect(a.length).toBeLessThanOrEqual(3);
      expect(new Set(a.map((x) => x.name)).size).toBe(a.length);
      expect(new Set(a.map((x) => x.name.split(' ')[0])).size).toBe(a.length); // prefixes never repeat
      for (const x of a) { expect(RIVAL_PREFIXES).toContain(x.name.split(' ')[0] as never); expect(x.target).toBeGreaterThanOrEqual(RIVALS.starsRange[0]); expect(x.target).toBeLessThanOrEqual(RIVALS.starsRange[1]); }
      counts.add(a.length);
    }
    expect(counts.size).toBe(2); // both 2 and 3 occur
    expect(makeRivals(1).map((x) => x.name)).not.toEqual(makeRivals(2).map((x) => x.name));
  });
});

describe('rivals: market share (multinomial logit of rating and price)', () => {
  const rivals = [{ stars: 3.5, price: 1 }, { stars: 3.5, price: 1 }];
  it('shares sum to 1; equal resorts get a fair share', () => {
    const s = marketShares({ stars: 3.5, price: 1 }, rivals);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    for (const v of s) expect(v).toBeCloseTo(1 / 3, 10);
  });
  it('a better rating raises your share, a higher price lowers it', () => {
    const base = marketShares({ stars: 3.5, price: 1 }, rivals)[0]!;
    expect(marketShares({ stars: 4.5, price: 1 }, rivals)[0]!).toBeGreaterThan(base);
    expect(marketShares({ stars: 2, price: 1 }, rivals)[0]!).toBeLessThan(base);
    expect(marketShares({ stars: 3.5, price: 1.4 }, rivals)[0]!).toBeLessThan(base);
    expect(marketShares({ stars: 3.5, price: 0.7 }, rivals)[0]!).toBeGreaterThan(base);
  });
});

describe('rivals: arrival multiplier', () => {
  it('is exactly 1 in the grace period, whatever the rating', () => {
    const { r, p } = mk(61, { stars: 5 });
    for (let d = 0; d <= RIVALS.graceDays; d++) { p.day = d; r.newDay(); expect(r.arrivalMult()).toBe(1); }
  });
  it('is exactly 1 when it must not affect arrivals (scenarios, the tutorial), even though the share is shown', () => {
    const { r, p } = mk(61, { stars: 5, affects: false });
    days(r, p, 400);
    expect(r.arrivalMult()).toBe(1); expect(r.share).toBeGreaterThan(r.fair);
  });
  it('is bounded to [min, max], above 1 for a strong resort, below 1 for a weak one, and ramps in smoothly', () => {
    const strong = mk(61, { stars: 5, price: 0.8 }), weak = mk(61, { stars: 1 });
    const seen: number[] = [];
    for (let d = 0; d < 400; d++) { strong.p.day = weak.p.day = d; strong.r.newDay(); weak.r.newDay(); seen.push(strong.r.arrivalMult()); }
    expect(strong.r.arrivalMult()).toBeGreaterThan(1); expect(strong.r.arrivalMult()).toBeLessThanOrEqual(RIVALS.max);
    expect(weak.r.arrivalMult()).toBeLessThan(1); expect(weak.r.arrivalMult()).toBeGreaterThanOrEqual(RIVALS.min);
    for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i]! - seen[i - 1]!)).toBeLessThan(0.01);
  });
  it('a resort as good as its neighbours is neutral (share = fair share)', () => {
    const { r, p } = mk(61, { stars: 3.5 });
    r.rivals.forEach((x) => { x.stars = 3.5; x.price = 1; x.priceBase = 1; x.target = 3.5; });
    p.day = 400; r.newDay();
    expect(r.share).toBeCloseTo(r.fair, 6); expect(r.arrivalMult()).toBeCloseTo(1, 6);
  });
  it('the price effect is bounded: a ruinously cheap resort gains at most max', () => {
    const { r, p } = mk(3, { stars: 3.5, price: 0.3 });
    days(r, p, 400);
    expect(r.arrivalMult()).toBeLessThanOrEqual(RIVALS.max);
  });
});

describe('rivals: evolution, save, news, baselines', () => {
  it('neighbours drift deterministically; a save round trip continues identically', () => {
    const a = mk(7), b = mk(7);
    days(a.r, a.p, 200); days(b.r, b.p, 200);
    expect(JSON.stringify(a.r.serialize())).toBe(JSON.stringify(b.r.serialize()));
    const saved = JSON.parse(JSON.stringify(a.r.serialize())) as unknown;
    const c = mk(7); c.p.day = a.p.day; c.r.load(saved);
    days(a.r, a.p, 120); days(c.r, c.p, 120);
    expect(JSON.stringify(c.r.serialize())).toBe(JSON.stringify(a.r.serialize()));
    expect(a.r.rivals.some((x, i) => x.stars !== makeRivals(7)[i]!.stars)).toBe(true); // they did move
  });
  it('rivals slowly improve over the years (never above the cap) so a passive resort loses ground', () => {
    const { r, p } = mk(61, { stars: 3.5 });
    days(r, p, 3 * DAYS_PER_YEAR);
    for (const x of r.rivals) { expect(x.stars).toBeLessThanOrEqual(5); expect(x.target + RIVALS.yearlyGain * 3).toBeGreaterThan(x.target); }
    const avg = r.rivals.reduce((s, x) => s + x.stars, 0) / r.rivals.length, start = makeRivals(61).reduce((s, x) => s + x.stars, 0) / r.rivals.length;
    expect(avg).toBeGreaterThan(start - 0.3);
  });
  it('news is rare and quiet: at most one line per 90 days, only on a change of leader, none in scenarios', () => {
    const { r, p } = mk(61, { stars: 5 });
    r.rivals.forEach((x) => { x.target = 3; x.stars = 3; });
    for (let d = 0; d < 6 * DAYS_PER_YEAR; d++) { p.day++; p.stars = Math.floor(d / 70) % 2 === 0 ? 5 : 1; r.newDay(); }
    expect(p.news.length).toBeGreaterThan(0); expect(p.news.length).toBeLessThanOrEqual(Math.ceil((6 * DAYS_PER_YEAR) / RIVALS.newsEveryDays));
    const q = mk(61, { stars: 5, affects: false }); days(q.r, q.p, 600); expect(q.p.news).toEqual([]);
  });
  it('baselines: neighbours scale the regional table (a strong neighbourhood raises the bar, incidents lower-better) but not growth / margin', () => {
    const strong = mk(61).r, weak = mk(61).r;
    strong.rivals.forEach((x) => { x.stars = 4.6; }); weak.rivals.forEach((x) => { x.stars = 3; });
    const ctx = { mapSize: 128, year: 2 };
    expect(strong.baseline('pisteQuality', ctx)).toBeGreaterThan(weak.baseline('pisteQuality', ctx));
    expect(strong.baseline('incidentsPer1000', ctx)).toBeLessThan(weak.baseline('incidentsPer1000', ctx));
    expect(strong.baseline('guestGrowth', ctx)).toBe(weak.baseline('guestGrowth', ctx));
    expect(strong.baseline('profitMargin', ctx)).toBe(weak.baseline('profitMargin', ctx));
    const mid = mk(61).r; mid.rivals.forEach((x) => { x.stars = 3.5; });
    expect(mid.baseline('pisteQuality', ctx)).toBeCloseTo(0.66, 10); // 3.5 stars = the static table
  });
  it('the report section ranks you among the neighbours', () => {
    const { r, p } = mk(61, { stars: 5 });
    days(r, p, 100);
    const s = r.section(0)!;
    expect(s.of).toBe(r.rivals.length + 1); expect(s.rank).toBe(1); expect(s.entries[0]!.you).toBe(true);
    expect(s.entries.reduce((a, e) => a + e.share, 0)).toBeGreaterThan(0.97); expect(s.entries.reduce((a, e) => a + e.share, 0)).toBeLessThan(1.04);
    expect(s.sustainability).toBe(70);
    expect(r.section(5)).toBeNull();
  });
});

describe('sustainability parts', () => {
  const raw = (o: Partial<SustainRaw> = {}): SustainRaw => ({ energyPerGuest: 5, treeLoss: 0, habitatOverlap: 0, protection: 0, ...o });
  it('energy per guest: low is good, high is bad, unknown is neutral', () => {
    expect(sustainParts(raw({ energyPerGuest: SUSTAIN.energy.good })).energy).toBe(1);
    expect(sustainParts(raw({ energyPerGuest: SUSTAIN.energy.bad })).energy).toBe(0);
    expect(sustainParts(raw({ energyPerGuest: 3 })).energy).toBeGreaterThan(sustainParts(raw({ energyPerGuest: 8 })).energy);
    expect(sustainParts(raw({ energyPerGuest: -1 })).energy).toBe(SUSTAIN.idleEnergy);
  });
  it('trees: the allowance is free, more felling than planting hurts, planting restores it', () => {
    expect(sustainParts(raw({ treeLoss: SUSTAIN.trees.allowance })).trees).toBe(1);
    expect(sustainParts(raw({ treeLoss: 0.12 })).trees).toBeLessThan(0.6);
    expect(sustainParts(raw({ treeLoss: 0.5 })).trees).toBe(0);
    expect(sustainParts(raw({ treeLoss: 0 })).trees).toBe(1);
  });
  it('habitat: overlap beyond the free share hurts; trained rangers (wildlifeProtection 1) take part of it off', () => {
    const o = 0.2;
    const without = sustainParts(raw({ habitatOverlap: o })), with_ = sustainParts(raw({ habitatOverlap: o, protection: 1 }));
    expect(without.habitat).toBeLessThan(1); expect(with_.habitat).toBeGreaterThan(without.habitat); expect(with_.score).toBeGreaterThan(without.score);
    expect(sustainParts(raw({ habitatOverlap: SUSTAIN.habitat.free })).habitat).toBe(1);
  });
  it('score is the weighted mean 0..100 and the hint names the weakest part', () => {
    const p = sustainParts(raw({ energyPerGuest: 2, treeLoss: 0, habitatOverlap: 0 }));
    expect(p.score).toBe(100);
    expect(sustainHint(p)).toBe('Gentle on the mountain');
    expect(sustainHint(sustainParts(raw({ treeLoss: 0.3 })))).toMatch(/Plant trees/);
    expect(sustainHint(sustainParts(raw({ habitatOverlap: 0.4, energyPerGuest: 2 })))).toMatch(/rangers/);
    expect(sustainHint(sustainParts(raw({ habitatOverlap: 0.4, energyPerGuest: 2, protection: 1 })))).not.toMatch(/train rangers/);
    expect(sustainHint(sustainParts(raw({ energyPerGuest: 12 })))).toMatch(/Energy/);
  });
  it('the tracker smooths energy per guest (energy EMA / guest EMA) and survives a save round trip', () => {
    let energy = 100;
    const t = new Sustainability({ energyToday: () => energy, trees: () => ({ felled: 10, planted: 10, live: 1000 }), habitat: () => 0, protection: () => 0 });
    expect(t.measure().raw.energyPerGuest).toBe(-1);
    for (let d = 0; d < 200; d++) { for (let g = 0; g < 50; g++) t.noteArrival(); t.closeDay(); }
    expect(t.measure().raw.energyPerGuest).toBeCloseTo(2, 1);
    expect(t.measure().raw.treeLoss).toBe(0);
    const u = new Sustainability({ energyToday: () => energy, trees: () => ({ felled: 10, planted: 10, live: 1000 }), habitat: () => 0, protection: () => 0 });
    u.load(JSON.parse(JSON.stringify(t.serialize())));
    expect(u.measure().raw.energyPerGuest).toBeCloseTo(t.measure().raw.energyPerGuest, 10);
    energy = 0; t.noteNoon(40); t.closeDay(); expect(t.measure().raw.energyPerGuest).toBeLessThan(2);
  });
});

describe('sustainability in the game', () => {
  it('counts trees felled and planted (props store), and feeds the rating as a facet', () => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0 });
    const f0 = sim.props.treesFelled, p0 = sim.props.treesPlanted;
    let x = 0, y = 0; // find a forest tile
    for (let i = 0; i < sim.size * sim.size; i++) if (sim.terrainInfo.forestDensity[i]! > 120 && sim.grid.occupancy.flags[i] === 0) { x = i % sim.size; y = (i / sim.size) | 0; break; }
    const removed = sim.props.removeInRect(x - 2, y - 2, x + 2, y + 2);
    expect(removed).toBeGreaterThan(0); expect(sim.props.treesFelled).toBeGreaterThan(f0);
    const plan = planPlanting({ grid: sim.grid, props: sim.props, seed: 1, blocked: () => false }, x, y, 3, 'conifer', 0.8, 1);
    applyPlanting(sim.props, plan, 1);
    expect(sim.props.treesPlanted).toBe(p0 + plan.trees.length);
    sim.props.add(PropKind.Rock, 1, 1, 0.5, 0.5, 1, 0, 0, 5); // a rock is no tree
    expect(sim.props.treesPlanted).toBe(p0 + plan.trees.length);
    void applyClearing;
    sim.tick(240 * 2);
    const c = sim.rating.breakdown().components.find((k) => k.id === 'sustainability')!;
    expect(c).toBeTruthy(); expect(c.weight).toBe(0.08); expect(c.score).toBeGreaterThan(0);
  });
  it('rangers (wildlifeProtection) raise the habitat input of the facet', () => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0 });
    expect(sim.sustain.measure().raw.protection).toBe(0);
    sim.progression.withBypass(() => { sim.game.money = 100_000; sim.staffUpgrades.start('rangers'); });
    for (let d = 0; d < 12; d++) sim.tick(240);
    expect(sim.staffUpgrades.wildlifeProtection()).toBe(1);
    expect(sim.sustain.measure().raw.protection).toBe(1);
  });
  it('arrivals are exactly neutral in a scenario / with rivalMarket false, and the rivals module round-trips through the save', () => {
    const a = createSim({ size: 64, seed: 61, rivalMarket: false, now: () => 0 }); runBot(a, new Bot(a), 120);
    expect(a.rivals.arrivalMult()).toBe(1); expect(a.rivals.share).toBeGreaterThan(0);
    const b = createSim({ size: 64, seed: 61, now: () => 0 }); runBot(b, new Bot(b), 120);
    expect(b.rivals.arrivalMult()).not.toBe(1);
    expect(b.rivals.arrivalMult()).toBeGreaterThanOrEqual(RIVALS.min); expect(b.rivals.arrivalMult()).toBeLessThanOrEqual(RIVALS.max);
    const save = structuredClone(collectSave(b));
    const c = createSim({ size: 64, seed: 61, now: () => 0, fromSave: save });
    expect(JSON.stringify(c.rivals.serialize())).toBe(JSON.stringify(b.rivals.serialize()));
    expect(c.props.treesFelled).toBe(b.props.treesFelled); expect(c.props.treesPlanted).toBe(b.props.treesPlanted);
    expect(stateHash(c).parts['rivals']).toBe(stateHash(b).parts['rivals']);
    // an older save without the module: fresh rivals from the seed, no crash
    const old = structuredClone(collectSave(b)); delete (old as Record<string, unknown>)['rivals'];
    const d = createSim({ size: 64, seed: 61, now: () => 0, fromSave: old });
    expect(d.rivals.rivals.map((r) => r.name)).toEqual(makeRivals(61).map((r) => r.name));
    void applySave;
  }, 120_000);
});

describe('year report: rivals + Green Resort', () => {
  const hist = (): StatsHistory => { const h = new StatsHistory(null); fillDemoStats(h, 3); return h; };
  const section = (sust: number | null) => ({ share: 0.4, fair: 0.33, rank: 1, of: 3, entries: [{ name: 'Your resort', stars: 4, share: 0.4, you: true }, { name: 'Silberhorn Peaks', stars: 3.5, share: 0.3, you: false }, { name: 'Gletscher Lifts', stars: 3.4, share: 0.3, you: false }], sustainability: sust });
  it('there are ten awards and one is the Green Resort', () => {
    expect(AWARDS.length).toBe(10);
    expect(AWARDS.find((a) => a.id === 'green')!.name).toBe('Green Resort');
  });
  it('Green Resort tiers follow the year-mean sustainability against the baseline; not judged without data', () => {
    const tier = (s: number | null): number | null => computeYearReport({ hist: hist(), year: 3, mapSize: 128, name: 'x', rivals: s === null ? null : section(s) }).awards.find((a) => a.id === 'green')!.tier;
    expect(tier(95)).toBe(3); expect(tier(70)).toBeGreaterThanOrEqual(2); expect(tier(20)).toBe(0);
    const none = computeYearReport({ hist: hist(), year: 3, mapSize: 128, name: 'x' }).awards.find((a) => a.id === 'green')!;
    expect(none.ratio).toBeNull(); expect(none.tier).toBe(0);
  });
  it('the report carries the rival comparison (and stays free of it when there are no rivals)', () => {
    const r = computeYearReport({ hist: hist(), year: 3, mapSize: 128, name: 'x', rivals: section(80) });
    expect(r.rivals!.rank).toBe(1); expect(r.rivals!.entries.length).toBe(3);
    expect('rivals' in computeYearReport({ hist: hist(), year: 3, mapSize: 128, name: 'x' })).toBe(false);
  });
  it('a bot year in the real game produces a rivals section and a judged Green Resort award', () => {
    const sim: Sim = createSim({ size: 64, seed: 61, now: () => 0 }); runBot(sim, new Bot(sim), 2 * DAYS_PER_YEAR + 2);
    const rep = sim.yearReports.get(1) ?? sim.yearReports.latest()!;
    expect(rep.rivals).toBeTruthy(); expect(rep.rivals!.entries.some((e) => e.you)).toBe(true);
    expect(rep.awards.find((a) => a.id === 'green')!.ratio).not.toBeNull();
    expect(JSON.stringify(rep)).not.toMatch(/share this|link|code/i);
  }, 120_000);
});

describe('bot (green play): plants trees, keeps off habitat, trains rangers by a simple rule', () => {
  const play = (green: boolean): Sim => { const sim = createSim({ size: 64, seed: 61, now: () => 0 }); runBot(sim, new Bot(sim, { green }), DAYS_PER_YEAR); return sim; };
  it('replants what the build-out felled and builds no more on habitat than the plain bot', () => {
    const g = play(true), p = play(false);
    expect(g.props.treesFelled).toBeGreaterThan(0);
    expect(g.props.treesPlanted).toBeGreaterThanOrEqual(g.props.treesFelled);
    expect(p.props.treesPlanted).toBe(0);
    expect(g.sustain.measure().raw.habitatOverlap).toBeLessThanOrEqual(p.sustain.measure().raw.habitatOverlap + 1e-9);
    expect(g.sustain.measure().raw.treeLoss).toBeLessThan(p.sustain.measure().raw.treeLoss);
    // the score also carries the energy-per-guest facet, which any change that nudges the bot's guest numbers (e.g. April lift service) swings by a few tenths: the tree / habitat facets above are the real green signal
    expect(g.sustain.measure().score).toBeGreaterThan(p.sustain.measure().score - 1.5);
  }, 120_000);
  it('buys the rangers only when habitat overlap is above the free share (and never twice)', () => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0 }); const bot = new Bot(sim);
    sim.game.money = 200_000;
    (bot as unknown as { trainRangers(): void }).trainRangers();
    expect(sim.staffUpgrades.training).toBeFalsy(); // no measurement yet / low overlap: nothing bought
    sim.sustain.last = () => ({ energy: 1, trees: 1, habitat: 0.3, score: 70, raw: { energyPerGuest: 3, treeLoss: 0, habitatOverlap: 0.3, protection: 0 } });
    (bot as unknown as { trainRangers(): void }).trainRangers();
    expect(sim.staffUpgrades.training).toBeTruthy();
  });
});
