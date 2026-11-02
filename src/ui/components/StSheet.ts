import { StElement } from './StElement';

export type SheetSnap = 'peek' | 'half' | 'full';
export const SHEET_SNAPS: readonly SheetSnap[] = ['peek', 'half', 'full'];
export const SHEET_KEY_PREFIX = 'slope.sheet.';
/** Default media query that turns the passthrough wrapper into a real sheet: portrait phones (<= 520 px wide) and short landscape screens (<= 520 px high). */
export const SHEET_MEDIA = '(max-width: 520px), (max-height: 520px)';
/** Short landscape screens get a side sheet on the right instead of a bottom sheet. */
export const SHEET_SIDE_MEDIA = '(max-height: 520px) and (min-aspect-ratio: 1/1)';

/** Pure: the snap a release lands on. `h` = current size, `v` = velocity in px/ms along the growing direction (> 0 = expanding), `snaps` = size per snap. A fling (|v| > 0.5 px/ms) moves one snap in its direction, otherwise the nearest snap to the projected size wins. */
export function resolveSnap(h: number, v: number, snaps: Record<SheetSnap, number>, from: SheetSnap): SheetSnap {
  const i = SHEET_SNAPS.indexOf(from);
  if (Math.abs(v) > 0.5) {
    const j = Math.max(0, Math.min(2, i + (v > 0 ? 1 : -1)));
    // a fling that started past the next snap may skip one
    const target = SHEET_SNAPS[j]!;
    if (v > 0 && h >= snaps[target]! && j < 2) return SHEET_SNAPS[j + 1]!;
    if (v < 0 && h <= snaps[target]! && j > 0) return SHEET_SNAPS[j - 1]!;
    return target;
  }
  const p = h + v * 120;
  let best: SheetSnap = 'peek', d = Infinity;
  for (const s of SHEET_SNAPS) { const dd = Math.abs(snaps[s] - p); if (dd < d) { d = dd; best = s; } }
  return best;
}

const css = `
:host{display:contents}
.sheet{display:contents}
.sheet.on{position:fixed;z-index:100;display:flex;flex-direction:column;box-sizing:border-box;left:max(0px,env(safe-area-inset-left,0px));right:max(0px,env(safe-area-inset-right,0px));bottom:var(--sheet-bottom,0px);overflow:hidden;pointer-events:auto;background:rgba(18,26,38,.97);border:1px solid rgba(90,112,144,.5);border-bottom:0;border-radius:14px 14px 0 0;box-shadow:0 -4px 18px rgba(0,0,0,.45);transition:height .2s ease,width .2s ease;max-height:calc(100% - var(--sheet-top,56px) - var(--sheet-bottom,0px))}
.sheet.on.drag{transition:none}
.sheet.on.side{left:auto;right:max(0px,env(safe-area-inset-right,0px));top:var(--sheet-top,56px);bottom:var(--sheet-bottom,0px);max-height:none;border-radius:14px 0 0 14px;border:1px solid rgba(90,112,144,.5);border-right:0;flex-direction:row}
.handle{display:none}
.sheet.on .handle{display:flex;flex:none;align-items:center;justify-content:center;height:44px;min-height:44px;width:100%;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;background:transparent;border:0;border-radius:0;padding:0;color:inherit}
.sheet.on .handle:active:not(:disabled){transform:none}
.sheet.on .handle::before{content:"";width:44px;height:5px;border-radius:3px;background:#7f93ad}
.sheet.on .handle:hover:not(:disabled)::before,.sheet.on .handle:focus-visible::before{background:#ffd070}
.sheet.on.side .handle{height:100%;width:44px;min-width:44px;min-height:0}
.sheet.on.side .handle::before{width:5px;height:44px}
.sheet.on .title{position:absolute;left:12px;top:0;height:44px;display:flex;align-items:center;font-weight:800;font-size:13px;color:#ffd070;pointer-events:none;max-width:calc(100% - 120px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sheet.on.side .title{display:none}
.title{display:none}
.content{display:contents}
.sheet.on .content{display:block;flex:1 1 auto;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:0 8px max(8px,env(safe-area-inset-bottom,0px))}
.sheet.on.side .content{padding:8px max(8px,env(safe-area-inset-right,0px)) 8px 0}
@media (prefers-reduced-motion:reduce){.sheet.on{transition:none}}
`;

