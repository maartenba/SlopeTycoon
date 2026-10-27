import { makeSelect } from './StSelect';
import { LIFTS } from '@/config/lifts';
import { formatMoney } from '../format';
import { StElement } from './StElement';
import { benefitText, stateLabel, windowOptions, type ServiceStateLabel } from '../maintFormat';

/** Planned maintenance of one lift (sim/ops/LiftOps.ts serviceStatus, dates pre-formatted). */
export interface LiftServiceInfo {
  state: ServiceStateLabel; policy: 'auto' | 'manual';
  lastLabel: string | null; nextLabel: string | null; sinceDays: number;
  /** 'auto' or a real month index as string. */
  window: string; autoMonth: number;
  plan: { days: number; cost: number; level: string };
  riskMult: number; skipRiskMult: number; inServiceHours: number; canServiceNow: boolean;
}
export interface LiftOpsInfo {
  mode: 'auto' | 'open' | 'closed'; /** 'Auto (daylight)': hours follow sunrise/sunset. */ daylight?: boolean; from: number; to: number; eco: boolean;
  seasons: { winter: boolean; shoulder: boolean; summer: boolean };
  inspection: 'none' | 'basic' | 'thorough';
  /** 0..100 */
  condition: number;
  hold: string | null;
  fault: { kind: 'breakdown' | 'overhaul' | 'inspection' | 'service'; rushed?: boolean } | null;
  repairEtaHours: number; stranded: number;
  lastInspectionDaysAgo: number | null; nextInspectionDays: number | null;
  riskPerDay: number; hasWorkshop: boolean; energyPerHour: number; queue: number;
  service?: LiftServiceInfo;
}
export interface LiftInfo {
  id: number; kind: keyof typeof LIFTS; /** Display name ('Chairlift 1'); editable when `api.rename` is bound. */ name?: string; open: boolean; speed: number;
  lengthM: number; rideTimeS: number; throughputPerHour: number; upkeepPerDay: number; refund: number;
  /** Conditions (sim/OpenStatus): current mode and why it is closed. */
  activeMode?: string | null; closedReason?: string;
  /** Operations (sim/ops/LiftOps), optional. */
  ops?: LiftOpsInfo;
}
const fmtClock = (h: number): string => { const m = Math.round(h * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
export interface LiftInspectorApi {
  setOpen(id: number, open: boolean): void;
  setSpeed(id: number, v: number): void;
  demolish(id: number): void;
  setMode?(id: number, mode: 'auto' | 'open' | 'closed'): void;
  setHours?(id: number, from: number, to: number): void;
  setDaylight?(id: number, on: boolean): void;
  setEco?(id: number, eco: boolean): void;
  setSeason?(id: number, profile: 'winter' | 'shoulder' | 'summer', on: boolean): void;
  setInspection?(id: number, level: 'none' | 'basic' | 'thorough'): void;
  inspectNow?(id: number): void;
  setServiceWindow?(id: number, month: number | 'auto'): void;
  serviceNow?(id: number): void;
  repair?(id: number): void;
  /** Rename (already trimmed/clamped; empty = automatic name). */
  rename?(id: number, name: string): void;
}

export const LIFT_NAME_MAX = 24;

const fmtHour = (h: number): string => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);

export class StLiftInspector extends StElement {
  private api: LiftInspectorApi | null = null;
  private panel = document.createElement('div');
  protected css(): string {
    return ':host{position:absolute;right:8px;top:56px}.panel{flex-direction:column;align-items:stretch;min-width:230px;max-width:280px;display:none;gap:4px;max-height:max(220px,calc(100vh - 370px));overflow:auto}'
      + '.panel>*{flex-shrink:0}.bar{height:8px;background:#222;border-radius:4px;overflow:hidden}.bar>i{display:block;height:100%}.row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.warn{color:#ff9a8a}.small{font-size:11px;opacity:.85}';
  }
  constructor() {
    super();
    this.panel.className = 'panel';
    this.root.appendChild(this.panel);
  }
  bind(api: LiftInspectorApi): void { this.api = api; }
  /** True while a control inside the panel has focus (callers skip live refreshes so sliders/selects are not torn down). */
  get busy(): boolean { return !!this.root.activeElement && this.panel.contains(this.root.activeElement); }
  show(i: LiftInfo | null): void {
    if (!i) { this.panel.style.display = 'none'; return; }
    this.panel.style.display = 'flex';
    const a = this.api, d = LIFTS[i.kind], o = i.ops;
    const line = (t: string, cls = ''): HTMLElement => el('div', { textContent: t, className: cls });
    const kids: HTMLElement[] = [el('strong', { textContent: i.name ?? d.name })];
    if (a?.rename && i.name) {
      const input = el('input', { type: 'text', value: i.name, maxLength: LIFT_NAME_MAX, title: 'Rename (Enter to save, empty = automatic name)' });
      input.style.cssText = 'font-weight:700;min-width:0';
      let committed = i.name;
      const commit = (): void => {
        const v = input.value.replace(/\s+/g, ' ').trim().slice(0, LIFT_NAME_MAX);
        if (v === committed || !v && committed === '') return;
        committed = v;
        a.rename?.(i.id, v);
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); input.blur(); } e.stopPropagation(); });
      input.addEventListener('change', commit);
      kids[0] = input;
      kids.push(line(`${d.name}`, 'small'));
    }
    const status = o?.fault
      ? (o.fault.kind === 'breakdown' ? `BROKEN DOWN. Repair in ~${o.repairEtaHours.toFixed(1)} h${o.stranded ? ` · ${o.stranded} guests stranded` : ''}` : o.fault.kind === 'inspection' ? `Inspection (${o.repairEtaHours.toFixed(1)} h left)` : o.fault.kind === 'service' ? `Closed for annual service (${(o.repairEtaHours / 24).toFixed(1)} d left)` : `Overhaul (${o.repairEtaHours.toFixed(1)} h left)`)
      : i.open ? `Open${i.activeMode ? ` (${i.activeMode})` : ''}` : (o?.hold === 'hours' ? 'Closed: outside opening hours' : o?.hold === 'season' ? 'Closed: off-season schedule' : o?.hold === 'wind' ? 'Closed: high winds' : o?.hold === 'manual' ? 'Closed by you' : (i.closedReason ?? 'Closed'));
    kids.push(line(`Status: ${status}`, o?.fault?.kind === 'breakdown' ? 'warn' : ''));
    kids.push(line(`${d.capacityPerCarrier}/carrier · ${Math.round(i.lengthM)} m · ${Math.round(i.rideTimeS)} s ride · ${Math.round(i.throughputPerHour)}/h`));
    if (o) {
      const bar = el('div', { className: 'bar' }), fill = el('i');
      fill.style.width = `${Math.round(o.condition)}%`;
      fill.style.background = o.condition > 65 ? '#7fe07f' : o.condition > 35 ? '#e0c030' : '#ff6a5a';
      bar.append(fill);
      kids.push(line(`Condition ${Math.round(o.condition)}% · breakdown risk ${(o.riskPerDay * 100).toFixed(1)}%/day`), bar);
      kids.push(line(`Inspection: ${o.lastInspectionDaysAgo === null ? 'never' : `${o.lastInspectionDaysAgo} d ago`}${o.nextInspectionDays !== null ? ` · next in ${o.nextInspectionDays} d` : ''}`, 'small'));
      if (o.service) {
        const sv = o.service, cls = sv.state === 'overdue' || sv.state === 'critical' ? 'warn' : 'small';
        kids.push(line(`${stateLabel(sv.state)} · last service ${sv.lastLabel ?? `never (${sv.sinceDays} d since commissioning)`}`, cls));
        kids.push(line(sv.policy === 'auto' ? `Next service ${sv.nextLabel ?? 'not planned'}` : 'Next service: manual (policy in Operations)', 'small'));
        kids.push(line(benefitText(sv), cls === 'warn' ? 'warn small' : 'small'));
        const win = makeSelect(windowOptions(sv.autoMonth), sv.window, 'Service window', (v) => a?.setServiceWindow?.(i.id, v === 'auto' ? 'auto' : Number(v)));
        const winL = el('label', { textContent: 'Service window ' }); winL.append(win); kids.push(winL);
      }
      if (!o.hasWorkshop) kids.push(line('No Lift Maintenance Workshop: repairs are slow and expensive (contractor)', 'small'));
    }
    kids.push(line(`Upkeep ${formatMoney(i.upkeepPerDay)}/day${o ? ` · energy ${formatMoney(o.energyPerHour)}/h running` : ''}`, 'small'));
    const slider = el('input', { type: 'range', min: '0.25', max: '1', step: '0.05', value: String(i.speed) });
    slider.addEventListener('change', () => a?.setSpeed(i.id, Number(slider.value)));
    kids.push(el('label', { textContent: `Speed ${Math.round(i.speed * 100)}% ` }));
    kids[kids.length - 1]!.append(slider);
    if (o) {
      const mode = makeSelect([{ value: 'auto', label: 'Auto (schedule)' }, { value: 'open', label: 'Manual open' }, { value: 'closed', label: 'Closed' }], o.mode, 'Lift mode', (v) => a?.setMode?.(i.id, v as 'auto' | 'open' | 'closed'));
      const hrs = (label: string, v: number, set: (x: number) => void): HTMLElement => {
        const r = el('input', { type: 'range', min: '0', max: '24', step: '0.5', value: String(v) });
        const t = el('span', { textContent: fmtHour(v) });
        r.addEventListener('input', () => { t.textContent = fmtHour(Number(r.value)); });
        r.addEventListener('change', () => set(Number(r.value)));
        const w = el('label', { textContent: `${label} ` }); w.append(r, t); return w;
      };
      const eco = el('input', { type: 'checkbox', checked: o.eco });
      eco.addEventListener('change', () => a?.setEco?.(i.id, eco.checked));
      const ecoL = el('label'); ecoL.append(eco, ' Eco: half speed when nobody queues');
      const seasons = el('div', { className: 'row' });
      for (const p of ['winter', 'shoulder', 'summer'] as const) {
        const c = el('input', { type: 'checkbox', checked: o.seasons[p] });
        c.addEventListener('change', () => a?.setSeason?.(i.id, p, c.checked));
        const l = el('label'); l.append(c, ` ${p}`); seasons.append(l);
      }
      const insp = makeSelect((['none', 'basic', 'thorough'] as const).map((v) => ({ value: v, label: `Inspection: ${v}` })), o.inspection, 'Inspection level', (v) => a?.setInspection?.(i.id, v as 'none' | 'basic' | 'thorough'));
      const modeL = el('label', { textContent: 'Mode ' }); modeL.append(mode); kids.push(modeL);
      const dl = el('input', { type: 'checkbox', checked: !!o.daylight });
      dl.addEventListener('change', () => a?.setDaylight?.(i.id, dl.checked));
      const dlL = el('label'); dlL.append(dl, ' Auto (daylight)'); kids.push(dlL);
      if (o.daylight) kids.push(line(`Open ${fmtClock(o.from)} – ${fmtClock(o.to)} (follows sunrise/sunset)`, 'small'));
      else kids.push(hrs('Open from', o.from, (x) => a?.setHours?.(i.id, x, o.to)), hrs('Open to', o.to, (x) => a?.setHours?.(i.id, o.from, x)));
      kids.push(ecoL, line('Operate in:', 'small'), seasons, insp);
      const btns = el('div', { className: 'row' });
      const inspect = el('button', { textContent: 'Inspect now', disabled: !!o.fault });
      inspect.addEventListener('click', () => a?.inspectNow?.(i.id));
      const rep = el('button', { textContent: o.fault?.kind === 'breakdown' ? (o.fault.rushed ? 'Rush booked' : 'Rush repair') : 'Repair / overhaul', disabled: (!!o.fault && (o.fault.kind === 'inspection' || o.fault.kind === 'service' || !!o.fault.rushed)) || (!o.fault && o.condition >= 95) });
      rep.addEventListener('click', () => a?.repair?.(i.id));
      const close = el('button', { textContent: o.mode === 'closed' ? 'Open lift' : 'Close lift' });
      close.addEventListener('click', () => a?.setMode?.(i.id, o.mode === 'closed' ? 'auto' : 'closed'));
      btns.append(inspect, rep, close);
      if (o.service) {
        const svc = el('button', { textContent: o.fault?.kind === 'service' ? 'Servicing…' : 'Service now', disabled: !o.service.canServiceNow, title: o.service.canServiceNow ? benefitText(o.service) : 'Only when the lift is empty and not broken' });
        svc.addEventListener('click', () => a?.serviceNow?.(i.id));
        btns.append(svc);
      }
      kids.push(btns);
    } else {
      const toggle = el('button', { textContent: i.open ? 'Close lift' : 'Open lift' });
      toggle.addEventListener('click', () => a?.setOpen(i.id, !i.open));
      kids.push(toggle);
    }
    const del = el('button', { textContent: `Demolish (+${formatMoney(i.refund)})` });
    del.addEventListener('click', () => a?.demolish(i.id));
    kids.push(del);
    this.panel.replaceChildren(...kids);
  }
}
