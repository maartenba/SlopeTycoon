import { StElement } from './StElement';

export interface PisteInspectorInfo {
  id: number; name: string; autoName: string;
  difficultyLabel: string; difficultyColor: string;
  lengthM: number; dropM: number; openLengthM: number; open: boolean;
  avgQuality: string | null; skiersToday: number; runsToday?: number; warnings: string[];
  highlighted: boolean;
}
export interface PisteInspectorApi {
  /** Commit a name (already trimmed/clamped by the component; empty = reset to the automatic name). */
  rename(name: string): void;
  highlight(on: boolean): void;
}

export const PISTE_NAME_MAX = 24;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);

/** Piste inspector (select a piste tile): editable name, difficulty, length/drop/open length, quality, traffic, warnings, highlight toggle. */
export class StPisteInspector extends StElement {
  private api: PisteInspectorApi | null = null;
  private panel = document.createElement('div');
  protected css(): string {
    return ':host{position:absolute;right:8px;top:56px}.panel{flex-direction:column;align-items:stretch;min-width:230px;max-width:280px;display:none;gap:4px}'
      + '.row{display:flex;gap:6px;align-items:center}.warn{color:#ff9a8a}.small{font-size:11px;opacity:.85}.dot{display:inline-block;width:12px;height:12px;border-radius:50%;border:1px solid #fff8}';
  }
  constructor() {
    super();
    this.panel.className = 'panel';
    this.root.appendChild(this.panel);
  }
  bind(api: PisteInspectorApi): void { this.api = api; }
  /** True while the name input has focus (callers skip live refreshes so typing is not interrupted). */
  get busy(): boolean { return !!this.root.activeElement && this.panel.contains(this.root.activeElement); }

  show(i: PisteInspectorInfo | null): void {
    if (!i) { this.panel.style.display = 'none'; return; }
    this.panel.style.display = 'flex';
    const a = this.api;
    const line = (t: string, cls = ''): HTMLElement => el('div', { textContent: t, className: cls });
    const dot = el('span', { className: 'dot', title: i.difficultyLabel });
    dot.style.background = i.difficultyColor;
    const input = el('input', { type: 'text', value: i.name, maxLength: PISTE_NAME_MAX, title: 'Rename (Enter to save, empty = automatic name)' });
    input.style.cssText = 'font-weight:700;min-width:0;flex:1';
    let committed = i.name;
    const commit = (): void => {
      const v = input.value.replace(/\s+/g, ' ').trim().slice(0, PISTE_NAME_MAX);
      const next = v || i.autoName;
      if (next === committed) { input.value = next; return; }
      committed = next; input.value = next;
      a?.rename(v);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); input.blur(); } e.stopPropagation(); });
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    const head = el('div', { className: 'row' });
    head.append(dot, input);
    const kids: HTMLElement[] = [head];
    kids.push(line(`${i.difficultyLabel} piste · ${i.open ? 'Open' : 'Closed'}`, i.open ? '' : 'warn'));
    kids.push(line(`Length ${i.lengthM.toLocaleString('en-US')} m · drop ${i.dropM.toLocaleString('en-US')} m`));
    kids.push(line(`Open now: ${i.openLengthM.toLocaleString('en-US')} m`));
    kids.push(line(`Surface: ${i.avgQuality ?? 'n/a'} · busiest tile ${i.skiersToday} passes today · runs today: ${i.runsToday ?? 0}`, 'small'));
    for (const w of i.warnings) kids.push(line(`⚠ ${w}`, 'warn'));
    const hl = el('input', { type: 'checkbox', checked: i.highlighted });
    hl.addEventListener('change', () => a?.highlight(hl.checked));
    const hlL = el('label'); hlL.append(hl, ' Highlight on map');
    kids.push(hlL);
    this.panel.replaceChildren(...kids);
  }
}