/** Bottom sheet (docs/ui-kit.md, docs/mobile-ui.md). `<st-sheet key="drawer" label="Buildings">...children...</st-sheet>`.
 *  Attributes: `label` (aria-label + title), `key` (remembers the snap in localStorage `slope.sheet.<key>`), `snap` (peek | half | full), `peek-h` (px, default 132), `media` (default SHEET_MEDIA; `all` = always a sheet), `side-media` (default SHEET_SIDE_MEDIA).
 *  When `media` does not match the element is a pure passthrough (`display: contents`, no handle, no ARIA): the desktop layout is untouched.
 *  Fixed layer inside the shadow root, never a full-size child; the host never takes pointer events, only the sheet does (the map stays interactive beside / above it). Event `st-sheet-snap` (detail `{ snap, size }`). */
export class StSheet extends StElement {
  static readonly observedAttributes = ['snap', 'label', 'media', 'peek-h'];
  private sheet = document.createElement('div');
  private handle = document.createElement('button');
  private titleEl = document.createElement('div');
  private contentEl = document.createElement('div');
  private _snap: SheetSnap = 'peek';
  private on = false;
  private side = false;
  private mqs: MediaQueryList[] = [];
  private dragging: { id: number; start: number; startSize: number; from: SheetSnap; last: Array<[number, number]> } | null = null;
  private touchOwn: { x: number; y: number; mode: 'undecided' | 'sheet' | 'native'; startSize: number; from: SheetSnap; last: Array<[number, number]>; scroller: HTMLElement | null } | null = null;
  private onResize = (): void => this.refresh();

  protected css(): string { return css; }

