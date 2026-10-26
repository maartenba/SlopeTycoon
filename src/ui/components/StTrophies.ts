import { TIER_NAME, TIER_POINTS, type AchTier, type AchievementDef } from '../../config/achievements';
import { icon } from '../icons';
import { Modal } from '../modal';
import { MEDAL_LABEL, MEDAL_TIER } from '../scenarioFormat';
import type { TrophiesApi } from '../trophyData';
import { medalSvg } from '../yearReportFormat';
import { StElement } from './StElement';

type StateFilter = 'all' | 'unlocked' | 'locked';
type TierFilter = 'all' | AchTier;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const fmtDate = (ms: number): string => { try { return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } };

/** The decorative shelf at the top of the dialog: a wooden plank with three little trophies (pure inline SVG, no assets). */
const SHELF_SVG = `<svg viewBox="0 0 360 74" width="360" height="74" aria-hidden="true" focusable="false">
<defs><linearGradient id="pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a77a47"/><stop offset="1" stop-color="#6e4a28"/></linearGradient></defs>
<rect x="6" y="58" width="348" height="12" rx="2" fill="url(#pl)"/><rect x="6" y="58" width="348" height="2.500" fill="#c9a06a" opacity=".6"/><path d="M26 70v4M334 70v4" stroke="#4a3219" stroke-width="3"/>
<g transform="translate(44 14)"><path d="M12 0h24v22a12 12 0 0 1-24 0z" fill="#e2b13c" stroke="#9b7414" stroke-width="1.500"/><path d="M12 5H3c0 8 3 13 10 14M36 5h9c0 8-3 13-10 14" fill="none" stroke="#c8981e" stroke-width="2.500"/><rect x="21" y="32" width="6" height="8" fill="#c8981e"/><rect x="14" y="40" width="20" height="4" rx="1" fill="#8b5e24"/></g>
<g transform="translate(150 8)"><path d="M24 0l6.500 14 15 2-11 10.500 2.800 15L24 33.500 10.700 41.500 13.500 26.500 2.500 16l15-2z" fill="#c9d3de" stroke="#7d8a99" stroke-width="1.500" stroke-linejoin="round"/><rect x="16" y="42" width="16" height="4" rx="1" fill="#8b5e24"/></g>
<g transform="translate(252 18)"><path d="M6 14 14 0h20l8 14-18 24z" fill="#8fcff0" stroke="#4b93bd" stroke-width="1.500" stroke-linejoin="round"/><path d="M6 14h36M14 0l10 38M34 0 24 38" fill="none" stroke="#e7f6ff" stroke-width="1" opacity=".8"/><rect x="14" y="38" width="20" height="4" rx="1" fill="#8b5e24"/></g></svg>`;

/**
 * Trophy shelf (M5.3 Task 16): a shared-dialog modal (`lg`) with a summary header (n/40 and points), the scenario medals row, filters (All / Unlocked /
 * Locked and tier) and a grid of achievement cards: icon, title, description, tier medal, unlocked date, progress bar for counters; hidden ones show
 * '???' until unlocked. Local only: nothing to import, export or share (D8). Closed = nothing rendered, no pointer events.
 */
export class StTrophies extends StElement {
  private api: TrophiesApi | null = null;
  private readonly dlg: Modal;
  private off: (() => void) | null = null;
  private stateF: StateFilter = 'all';
  private tierF: TierFilter = 'all';

