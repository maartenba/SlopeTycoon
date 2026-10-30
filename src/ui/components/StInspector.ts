import { displayName } from '../text';
import { BUILDINGS } from '@/config/buildings';
import { REMOTE_SUPPLY_MULT } from '@/config/balance';
import { formatMoney } from '../format';
import type { AttractionInfo } from '@/sim/attractions/Attraction';
import { formatAttractionStats, formatPriceLabel } from '../attractionFormat';
import { icon } from '../icons';
import type { CannonInfo } from '@/sim/ops/Snowmaking';
import type { EnergyOps } from '../energyFormat';
import { StElement } from './StElement';
import { makeSelect } from './StSelect';

const lowerFirst = (s: string): string => (s.startsWith('Needs ') ? s[0]!.toLowerCase() + s.slice(1) : s);
export interface InspectorTarget { id: number; type: string; /** Display name ('Mountain Hut 2'); editable when bindRename is set. */ name?: string; /** Quarter turns (0..3) for the Rotate button. */ rot?: number; active: boolean; reason?: string; refund: number; /** Supplied only on foot (trail / piste edge, no footpath or road): +25% upkeep. */ onFoot?: boolean; /** Condition-based open/closed (sim/OpenStatus); reason like 'Closed: no snow at 1,450 m'. */ conditions?: { open: boolean; reason?: string }; /** Ski School HQ runtime (instructors +/-, lessons today, queue). */ school?: { instructors: number; capacity: number; lessonsToday: number; activeKids: number; queuedKids: number; quality: number }; /** Attraction runtime stats (sim/attractions). */ attraction?: AttractionInfo; /** Ops (Task 25): snowcat fleet of a garage/outpost, or a reservoir's water. */ ops?: { kind: 'groomer'; vehicles: number; groomedLast: number; max: number } | { kind: 'reservoir'; level: number; capacity: number; cannons?: number } | { kind: 'cannon'; info: CannonInfo } | { kind: 'patrol'; staff: number; sleds: number; max: number; open: number } | { kind: 'helipad'; helicopters: number; missions: number; state: string } | { kind: 'ranger'; staff: number; max: number; bins: boolean; binsCost: number; preventedMonth: number; savedMonth: number; bearsInRange: number; hazes: number; relocations: number; ready: number } | EnergyOps }

export interface AttractionHandlers { setPrice(id: number, price: number): void; adjustStaff(id: number, delta: number): void; /** Tackle hut: Catch & release (false) / Keep (true). */ setKeep?(id: number, keep: boolean): void }

export class StInspector extends StElement {
  private body = document.createElement('div');
  private undoBox = document.createElement('div');
  private onRotate: ((id: number, dir: 1 | -1) => string | null) | null = null;
  private onWalk: ((id: number) => void) | null = null;
  private onRename: ((id: number, name: string) => void) | null = null;
  private rotateMsg = '';
  private onDemolish: ((id: number) => void) | null = null;
  private attr: AttractionHandlers | null = null;
  private onVehicles: ((id: number, delta: number) => void) | null = null;
  private onBins: ((id: number) => void) | null = null;
  private onAction: ((id: string) => void) | null = null;
  private onCannon: ((id: number, on: boolean) => void) | null = null;
  private onInstructors: ((id: number, delta: number) => void) | null = null;

  protected css(): string {
    return ':host{position:absolute;right:8px;top:56px}.panel{flex-direction:column;align-items:stretch;min-width:180px}.bad{color:#ff8a8a}.ok{color:#8aff8a}';
  }

  constructor() {
    super();
    const p = document.createElement('div');
    p.className = 'panel';
    this.undoBox.className = 'undo'; this.undoBox.style.cssText = 'display:flex;gap:8px;align-items:center';
    p.append(this.body, this.undoBox);
    p.style.display = 'none';
    this.body.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    this.root.appendChild(p);
  }

  bind(onDemolish: (id: number) => void, onInstructors?: (id: number, delta: number) => void): void { this.onDemolish = onDemolish; this.onInstructors = onInstructors ?? null; }

  /** Rotate button (Shift+click = counter-clockwise): returns a refusal reason, or null when it rotated. */
  /** 'Walk here' (Task 12): enter first-person walk mode next to this building. */
  bindWalk(fn: (id: number) => void): void { this.onWalk = fn; }
  bindRotate(fn: (id: number, dir: 1 | -1) => string | null): void { this.onRotate = fn; }
  /** Rename text input (empty resets to the automatic name). */
  bindRename(fn: (id: number, name: string) => void): void { this.onRename = fn; }

