import type { GameBus } from '@/core/events';
import { formatMoney, formatWeatherLine, nextFps, type WeatherHudInfo } from '../format';
import type { RatingBreakdown } from '@/sim/Rating';
import { StElement } from './StElement';
import { icon, weatherIconName } from '../icons';
import type { StRating } from './StRating';

export class StHud extends StElement {
  private moneyEl = document.createElement('span');
  private fpsEl = document.createElement('span');
  private weatherEl = document.createElement('span');
  private tempEl = document.createElement('span');
  private snowEl = document.createElement('span');
  private seasonEl = document.createElement('span');
  private badgeEl = document.createElement('span');
  private guestsEl = document.createElement('span');
  private ratingEl = document.createElement('st-rating') as StRating;
  private guests: (() => { count: number; message: string }) | null = null;
  private weather: { bus: GameBus; get: () => WeatherHudInfo } | null = null;
  private panel: HTMLElement | null = null;
  private frames = 0;
  private last = performance.now();
  private raf = 0;
  private finance: { tip(): string; open(): void } | null = null;
  private bound: { bus: GameBus; getMoney: () => number } | null = null;

  /** Fixed-width card (fills the 260px right column), three nowrap rows: money/rating/guests, season/temp/snowline, progress/fps. Nothing can wrap or clip. */
  protected css(): string {
    return `:host{display:block;box-sizing:border-box;width:100%;max-width:260px}
.panel{box-sizing:border-box;width:100%;flex-direction:column;align-items:stretch;gap:3px;font-size:calc(13px * var(--ui-scale, 1));padding:6px 10px;overflow:hidden}
.row{display:flex;align-items:center;gap:10px;white-space:nowrap;min-width:0}
.row>*{white-space:nowrap}
.row .grow{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.r1{justify-content:space-between;font-weight:600}
.r2{justify-content:space-between;font-size:calc(12px * var(--ui-scale, 1))}
.r3{font-size:calc(11px * var(--ui-scale, 1));color:#b9c6d8;justify-content:space-between}
.fps{flex:0 0 auto;color:#8fa0b8}`;
  }

  constructor() {
    super();
    const p = document.createElement('div');
    p.className = 'panel';
    this.badgeEl.style.cssText = 'background:#2f8f4a;border-radius:4px;padding:1px 6px;font-size:calc(11px * var(--ui-scale, 1))';
    this.badgeEl.hidden = true;
    this.badgeEl.textContent = '-50% summer construction';
    this.guestsEl.dataset.tutorialId = 'hud:guests'; this.weatherEl.dataset.tutorialId = 'hud:season'; // spotlight targets (src/tutorial/ui-targets.ts)
    const row = (cls: string, ...kids: HTMLElement[]): HTMLDivElement => { const d = document.createElement('div'); d.className = `row ${cls}`; d.append(...kids); return d; };
    this.seasonEl.className = 'grow'; this.fpsEl.className = 'fps';
    this.snowEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
    p.append(
      row('r1', this.moneyEl, this.ratingEl, this.guestsEl),
      row('r2', this.weatherEl, this.tempEl, this.snowEl),
      row('r3', this.seasonEl, this.fpsEl),
      row('r3', this.badgeEl),
    );
    this.panel = p;
    this.root.appendChild(p);
  }

  /** Game mode / resort level as the tooltip of the whole card ('Career \u00B7 Level 3 \u00B7 Regional name'); refreshed on day and milestone events. */
  bindLevel(bus: GameBus, get: () => string): void {
    const refresh = (): void => { if (this.panel) this.panel.title = get(); };
    refresh();
    this.listen(bus, 'day:changed', refresh);
    this.listen(bus, 'milestone', refresh);
  }

  /** Money tooltip (month net) and click-through to the Finance drawer. */
  bindFinance(f: { tip(): string; open(): void }): void {
    this.finance = f;
    this.moneyEl.style.cursor = 'pointer';
    this.moneyEl.addEventListener('click', () => f.open());
    this.moneyEl.title = f.tip();
  }

  /** Rating stars + happiness smiley with a breakdown tooltip / panel (Task 27). */
  showRating(): void { this.ratingEl.open(); }
  bindRating(get: () => { breakdown: RatingBreakdown; happiness: number; market?: { share: number; rank: number; of: number } | null }): void { this.ratingEl.bind(get); }

  /** The date/time lives in st-speed-control. */
  bind(bus: GameBus, getMoney: () => number): void {
    this.bound = { bus, getMoney };
    if (this.isConnected) this.attach();
  }

  /** Guest count; when `message` is set (e.g. 'No parking/road access') it explains why nobody arrives. Refreshed twice a second. */
  bindGuests(get: () => { count: number; message: string }): void {
    this.guests = get;
    this.refreshGuests();
  }

  private refreshGuests(): void {
    if (!this.guests) return;
    const g = this.guests();
    this.guestsEl.replaceChildren(icon('guests', 14), ` ${g.count.toLocaleString('en-US')}${g.message ? ` · ${g.message}` : ''}`);
    this.guestsEl.title = g.message || 'Guests in the resort';
  }

  /** Season, temperature, weather icon, snowline and the summer-discount badge; refreshes on day/hour/weather events. */
  bindWeather(bus: GameBus, get: () => WeatherHudInfo): void {
    this.weather = { bus, get };
    if (this.isConnected) this.attachWeather();
  }

  private attachWeather(): void {
    const w = this.weather;
    if (!w) return;
    const refresh = (): void => {
      const i = w.get();
      const line = formatWeatherLine(i);
      this.weatherEl.replaceChildren(icon(weatherIconName(i.kind), 14), ` ${i.season}`);
      this.tempEl.textContent = `${Math.round(i.tempC)}°C`;
      this.snowEl.replaceChildren(icon('mountain', 14), ` ${Math.round(i.snowlineM).toLocaleString('en-US')} m`);
      this.weatherEl.title = this.tempEl.title = line;
      this.snowEl.title = `Snowline: snow settles above ${Math.round(i.snowlineM).toLocaleString('en-US')} m`;
      this.badgeEl.hidden = !i.summerDiscount;
      this.seasonEl.textContent = (i.progress ?? '').replace(/^[^·]*· /, ''); // season name is already in row 2
      this.seasonEl.hidden = !i.progress;
      if (i.progress) this.seasonEl.title = i.daylight ? `${i.progress}\n${i.daylight}` : i.progress;
    };
    refresh();
    for (const ev of ['day:changed', 'time:hour', 'weather:changed', 'season:changed'] as const) this.listen(w.bus, ev, refresh);
  }

  connectedCallback(): void { if (this.bound) this.attach(); if (this.weather) this.attachWeather(); }

  private attach(): void {
    const b = this.bound;
    if (!b) return;
    const refresh = (): void => {
      const m = b.getMoney();
      this.moneyEl.textContent = formatMoney(m);
      this.moneyEl.style.color = m < 0 ? '#ff6a5a' : '';
      this.moneyEl.style.fontWeight = m < 0 ? '700' : '';
      if (this.finance) this.moneyEl.title = this.finance.tip();
    };
    refresh();
    this.listen(b.bus, 'money:changed', refresh);
    const tick = (): void => {
      this.frames++;
      const now = performance.now();
      if (now - this.last >= 500) {
        this.fpsEl.textContent = `${nextFps(this.frames, now - this.last).toFixed(0)} FPS`;
        this.frames = 0;
        this.last = now;
        this.refreshGuests();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.track(() => cancelAnimationFrame(this.raf));
  }
}
