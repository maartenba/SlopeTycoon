import type { SlopeProfile } from '@/sim/PisteStats';
import { StElement } from './StElement';
import { getPalette, difficultyList } from '@/config/palette';

/** Segment colours by difficulty (0 green .. 3 black). Black is drawn light so it reads on the dark panel. */
export const PROFILE_COLORS = ['#3fb950', '#3b82f6', '#e5484d', '#aab4c4'] as const;
/** Segment colour of a difficulty 0..3 in the active palette (black stays light on the dark panel). */
export const profileColor = (d: number): string => (getPalette() === 'default' ? PROFILE_COLORS[d]! : d === 3 ? '#aab4c4' : difficultyList()[d]!);
export const PROFILE_NAMES = ['Green', 'Blue', 'Red', 'Black'] as const;

export interface ProfileView {
  /** 'piste' (descent: starts at the top) or 'lift' (climb: starts at the bottom station). */
  kind: 'piste' | 'lift';
  title: string;
  profile: SlopeProfile;
  /** Current snowline altitude in metres (dashed marker); omit to hide. */
  snowlineM?: number;
  /** One-line note under the chart (e.g. snow warning). */
  note?: string;
}

const W = 316, H = 96, PAD_L = 34, PAD_B = 4, PAD_T = 6, PAD_R = 6;
const NS = 'http://www.w3.org/2000/svg';
const sv = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/**
 * Slope profile chart for the piste stroke ghost and the lift line ghost: altitude over distance, each tile segment filled by difficulty
 * (green / blue / red / black), optional snowline marker. A small transient card (320 px, pointer-events none), `show(null)` hides it.
 */
export class StProfile extends StElement {
  private card = document.createElement('div');
  private head = document.createElement('div');
  private svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
  private stats = document.createElement('div');
  private noteEl = document.createElement('div');
  private legend = document.createElement('div');

  protected css(): string {
    return `:host{position:fixed;left:calc(50% - 160px);top:216px;width:320px;pointer-events:none!important;z-index:21}
.card{pointer-events:none;box-sizing:border-box;background:var(--c-panel);border:1px solid rgba(90,112,144,.35);border-radius:var(--r-md);padding:6px 8px;display:flex;flex-direction:column;gap:3px;box-shadow:0 2px 8px rgba(0,0,0,.28)}
.head{font-weight:800;color:var(--c-accent-text);font-size:var(--fs-sm);white-space:nowrap}
.stats{font-size:var(--fs-sm);color:#cfe0f5;white-space:nowrap}
.note{font-size:var(--fs-sm);color:#ffcf80;white-space:normal}
.legend{display:flex;gap:8px;font-size:10px;color:#9fb4cc}.legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:3px;vertical-align:-1px}`;
  }

  constructor() {
    super();
    this.card.className = 'card'; this.head.className = 'head'; this.stats.className = 'stats'; this.noteEl.className = 'note'; this.legend.className = 'legend';
    for (let d = 0; d < 4; d++) { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = profileColor(d); s.append(i, PROFILE_NAMES[d]!); this.legend.appendChild(s); }
    this.card.append(this.head, this.svg, this.stats, this.noteEl, this.legend);
    this.root.appendChild(this.card);
    this.card.hidden = true; // (the host must not get attributes in its constructor)
  }

  show(v: ProfileView | null): void {
    if (!v || v.profile.samples.length < 2) { this.card.hidden = true; return; }
    this.card.hidden = false;
    const p = v.profile;
    this.head.textContent = v.title;
    const climb = v.kind === 'lift';
    this.stats.textContent = `${Math.round(p.lengthM)} m · ${climb ? 'climb' : 'drop'} ${Math.round(p.dropM)} m · avg ${Math.round(Math.abs(p.avgPct))}% · max ${Math.round(p.maxPct)}%`;
    this.noteEl.textContent = v.note ?? ''; this.noteEl.hidden = !v.note;
    this.draw(v);
  }

  private draw(v: ProfileView): void {
    const s = v.profile.samples;
    this.svg.replaceChildren();
    let lo = Infinity, hi = -Infinity;
    for (const q of s) { lo = Math.min(lo, q.altM); hi = Math.max(hi, q.altM); }
    if (v.snowlineM !== undefined && v.snowlineM >= lo - 60 && v.snowlineM <= hi + 60) { lo = Math.min(lo, v.snowlineM); hi = Math.max(hi, v.snowlineM); }
    const span = Math.max(20, hi - lo);
    lo -= span * 0.08; hi += span * 0.08;
    const total = Math.max(1, s[s.length - 1]!.distM);
    const x = (d: number): number => PAD_L + (d / total) * (W - PAD_L - PAD_R);
    const y = (a: number): number => PAD_T + (1 - (a - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
    const base = H - PAD_B;
    // axis labels: altitude min / max
    for (const [a, anchor] of [[Math.round(hi), PAD_T + 7], [Math.round(lo), base]] as const) {
      const t = sv('text', { x: PAD_L - 3, y: anchor, 'text-anchor': 'end', fill: '#9fb4cc', 'font-size': 9 }); t.textContent = `${a}`; this.svg.appendChild(t);
    }
    this.svg.appendChild(sv('line', { x1: PAD_L, y1: base, x2: W - PAD_R, y2: base, stroke: '#40536d', 'stroke-width': 1 }));
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1]!, b = s[i]!;
      const d = Math.max(0, Math.min(3, b.difficulty));
      this.svg.appendChild(sv('polygon', {
        points: `${x(a.distM)},${y(a.altM)} ${x(b.distM)},${y(b.altM)} ${x(b.distM)},${base} ${x(a.distM)},${base}`,
        fill: profileColor(d), 'fill-opacity': 0.78, 'data-diff': d,
      }));
    }
    const line = s.map((q) => `${x(q.distM).toFixed(1)},${y(q.altM).toFixed(1)}`).join(' ');
    this.svg.appendChild(sv('polyline', { points: line, fill: 'none', stroke: '#fff', 'stroke-width': 1.4, 'stroke-opacity': 0.9, 'stroke-linejoin': 'round' }));
    if (v.snowlineM !== undefined && y(v.snowlineM) > PAD_T - 1 && y(v.snowlineM) < base) {
      const sy = y(v.snowlineM);
      this.svg.appendChild(sv('line', { x1: PAD_L, y1: sy, x2: W - PAD_R, y2: sy, stroke: '#bfe6ff', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
      const t = sv('text', { x: W - PAD_R - 2, y: sy - 2, 'text-anchor': 'end', fill: '#bfe6ff', 'font-size': 9 }); t.textContent = 'snowline'; this.svg.appendChild(t);
    }
  }
}