  /** Ops: +/- snowcats for a garage/outpost. */
  bindOps(onVehicles: (id: number, delta: number) => void): void { this.onVehicles = onVehicles; }

  /** Ranger Station: toggle bear-proof bins. */
  bindBins(fn: (id: number) => void): void { this.onBins = fn; }
  /** Inspector button of a green building (Eco Centre: open the Eco programme). */
  bindAction(fn: (id: string) => void): void { this.onAction = fn; }
  /** Per-cannon on/off (Snowmaking). */
  bindCannon(fn: (id: number, on: boolean) => void): void { this.onCannon = fn; }

  bindAttraction(h: AttractionHandlers): void { this.attr = h; }

  /** After a demolish the inspector has nothing to show: offer to take it back instead (cleared by the next selection or `offerUndo(null)`). */
  offerUndo(text: string | null, run?: () => void): void {
    const p = this.body.parentElement as HTMLElement;
    this.undoBox.replaceChildren();
    if (!text) { if (!this.body.childElementCount) p.style.display = 'none'; return; }
    p.style.display = 'flex';
    const b = document.createElement('button'); b.textContent = 'Undo'; b.dataset.undo = ''; b.title = 'Undo the last placement or bulldoze (Ctrl+Z)';
    b.addEventListener('click', () => run?.());
    this.undoBox.append(Object.assign(document.createElement('span'), { textContent: text }), b);
  }

