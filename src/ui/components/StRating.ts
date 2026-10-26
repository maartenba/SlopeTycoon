import type { RatingBreakdown } from '@/sim/Rating';
import { StElement } from './StElement';
import { icon, smileyIcon, starRow } from '../icons';

export const starString = (stars: number): string => {
  const full = Math.floor(stars), half = stars - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
};
export const smiley = (h: number): string => (h > 0.75 ? '😄' : h > 0.55 ? '🙂' : h > 0.35 ? '😐' : '🙁');
export const ratingTooltip = (b: RatingBreakdown): string =>
  [`Resort rating ${b.stars}★ (${Math.round(b.score)}/100)`, ...b.components.map((c) => `${c.label}: ${Math.round(c.score)}${c.score < 60 ? ` – ${c.hint}` : ''}`), ...(b.hints.length ? ['', `Tip: ${b.hints[0]}`] : [])].join('\n');

/** Star delta (score 0..100 -> 0..5 stars) shown as a chip only when it moved by at least 0.1★; U+2212 minus. */
export const CHIP_MIN = 0.1;
export const CHIP_MS = 3000;
export function ratingDeltaStars(prevScore: number, score: number): number { return Math.round(((score - prevScore) / 20) * 10) / 10; }
export function ratingChipText(delta: number): string | null {
  if (!Number.isFinite(delta) || Math.abs(delta) < CHIP_MIN - 1e-9) return null;
  return `${delta > 0 ? '+' : '\u2212'}${Math.abs(delta).toFixed(1)}\u2605`;
}

/** Regional market share (Task 23): your share 0..1, rank (1 = leader) among `of` resorts. */
export interface MarketInfo { share: number; rank: number; of: number }

/** HUD rating widget: stars + smiley with a breakdown tooltip; click toggles a bar panel with hints. */
export class StRating extends StElement {
  private label = document.createElement('span');
  private panel = document.createElement('div');
  private get: (() => { breakdown: RatingBreakdown; happiness: number; market?: MarketInfo | null }) | null = null;
  private timer = 0;
  private chip = document.createElement('span');
  private baseScore: number | null = null;
  private baseStars = -1;
  private chipTimer = 0;

  protected css(): string {
    return `:host{position:relative}span.l{cursor:pointer;display:inline-flex;align-items:center;gap:2px;white-space:nowrap}.pop{position:absolute;top:26px;right:0;width:260px;z-index:5;background:rgba(22,32,46,.98);border:1px solid #34465e;border-radius:8px;padding:8px 10px;box-shadow:0 6px 18px rgba(0,0,0,.45);flex-direction:column;align-items:stretch;gap:3px}
.row{display:grid;grid-template-columns:100px 1fr 28px;gap:6px;align-items:center;font-size:11px}.t{height:7px;background:#233044;border-radius:4px;overflow:hidden}.f{height:100%;background:#4caf50}.tip{color:#ffd070;font-size:11px}
.chip[hidden]{display:none}.chip{font-size:10px;font-weight:700;padding:0 4px;border-radius:7px;background:rgba(28,42,56,.7);margin-left:2px;opacity:0;transition:opacity .6s ease}.chip.up{color:#a8dca0}.chip.down{color:#e6a39a}.chip.on{opacity:.95}
svg.fade{animation:starfade .7s ease-out}@keyframes starfade{from{opacity:.35}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.chip{transition:none}svg.fade{animation:none}}`;
  }

  constructor() {
    super();
    this.label.className = 'l';
    this.label.addEventListener('click', () => { this.panel.hidden = !this.panel.hidden; this.refresh(); });
    this.chip.className = 'chip'; this.chip.hidden = true; this.chip.setAttribute('aria-live', 'polite');
    this.panel.className = 'panel pop'; this.panel.hidden = true;
    this.root.append(this.label, this.panel);
  }

  /** 'Show me' for rating advice: open the breakdown panel (and keep it open). */
  open(): void { this.panel.hidden = false; this.refresh(); }

  bind(get: () => { breakdown: RatingBreakdown; happiness: number; market?: MarketInfo | null }): void {
    this.get = get; this.refresh();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.refresh(), 1000);
    this.track(() => { window.clearInterval(this.timer); window.clearTimeout(this.chipTimer); });
  }

  /** Remember the baseline score; show a chip for CHIP_MS when it moved >= 0.1★ since the baseline. */
  private noteScore(score: number): void {
    if (this.baseScore === null) { this.baseScore = score; return; }
    const text = ratingChipText(ratingDeltaStars(this.baseScore, score));
    if (!text) return;
    const d = ratingDeltaStars(this.baseScore, score);
    this.baseScore = score;
    this.chip.textContent = text; this.chip.className = `chip ${d > 0 ? 'up' : 'down'}`; this.chip.hidden = false;
    this.chip.title = d > 0 ? 'Rating went up' : 'Rating went down';
    requestAnimationFrame(() => this.chip.classList.add('on'));
    window.clearTimeout(this.chipTimer);
    this.chipTimer = window.setTimeout(() => { this.chip.classList.remove('on'); this.chipTimer = window.setTimeout(() => { this.chip.hidden = true; }, 650); }, CHIP_MS);
  }

  /** The details panel is fixed to the viewport under the stars: the HUD box clips (overflow:hidden) anything that is merely absolutely positioned inside it. */
  private place(): void {
    const r = this.label.getBoundingClientRect();
    this.panel.style.position = 'fixed';
    this.panel.style.top = `${Math.round(r.bottom + 6)}px`;
    this.panel.style.left = 'auto';
    this.panel.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
  }

  refresh(): void {
    if (!this.get) return;
    const { breakdown: b, happiness, market } = this.get();
    const stars = starRow(b.stars, 12);
    if (this.baseStars >= 0 && b.stars !== this.baseStars) stars.classList.add('fade'); // gentle crossfade, no bounce
    this.baseStars = b.stars;
    this.noteScore(b.score);
    this.label.replaceChildren(stars, document.createTextNode(' '), icon(smileyIcon(happiness), 14), this.chip);
    this.label.setAttribute('role', 'button'); this.label.setAttribute('aria-label', `Resort rating ${b.stars} of 5 stars. Click for details`); this.label.tabIndex = 0;
    this.label.title = ratingTooltip(b);
    if (this.panel.hidden) return;
    this.place();
    const rows = b.components.map((c) => {
      const r = document.createElement('div'); r.className = 'row';
      const n = document.createElement('span'); n.textContent = c.label; n.title = c.hint;
      const t = document.createElement('div'); t.className = 't'; const f = document.createElement('div'); f.className = 'f'; f.style.width = `${c.score}%`; t.append(f);
      const v = document.createElement('span'); v.textContent = String(Math.round(c.score));
      r.append(n, t, v); return r;
    });
    const tips = b.hints.slice(0, 3).map((h) => { const d = document.createElement('div'); d.className = 'tip'; d.append(icon('bulb', 12), ` ${h}`); return d; });
    const m = market ? document.createElement('div') : null;
    if (m && market) { m.className = 'tip mkt'; m.style.color = '#9fb4cc'; m.textContent = `Market share ${Math.round(market.share * 100)}% (#${market.rank} of ${market.of} nearby resorts)`; m.title = 'Your share of the region\u2019s guests, from your rating and day-pass price compared with your neighbours.'; }
    this.panel.replaceChildren(...rows, ...(m ? [m] : []), ...tips);
  }
}
