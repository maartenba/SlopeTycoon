import type { GameBus } from '@/core/events';
import type { GoalsView } from '@/sim/goals/Goals';
import type { ProgressView } from '@/sim/progression/Progression';
import { unlockName } from '@/config/unlocks';
import { MODE_INFO } from '@/config/progression';
import { formatMoney } from '../format';
import { StElement } from './StElement';

export interface GoalsApi {
  view(): GoalsView;
  /** "Show me": look at the place where the goal can be worked on. */
  show(id: string): void;
  /** Resort level + progress to the next one (M5.3); absent = no level UI (older hosts / tests). */
  progress?(): ProgressView;
}

const COLLAPSE_KEY = 'slopetycoon.goalsCollapsed';
const VIEW_KEY = 'slopetycoon.goalsView';

/**
 * Resort goals card (M5.1) + resort level (M5.3: a level chip in the header switches the body between the goals and the level progress: bar, the
 * 2-3 missing criteria and what the next level unlocks; the footprint never changes): the chapter title and the three active goals with progress bars, a reward, and a "Show me" button.
 * Sits in the right column under the HUD (zone `right-goals`, src/ui/layout.ts). Collapsible (state remembered). Hidden while the tutorial
 * runs (`suppress(true)`). Pure view: it only reads `GoalsApi.view()` on `time:hour` / `milestone`.
 */
export class StGoals extends StElement {
  private bar = document.createElement('div');
  private head = document.createElement('button');
  private chip = document.createElement('button');
  private levelView = false;
  private body = document.createElement('div');
  private api: GoalsApi | null = null;
  private collapsed = false;
  private suppressed = false;
  private lastKey = '';

  protected css(): string {
    return `:host{display:block;box-sizing:border-box;width:100%;max-width:260px}
.panel{box-sizing:border-box;width:100%;flex-direction:column;align-items:stretch;gap:3px;padding:4px 8px 6px;font-size:calc(12px * var(--ui-scale, 1))}
button.head{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;background:transparent;border:0;padding:2px 0;font-weight:700;color:#fff;text-align:left;min-width:0}
button.head:hover:not(:disabled){background:transparent;border:0}
.head .t{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-display);font-weight:400;letter-spacing:.3px;color:var(--c-accent-text)}
.head .n{flex:0 0 auto;color:#9fb4cc;font-size:11px;font-weight:600}
.head .c{flex:0 0 auto;color:#9fb4cc;font-size:10px}
.goal{display:grid;grid-template-columns:1fr auto;column-gap:6px;row-gap:2px;align-items:center}
.goal .name{min-width:0;overflow-wrap:anywhere;white-space:normal;font-weight:600}
.goal .show{padding:0 6px;font-size:11px;line-height:16px;color:#c9dcf3}
.goal .bar{grid-column:1;height:6px;background:#34485f;border-radius:3px;overflow:hidden}
.goal .bar>i{display:block;height:100%;background:#4caf50;border-radius:3px}
.goal .rw{grid-column:2;color:#9fb4cc;font-size:11px;text-align:right;white-space:nowrap}
.done{color:#b9c6d8;font-size:11px}
.bar2{display:flex;align-items:center;gap:4px;min-width:0}.bar2 button.head{flex:1 1 auto;width:auto}
button.chip{flex:0 0 auto;padding:0 6px;font-size:10px;line-height:16px;border-radius:8px;border:1px solid #d9a441;background:rgba(20,28,40,.9);color:#ffd070;font-weight:700;max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button.chip.on{background:#d9a441;color:#1b2430}
button.chip.sb{border-color:#5a7090;color:#cfe0ff}
.lv{display:flex;flex-direction:column;gap:2px}
.lv .nm{font-weight:700;color:#ffd070;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lv .bar{height:6px;background:#34485f;border-radius:3px;overflow:hidden}.lv .bar>i{display:block;height:100%;background:#d9a441;border-radius:3px}
.lv .cr{display:flex;gap:6px;font-size:11px;color:#c9dcf3}.lv .cr>span:first-child{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}.lv .cr>span:last-child{color:#9fb4cc;white-space:nowrap}
.lv .cr.met>span:first-child{color:#7fd68a}
.lv .nx{font-size:11px;color:#9fb4cc;overflow-wrap:anywhere}`;
  }

  constructor() {
    super();
    const p = document.createElement('div');
    p.className = 'panel';
    this.head.className = 'head';
    this.head.addEventListener('click', () => { this.collapsed = !this.collapsed; try { window.localStorage.setItem(COLLAPSE_KEY, this.collapsed ? '1' : '0'); } catch { /* private mode */ } this.lastKey = ''; this.refresh(); });
    this.body.className = 'goals';
    this.bar.className = 'bar2';
    this.chip.className = 'chip'; this.chip.hidden = true;
    this.chip.addEventListener('click', () => { this.levelView = !this.levelView; try { window.localStorage.setItem(VIEW_KEY, this.levelView ? 'level' : 'goals'); } catch { /* private mode */ } this.lastKey = ''; this.refresh(); });
    this.bar.append(this.head, this.chip);
    p.append(this.bar, this.body);
    this.root.appendChild(p);
  }

  bind(bus: GameBus, api: GoalsApi): void {
    this.api = api;
    // phones / short landscape: start collapsed (header only) unless the player chose; the card would cover half the map
    const compact = typeof matchMedia === 'function' && matchMedia('(max-width: 760px), (max-height: 520px)').matches;
    try { const stored = window.localStorage.getItem(COLLAPSE_KEY); this.collapsed = stored === null ? compact : stored === '1'; this.levelView = window.localStorage.getItem(VIEW_KEY) === 'level'; } catch { this.collapsed = false; }
    this.listen(bus, 'time:hour', () => this.refresh());
    this.listen(bus, 'milestone', () => this.refresh());
    this.refresh();
  }

