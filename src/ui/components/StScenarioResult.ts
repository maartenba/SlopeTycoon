import type { Medal, ScenarioResult } from '@/sim/scenario/ScenarioRunner';
import type { ScenarioRecord } from '@/persist/ProfileStore';
import { Modal } from '../modal';
import { MEDAL_LABEL, MEDAL_TIER } from '../scenarioFormat';
import { medalSvg } from '../yearReportFormat';
import { StElement } from './StElement';

export interface ScenarioResultActions {
  /** After a win: keep playing in sandbox mode (objectives off, everything unlocked). */
  continueSandbox(): void;
  retry(): void;
  menu(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/**
 * Win / lose dialog (M5.3 Task 15): shared-dialog modal (`md`). The host pauses the game first. Shows the medal, the reason, the score, the
 * objective breakdown and the previous best. Win: Continue playing (sandbox mode) / Retry / Back to menu; lose: Retry / Back to menu.
 * Esc / X dismiss it and leave the game paused (the HUD card keeps a Results button). No sharing (D8).
 */
export class StScenarioResult extends StElement {
  private readonly dlg: Modal;
  private acts: ScenarioResultActions | null = null;

  protected css(): string {
    return `:host{position:absolute;left:0;top:0;width:0;height:0}
.hero{display:flex;align-items:center;gap:14px}
.hero .m svg{display:block}.hero .m.none{opacity:.3}
.hero h3{margin:0;font:400 var(--fs-xl)/1.1 var(--font-display);color:#ffe29a}.hero.lost h3{color:#ff9a8a}
.hero p{margin:2px 0 0;color:#cfe0f5;font-size:13px}
.score{display:flex;gap:18px;flex-wrap:wrap}.score .k{font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:#9fb4cc}.score .v{font-size:22px;font-weight:800}
.score .best{color:#9fb4cc;font-size:12.5px;align-self:end}
ul.rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
ul.rows li{display:grid;grid-template-columns:22px 1fr auto;gap:6px;align-items:center;padding:4px 8px;background:#1c2838;border:1px solid #2c3b50;border-radius:var(--r-sm);font-size:12.5px}
ul.rows li .ic{text-align:center;font-weight:800}.ok .ic{color:#7fd68a}.no .ic{color:#ff9a8a}.pend .ic{color:#9fb4cc}
ul.rows li .vv{color:#9fb4cc;font-size:11.5px;white-space:nowrap}ul.rows li .opt{color:#9fb4cc;font-size:11px;margin-left:6px}
h4{margin:2px 0 0;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:#7f93ad}`;
  }

  constructor() {
    super();
    this.dlg = new Modal(this.root, {
      title: 'Scenario', icon: '🏁', size: 'md', label: 'Scenario result', backdropClose: false,
      onClose: () => { this.removeAttribute('open'); },
    });
  }

  bind(acts: ScenarioResultActions): void { this.acts = acts; }
  get isOpen(): boolean { return this.dlg.isOpen; }
  close(): void { this.dlg.close(); }
  /** Click a footer action by data-action (tests). */
  clickAction(id: string): boolean { const b = [...this.root.querySelectorAll<HTMLButtonElement>('footer button')].find((x) => x.dataset.action === id); b?.click(); return !!b; }

  /** `previous` = the profile record BEFORE this result was stored (so 'best so far' can be compared). */
  show(name: string, r: ScenarioResult, previous?: Readonly<ScenarioRecord>): void {
    const won = r.result === 'won';
    this.dlg.setTitle(won ? `${name}: complete` : `${name}: failed`, won ? '🏆' : '🏁');
    const hero = el('div', `hero ${won ? 'won' : 'lost'}`);
    const m = el('div', `m ${r.medal}`); m.dataset.medal = r.medal; m.innerHTML = medalSvg(MEDAL_TIER[r.medal], 64);
    const tx = el('div'); tx.append(el('h3', '', won ? `${MEDAL_LABEL[r.medal]} medal` : 'Not this time'), el('p', '', r.reason));
    hero.append(m, tx);

    const score = el('div', 'score');
    const tile = (k: string, v: string): HTMLElement => { const d = el('div'); d.append(el('div', 'k', k), el('div', 'v', v)); return d; };
    score.append(tile('Score', `${r.score}`), tile('Days', `${r.days}`));
    const prevBest = previous && previous.wins > 0 ? previous : null;
    const best = el('div', 'best');
    best.textContent = prevBest ? `Previous best: ${MEDAL_LABEL[prevBest.bestMedal]} \u00B7 ${prevBest.bestScore} pts \u00B7 ${prevBest.bestDays} days${won && (r.score > prevBest.bestScore) ? ' \u2014 new best score!' : ''}` : won ? 'First win of this scenario.' : 'No win recorded yet.';
    best.dataset.best = '';
    score.append(best);

    const rows = el('ul', 'rows');
    for (const o of r.objectives) {
      const li = el('li', o.met ? 'ok' : o.failed ? 'no' : 'pend'); li.dataset.objective = o.id;
      li.append(el('span', 'ic', o.met ? '\u2714' : o.failed ? '\u2716' : '\u2013'));
      const t = el('span', '', o.title); if (!o.mandatory) t.append(el('span', 'opt', 'bonus'));
      li.append(t, el('span', 'vv', o.met ? `+${o.weight}` : `${o.valueText} / ${o.targetText}`));
      rows.append(li);
    }
    this.dlg.body.replaceChildren(hero, score, el('h4', '', 'Objectives'), rows);

    const btn = (id: string, text: string, cls: string, fn: () => void): HTMLButtonElement => { const b = el('button', cls, text); b.dataset.action = id; b.addEventListener('click', fn); return b; };
    const menu = btn('menu', 'Back to menu', 'ghost', () => { this.dlg.close(); this.acts?.menu(); });
    const retry = btn('retry', 'Retry', won ? '' : 'primary', () => { this.dlg.close(); this.acts?.retry(); });
    if (!won) retry.dataset.autofocus = '';
    this.dlg.footer.replaceChildren(menu, retry);
    if (won) {
      const cont = btn('continue', 'Continue playing (sandbox mode)', 'primary', () => { this.dlg.close(); this.acts?.continueSandbox(); });
      cont.dataset.autofocus = '';
      this.dlg.footer.append(cont);
    }
    this.setAttribute('open', '');
    this.dlg.open();
  }
}
export type { Medal };
