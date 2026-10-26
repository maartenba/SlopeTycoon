import { StElement } from './StElement';

/**
 * Pulsing highlight ring (plus a ▼ arrow) around a DOM element, e.g. a dock button or a drawer card. It NEVER intercepts input:
 * the host and every child have `pointer-events:none` (regression of the full-screen help overlay that blocked all clicks), the host is
 * zero-sized (no full-screen box at all) and dimming, when enabled, is only a huge box-shadow on the ring.
 */
export const SPOTLIGHT_CSS =
  ':host{position:fixed;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;display:block}' +
  '.ring{position:fixed;box-sizing:border-box;pointer-events:none;border:3px solid #ffd23f;border-radius:8px;box-shadow:0 0 0 3px rgba(255,210,63,.35),0 0 14px 4px rgba(255,210,63,.55);animation:pulse 1.3s ease-in-out infinite;z-index:30}' +
  '.ring.dim{box-shadow:0 0 0 3px rgba(255,210,63,.35),0 0 0 100vmax rgba(0,0,0,.35)}' +
  '.arrow{position:fixed;pointer-events:none;color:#ffd23f;font-size:20px;line-height:1;text-shadow:0 1px 3px #000;transform:translateX(-50%);animation:bob 1s ease-in-out infinite;z-index:30}' +
  '@keyframes pulse{50%{box-shadow:0 0 0 7px rgba(255,210,63,.2),0 0 22px 6px rgba(255,210,63,.8)}}' +
  '@keyframes bob{50%{margin-top:-6px}}' +
  '@media (prefers-reduced-motion: reduce){.ring,.arrow{animation:none}}';

export interface SpotlightApi {
  /** Resolve a logical target chain to the element to highlight (see tutorial/ui-targets.ts). */
  resolve(chain: readonly string[]): Element | null;
}

export class StSpotlight extends StElement {
  private readonly ring = document.createElement('div');
  private readonly arrow = document.createElement('div');
  private api: SpotlightApi | null = null;
  private chain: readonly string[] | null = null;
  private raf = 0;
  private lastRun = 0;
  private lastKey = '';
  private resizeHandler = (): void => this.tick(true);

  protected css(): string { return SPOTLIGHT_CSS; }

  constructor() {
    super();
    this.ring.className = 'ring';
    this.arrow.className = 'arrow';
    this.arrow.textContent = '▼';
    for (const e of [this.ring, this.arrow]) { e.style.pointerEvents = 'none'; e.hidden = true; }
    this.root.append(this.ring, this.arrow);
  }

  bind(api: SpotlightApi): void { this.api = api; }

  connectedCallback(): void {
    this.style.pointerEvents = 'none'; // beats the `#ui > * { pointer-events:auto }` outer rule
    window.addEventListener('resize', this.resizeHandler);
    this.track(() => window.removeEventListener('resize', this.resizeHandler));
    if (this.chain) this.loop();
  }

  disconnectedCallback(): void { super.disconnectedCallback(); this.stopLoop(); }

  /** Dim the rest of the screen with a box-shadow on the ring only (never an event-catching layer). */
  set dim(v: boolean) { this.ring.classList.toggle('dim', v); }

  /** Highlight a target chain (null clears). */
  setTarget(chain: readonly string[] | null): void {
    this.chain = chain && chain.length ? chain : null;
    this.lastKey = '';
    if (!this.chain) { this.hideAll(); this.stopLoop(); return; }
    this.tick(true);
    if (this.isConnected) this.loop();
  }

  get active(): boolean { return this.chain !== null; }
  get visible(): boolean { return !this.ring.hidden; }

  /** Re-read the target's bounding rect (rAF-throttled to ~10 Hz while a target is set; `force` skips the throttle). */
  tick(force = false): void {
    if (!this.chain || !this.api) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - this.lastRun < 100) return;
    this.lastRun = now;
    const el = this.api.resolve(this.chain);
    if (!el) { this.hideAll(); return; }
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) { this.hideAll(); return; }
    const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
    if (key === this.lastKey && !this.ring.hidden) return;
    this.lastKey = key;
    const pad = 4;
    const s = this.ring.style;
    s.left = `${Math.round(r.left - pad)}px`; s.top = `${Math.round(r.top - pad)}px`;
    s.width = `${Math.round(r.width + pad * 2)}px`; s.height = `${Math.round(r.height + pad * 2)}px`;
    this.arrow.style.left = `${Math.round(r.left + r.width / 2)}px`;
    this.arrow.style.top = `${Math.max(0, Math.round(r.top - pad - 26))}px`;
    this.ring.hidden = false; this.arrow.hidden = false;
  }

  private hideAll(): void { this.ring.hidden = true; this.arrow.hidden = true; this.lastKey = ''; }

  private loop(): void {
    if (this.raf) return;
    const step = (): void => { this.raf = 0; if (!this.chain || !this.isConnected) return; this.tick(); this.raf = requestAnimationFrame(step); };
    this.raf = requestAnimationFrame(step);
  }
  private stopLoop(): void { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }
}
