import { AudioSettings, VOLUME_KEYS, type VolumeKey } from '../../audio/AudioSettings';
import type { EngineState } from '../../audio/AudioEngine';
import { icon } from '../icons';
import { Modal } from '../modal';
import { StElement } from './StElement';
import { makeSelect, type StSelect } from './StSelect';
import { COSMETIC_KINDS, COSMETIC_KIND_LABEL } from '../../config/cosmetics';
import type { CosmeticsApi } from '../trophyData';
import { accessibility, UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP } from '../accessibility';

export interface SettingsEngine { readonly state: EngineState; readonly needsHint: boolean; onState(fn: (s: EngineState) => void): () => void }
export interface SettingsLink { label: string; title?: string; run(): void }
/** Game-level options shown in the Graphics / Gameplay sections (each optional: missing = row hidden). */
export interface GameSettingsApi {
  quality?: { get(): string; set(q: string): void; options: readonly string[] };
  fastNights?: { get(): boolean; set(on: boolean): void };
  /** Ride-along pacing: slow motion (target-speed: guest <= ~9 tiles/s) on / off. */
  rideSlowMo?: { get(): boolean; set(on: boolean): void };
  /** Walk mode (Task 12): sensitivity 0.5-2, FOV 60-100, invert Y, head bob, run toggle (persisted by the host in `slope.walk.v1`). */
  walk?: { get(): { sensitivity: number; invertY: boolean; fov: number; headBob: boolean; runToggle: boolean; mouseLook: 'drag' | 'lock' }; set(p: Partial<{ sensitivity: number; invertY: boolean; fov: number; headBob: boolean; runToggle: boolean; mouseLook: 'drag' | 'lock' }>): void };
  hints?: { get(): boolean; set(on: boolean): void; title?: string };
  /** Month-end summary card (default on). */
  monthSummary?: { get(): boolean; set(on: boolean): void };
  /** Year-end report dialog (M5.3): off = the report is still in Finance > Reports. */
  yearReport?: { get(): boolean; set(on: boolean): void };
  replayTutorial?(): void;
  unmuteNews?(): void;
  /** Feedback intensity (popups / puffs / confetti): off | subtle | lively. */
  feedback?: { get(): string; set(v: string): void; options: readonly string[] };
  /** Local profile (M5.3 Task 16): cosmetic rewards + 'Reset profile'. */
  profile?: { cosmetics: CosmeticsApi; /** clears achievements + scenario results + cosmetics (never the save slots) */ reset(): void | Promise<void> };
}

const LABELS: Record<VolumeKey, string> = { master: 'Master', music: 'Music', sfx: 'Effects', ambience: 'Ambience' };

/**
 * Settings dialog (shared dialog frame, md): sections Audio, Graphics, Gameplay, Accessibility. Reachable from the main menu, the top bar (⚙) and the
 * pause menu: always the same centred dialog. Also owns a small 🔇 'Click to enable sound' hint icon shown while audio is locked/blocked.
 */
export class StSettings extends StElement {
  private readonly dlg: Modal;
  private hint = document.createElement('button');
  private sliders = new Map<VolumeKey, HTMLInputElement>();
  private muteBox = document.createElement('input');
  private loudBox = document.createElement('input');
  private ambBox = document.createElement('input');
  private musicBox = document.createElement('input');
  private pauseBox = document.createElement('input');
  private linksBox = document.createElement('div');
  private gameSec = document.createElement('div');
  private gfxSec = document.createElement('div');
  private cosSec = document.createElement('div');
  private cosOff: (() => void) | null = null;
  private readonly resetDlg: Modal;
  private cosWrap: HTMLElement | null = null;
  private settings: AudioSettings | null = null;
  private engine: SettingsEngine | null = null;
  private game: GameSettingsApi | null = null;
  private gfxSel: StSelect | null = null;
  private nightsBox: HTMLInputElement | null = null;
  private slowBox: HTMLInputElement | null = null;
  private fxSel: StSelect | null = null;
  private touchSel: StSelect | null = null;
  private paletteSel: StSelect | null = null;
  private hintsBox: HTMLInputElement | null = null;
  private motionBox = document.createElement('input');
  private scaleRange = document.createElement('input');
  private scaleVal = document.createElement('span');

