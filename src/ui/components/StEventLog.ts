import type { EventLog } from '@/core/EventLog';
import { StElement } from './StElement';

/** Debug event log view: last events, prefix filter, pause, clear. Call refresh() while visible. */
export class StEventLog extends StElement {
  private list = document.createElement('pre');
  private filter = document.createElement('input');
  private log: EventLog | null = null;
  private lastSeq = -1;

  protected css(): string { return '.panel{flex-direction:column;align-items:stretch;font-family:monospace}pre{margin:0;max-height:140px;overflow:auto;font-size:10px;white-space:pre-wrap}.row{display:flex;gap:4px}input[type=text]{flex:1;min-width:0}'; }

  constructor() {
    super();
    const p = document.createElement('div');
    p.className = 'panel';
    const row = document.createElement('div');
    row.className = 'row';
    this.filter.type = 'text'; this.filter.placeholder = 'filter prefix (e.g. guest:)';
    this.filter.addEventListener('input', () => { this.lastSeq = -1; this.refresh(); });
    const pause = document.createElement('button');
    pause.textContent = 'Pause';
    pause.addEventListener('click', () => { if (!this.log) return; this.log.paused = !this.log.paused; pause.classList.toggle('active', this.log.paused); });
    const clear = document.createElement('button');
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => { this.log?.clear(); this.lastSeq = -1; this.refresh(); });
    row.append(this.filter, pause, clear);
    p.append(row, this.list);
    this.root.appendChild(p);
  }

  bind(log: EventLog): void { this.log = log; }

  refresh(): void {
    const log = this.log;
    if (!log) return;
    const es = log.entries(this.filter.value.trim());
    const tail = es[es.length - 1]?.seq ?? -2;
    if (tail === this.lastSeq && es.length > 0) return;
    this.lastSeq = tail;
    this.list.textContent = es.slice(-80).reverse().map((e) => `#${e.seq} ${e.type} ${JSON.stringify(e.payload)}`).join('\n') || '(no events)';
  }
}
