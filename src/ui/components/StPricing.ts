import { CLASS_LABEL, PRESETS, PRICE_TABS, PROFILE_LABEL, formatPrice, multLabel, priceRows, scheduleCells, todayLine, verdictLabel, type PriceRow } from '../pricingFormat';
import { DAY_CLASSES, SCHEDULE_PROFILES, SCHEDULE_RANGE, type DayClass, type ScheduleProfile } from '../../config/marketing';
import type { Pricing } from '../../sim/Pricing';
import { StElement } from './StElement';

export interface PricingApi {
  pricing: Pricing;
  set(key: string, v: number): void;
  setFree(key: string, on: boolean): void;
  reset(key: string): void;
  resetAll(): void;
  preset(factor: number): void;
  setSchedule(profile: ScheduleProfile, cls: DayClass, m: number): void;
  setPowder(on: boolean): void;
  /** Revenue to date for a key (attraction stats), or null when unknown. */
  revenue?(key: string): number | null;
}

const css = `
:host{display:block;flex:1;min-width:0}
.wrap{display:flex;flex-direction:column;gap:4px;max-height:min(34vh,340px);overflow:auto}
.tabs,.bar{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.row{display:grid;grid-template-columns:150px 1fr 70px 110px 90px;gap:6px;align-items:center;font-size:11px}
.row input[type=range]{width:100%}
.gauge{position:relative;height:8px;border-radius:4px;background:linear-gradient(90deg,#4a8fd4,#6ac46a 35%,#6ac46a 55%,#d45a4a)}
.gauge>i{position:absolute;top:-2px;width:3px;height:12px;background:#fff;border-radius:2px}
.muted{color:#aab}.cheap{color:#7ab8ff}.fair{color:#8fe08f}.expensive{color:#ff9a8a}
table{border-collapse:collapse;font-size:11px}td,th{padding:2px 6px;text-align:center}
`;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Pricing drawer: tabs (Lifts & passes, Attractions, Lodging, Food & shops, Seasonal schedule), steppers + sliders, fair-value gauge, presets. */
export class StPricing extends StElement {
  private api: PricingApi | null = null;
  private wrap = el('div', 'wrap');
  private tab: (typeof PRICE_TABS)[number]['id'] = 'lifts';
  private pending = false;

  protected css(): string { return css; }
  constructor() { super(); this.root.appendChild(this.wrap); }

  bind(api: PricingApi): void { this.api = api; this.refresh(); }
  requestRefresh(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.refresh(); });
  }

  private rowEl(a: PricingApi, r: PriceRow): HTMLElement {
    const row = el('div', 'row');
    const step = (d: number): void => a.set(r.key, r.price + d);
    const slider = el('input'); slider.type = 'range'; slider.min = String(r.min); slider.max = String(r.max); slider.step = '1'; slider.value = String(r.price); slider.disabled = r.free;
    const val = el('span', '', r.free ? 'Free' : formatPrice(r.price, r.percent));
    slider.addEventListener('input', () => { val.textContent = formatPrice(Number(slider.value), r.percent); });
    slider.addEventListener('change', () => { a.set(r.key, Number(slider.value)); this.refresh(); });
    const minus = el('button', '', '−'), plus = el('button', '', '+');
    minus.addEventListener('click', () => { step(-1); this.refresh(); });
    plus.addEventListener('click', () => { step(1); this.refresh(); });
    const ctl = el('div', 'bar'); ctl.append(minus, slider, plus);
    const gauge = el('div', 'gauge'), mark = el('i'); mark.style.left = `${r.gauge}%`; gauge.appendChild(mark);
    const info = el('div', r.verdict);
    info.textContent = `${verdictLabel(r.verdict)} · demand ${r.demandPct}%`;
    const rev = a.revenue?.(r.key);
    const tail = el('div', 'bar');
    const reset = el('button', '', '↺'); reset.title = `Reset to default (${formatPrice(r.def, r.percent)})`; reset.disabled = !r.overridden;
    reset.addEventListener('click', () => { a.reset(r.key); this.refresh(); });
    tail.appendChild(reset);
    if (r.canBeFree) {
      const lab = el('label', 'muted'), box = el('input'); box.type = 'checkbox'; box.checked = r.free;
      box.addEventListener('change', () => { a.setFree(r.key, box.checked); this.refresh(); });
      lab.append(box, 'free'); tail.appendChild(lab);
    }
    const name = el('span', '', r.label); name.title = `default ${formatPrice(r.def, r.percent)} · today ${formatPrice(r.effective, r.percent)}${rev != null ? ` · revenue to date $${Math.round(rev)}` : ''}`;
    const g = el('div'); g.append(gauge, info);
    row.append(name, ctl, val, g, tail);
    return row;
  }

  refresh(): void {
    const a = this.api;
    if (!a) return;
    const out: HTMLElement[] = [];
    const tabs = el('div', 'tabs');
    for (const t of PRICE_TABS) {
      const b = el('button', t.id === this.tab ? 'active' : '', t.label);
      b.addEventListener('click', () => { this.tab = t.id; this.refresh(); });
      tabs.appendChild(b);
    }
    out.push(tabs);
    const pre = el('div', 'bar');
    for (const p of PRESETS) { const b = el('button', '', p.label); b.addEventListener('click', () => { a.preset(p.factor); this.refresh(); }); pre.appendChild(b); }
    const rst = el('button', '', 'Reset to defaults'); rst.addEventListener('click', () => { a.resetAll(); this.refresh(); });
    pre.append(rst, el('span', 'muted', todayLine(a.pricing)));
    out.push(pre);
    if (this.tab === 'seasonal') out.push(...this.seasonal(a));
    else for (const r of priceRows(a.pricing, this.tab)) out.push(this.rowEl(a, r));
    this.wrap.replaceChildren(...out);
  }

  private seasonal(a: PricingApi): HTMLElement[] {
    const t = el('table'), head = el('tr');
    head.appendChild(el('th', '', ''));
    for (const c of DAY_CLASSES) head.appendChild(el('th', '', CLASS_LABEL[c]));
    t.appendChild(head);
    const cells = scheduleCells(a.pricing);
    for (const prof of SCHEDULE_PROFILES) {
      const tr = el('tr'); tr.appendChild(el('td', '', PROFILE_LABEL[prof]));
      for (const c of DAY_CLASSES) {
        const cell = cells.find((x) => x.profile === prof && x.cls === c)!, td = el('td');
        const inp = el('input'); inp.type = 'number'; inp.min = String(SCHEDULE_RANGE.min); inp.max = String(SCHEDULE_RANGE.max); inp.step = '0.05'; inp.value = cell.mult.toFixed(2); inp.style.width = '60px';
        inp.title = multLabel(cell.mult);
        inp.addEventListener('change', () => { a.setSchedule(prof, c, Number(inp.value)); this.refresh(); });
        td.appendChild(inp); tr.appendChild(td);
      }
      t.appendChild(tr);
    }
    const lab = el('label'), box = el('input'); box.type = 'checkbox'; box.checked = a.pricing.powderSurcharge;
    box.addEventListener('change', () => { a.setPowder(box.checked); this.refresh(); });
    lab.append(box, ' Powder day surcharge (+20 % on fresh-snow days)');
    return [el('div', 'muted', 'Multipliers apply to day passes, attractions and lodging (not season passes). Peak days are busier, so a premium can pay off.'), t, lab];
  }
}
