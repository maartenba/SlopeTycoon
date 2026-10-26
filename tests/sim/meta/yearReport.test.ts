import { describe, expect, it } from 'vitest';
import { AWARDS, headlineOf, HEADLINE_SHARE, StaticBaselines, tierOf, TIER_RATIO, type BaselineProvider, type BaselineMetric } from '../../../src/config/yearAwards';
import { createSim, type Sim } from '../../../src/game/createSim';
import { Bot } from '../../../src/game/bot';
import { applySave, collectSave, stateHash } from '../../../src/game/saveState';
import { fillDemoStats } from '../../../src/sim/meta/demoStats';
import { StatsHistory } from '../../../src/sim/meta/StatsHistory';
import { computeYearReport, MAX_REPORTS, YearReports, type YearReport } from '../../../src/sim/meta/YearReport';

const demoHist = (endYear = 3): StatsHistory => { const h = new StatsHistory(null); fillDemoStats(h, endYear); return h; };

describe('award tiers', () => {
  it('cuts are inclusive and ordered; NaN / negative / tiny = none', () => {
    expect(tierOf(TIER_RATIO.bronze - 0.0001)).toBe(0);
    expect(tierOf(TIER_RATIO.bronze)).toBe(1);
    expect(tierOf(TIER_RATIO.silver - 0.0001)).toBe(1);
    expect(tierOf(TIER_RATIO.silver)).toBe(2);
    expect(tierOf(TIER_RATIO.gold - 0.0001)).toBe(2);
    expect(tierOf(TIER_RATIO.gold)).toBe(3);
    expect(tierOf(99)).toBe(3);
    for (const bad of [NaN, -1, -Infinity]) expect(tierOf(bad)).toBe(0);
    expect(tierOf(0)).toBe(0);
  });
  it('headline cuts on the share of possible points; no judged award = none', () => {
    expect(headlineOf(0, 0)).toBe('none');
    expect(headlineOf(27 * HEADLINE_SHARE.bronze - 0.01, 27)).toBe('none');
    expect(headlineOf(100 * HEADLINE_SHARE.bronze, 100)).toBe('bronze');
    expect(headlineOf(100 * HEADLINE_SHARE.silver, 100)).toBe('silver');
    expect(headlineOf(100 * HEADLINE_SHARE.gold, 100)).toBe('gold');
    expect(headlineOf(27, 27)).toBe('gold');
  });
  it('there are 6-10 data-driven awards with unique ids, short blurbs for each tier', () => {
    expect(AWARDS.length).toBeGreaterThanOrEqual(6); expect(AWARDS.length).toBeLessThanOrEqual(10);
    expect(new Set(AWARDS.map((a) => a.id)).size).toBe(AWARDS.length);
    for (const a of AWARDS) for (const b of a.blurb) { expect(b.length).toBeLessThanOrEqual(60); expect(b.includes('\n')).toBe(false); }
  });
  it('the static provider scales area-dependent values by map size and leaves ratios alone', () => {
    const p = new StaticBaselines();
    expect(p.baseline('summerIncome', { mapSize: 256, year: 1 })).toBeGreaterThan(p.baseline('summerIncome', { mapSize: 64, year: 1 }));
    expect(p.baseline('profitMargin', { mapSize: 256, year: 1 })).toBe(p.baseline('profitMargin', { mapSize: 64, year: 1 }));
  });
});

describe('BaselineProvider (interface for the rivals of Task 23)', () => {
  it('a fake provider changes the outcome: impossible baselines give no medals, trivial baselines give gold', () => {
    const h = demoHist(3);
    const mk = (v: number): BaselineProvider => ({ baseline: (m: BaselineMetric) => (m === 'incidentsPer1000' ? 1 / v : v) });
    const hard = computeYearReport({ hist: h, year: 3, mapSize: 128, name: 'T', baselines: mk(1e9) });
    const easy = computeYearReport({ hist: h, year: 3, mapSize: 128, name: 'T', baselines: mk(1e-9) });
    expect(hard.awards.filter((a) => a.tier > 0).length).toBeLessThan(easy.awards.filter((a) => a.tier > 0).length);
    expect(easy.headline.tier).toBe('gold');
    expect(hard.headline.tier).toBe('none');
    const calls: string[] = [];
    computeYearReport({ hist: h, year: 3, mapSize: 64, name: 'T', baselines: { baseline: (m, c) => { calls.push(`${m}:${c.mapSize}:${c.year}`); return 1; } } });
    expect(calls.length).toBe(AWARDS.length); expect(calls.every((c) => /:64:3$/.test(c))).toBe(true);
  });
});

