import type { GameBus, Speed } from '@/core/events';
import type { GameDate } from '@/core/GameState';
import { seasonOf } from '@/sim/Clock';
import { formatClock } from '../format';
import { warpIndicator } from '@/core/pacing';
import { StElement } from './StElement';
import { icon } from '../icons';
import { modalPause } from '../modalPauseGate';

export interface SpeedControlApi {
  bus: GameBus;
  getSpeed(): Speed;
  setSpeed(s: Speed): void;
  getDate(): GameDate;
  /** 'Fast nights' time warp: setting toggle + current warp factor (>= 1) for the HUD indicator. */
  fastNights?: { get(): boolean; set(v: boolean): void; warp(): number };
  /** Fast-forward ('Skip to...'): menu entries, start (returns an error text when refused) / cancel and live progress for the pill. */
  skip?: {
    options: Array<{ id: string; label: string; hint: string }>;
    start(id: string): string | null;
    cancel(): void;
    canStart(): string | null;
    active(): boolean;
    progress(): { label: string; fraction: number; daysLeft: number; etaSeconds: number | null; daysPerSecond: number } | null;
  };
}

const LABELS: Array<[Speed, string, string]> = [[0, '', 'Pause (Space)'], [1, '1×', 'Normal speed: 1 day ≈ 2½ min (150 s)'], [2, '3×', 'Fast (+ / .): 1 day ≈ 50 s'], [3, '10×', 'Fastest (+ / .): 1 day ≈ 15 s (≈ 10 s with fast nights)']];

/** Pause / 1× / 3× / 10× buttons plus 'Y1 · Day 12 · 14:30' and the season. */
export class StSpeedControl extends StElement {
  private btns = new Map<Speed, HTMLButtonElement>();
  private dateEl = document.createElement('span');
  private seasonEl = document.createElement('span');
  private nightBtn = document.createElement('button');
  private skipBtn = document.createElement('button');
  private menuEl = document.createElement('div');
  private pillEl = document.createElement('div');
  private pillTitle = document.createElement('span');
  private pillSub = document.createElement('span');
  private pillBar = document.createElement('i');
  private warpEl = document.createElement('span');
  private holdEl = document.createElement('span');
  private api: SpeedControlApi | null = null;
  private timer = 0;

  protected css(): string {
    return `:host{display:block;box-sizing:border-box;width:100%;max-width:260px}
.panel{box-sizing:border-box;width:100%;flex-direction:column;align-items:stretch;gap:4px;font-size:calc(12px * var(--ui-scale, 1));padding:6px 8px;overflow:hidden}
.btns{display:flex;gap:4px;align-items:center;flex-wrap:nowrap}
.btns button{min-width:32px;height:26px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center}
.btns .sp{flex:1}
.when{display:flex;align-items:baseline;justify-content:space-between;gap:8px;white-space:nowrap;min-width:0;line-height:1.2}
.when .d{overflow:hidden;text-overflow:ellipsis;min-width:0}
.when .s{text-transform:capitalize;color:var(--c-accent-text,#ffd070);flex:none}
.skipwrap{position:relative;flex:none}
.menu{position:fixed;z-index:60;min-width:200px;display:flex;flex-direction:column;gap:2px;padding:4px;background:#141c28;border:1px solid #4a6080;border-radius:var(--r-md);box-shadow:0 8px 24px rgba(0,0,0,.6)}
.menu button{display:flex;flex-direction:column;align-items:flex-start;gap:0;text-align:left;background:transparent;border-color:transparent;padding:4px 8px;font-weight:700}
.menu button small{font-weight:400;color:var(--c-muted);font-size:calc(11px * var(--ui-scale, 1))}
.menu button:hover:not(:disabled),.menu button:focus-visible{background:rgba(255,255,255,.1);border-color:#6f8bb0}
.menu .note{padding:2px 8px 4px;color:var(--c-muted);font-size:calc(11px * var(--ui-scale, 1))}
.pill{position:fixed;bottom:88px;left:50%;transform:translateX(-50%);z-index:55;display:flex;align-items:center;gap:10px;padding:6px 10px 6px 12px;background:rgba(16,24,36,.94);border:1px solid #f0b040;border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.55);white-space:nowrap;font-weight:700;max-width:calc(100vw - 24px)}
.pill .spin{width:14px;height:14px;border:2px solid #f0b04066;border-top-color:#f0b040;border-radius:50%;animation:spin .8s linear infinite;flex:none}
.pill .bar{width:96px;height:6px;border-radius:3px;background:#2b3d54;overflow:hidden;flex:none}.pill .bar>i{display:block;height:100%;width:0;background:#f0b040}
.pill .txt{display:flex;flex-direction:column;line-height:1.15}.pill .sub{font-weight:400;color:var(--c-muted);font-size:calc(11px * var(--ui-scale, 1))}
.pill button{padding:2px 10px;height:24px}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.pill .spin{animation:none}}
.hold{flex:none;font-weight:800;font-size:calc(11px * var(--ui-scale, 1));color:#ffd070;background:#3a2c10;border:1px solid #f0b04088;border-radius:999px;padding:0 8px;line-height:18px;white-space:nowrap}.hold[hidden]{display:none}
.warp{color:#9bb8ff;font-weight:700;white-space:nowrap;flex:none}.warp:empty{display:none}`;
  }