  protected css(): string {
    return ':host{position:absolute;left:8px;top:50px}' +
      '.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.row input[type=range]{flex:1;min-width:max(40px,var(--touch-min,0px) * 2.4);width:0}.row label{min-width:84px;font-weight:700;color:#cfe0f5}.v{flex:none;width:34px;text-align:right;color:#ffd070;font-variant-numeric:tabular-nums}' +
      '.chk{display:flex;gap:10px;align-items:center;cursor:pointer;min-height:var(--touch-min,0px)}.chk small{color:#9fb4cc;font-size:var(--fs-sm)}.hintbtn{opacity:.85;font-size:16px;padding:2px 6px}.links{display:flex;flex-wrap:wrap;gap:6px}.links:empty{display:none}' +
      '.cos{display:flex;flex-direction:column;gap:8px}.cos .grp{display:flex;flex-direction:column;gap:4px}.cos .grp>label{font-weight:700;color:#cfe0f5;font-size:var(--fs-sm)}.tiles{display:flex;flex-wrap:wrap;gap:6px}' +
      '.tile{display:flex;flex-direction:column;align-items:stretch;gap:3px;width:104px;padding:5px;border-radius:8px;background:#1c2838;border:2px solid #2f4057;color:#dbe7f5;cursor:pointer;text-align:center;font-size:11.5px}.tile:hover:not([disabled]){border-color:#5a7090}.tile.sel{border-color:#e0b84a}.tile[disabled]{cursor:not-allowed;opacity:.62}' +
      '.tile .sw{display:flex;height:16px;border-radius:4px;overflow:hidden}.tile .sw i{flex:1}.tile .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tile .lk{font-size:10px;color:#e0b84a;line-height:1.15;min-height:23px;display:flex;align-items:center;justify-content:center;gap:3px}.tile .lk svg{flex:none}' +
      '.cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;box-sizing:border-box;padding-right:2px}.cols>*{min-width:0}@media (max-width:700px){.cols{grid-template-columns:1fr}}';
  }

  private section(title: string, ...kids: HTMLElement[]): HTMLElement {
    const s = document.createElement('section'); s.className = 'section'; s.dataset.section = title.toLowerCase();
    const h = document.createElement('h3'); h.textContent = title;
    s.append(h, ...kids); return s;
  }
  private chk(box: HTMLInputElement, text: string, title: string, apply: (on: boolean) => void): HTMLElement {
    box.type = 'checkbox'; box.className = 'toggle';
    const l = document.createElement('label');
    l.className = 'chk'; l.title = title;
    l.append(box, document.createTextNode(text));
    box.addEventListener('change', () => apply(box.checked));
    return l;
  }

