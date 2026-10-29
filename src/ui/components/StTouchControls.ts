import { StElement } from './StElement';
import { joystickAxes, joystickKeys, type TouchMode, type ToolKind } from '@/render/touch';

/** What the touch bar needs from the game (wired in main.ts; every call is a thin wrapper, no logic here). */
export interface TouchControlsApi {
  setMode(m: TouchMode): void;
  confirm(): void;
  cancelTool(): void;
  undo(): void;
  rotateView(dir: 1 | -1): void;
  rotateGhost(dir: 1 | -1): void;
  /** Show / hide the open drawer (tool options) while a map tool is active: on a short screen the drawer would cover the map you paint on. */
  toggleDrawer?(): void;
  /** Pause / resume the simulation (in walk mode Space is Hop, so the Pause button cannot send it). */
  togglePause?(): void;
}
export type TouchView = 'iso' | 'ride' | 'walk' | 'photo';
export interface TouchBarState { enabled: boolean; tool: string; kind: ToolKind; mode: TouchMode; confirming: boolean; /** Ghost summary while aiming ('' = show the default tip). */ hint: string; /** The dock drawer is tucked away (touch + a map tool). */ drawerHidden: boolean }

const JOY_R = 52;
const TIP = 'Tap the map to aim, tap again to place';

/**
 * On-screen touch controls (docs/touch.md). Hidden unless touch is on (`enabled`). The host is a 0x0 fixed box (never blocks the map); every cluster is
 * a small fixed group that takes pointer events itself.
 *  - iso view: right-edge column (pan/paint toggle for paint tools, undo, rotate view, cancel tool) + the placement bar (rotate, Place, Cancel) above the dock.
 *  - ride: next guest, recentre, photo, pause, exit.   photo: save, exit.
 *  - walk: virtual joystick (left) + Interact / Hop / Run / Photo / Exit; look = drag on the map (WalkInput's existing drag-look).
 * Keys are sent as synthetic key events so the existing handlers (walk, ride, photo, speed) stay the single code path.
 */
export class StTouchControls extends StElement {
  private api: TouchControlsApi | null = null;
  private st: TouchBarState = { enabled: false, tool: 'select', kind: 'select', mode: 'pan', confirming: false, hint: '', drawerHidden: false };
  private view: TouchView = 'iso';
  private readonly col = document.createElement('div');
  private readonly bar = document.createElement('div');
  private readonly views = document.createElement('div');
  private readonly joy = document.createElement('div');
  private readonly knob = document.createElement('div');
  private readonly hintEl = document.createElement('span');
  private modeBtn!: HTMLButtonElement;
  private cancelBtn!: HTMLButtonElement;
  private drawerBtn!: HTMLButtonElement;
  private placeBtn!: HTMLButtonElement;
  private rotBtns: HTMLButtonElement[] = [];
  private runBtn: HTMLButtonElement | null = null;
  private held = new Set<string>();
  private joyId = -1;
  private runOn = false;
  private obs: MutationObserver | null = null;

  protected css(): string {
    return `:host{position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2;--tc:max(var(--touch-min,0px),48px)}
.cl{position:fixed;display:flex;gap:8px;pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.col{left:calc(8px + env(safe-area-inset-left,0px));top:calc(124px + env(safe-area-inset-top,0px));flex-direction:column}
.bar{left:50%;transform:translateX(-50%);bottom:calc(92px + env(safe-area-inset-bottom,0px));flex-direction:row;align-items:center;padding:6px 8px;background:var(--c-panel);border:1px solid rgba(90,112,144,.5);border-radius:var(--r-lg);max-width:calc(100vw - 16px)}
.views{right:calc(10px + env(safe-area-inset-right,0px));bottom:calc(84px + env(safe-area-inset-bottom,0px));flex-wrap:wrap;justify-content:flex-end;max-width:min(260px,60vw)}
.views[data-view=photo]{bottom:auto;top:50%;flex-direction:column}
.joy{touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;left:calc(18px + env(safe-area-inset-left,0px));bottom:calc(84px + env(safe-area-inset-bottom,0px));width:${JOY_R * 2 + 24}px;height:${JOY_R * 2 + 24}px;border-radius:50%;background:rgba(20,28,40,.55);border:2px solid rgba(255,255,255,.35);display:block;position:fixed}
.knob{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:rgba(255,208,112,.85);border:2px solid #fff;pointer-events:none}
button.t{min-width:var(--tc);min-height:var(--tc);padding:0 10px;font-size:calc(18px * var(--ui-scale,1));display:inline-flex;align-items:center;justify-content:center;gap:4px;background:rgba(20,28,40,.82);border-color:rgba(138,160,190,.7)}
button.t small{font-size:calc(11px * var(--ui-scale,1));font-weight:700}
button.t.active,button.t.primary{color:#1a1208}
button.t.primary{background:linear-gradient(#f2b43e,#dc9526);border-color:#ffd070}
.hint{max-width:150px;line-height:1.2}
button.t.wide{padding:0 14px}
[hidden]{display:none!important}
@media (max-width:760px) and (min-height:521px){.views[data-view=photo]{top:calc(12px + env(safe-area-inset-top,0px));bottom:auto;flex-direction:row}.joy,.views:not([data-view=photo]){bottom:calc(164px + env(safe-area-inset-bottom,0px))}} /* portrait: the view HUD card (Exit) sits at the bottom centre: keep the stick and buttons above it */
@media (max-height:520px){.col{top:calc(72px + env(safe-area-inset-top,0px));left:calc(52px + env(safe-area-inset-left,0px));right:auto;flex-direction:row}.bar{bottom:calc(66px + env(safe-area-inset-bottom,0px))}}
@media (max-height:520px) and (max-width:500px){.col{top:calc(112px + env(safe-area-inset-top,0px));left:calc(8px + env(safe-area-inset-left,0px));flex-direction:column;gap:4px}}`;
  }

