import type { GameBus } from '@/core/events';
import type { ScenarioView } from '@/sim/scenario/ScenarioRunner';
import { deadlineRealTimeText } from '@/core/pacing';
import { MEDAL_LABEL, sortObjectives } from '../scenarioFormat';
import { StElement } from './StElement';

export interface ScenarioCardApi {
  /** Current view, or null when this game is not a scenario. */
  view(): ScenarioView | null;
  /** 'Finish now': bank the medal early (only offered while every required objective is met). */
  finish(): void;
  /** Re-open the result dialog of a finished scenario. */
  results?(): void;
}

const COLLAPSE_KEY = 'slopetycoon.scenarioCollapsed';

/**
 * Scenario HUD card (M5.3 Task 15): REPLACES the goal-chain card in scenario games (same right-column zone `right-goals`, same footprint
 * 260 x 140 max: the objective list scrolls inside it). Title + deadline countdown in the game calendar ('Year 1, Month 3 · 41 days left'), the
 * objectives (unmet required first) with progress bars, and a 'Finish now' button once every required objective is met. Collapsible (remembered).
 * Pure view: reads `ScenarioCardApi.view()` on day / hour / objective events.
 */
export class StScenarioCard extends StElement {
  private head = document.createElement('button');
  private sub = document.createElement('div');
  private list = document.createElement('div');
  private act = document.createElement('div');
  private api: ScenarioCardApi | null = null;
  private collapsed = false;
  private lastKey = '';

  protected css(): string {
    return `:host{display:block;box-sizing:border-box;width:100%;max-width:260px}
.panel{box-sizing:border-box;width:100%;flex-direction:column;align-items:stretch;gap:3px;padding:4px 8px 6px;font-size:calc(12px * var(--ui-scale, 1));max-height:140px}
button.head{flex:0 0 auto;display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;background:transparent;border:0;padding:2px 0;font-weight:700;color:#fff;text-align:left;min-width:0}
button.head:hover:not(:disabled){background:transparent;border:0}
.head .t{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-display);font-weight:400;letter-spacing:.3px;color:var(--c-accent-text)}
.head .n{flex:0 0 auto;color:#9fb4cc;font-size:11px;font-weight:600}.head .c{flex:0 0 auto;color:#9fb4cc;font-size:10px}
.sub{flex:0 0 auto;font-size:11px;color:#c9dcf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.list{display:flex;flex-direction:column;gap:3px;overflow-y:auto;flex:1 1 auto;min-height:0;max-height:88px;padding-right:2px}
.o{display:grid;grid-template-columns:1fr auto;column-gap:6px;row-gap:1px;align-items:center}
.o .name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:11.5px}
.o .val{color:#9fb4cc;font-size:10.5px;white-space:nowrap}
.o .bar{grid-column:1 / 3;height:4px;background:#34485f;border-radius:2px;overflow:hidden}
.o .bar>i{display:block;height:100%;background:#4caf50;border-radius:2px}
.o.opt .name{font-weight:500;color:#cfe0f5}.o.opt .bar>i{background:#5b9bd5}
.o.met .name{color:#7fd68a}.o.failed .name{color:#ff9a8a;text-decoration:line-through}.o.failed .bar>i{background:#c0524a}
.act{flex:0 0 auto;display:flex;gap:6px;align-items:center}.act:empty{display:none}
.act button{flex:1;padding:1px 6px;font-size:11px;line-height:18px}
.done{font-size:11.5px;color:#d5e0ee}`;
  }

  constructor() {
    super();
    const p = document.createElement('div'); p.className = 'panel';
    this.head.className = 'head';
    this.head.addEventListener('click', () => { this.collapsed = !this.collapsed; try { window.localStorage.setItem(COLLAPSE_KEY, this.collapsed ? '1' : '0'); } catch { /* private mode */ } this.lastKey = ''; this.refresh(); });
    this.sub.className = 'sub'; this.list.className = 'list'; this.act.className = 'act';
    p.append(this.head, this.sub, this.list, this.act);
    this.root.appendChild(p);
  }