  protected css(): string {
    return `:host{display:block;width:0;height:0}
.head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:6px 4px 10px;border-bottom:1px solid #2f4057;margin-bottom:10px}
.head svg{flex:none;max-width:100%;height:auto}.sum{display:flex;flex-direction:column;gap:2px;min-width:0}
.sum .big{font:400 calc(var(--fs-lg) * 1.35)/1.1 var(--font-display);color:var(--c-accent-text);letter-spacing:.3px}.sum .sub{color:#9fb4cc;font-size:var(--fs-sm)}
.bar{height:6px;border-radius:3px;background:#122030;overflow:hidden;margin-top:4px;width:min(260px,60vw)}.bar i{display:block;height:100%;background:#e0b84a}
.meds{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}.med{display:flex;align-items:center;gap:6px;padding:3px 10px 3px 4px;border-radius:12px;background:#1c2838;border:1px solid #2f4057;font-size:12px;color:#cfe0f5}.med.none{opacity:.5}.med svg{display:block}
.filters{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px}.filters .sp{flex:1}
.seg{display:inline-flex;gap:2px;padding:2px;background:#122030;border-radius:8px}.seg button{padding:3px 10px;border-radius:6px;font-size:12.5px;background:transparent;border:0;color:#b9c6d8;cursor:pointer}.seg button.on{background:#2f4057;color:#fff}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.card{display:flex;gap:10px;min-width:0;padding:9px 10px;background:#1c2838;border:1px solid #2f4057;border-radius:var(--r-md);position:relative}
.card.lock{opacity:.72}.card.t3.got{border-color:#a88a3c;box-shadow:inset 0 0 0 1px rgba(224,184,74,.25)}
.ico{flex:0 0 38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#122030;border:2px solid #4a5c74;color:#7f93ab}
.card.got .ico{color:#1b2636}.card.got.t1 .ico{background:#c98c5a;border-color:#8f5a2e}.card.got.t2 .ico{background:#c9d3de;border-color:#7d8a99}.card.got.t3 .ico{background:#e2b13c;border-color:#9b7414}
.body{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}.ttl{display:flex;gap:6px;align-items:baseline}.ttl b{font:400 var(--fs-md)/1.2 var(--font-display);color:#eaf2fc;letter-spacing:.2px}
.card.lock .ttl b{color:#b9c6d8}.desc{font-size:12px;color:#c9dcf3;line-height:1.3}.meta{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px;align-items:center}
.chip{font-size:10.5px;padding:0 6px;border-radius:8px;background:rgba(255,255,255,.07);color:#b9c6d8;white-space:nowrap}.chip.sb{background:rgba(120,160,220,.18);color:#bcd3f2}
.date{font-size:11px;color:#9fb4cc}.pbar{height:5px;border-radius:3px;background:#122030;overflow:hidden;margin-top:3px}.pbar i{display:block;height:100%;background:#5a8fd0}.ptxt{font-size:10.5px;color:#9fb4cc}
.tm{position:absolute;right:6px;top:4px}.tm svg{display:block}
.empty{grid-column:1/-1;text-align:center;color:#9fb4cc;padding:24px 0}
@media (max-width:980px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (max-width:640px){.grid{grid-template-columns:1fr}}`;
  }

  constructor() {
    super();
    this.dlg = new Modal(this.root, {
      title: 'Trophies', icon: '🏆', size: 'lg', label: 'Trophies', pausesGame: true,
      onOpen: () => this.setAttribute('open', ''),
      onClose: () => { this.removeAttribute('open'); this.off?.(); this.off = null; },
    });
  }

  bind(api: TrophiesApi): void { this.api = api; }
  get isOpen(): boolean { return this.dlg.isOpen; }
  open(): void {
    if (!this.api) return;
    this.render();
    this.off?.(); this.off = this.api.onChange?.(() => { if (this.dlg.isOpen) this.render(); }) ?? null;
    this.dlg.open();
  }
  close(): void { this.dlg.close(); }
  /** Set the filters programmatically (tests / screenshots). */
  setFilter(state: StateFilter, tier: TierFilter = 'all'): void { this.stateF = state; this.tierF = tier; if (this.dlg.isOpen) this.render(); }