  /** Hide the card (tutorial running) or show it again. */
  suppress(on: boolean): void { this.suppressed = on; this.hidden = on; if (!on) this.refresh(); }

  refresh(): void {
    if (!this.api || this.suppressed) return;
    const v = this.api.view();
    const pv = this.api.progress?.() ?? null;
    const key = JSON.stringify([this.collapsed, this.levelView, v.chapter?.id, v.completed, v.active.map((a) => [a.id, Math.round(a.progress * 100)]), pv && [pv.mode, pv.level, Math.round(pv.progress * 100), pv.criteria.map((c) => [c.id, Math.round(c.progress * 100)])]]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const ch = v.chapter;
    const title = document.createElement('span'); title.className = 't'; title.textContent = ch ? ch.title : 'Career complete';
    const n = document.createElement('span'); n.className = 'n'; n.textContent = `${v.completed}/${v.total}`;
    const c = document.createElement('span'); c.className = 'c'; c.textContent = this.collapsed ? '\u25B8' : '\u25BE';
    this.head.replaceChildren(title, n, c);
    this.head.title = this.collapsed ? 'Show goals' : 'Hide goals';
    this.head.setAttribute('aria-expanded', String(!this.collapsed));
    this.body.hidden = this.collapsed;
    this.chip.hidden = !pv;
    if (pv) {
      const sb = pv.mode === 'sandbox';
      this.chip.textContent = sb ? 'Sandbox' : `L${pv.level}`;
      this.chip.className = `chip${sb ? ' sb' : ''}${this.levelView ? ' on' : ''}`;
      this.chip.title = sb ? MODE_INFO.sandbox.tip : `Level ${pv.level} \u00B7 ${pv.name}. Click for progress to the next level.`;
      this.chip.setAttribute('aria-pressed', String(this.levelView));
      this.chip.dataset.level = String(pv.level); this.chip.dataset.mode = pv.mode;
    }
    if (this.collapsed) { this.body.replaceChildren(); return; }
    if (pv && this.levelView) { this.body.replaceChildren(this.renderLevel(pv)); return; }
    if (v.finished) {
      const d = document.createElement('div'); d.className = 'done'; d.textContent = 'Every goal reached. The mountain is yours.';
      this.body.replaceChildren(d);
      return;
    }
    this.body.replaceChildren(...v.active.map((g) => {
      const row = document.createElement('div'); row.className = 'goal'; row.title = `${g.flavour}\n${g.todo}`;
      row.dataset.goal = g.id;
      const name = document.createElement('span'); name.className = 'name'; name.textContent = g.title;
      const show = document.createElement('button'); show.className = 'show ghost'; show.textContent = 'Show me'; show.title = 'Look at the place to work on this goal';
      show.addEventListener('click', () => this.api?.show(g.id));
      const bar = document.createElement('div'); bar.className = 'bar'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', g.title);
      bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.round(g.progress * 100)));
      const fill = document.createElement('i'); fill.style.width = `${Math.round(g.progress * 100)}%`; bar.append(fill);
      const rw = document.createElement('span'); rw.className = 'rw'; rw.textContent = `+${formatMoney(g.reward)}`;
      row.append(name, show, bar, rw);
      return row;
    }));
  }

  private renderLevel(pv: ProgressView): HTMLElement {
    const box = document.createElement('div'); box.className = 'lv'; box.dataset.levelPanel = '';
    const t = (cls: string, text: string): HTMLElement => { const e = document.createElement('div'); e.className = cls; e.textContent = text; return e; };
    if (pv.mode === 'sandbox') { box.append(t('nm', 'Sandbox'), t('nx', MODE_INFO.sandbox.blurb)); box.title = MODE_INFO.sandbox.tip; return box; }
    box.append(t('nm', `Level ${pv.level} \u00B7 ${pv.name}`));
    if (pv.max || !pv.next) { box.append(t('nx', 'Top level reached. Everything is unlocked.')); return box; }
    const bar = document.createElement('div'); bar.className = 'bar'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', `Progress to level ${pv.next.level}`);
    bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.round(pv.progress * 100)));
    const fill = document.createElement('i'); fill.style.width = `${Math.round(pv.progress * 100)}%`; bar.append(fill);
    box.append(t('nx', `Next: level ${pv.next.level} \u00B7 ${pv.next.name}`), bar);
    if (pv.criteria.every((x) => x.met)) box.append(t('cr met', 'All requirements met: level-up at the next dawn'));
    for (const c of pv.criteria.filter((x) => !x.met).slice(0, 3)) {
      const r = document.createElement('div'); r.className = 'cr'; r.title = c.label;
      const have = c.id === 'stars' ? String(c.have) : c.id === 'annualProfit' ? `$${Math.round(c.have).toLocaleString('en-US')}` : Math.round(c.have).toLocaleString('en-US');
      const need = c.id === 'annualProfit' ? `$${Math.round(c.need).toLocaleString('en-US')}` : c.id === 'stars' ? String(c.need) : Math.round(c.need).toLocaleString('en-US');
      const a = document.createElement('span'); a.textContent = c.label; const b = document.createElement('span'); b.textContent = `${have} / ${need}`;
      r.append(a, b); box.append(r);
    }
    if (pv.nextUnlocks.length) { const u = t('nx', `Unlocks: ${pv.nextUnlocks.map((x) => unlockName(x.kind, x.id)).join(', ')}`); u.title = u.textContent ?? ''; box.append(u); }
    return box;
  }
}
