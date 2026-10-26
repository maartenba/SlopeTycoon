import type { StatsHistory } from '@/sim/meta/StatsHistory';
import { Modal } from '../modal';
import { LINE, STATS_RANGES, compact, money, niceAxis, revenueSeries, statsFrame, type StatsFrame, type StatsRangeId } from '../statsFormat';
import { StElement } from './StElement';

export interface StatsApi { history(): StatsHistory }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

interface Line { label: string; color: string; values: number[]; dash?: boolean; fmt: (v: number) => string }
interface Panel { id: string; title: string; hint: string; canvas: HTMLCanvasElement; legend: HTMLElement; head: HTMLElement; draw(hover: number): void; rows(): Array<{ label: string; cells: string[] }> }

/**
 * Statistics (M5.5 Task 30): a shared-dialog modal (`lg`) with four canvas charts from the StatsHistory observer: guests (arrivals + busiest hour),
 * cash, rating (stars + the sustainability facet) and revenue by category (stacked bars, top 5 + the rest). Range: 30 days / year / 2 years (daily)
 * and all time (monthly archive). Hover or arrow keys read exact values; a collapsible table repeats every number for screen readers.
 * Nothing animates (reduced motion safe), charts are only drawn while open; palette is Okabe-Ito and every line also differs in dash / marker.
 */
export class StStats extends StElement {
  private api: StatsApi | null = null;
  private readonly dlg: Modal;
  private range: StatsRangeId = '2y';
  private panels: Panel[] = [];
  private frame: StatsFrame | null = null;
  private onResize: (() => void) | null = null;

  protected css(): string {
    return `:host{display:block;width:0;height:0}
.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.bar .sp{flex:1}.bar .note{color:#9fb4cc;font-size:var(--fs-sm)}
.seg{display:inline-flex;gap:2px;padding:2px;background:#122030;border-radius:8px}
.seg button{padding:3px 12px;border-radius:6px;font-size:12.5px;background:transparent;border:0;color:#b9c6d8}
.seg button:hover:not(:disabled){background:rgba(255,255,255,.08)}
.seg button.on{background:linear-gradient(#f0b040,#e0a030);color:#1a1208}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.card{background:#1c2838;border:1px solid #2f4057;border-radius:var(--r-md);padding:8px 10px;min-width:0}
.card h3{margin:0;display:flex;align-items:baseline;gap:8px;font:400 var(--fs-md)/1.2 var(--font-display);color:#eaf2fc;letter-spacing:.2px}
.card h3 .big{margin-left:auto;font:800 var(--fs-md)/1.2 var(--font-ui,inherit);color:var(--c-accent-text);white-space:nowrap}
.card .hint{font-size:11px;color:#9fb4cc;margin:1px 0 4px}
canvas{display:block;width:100%;height:170px;touch-action:none}
.leg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11.5px;color:#c9dcf3;margin-top:4px}
.leg span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}.leg i{display:inline-block;width:14px;height:0;border-top:3px solid;border-radius:2px}
.leg i.sq{height:10px;width:10px;border:0;border-radius:2px}.leg i.dash{border-top-style:dashed}
.empty{text-align:center;color:#9fb4cc;padding:44px 0}
details{margin-top:10px;color:#c9dcf3;font-size:12px}summary{cursor:pointer;color:#9fb4cc}
table{border-collapse:collapse;width:100%;margin-top:6px;font-variant-numeric:tabular-nums}
th,td{text-align:right;padding:2px 6px;border-bottom:1px solid #2a394e;white-space:nowrap}th:first-child,td:first-child{text-align:left}
.tw{max-height:180px;overflow:auto}
@media (max-width:760px){.grid{grid-template-columns:1fr}}`;
  }

  constructor() {
    super();
    this.dlg = new Modal(this.root, {
      title: 'Statistics', icon: '📈', size: 'lg', label: 'Statistics', pausesGame: true,
      onOpen: () => { this.setAttribute('open', ''); this.onResize = () => this.drawAll(-1); window.addEventListener('resize', this.onResize); },
      onClose: () => { this.removeAttribute('open'); if (this.onResize) window.removeEventListener('resize', this.onResize); this.onResize = null; },
    });
  }

  bind(api: StatsApi): void { this.api = api; }
  get isOpen(): boolean { return this.dlg.isOpen; }
  open(): void { if (!this.api) return; this.dlg.open(); this.render(); }
  close(): void { this.dlg.close(); }
  toggle(): void { if (this.dlg.isOpen) this.close(); else this.open(); }
  setRange(r: StatsRangeId): void { this.range = r; if (this.dlg.isOpen) this.render(); }
  /** Number of charts currently shown (tests). */
  get chartCount(): number { return this.panels.length; }

