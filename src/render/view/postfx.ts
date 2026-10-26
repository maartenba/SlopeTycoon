/**
 * Photo-mode post effects (M5.2, Task 10). PURE: plain numbers and RGBA byte buffers, no DOM / WebGL, so everything here is unit-tested in node
 * (tests/render/photoMode.test.ts). The live preview uses the CSS equivalents (`filterCss`, `vignetteCss`); the exported PNG runs the same maths
 * on the pixel buffer (`compositeExport`): sky under the transparent WebGL pixels, colour filter, vignette, frame overlay.
 */

export type V3 = [number, number, number];

// ---------------------------------------------------------------- filters (CSS filter() functions = W3C filter-effects matrices)
export type FilterId = 'none' | 'warm' | 'cool' | 'vivid' | 'mono' | 'vintage';
export const FILTER_IDS: readonly FilterId[] = ['none', 'warm', 'cool', 'vivid', 'mono', 'vintage'];
export const FILTER_LABELS: Record<FilterId, string> = { none: 'None', warm: 'Warm', cool: 'Cool', vivid: 'Vivid', mono: 'Mono', vintage: 'Vintage' };

type FilterFn = 'grayscale' | 'sepia' | 'saturate' | 'hue-rotate' | 'brightness' | 'contrast';
export interface FilterOp { fn: FilterFn; v: number }
/** Each filter is a chain of CSS filter functions; the CSS string and the export matrix are both derived from this table (one source of truth). */
export const FILTER_OPS: Record<FilterId, readonly FilterOp[]> = {
  none: [],
  warm: [{ fn: 'sepia', v: 0.22 }, { fn: 'saturate', v: 1.12 }, { fn: 'hue-rotate', v: -6 }, { fn: 'brightness', v: 1.03 }],
  cool: [{ fn: 'sepia', v: 0.25 }, { fn: 'hue-rotate', v: 185 }, { fn: 'saturate', v: 1.1 }, { fn: 'brightness', v: 1.02 }],
  vivid: [{ fn: 'saturate', v: 1.55 }, { fn: 'contrast', v: 1.12 }],
  mono: [{ fn: 'grayscale', v: 1 }, { fn: 'contrast', v: 1.12 }],
  vintage: [{ fn: 'sepia', v: 0.5 }, { fn: 'contrast', v: 0.92 }, { fn: 'brightness', v: 1.06 }, { fn: 'saturate', v: 0.85 }],
};

/** Affine colour transform on 0..1 channels: out = m * rgb + o (row-major 3x3 + offset). */
export interface ColorXform { m: number[]; o: number[] }
export const IDENTITY_XFORM: ColorXform = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: [0, 0, 0] };

export function opXform(op: FilterOp): ColorXform {
  const v = op.v;
  switch (op.fn) {
    case 'grayscale': { const a = 1 - Math.min(1, Math.max(0, v)); return { m: [0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a, 0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a, 0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a], o: [0, 0, 0] }; }
    case 'sepia': { const a = 1 - Math.min(1, Math.max(0, v)); return { m: [0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a, 0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a, 0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a], o: [0, 0, 0] }; }
    case 'saturate': return { m: [0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v, 0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v, 0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v], o: [0, 0, 0] };
    case 'hue-rotate': {
      const r = (v * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
      return { m: [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072], o: [0, 0, 0] };
    }
    case 'brightness': return { m: [v, 0, 0, 0, v, 0, 0, 0, v], o: [0, 0, 0] };
    case 'contrast': return { m: [v, 0, 0, 0, v, 0, 0, 0, v], o: [0.5 - 0.5 * v, 0.5 - 0.5 * v, 0.5 - 0.5 * v] };
  }
}

/** `a` is applied first, then `b`. */
export function composeXform(a: ColorXform, b: ColorXform): ColorXform {
  const m = new Array<number>(9).fill(0), o = [0, 0, 0];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) m[r * 3 + c]! += b.m[r * 3 + k]! * a.m[k * 3 + c]!;
    o[r] = b.m[r * 3]! * a.o[0]! + b.m[r * 3 + 1]! * a.o[1]! + b.m[r * 3 + 2]! * a.o[2]! + b.o[r]!;
  }
  return { m, o };
}

export function filterXform(id: FilterId): ColorXform {
  let x = IDENTITY_XFORM;
  for (const op of FILTER_OPS[id]) x = composeXform(x, opXform(op));
  return x;
}

/** CSS `filter` value for the live preview ('none' for no filter). */
export function filterCss(id: FilterId): string {
  const ops = FILTER_OPS[id];
  if (!ops.length) return 'none';
  return ops.map((o) => `${o.fn}(${o.fn === 'hue-rotate' ? `${o.v}deg` : o.v})`).join(' ');
}