  constructor() {
    super();
    this.sheet.className = 'sheet';
    this.handle.className = 'handle';
    this.handle.type = 'button';
    this.titleEl.className = 'title';
    this.contentEl.className = 'content';
    this.contentEl.append(document.createElement('slot'));
    this.sheet.append(this.handle, this.titleEl, this.contentEl);
    this.root.appendChild(this.sheet);
    this.handle.addEventListener('pointerdown', (e) => this.dragStart(e));
    this.handle.addEventListener('pointermove', (e) => this.dragMove(e));
    this.handle.addEventListener('pointerup', (e) => this.dragEnd(e));
    this.handle.addEventListener('pointercancel', (e) => this.dragEnd(e, true));
    this.handle.addEventListener('keydown', (e) => this.onHandleKey(e));
    this.handle.addEventListener('click', (e) => { if (e.detail > 1 || (e as PointerEvent).pointerType === 'keyboard') return; /* a plain tap on the grabber toggles peek <-> half */ if (this.justDragged) { this.justDragged = false; return; } this.setSnap(this._snap === 'peek' ? 'half' : 'peek'); });
    this.sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.on && this._snap !== 'peek') { this.cycle(-1); e.stopPropagation(); e.preventDefault(); } });
    this.contentEl.addEventListener('touchstart', (e) => this.touchStart(e), { passive: true });
    this.contentEl.addEventListener('touchmove', (e) => this.touchMove(e), { passive: false });
    this.contentEl.addEventListener('touchend', () => this.touchEnd());
    this.contentEl.addEventListener('touchcancel', () => this.touchEnd());
  }
  private justDragged = false;

  connectedCallback(): void {
    const k = this.getAttribute('key');
    const saved = k ? this.readSaved(k) : null;
    const attr = this.getAttribute('snap') as SheetSnap | null;
    this._snap = saved ?? (attr && SHEET_SNAPS.includes(attr) ? attr : 'peek');
    this.bindMedia();
    window.addEventListener('resize', this.onResize);
    this.track(() => window.removeEventListener('resize', this.onResize));
    this.refresh();
  }

  attributeChangedCallback(name: string, _old: string | null, val: string | null): void {
    if (!this.isConnected) return;
    if (name === 'snap' && val && SHEET_SNAPS.includes(val as SheetSnap)) this.setSnap(val as SheetSnap, false);
    else if (name === 'media') { this.bindMedia(); this.refresh(); } else this.refresh();
  }

  private mediaQuery(attr: string, def: string): boolean {
    const q = this.getAttribute(attr) ?? def;
    if (q === 'all' || q === 'always') return true;
    if (q === 'never') return false;
    return typeof matchMedia === 'function' ? matchMedia(q).matches : false;
  }
  private bindMedia(): void {
    this.mqs = [];
    if (typeof matchMedia !== 'function') return;
    for (const [a, d] of [['media', SHEET_MEDIA], ['side-media', SHEET_SIDE_MEDIA]] as const) {
      const q = this.getAttribute(a) ?? d;
      if (q === 'all' || q === 'always' || q === 'never') continue;
      const m = matchMedia(q);
      m.addEventListener?.('change', this.onResize);
      this.mqs.push(m);
      this.track(() => m.removeEventListener?.('change', this.onResize));
    }
  }

  /** True while the sheet behaviour is on (the media query matches). */
  get active(): boolean { return this.on; }
  get snap(): SheetSnap { return this._snap; }
  set snap(s: SheetSnap) { this.setSnap(s); }
  get isSide(): boolean { return this.side; }
  /** Current size in px (height in a bottom sheet, width in a side sheet) for a snap. */
  size(s: SheetSnap = this._snap): number { return this.snapSizes()[s]; }

  private snapSizes(): Record<SheetSnap, number> {
    const ph = Number(this.getAttribute('peek-h')) || 132;
    if (this.side) { // a side sheet: `peek-h` <= 60 asks for just the grabber (a tool is active), anything else for a narrow column of cards
      const w = window.innerWidth || 800;
      const half = Math.round(Math.min(380, w * 0.45)), peek = ph <= 60 ? 44 : Math.min(230, Math.round(w * 0.28), half - 40);
      return { peek, half, full: Math.round(Math.min(560, w * 0.62)) };
    }
    const h = window.innerHeight || 700;
    const half = Math.max(ph + 60, Math.round(h * 0.4)), full = Math.max(half + 60, h - 76);
    return { peek: ph, half, full };
  }

  /** Switch to another remembered sheet (e.g. another dock drawer): the saved snap of that key, else `fallback`. */
  setKey(key: string | null, fallback: SheetSnap = 'peek'): void {
    if (key) this.setAttribute('key', key); else this.removeAttribute('key');
    this.setSnap((key ? this.readSaved(key) : null) ?? fallback, false);
  }

  setSnap(s: SheetSnap, remember = true): void {
    if (!SHEET_SNAPS.includes(s)) return;
    const changed = s !== this._snap;
    this._snap = s;
    if (remember) this.save();
    this.apply();
    if (changed) this.dispatchEvent(new CustomEvent('st-sheet-snap', { detail: { snap: s, size: this.size(s) }, bubbles: true, composed: true }));
  }
  /** One step up (+1) or down (-1) the snap list, without wrapping. */
  cycle(dir: 1 | -1): void { this.setSnap(SHEET_SNAPS[Math.max(0, Math.min(2, SHEET_SNAPS.indexOf(this._snap) + dir))]!); }
  /** Step down to the peek state (cards chosen, a tool became active). */
  collapse(): void { this.setSnap('peek'); }
  expand(): void { this.setSnap('half'); }

  private storageKey(k: string): string { return SHEET_KEY_PREFIX + k; }
  private readSaved(k: string): SheetSnap | null { try { const v = localStorage.getItem(this.storageKey(k)); return v && SHEET_SNAPS.includes(v as SheetSnap) ? v as SheetSnap : null; } catch { return null; } }
  private save(): void { const k = this.getAttribute('key'); if (!k) return; try { localStorage.setItem(this.storageKey(k), this._snap); } catch { /* private mode */ } }

  private refresh(): void {
    this.on = this.mediaQuery('media', SHEET_MEDIA);
    this.side = this.on && this.mediaQuery('side-media', SHEET_SIDE_MEDIA);
    this.apply();
  }

  private apply(): void {
    const s = this.sheet, label = this.getAttribute('label') ?? '';
    s.classList.toggle('on', this.on);
    s.classList.toggle('side', this.side);
    this.toggleAttribute('data-sheet', this.on); // styling hooks for the content's owner (a slotted child cannot see the shadow classes)
    this.toggleAttribute('data-side', this.side);
    if (!this.on) {
      s.removeAttribute('role'); s.removeAttribute('aria-label'); s.removeAttribute('data-snap'); s.style.removeProperty('height'); s.style.removeProperty('width');
      this.handle.removeAttribute('aria-expanded'); this.handle.removeAttribute('aria-label'); this.handle.tabIndex = -1; this.handle.hidden = true;
      return;
    }
    this.handle.hidden = false; this.handle.tabIndex = 0;
    s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'false');
    if (label) s.setAttribute('aria-label', label); else s.removeAttribute('aria-label');
    s.dataset.snap = this._snap;
    this.handle.setAttribute('aria-expanded', String(this._snap !== 'peek'));
    this.handle.setAttribute('aria-label', label ? `Resize ${label}` : 'Resize panel');
    this.handle.title = 'Drag, or press the arrow keys, to resize';
    this.titleEl.textContent = label;
    const px = `${this.dragging || this.touchOwn?.mode === 'sheet' ? this.liveSize : this.size()}px`;
    if (this.side) { s.style.width = px; s.style.removeProperty('height'); } else { s.style.height = px; s.style.removeProperty('width'); }
  }

  // ---- drag (handle: pointer events, mouse / touch / pen) ----
  private liveSize = 0;
  private axis(e: { clientX: number; clientY: number }): number { return this.side ? -e.clientX : -e.clientY; } // grows when the finger moves up (bottom) / left (side)
  private applyLive(size: number): void {
    const sz = this.snapSizes();
    this.liveSize = Math.max(sz.peek * 0.6, Math.min(sz.full, size));
    this.sheet.style[this.side ? 'width' : 'height'] = `${this.liveSize}px`;
  }
  private dragStart(e: PointerEvent): void {
    if (!this.on || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.dragging = { id: e.pointerId, start: this.axis(e), startSize: this.size(), from: this._snap, last: [[e.timeStamp || performance.now(), this.axis(e)]] };
    this.liveSize = this.size();
    this.sheet.classList.add('drag');
    try { this.handle.setPointerCapture?.(e.pointerId); } catch { /* synthetic */ }
  }
  private track2(list: Array<[number, number]>, t: number, a: number): void { list.push([t, a]); if (list.length > 6) list.shift(); }
  private velocity(list: Array<[number, number]>): number { if (list.length < 2) return 0; const a = list[0]!, b = list[list.length - 1]!; const dt = b[0] - a[0]; return dt > 0 ? (b[1] - a[1]) / dt : 0; }
  private dragMove(e: PointerEvent): void {
    const d = this.dragging; if (!d || e.pointerId !== d.id) return;
    const a = this.axis(e);
    this.track2(d.last, e.timeStamp || performance.now(), a);
    if (Math.abs(a - d.start) > 4) this.justDragged = true;
    this.applyLive(d.startSize + (a - d.start));
    e.preventDefault?.();
  }
  private dragEnd(e: PointerEvent, cancel = false): void {
    const d = this.dragging; if (!d || e.pointerId !== d.id) return;
    this.dragging = null; this.sheet.classList.remove('drag');
    try { this.handle.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    if (!cancel && this.justDragged) this.setSnap(resolveSnap(this.liveSize, this.velocity(d.last), this.snapSizes(), d.from));
    else this.apply();
    if (!this.justDragged) return;
    setTimeout(() => { this.justDragged = false; }, 0);
  }

  // ---- drag from the content (touch): scroll-chaining rules ----
  private findScroller(e: TouchEvent): HTMLElement | null {
    for (const n of e.composedPath()) {
      if (n === this.contentEl) break;
      const el = n as HTMLElement;
      if (!(el instanceof HTMLElement)) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
    }
    return this.contentEl.scrollHeight > this.contentEl.clientHeight + 1 ? this.contentEl : null;
  }
  private touchStart(e: TouchEvent): void {
    if (!this.on || this.side || e.touches.length !== 1) { this.touchOwn = null; return; }
    const t = e.touches[0]!;
    this.touchOwn = { x: t.clientX, y: t.clientY, mode: 'undecided', startSize: this.size(), from: this._snap, last: [[e.timeStamp, -t.clientY]], scroller: this.findScroller(e) };
  }
  private touchMove(e: TouchEvent): void {
    const o = this.touchOwn; if (!o || e.touches.length !== 1) return;
    const t = e.touches[0]!, dx = t.clientX - o.x, dy = t.clientY - o.y;
    if (o.mode === 'undecided') {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dx) > Math.abs(dy)) { o.mode = 'native'; return; } // horizontal: card rails and tab strips scroll natively
      const up = dy < 0;
      const sc = o.scroller;
      // finger up: grow the sheet until it is full, then scroll; finger down: scroll the content to its top first, then collapse
      if (up) o.mode = this._snap !== 'full' ? 'sheet' : 'native';
      else o.mode = sc && sc.scrollTop > 0 ? 'native' : 'sheet';
      if (o.mode === 'sheet') { this.sheet.classList.add('drag'); this.liveSize = o.startSize; }
    }
    if (o.mode !== 'sheet') return;
    this.track2(o.last, e.timeStamp, -t.clientY);
    this.applyLive(o.startSize + (o.y - t.clientY));
    if (e.cancelable) e.preventDefault();
  }
  private touchEnd(): void {
    const o = this.touchOwn; this.touchOwn = null;
    if (!o || o.mode !== 'sheet') return;
    this.sheet.classList.remove('drag');
    this.setSnap(resolveSnap(this.liveSize, this.velocity(o.last), this.snapSizes(), o.from));
  }

  private onHandleKey(e: KeyboardEvent): void {
    const up = this.side ? 'ArrowLeft' : 'ArrowUp', down = this.side ? 'ArrowRight' : 'ArrowDown';
    if (e.key === up) { this.cycle(1); e.preventDefault(); }
    else if (e.key === down) { this.cycle(-1); e.preventDefault(); }
    else if (e.key === 'Home') { this.setSnap('peek'); e.preventDefault(); }
    else if (e.key === 'End') { this.setSnap('full'); e.preventDefault(); }
    else if (e.key === 'Escape' && this._snap !== 'peek') { this.cycle(-1); e.preventDefault(); e.stopPropagation(); }
  }
}