  private render(): void {
    const body = this.dlg.body; body.replaceChildren(); this.panels = [];
    const h = this.api!.history();
    const bar = el('div', 'bar'), seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Time range');
    for (const r of STATS_RANGES) {
      const b = el('button', r.id === this.range ? 'on' : '', r.label); b.title = r.title; b.dataset.range = r.id; b.setAttribute('aria-pressed', String(r.id === this.range));
      b.addEventListener('click', () => this.setRange(r.id)); seg.append(b);
    }
    bar.append(seg, el('span', 'sp'), el('span', 'note', this.range === 'all' ? 'Monthly summaries of every closed month' : 'Days older than two years are kept as monthly summaries (All time)'));
    body.append(bar);
    this.frame = statsFrame(h, this.range);
    if (!this.frame) { const e = el('div', 'empty', 'Nothing recorded yet. Statistics fill in at the end of each in-game day.'); e.dataset.empty = '1'; body.append(e); return; }
    const f = this.frame, grid = el('div', 'grid');
    const num = (v: number): string => Math.round(v).toLocaleString('en-US');
    const lastOf = (a: number[]): number => a[a.length - 1] ?? 0;
    const per = this.perLabel(f);
    const arr = f.value('arrivals', 'sum'), peak = f.value('peak', 'max'), cash = f.value('cash', 'last'), stars = f.value('rating', 'mean'), sus = f.value('sustain', 'mean');
    const rev = revenueSeries(f);
    this.addLines(grid, 'guests', 'Guests', `Arrivals per ${per} and the busiest hour`, [
      { label: `Arrivals / ${per}`, color: LINE.guests, values: arr, fmt: num }, { label: 'Busiest hour', color: LINE.peak, values: peak, dash: true, fmt: num },
    ], num(lastOf(arr)), { min: 0 });
    this.addLines(grid, 'cash', 'Cash', 'Money at the end of the day', [{ label: 'Cash', color: LINE.cash, values: cash, fmt: money }], money(lastOf(cash)), {});
    this.addLines(grid, 'rating', 'Rating', 'Stars (left) and the sustainability facet (right, % of the stars axis)', [
      { label: 'Stars', color: LINE.rating, values: stars, fmt: (v) => `${v.toFixed(2)} stars` },
      { label: 'Sustainability', color: LINE.sustain, values: sus.map((v) => v / 20), dash: true, fmt: (v) => `${Math.round(v * 20)} / 100` },
    ], `${lastOf(stars).toFixed(1)} \u2605`, { min: 0, max: 5, right: (v) => `${Math.round(v * 20)}`, fixedStep: 1 });
    this.addRevenue(grid, rev, f);
    body.append(grid, this.table());
    requestAnimationFrame(() => this.drawAll(-1));
    this.drawAll(-1);
  }

  private perLabel(f: StatsFrame): string { const lp = f.points[f.points.length - 1]!, span = lp.to - lp.from + 1; return f.monthly ? (span > 15 ? `${Math.round(span / 15)} months` : 'month') : span > 1 ? `${span} days` : 'day'; }

  private card(grid: HTMLElement, id: string, title: string, hint: string, big: string): { canvas: HTMLCanvasElement; legend: HTMLElement; head: HTMLElement } {
    const c = el('div', 'card'); c.dataset.chart = id;
    const head = el('h3'); head.append(el('span', '', title), Object.assign(el('span', 'big', big), {}));
    const canvas = document.createElement('canvas'); canvas.setAttribute('role', 'img'); canvas.tabIndex = 0;
    const legend = el('div', 'leg');
    c.append(head, el('div', 'hint', hint), canvas, legend); grid.append(c);
    return { canvas, legend, head };
  }

  private legendItem(legend: HTMLElement, label: string, color: string, kind: 'line' | 'dash' | 'sq'): void {
    const s = el('span'), i = el('i', kind === 'sq' ? 'sq' : kind === 'dash' ? 'dash' : '');
    if (kind === 'sq') i.style.background = color; else i.style.borderTopColor = color;
    s.append(i, document.createTextNode(label)); legend.append(s);
  }