/** In-place colour filter on RGBA bytes (alpha untouched). */
export function applyFilter(data: Uint8ClampedArray, id: FilterId): void {
  if (id === 'none') return;
  const { m, o } = filterXform(id);
  const o0 = o[0]! * 255, o1 = o[1]! * 255, o2 = o[2]! * 255;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    data[i] = m[0]! * r + m[1]! * g + m[2]! * b + o0;
    data[i + 1] = m[3]! * r + m[4]! * g + m[5]! * b + o1;
    data[i + 2] = m[6]! * r + m[7]! * g + m[8]! * b + o2;
  }
}

// ---------------------------------------------------------------- vignette
/** Largest darkening at the corners (strength 1). */
export const VIGNETTE_MAX = 0.8;
const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Brightness multiplier at normalised coordinates (nx, ny in -1..1; the corners are at distance 1). */
export function vignetteFactor(nx: number, ny: number, strength: number): number {
  const r = Math.hypot(nx, ny) / Math.SQRT2;
  return 1 - VIGNETTE_MAX * Math.min(1, Math.max(0, strength)) * smooth(0.35, 1, r);
}
export function applyVignette(data: Uint8ClampedArray, w: number, h: number, strength: number): void {
  if (strength <= 0) return;
  for (let y = 0; y < h; y++) {
    const ny = ((y + 0.5) / h) * 2 - 1;
    for (let x = 0; x < w; x++) {
      const f = vignetteFactor(((x + 0.5) / w) * 2 - 1, ny, strength), i = (y * w + x) * 4;
      data[i] = data[i]! * f; data[i + 1] = data[i + 1]! * f; data[i + 2] = data[i + 2]! * f;
    }
  }
}
/** Live-preview CSS (radial gradient over the frame rect) approximating `vignetteFactor`. */
export function vignetteCss(strength: number): string {
  const a = Math.round(VIGNETTE_MAX * Math.min(1, Math.max(0, strength)) * 100) / 100;
  return a <= 0 ? 'none' : `radial-gradient(ellipse closest-corner at 50% 50%, rgba(0,0,0,0) 40%, rgba(0,0,0,${a}) 100%)`;
}

// ---------------------------------------------------------------- frames
export type FrameId = 'none' | 'thin' | 'polaroid' | 'film' | 'alpine' | 'noir' | 'gold';
export const FRAME_IDS: readonly FrameId[] = ['none', 'thin', 'polaroid', 'film', 'alpine', 'noir', 'gold'];
export const FRAME_LABELS: Record<FrameId, string> = { none: 'None', thin: 'Thin border', polaroid: 'Polaroid', film: 'Film strip', alpine: 'Alpine badge', noir: 'Film noir', gold: 'Gold frame' };
/** Frames that are cosmetic rewards (config/cosmetics.ts `frame:<id>`): locked until the achievement that grants them. */
export const PREMIUM_FRAMES: readonly FrameId[] = ['alpine', 'noir', 'gold'];

/** Four border rects of thickness `t` inset by `g` from the image edge. */
function border(w: number, h: number, g: number, t: number, c: V3): Array<FrameRect & { c: V3 }> {
  return [{ x: g, y: g, w: w - 2 * g, h: t, c }, { x: g, y: h - g - t, w: w - 2 * g, h: t, c }, { x: g, y: g + t, w: t, h: h - 2 * g - 2 * t, c }, { x: w - g - t, y: g + t, w: t, h: h - 2 * g - 2 * t, c }];
}

