import { barColour, type GuestInspectorModel } from '../guestInfo';
import { icon } from '../icons';
import { StElement } from './StElement';

/** Guest inspector card (in the right column). Rebuilds only the changing text/bars; call `show(model|null)` ~2×/s. */
export class StGuestInspector extends StElement {
  private box = document.createElement('div');
  private onClose: (() => void) | null = null;

  protected css(): string {
    return `.panel{flex-direction:column;align-items:stretch;gap:4px}h4{margin:0;font-size:13px;color:#ffd070;display:flex;justify-content:space-between}
.bar{display:grid;grid-template-columns:70px 1fr 44px;gap:6px;align-items:center}.track{height:8px;background:#233044;border-radius:4px;overflow:hidden}.fill{height:100%}
ul{margin:0;padding-left:16px}.muted{color:#9fb0c8}`;
  }

  constructor() {
    super();
    this.box.className = 'panel';
    this.root.appendChild(this.box);
  }

  private shown = false;

  /** Host attributes may not be set in the constructor (document.createElement forbids it). */
  connectedCallback(): void { this.hidden = !this.shown; }

  private onRide: ((guestId: number) => void) | null = null;

  bind(onClose: () => void, onRide?: (guestId: number) => void): void { this.onClose = onClose; this.onRide = onRide ?? null; }

  show(m: GuestInspectorModel | null): void {
    if (!m) { this.shown = false; this.hidden = true; return; }
    this.shown = true;
    this.hidden = false;
    const h = document.createElement('h4');
    const t = document.createElement('span'); t.textContent = `${m.title} · ${m.type} · ${m.skill}`;
    const x = document.createElement('button'); x.textContent = '✕'; x.addEventListener('click', () => this.onClose?.());
    h.append(t, x);
    const els: HTMLElement[] = [h];
    for (const b of m.bars) {
      const r = document.createElement('div'); r.className = 'bar';
      const l = document.createElement('span'); l.textContent = b.label;
      const tr = document.createElement('div'); tr.className = 'track';
      const f = document.createElement('div'); f.className = 'fill'; f.style.width = `${Math.round(b.value * 100)}%`; f.style.background = barColour(b.value, b.good);
      tr.append(f);
      const v = document.createElement('span'); v.textContent = b.text;
      r.append(l, tr, v); els.push(r);
    }
    const act = document.createElement('div'); act.textContent = `Doing: ${m.activity}${m.queue ? ` (${m.queue})` : ''}`; els.push(act);
    if (m.family) { const f = document.createElement('div'); f.className = 'muted'; f.textContent = m.family; els.push(f); }
    const ul = document.createElement('ul');
    for (const th of m.thoughts) { const li = document.createElement('li'); li.textContent = th; ul.append(li); }
    els.push(ul);
    if (this.onRide) {
      const ride = document.createElement('button'); ride.className = 'ride'; ride.title = 'Follow this guest at eye level (Esc to exit)';
      ride.append(icon('eye', 13), document.createTextNode(' Ride along'));
      const id = m.id;
      ride.addEventListener('click', () => this.onRide?.(id));
      els.push(ride);
    }
    this.box.replaceChildren(...els);
  }
}