  private addLines(grid: HTMLElement, id: string, title: string, hint: string, lines: Line[], big: string, ax: { min?: number; max?: number; right?: (v: number) => string; fixedStep?: number }): void {
    const f = this.frame!, { canvas, legend, head } = this.card(grid, id, title, hint, big);
    for (const l of lines) this.legendItem(legend, l.label, l.color, l.dash ? 'dash' : 'line');
    canvas.setAttribute('aria-label', `${title} chart: ${lines.map((l) => `${l.label} ${l.fmt(l.values[l.values.length - 1] ?? 0)} now`).join(', ')}`);
    const p: Panel = {
      id, title, hint, canvas, legend, head,
      draw: (hover) => drawChart(canvas, f, { lines: lines.map((l) => ({ values: l.values, color: l.color, dash: !!l.dash })), ...ax, hover, fmtY: id === 'cash' ? compact : undefined }),
      rows: () => lines.map((l) => ({ label: `${title}: ${l.label}`, cells: l.values.map((v) => l.fmt(v)) })),
    };
    this.wire(p); this.panels.push(p);
  }

  private addRevenue(grid: HTMLElement, rev: ReturnType<typeof revenueSeries>, f: StatsFrame): void {
    const totals = f.points.map((_, i) => rev.reduce((s, r) => s + r.values[i]!, 0));
    const sum = totals.reduce((s, x) => s + x, 0);
    const { canvas, legend, head } = this.card(grid, 'revenue', 'Revenue by category', `Income per ${this.perLabel(f)}, top categories`, `${money(sum)} total`);
    for (const r of rev) this.legendItem(legend, `${r.label} ${money(r.total)}`, r.color, 'sq');
    if (!rev.length) legend.append(el('span', '', 'No income recorded in this range'));
    canvas.setAttribute('aria-label', `Revenue by category: ${rev.map((r) => `${r.label} ${money(r.total)}`).join(', ') || 'no income yet'}`);
    const p: Panel = {
      id: 'revenue', title: 'Revenue', hint: '', canvas, legend, head,
      draw: (hover) => drawChart(canvas, f, { bars: rev.map((r) => ({ values: r.values, color: r.color })), min: 0, hover, fmtY: compact }),
      rows: () => [...rev.map((r) => ({ label: `Revenue: ${r.label}`, cells: r.values.map((v) => money(v)) })), { label: 'Revenue: total', cells: totals.map((v) => money(v)) }],
    };
    this.wire(p); this.panels.push(p);
  }

  private wire(p: Panel): void {
    const at = (clientX: number): number => {
      const r = p.canvas.getBoundingClientRect(), n = this.frame!.points.length;
      return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left - PAD.l) / Math.max(1, r.width - PAD.l - PAD.r)) * n)));
    };
    const show = (i: number): void => { p.draw(i); this.readout(p, i); };
    p.canvas.addEventListener('pointermove', (e) => show(at(e.clientX)));
    p.canvas.addEventListener('pointerleave', () => { p.draw(-1); p.canvas.title = ''; });
    let kb = -1;
    p.canvas.addEventListener('keydown', (e) => {
      const n = this.frame!.points.length;
      if (e.key === 'ArrowLeft') kb = kb < 0 ? n - 1 : Math.max(0, kb - 1); else if (e.key === 'ArrowRight') kb = kb < 0 ? n - 1 : Math.min(n - 1, kb + 1); else return;
      e.preventDefault(); show(kb);
    });
    p.canvas.addEventListener('blur', () => { kb = -1; p.draw(-1); });
  }

  /** Hover / keyboard readout: the tooltip (title) names the bucket and every value. */
  private readout(p: Panel, i: number): void {
    const pt = this.frame!.points[i]; if (!pt) return;
    p.canvas.title = `${pt.label}\n${p.rows().map((r) => `${r.label.replace(/^[^:]+: /, '')}: ${r.cells[i]}`).join('\n')}`;
  }

  private table(): HTMLElement {
    const d = el('details'), f = this.frame!; d.dataset.table = '1';
    d.append(el('summary', '', 'Show the numbers as a table'));
    const t = document.createElement('table'), thead = document.createElement('thead'), tr = document.createElement('tr');
    tr.append(el('th', '', 'Series'));
    for (const p of f.points) tr.append(Object.assign(el('th', '', p.label.replace(/^(Y\d+ M\d+)( D\d+)?.*$/, (_m, a: string, b?: string) => `${a}${b ?? ''}`)), { title: p.label }));
    thead.append(tr); t.append(thead);
    const tb = document.createElement('tbody');
    for (const p of this.panels) for (const r of p.rows()) { const row = document.createElement('tr'); row.append(el('td', '', r.label)); for (const c of r.cells) row.append(el('td', '', c)); tb.append(row); }
    t.append(tb); const w = el('div', 'tw'); w.append(t); d.append(w);
    return d;
  }

  private drawAll(hover: number): void { for (const p of this.panels) p.draw(hover); }
}

