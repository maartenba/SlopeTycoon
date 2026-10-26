import { DAYS_PER_MONTH } from '@/config/balance';
import { makeSelect } from './StSelect';
import { StElement } from './StElement';
import { advanceYear, seasonName } from '@/render/Season';

export interface DebugApi {
  stats(): { fps: number; calls: number; meshes: number; genMs: number; trees: number; rocks: number };
  snowline: { min: number; max: number; value: number; set(v: number): void };
  bloom: { value: number; set(v: number): void };
  autumn: { value: number; set(v: number): void };
  /** Year position 0..1; set() drives trees + terrain (autumn, bloom, snowline) and returns the resulting terrain values so sliders can sync. */
  season: { value: number; set(t: number): { autumn: number; bloom: number; snowline: number }; /** User-driven change: also move the SIM (throttled) so snow depth matches. */ commit?(t: number): void };
  /** Jump the sim date to a day of year (0..359) and settle snow; switches 'Use game clock' back on. */
  jumpToDay?(day: number): void;
  /** 'Use game clock': when true the season follows the Clock; manual slider/auto-cycle turn it off. */
  useClock?: { value: boolean; set(v: boolean): void };
  /** Time-of-day override: get() = current hour (0..24); set(h) locks the time of day for lighting, set(null) = auto (follow clock). */
  time?: { get(): number; set(h: number | null): void };
  /** Fast nights time warp (pacing only). */
  fastNights?: { get(): boolean; set(v: boolean): void };
  /** Per-system profiler text (avg/p95 ms). */
  profile?(): string;
  /** Shader-compile guard summary ('Render problems: N ...'). */
  renderProblems?(): string;
  /** Render QA toggles + a copyable state dump (zoom, LOD, season weights, uniforms, light intensities, chunk counts). */
  render?: {
    forceFullRes: { get(): boolean; set(v: boolean): void };
    lodColours: { get(): boolean; set(v: boolean): void };
    disableNight: { get(): boolean; set(v: boolean): void };
    dump(): string;
  };
}

