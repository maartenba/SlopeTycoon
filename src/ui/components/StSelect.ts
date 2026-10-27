import { modalStack, type StackEntry } from '../modal';
import { StElement } from './StElement';

export interface SelectOption { value: string; label: string; title?: string; disabled?: boolean }

let uid = 0;

/**
 * Game-styled drop-down (replaces the native <select>): a button + a themed popup listbox in the component's own shadow root
 * (position:fixed from the button's rect, flips above when there is no room, self-corrects when an ancestor makes fixed relative).
 * API like a select: `value`, `options` / `setOptions()`, `disabled`, `change` + `input` events (bubbling, composed).
 * Keyboard: Enter/Space/ArrowDown open; ArrowUp/Down/Home/End move; Enter/Space pick; Esc closes only the popup (modal stack); Tab closes; typeahead.
 * Mouse: click toggles, click outside closes. ARIA: button[aria-haspopup=listbox] + ul[role=listbox] > li[role=option][aria-selected].
 */
export class StSelect extends StElement {
  private opts: SelectOption[] = [];
  private val = '';
  private btn = document.createElement('button');
  private labelEl = document.createElement('span');
  private list = document.createElement('ul');
  private isOpenFlag = false;
  private active = -1;
  private typed = '';
  private typedAt = 0;
  private readonly lid = `st-select-${++uid}`;
  private readonly entry: StackEntry = { close: () => this.close(false) };
  private readonly outside = (e: Event): void => { if (!e.composedPath().includes(this)) this.close(false); };

  protected css(): string {
    return ':host{display:inline-block;position:relative;vertical-align:middle;min-width:90px}' +
      'button.sel{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;text-align:left;background:var(--c-field);border:1px solid var(--c-field-border);padding:3px 7px;font-weight:600}' +
      'button.sel:hover:not(:disabled){background:#162131;border-color:#5f7798}button.sel[aria-expanded=true]{border-color:var(--c-accent-text)}' +
      '.lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.car{width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid #b9c6d8;transition:transform .12s}' +
      'button.sel[aria-expanded=true] .car{transform:rotate(180deg)}' +
      'ul{display:none;position:fixed;z-index:1000;margin:0;padding:4px;list-style:none;box-sizing:border-box;max-height:260px;overflow:auto;background:#121a26;border:1px solid #5f7798;border-radius:var(--r-md);box-shadow:0 10px 30px rgba(0,0,0,.6)}' +
      'ul.open{display:block}li{padding:5px 9px;min-height:var(--touch-min,0px);display:flex;align-items:center;border-radius:4px;cursor:pointer;white-space:nowrap;color:#e6eefb;font-weight:600}li.act{background:#2a3d57}li[aria-selected=true]{color:var(--c-accent-text)}li[aria-selected=true]::before{content:"✓ ";font-weight:800}li[aria-disabled=true]{opacity:.4;cursor:default}';
  }