  private card(d: AchievementDef): HTMLElement {
    const api = this.api!, st = api.state(d.id), got = st.unlocked, hide = !!d.hidden && !got;
    const c = el('div', `card t${d.tier} ${got ? 'got' : 'lock'}`); c.dataset.ach = d.id; c.dataset.state = got ? 'unlocked' : 'locked'; c.dataset.tier = String(d.tier);
    const ico = el('div', 'ico'); ico.append(icon(hide ? 'lock' : d.icon, 20));
    const body = el('div', 'body');
    const ttl = el('div', 'ttl'); ttl.append(el('b', '', hide ? '???' : d.title));
    body.append(ttl, el('div', 'desc', hide ? 'A hidden achievement. Keep playing and it may show up.' : d.description));
    const meta = el('div', 'meta');
    if (!hide) {
      meta.append(el('span', 'chip', `${TIER_NAME[d.tier]} \u00B7 ${TIER_POINTS[d.tier]} pt${TIER_POINTS[d.tier] === 1 ? '' : 's'}`));
      if (d.scope === 'career') meta.append(Object.assign(el('span', 'chip', 'Career only'), { title: 'Not earnable in sandbox / free-play games' }));
      if (d.scope === 'scenario') meta.append(Object.assign(el('span', 'chip', 'Scenarios'), { title: 'Earned in scenario runs' }));
      if (d.reward) meta.append(Object.assign(el('span', 'chip', 'Cosmetic reward'), { title: 'Unlocks a cosmetic in Settings' }));
    }
    if (got) {
      if (st.record) meta.append(el('span', 'date', `Unlocked ${fmtDate(st.record.at)}`));
      if (st.record?.sandbox) meta.append(Object.assign(el('span', 'chip sb', 'Sandbox'), { title: 'Earned in a sandbox game' }));
    }
    body.append(meta);
    if (!got && !hide && st.progress) {
      const pb = el('div', 'pbar'), i = document.createElement('i'); i.style.width = `${Math.round((100 * st.progress.value) / st.progress.target)}%`; pb.append(i); pb.setAttribute('role', 'progressbar');
      pb.setAttribute('aria-valuenow', String(Math.round(st.progress.value))); pb.setAttribute('aria-valuemax', String(st.progress.target));
      body.append(pb, el('div', 'ptxt', `${Math.floor(st.progress.value).toLocaleString('en-US')} / ${st.progress.target.toLocaleString('en-US')}`));
    }
    const tm = el('div', 'tm'); tm.innerHTML = medalSvg(d.tier, 20); tm.title = `${TIER_NAME[d.tier]} achievement`; if (!got) tm.style.opacity = '.4';
    c.append(ico, body, tm);
    return c;
  }

  private render(): void {
    const api = this.api!, sum = api.summary();
    const head = el('div', 'head'), shelf = el('div'); shelf.innerHTML = SHELF_SVG;
    const s = el('div', 'sum');
    const bar = el('div', 'bar'), fill = document.createElement('i'); fill.style.width = `${Math.round((100 * sum.unlocked) / Math.max(1, sum.total))}%`; bar.append(fill);
    s.append(Object.assign(el('div', 'big', `${sum.unlocked} / ${sum.total}`), { title: 'Achievements unlocked' }), el('div', 'sub', `${sum.points} of ${sum.maxPoints} points \u00B7 your profile, kept across games`), bar);
    head.append(shelf, s);
    const meds = el('div', 'meds'); meds.dataset.row = 'medals';
    for (const sc of api.scenarios()) {
      const m = el('div', `med ${sc.record.bestMedal}`); m.dataset.scenario = sc.id; m.dataset.medal = sc.record.bestMedal;
      m.innerHTML = medalSvg(MEDAL_TIER[sc.record.bestMedal], 22); m.append(document.createTextNode(sc.name));
      m.title = sc.record.bestMedal === 'none' ? `${sc.name}: no medal yet` : `${sc.name}: ${MEDAL_LABEL[sc.record.bestMedal]}`;
      meds.append(m);
    }
    const filters = el('div', 'filters');
    const seg = <T extends string>(label: string, opts: Array<[T, string]>, cur: T, set: (v: T) => void): HTMLElement => {
      const g = el('div', 'seg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label); g.dataset.filter = label.toLowerCase();
      for (const [v, t] of opts) { const b = el('button', v === cur ? 'on' : '', t); b.type = 'button'; b.dataset.value = v; b.setAttribute('aria-pressed', String(v === cur)); b.addEventListener('click', () => { set(v); this.render(); }); g.append(b); }
      return g;
    };
    filters.append(
      seg<StateFilter>('Show', [['all', 'All'], ['unlocked', 'Unlocked'], ['locked', 'Locked']], this.stateF, (v) => { this.stateF = v; }),
      seg<string>('Tier', [['all', 'All tiers'], ['1', 'Common'], ['2', 'Notable'], ['3', 'Rare']], String(this.tierF), (v) => { this.tierF = v === 'all' ? 'all' : (Number(v) as AchTier); }),
    );
    const grid = el('div', 'grid');
    const items = api.list().filter((d) => {
      const got = api.state(d.id).unlocked;
      return (this.stateF === 'all' || (this.stateF === 'unlocked') === got) && (this.tierF === 'all' || d.tier === this.tierF);
    });
    if (!items.length) grid.append(el('div', 'empty', 'Nothing here yet.'));
    for (const d of items) grid.append(this.card(d));
    this.dlg.body.replaceChildren(head, meds, filters, grid);
    const close = el('button', 'ghost', 'Close'); close.dataset.action = 'close-trophies'; close.addEventListener('click', () => this.dlg.close());
    this.dlg.footer.replaceChildren(close);
  }
}