// ---------------------------------------------------------------- canvas drawing
const PAD = { l: 44, r: 40, t: 8, b: 20 };
interface ChartOpts {
  lines?: Array<{ values: number[]; color: string; dash: boolean }>;
  bars?: Array<{ values: number[]; color: string }>;
  min?: number; max?: number; right?: (v: number) => string; fixedStep?: number; hover: number; fmtY?: (v: number) => string;
}

/** Draw one chart: grid, axis labels, series, hover guide. Static (no animation). Silently does nothing without a 2D context (tests). */
function drawChart(canvas: HTMLCanvasElement, f: StatsFrame, o: ChartOpts): void {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const cssW = canvas.clientWidth || 360, cssH = canvas.clientHeight || 170, dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) { canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cssW, cssH);
  const n = f.points.length, L = PAD.l, R = cssW - (o.right ? PAD.r : 12), T = PAD.t, B = cssH - PAD.b;
  let lo = Infinity, hi = -Infinity;
  if (o.bars) { const tot = f.points.map((_, i) => o.bars!.reduce((s, b) => s + b.values[i]!, 0)); lo = 0; hi = Math.max(...tot, 1); }
  for (const l of o.lines ?? []) for (const v of l.values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  if (o.min !== undefined) lo = o.min; if (o.max !== undefined) hi = o.max;
  const ax = o.fixedStep ? { min: lo, max: hi, step: o.fixedStep } : niceAxis(lo, hi);
  const y = (v: number): number => B - ((v - ax.min) / (ax.max - ax.min || 1)) * (B - T);
  const slot = (R - L) / n, x = (i: number): number => L + slot * (i + 0.5);
  ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  for (let v = ax.min; v <= ax.max + ax.step / 2; v += ax.step) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.strokeStyle = 'rgba(159,180,204,.16)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(R, yy); ctx.stroke();
    ctx.fillStyle = '#9fb4cc'; ctx.textAlign = 'right'; ctx.fillText((o.fmtY ?? ((q: number) => String(Math.round(q * 10) / 10)))(v), L - 5, yy);
    if (o.right) { ctx.textAlign = 'left'; ctx.fillText(o.right(v), R + 5, yy); }
  }
  // x labels: first / middle / last bucket
  ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#9fb4cc';
  for (const [i, al] of [[0, 'left'], [Math.floor((n - 1) / 2), 'center'], [n - 1, 'right']] as Array<[number, CanvasTextAlign]>) {
    if (i === Math.floor((n - 1) / 2) && n < 4) continue;
    const t = f.points[i]!.label.split(' - ')[0]!;
    ctx.textAlign = al; ctx.fillText(t, al === 'left' ? L : al === 'right' ? R : (L + R) / 2, cssH - 5);
  }
  if (o.bars) {
    const bw = Math.max(2, slot * 0.72), base = new Array<number>(n).fill(0);
    for (const b of o.bars) {
      ctx.fillStyle = b.color;
      for (let i = 0; i < n; i++) { const v = b.values[i]!; if (v <= 0) continue; const y1 = y(base[i]! + v), y0 = y(base[i]!); ctx.fillRect(Math.round(x(i) - bw / 2), y1, Math.round(bw), Math.max(1, y0 - y1 - 0.5)); base[i]! += v; }
    }
  }
  for (const l of o.lines ?? []) {
    ctx.strokeStyle = l.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.setLineDash(l.dash ? [6, 4] : []);
    ctx.beginPath(); l.values.forEach((v, i) => { if (i === 0) ctx.moveTo(x(i), y(v)); else ctx.lineTo(x(i), y(v)); }); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = l.color; if (n <= 40) for (let i = 0; i < n; i++) { ctx.beginPath(); if (l.dash) ctx.rect(x(i) - 2, y(l.values[i]!) - 2, 4, 4); else ctx.arc(x(i), y(l.values[i]!), 2.2, 0, Math.PI * 2); ctx.fill(); }
  }
  if (o.hover >= 0 && o.hover < n) {
    const hx = Math.round(x(o.hover)) + 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, T); ctx.lineTo(hx, B); ctx.stroke();
    ctx.fillStyle = '#fff'; for (const l of o.lines ?? []) { ctx.beginPath(); ctx.arc(x(o.hover), y(l.values[o.hover]!), 3.5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = l.color; ctx.lineWidth = 2; ctx.stroke(); }
  }
}