  constructor() {
    super();
    this.btn.type = 'button'; this.btn.className = 'sel';
    this.btn.setAttribute('aria-haspopup', 'listbox'); this.btn.setAttribute('aria-expanded', 'false');
    const car = document.createElement('i'); car.className = 'car';
    this.labelEl.className = 'lbl';
    this.btn.append(this.labelEl, car);
    this.list.setAttribute('role', 'listbox'); this.list.id = this.lid; this.list.tabIndex = -1;
    this.btn.setAttribute('aria-controls', this.lid);
    this.root.append(this.btn, this.list);
    this.btn.addEventListener('click', () => { if (this.isOpenFlag) this.close(true); else this.open(); });
    this.btn.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus on the button
    this.list.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest('li');
      if (li) { const i = Number(li.dataset.i); this.pick(i); }
    });
  }

  connectedCallback(): void {
    if (!this.hasAttribute('role-label') && this.getAttribute('aria-label')) this.btn.setAttribute('aria-label', this.getAttribute('aria-label')!);
  }
  disconnectedCallback(): void { super.disconnectedCallback(); this.close(false); }
  static get observedAttributes(): string[] { return ['aria-label', 'title', 'disabled']; }
  attributeChangedCallback(name: string, _o: string | null, v: string | null): void {
    if (name === 'aria-label' || name === 'title') { if (v) this.btn.setAttribute(name, v); }
    if (name === 'disabled') this.btn.disabled = v !== null;
  }

  get options(): readonly SelectOption[] { return this.opts; }
  set options(o: readonly SelectOption[]) { this.setOptions(o); }
  setOptions(o: readonly SelectOption[], value?: string): void {
    this.opts = o.map((x) => ({ ...x }));
    this.val = value ?? (this.opts.some((x) => x.value === this.val) ? this.val : this.opts[0]?.value ?? '');
    this.renderList(); this.syncLabel();
  }
  get value(): string { return this.val; }
  set value(v: string) { if (this.opts.some((o) => o.value === v)) { this.val = v; this.syncLabel(); this.markSelected(); } }
  get selectedIndex(): number { return this.opts.findIndex((o) => o.value === this.val); }
  get disabled(): boolean { return this.btn.disabled; }
  set disabled(v: boolean) { this.btn.disabled = v; }
  get isOpen(): boolean { return this.isOpenFlag; }
  focus(): void { this.btn.focus(); }
  /** Inner trigger button (tests / harness). */
  get button(): HTMLButtonElement { return this.btn; }

  open(): void {
    if (this.isOpenFlag || this.btn.disabled || !this.opts.length) return;
    this.isOpenFlag = true; this.typed = '';
    this.btn.setAttribute('aria-expanded', 'true');
    this.list.classList.add('open');
    this.active = Math.max(0, this.selectedIndex);
    this.markActive();
    this.place();
    modalStack.push(this.entry);
    document.addEventListener('pointerdown', this.outside, true);
    document.addEventListener('mousedown', this.outside, true);
  }
  close(refocus: boolean): void {
    if (!this.isOpenFlag) return;
    this.isOpenFlag = false;
    this.btn.setAttribute('aria-expanded', 'false');
    this.list.classList.remove('open');
    modalStack.remove(this.entry);
    document.removeEventListener('pointerdown', this.outside, true);
    document.removeEventListener('mousedown', this.outside, true);
    if (refocus) this.btn.focus();
  }

  /** Choose option `i` (fires `input` + `change` when the value changed). */
  pick(i: number): void {
    const o = this.opts[i];
    if (!o || o.disabled) return;
    const changed = o.value !== this.val;
    this.val = o.value; this.syncLabel(); this.markSelected(); this.close(true);
    if (changed) { this.dispatchEvent(new Event('input', { bubbles: true, composed: true })); this.dispatchEvent(new Event('change', { bubbles: true, composed: true })); }
  }

  private syncLabel(): void {
    const o = this.opts.find((x) => x.value === this.val);
    this.labelEl.textContent = o?.label ?? '';
    if (o?.title) this.btn.title = o.title; else if (!this.getAttribute('title')) this.btn.removeAttribute('title');
  }

  private renderList(): void {
    this.list.replaceChildren(...this.opts.map((o, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option'); li.id = `${this.lid}-${i}`; li.dataset.i = String(i); li.textContent = o.label;
      if (o.title) li.title = o.title;
      if (o.disabled) li.setAttribute('aria-disabled', 'true');
      li.setAttribute('aria-selected', String(o.value === this.val));
      return li;
    }));
  }
  private markSelected(): void { [...this.list.children].forEach((li, i) => li.setAttribute('aria-selected', String(this.opts[i]?.value === this.val))); }
  private markActive(): void {
    [...this.list.children].forEach((li, i) => li.classList.toggle('act', i === this.active));
    const li = this.list.children[this.active] as HTMLElement | undefined;
    if (li) { this.btn.setAttribute('aria-activedescendant', li.id); li.scrollIntoView?.({ block: 'nearest' }); }
  }

  /** Position the popup under (or above) the button; correct for ancestors that re-base `position:fixed`. */
  private place(): void {
    const r = this.btn.getBoundingClientRect();
    const vh = window.innerHeight || 800, vw = window.innerWidth || 1280;
    const l = this.list;
    l.style.minWidth = `${Math.max(r.width, 80)}px`; l.style.maxHeight = '260px';
    const h = Math.min(l.scrollHeight || 200, 260);
    const below = vh - r.bottom - 8, above = r.top - 8;
    const up = below < h && above > below;
    l.style.maxHeight = `${Math.max(80, Math.min(260, up ? above : below))}px`;
    const hh = Math.min(h, up ? above : below);
    let top = up ? r.top - hh - 3 : r.bottom + 3, left = r.left;
    const w = l.offsetWidth || r.width;
    if (left + w > vw - 8) left = Math.max(8, vw - 8 - w);
    l.style.left = `${left}px`; l.style.top = `${top}px`;
    const got = l.getBoundingClientRect();
    if (got.width && (Math.abs(got.left - left) > 1 || Math.abs(got.top - top) > 1)) { // an ancestor is the containing block: shift by the delta
      l.style.left = `${left - (got.left - left)}px`; l.style.top = `${top - (got.top - top)}px`; top = 0;
    }
  }

  private move(d: number): void {
    const n = this.opts.length; if (!n) return;
    let i = this.active;
    for (let k = 0; k < n; k++) { i = (i + d + n) % n; if (!this.opts[i]!.disabled) break; }
    this.active = i; this.markActive();
  }

  private onKey(e: KeyboardEvent): void {
    const k = e.key;
    if (!this.isOpenFlag) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); this.open(); return; }
      if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { const i = this.search(k); if (i >= 0) this.pick(i); }
      return;
    }
    if (k === 'ArrowDown') { e.preventDefault(); this.move(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); this.move(-1); }
    else if (k === 'Home') { e.preventDefault(); this.active = 0; this.markActive(); }
    else if (k === 'End') { e.preventDefault(); this.active = this.opts.length - 1; this.markActive(); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); this.pick(this.active); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(true); }
    else if (k === 'Tab') this.close(false);
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { const i = this.search(k); if (i >= 0) { this.active = i; this.markActive(); } }
  }

  private search(ch: string): number {
    const now = Date.now();
    this.typed = now - this.typedAt > 700 ? ch.toLowerCase() : this.typed + ch.toLowerCase();
    this.typedAt = now;
    const from = this.isOpenFlag ? this.active : this.selectedIndex;
    const n = this.opts.length;
    for (let k = this.typed.length > 1 ? 0 : 1; k <= n; k++) {
      const i = (from + k + n) % n;
      if (!this.opts[i]!.disabled && this.opts[i]!.label.toLowerCase().startsWith(this.typed)) return i;
    }
    return -1;
  }
}

/** Convenience: build an st-select with options + a change handler (use from components; the tag must be registered). */
export function makeSelect(options: readonly SelectOption[], value: string, label: string, onChange?: (v: string) => void): StSelect {
  const s = document.createElement('st-select') as StSelect;
  s.setAttribute('aria-label', label);
  s.setOptions(options, value);
  if (onChange) s.addEventListener('change', () => onChange(s.value));
  return s;
}
