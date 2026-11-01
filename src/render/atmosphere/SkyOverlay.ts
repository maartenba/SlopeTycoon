import { starField } from './Sky';
import { smoothstep } from './hash';

export interface SkyDecor { stars: number; moonPhase: number; moonAlpha: number; rainbow: number; /** where the horizon sits (0..1 of the height) */ horizonAt: number }
export const NO_DECOR: SkyDecor = { stars: 0, moonPhase: 0, moonAlpha: 0, rainbow: 0, horizonAt: 0.7 };

const STARS = starField(150, 7);
/** Moon placement (share of width / of the sky height) and size (share of min(w, h)). */
export const MOON = { x: 0.78, y: 0.2, r: 0.032 };
/** Rainbow arc: centre below the horizon, band radii (share of the width). */
export const RAINBOW = { cx: 0.34, r0: 0.34, r1: 0.40 };
const BANDS: [number, number, number][] = [[0.9, 0.25, 0.25], [1, 0.62, 0.22], [1, 0.9, 0.35], [0.4, 0.85, 0.4], [0.3, 0.6, 0.95], [0.5, 0.4, 0.85]];

/**
 * Paints stars / moon / rainbow into an RGB sky buffer (0..255, 3 bytes per pixel, row-major): the PNG export of photo mode uses this so the
 * saved picture matches what the screen shows. The live view uses CSS (SkyOverlay) with the same geometry. No-op for an empty decor.
 */
export function paintSkyDecor(buf: Uint8ClampedArray, w: number, h: number, d: SkyDecor): void {
  const hz = Math.max(0.05, d.horizonAt) * h;
  if (d.stars > 0.01) {
    for (const s of STARS) {
      const y = s.y * hz * 0.95, a = d.stars * (0.35 + 0.65 * s.s) * (1 - smoothstep(0.5, 0.95, y / hz));
      const px = Math.floor(s.x * w), py = Math.floor(y);
      const sz = s.s > 0.85 ? 1 : 0;
      for (let dy = 0; dy <= sz; dy++) for (let dx = 0; dx <= sz; dx++) {
        const x = px + dx, yy = py + dy; if (x >= w || yy >= h) continue;
        const i = (yy * w + x) * 3; for (let c = 0; c < 3; c++) buf[i + c] = buf[i + c]! + (255 - buf[i + c]!) * a;
      }
    }
  }
  if (d.moonAlpha > 0.01) {
    const r = MOON.r * Math.min(w, h), cx = MOON.x * w, cy = MOON.y * hz;
    const illum = (1 - Math.cos(d.moonPhase * Math.PI * 2)) / 2, shift = (d.moonPhase < 0.5 ? -1 : 1) * illum * 2 * r;
    for (let y = Math.max(0, Math.floor(cy - r - 1)); y < Math.min(h, Math.ceil(cy + r + 1)); y++) for (let x = Math.max(0, Math.floor(cx - r - 1)); x < Math.min(w, Math.ceil(cx + r + 1)); x++) {
      const inDisc = Math.hypot(x - cx, y - cy) <= r, shaded = Math.hypot(x - cx - shift, y - cy) <= r;
      if (!inDisc || shaded) continue;
      const i = (y * w + x) * 3, a = d.moonAlpha * 0.95;
      buf[i] = buf[i]! + (244 - buf[i]!) * a; buf[i + 1] = buf[i + 1]! + (240 - buf[i + 1]!) * a; buf[i + 2] = buf[i + 2]! + (214 - buf[i + 2]!) * a;
    }
  }
  if (d.rainbow > 0.01) {
    const cx = RAINBOW.cx * w, cy = hz + 0.1 * w, r0 = RAINBOW.r0 * w, r1 = RAINBOW.r1 * w;
    for (let y = 0; y < Math.min(h, Math.ceil(hz)); y++) for (let x = 0; x < w; x++) {
      const rr = Math.hypot(x - cx, y - cy);
      if (rr < r0 || rr >= r1) continue;
      const k = (rr - r0) / (r1 - r0), band = BANDS[Math.min(5, Math.floor(k * 6))]!;
      const a = d.rainbow * 0.32 * Math.sin(Math.PI * k) * (1 - smoothstep(hz - 0.25 * h, hz, y) * 0.8);
      const i = (y * w + x) * 3; for (let c = 0; c < 3; c++) buf[i + c] = buf[i + c]! + (band[c]! * 255 - buf[i + c]!) * a;
    }
  }
}

