import { makeSelect } from './StSelect';
import { formatMoney } from '../format';
import { StElement } from './StElement';

export type OpsProfile = 'winter' | 'shoulder' | 'summer';
export interface OpsRow { id: number; name: string; kind: string; mode: 'auto' | 'open' | 'closed'; daylight?: boolean; from: number; to: number; eco: boolean; seasons: Record<OpsProfile, boolean>; energyPerDay: number; carriesBikes: boolean; condition: number; status: string }
export interface OperationsApi {
  rows(): OpsRow[];
  setMode(id: number, mode: 'auto' | 'open' | 'closed'): void;
  setHours(id: number, from: number, to: number): void;
  setDaylight?(id: number, on: boolean): void;
  /** Today's daylight window text for the summary line (e.g. '07:45–16:45'). */
  daylightText?(): string;
  setEco(id: number, eco: boolean): void;
  setSeason(id: number, p: OpsProfile, on: boolean): void;
  /** Quick action: only these lift ids operate in the profile. */
  keepOnly(p: OpsProfile, ids: number[]): void;
  projected(p: OpsProfile): number;
}

const css = `
:host{display:block;flex:1;min-width:0}
.wrap{display:flex;flex-direction:column;gap:6px;max-height:min(34vh,340px);overflow:auto}
table{border-collapse:collapse;width:100%;font-size:11px}
th,td{padding:2px 6px;text-align:center;border-bottom:1px solid #3a4a60}
th:first-child,td:first-child{text-align:left}
.row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.small{font-size:11px;opacity:.85}.save{color:#8fe08f}.warn{color:#ff9a8a}
select,input[type=number]{width:auto}
`;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const fmtHour = (h: number): string => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;
const fmtClock = (h: number): string => { const m = Math.round(h * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const PROFILES: readonly OpsProfile[] = ['winter', 'shoulder', 'summer'];

/** Operations panel: lift schedule table (lifts x Winter/Shoulder/Summer, hours, mode, eco) + quick actions + projected energy. */
export class StOperations extends StElement {
  private api: OperationsApi | null = null;
  private wrap = el('div', 'wrap');
  private pending = false;
  protected css(): string { return css; }
  constructor() { super(); this.root.appendChild(this.wrap); }
  bind(api: OperationsApi): void { this.api = api; this.refresh(); }
  requestRefresh(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; if (!this.root.activeElement) this.refresh(); });
  }

  refresh(): void {
    const a = this.api;
    if (!a) return;
    const rows = a.rows();
    if (!rows.length) { this.wrap.replaceChildren(el('div', 'small', 'No lifts yet. Build a lift to schedule it here.')); return; }
    const tbl = el('table'), head = el('tr');
    for (const h of ['Lift', 'Mode', 'Open', 'Close', 'Winter', 'Shoulder', 'Summer', 'Eco', 'Energy/day', 'Cond.']) head.append(el('th', '', h));
    tbl.append(head);
    for (const r of rows) {
      const tr = el('tr');
      const curMode = r.mode === 'auto' ? (r.daylight ? 'daylight' : 'auto') : r.mode;
      const mode = makeSelect([{ value: 'daylight', label: 'Auto (daylight)' }, { value: 'auto', label: 'Auto (hours)' }, { value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }], curMode, `Mode of ${r.name}`);
      mode.addEventListener('change', () => { if (mode.value === 'daylight') { a.setMode(r.id, 'auto'); a.setDaylight?.(r.id, true); } else { a.setMode(r.id, mode.value as OpsRow['mode']); if (mode.value === 'auto') a.setDaylight?.(r.id, false); } this.refresh(); });
      const hour = (v: number, set: (x: number) => void): HTMLElement => {
        const hrs: Array<{ value: string; label: string }> = [];
        for (let h = 0; h <= 24; h += 0.5) hrs.push({ value: String(h), label: fmtHour(h) });
        const s = makeSelect(hrs, String(v), 'Hour', (x) => { set(Number(x)); this.refresh(); });
        s.style.minWidth = '70px';
        return s;
      };
      const chk = (v: boolean, set: (x: boolean) => void): HTMLElement => {
        const c = el('input'); c.type = 'checkbox'; c.checked = v;
        c.addEventListener('change', () => { set(c.checked); this.refresh(); });
        return c;
      };
      const td = (...n: Array<HTMLElement | string>): HTMLElement => { const t = el('td'); t.append(...n); return t; };
      tr.append(td(`${r.name} #${r.id}`), td(mode), td(r.daylight && r.mode === 'auto' ? el('span', '', fmtClock(r.from)) : hour(r.from, (x) => a.setHours(r.id, x, r.to))), td(r.daylight && r.mode === 'auto' ? el('span', '', fmtClock(r.to)) : hour(r.to, (x) => a.setHours(r.id, r.from, x))),
        ...PROFILES.map((p) => td(chk(r.seasons[p], (x) => a.setSeason(r.id, p, x)))), td(chk(r.eco, (x) => a.setEco(r.id, x))),
        td(formatMoney(r.energyPerDay)), td(`${Math.round(r.condition)}%`));
      tr.title = r.status;
      tbl.append(tr);
    }
    const quick = el('div', 'row');
    const btn = (label: string, fn: () => void): void => { const b = el('button', '', label); b.addEventListener('click', () => { fn(); this.refresh(); }); quick.append(b); };
    btn('Summer: bike-capable lifts only', () => a.keepOnly('summer', rows.filter((r) => r.carriesBikes).map((r) => r.id)));
    btn('Close all summer lifts', () => a.keepOnly('summer', []));
    btn('Shoulder: bike-capable only', () => a.keepOnly('shoulder', rows.filter((r) => r.carriesBikes).map((r) => r.id)));
    btn('Everything on (all seasons)', () => { for (const p of PROFILES) a.keepOnly(p, rows.map((r) => r.id)); });
    const sum = el('div', 'small');
    const dtx = a.daylightText?.();
    if (dtx) sum.append(`Today's daylight ${dtx} — 'Auto (daylight)' lifts open sunrise+45 min to sunset−15 min. `);
    const win = a.projected('winter');
    sum.append(`Projected energy/day — winter ${formatMoney(win)}, shoulder ${formatMoney(a.projected('shoulder'))}, summer ${formatMoney(a.projected('summer'))}`);
    const saved = win - a.projected('summer');
    if (saved > 0) sum.append(el('span', 'save', `  · summer schedule saves ${formatMoney(saved)}/day vs winter`));
    this.wrap.replaceChildren(quick, tbl, sum);
  }
}