describe('computeYearReport (synthetic demo history)', () => {
  it('is pure: the same history gives identical (JSON-equal) reports; totals add up', () => {
    const h = demoHist(3);
    const a = computeYearReport({ hist: h, year: 3, mapSize: 128, name: 'R' }), b = computeYearReport({ hist: h, year: 3, mapSize: 128, name: 'R' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.days).toBe(180); expect(a.partial).toBe(false);
    expect(a.totals.profit).toBe(a.totals.income - a.totals.expense);
    expect(a.months.reduce((s, m) => s + m.guests, 0)).toBe(a.totals.guests);
    expect(Math.abs(a.months.reduce((s, m) => s + m.net, 0) - a.totals.profit)).toBeLessThanOrEqual(12);
    expect(a.awards.length).toBe(AWARDS.length);
    expect(a.points).toBe(a.awards.reduce((s, x) => s + x.tier, 0));
    expect(a.deltas).toEqual([]);
  });
  it('year-over-year deltas versus the previous report', () => {
    const h = demoHist(3);
    const y2 = computeYearReport({ hist: h, year: 2, mapSize: 128, name: 'R' });
    const y3 = computeYearReport({ hist: h, year: 3, mapSize: 128, name: 'R', prev: y2 });
    expect(y3.deltas.map((d) => d.key)).toEqual(['guests', 'income', 'profit', 'rating']);
    expect(y3.deltas[0]!.delta).toBe(y3.totals.guests - y2.totals.guests);
    expect(y3.deltas[0]!.pct).toBeGreaterThan(0); // the demo grows year over year
    expect(y3.awards.find((a) => a.id === 'rising')!.ratio).not.toBeNull();
    expect(y2.awards.find((a) => a.id === 'rising')!.ratio).toBeNull();
  });
  it('a short first year is flagged partial and its headline is capped at bronze', () => {
    const h = demoHist(3);
    const full = computeYearReport({ hist: h, year: 3, mapSize: 128, name: 'R', baselines: { baseline: () => 1e-9 } });
    expect(full.headline.tier).toBe('gold');
    const short = new StatsHistory(null);
    const data = h.serialize() as { lastAbs: number; len: number };
    short.load({ ...data, len: 40 }); // only the last 40 days of year 3 are kept
    const r = computeYearReport({ hist: short, year: 3, mapSize: 128, name: 'R', baselines: { baseline: () => 1e-9 } });
    expect(r.days).toBe(40); expect(r.partial).toBe(true); expect(r.headline.tier).toBe('bronze');
  });
  it('keeps the last 10 reports only and recomputing a year replaces it', () => {
    const h = demoHist(3), store = new YearReports(h, { mapSize: 64, name: () => 'R', level: () => 4, goalsTotal: () => 9, venues: () => [], ready: () => {} });
    for (let y = 1; y <= 13; y++) store.generate(y > 3 ? 3 : y); // repeated years collapse
    expect(store.all().map((r) => r.year)).toEqual([1, 2, 3]);
    for (let y = 100; y < 112; y++) store.generate(y);
    expect(store.all().length).toBe(MAX_REPORTS);
    expect(store.latest()!.year).toBe(111);
    expect(store.latest()!.level).toBe(4);
    expect(store.setCover(111, 'data:image/jpeg;base64,AAAA')).toBe(true);
    expect(store.setCover(111, 'data:image/jpeg;base64,' + 'A'.repeat(30_000))).toBe(false);
  });
});

/** Starter + bot on the 64 map for `days` days. */
function bot(days: number): Sim {
  const sim = createSim({ size: 64, seed: 21, now: () => 0 });
  const b = new Bot(sim, {});
  sim.bus.on('finance:monthClosed', () => b.snapshotMonth());
  for (let d = 0; d < days; d++) { b.daily(); sim.tick(240); }
  return sim;
}
/** Stable, rounded key numbers of a report (what the snapshot pins). */
const key = (r: YearReport): unknown => ({
  year: r.year, days: r.days, guests: r.totals.guests, income: Math.round(r.totals.income / 100), profit: Math.round(r.totals.profit / 100), stars: r.totals.ratingEnd,
  headline: r.headline.tier, points: `${r.points}/${r.maxPoints}`, awards: r.awards.map((a) => `${a.id}:${a.tier}`).join(','), incidents: r.safety.incidents,
});

describe('starter + bot, deterministic report', () => {
  it('two runs give byte-identical reports, stats and stateHash; report numbers match the snapshot', () => {
    const a = bot(300), b = bot(300);
    expect(a.yearReports.all().map((r) => r.year)).toEqual([1, 2]); // the game starts mid-year 1 (day 120): a first partial year, then a full one
    expect(JSON.stringify(a.yearReports.all())).toBe(JSON.stringify(b.yearReports.all()));
    expect(JSON.stringify(a.stats.serialize(), (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v))).toBe(JSON.stringify(b.stats.serialize(), (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v)));
    expect(stateHash(a)).toEqual(stateHash(b));
    expect(a.yearReports.all().map(key)).toMatchSnapshot();
    const [y1, y2] = a.yearReports.all();
    expect(y1!.partial).toBe(true); expect(y2!.partial).toBe(false); expect(y2!.deltas.length).toBe(4);
    expect(y2!.totals.income).toBeGreaterThan(0);
    expect(y2!.months.length).toBe(12);
  }, 120_000);

  it('the observer does not feed back: saving mid-run, loading and continuing gives the same reports (stats + reports are in the save)', () => {
    const a = bot(150);
    const modules = structuredClone(collectSave(a));
    expect(modules['stats']).toBeTruthy(); expect(modules['yearReports']).toBeTruthy();
    const c = createSim({ size: 64, seed: 21, now: () => 0, fromSave: modules });
    expect(c.yearReports.all().length).toBe(a.yearReports.all().length);
    expect(c.stats.len).toBe(a.stats.len); expect(c.stats.lastAbs).toBe(a.stats.lastAbs);
    // an old save (modules missing) loads as empty
    const old = structuredClone(modules); delete old['stats']; delete old['yearReports'];
    const d = createSim({ size: 64, seed: 21, now: () => 0, fromSave: old });
    expect(d.stats.len).toBe(0); expect(d.yearReports.all()).toEqual([]);
    applySave(a, structuredClone(modules)); // round trip in place keeps the reports
    expect(a.yearReports.all().length).toBe(c.yearReports.all().length);
  }, 120_000);
});