/** Wrap a panel in a sheet for phones (a passthrough elsewhere). `watch`: 'display' = the sheet follows the panel's `style.display` (hidden unless 'flex' / 'block'; inspectors), 'hidden' = follows its `hidden` attribute, false = always shown with its host. */
export function sheetFor(panel: HTMLElement, label: string, key: string, peekH = 150, watch: 'display' | 'hidden' | false = 'display'): HTMLElement {
  const sh = document.createElement('st-sheet');
  sh.setAttribute('label', label); sh.setAttribute('key', key); sh.setAttribute('peek-h', String(peekH));
  sh.append(panel);
  if (watch) {
    const sync = (): void => { if (watch === 'hidden') sh.hidden = panel.hidden; else { const d = panel.style.display; sh.hidden = d !== 'flex' && d !== 'block'; } };
    sync();
    if (typeof MutationObserver !== 'undefined') new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: [watch === 'hidden' ? 'hidden' : 'style'] });
  }
  return sh;
}
/** CSS for a component that hosts a `sheetFor(...)`: the sheet sits above the dock row, the panel loses its own frame inside it. Append to the component's css(). */
export const SHEET_PANEL_CSS = 'st-sheet{--sheet-bottom:calc(76px + env(safe-area-inset-bottom,0px));--sheet-top:calc(56px + env(safe-area-inset-top,0px))}st-sheet[data-sheet] .panel{background:none;border:0;box-shadow:none;min-width:0;max-width:none;max-height:none;overflow:visible;width:100%;box-sizing:border-box;padding:0 2px}st-sheet[data-sheet][data-side] .panel{padding:0 2px 0 0}';
