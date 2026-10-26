import type { ScenarioDef } from '@/sim/scenario/ScenarioDef';
import type { ScenarioRecord } from '@/persist/ProfileStore';
import { Modal } from '../modal';
import { deadlineRealTimeText } from '@/core/pacing';
import { deadlineDays } from '@/sim/scenario/ScenarioDef';
import { DIFFICULTY_WORD, MEDAL_LABEL, MEDAL_TIER, SEASON_LABEL, deadlineText, objectiveSummary, starsText } from '../scenarioFormat';
import { medalSvg } from '../yearReportFormat';
import { StElement } from './StElement';

export interface ScenariosApi {
  /** The shipped scenarios, in picker order. */
  list(): readonly ScenarioDef[];
  /** Best results of the local profile. */
  record(id: string): Readonly<ScenarioRecord>;
  /** Start a scenario (the host reloads with `?scenario=<id>`). */
  play(id: string): void;
  /** Subscribe to profile changes (returns the unsubscribe). */
  onChange?(fn: () => void): () => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/**
 * Scenario picker (M5.3 Task 15): a shared-dialog modal (`lg`) with one card per shipped scenario: name, tagline, difficulty stars, map size,
 * season, objectives summary, best medal (SVG) + score, and a Play button. No gating (every scenario is always available) and nothing to import,
 * export or share (D8). Closed = nothing rendered, no pointer events.
 */
export class StScenarios extends StElement {
  private api: ScenariosApi | null = null;
  private readonly dlg: Modal;
  private off: (() => void) | null = null;

  protected css(): string {
    return `:host{display:block;width:0;height:0}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.card{display:flex;flex-direction:column;gap:5px;min-width:0;padding:10px 12px;background:#1c2838;border:1px solid #2f4057;border-radius:var(--r-md)}
.card:hover{border-color:#4f6684}
.top{display:flex;align-items:flex-start;gap:8px}
.top .nm{flex:1;min-width:0}
.top h3{margin:0;font:400 var(--fs-lg)/1.15 var(--font-display);color:var(--c-accent-text);letter-spacing:.3px}
.tag{font-size:12.5px;color:#cfe0f5;font-style:italic;line-height:1.25}
.medal{flex:0 0 36px;text-align:center}.medal svg{display:block}.medal.none{opacity:.35}
.meta{display:flex;flex-wrap:wrap;gap:4px}
.chip{font-size:11px;padding:1px 7px;border-radius:9px;background:rgba(255,255,255,.07);color:#b9c6d8;white-space:nowrap}
.diff{color:#ffd070;letter-spacing:1px}
.blurb{font-size:12.5px;color:#d5e0ee;line-height:1.35;margin:0}
ul.obj{margin:0;padding:0 0 0 16px;font-size:12px;color:#c9dcf3}ul.obj li{padding:0}
.more{font-size:11.5px;color:#9fb4cc}
.best{font-size:11.5px;color:#9fb4cc}
.foot{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:4px}.foot .best{flex:1;min-width:0}
@media (max-width:760px){.grid{grid-template-columns:1fr}}`;
  }

  constructor() {
    super();
    this.dlg = new Modal(this.root, {
      title: 'Scenarios', icon: '🏔', size: 'lg', label: 'Scenarios',
      onOpen: () => this.setAttribute('open', ''),
      onClose: () => { this.removeAttribute('open'); this.off?.(); this.off = null; },
    });
  }

  bind(api: ScenariosApi): void { this.api = api; }
  get isOpen(): boolean { return this.dlg.isOpen; }
  open(): void {
    if (!this.api) return;
    this.render();
    this.off?.(); this.off = this.api.onChange?.(() => { if (this.dlg.isOpen) this.render(); }) ?? null;
    this.dlg.open();
  }
  close(): void { this.dlg.close(); }
  /** Click a card's Play button (tests). */
  play(id: string): boolean { const b = this.root.querySelector<HTMLButtonElement>(`[data-scenario="${id}"] button.play`); b?.click(); return !!b; }

  private render(): void {
    const api = this.api!;
    const intro = el('p', 'hint', 'Hand-made challenges with a deadline, objectives and medals. Every scenario is open from the start; a medal only records how well you did.');
    const grid = el('div', 'grid');
    for (const d of api.list()) {
      const r = api.record(d.id);
      const c = el('div', 'card'); c.dataset.scenario = d.id;
      const top = el('div', 'top');
      const nm = el('div', 'nm'); nm.append(el('h3', '', d.name), el('div', 'tag', d.tagline));
      const medal = el('div', `medal ${r.bestMedal}`); medal.dataset.medal = r.bestMedal; medal.title = r.bestMedal === 'none' ? 'No medal yet' : `Best medal: ${MEDAL_LABEL[r.bestMedal]}`;
      medal.innerHTML = medalSvg(MEDAL_TIER[r.bestMedal], 34);
      top.append(nm, medal);
      const meta = el('div', 'meta');
      const diff = el('span', 'chip diff', starsText(d.stars)); diff.title = `Difficulty: ${DIFFICULTY_WORD[d.stars] ?? ''}`; diff.setAttribute('aria-label', `Difficulty ${d.stars} of 5`);
      meta.append(diff, el('span', 'chip', `Map ${d.mapSize}`), el('span', 'chip', SEASON_LABEL[d.startSeason]), (() => { const c = el('span', 'chip', deadlineText(d)); c.title = `Real time: ${deadlineRealTimeText(deadlineDays(d.deadline))}`; return c; })());
      const sum = objectiveSummary(d);
      const ul = el('ul', 'obj');
      for (const t of sum.required) ul.append(el('li', '', t));
      const extra = [sum.moreRequired ? `+${sum.moreRequired} more required` : '', sum.optional ? `${sum.optional} bonus objective${sum.optional === 1 ? '' : 's'} for medals` : ''].filter(Boolean).join(', ');
      const best = el('div', 'best', r.attempts === 0 ? 'Not played yet' : r.wins === 0 ? `${r.attempts} attempt${r.attempts === 1 ? '' : 's'}, not won yet` : `Best: ${MEDAL_LABEL[r.bestMedal]} \u00B7 ${r.bestScore} pts \u00B7 ${r.bestDays} days`);
      const play = el('button', 'primary play', r.attempts === 0 ? 'Play' : 'Play again'); play.title = `Start ${d.name}`; play.dataset.action = 'play';
      play.addEventListener('click', () => api.play(d.id));
      const foot = el('div', 'foot'); foot.append(best, play);
      c.append(top, meta, el('p', 'blurb', d.blurb), ul);
      if (extra) c.append(el('div', 'more', extra));
      c.append(foot);
      grid.append(c);
    }
    this.dlg.body.replaceChildren(intro, grid);
    const close = el('button', 'ghost', 'Close'); close.dataset.action = 'close-picker'; close.addEventListener('click', () => this.dlg.close());
    this.dlg.footer.replaceChildren(close);
  }
}