  constructor() {
    super();
    this.dlg = new Modal(this.root, { title: 'Settings', icon: '⚙', size: 'md', pausesGame: true, onOpen: () => this.setAttribute('open', ''), onClose: () => this.removeAttribute('open') });
    this.hint.className = 'hintbtn';
    this.hint.append(icon('mute', 16)); this.hint.setAttribute('aria-label', 'Click to enable sound');
    this.hint.title = 'Click to enable sound';
    this.hint.hidden = true;
    this.hint.addEventListener('click', () => { /* the global first-gesture listener unlocks audio; this just gives the user a target */ });
    const audio: HTMLElement[] = [];
    for (const k of VOLUME_KEYS) {
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('label');
      label.textContent = LABELS[k];
      const s = document.createElement('input');
      s.type = 'range'; s.min = '0'; s.max = '100'; s.step = '1'; s.value = '0'; s.setAttribute('aria-label', `${LABELS[k]} volume`);
      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = '0';
      s.addEventListener('input', () => { this.settings?.set({ [k]: Number(s.value) / 100 }); v.textContent = s.value; });
      row.append(label, s, v);
      audio.push(row);
      this.sliders.set(k, s);
    }
    audio.push(
      this.chk(this.muteBox, 'Mute all (M)', 'Mute everything; also muted automatically while the tab is hidden', (on) => this.settings?.set({ muted: on })),
      this.chk(this.musicBox, 'Music', 'Generative background music on / off', (on) => this.settings?.set({ musicOn: on })),
      this.chk(this.pauseBox, 'Pause music at speed 0', 'Fade the music out while the game is paused', (on) => this.settings?.set({ pauseMusicAtZero: on })),
    );
    this.gfxSec.className = 'section-body'; this.gfxSec.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    this.gameSec.className = 'section-body'; this.gameSec.style.cssText = 'display:flex;flex-direction:column;gap:8px;align-items:flex-start';
    this.linksBox.className = 'links';
    const access = [
      this.chk(this.loudBox, 'Reduce loud sounds', 'Lower master ceiling; alarms, avalanche and bankruptcy sounds get quieter', (on) => this.settings?.set({ reduceLoud: on })),
      this.chk(this.ambBox, 'Ambience only', 'Silence effects and music, keep wind, birds and the crowd', (on) => this.settings?.set({ ambienceOnly: on })),
    ];
    // Reduced motion + UI scale live in the shared accessibility store (ui/accessibility.ts): every system reads it from there.
    const a11y = accessibility();
    access.push(this.chk(this.motionBox, 'Reduced motion', 'Calmer camera and effects, no decorative animations (defaults to your system setting)', (on) => a11y.set({ reducedMotion: on })));
    const scaleRow = document.createElement('div'); scaleRow.className = 'row'; scaleRow.dataset.row = 'ui-scale';
    const scaleLabel = document.createElement('label'); scaleLabel.textContent = 'Text size';
    const sr = this.scaleRange; sr.type = 'range'; sr.min = String(UI_SCALE_MIN); sr.max = String(UI_SCALE_MAX); sr.step = String(UI_SCALE_STEP); sr.value = '100'; sr.setAttribute('aria-label', 'UI text size, percent');
    this.scaleVal.className = 'v'; this.scaleVal.style.width = '44px';
    sr.addEventListener('input', () => a11y.set({ uiScale: Number(sr.value) }));
    scaleRow.append(scaleLabel, sr, this.scaleVal);
    access.push(scaleRow);
    // Touch controls (Auto follows `(pointer: coarse)`) and the colour-blind-safe palette (Okabe-Ito based): both in the shared accessibility store.
    const selRow = (key: string, label: string, sel: StSelect, tip: string): HTMLElement => { const r = document.createElement('div'); r.className = 'row'; r.dataset.row = key; const l = document.createElement('label'); l.textContent = label; sel.title = tip; r.append(l, sel); return r; };
    this.touchSel = makeSelect([{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], a11y.get().touch, 'Touch controls', (v) => a11y.set({ touch: v === 'on' || v === 'off' ? v : 'auto' }));
    access.push(selRow('touch', 'Touch controls', this.touchSel, 'On-screen controls, bigger targets, one-finger pan / pinch zoom / twist rotate. Auto = on for touch screens.'));
    this.paletteSel = makeSelect([{ value: 'default', label: 'Default' }, { value: 'cbsafe', label: 'Colour-blind safe' }], a11y.get().palette, 'Colour palette', (v) => a11y.set({ palette: v === 'cbsafe' ? 'cbsafe' : 'default' }));
    access.push(selRow('palette', 'Colour palette', this.paletteSel, 'Piste difficulty, overlays and status colours from the Okabe-Ito colour-blind-safe set.'));
    this.track(a11y.subscribe(() => this.sync()));
    const audioSec = this.section('Audio', ...audio), gfx = this.section('Graphics', this.gfxSec), gp = this.section('Gameplay', this.gameSec, this.linksBox), acc = this.section('Accessibility', ...access);
    this.cosSec.className = 'cos';
    const cos = this.section('Cosmetics', this.cosSec); cos.hidden = true; cos.dataset.section = 'cosmetics';
    const right = document.createElement('div'); right.style.cssText = 'display:flex;flex-direction:column;gap:10px'; right.append(gfx, gp, acc);
    this.cosWrap = cos;
    const cols = document.createElement('div'); cols.className = 'cols'; cols.append(audioSec, right);
    this.dlg.body.append(cols, cos);
    this.resetDlg = new Modal(this.root, { title: 'Reset profile?', icon: '⚠', size: 'sm', pausesGame: true, label: 'Reset profile' });
    const rb = document.createElement('p'); rb.textContent = 'This clears your achievements, cosmetic unlocks and scenario medals. Your saved games are not touched. This cannot be undone.';
    this.resetDlg.body.append(rb);
    const no = document.createElement('button'); no.className = 'ghost'; no.dataset.action = 'reset-cancel'; no.dataset.autofocus = ''; no.textContent = 'Keep my profile'; no.addEventListener('click', () => this.resetDlg.close());
    const yes = document.createElement('button'); yes.className = 'danger'; yes.dataset.action = 'reset-confirm'; yes.textContent = 'Reset profile';
    yes.addEventListener('click', () => { this.resetDlg.close(); void Promise.resolve(this.game?.profile?.reset()).then(() => this.buildCosmetics()); });
    this.resetDlg.footer.append(no, yes);
    const done = document.createElement('button'); done.className = 'primary'; done.dataset.autofocus = ''; done.textContent = 'Done'; done.addEventListener('click', () => this.dlg.close());
    this.dlg.footer.append(done);
    this.root.append(this.hint);
  }

  /** Connect to the persisted settings + engine state; `links` are extra shortcut buttons; `game` supplies the Graphics / Gameplay rows. */
  bind(settings: AudioSettings, engine: SettingsEngine | null = null, links: SettingsLink[] = [], game: GameSettingsApi | null = null): void {
    this.settings = settings; this.engine = engine; this.game = game;
    this.track(settings.subscribe(() => this.sync()));
    if (engine) this.track(engine.onState(() => this.sync()));
    this.linksBox.replaceChildren();
    for (const l of links) {
      const b = document.createElement('button');
      b.textContent = l.label; if (l.title) b.title = l.title;
      b.addEventListener('click', () => l.run());
      this.linksBox.appendChild(b);
    }
    this.buildGame();
    this.buildCosmetics();
    this.sync();
  }

  /** Cosmetics section + 'Reset profile' (hidden until the host supplies the profile). Applying needs no restart: the host re-skins the scene live. */
  private buildCosmetics(): void {
    this.cosOff?.(); this.cosOff = null;
    const p = this.game?.profile;
    if (this.cosWrap) this.cosWrap.hidden = !p;
    this.cosSec.replaceChildren();
    if (!p) return;
    const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = 'Purely visual rewards from achievements. Locked ones show how to unlock them.';
    this.cosSec.append(hint);
    for (const kind of COSMETIC_KINDS) {
      const grp = document.createElement('div'); grp.className = 'grp'; grp.dataset.cosmetic = kind;
      const l = document.createElement('label'); l.textContent = COSMETIC_KIND_LABEL[kind];
      const tiles = document.createElement('div'); tiles.className = 'tiles';
      for (const t of p.cosmetics.tiles(kind)) {
        const b = document.createElement('button'); b.className = `tile${t.selected ? ' sel' : ''}`; b.type = 'button'; b.dataset.cosmetic = t.def.id; b.disabled = !t.owned;
        b.setAttribute('aria-pressed', String(t.selected)); b.title = t.lock ?? t.def.name;
        const sw = document.createElement('div'); sw.className = 'sw'; for (const c of t.def.swatch) { const i = document.createElement('i'); i.style.background = c; sw.append(i); }
        const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = t.def.name;
        const lk = document.createElement('div'); lk.className = 'lk';
        if (t.lock) lk.append(icon('lock', 11), document.createTextNode(t.lock)); else if (t.selected) lk.textContent = 'In use';
        b.append(sw, nm, lk);
        b.addEventListener('click', () => { if (t.owned && p.cosmetics.select(kind, t.def.id)) this.buildCosmetics(); });
        tiles.append(b);
      }
      grp.append(l, tiles); this.cosSec.append(grp);
    }
    const row = document.createElement('div'); row.className = 'row';
    const reset = document.createElement('button'); reset.className = 'ghost'; reset.dataset.action = 'reset-profile'; reset.textContent = 'Reset profile…'; reset.title = 'Clear achievements, cosmetics and scenario medals (saved games stay)';
    reset.addEventListener('click', () => this.resetDlg.open());
    row.append(reset); this.cosSec.append(row);
    this.cosOff = p.cosmetics.onChange?.(() => { if (this.dlg.isOpen) this.buildCosmetics(); }) ?? null;
  }

  private buildGame(): void {
    const g = this.game;
    this.gfxSec.replaceChildren(); this.gameSec.replaceChildren();
    this.gfxSel = null; this.fxSel = null; this.nightsBox = null; this.slowBox = null; this.hintsBox = null;
    if (g?.quality) {
      const q = g.quality;
      const sel = makeSelect(q.options.map((o) => ({ value: o, label: o[0]!.toUpperCase() + o.slice(1) })), q.get(), 'Graphics quality', (v) => q.set(v));
      sel.title = 'Shadows, resolution, tree detail, particles';
      this.gfxSel = sel;
      const row = document.createElement('div'); row.className = 'row'; const l = document.createElement('label'); l.textContent = 'Quality'; row.append(l, sel);
      this.gfxSec.append(row);
    } else this.gfxSec.append(Object.assign(document.createElement('span'), { className: 'hint', textContent: 'Graphics quality is set per game (top bar once a game runs).' }));
    if (g?.feedback) {
      const f = g.feedback;
      const sel = makeSelect(f.options.map((o) => ({ value: o, label: o[0]!.toUpperCase() + o.slice(1) })), f.get(), 'Feedback intensity', (v) => f.set(v));
      sel.title = 'Money popups, build puffs and celebration effects. Subtle is calm; Off shows none.';
      this.fxSel = sel;
      const row = document.createElement('div'); row.className = 'row'; row.dataset.row = 'feedback';
      const l = document.createElement('label'); l.textContent = 'Feedback intensity'; l.style.minWidth = '120px'; row.append(l, sel);
      this.gameSec.append(row);
    }
    if (g?.fastNights) { const b = this.nightsBox = document.createElement('input'); this.gameSec.append(this.chk(b, 'Fast nights', 'Nights pass about 3× faster; only the pace changes, not the simulation', (on) => g.fastNights!.set(on))); }
    if (g?.rideSlowMo) { const b = this.slowBox = document.createElement('input'); b.dataset.opt = 'rideSlowMo'; this.gameSec.append(this.chk(b, 'Ride-along slow motion', 'Slows the game while you ride along so the guest never looks faster than ~9 tiles/s (no effect at 1×, slow motion at 3× and 10×); off = the current game speed', (on) => g.rideSlowMo!.set(on))); }
    if (g?.walk) {
      const w = g.walk, row = (key: string, text: string, min: number, max: number, step: number, fmt: (v: number) => string, apply: (v: number) => void): void => {
        const r = document.createElement('div'); r.className = 'row'; r.dataset.row = key;
        const l = document.createElement('label'); l.textContent = text; l.style.minWidth = '120px';
        const inp = document.createElement('input'); inp.type = 'range'; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.dataset.opt = key;
        const v = document.createElement('span'); v.className = 'v';
        const cur = (w.get() as unknown as Record<string, number>)[key]!;
        inp.value = String(cur); v.textContent = fmt(cur);
        inp.addEventListener('input', () => { const n = Number(inp.value); v.textContent = fmt(n); apply(n); });
        r.append(l, inp, v); this.gameSec.append(r);
      };
      { // mouse look: Drag (default, the cursor stays free) / Pointer lock (immersive; Alt frees the mouse)
        const r = document.createElement('div'); r.className = 'row'; r.dataset.row = 'mouseLook';
        const l = document.createElement('label'); l.textContent = 'Walk: mouse look'; l.style.minWidth = '120px';
        const sel = makeSelect([{ value: 'drag', label: 'Drag (default)' }, { value: 'lock', label: 'Pointer lock (immersive)' }], w.get().mouseLook, 'Walk mouse look', (v) => w.set({ mouseLook: v === 'lock' ? 'lock' : 'drag' }));
        sel.dataset.opt = 'walk-mouseLook';
        sel.title = 'Drag: hold the left mouse button and drag to look; the cursor is never captured. Pointer lock: the mouse is captured while walking (hold Alt to free it, Esc leaves walk mode).';
        r.append(l, sel); this.gameSec.append(r);
      }
      row('sensitivity', 'Walk: mouse sensitivity', 0.5, 2, 0.1, (n) => `${n.toFixed(1)}×`, (n) => w.set({ sensitivity: n }));
      row('fov', 'Walk: field of view', 60, 100, 1, (n) => `${Math.round(n)}°`, (n) => w.set({ fov: n }));
      const tog = (key: 'invertY' | 'headBob' | 'runToggle', text: string, title: string): void => {
        const b = document.createElement('input'); b.dataset.opt = 'walk-' + key; b.checked = w.get()[key];
        this.gameSec.append(this.chk(b, text, title, (on) => w.set({ [key]: on })));
      };
      tog('invertY', 'Walk: invert mouse Y', 'Moving the mouse up looks down');
      tog('headBob', 'Walk: head bob', 'A gentle step bob and a small field-of-view kick while running (always off with reduced motion)');
      tog('runToggle', 'Walk: run toggle', 'Shift toggles running instead of holding it');
    }
    if (g?.hints) { const b = this.hintsBox = document.createElement('input'); this.gameSec.append(this.chk(b, 'Show hints', g.hints.title ?? 'Contextual tips and the assistant', (on) => g.hints!.set(on))); }
    if (g?.monthSummary) { const b = document.createElement('input'); b.dataset.opt = 'monthSummary'; b.checked = g.monthSummary.get(); this.gameSec.append(this.chk(b, 'Month-end summary', 'Show a small card with income, expenses and net when a month closes', (on) => g.monthSummary!.set(on))); }
    if (g?.yearReport) { const b = document.createElement('input'); b.dataset.opt = 'yearReport'; b.checked = g.yearReport.get(); this.gameSec.append(this.chk(b, 'Year-end report', 'Show the Resort of the Year report (and pause the game) when an in-game year ends. Past reports stay in Finance > Reports', (on) => g.yearReport!.set(on))); }
    if (g?.replayTutorial) { const b = document.createElement('button'); b.textContent = 'Replay tutorial'; b.title = 'Restart the guided tutorial on its own map'; b.addEventListener('click', () => g.replayTutorial!()); this.gameSec.append(b); }
    if (g?.unmuteNews) { const b = document.createElement('button'); b.textContent = 'Unmute news'; b.title = 'Show all news categories again'; b.addEventListener('click', () => g.unmuteNews!()); this.gameSec.append(b); }
    if (!this.gameSec.childElementCount) this.gameSec.append(Object.assign(document.createElement('span'), { className: 'hint', textContent: 'Gameplay options appear once a game is running.' }));
  }

  private sync(): void {
    const a = accessibility().get();
    this.motionBox.checked = a.reducedMotion; this.scaleRange.value = String(a.uiScale); this.scaleVal.textContent = `${a.uiScale}%`;
    if (this.touchSel) this.touchSel.value = a.touch;
    if (this.paletteSel) this.paletteSel.value = a.palette;
    const s = this.settings?.get();
    if (!s) return;
    for (const k of VOLUME_KEYS) {
      const el = this.sliders.get(k)!;
      el.value = String(Math.round(s[k] * 100));
      (el.nextElementSibling as HTMLElement).textContent = el.value;
    }
    this.muteBox.checked = s.muted; this.loudBox.checked = s.reduceLoud; this.ambBox.checked = s.ambienceOnly; this.musicBox.checked = s.musicOn; this.pauseBox.checked = s.pauseMusicAtZero;
    if (this.nightsBox && this.game?.fastNights) this.nightsBox.checked = this.game.fastNights.get();
    if (this.slowBox && this.game?.rideSlowMo) this.slowBox.checked = this.game.rideSlowMo.get();
    if (this.hintsBox && this.game?.hints) this.hintsBox.checked = this.game.hints.get();
    if (this.fxSel && this.game?.feedback) this.fxSel.value = this.game.feedback.get();
    if (this.gfxSel && this.game?.quality) this.gfxSel.value = this.game.quality.get();
    this.hint.hidden = !(this.engine?.needsHint) && !s.muted;
    this.hint.title = s.muted ? 'Sound is muted (M)' : 'Click to enable sound';
  }

  /** Slider value (0..100) for a volume. */
  slider(k: VolumeKey): HTMLInputElement { return this.sliders.get(k)!; }
  /** Programmatic slider change (same path as dragging it). */
  setVolume(k: VolumeKey, v01: number): void { const s = this.sliders.get(k)!; s.value = String(Math.round(v01 * 100)); s.dispatchEvent(new Event('input')); }
  get isOpen(): boolean { return this.dlg.isOpen; }
  get hintVisible(): boolean { return !this.hint.hidden; }
  open(): void { this.sync(); this.buildCosmetics(); this.dlg.open(); }
  close(): void { this.dlg.close(); }
  toggle(force?: boolean): void { if (force ?? !this.dlg.isOpen) this.open(); else this.close(); }
}