  bind(bus: GameBus, api: ScenarioCardApi): void {
    this.api = api;
    try { this.collapsed = window.localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { this.collapsed = false; }
    for (const ev of ['day:changed', 'time:hour', 'scenario:objective', 'scenario:finished'] as const) this.listen(bus, ev, () => this.refresh());
    this.refresh();
  }

  /** Hide the card (not a scenario game / continued in sandbox) or show it. */
  show(on: boolean): void { this.hidden = !on; if (on) { this.lastKey = ''; this.refresh(); } }

  refresh(): void {
    const v = this.api?.view();
    if (!v || v.sandbox) { this.hidden = true; return; }
    this.hidden = false;
    const key = JSON.stringify([this.collapsed, v.timeLabel, v.ready, v.medalNow, v.finished?.result, v.objectives.map((o) => [o.id, Math.round(o.progress * 100), o.met, o.failed, o.valueText])]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const met = v.objectives.filter((o) => o.met).length;
    const t = document.createElement('span'); t.className = 't'; t.textContent = v.name;
    const n = document.createElement('span'); n.className = 'n'; n.textContent = `${met}/${v.objectives.length}`;
    const c = document.createElement('span'); c.className = 'c'; c.textContent = this.collapsed ? '\u25B8' : '\u25BE';
    this.head.replaceChildren(t, n, c);
    this.head.title = this.collapsed ? 'Show objectives' : 'Hide objectives';
    this.head.setAttribute('aria-expanded', String(!this.collapsed));
    this.sub.textContent = v.finished ? (v.finished.result === 'won' ? `Won \u00B7 ${MEDAL_LABEL[v.finished.medal]} \u00B7 ${v.finished.score} pts` : `Lost \u00B7 ${v.finished.reason}`) : v.timeLabel;
    this.sub.dataset.deadline = String(v.daysLeft);
    this.sub.title = v.finished ? '' : `Real time left: ${deadlineRealTimeText(Math.max(0, v.daysLeft))}`;
    this.list.hidden = this.collapsed; this.act.hidden = this.collapsed;
    if (this.collapsed) return;
    this.list.replaceChildren(...sortObjectives(v.objectives).map((o) => {
      const row = document.createElement('div'); row.className = `o${o.mandatory ? '' : ' opt'}${o.met ? ' met' : ''}${o.failed ? ' failed' : ''}`;
      row.dataset.objective = o.id; row.title = `${o.mandatory ? 'Required' : 'Bonus (medals)'}: ${o.title}${o.description ? `\n${o.description}` : ''}\n${o.valueText} / ${o.targetText}`;
      const name = document.createElement('span'); name.className = 'name'; name.textContent = `${o.met ? '\u2714 ' : ''}${o.title}`;
      const val = document.createElement('span'); val.className = 'val'; val.textContent = o.met ? 'done' : `${o.valueText}/${o.targetText}`;
      const bar = document.createElement('div'); bar.className = 'bar'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', o.title);
      bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.round(o.progress * 100)));
      const fill = document.createElement('i'); fill.style.width = `${Math.round(o.progress * 100)}%`; bar.append(fill);
      row.append(name, val, bar);
      return row;
    }));
    this.act.replaceChildren();
    if (v.finished) {
      if (this.api?.results) { const b = document.createElement('button'); b.textContent = 'Results'; b.dataset.action = 'results'; b.addEventListener('click', () => this.api?.results?.()); this.act.append(b); }
    } else if (v.ready) {
      const b = document.createElement('button'); b.className = 'primary'; b.dataset.action = 'finish';
      b.textContent = `Finish now (${MEDAL_LABEL[v.medalNow]})`; b.title = 'Every required objective is met. Finish now to bank the medal and the speed bonus, or play on for more bonus objectives.';
      b.addEventListener('click', () => this.api?.finish());
      this.act.append(b);
    }
  }
}