export class StDebug extends StElement {
  private statsEl = document.createElement('div');
  private inputEl = document.createElement('div');
  private body = document.createElement('div');
  private panelEl: HTMLElement | null = null;
  private api: DebugApi | null = null;
  private timer = 0;
  private extraRefresh: Array<() => void> = [];
  private timeSync: (() => void) | null = null;
  private profEl = document.createElement('pre');
  private raf = 0;
  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'F3') { e.preventDefault(); this.toggle(); }
  };

  protected css(): string {
    return ':host{position:absolute;left:8px;bottom:8px;font-family:monospace}:host(.open){bottom:auto;top:80px}.panel:not(.open) .inputline{display:none}.panel{flex-direction:column;align-items:stretch}label{display:flex;gap:6px;justify-content:space-between;align-items:center}.panel{box-sizing:border-box}.panel.open{width:300px;max-height:max(140px,calc(100vh - 540px));overflow:auto;overflow-x:hidden}.panel.open label{flex-wrap:wrap}.panel label>input[type=range]{min-width:0;flex:1 1 90px;max-width:100%}.panel button{white-space:nowrap}.season{display:flex;flex-direction:column;gap:3px;padding:4px;background:rgba(224,160,48,0.18);border:1px solid #e0a030;border-radius:4px;font-size:13px;font-weight:600}.season input[type=range]{width:100%;height:22px}.ticks{display:flex;justify-content:space-between;font-size:11px;font-weight:400}.ticks span{flex:1;text-align:center}';
  }

  constructor() {
    super();
    const p = document.createElement('div');
    p.className = 'panel';
    const t = document.createElement('button');
    t.textContent = 'Debug (F3)'; t.setAttribute('aria-label', 'Toggle debug panel (F3)'); t.style.fontSize = '11px';
    t.addEventListener('click', () => this.toggle());
    this.body.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    this.panelEl = p;
    this.body.hidden = true; // collapsed by default (F3 or click to open)
    this.inputEl.className = 'inputline';
    this.inputEl.style.cssText = 'font-size:11px;white-space:pre-wrap;max-width:300px';
    this.inputEl.textContent = 'input: (click the map)';
    p.append(t, this.inputEl, this.body);
    this.root.appendChild(p);
  }

  /** Last-input diagnostic line (always visible next to the Debug button). */
  setInputLine(text: string): void { this.inputEl.textContent = text; }

  toggle(): void { this.body.hidden = !this.body.hidden; this.panelEl?.classList.toggle('open', !this.body.hidden); this.classList.toggle('open', !this.body.hidden); this.refresh(); }

  bind(api: DebugApi): void {
    this.api = api;
    const slider = (label: string, min: number, max: number, step: number, v: number, f: (n: number) => void): HTMLInputElement => {
      const row = document.createElement('label');
      row.append(label);
      const i = document.createElement('input');
      i.type = 'range';
      i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(v);
      i.addEventListener('input', () => f(Number(i.value)));
      row.appendChild(i);
      this.body.appendChild(row);
      return i;
    };
    const snow = slider('snowline', api.snowline.min, api.snowline.max, 0.5, api.snowline.value, api.snowline.set);
    const bloom = slider('spring bloom', 0, 1, 0.01, api.bloom.value, api.bloom.set);
    const autumn = slider('autumn', 0, 1, 0.01, api.autumn.value, api.autumn.set);

    // Season control (prominent): continuous year slider + labels, auto-cycle with speed. Drives trees, terrain autumn/bloom, snowline.
    const box = document.createElement('div');
    box.className = 'season';
    const title = document.createElement('div');
    const year = document.createElement('input');
    year.type = 'range'; year.min = '0'; year.max = '1'; year.step = '0.001'; year.value = String(api.season.value);
    const ticks = document.createElement('div');
    ticks.className = 'ticks';
    for (const n of ['Spring', 'Summer', 'Autumn', 'Winter']) { const s = document.createElement('span'); s.textContent = n; ticks.appendChild(s); }
    const cycleRow = document.createElement('label');
    const cycle = document.createElement('input');
    cycle.type = 'checkbox';
    cycleRow.append(cycle, ' auto-cycle');
    const speed = document.createElement('input');
    speed.type = 'range'; speed.min = '0.1'; speed.max = '6'; speed.step = '0.1'; speed.value = '1.5';
    const speedLbl = document.createElement('span');
    cycleRow.append(speed, speedLbl);
    const syncLabels = (): void => {
      title.textContent = `Season: ${seasonName(Number(year.value))} (${Number(year.value).toFixed(2)})`;
      speedLbl.textContent = `${Number(speed.value).toFixed(1)} yr/min`;
    };
    const apply = (t: number): void => {
      const r = api.season.set(t);
      snow.value = String(r.snowline); bloom.value = String(r.bloom); autumn.value = String(r.autumn);
      syncLabels();
    };
    this.syncSeason = (t, r): void => { year.value = String(t); snow.value = String(r.snowline); bloom.value = String(r.bloom); autumn.value = String(r.autumn); syncLabels(); };
    const manual = (): void => { clockBox.checked = false; api.useClock?.set(false); };
    year.addEventListener('input', () => { manual(); apply(Number(year.value)); api.season.commit?.(Number(year.value)); });
    speed.addEventListener('input', syncLabels);
    let last = 0;
    const loop = (now: number): void => {
      if (!cycle.checked) { this.raf = 0; return; }
      const dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
      last = now;
      const t = advanceYear(Number(year.value), dt, Number(speed.value));
      year.value = String(t);
      apply(t);
      api.season.commit?.(t);
      this.raf = requestAnimationFrame(loop);
    };
    cycle.addEventListener('change', () => {
      last = 0;
      if (cycle.checked) manual();
      if (cycle.checked && !this.raf) this.raf = requestAnimationFrame(loop);
    });
    const clockRow = document.createElement('label');
    const clockBox = document.createElement('input');
    clockBox.type = 'checkbox';
    clockBox.checked = api.useClock?.value ?? false;
    clockBox.addEventListener('change', () => { api.useClock?.set(clockBox.checked); if (clockBox.checked && cycle.checked) { cycle.checked = false; } });
    clockRow.append(clockBox, ' Use game clock');
    this.syncClock = (v) => { clockBox.checked = v; };
    const nightsRow = document.createElement('label');
    if (api.fastNights) {
      const nb = document.createElement('input');
      nb.type = 'checkbox'; nb.checked = api.fastNights.get();
      nb.addEventListener('change', () => api.fastNights?.set(nb.checked));
      nightsRow.append(nb, ' Fast nights (time warp)');
    }
    const jumpRow = document.createElement('div');
    jumpRow.className = 'jump';
    if (api.jumpToDay) {
      const month = makeSelect(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => ({ value: String(i), label: m })), '0', 'Month');
      month.style.minWidth = '64px';
      const dom = document.createElement('input');
      dom.type = 'number'; dom.min = '1'; dom.max = String(DAYS_PER_MONTH); dom.value = '1'; dom.style.width = '48px';
      const go = document.createElement('button');
      go.textContent = 'Jump to date';
      go.title = 'Move the game date (forward in time) and instantly settle snow, weather and piste status';
      go.addEventListener('click', () => {
        const d = Math.max(1, Math.min(DAYS_PER_MONTH, Math.floor(Number(dom.value) || 1)));
        api.jumpToDay?.(Number(month.value) * DAYS_PER_MONTH + d - 1);
      });
      jumpRow.append(month, dom, go);
    }
    box.append(title, year, ticks, clockRow, cycleRow, nightsRow, jumpRow);
    this.body.insertBefore(box, this.body.firstChild);
    apply(api.season.value);
    if (api.time) {
      const t = api.time;
      const row = document.createElement('label');
      const tl = document.createElement('span');
      const tr = document.createElement('input');
      tr.type = 'range'; tr.min = '0'; tr.max = '24'; tr.step = '0.1'; tr.value = String(t.get());
      const auto = document.createElement('input');
      auto.type = 'checkbox'; auto.checked = true;
      const fmt = (h: number): string => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
      tl.textContent = `time ${fmt(t.get())}`;
      tr.addEventListener('input', () => { auto.checked = false; t.set(Number(tr.value)); tl.textContent = `time ${fmt(Number(tr.value))}`; });
      auto.addEventListener('change', () => t.set(auto.checked ? null : Number(tr.value)));
      row.append(tl, tr, auto, 'auto');
      this.body.appendChild(row);
      this.timeSync = (): void => { if (auto.checked) { const h = t.get(); tr.value = String(h); tl.textContent = `time ${fmt(h)}`; } };
    }
    if (api.render) {
      const r = api.render;
      const toggle = (label: string, g: { get(): boolean; set(v: boolean): void }): void => {
        const row = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = g.get();
        cb.addEventListener('change', () => g.set(cb.checked));
        row.append(cb, ' ' + label);
        this.body.appendChild(row);
      };
      toggle('Force full-res terrain (no LOD)', r.forceFullRes);
      toggle('Show LOD colours (red=far, green=full, blue=protected)', r.lodColours);
      toggle('Disable night darkening', r.disableNight);
      const copy = document.createElement('button');
      copy.textContent = 'Copy render state';
      const out = document.createElement('textarea');
      out.rows = 6; out.readOnly = true; out.style.cssText = 'font-size:10px;width:100%;box-sizing:border-box';
      copy.addEventListener('click', () => {
        const text = r.dump();
        out.value = text;
        void navigator.clipboard?.writeText(text).catch(() => { out.select(); });
      });
      this.body.append(copy, out);
    }
    this.statsEl.style.whiteSpace = 'pre-wrap';
    this.body.appendChild(this.statsEl);
    this.profEl.style.cssText = 'margin:0;font-size:10px;white-space:pre-wrap';
    this.body.appendChild(this.profEl);
    for (const el of this.sections) this.body.appendChild(el);
  }

  private sections: HTMLElement[] = [];
  private syncClock: (v: boolean) => void = () => {};
  /** Reflect the 'Use game clock' state changed elsewhere. */
  setUseClock(v: boolean): void { this.syncClock(v); }
  /** Append an extra section (e.g. event log) to the panel; `refresh` runs while the panel is open. */
  addSection(el: HTMLElement, refresh?: () => void): void {
    this.sections.push(el);
    if (refresh) this.extraRefresh.push(refresh);
    if (this.api) this.body.appendChild(el);
  }

  /** Set from bind(): updates the season slider/labels when changed elsewhere (e.g. dock quick-links). */
  private syncSeason: (t: number, r: { autumn: number; bloom: number; snowline: number }) => void = () => {};
  setSeason(t: number, r: { autumn: number; bloom: number; snowline: number }): void { this.syncSeason(t, r); }

  connectedCallback(): void {
    window.addEventListener('keydown', this.onKey);
    this.timer = window.setInterval(() => this.refresh(), 500);
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this.onKey);
    clearInterval(this.timer);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    super.disconnectedCallback();
  }

  private refresh(): void {
    if (!this.api || this.body.hidden) return;
    this.timeSync?.();
    if (this.api.profile) this.profEl.textContent = this.api.profile();
    for (const r of this.extraRefresh) r();
    const s = this.api.stats();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const heap = mem ? `${(mem.usedJSHeapSize / 1048576).toFixed(0)}MB` : 'n/a';
    this.statsEl.textContent =
      `fps ${s.fps.toFixed(0)} | calls ${s.calls} | terrain meshes ${s.meshes} | ` +
      `trees ${s.trees} rocks ${s.rocks} | gen ${s.genMs.toFixed(0)}ms | heap ${heap}` + (this.api.renderProblems ? `\n${this.api.renderProblems()}` : '');
  }
}

