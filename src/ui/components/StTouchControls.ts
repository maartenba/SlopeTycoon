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
  private readonly ma = document.createElement('div');
  private readonly infoBtn = document.createElement('button');
  private readonly sparkBtn = document.createElement('button');
  private readonly detailEl = document.createElement('div');
  private undoB!: HTMLButtonElement;
  private optB!: HTMLButtonElement;
  private modeB!: HTMLButtonElement;
  private details: Array<{ kind: string; text: string }> = [];
  private profile: { samples: Array<{ distM: number; altM: number; difficulty: number }>; summary: string } | null = null;
  private onProfile: ((e: Event) => void) | null = null;
  private alertFn: ((e: Event) => void) | null = null;
  private alertText = '';
  private alertTimer = 0;
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
@media (max-width:520px) and (min-height:521px){.col{top:calc(228px + env(safe-area-inset-top,0px))}.bar{bottom:calc(128px + env(safe-area-inset-bottom,0px))}} /* phone portrait: below the HUD strip / speed row / goal chip; above the dock + the sheet's handle */
@media (max-height:520px) and (max-width:500px){.col{top:calc(112px + env(safe-area-inset-top,0px));left:calc(8px + env(safe-area-inset-left,0px));flex-direction:column;gap:4px}}
.ph,.detail,.ma{display:none}.ma{display:contents}.bar.np{display:none}
/* Phones (docs/mobile-ui-v2.md): the bar is the 104 px TOOL BAR at the bottom (row A: the ONE message + a profile sparkline; row B: Cancel, rotate, Undo, Options, Place). The left rail is gone: its jobs are in row B / the overflow menu. */
@media (max-width:520px),(max-height:520px){
.col{display:none!important}
.bar,.bar.np{display:grid;grid-template-columns:44px 44px 44px 44px 1fr;grid-template-rows:44px 52px;gap:4px;left:calc(8px + env(safe-area-inset-left,0px));right:calc(8px + env(safe-area-inset-right,0px));bottom:calc(8px + env(safe-area-inset-bottom,0px));transform:none;max-width:none;padding:4px 6px;box-sizing:border-box;align-items:stretch;touch-action:none}
.bar[hidden]{display:none}
.bar button.t{min-width:44px;min-height:44px;padding:0;font-size:calc(18px * var(--ui-scale,1))}
.ma{display:contents}.ph{display:inline-flex}.ph[hidden],.detail[hidden]{display:none}
.hint{grid-row:1;grid-column:1/5;align-self:center;max-width:none;font-size:calc(12.5px * var(--ui-scale,1));line-height:1.25;font-weight:700;color:#8be28b;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.hint.bad{color:#ff8d8d}.hint.note{color:#cfd8dc}
.bar.hasd .hint{grid-column:1/4}.infob{grid-row:1;grid-column:4;font-size:16px}.infob[hidden]{display:none}
.spark{grid-row:1;grid-column:5;justify-self:stretch;padding:0 4px;background:transparent;border-color:transparent;flex-direction:column;align-items:stretch;gap:0;min-width:0}.spark svg{width:100%;height:26px;display:block}.spark small{font-size:10px;line-height:1;color:#b9c6d8;text-align:center;white-space:nowrap}
.bc{grid-row:2;grid-column:1}.gl{grid-row:2;grid-column:2}.bar .gr{display:none}.undob{grid-row:2;grid-column:3}.optb{grid-row:2;grid-column:4}.modeb{grid-row:2;grid-column:2}.place{grid-row:2;grid-column:5;min-width:0}
.bar.nopivot .gl{display:none}.bar.nopivot:not(.paint) .undob{grid-column:2}.bar.nopivot:not(.paint) .optb{grid-column:3}.bar.nopivot:not(.paint) .place{grid-column:4/6}.bar.nopivot .modeb[hidden]{display:none}
button.t.primary[disabled]{opacity:.45;filter:saturate(.4)}
.detail{position:fixed;left:calc(8px + env(safe-area-inset-left,0px));right:calc(8px + env(safe-area-inset-right,0px));bottom:calc(120px + env(safe-area-inset-bottom,0px));z-index:3;pointer-events:auto;box-sizing:border-box;padding:8px 10px;background:var(--c-panel);border:1px solid rgba(90,112,144,.5);border-radius:var(--r-md);font-size:calc(12px * var(--ui-scale,1));line-height:1.35;color:#e8eef2;max-height:150px;overflow:auto}.detail:not([hidden]){display:block}
.detail div.e{color:#ff8d8d}.detail div.w{color:#ffc857}
}
/* landscape phones: the tool bar is a vertical strip at the right edge, the message a pill at the bottom centre */
@media (max-height:520px){
.bar,.bar.np{display:flex;flex-direction:column;left:auto;right:calc(8px + env(safe-area-inset-right,0px));top:calc(56px + env(safe-area-inset-top,0px));bottom:auto;transform:none;width:64px;padding:4px;gap:4px;max-height:calc(100vh - 16px);overflow:auto}
.bar .ma{display:flex;position:fixed;left:50%;transform:translateX(-50%);bottom:calc(8px + env(safe-area-inset-bottom,0px));max-width:min(60vw,520px);align-items:center;gap:6px;padding:2px 10px;min-height:36px;background:var(--c-panel);border:1px solid rgba(90,112,144,.5);border-radius:18px;box-sizing:border-box;pointer-events:auto}
.bar .hint{display:block;-webkit-line-clamp:unset;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.bar .spark{width:96px;flex:none}.bar .infob{flex:none;min-height:36px}
.bar .bc,.bar .gl,.bar .gr,.bar .undob,.bar .optb,.bar .modeb,.bar .place{width:56px;min-width:56px;grid-area:auto}
.bar .bc{order:1}.bar .gl,.bar .modeb{order:2}.bar .undob{order:3}.bar .optb{order:4}.bar .place{order:5;min-height:56px}.bar .spark small{display:none}.bar .spark{width:72px}
.detail{bottom:calc(52px + env(safe-area-inset-bottom,0px));right:calc(80px + env(safe-area-inset-right,0px));left:calc(8px + env(safe-area-inset-left,0px))}
}`;
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
    const rr = mk('⟳', 'Rotate the view right', () => this.api?.rotateView(1)); rr.dataset.role = 'rot-right'; rr.dataset.tutorialId = 'topbar:rotate'; // phones hide the top bar's rotate button (overflow menu): the tutorial points here then
    this.cancelBtn = mk('✕', 'Cancel the tool (long press)', () => this.api?.cancelTool(), 'danger'); this.cancelBtn.dataset.role = 'cancel';
    this.drawerBtn = mk('☰', 'Show the tool options', () => this.api?.toggleDrawer?.()); this.drawerBtn.dataset.role = 'drawer';
    this.col.append(this.modeBtn, this.drawerBtn, undo, rl, rr, this.cancelBtn);
    // placement bar (tablets: rotate, Place, Cancel, hint) = the 2-row TOOL BAR on phones (css): row A the ONE message + sparkline, row B Cancel, rotate, Undo, Options, Place
    this.bar.className = 'cl bar';
    const gl = mk('⟲', 'Rotate the building left', () => this.api?.rotateGhost(-1), 'gl'); gl.dataset.role = 'ghost-left';
    const gr = mk('⟳', 'Rotate the building right', () => this.api?.rotateGhost(1), 'gr'); gr.dataset.role = 'ghost-right';
    this.placeBtn = mk('✓ <small>Place</small>', 'Place the building at the ghost (or tap the ghost again)', () => { if (this.st.tool === 'placement' || this.st.tool === 'lift') this.api?.confirm(); else this.api?.cancelTool(); }, 'primary wide place'); this.placeBtn.dataset.role = 'place';
    const bc = mk('✕', 'Cancel placing', () => this.api?.cancelTool(), 'danger bc'); bc.dataset.role = 'bar-cancel';
    this.hintEl.className = 'hint'; this.hintEl.textContent = TIP; this.hintEl.setAttribute('role', 'status');
    this.undoB = mk('↶', 'Undo the last build action (two-finger tap)', () => this.api?.undo(), 'ph undob'); this.undoB.dataset.role = 'bar-undo';
    this.optB = mk('☰', 'Options: show or hide the tool options', () => this.api?.toggleDrawer?.(), 'ph optb'); this.optB.dataset.role = 'bar-options';
    this.modeB = mk('✋', 'One-finger drag: pan the map (tap to paint)', () => this.api?.setMode(this.st.mode === 'pan' ? 'paint' : 'pan'), 'ph modeb'); this.modeB.dataset.role = 'bar-mode';
    this.infoBtn.className = 't ph infob'; this.infoBtn.textContent = 'i'; this.infoBtn.title = 'Why not? More detail'; this.infoBtn.setAttribute('aria-label', 'More detail'); this.infoBtn.dataset.role = 'bar-info'; this.infoBtn.hidden = true;
    this.infoBtn.addEventListener('click', (e) => { e.stopPropagation(); this.detailEl.hidden = !this.detailEl.hidden; });
    this.sparkBtn.className = 't ph spark'; this.sparkBtn.hidden = true; this.sparkBtn.dataset.role = 'bar-profile'; this.sparkBtn.title = 'Show the ground profile'; this.sparkBtn.setAttribute('aria-label', 'Show the ground profile');
    this.sparkBtn.addEventListener('click', (e) => { e.stopPropagation(); const r = document.documentElement; r.toggleAttribute('data-profile-open', !r.hasAttribute('data-profile-open')); });
    this.detailEl.className = 'detail'; this.detailEl.hidden = true; this.detailEl.setAttribute('role', 'status'); this.detailEl.addEventListener('click', () => { this.detailEl.hidden = true; });
    this.ma.className = 'ma'; this.ma.append(this.hintEl, this.infoBtn, this.sparkBtn);
    this.rotBtns = [gl, gr];
    this.bar.append(gl, gr, this.placeBtn, bc, this.ma, this.undoB, this.optB, this.modeB);
    // views
    this.views.className = 'cl views';
    this.joy.className = 'joy'; this.joy.hidden = true; this.knob.className = 'knob'; this.joy.append(this.knob); this.joy.dataset.role = 'joystick'; this.joy.setAttribute('aria-label', 'Walk joystick'); this.joy.setAttribute('role', 'application');
    this.bindJoystick();
    this.root.append(this.col, this.bar, this.detailEl, this.views, this.joy); // no attributes on the host in the constructor (custom element rule): sync() runs when connected
  }

  bind(api: TouchControlsApi): void { this.api = api; }

  connectedCallback(): void {
    const read = (): void => { const c = document.body.classList; this.setView(c.contains('view-walk') ? 'walk' : c.contains('view-photo') ? 'photo' : c.contains('view-ride') ? 'ride' : 'iso'); };
    if (typeof MutationObserver !== 'undefined') { this.obs = new MutationObserver(read); this.obs.observe(document.body, { attributes: true, attributeFilter: ['class'] }); }
    read();
    this.onProfile = (e: Event): void => {
      const v = (e as CustomEvent).detail as { kind: string; profile: { samples: Array<{ distM: number; altM: number; difficulty: number }>; lengthM: number; dropM: number; avgPct: number; maxPct: number } } | null;
      this.profile = v ? { samples: v.profile.samples, summary: `${Math.round(v.profile.lengthM)} m · ${v.kind === 'lift' ? '\u2191' : '\u2193'}${Math.round(Math.abs(v.profile.dropM))} m · max ${Math.round(v.profile.maxPct)}%` } : null;
      if (!v) document.documentElement.removeAttribute('data-profile-open');
      this.syncSpark();
    };
    window.addEventListener('st-profile-view', this.onProfile);
    this.alertFn = (e: Event): void => { this.alertText = String((e as CustomEvent).detail?.text ?? ''); window.clearTimeout(this.alertTimer); this.alertTimer = window.setTimeout(() => { this.alertText = ''; this.sync(); }, 6000); this.sync(); };
    window.addEventListener('st-tool-alert', this.alertFn);
    this.sync();
  }
  disconnectedCallback(): void { this.obs?.disconnect(); this.obs = null; if (this.onProfile) window.removeEventListener('st-profile-view', this.onProfile); if (this.alertFn) window.removeEventListener('st-tool-alert', this.alertFn); window.clearTimeout(this.alertTimer); super.disconnectedCallback(); this.releaseAll(); }

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

  /** Phones: the aiming tool's long text (every reason + hint, as the ghost tooltip prints it); the bar shows only the first reason and an `i` for the rest. */
  setDetails(lines: Array<{ kind: string; text: string }> | null): void {
    this.details = lines ?? [];
    this.detailEl.replaceChildren(...this.details.map((l) => { const d = document.createElement('div'); d.className = l.kind === 'error' ? 'e' : l.kind === 'warn' ? 'w' : ''; d.textContent = l.kind === 'error' ? `\u2716 ${l.text}` : l.kind === 'warn' ? `\u26a0 ${l.text}` : l.text; return d; }));
    this.syncDetails();
  }
  /** The ONE message the bar shows (row A): tests / audits read it. */
  get message(): string { return this.hintEl.textContent ?? ''; }
  get placeDisabled(): boolean { return this.placeBtn.disabled; }
  private syncDetails(): void {
    const more = this.details.length > 1 || this.details.some((l) => l.text.length > 70);
    this.infoBtn.hidden = !more; this.bar.classList.toggle('hasd', more);
    if (!more) this.detailEl.hidden = true;
  }
  private syncSpark(): void {
    const p = this.profile;
    this.sparkBtn.hidden = !p;
    if (!p) { this.sparkBtn.replaceChildren(); return; }
    const NS = 'http://www.w3.org/2000/svg', W = 100, H = 26, s = p.samples;
    let lo = Infinity, hi = -Infinity; for (const q of s) { lo = Math.min(lo, q.altM); hi = Math.max(hi, q.altM); }
    const span = Math.max(10, hi - lo), tot = Math.max(1, s[s.length - 1]!.distM);
    const x = (d: number): number => (d / tot) * W, y = (a: number): number => 2 + (1 - (a - lo) / span) * (H - 4);
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
    const COL = ['#3fb950', '#3b82f6', '#e5484d', '#aab4c4'];
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1]!, b = s[i]!, poly = document.createElementNS(NS, 'polygon');
      poly.setAttribute('points', `${x(a.distM)},${y(a.altM)} ${x(b.distM)},${y(b.altM)} ${x(b.distM)},${H} ${x(a.distM)},${H}`); poly.setAttribute('fill', COL[Math.max(0, Math.min(3, b.difficulty))]!); poly.setAttribute('fill-opacity', '.8');
      svg.append(poly);
    }
    const sm = document.createElement('small'); sm.textContent = p.summary;
    this.sparkBtn.replaceChildren(svg, sm);
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
    const ghostTool = this.st.tool === 'placement' || this.st.tool === 'lift';
    this.bar.hidden = !on || !iso || this.st.tool === 'select';
    this.bar.classList.toggle('np', !ghostTool); // tablets: the bar is only for the ghost tools; phones show it for every tool
    const paint = this.st.kind === 'paint';
    this.modeB.hidden = !paint; this.modeB.classList.toggle('active', this.st.mode === 'paint'); this.modeB.innerHTML = this.st.mode === 'paint' ? '🖌' : '✋';
    this.bar.classList.toggle('paint', paint);
    this.bar.classList.toggle('nopivot', !ghostTool || this.st.tool === 'lift'); // no ghost rotation for lifts / paint tools
    this.placeBtn.innerHTML = ghostTool ? '✓ <small>Place</small>' : '✓ <small>Done</small>';
    this.placeBtn.title = ghostTool ? 'Place the building at the ghost (or tap the ghost again)' : 'Done: leave the tool';
    this.placeBtn.dataset.done = ghostTool ? '' : '1';
    const lift = this.st.tool === 'lift';
    for (const b of this.rotBtns) b.hidden = lift;
    this.placeBtn.classList.toggle('active', this.st.confirming);
    let msg = this.alertText || this.st.hint || TIP;
    if (typeof matchMedia === 'function' && matchMedia('(max-width: 520px), (max-height: 520px)').matches) msg = msg.replace(/^(\u2716\s*)?[A-Za-z' -]{3,30}(\([^)]*\))?:\s+(?=\S)/, '$1').replace(/^(.{24,}?[.!?])\s[\s\S]*$/, '$1'); // phones: no lift / building name prefix, only the first sentence (the rest is behind the i button)
    this.hintEl.textContent = msg;
    const bad = !!this.alertText || /^\s*(\u2716|✖|Not on the map|No |Cannot)/.test(msg) || /cannot|must|needs|not enough|blocked/i.test(msg) && !/\$/.test(msg);
    this.hintEl.classList.toggle('bad', bad); this.hintEl.classList.toggle('note', !bad && !/\$/.test(msg));
    this.placeBtn.disabled = ghostTool && bad;
    this.views.hidden = !on || this.view === 'iso';
    this.joy.hidden = !on || this.view !== 'walk';
  }
}
