import { MEDAL_COLORS, statTiles } from '../../ui/yearReportFormat';
import type { YearReport } from '../../sim/meta/YearReport';

/**
 * Local "Save image" compositor for the year report (M5.3, D8: a plain PNG download, nothing is shared or uploaded).
 * `layoutYearImage` is pure (a list of draw ops, unit-tested); `drawOps` replays them on a 2D context.
 */
export const YEAR_IMAGE_W = 1200, YEAR_IMAGE_H = 675;
const COVER_H = 400;

export type DrawOp =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | { t: 'gradient'; x: number; y: number; w: number; h: number; stops: ReadonlyArray<readonly [number, string]> }
  | { t: 'circle'; x: number; y: number; r: number; fill: string; stroke?: string }
  | { t: 'text'; x: number; y: number; text: string; font: string; fill: string; align?: 'left' | 'center' | 'right'; maxW?: number }
  /** The cover image, scaled to cover the box (centre crop). */
  | { t: 'cover'; x: number; y: number; w: number; h: number };

/** `cover` false = no photo: the sky gradient with a mountain silhouette is drawn instead. */
export function layoutYearImage(r: YearReport, hasCover: boolean, w = YEAR_IMAGE_W, h = YEAR_IMAGE_H): DrawOp[] {
  const ops: DrawOp[] = [{ t: 'rect', x: 0, y: 0, w, h, fill: '#141c28' }];
  const ch = Math.round((COVER_H * h) / YEAR_IMAGE_H);
  if (hasCover) ops.push({ t: 'cover', x: 0, y: 0, w, h: ch });
  else {
    ops.push({ t: 'gradient', x: 0, y: 0, w, h: ch, stops: [[0, '#2c5c94'], [0.7, '#9cc4e6'], [1, '#e8f1fa']] });
    ops.push({ t: 'text', x: w / 2, y: ch * 0.52, text: '▲', font: `${Math.round(ch * 0.5)}px sans-serif`, fill: '#ffffff', align: 'center' });
  }
  ops.push({ t: 'gradient', x: 0, y: Math.round(ch * 0.45), w, h: Math.round(ch * 0.55), stops: [[0, 'rgba(10,16,24,0)'], [1, 'rgba(10,16,24,0.86)']] });
  ops.push({ t: 'text', x: 48, y: ch - 78, text: r.headline.title, font: '800 54px sans-serif', fill: '#ffe29a', maxW: w - 96 });
  ops.push({ t: 'text', x: 48, y: ch - 32, text: `Year ${r.year} · ${r.name}`, font: '600 26px sans-serif', fill: '#e6edf6', maxW: w - 96 });
  // stat tiles
  const tiles = statTiles(r), tw = (w - 96 - 3 * 16) / 4, ty = ch + 26;
  tiles.forEach((t, i) => {
    const x = 48 + i * (tw + 16);
    ops.push({ t: 'rect', x, y: ty, w: tw, h: 92, fill: '#223046' });
    ops.push({ t: 'text', x: x + 16, y: ty + 30, text: t.label.toUpperCase(), font: '700 16px sans-serif', fill: '#9fb4cc' });
    ops.push({ t: 'text', x: x + 16, y: ty + 70, text: t.value, font: '800 36px sans-serif', fill: t.tone === 'good' ? '#7fd68a' : t.tone === 'bad' ? '#ff9a8a' : '#ffffff', maxW: tw - 32 });
  });
  // medals
  const my = ty + 92 + 52, earned = r.awards.filter((a) => a.tier > 0);
  const slot = (w - 96) / Math.max(1, Math.min(9, r.awards.length));
  r.awards.slice(0, 9).forEach((a, i) => {
    const cx = 48 + slot * i + slot / 2, c = MEDAL_COLORS[a.tier];
    ops.push({ t: 'circle', x: cx, y: my, r: 22, fill: c.fill, stroke: c.rim });
    ops.push({ t: 'text', x: cx, y: my + 52, text: a.name, font: '600 14px sans-serif', fill: a.tier > 0 ? '#e6edf6' : '#6f8099', align: 'center', maxW: slot - 8 });
  });
  void earned;
  ops.push({ t: 'text', x: w - 48, y: h - 14, text: 'Slope Tycoon', font: '700 16px sans-serif', fill: '#6f8099', align: 'right' });
  return ops;
}

/** Minimal 2D surface used by `drawOps` (a CanvasRenderingContext2D satisfies it; tests pass a recorder). */
export interface Draw2D {
  fillStyle: string | CanvasGradient | CanvasPattern; strokeStyle: string | CanvasGradient | CanvasPattern; font: string; textAlign: CanvasTextAlign; lineWidth: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void; arc(x: number, y: number, r: number, a0: number, a1: number): void; fill(): void; stroke(): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(o: number, c: string): void };
  drawImage(img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
}
export interface CoverImage { source: CanvasImageSource; width: number; height: number }

export function drawOps(ctx: Draw2D, ops: readonly DrawOp[], cover: CoverImage | null): void {
  for (const o of ops) {
    if (o.t === 'rect') { ctx.fillStyle = o.fill; ctx.fillRect(o.x, o.y, o.w, o.h); }
    else if (o.t === 'gradient') { const g = ctx.createLinearGradient(0, o.y, 0, o.y + o.h); for (const [p, c] of o.stops) g.addColorStop(p, c); ctx.fillStyle = g as unknown as CanvasGradient; ctx.fillRect(o.x, o.y, o.w, o.h); }
    else if (o.t === 'circle') { ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fillStyle = o.fill; ctx.fill(); if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = 3; ctx.stroke(); } }
    else if (o.t === 'text') { ctx.font = o.font; ctx.fillStyle = o.fill; ctx.textAlign = o.align ?? 'left'; if (o.maxW) ctx.fillText(o.text, o.x, o.y, o.maxW); else ctx.fillText(o.text, o.x, o.y); }
    else if (cover) {
      const k = Math.max(o.w / cover.width, o.h / cover.height), sw = o.w / k, sh = o.h / k;
      ctx.drawImage(cover.source, (cover.width - sw) / 2, (cover.height - sh) / 2, sw, sh, o.x, o.y, o.w, o.h);
    }
  }
}

/** Software check used by tests: the fraction of pixels in [0,w)x[0,h) covered by an opaque rect/gradient/cover op. */
export function opaqueCoverage(ops: readonly DrawOp[], w: number, h: number): number {
  const a = new Uint8Array(w * h);
  for (const o of ops) {
    if (o.t === 'rect' && o.fill.startsWith('#') || o.t === 'cover' || (o.t === 'gradient' && o.stops.every((s) => !s[1].startsWith('rgba(') || s[1].endsWith(',1)')))) {
      for (let y = Math.max(0, Math.floor(o.y)); y < Math.min(h, Math.ceil(o.y + o.h)); y++) for (let x = Math.max(0, Math.floor(o.x)); x < Math.min(w, Math.ceil(o.x + o.w)); x++) a[y * w + x] = 1;
    }
  }
  let n = 0; for (const v of a) n += v;
  return n / (w * h);
}

/** Draw the whole image to a new canvas (browser only). */
export function composeYearCanvas(r: YearReport, cover: CoverImage | null): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = YEAR_IMAGE_W; c.height = YEAR_IMAGE_H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  drawOps(ctx as unknown as Draw2D, layoutYearImage(r, !!cover), cover);
  return c;
}
export const yearImageName = (r: YearReport): string => `slope-tycoon-year-${r.year}-report.png`;
