import { makeSelect } from './StSelect';
import { formatMoney } from '../format';
import { StElement } from './StElement';
import { REAL_MONTHS } from '../../sim/calendar';
import { stateLabel, windowOptions, type ServiceStateLabel } from '../maintFormat';
import { mapDifficultyCss } from '@/config/palette';
import type { StaffPoolId, WageLevel } from '../../config/staff';

export type OpsProfile = 'winter' | 'shoulder' | 'summer';
export interface OpsRow { id: number; name: string; kind: string; mode: 'auto' | 'open' | 'closed'; daylight?: boolean; from: number; to: number; eco: boolean; seasons: Record<OpsProfile, boolean>; energyPerDay: number; carriesBikes: boolean; condition: number; status: string }
export interface StaffPoolRow { id: StaffPoolId; label: string; icon: string; auto: boolean; count: number; need: number; fill: number; slows: string }
export interface StaffUpgradeRow { id: string; name: string; icon: string; effect: string; cost: number; days: number; upkeep: number; state: 'done' | 'training' | 'available' | 'locked' | 'busy' | 'poor'; daysLeft: number; reason: string | null }
/** Staff tab (M5.4 Tasks 19-20): four auto-managed pools with an Auto toggle each, wage level + morale, and the six upgrades. */
export interface StaffApi {
  pools(): StaffPoolRow[];
  setAuto(id: StaffPoolId, auto: boolean): void;
  setCount(id: StaffPoolId, n: number): void;
  wage(): WageLevel;
  setWage(w: WageLevel): void;
  morale(): { value: number; label: string; breakdownFactor: number };
  /** Daily staff bill incl. upgrade upkeep ($). */
  billPerDay(): number;
  upgrades(): StaffUpgradeRow[];
  train(id: string): string | null;
}
/** Snowmaking control: global mode (On / Off / Auto) + bulk switch. */
export interface SnowApi {
  mode(): 'on' | 'off' | 'auto';
  setMode(m: 'on' | 'off' | 'auto'): void;
  summary(): { total: number; running: number; paused: number; off: number; snowlineM: number };
  /** Turn every cannon on (true) or off (false). */
  setAll(on: boolean): void;
}
/** One lift in the Maintenance tab (planned annual service, sim/ops/LiftOps.ts). */
export interface MaintRow {
  id: number; name: string; state: ServiceStateLabel; window: string; autoMonth: number;
  nextLabel: string | null; lastLabel: string | null; sinceDays: number; days: number; cost: number; riskMult: number; canServiceNow: boolean; servicing: boolean;
}
/** Maintenance tab: global policy, per-lift windows, bulk scheduling, 30-day cost projection. */
export interface MaintApi {
  policy(): 'auto' | 'manual';
  setPolicy(p: 'auto' | 'manual'): void;
  rows(): MaintRow[];
  setWindow(id: number, month: number | 'auto'): void;
  /** Bulk: every lift services in this real month (0 = January). */
  scheduleAll(month: number | 'auto'): void;
  serviceNow(id: number): boolean;
  projected(): { cost: number; count: number };
}
/** One run in the Runs tab (docs/runs.md). */
export interface RunRow {
  id: number; name: string; difficultyLabel: string; difficultyColor: string; lengthM: number; dropM: number;
  passesToday: number; passesWeek: number; quality: string | null; open: boolean; reason?: string; closedByPlayer: boolean;
  groomMode: 'auto' | 'first' | 'skip'; groomedDaysAgo: number | null;
}
export interface RunsApi {
  rows(): RunRow[];
  setClosed(id: number, closed: boolean): void;
  setGroom(id: number, mode: 'auto' | 'first' | 'skip'): void;
  /** Click on a name: move the camera to the run and highlight it. */
  focus(id: number): void;
}
export interface OperationsApi {
  maint?: MaintApi;
  runs?: RunsApi;
  staff?: StaffApi;
  snow?: SnowApi;
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
.small{font-size:11px;opacity:.85}
.wrap.staff{max-height:none;overflow:visible}
.tabs{margin-bottom:2px}
.cols2{display:grid;grid-template-columns:minmax(250px,.85fr) minmax(320px,1.15fr);gap:12px;align-items:start}
.cols2 h4{margin:0 0 4px;font-size:12px;color:var(--c-accent-text);letter-spacing:.3px}
.cols2 table td,.cols2 table th{padding:3px 5px}
.cols2 td.l{text-align:left}
.pool .nm{white-space:nowrap}
.pool input[type=number]{width:46px;text-align:center}
.bar{display:inline-block;width:60px;height:8px;border-radius:4px;background:#1d2a3b;border:1px solid #40536d;vertical-align:middle;overflow:hidden}
.bar>i{display:block;height:100%;background:#e0a030}
.bar.warn>i{background:#d0534a}.bar.good>i{background:#6fcf7f}
.ups{display:flex;flex-direction:column;gap:3px}
.u{display:grid;grid-template-columns:1fr auto 64px;gap:8px;align-items:center;padding:2px 6px;border-bottom:1px solid #3a4a60}
.u.locked{opacity:.55}
.u .nm{font-weight:700;font-size:12px;white-space:nowrap}.u .meta{white-space:nowrap;text-align:right}
.u button{padding:2px 8px;font-size:11px;width:100%}.u>span{text-align:center;font-size:11px;white-space:nowrap}
.done{color:#8fe08f}.busy{color:#ffd070}.save{color:#8fe08f}.warn{color:#ff9a8a}
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
  private tab: 'lifts' | 'maint' | 'staff' | 'runs' = 'lifts';
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
    const body = this.tab === 'runs' && a.runs ? this.runsView(a.runs) : this.tab === 'staff' && a.staff ? this.staffView(a.staff) : this.tab === 'maint' && a.maint ? this.maintView(a.maint) : this.liftsView(a);
    this.wrap.classList.toggle('staff', this.tab === 'staff' && !!a.staff);
    if (!a.staff && !a.maint && !a.runs) { this.wrap.replaceChildren(...body); return; }
    const tabs = el('div', 'tabs');
    for (const [id, label] of ([['lifts', 'Lifts'], ...(a.runs ? [['runs', 'Runs']] : []), ...(a.maint ? [['maint', 'Maintenance']] : []), ...(a.staff ? [['staff', 'Staff']] : [])] as Array<['lifts' | 'maint' | 'staff' | 'runs', string]>)) {
      const b = el('button', `tab${this.tab === id ? ' active' : ''}`, label);
      b.dataset.tab = id;
      b.addEventListener('click', () => { this.tab = id; this.refresh(); });
      tabs.append(b);
    }
    this.wrap.replaceChildren(tabs, ...body);
  }

  /** Runs tab: every run with traffic, surface, open / closed and grooming order; click a name to look at it. */
  private runsView(a: RunsApi): HTMLElement[] {
    const rows = a.rows();
    if (!rows.length) return [el('div', 'small', 'No pistes yet. Paint a piste: every stretch between junctions and lift stations is a run.')];
    const tbl = el('table'), head = el('tr');
    for (const h of ['Run', 'Level', 'Length', 'Drop', 'Today', 'Week', 'Surface', 'Groomed', 'Grooming', 'Status']) head.append(el('th', '', h));
    tbl.append(head);
    for (const r of rows) {
      const tr = el('tr'); tr.dataset.run = String(r.id);
      const td = (...n: Array<HTMLElement | string>): HTMLElement => { const t = el('td'); t.append(...n); return t; };
      const name = el('button', 'tab', r.name); name.dataset.focus = String(r.id); name.title = 'Show on the map';
      name.addEventListener('click', () => a.focus(r.id));
      const dot = el('span', '', '● '); dot.style.color = mapDifficultyCss(r.difficultyColor);
      const modes: Array<['auto' | 'first' | 'skip', string]> = [['auto', 'Auto'], ['first', 'First'], ['skip', 'Never']];
      const g = el('button', 'tab', modes.find((m) => m[0] === r.groomMode)![1]); g.dataset.groom = String(r.id); g.title = 'Grooming order: Auto / Groom first / Never groom';
      g.addEventListener('click', () => { a.setGroom(r.id, modes[(modes.findIndex((m) => m[0] === r.groomMode) + 1) % modes.length]![0]); this.refresh(); });
      const st = el('button', `tab${r.open ? '' : ' active'}`, r.open ? 'Open' : 'Closed'); st.dataset.toggle = String(r.id);
      st.title = r.open ? 'Click to close this run' : r.closedByPlayer ? 'Closed by you: click to reopen' : (r.reason ?? 'Closed');
      st.addEventListener('click', () => { if (r.open || r.closedByPlayer) { a.setClosed(r.id, r.open); this.refresh(); } });
      tr.append(td(name), td(dot, r.difficultyLabel), td(`${r.lengthM.toLocaleString('en-US')} m`), td(`${r.dropM.toLocaleString('en-US')} m`), td(String(r.passesToday)), td(String(r.passesWeek)),
        td(r.quality ?? 'n/a'), td(r.groomedDaysAgo === null ? 'never' : r.groomedDaysAgo === 0 ? 'today' : `${r.groomedDaysAgo} d ago`), td(g), td(st));
      tbl.append(tr);
    }
    return [tbl];
  }

  private staffView(s: StaffApi): HTMLElement[] {
    const td = (cls: string, ...n: Array<HTMLElement | string>): HTMLElement => { const t = el('td', cls); t.append(...n); return t; };
    // ---- left: wage + morale + pools ----
    const left = el('div');
    left.append(el('h4', '', 'Crew (auto-managed by default)'));
    const m = s.morale(), top = el('div', 'row');
    const wageSel = makeSelect([{ value: 'low', label: 'Low wages' }, { value: 'normal', label: 'Normal wages' }, { value: 'high', label: 'High wages' }], s.wage(), 'Wage level', (v) => { s.setWage(v as WageLevel); this.refresh(); });
    const bar = el('span', `bar ${m.value < 0.5 ? 'warn' : m.value > 0.85 ? 'good' : ''}`); const fillEl = el('i'); fillEl.style.width = `${Math.round(m.value * 100)}%`; bar.append(fillEl);
    const mt = el('span', 'small', `Morale ${m.label}`);
    mt.title = m.breakdownFactor === 1 ? 'Normal: lift breakdowns unaffected' : `Lift breakdowns x${m.breakdownFactor.toFixed(2)}`;
    top.append(wageSel, bar, mt, el('span', 'small', `Bill ${formatMoney(s.billPerDay())}/day`));
    left.append(top);
    const t = el('table', 'pool'), h = el('tr');
    for (const x of ['Pool', 'Auto', 'Heads', 'Fill']) h.append(el('th', '', x));
    t.append(h);
    for (const p of s.pools()) {
      const tr = el('tr');
      tr.title = `A shortage slows ${p.slows}. Extra heads cost wages but never speed anything up.`;
      const chk = el('input'); chk.type = 'checkbox'; chk.checked = p.auto; chk.setAttribute('aria-label', `${p.label}: auto`); chk.dataset.pool = p.id;
      chk.addEventListener('change', () => { s.setAuto(p.id, chk.checked); this.refresh(); });
      const num = el('input'); num.type = 'number'; num.min = '0'; num.max = '40'; num.value = String(p.count); num.disabled = p.auto; num.setAttribute('aria-label', `${p.label} headcount`); num.title = `Auto would staff ${p.need}`;
      num.addEventListener('change', () => { s.setCount(p.id, Number(num.value)); this.refresh(); });
      const fillTxt = p.fill >= 1 ? '100%' : `${Math.round(p.fill * 100)}%`;
      tr.append(td('l nm', `${p.icon} ${p.label}`), td('', chk), td('', num), td(p.fill < 1 ? 'warn' : '', fillTxt));
      t.append(tr);
    }
    left.append(t, el('div', 'small', 'Untick Auto to set the headcount. A shortage slows that system; low wages and overwork sink morale.'));
    // ---- right: six upgrades (two-line rows: name + effect | cost, days, upkeep | action) ----
    const right = el('div');
    right.append(el('h4', '', 'Training (one course at a time)'));
    const list = el('div', 'ups');
    for (const r of s.upgrades()) {
      const row = el('div', 'u');
      let act: HTMLElement;
      const lv = r.state === 'locked' ? /level (\d+)/.exec(r.reason ?? '') : null;
      if (lv) { act = el('span', 'muted', `Level ${lv[1]}`); act.title = r.reason ?? ''; }
      else if (r.state === 'done') act = el('span', 'done', 'Trained ✓');
      else if (r.state === 'training') act = el('span', 'busy', `${r.daysLeft} d left`);
      else {
        const b = el('button', r.state === 'available' ? 'primary' : '', 'Train'); b.dataset.upgrade = r.id;
        b.disabled = r.state !== 'available'; if (r.reason) b.title = r.reason;
        b.addEventListener('click', () => { s.train(r.id); this.refresh(); });
        act = b;
      }
      const info = el('div', 'info'), nm = el('div', 'nm', `${r.icon} ${r.name}`), ef = el('div', 'small', r.effect);
      info.append(nm, ef);
      if (r.state === 'locked' && r.reason) row.title = r.reason;
      const meta = el('div', 'meta small', `${formatMoney(r.cost)} · ${r.days} d · ${formatMoney(r.upkeep)}/d`);
      meta.title = 'Cost · training days · upkeep per day once trained';
      row.append(info, meta, act);
      if (r.state === 'locked') row.classList.add('locked');
      list.append(row);
    }
    right.append(list);
    const wrapEl = el('div', 'cols2'); wrapEl.append(left, right);
    return [wrapEl];
  }

  /** Snowmaking: mode buttons, bulk on/off and a status line (only when the resort has cannons). */
  private snowRow(a: OperationsApi): HTMLElement[] {
    const s = a.snow?.summary();
    if (!a.snow || !s || s.total === 0) return [];
    const api = a.snow, mode = api.mode(), box = el('div', 'row snow');
    box.dataset.role = 'snow-control';
    box.append(el('strong', '', 'Snowmaking'));
    const tips = { on: 'Cannons run whenever it is cold enough.', off: 'All cannons mothballed: no energy or water, 15% upkeep.', auto: 'Cannons also pause while the snowline is above your pistes or the daily high is above +4 °C, and resume when it cools.' };
    for (const [id, label] of [['on', 'On'], ['auto', 'Auto'], ['off', 'Off']] as const) {
      const b = el('button', `tab${mode === id ? ' active' : ''}`, label); b.dataset.snowMode = id; b.title = tips[id]; b.setAttribute('aria-pressed', String(mode === id));
      b.addEventListener('click', () => { api.setMode(id); this.refresh(); });
      box.append(b);
    }
    const allOff = s.off >= s.total;
    const bulk = el('button', '', allOff ? 'Turn all cannons on' : 'Turn all cannons off'); bulk.dataset.role = 'snow-bulk';
    bulk.addEventListener('click', () => { api.setAll(allOff); this.refresh(); });
    box.append(bulk);
    const txt = mode === 'off' ? 'Off by you' : mode === 'auto' && s.running === 0 && s.paused > 0 ? `Auto: paused, snowline ${s.snowlineM.toLocaleString('en-US')} m` : mode === 'auto' && s.running === 0 ? 'Auto: waiting for cold' : `${s.running} of ${s.total} running`;
    box.append(el('span', 'small', `${txt}${s.off && mode !== 'off' ? ` · ${s.off} switched off` : ''} · ${s.total} cannon${s.total === 1 ? '' : 's'}`));
    return [box];
  }

  private maintView(m: MaintApi): HTMLElement[] {
    const rows = m.rows();
    const top = el('div', 'row');
    const pol = m.policy();
    for (const [id, label, tip] of [['auto', 'Maintenance: Auto', 'Every lift is serviced once a year in its window, closed only while empty.'], ['manual', 'Maintenance: Manual', 'Nothing starts by itself: use Service now. Skipped services raise breakdown risk.']] as const) {
      const b = el('button', `tab${pol === id ? ' active' : ''}`, label); b.dataset.policy = id; b.title = tip; b.setAttribute('aria-pressed', String(pol === id));
      b.addEventListener('click', () => { m.setPolicy(id); this.refresh(); });
      top.append(b);
    }
    const apr = el('button', '', 'Schedule all in April'); apr.dataset.role = 'sched-april'; apr.title = 'Winter lifts rest in April: the quietest weeks of the year.';
    apr.addEventListener('click', () => { m.scheduleAll(3); this.refresh(); });
    const autoBtn = el('button', '', 'Reset all to Auto'); autoBtn.dataset.role = 'sched-auto';
    autoBtn.addEventListener('click', () => { m.scheduleAll('auto'); this.refresh(); });
    top.append(apr, autoBtn);
    if (!rows.length) return [top, el('div', 'small', 'No lifts yet. Build a lift to schedule its service here.')];
    const tbl = el('table'), head = el('tr');
    for (const h of ['Lift', 'Status', 'Window', 'Next service', 'Last service', 'Closed', 'Cost', '']) head.append(el('th', '', h));
    tbl.append(head);
    for (const r of rows) {
      const tr = el('tr'); tr.dataset.lift = String(r.id);
      const td = (...n: Array<HTMLElement | string>): HTMLElement => { const t = el('td'); t.append(...n); return t; };
      const win = makeSelect(windowOptions(r.autoMonth), r.window, `Service window of ${r.name}`, (v) => { m.setWindow(r.id, v === 'auto' ? 'auto' : Number(v)); this.refresh(); });
      win.style.minWidth = '96px';
      const warn = r.state === 'overdue' || r.state === 'critical';
      const st = el('span', warn ? 'warn' : r.state === 'due' ? 'busy' : 'done', r.servicing ? 'In service' : stateLabel(r.state).replace('Service ', '').replace('SERVICE ', '').toLowerCase());
      st.title = `${r.sinceDays} days since the last service (commissioning counts). Breakdown risk x${r.riskMult.toFixed(2)}`;
      const svc = el('button', '', 'Service now'); svc.disabled = !r.canServiceNow; svc.dataset.role = 'service-now';
      svc.title = r.canServiceNow ? `Close ${r.days} d, ${formatMoney(r.cost)}` : 'Only when the lift is empty and not broken';
      svc.addEventListener('click', () => { m.serviceNow(r.id); this.refresh(); });
      tr.append(td(`${r.name} #${r.id}`), td(st), td(win), td(m.policy() === 'manual' ? 'manual' : (r.nextLabel ?? '-')), td(r.lastLabel ?? 'never'), td(`${r.days} d`), td(formatMoney(r.cost)), td(svc));
      tbl.append(tr);
    }
    const pr = m.projected(), sum = el('div', 'small');
    sum.dataset.role = 'maint-projected';
    sum.append(pr.count > 0 ? `Next 30 days: ${pr.count} ${pr.count === 1 ? 'lift' : 'lifts'} in service, about ${formatMoney(pr.cost)} (booked as maintenance; cheaper with a Lift Workshop, crew morale and the Lift mechanics course).` : `Next 30 days: no planned service. Windows: ${[...new Set(rows.map((r) => (r.window === 'auto' ? r.autoMonth : Number(r.window))))].map((i) => REAL_MONTHS[i]).join(', ')}.`);
    return [top, tbl, sum];
  }

  private liftsView(a: OperationsApi): HTMLElement[] {
    const rows = a.rows();
    if (!rows.length) return [...this.snowRow(a), el('div', 'small', 'No lifts yet. Build a lift to schedule it here.')];
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
    return [...this.snowRow(a), quick, tbl, sum];
  }
}
