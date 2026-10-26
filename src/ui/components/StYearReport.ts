import type { YearReport } from '@/sim/meta/YearReport';
import { Modal } from '../modal';
import { MONTH_NAMES } from '../financeFormat';
import { barChartSvg, columnChartSvg, highlightLines, lineChartSvg, medalSvg, statTiles, tierName, yearSubtitle, yearTitle } from '../yearReportFormat';
import { buildRegion } from '../yearRegion';
import { StElement } from './StElement';

export interface YearReportApi {
  /** 'Save image': compose the PNG (cover + headline + stats) and download it locally. */
  saveImage(r: YearReport): void | Promise<void>;
}
export type YearReportClose = 'continue' | 'later';

/** Y range of the rating chart: the data padded by half a star, at least one star tall, inside 0..5. */
export function ratingRange(v: readonly number[]): { min: number; max: number } {
  if (!v.length) return { min: 0, max: 5 };
  let lo = Math.max(0, Math.floor(Math.min(...v) * 2) / 2 - 0.5), hi = Math.min(5, Math.ceil(Math.max(...v) * 2) / 2 + 0.5);
  if (hi - lo < 1) { lo = Math.max(0, hi - 1); hi = lo + 1; }
  return { min: lo, max: hi };
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/**
 * Resort of the Year report (M5.3): a shared-dialog modal (`lg`) with the cover, headline, stat tiles, award medals, three charts and
 * highlights. 'Continue' acknowledges it, 'Remind me later' / Esc / X leave it unseen in the Finance drawer's Reports tab. The host
 * (main.ts + YearReportGate) pauses the game while it is open. NO share / copy-link / code (D8): the only output is a local PNG download.
 */
export class StYearReport extends StElement {
  private readonly dlg: Modal;
  private api: YearReportApi | null = null;
  private report: YearReport | null = null;
  private done: ((how: YearReportClose) => void) | null = null;
  private how: YearReportClose = 'later';

  protected css(): string {
    return `:host{position:absolute;left:0;top:0;width:0;height:0}
.cover{position:relative;flex:0 0 auto;height:clamp(96px,17vh,170px);border-radius:var(--r-md);overflow:hidden;background:linear-gradient(#2c5c94,#9cc4e6 70%,#e8f1fa) center/cover no-repeat;border:1px solid #34465e}
.cover .shade{position:absolute;inset:0;background:linear-gradient(rgba(10,16,24,0) 35%,rgba(10,16,24,.86))}
.cover .mtn{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);font-size:64px;color:#fff;opacity:.85}
.cover .txt{position:absolute;left:14px;right:14px;bottom:10px}
.cover h3{margin:0;font-family:var(--font-display);font-weight:400;font-size:clamp(22px,3.4vw,32px);color:#ffe29a;text-shadow:0 2px 6px rgba(0,0,0,.6)}
.cover p{margin:2px 0 0;font-size:13px;color:#e6edf6;text-shadow:0 1px 4px rgba(0,0,0,.6)}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.tile{background:#223046;border:1px solid #34465e;border-radius:var(--r-md);padding:8px 10px;min-width:0}
.tile .k{font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:#9fb4cc}
.tile .v{font-size:22px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile .chip{display:inline-block;margin-top:2px;font-size:11px;padding:1px 6px;border-radius:9px;background:rgba(255,255,255,.07);color:#b9c6d8}
.good{color:#7fd68a}.bad{color:#ff9a8a}.neutral{color:#fff}
.chip.good{color:#7fd68a}.chip.bad{color:#ff9a8a}
h4{margin:2px 0 0;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:#7f93ad}
.awards{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:6px}
.aw{display:flex;gap:8px;align-items:center;background:#1c2838;border:1px solid #2c3b50;border-radius:var(--r-md);padding:5px 8px;min-width:0}
.aw.t0{opacity:.62}
.aw .m{flex:0 0 32px;height:32px}
.aw .n{min-width:0}.aw .n b{display:block;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.aw .n span{display:block;font-size:11.5px;color:#9fb4cc;line-height:1.25}
.region{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px}
.rg{background:#1c2838;border:1px solid #2c3b50;border-radius:var(--r-md);padding:5px 8px;min-width:0}
.rg.you{border-color:#5f8f5a;background:#1f3328}
.rg b{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rg span{font-size:11.5px;color:#9fb4cc}
.rg .bar{height:5px;background:#2a3a50;border-radius:3px;overflow:hidden;margin-top:3px}.rg .bar i{display:block;height:100%;background:#7fb0e0}.rg.you .bar i{background:#7fd68a}
.charts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.chart{background:#1c2838;border:1px solid #2c3b50;border-radius:var(--r-md);padding:6px 8px 4px;min-width:0}
.chart .cap{font-size:11.5px;color:#9fb4cc;margin-bottom:2px}
.chart svg{display:block}
.chart .ax{display:flex;justify-content:space-between;font-size:10px;color:#6f8099}
ul.hl{margin:0;padding:0;list-style:none;columns:2;column-gap:18px;font-size:12.5px;color:#d5e0ee}
ul.hl li{break-inside:avoid;padding:1px 0}
.partial{font-size:12px;color:#f0c060}
@media (max-width:760px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.charts{grid-template-columns:1fr}ul.hl{columns:1}}`;
  }

  constructor() {
    super();
    this.dlg = new Modal(this.root, {
      title: 'Year report', icon: '🏆', size: 'lg', label: 'Resort of the Year report',
      onClose: () => { this.removeAttribute('open'); const cb = this.done; this.done = null; const h = this.how; this.how = 'later'; cb?.(h); },
    });
    this.dlg.footer.className = 'foot';
  }

  bind(api: YearReportApi): void { this.api = api; }
  get isOpen(): boolean { return this.dlg.isOpen; }
  get current(): YearReport | null { return this.dlg.isOpen ? this.report : null; }

  /** Show a report; `onClose` reports how it was closed. */
  show(r: YearReport, onClose?: (how: YearReportClose) => void): void {
    if (this.dlg.isOpen) this.dlg.close();
    this.report = r; this.done = onClose ?? null; this.how = 'later';
    this.dlg.setTitle(yearTitle(r));
    this.dlg.body.replaceChildren(...this.build(r));
    const later = el('button', 'ghost', 'Remind me later'); later.dataset.action = 'later'; later.title = 'Find this report again in Finance > Reports';
    later.addEventListener('click', () => { this.how = 'later'; this.dlg.close(); });
    const save = el('button', '', 'Save image'); save.dataset.action = 'save'; save.title = 'Download a PNG of this report to your computer';
    save.addEventListener('click', () => { void this.api?.saveImage(r); });
    const go = el('button', 'primary', 'Continue'); go.dataset.action = 'continue'; go.dataset.autofocus = '';
    go.addEventListener('click', () => { this.how = 'continue'; this.dlg.close(); });
    this.dlg.footer.replaceChildren(later, save, go);
    this.setAttribute('open', '');
    this.dlg.open();
  }
  close(): void { this.dlg.close(); }
  /** Click a footer action by data-action (tests). */
  clickAction(id: string): boolean { const b = [...this.root.querySelectorAll<HTMLButtonElement>('footer button')].find((x) => x.dataset.action === id); b?.click(); return !!b; }

  private build(r: YearReport): HTMLElement[] {
    const cover = el('div', 'cover');
    if (r.cover && r.cover.startsWith('data:image/')) cover.style.backgroundImage = `url("${r.cover}")`; else cover.append(el('span', 'mtn', '▲'));
    const txt = el('div', 'txt');
    txt.append(el('h3', '', r.headline.title), el('p', '', yearSubtitle(r)));
    cover.append(el('div', 'shade'), txt);

    const tiles = el('div', 'tiles');
    for (const t of statTiles(r)) {
      const d = el('div', 'tile'); d.dataset.tile = t.key;
      d.append(el('div', 'k', t.label), el('div', `v ${t.tone}`, t.value));
      if (t.chip) d.append(el('span', `chip ${t.chip.tone}`, t.chip.text));
      tiles.append(d);
    }

    const awards = el('div', 'awards');
    for (const a of r.awards) {
      const d = el('div', `aw t${a.tier}`); d.dataset.award = a.id; d.dataset.tier = tierName(a.tier); d.title = a.how;
      const m = el('span', 'm'); m.innerHTML = medalSvg(a.tier, 32);
      const n = el('div', 'n'); n.append(el('b', '', a.name), el('span', '', a.ratio === null ? 'Not judged yet' : a.tier > 0 ? a.blurb : 'Not this year'));
      d.append(m, n); awards.append(d);
    }

    const region = buildRegion(r); // the neighbours (Task 23)

    const live = r.months.filter((m) => m.days > 0);
    const chart = (cap: string, svg: string): HTMLElement => {
      const c = el('div', 'chart'); c.append(el('div', 'cap', cap));
      const s = el('div'); s.innerHTML = svg; c.append(s);
      const ax = el('div', 'ax'); ax.append(el('span', '', MONTH_NAMES[live[0]?.month ?? 0]!.slice(0, 3)), el('span', '', MONTH_NAMES[live[live.length - 1]?.month ?? 11]!.slice(0, 3))); c.append(ax);
      return c;
    };
    const charts = el('div', 'charts');
    charts.append(
      chart('Profit per month', barChartSvg(live.map((m) => m.net), { w: 260, h: 58 })),
      chart(`Rating: ${r.totals.ratingStart.toFixed(1)}\u2605 to ${r.totals.ratingEnd.toFixed(1)}\u2605`, lineChartSvg(live.map((m) => m.rating), { w: 260, h: 58, ...ratingRange(live.map((m) => m.rating)) })),
      chart('Guests per month', columnChartSvg(live.map((m) => m.guests), { w: 260, h: 58 })),
    );

    const hl = el('ul', 'hl');
    for (const line of highlightLines(r)) hl.append(el('li', '', line));
    const out: HTMLElement[] = [cover];
    if (r.partial) out.push(el('div', 'partial', `Your first year was only ${r.days} days long, so the awards are a first look.`));
    out.push(tiles, el('h4', '', 'Awards'), awards, ...(region ? [el('h4', '', `The region: you ranked ${r.rivals!.rank} of ${r.rivals!.of}`), region] : []), el('h4', '', 'The year in charts'), charts, el('h4', '', 'Highlights'), hl);
    return out;
  }
}