  constructor() {
    super();
    const mk = (label: string, title: string, fn: () => void, cls = ''): HTMLButtonElement => {
      const b = document.createElement('button'); b.className = `t ${cls}`.trim(); b.innerHTML = label; b.title = title; b.setAttribute('aria-label', title);
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    // iso column
    this.col.className = 'cl col';
    this.modeBtn = mk('✋', 'One-finger drag: pan the map (tap to paint)', () => this.api?.setMode(this.st.mode === 'pan' ? 'paint' : 'pan'));
    this.modeBtn.dataset.role = 'mode';
    const undo = mk('↶', 'Undo last build action (two-finger tap)', () => this.api?.undo()); undo.dataset.role = 'undo';
    const rl = mk('⟲', 'Rotate the view left (twist two fingers for free rotation)', () => this.api?.rotateView(-1)); rl.dataset.role = 'rot-left';
    const rr = mk('⟳', 'Rotate the view right', () => this.api?.rotateView(1)); rr.dataset.role = 'rot-right';
    this.cancelBtn = mk('✕', 'Cancel the tool (long press)', () => this.api?.cancelTool(), 'danger'); this.cancelBtn.dataset.role = 'cancel';
    this.drawerBtn = mk('☰', 'Show the tool options', () => this.api?.toggleDrawer?.()); this.drawerBtn.dataset.role = 'drawer';
    this.col.append(this.modeBtn, this.drawerBtn, undo, rl, rr, this.cancelBtn);
    // placement bar
    this.bar.className = 'cl bar';
    const gl = mk('⟲', 'Rotate the building left', () => this.api?.rotateGhost(-1)); gl.dataset.role = 'ghost-left';
    const gr = mk('⟳', 'Rotate the building right', () => this.api?.rotateGhost(1)); gr.dataset.role = 'ghost-right';
    this.placeBtn = mk('✓ <small>Place</small>', 'Place the building at the ghost (or tap the ghost again)', () => this.api?.confirm(), 'primary wide'); this.placeBtn.dataset.role = 'place';
    const bc = mk('✕', 'Cancel placing', () => this.api?.cancelTool(), 'danger'); bc.dataset.role = 'bar-cancel';
    this.hintEl.className = 'hint'; this.hintEl.textContent = TIP; this.hintEl.setAttribute('role', 'status');
    this.rotBtns = [gl, gr];
    this.bar.append(gl, gr, this.placeBtn, bc, this.hintEl);
    // views
    this.views.className = 'cl views';
    this.joy.className = 'joy'; this.joy.hidden = true; this.knob.className = 'knob'; this.joy.append(this.knob); this.joy.dataset.role = 'joystick'; this.joy.setAttribute('aria-label', 'Walk joystick'); this.joy.setAttribute('role', 'application');
    this.bindJoystick();
    this.root.append(this.col, this.bar, this.views, this.joy); // no attributes on the host in the constructor (custom element rule): sync() runs when connected
  }

  bind(api: TouchControlsApi): void { this.api = api; }

  connectedCallback(): void {
    const read = (): void => { const c = document.body.classList; this.setView(c.contains('view-walk') ? 'walk' : c.contains('view-photo') ? 'photo' : c.contains('view-ride') ? 'ride' : 'iso'); };
    if (typeof MutationObserver !== 'undefined') { this.obs = new MutationObserver(read); this.obs.observe(document.body, { attributes: true, attributeFilter: ['class'] }); }
    read();
    this.sync();
  }
  disconnectedCallback(): void { this.obs?.disconnect(); this.obs = null; super.disconnectedCallback(); this.releaseAll(); }

  setState(s: Partial<TouchBarState>): void { this.st = { ...this.st, ...s }; this.sync(); }
  setView(v: TouchView): void { if (v === this.view) return; this.view = v; if (v !== 'walk') this.releaseAll(); this.buildViews(); this.sync(); }
  get currentView(): TouchView { return this.view; }

  private key(k: string, down: boolean): void { window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: k, bubbles: true, cancelable: true })); }
  private tapKey(k: string): void { this.key(k, true); this.key(k, false); }
  /** A key the walk loop POLLS (Space = hop): keep it down for at least one rendered frame, otherwise down + up in the same task is never seen. */
  private pressKey(k: string): void { this.key(k, true); requestAnimationFrame(() => requestAnimationFrame(() => this.key(k, false))); }
  private releaseAll(): void { for (const k of this.held) this.key(k, false); this.held.clear(); this.runOn = false; this.runBtn?.classList.remove('active'); this.knob.style.transform = ''; this.joyId = -1; }

  private buildViews(): void {
    this.views.replaceChildren();
    this.views.dataset.view = this.view;
    const mk = (label: string, title: string, fn: () => void, role: string): HTMLButtonElement => {
      const b = document.createElement('button'); b.className = 't'; b.innerHTML = label; b.title = title; b.setAttribute('aria-label', title); b.dataset.role = role;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      this.views.append(b);
      return b;
    };
    this.runBtn = null;
    if (this.view === 'walk') {
      mk('E', 'Interact: inspect / board a lift', () => this.tapKey('e'), 'interact');
      mk('⤒', 'Hop', () => this.pressKey(' '), 'hop');
      const run = mk('<small>RUN</small>', 'Run (toggle)', () => { this.runOn = !this.runOn; this.key('Shift', this.runOn); if (this.runOn) this.held.add('Shift'); else this.held.delete('Shift'); run.classList.toggle('active', this.runOn); }, 'run');
      this.runBtn = run;
      mk('📷', 'Photo mode', () => this.tapKey('p'), 'photo');
      mk('⏯', 'Pause / resume', () => (this.api?.togglePause ? this.api.togglePause() : this.tapKey(' ')), 'pause');
    } else if (this.view === 'ride') {
      mk('◎', 'Recentre the view', () => this.tapKey('c'), 'recentre');
      mk('📷', 'Photo mode', () => this.tapKey('p'), 'photo');
      mk('⏯', 'Pause / resume', () => this.tapKey(' '), 'pause');
    } else if (this.view === 'photo') {
      mk('💾', 'Save the photo (a PNG on this device)', () => this.tapKey('Enter'), 'save');
      mk('✕', 'Exit photo mode', () => this.tapKey('Escape'), 'exit');
    }
  }

  private bindJoystick(): void {
    const j = this.joy;
    const apply = (e: PointerEvent): void => {
      const r = j.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > JOY_R) { dx = (dx / len) * JOY_R; dy = (dy / len) * JOY_R; }
      this.knob.style.transform = `translate(${dx}px,${dy}px)`;
      const want = joystickKeys(joystickAxes(dx, dy, JOY_R));
      for (const k of ['w', 'a', 's', 'd']) {
        if (want.has(k) && !this.held.has(k)) { this.held.add(k); this.key(k, true); }
        else if (!want.has(k) && this.held.has(k)) { this.held.delete(k); this.key(k, false); }
      }
    };
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = -1; this.knob.style.transform = '';
      for (const k of ['w', 'a', 's', 'd']) if (this.held.has(k)) { this.held.delete(k); this.key(k, false); }
    };
    j.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.joyId = e.pointerId; try { j.setPointerCapture(e.pointerId); } catch { /* synthetic */ } apply(e); });
    j.addEventListener('pointermove', (e) => { if (e.pointerId === this.joyId) { e.stopPropagation(); apply(e); } });
    j.addEventListener('pointerup', end); j.addEventListener('pointercancel', end);
  }

  private sync(): void {
    const on = this.st.enabled, iso = this.view === 'iso';
    this.hidden = !on;
    this.col.hidden = !on || !iso;
    this.modeBtn.hidden = this.st.kind !== 'paint';
    this.modeBtn.classList.toggle('active', this.st.mode === 'paint');
    this.modeBtn.innerHTML = this.st.mode === 'paint' ? '🖌' : '✋';
    this.modeBtn.title = this.st.mode === 'paint' ? 'Paint mode: one-finger drag paints (tap to switch to pan)' : 'Pan mode: one-finger drag pans (tap to paint)';
    this.modeBtn.setAttribute('aria-label', this.modeBtn.title); this.modeBtn.setAttribute('aria-pressed', String(this.st.mode === 'paint'));
    this.cancelBtn.hidden = this.st.tool === 'select';
    this.drawerBtn.hidden = this.st.tool === 'select';
    this.drawerBtn.setAttribute('aria-pressed', String(!this.st.drawerHidden));
    this.drawerBtn.classList.toggle('active', !this.st.drawerHidden);
    this.drawerBtn.title = this.st.drawerHidden ? 'Show the tool options' : 'Hide the tool options (free the map)'; this.drawerBtn.setAttribute('aria-label', this.drawerBtn.title);
    this.bar.hidden = !on || !iso || (this.st.tool !== 'placement' && this.st.tool !== 'lift');
    const lift = this.st.tool === 'lift';
    for (const b of this.rotBtns) b.hidden = lift;
    this.placeBtn.classList.toggle('active', this.st.confirming);
    this.hintEl.textContent = this.st.hint || TIP;
    this.views.hidden = !on || this.view === 'iso';
    this.joy.hidden = !on || this.view !== 'walk';
  }
}