/** Live sky decor: ONE absolutely positioned layer (z -1 inside the isolated #app: above the CSS gradient, below the WebGL canvas), pointer-events none. */
export class SkyOverlay {
  readonly el: HTMLDivElement;
  private stars: HTMLCanvasElement; private moon: HTMLDivElement; private shade: HTMLDivElement; private bow: HTMLDivElement;
  private sw = 0; private sh = 0; private last = '';
  constructor(private parent: HTMLElement) {
    const d = parent.ownerDocument;
    this.el = d.createElement('div'); this.el.className = 'atm-sky'; this.el.setAttribute('aria-hidden', 'true');
    this.el.style.cssText = 'position:absolute;inset:0;z-index:-1;pointer-events:none;overflow:hidden;';
    this.stars = d.createElement('canvas'); this.stars.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0;';
    this.moon = d.createElement('div'); this.moon.style.cssText = 'position:absolute;border-radius:50%;overflow:hidden;background:#f4f0d6;opacity:0;box-shadow:0 0 18px 4px rgba(244,240,214,.28);';
    this.shade = d.createElement('div'); this.shade.style.cssText = 'position:absolute;border-radius:50%;background:#0b1430;';
    this.moon.append(this.shade);
    this.bow = d.createElement('div'); this.bow.style.cssText = 'position:absolute;opacity:0;border-radius:50%;';
    this.el.append(this.stars, this.moon, this.bow);
    parent.style.isolation = 'isolate';
    parent.insertBefore(this.el, parent.firstChild);
  }
  private drawStars(w: number, h: number): void {
    this.stars.width = w; this.stars.height = h;
    const g = this.stars.getContext('2d'); if (!g) return;
    g.clearRect(0, 0, w, h);
    for (const s of STARS) { g.fillStyle = `rgba(255,255,255,${0.35 + 0.65 * s.s})`; const sz = s.s > 0.85 ? 2 : 1; g.fillRect(Math.floor(s.x * w), Math.floor(s.y * h * 0.95), sz, sz); }
  }
  /** `skyColor` (sRGB css) paints the unlit part of the moon so the crescent blends with the sky. */
  update(d: SkyDecor, skyColor: string): void {
    const key = `${d.stars.toFixed(2)}|${d.moonPhase.toFixed(3)}|${d.moonAlpha.toFixed(2)}|${d.rainbow.toFixed(2)}|${d.horizonAt.toFixed(3)}|${skyColor}`;
    if (key === this.last) return; this.last = key;
    const w = this.parent.clientWidth || window.innerWidth, h = this.parent.clientHeight || window.innerHeight;
    const hz = Math.max(0.05, d.horizonAt) * h;
    if (w !== this.sw || h !== this.sh) { this.sw = w; this.sh = h; this.drawStars(w, Math.max(2, Math.round(hz))); }
    this.stars.style.height = `${hz}px`; this.stars.style.bottom = 'auto';
    this.stars.style.opacity = String(d.stars);
    this.stars.style.webkitMaskImage = this.stars.style.maskImage = 'linear-gradient(180deg,#000 55%,transparent 98%)';
    const r = MOON.r * Math.min(w, h), illum = (1 - Math.cos(d.moonPhase * Math.PI * 2)) / 2, shift = (d.moonPhase < 0.5 ? -1 : 1) * illum * 2 * r;
    Object.assign(this.moon.style, { width: `${2 * r}px`, height: `${2 * r}px`, left: `${MOON.x * w - r}px`, top: `${MOON.y * hz - r}px`, opacity: String(d.moonAlpha) });
    Object.assign(this.shade.style, { width: `${2 * r}px`, height: `${2 * r}px`, left: `${shift}px`, top: '0', background: skyColor });
    const R1 = RAINBOW.r1 * w, R0 = RAINBOW.r0 * w, cx = RAINBOW.cx * w, cy = hz + 0.1 * w;
    const stops = BANDS.map((b, i) => { const c = `rgba(${Math.round(b[0] * 255)},${Math.round(b[1] * 255)},${Math.round(b[2] * 255)},.32)`; const a = (R0 + ((R1 - R0) * i) / 6).toFixed(1), z = (R0 + ((R1 - R0) * (i + 1)) / 6).toFixed(1); return `${c} ${a}px, ${c} ${z}px`; }).join(',');
    Object.assign(this.bow.style, { left: `${cx - R1}px`, top: `${cy - R1}px`, width: `${2 * R1}px`, height: `${2 * R1}px`, opacity: String(d.rainbow), background: `radial-gradient(circle at 50% 50%, transparent ${R0.toFixed(1)}px, ${stops}, transparent ${R1.toFixed(1)}px)`, webkitMaskImage: `linear-gradient(180deg,#000 ${((hz - (cy - R1)) / (2 * R1) * 100 - 10).toFixed(1)}%,transparent ${((hz - (cy - R1)) / (2 * R1) * 100).toFixed(1)}%)` });
  }
  dispose(): void { this.el.remove(); }
}
