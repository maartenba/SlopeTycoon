import { StElement } from './StElement';
import { DANGER_COLORS, type RouteInfo } from '../backcountryFormat';

export interface RouteInspectorApi {
  /** Per-route 'Open at danger 4+' (the host asks to confirm before turning it ON). */
  setOverride(on: boolean): void;
  setGlobal(on: boolean): void;
  highlight?(on: boolean): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);
const SVG = 'http://www.w3.org/2000/svg';

/** The danger rose: a half circle of 5 coloured wedges (level 1 left .. 5 right); the current level is bright, the others dim. */
export function dangerRose(level: number): SVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 120 66'); svg.setAttribute('width', '120'); svg.setAttribute('height', '66'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Avalanche danger ${level} of 5`); svg.classList.add('rose');
  const cx = 60, cy = 60, R = 54, r = 24;
  for (let k = 1; k <= 5; k++) {
    const a0 = Math.PI + ((k - 1) / 5) * Math.PI, a1 = Math.PI + (k / 5) * Math.PI;
    const p = (a: number, rad: number): string => `${(cx + Math.cos(a) * rad).toFixed(2)},${(cy + Math.sin(a) * rad).toFixed(2)}`;
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', `M${p(a0, r)} L${p(a0, R)} A${R},${R} 0 0 1 ${p(a1, R)} L${p(a1, r)} A${r},${r} 0 0 0 ${p(a0, r)} Z`);
    path.setAttribute('fill', DANGER_COLORS[k]!); path.setAttribute('opacity', k === level ? '1' : '0.28');
    path.setAttribute('stroke', k === level ? '#fff' : '#0006'); path.setAttribute('stroke-width', k === level ? '2' : '1');
    path.dataset.level = String(k);
    svg.appendChild(path);
  }
  const t = document.createElementNS(SVG, 'text');
  t.setAttribute('x', String(cx)); t.setAttribute('y', String(cy - 2)); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '22'); t.setAttribute('font-weight', '800'); t.setAttribute('fill', '#fff');
  t.textContent = String(level);
  svg.appendChild(t);
  return svg as unknown as SVGElement;
}

/** Backcountry route inspector (select a route tile): danger rose + 'Considerable (3)', open / closed reason, length, patrol cover, the override toggles. */
export class StRouteInspector extends StElement {
  private api: RouteInspectorApi | null = null;
  private panel = document.createElement('div');
  protected css(): string {
    return ':host{position:absolute;right:8px;top:56px}.panel{flex-direction:column;align-items:stretch;min-width:230px;max-width:280px;display:none;gap:4px}'
      + '.row{display:flex;gap:6px;align-items:center}.warn{color:#ff9a8a}.small{font-size:11px;opacity:.85}.rose{align-self:center}.closed{color:#ff9a8a;font-weight:700}.open{color:#8be08b;font-weight:700}';
  }
  constructor() { super(); this.panel.className = 'panel'; this.root.appendChild(this.panel); }
  bind(api: RouteInspectorApi): void { this.api = api; }

  show(i: RouteInfo | null): void {
    if (!i) { this.panel.style.display = 'none'; this.panel.replaceChildren(); return; }
    this.panel.style.display = 'flex';
    const a = this.api;
    const line = (t: string, cls = ''): HTMLElement => el('div', { textContent: t, className: cls });
    const kids: HTMLElement[] = [];
    kids.push(el('div', { textContent: `🚩 ${i.name}`, className: 'row' })); (kids[0] as HTMLElement).style.fontWeight = '700';
    kids.push(dangerRose(i.danger) as unknown as HTMLElement);
    const dt = line(`Avalanche danger: ${i.dangerText}`); dt.dataset.danger = String(i.danger); dt.style.cssText = `font-weight:700;text-align:center;color:${i.color}`;
    kids.push(dt);
    const st = line(i.open ? 'Open' : i.closedReason ?? 'Closed', i.open ? 'open' : 'closed'); st.dataset.status = i.open ? 'open' : 'closed';
    kids.push(st);
    kids.push(line(`${i.tiles} tiles, ${i.lengthM.toLocaleString('en-US')} m · patrol cover ${i.coveredPct}%`, 'small'));
    const ov = el('input', { type: 'checkbox', checked: i.override }); ov.dataset.role = 'override';
    ov.addEventListener('change', () => a?.setOverride(ov.checked));
    const ovL = el('label'); ovL.title = 'Keep this route open at danger 4 and 5. Guests can be caught in a slide; patrol required.'; ovL.append(ov, ' Open at danger 4+');
    kids.push(ovL);
    const gl = el('input', { type: 'checkbox', checked: i.globalOverride }); gl.dataset.role = 'global';
    gl.addEventListener('change', () => a?.setGlobal(gl.checked));
    const glL = el('label'); glL.title = 'Same, for every backcountry route'; glL.append(gl, ' All routes: open at danger 4+');
    kids.push(glL);
    for (const w of i.warnings) kids.push(line(`⚠ ${w}`, 'warn'));
    this.panel.replaceChildren(...kids);
  }
}