export interface FrameRect { x: number; y: number; w: number; h: number }
/** The rectangles (px) a frame paints, with their colour. Pure geometry: shared by the export and the tests (the live preview mirrors it in CSS). */
export function frameRects(id: FrameId, w: number, h: number): Array<FrameRect & { c: V3 }> {
  const m = Math.min(w, h), out: Array<FrameRect & { c: V3 }> = [];
  const WHITE: V3 = [250, 250, 248];
  switch (id) {
    case 'none': break;
    case 'thin': {
      const t = Math.max(2, Math.round(m * 0.012)), g = Math.round(m * 0.03);
      out.push({ x: g, y: g, w: w - 2 * g, h: t, c: WHITE }, { x: g, y: h - g - t, w: w - 2 * g, h: t, c: WHITE }, { x: g, y: g + t, w: t, h: h - 2 * g - 2 * t, c: WHITE }, { x: w - g - t, y: g + t, w: t, h: h - 2 * g - 2 * t, c: WHITE });
      break;
    }
    case 'polaroid': {
      const side = Math.round(m * 0.05), bottom = Math.round(m * 0.17), paper: V3 = [246, 242, 232];
      out.push({ x: 0, y: 0, w, h: side, c: paper }, { x: 0, y: h - bottom, w, h: bottom, c: paper }, { x: 0, y: side, w: side, h: h - side - bottom, c: paper }, { x: w - side, y: side, w: side, h: h - side - bottom, c: paper });
      break;
    }
    case 'film': {
      const bar = Math.round(h * 0.1), hole = Math.max(3, Math.round(bar * 0.34)), pitch = Math.round(hole * 2.3), black: V3 = [16, 16, 18], holeC: V3 = [226, 222, 210];
      out.push({ x: 0, y: 0, w, h: bar, c: black }, { x: 0, y: h - bar, w, h: bar, c: black });
      const y0 = Math.round((bar - hole) / 2);
      for (let x = Math.round(pitch / 2); x + hole <= w; x += pitch) out.push({ x, y: y0, w: hole, h: hole, c: holeC }, { x, y: h - bar + y0, w: hole, h: hole, c: holeC });
      break;
    }
    case 'alpine': { // navy border with a cream hairline and a small mountain badge on a cream tab bottom-left
      const NAVY: V3 = [31, 58, 92], CREAM: V3 = [244, 240, 228], t = Math.max(3, Math.round(m * 0.028)), hair = Math.max(1, Math.round(m * 0.004));
      out.push(...border(w, h, 0, t, NAVY), ...border(w, h, t, hair, CREAM));
      const bw = Math.round(m * 0.2), bh = Math.round(m * 0.075), bx = Math.round(m * 0.05), by = h - t - bh;
      out.push({ x: bx, y: by, w: bw, h: bh, c: CREAM }, { x: bx + Math.round(bw * 0.04), y: by + Math.round(bh * 0.08), w: Math.round(bw * 0.92), h: Math.round(bh * 0.84), c: NAVY });
      const u = Math.max(1, Math.round(bh * 0.1)), cx = bx + Math.round(bw * 0.5), base = by + Math.round(bh * 0.84);
      for (let i = 0; i < 4; i++) out.push({ x: cx - (4 - i) * u * 2, y: base - (i + 1) * u * 2 + u, w: (4 - i) * u * 4 - u * 2, h: u * 2, c: CREAM }); // stepped peak
      break;
    }
    case 'noir': { // thick black border with a pale hairline inside
      const BLACK: V3 = [12, 12, 14], PALE: V3 = [216, 216, 212], t = Math.max(4, Math.round(m * 0.05)), hair = Math.max(1, Math.round(m * 0.004));
      out.push(...border(w, h, 0, t, BLACK), ...border(w, h, t, hair, PALE));
      break;
    }
    case 'gold': { // gold band, pale highlight line, darker corner blocks
      const GOLD: V3 = [217, 165, 33], LIGHT: V3 = [255, 241, 184], DARK: V3 = [150, 108, 14], t = Math.max(4, Math.round(m * 0.024)), hair = Math.max(1, Math.round(m * 0.004));
      out.push(...border(w, h, 0, t, GOLD), ...border(w, h, t, hair, LIGHT));
      const c = t * 2;
      out.push({ x: 0, y: 0, w: c, h: c, c: DARK }, { x: w - c, y: 0, w: c, h: c, c: DARK }, { x: 0, y: h - c, w: c, h: c, c: DARK }, { x: w - c, y: h - c, w: c, h: c, c: DARK });
      break;
    }
  }
  return out;
}
export function applyFrame(data: Uint8ClampedArray, w: number, h: number, id: FrameId): void {
  for (const r of frameRects(id, w, h)) {
    const x1 = Math.min(w, r.x + r.w), y1 = Math.min(h, r.y + r.h);
    for (let y = Math.max(0, r.y); y < y1; y++) for (let x = Math.max(0, r.x); x < x1; x++) { const i = (y * w + x) * 4; data[i] = r.c[0]; data[i + 1] = r.c[1]; data[i + 2] = r.c[2]; data[i + 3] = 255; }
  }
}

// ---------------------------------------------------------------- aspect / size
export type AspectId = 'window' | '16:9' | '4:3' | '1:1' | '9:16';
export const ASPECT_IDS: readonly AspectId[] = ['window', '16:9', '4:3', '1:1', '9:16'];
export const ASPECT_LABELS: Record<AspectId, string> = { window: 'Window', '16:9': '16:9', '4:3': '4:3', '1:1': '1:1', '9:16': '9:16' };
export const aspectRatio = (id: AspectId): number | null => (id === 'window' ? null : id === '16:9' ? 16 / 9 : id === '4:3' ? 4 / 3 : id === '1:1' ? 1 : 9 / 16);

