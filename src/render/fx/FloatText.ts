import type { FeedbackPolicy } from './feedbackPolicy';

interface Item { el: HTMLElement; x: number; y: number; z: number; age: number; life: number }

/**
 * Small muted "+$1,200" labels that rise and fade over ~1 s. A DOM overlay (pointer-events none, no WebGL draw calls at all); positions
 * come from a world -> screen projector, and the text size follows the zoom a little (clamped 10..14 px) so far views stay calm.
 */
export class FloatText {
  readonly layer: HTMLElement;
  private items: Item[] = [];
  private pool: HTMLElement[] = [];
  /** world (x, y, z) -> screen px (x, y) + zoom factor; null when off screen. */
  project: ((x: number, y: number, z: number) => { x: number; y: number; scale: number } | null) | null = null;
  constructor(parent: HTMLElement = document.body) {
    this.layer = document.createElement('div');
    this.layer.setAttribute('aria-hidden', 'true');
    this.layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:21';
    parent.appendChild(this.layer);
  }
  get count(): number { return this.items.length; }
  /** Add one label; ignored once `policy.maxPopups` are alive. Returns true when shown. */
  spawn(text: string, wx: number, wy: number, wz: number, p: FeedbackPolicy): boolean {
    if (this.items.length >= p.maxPopups) return false;
    const el = this.pool.pop() ?? document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;font:700 12px var(--font-ui,Nunito,sans-serif);color:#d9e8cc;background:rgba(28,42,56,.62);padding:1px 6px;border-radius:9px;opacity:0;will-change:transform,opacity';
    this.layer.appendChild(el);
    this.items.push({ el, x: wx, y: wy, z: wz, age: 0, life: p.popupLifeS });
    return true;
  }
  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      it.age += dt;
      const t = it.age / it.life;
      if (t >= 1) { it.el.remove(); this.pool.push(it.el); this.items.splice(i, 1); continue; }
      const s = this.project?.(it.x, it.y, it.z);
      if (!s) { it.el.style.opacity = '0'; continue; }
      const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      const size = Math.min(14, Math.max(10, 11 * s.scale));
      it.el.style.fontSize = `${size}px`;
      it.el.style.opacity = String(Math.max(0, Math.min(0.95, fade * 1.1)));
      it.el.style.transform = `translate(${Math.round(s.x)}px,${Math.round(s.y - 6 - t * 22)}px) translate(-50%,-100%)`;
    }
  }
  clear(): void { for (const it of this.items) { it.el.remove(); this.pool.push(it.el); } this.items.length = 0; }
  dispose(): void { this.clear(); this.layer.remove(); }
}
