import { describe, expect, it } from 'vitest';
import { fillDemoStats } from '../../src/sim/meta/demoStats';
import { StatsHistory } from '../../src/sim/meta/StatsHistory';
import { MAX_POINTS, PALETTE, compact, niceAxis, revenueSeries, statsFrame } from '../../src/ui/statsFormat';

const hist = (): StatsHistory => { const h = new StatsHistory(null); fillDemoStats(h, 3); return h; };

describe('statsFormat', () => {
  it('empty history gives no frame', () => {
    expect(statsFrame(new StatsHistory(null), '30d')).toBeNull();
    expect(statsFrame(new StatsHistory(null), 'all')).toBeNull();
  });
  it('ranges: 30 days = 30 daily points; longer ranges are bucketed to <= 36; all = monthly', () => {
    const h = hist();
    expect(statsFrame(h, '30d')!.points.length).toBe(30);
    const y = statsFrame(h, '2y')!;
    expect(y.points.length).toBeLessThanOrEqual(MAX_POINTS); expect(y.points.length).toBeGreaterThan(20);
    expect(y.points[0]!.from).toBe(h.firstAbs); expect(y.points[y.points.length - 1]!.to).toBe(h.lastAbs);
    const a = statsFrame(h, 'all')!;
    expect(a.monthly).toBe(true); expect(a.points.length).toBe(24);
    // bucket sums add up to the plain total
    expect(y.value('income', 'sum').reduce((s, v) => s + v, 0)).toBeCloseTo(h.summary('income').sum, 0);
  });
  it('revenue: top 5 + everything else, largest first, distinct colours, totals preserved', () => {
    const f = statsFrame(hist(), '2y')!, r = revenueSeries(f);
    expect(r.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < Math.min(5, r.length); i++) expect(r[i - 1]!.total).toBeGreaterThanOrEqual(r[i]!.total);
    expect(new Set(r.map((x) => x.color)).size).toBe(r.length);
    expect(r.reduce((s, x) => s + x.total, 0)).toBeCloseTo(f.value('income', 'sum').reduce((s, v) => s + v, 0), 0);
    expect(PALETTE.length).toBeGreaterThanOrEqual(6);
  });
  it('axis helpers', () => {
    const a = niceAxis(0, 97); expect(a.max).toBeGreaterThanOrEqual(97); expect(a.min).toBe(0);
    expect(niceAxis(5, 5).max).toBeGreaterThan(5);
    expect(compact(1234)).toBe('1.2k'); expect(compact(-2_500_000)).toBe('-2.5M'); expect(compact(12)).toBe('12');
  });
});
