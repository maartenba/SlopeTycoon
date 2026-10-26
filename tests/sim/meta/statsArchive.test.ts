import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../src/core/EventBus';
import type { GameEvents } from '../../../src/core/events';
import { createSim } from '../../../src/game/createSim';
import { SAVE_MODULES, stateHash } from '../../../src/game/saveState';
import { pack, unpack } from '../../../src/persist/codec';
import { emptyBuckets } from '../../../src/sim/Economy';
import { fillDemoStats } from '../../../src/sim/meta/demoStats';
import { ARCHIVE_METRICS, StatsHistory, STATS_DAYS, type StatsSources } from '../../../src/sim/meta/StatsHistory';

/** A busy fake resort with noisy, realistic-looking numbers in every category. */
function resort(): { h: StatsHistory; day(): void } {
  let d = 0, s = 12345, cash = 50_000;
  const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const src: StatsSources = {
    guests: () => ({ count: Math.round(200 * rnd()), happiness: 0.7 + 0.2 * rnd() }), stars: () => 2 + 2.5 * rnd(), today: () => d,
    day: () => { const b = emptyBuckets(); for (const k of Object.keys(b.income)) (b.income as Record<string, number>)[k] = rnd() * 3000; for (const k of Object.keys(b.expense)) (b.expense as Record<string, number>)[k] = rnd() * 1500; return b; },
    incidents: () => ({ created: d, resolved: d, hospitalised: d >> 3 }), runs: () => d * 400, terrain: () => ({ snow: rnd(), skiable: rnd(), quality: rnd() }),
    weather: () => ({ code: Math.floor(rnd() * 6), temp: -5 + 10 * rnd() }), attacks: () => 0, queueMinutes: () => rnd() * 8, isFamily: () => false,
    cash: () => (cash += rnd() * 4000 - 1800), sustain: () => 40 + 40 * rnd(),
  };
  const h = new StatsHistory(src), bus = new EventBus<GameEvents>(); h.attach(bus);
  return { h, day: () => { d++; for (let i = 0; i < 30; i++) bus.emit('guest:arrived', { id: i }); bus.emit('time:hour', { hour: 11 }); h.captureDay(); } };
}
const text = (h: StatsHistory): string => JSON.stringify(pack(h.serialize()));

describe('StatsHistory monthly archive (Task 30)', () => {
  it('keeps one archive row per closed 15-day month, contiguous, beyond the 2-year daily window', () => {
    const r = resort();
    for (let i = 0; i < 5 * 180 + 3; i++) r.day();
    expect(r.h.len).toBe(STATS_DAYS);
    const rows = r.h.archive('arrivals');
    expect(rows.length).toBeGreaterThanOrEqual(5 * 12 - 1);
    rows.forEach((x, i) => { if (i) expect(x.index).toBe(rows[i - 1]!.index + 1); });
    expect(rows[1]!.value).toBe(15 * 30); // a whole month of 30 arrivals a day
    for (const m of ARCHIVE_METRICS) expect(r.h.archive(m).length).toBe(rows.length);
    expect(r.h.archive('cash')[3]!.value).not.toBe(0);
    expect(() => r.h.archive('nope')).toThrow();
  });

  it('save grows < 50 KB after 5 in-game years (even uncompressed) and round-trips exactly', () => {
    const r = resort();
    const empty = text(new StatsHistory(null)).length;
    for (let i = 0; i < 5 * 180; i++) r.day();
    const full = text(r.h);
    const grown = full.length - empty;
    console.info(`stats module after 5 years: ${full.length} chars (grew ${grown})`);
    expect(grown).toBeLessThan(50_000);
    expect(gzipSync(Buffer.from(full)).length).toBeLessThan(35_000); // what the real (gzipped) save pays
    const g = new StatsHistory(null);
    g.load(unpack(JSON.parse(full)));
    expect(g.lastAbs).toBe(r.h.lastAbs); expect(g.len).toBe(r.h.len); expect(g.archiveMonths()).toBe(r.h.archiveMonths());
    // quantised on save: money to whole dollars, ratios to hundredths
    for (const m of ['income', 'arrivals', 'cash', 'sustain', 'inc:lifts', 'exp:upkeep']) {
      const a = Array.from(g.series(m)), b = Array.from(r.h.series(m));
      a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThanOrEqual(0.51));
    }
    g.archive('income').forEach((row, i) => expect(Math.abs(row.value - r.h.archive('income')[i]!.value)).toBeLessThanOrEqual(0.51));
    expect(text(g)).toBe(full);
  });

  it('an old-format save (no archive) gets monthly rows rebuilt from its days', () => {
    const h = new StatsHistory(null); fillDemoStats(h, 3);
    expect(h.archiveMonths()).toBe(2 * 12);
    expect(h.archive('income')[0]!.value).toBeCloseTo(h.aggregate('income', 'sum', { from: h.archive('income')[0]!.index * 15, to: h.archive('income')[0]!.index * 15 + 14 }), 0);
  });
});

describe('observer-only', () => {
  it('the stats module is not part of stateHash and capturing never changes it', () => {
    expect(SAVE_MODULES.find((m) => m.key === 'stats')?.observer).toBe(true);
    const sim = createSim({ size: 64, seed: 21, now: () => 0 });
    expect(Object.keys(stateHash(sim).parts)).not.toContain('stats');
    const before = stateHash(sim).hash;
    sim.stats.captureDay(); sim.stats.captureDay();
    expect(stateHash(sim).hash).toBe(before);
    expect(sim.stats.len).toBe(2);
    expect(sim.stats.at('cash', sim.stats.lastAbs)).toBe(Math.round(sim.game.money * 100) / 100);
  });
});

describe('statsCodec', () => {
  it('round-trips ints (negative, large, delta) compactly', async () => {
    const { encodeInts, decodeInts } = await import('../../../src/sim/meta/statsCodec');
    const v = [0, 1, -1, 63, 64, -65, 12345, -987654, 2 ** 40, 0, 7];
    expect(decodeInts(encodeInts(v), v.length)).toEqual(v);
    expect(decodeInts(encodeInts(v, true), v.length, true)).toEqual(v);
    expect(encodeInts([1, 2, 3, 4]).length).toBeLessThanOrEqual(8); // one byte each
    expect(decodeInts('!!!', 3)).toEqual([0, 0, 0]);
  });
});
