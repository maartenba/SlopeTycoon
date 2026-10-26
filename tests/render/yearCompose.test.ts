import { describe, expect, it } from 'vitest';
import { computeYearReport } from '../../src/sim/meta/YearReport';
import { fillDemoStats } from '../../src/sim/meta/demoStats';
import { StatsHistory } from '../../src/sim/meta/StatsHistory';
import { drawOps, layoutYearImage, opaqueCoverage, YEAR_IMAGE_H, YEAR_IMAGE_W, yearImageName, type Draw2D } from '../../src/render/view/yearCompose';

const h = new StatsHistory(null); fillDemoStats(h, 3);
const report = computeYearReport({ hist: h, year: 3, mapSize: 128, name: 'Your resort' });

describe('year image compositor', () => {
  it('lays out a 1200x675 image: an opaque full-size background first, every op inside the canvas', () => {
    for (const cover of [false, true]) {
      const ops = layoutYearImage(report, cover);
      expect(ops[0]).toMatchObject({ t: 'rect', x: 0, y: 0, w: YEAR_IMAGE_W, h: YEAR_IMAGE_H });
      expect(opaqueCoverage(ops, YEAR_IMAGE_W, YEAR_IMAGE_H)).toBe(1); // no transparent pixels anywhere
      for (const o of ops) {
        if (o.t === 'text') { expect(o.x).toBeGreaterThanOrEqual(0); expect(o.x).toBeLessThanOrEqual(YEAR_IMAGE_W); expect(o.y).toBeGreaterThan(0); expect(o.y).toBeLessThanOrEqual(YEAR_IMAGE_H); }
        else if (o.t === 'circle') { expect(o.x - o.r).toBeGreaterThanOrEqual(0); expect(o.x + o.r).toBeLessThanOrEqual(YEAR_IMAGE_W); expect(o.y + o.r).toBeLessThanOrEqual(YEAR_IMAGE_H); }
        else { expect(o.x).toBeGreaterThanOrEqual(0); expect(o.y).toBeGreaterThanOrEqual(0); expect(o.x + o.w).toBeLessThanOrEqual(YEAR_IMAGE_W + 0.5); expect(o.y + o.h).toBeLessThanOrEqual(YEAR_IMAGE_H + 0.5); }
      }
    }
  });
  it('contains the headline, the four stat tiles and one medal per award; no sharing wording', () => {
    const ops = layoutYearImage(report, false), texts = ops.filter((o) => o.t === 'text').map((o) => (o as { text: string }).text);
    expect(texts).toContain(report.headline.title);
    for (const k of ['GUESTS', 'INCOME', 'PROFIT', 'RATING']) expect(texts).toContain(k);
    expect(ops.filter((o) => o.t === 'circle').length).toBe(report.awards.length);
    expect(texts.join(' ')).not.toMatch(/share|link|code/i);
    expect(yearImageName(report)).toBe('slope-tycoon-year-3-report.png');
  });
  it('replays on a 2D surface; the cover is drawn centre-cropped (cover fit)', () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: '', strokeStyle: '', font: '', textAlign: 'left', lineWidth: 1,
      fillRect: (x: number, y: number, w: number, hh: number) => calls.push(`rect ${x},${y},${w},${hh}`), beginPath: () => {}, arc: () => {}, fill: () => {}, stroke: () => {},
      fillText: (t: string) => calls.push(`text ${t}`), createLinearGradient: () => ({ addColorStop: () => {} }),
      drawImage: (...a: number[]) => calls.push(`image ${a.slice(1).map((n) => Math.round(n)).join(',')}`),
    } as unknown as Draw2D;
    drawOps(ctx, layoutYearImage(report, true), { source: {} as CanvasImageSource, width: 480, height: 270 });
    expect(calls[0]).toBe(`rect 0,0,${YEAR_IMAGE_W},${YEAR_IMAGE_H}`);
    const img = calls.find((c) => c.startsWith('image'))!.split(' ')[1]!.split(',').map(Number);
    expect(img[4]).toBe(0); expect(img[6]).toBe(YEAR_IMAGE_W); // dest x / width
    expect(img[2]! / img[3]!).toBeCloseTo(YEAR_IMAGE_W / 400, 1); // source crop has the box's aspect
  });
});