  constructor() {
    super();
    const p = document.createElement('div');
    p.className = 'panel';
    const btns = document.createElement('div'); btns.className = 'btns';
    for (const [s, label, title] of LABELS) {
      const b = document.createElement('button');
      if (s === 0) b.append(icon('pause', 14)); else b.textContent = label;
      b.title = title; b.setAttribute('aria-label', title);
      b.addEventListener('click', () => { this.api?.setSpeed(s); b.blur(); }); // blur: Space must not re-click the button
      this.btns.set(s, b);
      btns.appendChild(b);
    }
    this.nightBtn.append(icon('moon', 14)); this.nightBtn.hidden = true; this.nightBtn.setAttribute('aria-label', 'Fast nights');
    this.nightBtn.addEventListener('click', () => { const f = this.api?.fastNights; if (f) { f.set(!f.get()); this.refreshNights(); } this.nightBtn.blur(); });
    this.warpEl.className = 'warp'; this.warpEl.title = 'Fast nights: time is skipping ahead through the night';
    const sp = document.createElement('span'); sp.className = 'sp';
    this.skipBtn.append(icon('next', 14)); this.skipBtn.hidden = true;
    this.skipBtn.title = 'Skip to… (K = next month)'; this.skipBtn.setAttribute('aria-label', 'Skip to…');
    this.skipBtn.setAttribute('aria-haspopup', 'menu'); this.skipBtn.setAttribute('aria-expanded', 'false');
    this.skipBtn.addEventListener('click', () => (this.menuEl.hidden ? this.openMenu() : this.closeMenu(true)));
    this.skipBtn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && this.menuEl.hidden) { e.preventDefault(); this.openMenu(); } });
    this.menuEl.className = 'menu'; this.menuEl.setAttribute('role', 'menu'); this.menuEl.setAttribute('aria-label', 'Skip to'); this.menuEl.hidden = true;
    this.menuEl.addEventListener('keydown', (e) => this.menuKey(e));
    this.holdEl.className = 'hold'; this.holdEl.hidden = true; this.holdEl.textContent = '⏸ Paused'; this.holdEl.dataset.role = 'dialog-pause';
    this.holdEl.title = 'The game is paused while a dialog (Settings, Help, Save & load…) is open; it resumes when you close it.';
    this.holdEl.setAttribute('role', 'status');
    btns.append(sp, this.warpEl, this.nightBtn, this.skipBtn);
    const when = document.createElement('div');
    when.className = 'when';
    this.dateEl.className = 'd'; this.seasonEl.className = 's';
    when.append(this.dateEl, this.holdEl, this.seasonEl);
    p.append(btns, when);
    this.root.appendChild(p);
    this.root.appendChild(this.menuEl);
    // Fast-forward pill (a status region: spinner, 'Fast-forwarding… to next season', days left / ETA, progress bar, Cancel)
    this.pillEl.className = 'pill'; this.pillEl.hidden = true; this.pillEl.setAttribute('role', 'status'); this.pillEl.setAttribute('aria-live', 'polite');
    const spin = document.createElement('span'); spin.className = 'spin'; spin.setAttribute('aria-hidden', 'true');
    const txt = document.createElement('span'); txt.className = 'txt'; this.pillTitle.className = 't'; this.pillSub.className = 'sub'; txt.append(this.pillTitle, this.pillSub);
    const bar = document.createElement('span'); bar.className = 'bar'; bar.append(this.pillBar);
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.title = 'Cancel fast-forward (Esc / Space / any click)'; cancel.addEventListener('click', () => this.api?.skip?.cancel());
    this.pillEl.append(spin, txt, bar, cancel);
    this.root.appendChild(this.pillEl);
  }

  private menuItems(): HTMLButtonElement[] { return [...this.menuEl.querySelectorAll('button')] as HTMLButtonElement[]; }

  private openMenu(): void {
    const sk = this.api?.skip;
    if (!sk) return;
    this.menuEl.textContent = '';
    const why = sk.canStart();
    for (const o of sk.options) {
      const b = document.createElement('button'); b.setAttribute('role', 'menuitem'); b.disabled = !!why;
      const t = document.createElement('span'); t.textContent = o.label; const h = document.createElement('small'); h.textContent = o.hint;
      b.append(t, h);
      b.addEventListener('click', () => { this.closeMenu(false); this.api?.skip?.start(o.id); });
      this.menuEl.appendChild(b);
    }
    if (why) { const n = document.createElement('div'); n.className = 'note'; n.textContent = why; this.menuEl.appendChild(n); }
    const r = this.skipBtn.getBoundingClientRect();
    this.menuEl.style.top = `${Math.round(r.bottom + 4)}px`;
    this.menuEl.style.left = `${Math.max(4, Math.round(Math.min(r.right - 200, window.innerWidth - 210)))}px`;
    this.menuEl.hidden = false; this.skipBtn.setAttribute('aria-expanded', 'true');
    (this.menuItems().find((b) => !b.disabled) ?? this.skipBtn).focus();
    const off = (ev: Event): void => { if (!ev.composedPath().includes(this)) this.closeMenu(false); };
    window.addEventListener('pointerdown', off, true);
    this.menuOff = () => window.removeEventListener('pointerdown', off, true);
  }
  private menuOff: (() => void) | null = null;

  private closeMenu(focus: boolean): void {
    this.menuOff?.(); this.menuOff = null;
    this.menuEl.hidden = true; this.skipBtn.setAttribute('aria-expanded', 'false');
    if (focus) this.skipBtn.focus();
  }

  private menuKey(e: KeyboardEvent): void {
    const items = this.menuItems().filter((b) => !b.disabled);
    const i = items.indexOf(this.root.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeMenu(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === 'Tab') this.closeMenu(false);
  }

  private refreshPill(): void {
    const sk = this.api?.skip;
    const pr = sk?.active() ? sk.progress() : null;
    this.pillEl.hidden = !pr;
    if (!pr) return;
    this.pillTitle.textContent = `Fast-forwarding to ${pr.label}…`;
    const d = Math.max(0, Math.ceil(pr.daysLeft));
    this.pillSub.textContent = `${d} day${d === 1 ? '' : 's'} to go${pr.etaSeconds !== null ? ` · about ${Math.max(1, Math.round(pr.etaSeconds))} s` : ''} · Esc / Space / click cancels`;
    this.pillBar.style.width = `${Math.round(pr.fraction * 100)}%`;
  }

  bind(api: SpeedControlApi): void {
    this.api = api;
    if (this.isConnected) this.attach();
  }

  private refreshNights(): void {
    const f = this.api?.fastNights;
    this.nightBtn.hidden = !f;
    this.skipBtn.hidden = !this.api?.skip;
    if (!f) return;
    const on = f.get();
    this.nightBtn.classList.toggle('active', on);
    this.nightBtn.title = on ? 'Fast nights ON: nights pass about 3× faster (click to turn off)' : 'Fast nights OFF (click to turn on)';
    this.warpEl.textContent = this.api && on && this.api.getSpeed() > 0 ? warpIndicator(f.warp()) : '';
  }

  connectedCallback(): void { if (this.api) this.attach(); }

  private attach(): void {
    const a = this.api;
    if (!a) return;
    const refresh = (): void => {
      const sp = a.getSpeed();
      for (const [s, b] of this.btns) b.classList.toggle('active', s === sp);
      const d = a.getDate();
      this.dateEl.textContent = formatClock(d);
      this.seasonEl.textContent = seasonOf(d);
      this.holdEl.hidden = !modalPause.active;
      this.refreshNights();
      this.refreshPill();
    };
    refresh();
    this.listen(a.bus, 'speed:changed', refresh);
    this.listen(a.bus, 'day:changed', refresh);
    const offHold = modalPause.subscribe(refresh);
    this.timer = window.setInterval(refresh, 120); // minutes advance every tick; throttled text update
    this.track(() => { clearInterval(this.timer); this.menuOff?.(); offHold(); });
  }
}
