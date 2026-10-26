import { StElement } from './StElement';
import { formatPerfLive, type PerfLive } from '../perfFormat';

export interface PerfApi {
  live(): PerfLive;
  /** Start the scripted camera flythrough benchmark (speed 1 and 3, ~20 s each). */
  startBenchmark(opts: { fillGuests: boolean }): void;
  cancelBenchmark(): void;
  status(): { running: boolean; progress: number; label: string };
  /** Last finished (or stored) result: table + JSON, or null. */
  result(): { table: string; json: string; when: string } | null;
}

/** 'Perf' section of the debug panel: live renderer/sim numbers + the in-browser benchmark. Call refresh() while visible. */
export class StPerf extends StElement {
  private liveEl = document.createElement('pre');
  private statusEl = document.createElement('div');
  private resultEl = document.createElement('pre');
  private runBtn = document.createElement('button');
  private copyBtn = document.createElement('button');
  private fill = document.createElement('input');
  private api: PerfApi | null = null;

  protected css(): string { return '.panel{flex-direction:column;align-items:stretch;font-family:monospace}pre{margin:0;font-size:10px;white-space:pre;overflow-x:auto}.row{display:flex;gap:4px;align-items:center}'; }

  constructor() {
    super();
    const p = document.createElement('div');
    p.className = 'panel';
    const title = document.createElement('b');
    title.textContent = 'Perf';
    this.runBtn.textContent = 'Run benchmark';
    this.runBtn.title = 'Scripted camera flythrough (zoomed in, mid, far out) at speed 1 and 3, ~40 s. Do not touch the mouse/keyboard while it runs.';
    this.runBtn.addEventListener('click', () => {
      if (!this.api) return;
      if (this.api.status().running) this.api.cancelBenchmark(); else this.api.startBenchmark({ fillGuests: this.fill.checked });
      this.refresh();
    });
    this.copyBtn.textContent = 'Copy JSON';
    this.copyBtn.addEventListener('click', () => {
      const r = this.api?.result();
      if (r && typeof navigator !== 'undefined' && navigator.clipboard) void navigator.clipboard.writeText(r.json);
    });
    const row = document.createElement('div');
    row.className = 'row';
    this.fill.type = 'checkbox'; this.fill.checked = true;
    const fillLbl = document.createElement('label');
    fillLbl.title = 'Top the resort up to its guest cap during the run (worst case; adds guests to the current game)';
    fillLbl.append(this.fill, ' fill guests');
    row.append(this.runBtn, this.copyBtn, fillLbl);
    this.statusEl.style.cssText = 'font-size:11px';
    p.append(title, this.liveEl, row, this.statusEl, this.resultEl);
    this.root.appendChild(p);
  }

  bind(api: PerfApi): void { this.api = api; this.refresh(); }

  refresh(): void {
    const api = this.api;
    if (!api) return;
    this.liveEl.textContent = formatPerfLive(api.live());
    const st = api.status();
    this.runBtn.textContent = st.running ? 'Cancel benchmark' : 'Run benchmark';
    this.statusEl.textContent = st.running ? `benchmark running: ${st.label} (${Math.round(st.progress * 100)} %)` : '';
    const r = api.result();
    this.resultEl.textContent = r ? `last benchmark ${r.when}\n${r.table}` : '(no benchmark run yet; results are also written to localStorage "slope.perf.last" and the console)';
    this.copyBtn.disabled = !r;
  }
}