/** The framed rectangle (CSS px) inside the window: the whole window for 'window', else the largest centred rect of the aspect with a small margin. */
export function aspectRect(winW: number, winH: number, id: AspectId, margin = 0.04): FrameRect {
  const a = aspectRatio(id);
  if (a === null) return { x: 0, y: 0, w: winW, h: winH };
  const aw = winW * (1 - margin), ah = winH * (1 - margin);
  let w = aw, h = aw / a;
  if (h > ah) { h = ah; w = ah * a; }
  w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
  return { x: Math.round((winW - w) / 2), y: Math.round((winH - h) / 2), w, h };
}
/** Vertical FOV (degrees) that makes a render of a rect of height `rectH` show exactly what that rect shows in a window of height `winH` at `fovDeg`. */
export function cropFov(fovDeg: number, rectH: number, winH: number): number {
  return (2 * Math.atan(Math.tan((fovDeg * Math.PI) / 360) * (rectH / Math.max(1, winH))) * 180) / Math.PI;
}

export const EXPORT_MAX_PIXELS = 16_000_000;
/** Export size for a rect at `scale` (1x = the on-screen pixels, 2x = double): clamped to the GPU's max texture size and a memory budget, preserving the aspect ratio. */
export function clampExportSize(rectW: number, rectH: number, scale: number, maxTex: number, maxPixels = EXPORT_MAX_PIXELS): { w: number; h: number; scale: number; clamped: boolean } {
  let s = Math.max(0.25, scale);
  const want = { w: rectW * s, h: rectH * s };
  const kTex = Math.min(1, maxTex / Math.max(want.w, want.h));
  const kMem = Math.min(1, Math.sqrt(maxPixels / (want.w * want.h)));
  const k = Math.min(kTex, kMem);
  s *= k;
  return { w: Math.max(2, Math.floor(rectW * s)), h: Math.max(2, Math.floor(rectH * s)), scale: s, clamped: k < 0.9999 };
}

// ---------------------------------------------------------------- sky + composite
export interface SkySpec { top: V3; horizon: V3; /** where the horizon colour is reached, 0..1 of the image height */ horizonAt: number }
const to255 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** Sky colour (0..255) at the vertical position t (0 = top .. 1 = bottom), the same linear gradient as `skyCss`: top at 0, horizon colour from `horizonAt` down. */
export function skyAt(sky: SkySpec, t: number, out: V3): V3 {
  const k = Math.min(1, Math.max(0, t) / Math.max(0.05, Math.min(1, sky.horizonAt)));
  for (let i = 0; i < 3; i++) out[i] = to255(sky.top[i]! + (sky.horizon[i]! - sky.top[i]!) * k);
  return out;
}

/**
 * Paints the sky UNDER the (straight-alpha) WebGL pixels: out = src * a + sky * (1 - a), alpha = 255. The renderer's canvas is transparent
 * (the page's CSS gradient shows through), so without this step the PNG would have a transparent sky.
 */
export function paintSkyBehind(data: Uint8ClampedArray, w: number, h: number, sky: SkySpec): void {
  const c: V3 = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    skyAt(sky, (y + 0.5) / h, c);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = data[i + 3]!;
      if (a === 255) continue;
      const k = a / 255;
      data[i] = data[i]! * k + c[0] * (1 - k); data[i + 1] = data[i + 1]! * k + c[1] * (1 - k); data[i + 2] = data[i + 2]! * k + c[2] * (1 - k); data[i + 3] = 255;
    }
  }
}

export interface ExportStyle { sky: SkySpec | null; filter: FilterId; vignette: number; frame: FrameId }
/** The whole export pipeline on an RGBA buffer, in place: sky, colour filter, vignette, frame. Afterwards every pixel is opaque (when `sky` is given). */
export function compositeExport(data: Uint8ClampedArray, w: number, h: number, s: ExportStyle): void {
  if (s.sky) paintSkyBehind(data, w, h, s.sky);
  applyFilter(data, s.filter);
  applyVignette(data, w, h, s.vignette);
  applyFrame(data, w, h, s.frame);
}

/** `slope-tycoon-<resort>-<yyyy-mm-dd>.png` (resort slugified; falls back to 'resort'). */
export function photoFileName(resort: string, when: Date): string {
  const slug = resort.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'resort';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `slope-tycoon-${slug}-${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}.png`;
}