  show(t: InspectorTarget | null): void {
    const p = this.body.parentElement as HTMLElement;
    if (!t) { this.body.replaceChildren(); p.style.display = this.undoBox.childElementCount ? 'flex' : 'none'; return; }
    this.undoBox.replaceChildren();
    const d = BUILDINGS[t.type];
    p.style.display = 'flex';
    const line = (txt: string, cls = ''): HTMLElement => Object.assign(document.createElement('div'), { textContent: txt, className: cls });
    const btn = document.createElement('button');
    btn.textContent = `Demolish (+${formatMoney(t.refund)})`;
    btn.addEventListener('click', () => this.onDemolish?.(t.id));
    const sc = t.school;
    const schoolRows: HTMLElement[] = [];
    if (sc) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center';
      const mk = (label: string, delta: number): HTMLButtonElement => {
        const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', () => this.onInstructors?.(t.id, delta)); return b;
      };
      row.append(Object.assign(document.createElement('span'), { textContent: `Instructors: ${sc.instructors}` }), mk('−', -1), mk('+', 1));
      schoolRows.push(row,
        line(`Lessons today: ${sc.lessonsToday} · in lesson ${sc.activeKids}/${sc.capacity} kids`),
        line(`Queue: ${sc.queuedKids} kids waiting · quality ${Math.round(sc.quality * 100)}%`, sc.queuedKids > 0 ? 'bad' : ''));
    }
    const opsRows: HTMLElement[] = [];
    if (t.ops?.kind === 'groomer') {
      const o = t.ops, row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center';
      const mk = (label: string, delta: number): HTMLButtonElement => {
        const b = document.createElement('button'); b.textContent = label; b.disabled = delta < 0 ? o.vehicles <= 0 : o.vehicles >= o.max;
        b.addEventListener('click', () => this.onVehicles?.(t.id, delta)); return b;
      };
      row.append(Object.assign(document.createElement('span'), { textContent: `Snowcats: ${o.vehicles}` }), mk('−', -1), mk('+', 1));
      opsRows.push(row, line(`Groomed last night: ${o.groomedLast} tiles`));
    } else if (t.ops?.kind === 'patrol') {
      const o = t.ops, row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center';
      const mk = (label: string, delta: number): HTMLButtonElement => {
        const b = document.createElement('button'); b.textContent = label; b.disabled = delta < 0 ? o.staff <= 0 : o.staff >= o.max;
        b.addEventListener('click', () => this.onVehicles?.(t.id, delta)); return b;
      };
      row.append(Object.assign(document.createElement('span'), { textContent: `Patrol staff (sleds): ${o.staff}` }), mk('−', -1), mk('+', 1));
      opsRows.push(row, line(`Open incidents: ${o.open}`, o.open > 0 ? 'bad' : ''));
    } else if (t.ops?.kind === 'ranger') {
      const o = t.ops, row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center';
      const mk = (label: string, delta: number): HTMLButtonElement => {
        const b = document.createElement('button'); b.textContent = label; b.disabled = delta < 0 ? o.staff <= 0 : o.staff >= o.max;
        b.addEventListener('click', () => this.onVehicles?.(t.id, delta)); return b;
      };
      row.append(Object.assign(document.createElement('span'), { textContent: `Rangers: ${o.staff} (${o.ready} ready)` }), mk('−', -1), mk('+', 1));
      const bins = document.createElement('button'); bins.textContent = o.bins ? 'Bear-proof bins: installed' : `Install bear-proof bins ($${o.binsCost.toLocaleString('en-US')})`; bins.dataset.role = 'bins';
      bins.addEventListener('click', () => this.onBins?.(t.id));
      opsRows.push(row, bins,
        line(`Bears in range: ${o.bearsInRange} · hazed ${o.hazes} · relocated ${o.relocations}`, o.bearsInRange > 0 ? 'bad' : ''),
        line(`Prevented scares this month: ${o.preventedMonth} · est. revenue saved $${Math.round(o.savedMonth).toLocaleString('en-US')}`, o.preventedMonth > 0 ? 'good' : ''));
    } else if (t.ops?.kind === 'energy') {
      for (const l of t.ops.lines) { const r = line(l.text, l.tone ?? ''); r.dataset.role = 'energy'; opsRows.push(r); }
      if (t.ops.action) { const ab = document.createElement('button'), id = t.ops.action.id; ab.textContent = t.ops.action.label; ab.dataset.role = 'energy-action'; ab.style.minHeight = '44px'; ab.addEventListener('click', () => this.onAction?.(id)); opsRows.push(ab); }
    } else if (t.ops?.kind === 'helipad') {
      opsRows.push(line(`Helicopter: ${t.ops.helicopters ? t.ops.state : 'none (needs an active Helipad)'} · missions flown ${t.ops.missions}`));
    } else if (t.ops?.kind === 'reservoir') {
      opsRows.push(line(`Water: ${Math.round(t.ops.level)} / ${Math.round(t.ops.capacity)} (${Math.round((100 * t.ops.level) / Math.max(1, t.ops.capacity))}%)`, t.ops.level < 1 ? 'bad' : ''));
      if (t.ops.cannons !== undefined) opsRows.push(line(`Feeds ${t.ops.cannons} cannon${t.ops.cannons === 1 ? '' : 's'} within pipe range`, t.ops.cannons === 0 ? 'bad' : ''));
    } else if (t.ops?.kind === 'cannon') {
      const c = t.ops.info, head = line(c.headline, c.status === 'running' ? 'good' : c.status === 'full' || c.status === 'off' || c.status === 'paused' ? '' : 'bad');
      head.dataset.role = 'cannon-status';
      const tog = document.createElement('button'), globalOff = c.mode === 'off';
      tog.dataset.role = 'cannon-toggle'; tog.textContent = c.switchedOff || globalOff ? 'Turn this cannon on' : 'Turn this cannon off'; tog.disabled = globalOff;
      tog.title = globalOff ? 'Snowmaking is Off for the whole resort: change it in Operations' : 'A switched-off cannon uses no energy or water and pays 15% upkeep';
      tog.addEventListener('click', () => { this.onCannon?.(t.id, !!c.switchedOff); });
      opsRows.push(head, tog,
        line(`Covers ${c.tiles} tiles (${c.pisteTiles} piste) · throw ${c.radius} tiles, ${c.offPisteRadius} off-piste`),
        line(`Last night: +${c.gainCm.toFixed(1)} cm average · ${c.waterLast} water used`),
        line(`Reservoir${c.reservoirs === 1 ? '' : 's'}: ${Math.round(c.level)} / ${Math.round(c.capacity)} (${Math.round((100 * c.level) / Math.max(1, c.capacity))}%)`, c.level < 1 ? 'bad' : ''));
    }
    const extra: HTMLElement[] = [];
    if (this.onRotate && d && d.w !== d.h) {
      const rb = document.createElement('button');
      rb.textContent = '⟳ Rotate'; rb.title = 'Rotate 90° (Shift+click: back). The rotated footprint must be free and flat enough.';
      rb.addEventListener('click', (ev) => { this.rotateMsg = this.onRotate?.(t.id, ev.shiftKey ? -1 : 1) ?? ''; if (this.rotateMsg) this.show(t); });
      extra.push(rb);
    }
    if (this.onWalk) {
      const wb = document.createElement('button');
      wb.append(icon('walk', 13), document.createTextNode(' Walk here')); wb.dataset.role = 'walk'; wb.title = 'Walk around next to this building in first person (Esc to return)';
      wb.addEventListener('click', () => this.onWalk?.(t.id));
      extra.push(wb);
    }
    if (this.rotateMsg) { extra.push(line(`Cannot rotate: ${this.rotateMsg}`, 'bad')); this.rotateMsg = ''; }
    let title: HTMLElement = Object.assign(document.createElement('strong'), { textContent: t.name ?? d?.name ?? displayName(t.type) });
    if (this.onRename && t.name) {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = t.name; inp.maxLength = 32; inp.title = 'Rename (Enter to save, empty = automatic name)'; inp.style.cssText = 'font-weight:700;min-width:0';
      inp.addEventListener('keydown', (ev) => ev.stopPropagation());
      inp.addEventListener('change', () => this.onRename?.(t.id, inp.value));
      title = inp;
    }
    this.body.replaceChildren(
      title,
      line(t.active ? 'Status: active' : `Status: inactive — ${lowerFirst(t.reason ?? 'unknown')}`, t.active ? 'ok' : 'bad'),
      ...(t.conditions ? [line(t.conditions.open ? 'Conditions: open' : (t.conditions.reason ?? 'Closed'), t.conditions.open ? 'ok' : 'bad')] : []),
            ...schoolRows,
      ...opsRows,
      ...(t.attraction ? this.attractionPanel(t.attraction, t.active) : []),
      line(`Upkeep: ${formatMoney(d?.upkeep ?? 0)}/day`),
      ...(t.onFoot ? [line(`Supplied on foot: +${Math.round((REMOTE_SUPPLY_MULT - 1) * 100)}% upkeep`, 'small')] : []),
      line(`Refund: ${formatMoney(t.refund)}`),
      ...extra,
      btn,
    );
  }

  private attractionPanel(a: AttractionInfo, active = true): HTMLElement[] {
    const line = (txt: string, cls = ''): HTMLElement => Object.assign(document.createElement('div'), { textContent: txt, className: cls });
    // An inactive building's reason is already the Status line: do not repeat it as a second (contradictable) verdict.
    const stats = formatAttractionStats(a), skipFirst = !active && !a.open;
    const out: HTMLElement[] = stats.map((t, i) => (skipFirst && i === 0 ? null : line(t, i === 0 ? (a.open ? 'ok' : 'bad') : ''))).filter((e): e is HTMLElement => !!e);
    if (a.maxPrice > 0) {
      const row = document.createElement('label');
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = '0'; slider.max = String(a.maxPrice); slider.step = '1'; slider.value = String(a.price);
      const val = document.createElement('span');
      val.textContent = formatPriceLabel(a.price, a.billing);
      slider.addEventListener('input', () => { val.textContent = formatPriceLabel(Number(slider.value), a.billing); });
      slider.addEventListener('change', () => this.attr?.setPrice(a.id, Number(slider.value)));
      row.append('Price ', slider, ' ', val);
      out.push(row);
    }
    if (a.staffRequired > 0) {
      const row = document.createElement('div');
      const mk = (label: string, d: number): HTMLButtonElement => {
        const b = document.createElement('button'); b.textContent = label;
        b.addEventListener('click', () => this.attr?.adjustStaff(a.id, d));
        return b;
      };
      row.append('Staff ', mk('−', -1), ' ', mk('+', 1));
      out.push(row);
    }
    if (a.angling) {
      const row = document.createElement('label');
      row.append('Catch ', makeSelect([{ value: 'release', label: 'Catch & release' }, { value: 'keep', label: 'Keep (earns more, thins the stock)' }], a.angling.keep ? 'keep' : 'release', 'Catch setting', (v) => this.attr?.setKeep?.(a.id, v === 'keep')));
      out.push(row);
    }
    return out;
  }
}
