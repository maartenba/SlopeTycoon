import { makeSelect } from './StSelect';
import type { GameBus } from '@/core/events';
import { GAME_EVENT_NAMES } from '@/core/events';
import { DAYS_PER_YEAR } from '@/config/balance';
import { MilestoneTracker, NEWS_CATEGORIES, NEWS_FORMATTERS, TIER_RANK, formatEvent, formatLiftOpened, type FocusTarget, type NewsCtx, type NewsItem } from '../newsFormat';
import { FEED_FILTERS, NewsFeed, REVIEW_FILTERS, ReviewFeed, type FeedFilter, type FeedRow, type ReviewFilter } from '../newsFeed';
import { icon, starRow } from '../icons';
import { sentence } from '../text';
import { StElement } from './StElement';

export type NewsEntry = FeedRow;
export interface NewsApi {
  ctx?: NewsCtx;
  /** Format the in-game time for the stamp (e.g. 'Sat 12 Dec 14:30'). */
  stamp(): string;
  focus?(x: number, y: number): void;
  /** 'Go to' a location (camera move, selection, marker). Preferred over `focus` when present. */
  goTo?(f: FocusTarget): void;
  /** Called for each NEW feed row (not for coalesced repeats, counters or muted items); main routes critical/important ones to toasts. */
  onItem?(item: NewsItem): void;
  muted(): ReadonlySet<string>;
  setMuted(cat: string, on: boolean): void;
  /** Current in-game date (for per-day coalescing); defaults to counting day:changed events. */
  date?(): { year: number; day: number };
}

const FILTER_KEY = 'slopetycoon.newsFilter';
const REVIEW_FILTER_LABEL: Record<ReviewFilter, string> = { all: 'All', low: '2★ or less', high: '4★ or more' };
const FILTER_LABEL: Record<FeedFilter, string> = { all: 'All', important: 'Important', critical: 'Critical' };

/** Collapsible news feed (bottom-right, above the help button). Rows: important + critical by default; the rest is digested (see newsFeed.ts). */
export class StNews extends StElement {
  private feed: NewsFeed;
  private list = document.createElement('div');
  private today = document.createElement('div');
  private head = document.createElement('button');
  private body = document.createElement('div');
  private filterSel = makeSelect([], '', 'Which news to list');
  private reviews = new ReviewFeed();
  private revList = document.createElement('div');
  private revSel = makeSelect([], '', 'Which reviews to list');
  private tabNews = document.createElement('button');
  private tabRev = document.createElement('button');
  private tab: 'news' | 'reviews' = 'news';
  private revFilter: ReviewFilter = 'all';
  private revUnread = 0;
  private newsPane = document.createElement('div');
  private revPane = document.createElement('div');
  private open = false;
  private unread = 0;
  private filter: FeedFilter = 'important';
  private api: NewsApi | null = null;
  private miles = new MilestoneTracker();
  private absDay = 0;

  protected css(): string {
    return `:host{position:absolute;right:8px;bottom:84px;width:244px}.wrap{display:flex;flex-direction:column;gap:4px;align-items:stretch}
.wrap>button{white-space:nowrap}
@media (max-width:1099px){:host{width:auto;min-width:64px}:host(.open){width:244px}.wrap>button .w{display:none}}
.list{max-height:clamp(100px,calc(100vh - 480px),240px);overflow:auto;display:flex;flex-direction:column;gap:3px}
.e{display:flex;gap:6px;align-items:flex-start;padding:3px 6px;border-radius:4px;background:rgba(20,28,40,.85);border-left:3px solid #5a7090;cursor:default}
.e.loc{cursor:pointer}.e .go{margin-top:2px;font-size:11px;padding:0 6px}.e.crit{background:rgba(70,20,20,.9)}.e.good{border-color:#4caf50}.e.warn{border-color:#e0a030}.e.bad{border-color:#ff5555}
.e small{color:#9fb0c8;display:block}.n{background:#5a7090;border-radius:8px;padding:0 6px;font-size:11px}
.tabs{display:flex;gap:4px}.tabs button{flex:1;padding:2px 6px}.tabs button.on{background:#3a5070;border-color:#7aa0d0}.r{display:flex;flex-direction:column;gap:2px;padding:3px 6px;border-radius:4px;background:rgba(20,28,40,.85);border-left:3px solid #5a7090;cursor:default}.r.loc{cursor:pointer}.r.pos{border-color:#4caf50}.r.neg{border-color:#e0a030}.r .stars{color:#ffc94d;display:flex;gap:1px;align-items:center}.r p{margin:0;overflow-wrap:anywhere}.r small{color:#9fb0c8}.r .go{align-self:flex-start;font-size:11px;padding:0 6px}
.bar{display:flex;gap:6px;align-items:center}.bar select{flex:1}.today{font-size:11px;color:#9fb0c8}.mutes{display:flex;flex-wrap:wrap;gap:6px;font-size:11px}`;
  }

  constructor() {
    super();
    this.feed = new NewsFeed({ muted: () => this.api?.muted() ?? new Set(), stamp: () => this.api?.stamp() ?? '' });
    try { const f = localStorage.getItem(FILTER_KEY) as FeedFilter | null; if (f && FEED_FILTERS.includes(f)) this.filter = f; } catch { /* ignore */ }
    const wrap = document.createElement('div'); wrap.className = 'wrap';
    this.head.append(icon('news', 14), ' News');
    this.head.addEventListener('click', () => { this.open = !this.open; if (this.open) this.unread = 0; this.render(); });
    this.body.className = 'panel'; this.body.style.cssText = 'flex-direction:column;align-items:stretch';
    this.list.className = 'list';
    this.today.className = 'today';
    const bar = document.createElement('div'); bar.className = 'bar';
    this.filterSel.setOptions(FEED_FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f] })), this.filter); this.filterSel.title = 'Which news to list';
    this.filterSel.addEventListener('change', () => { this.filter = this.filterSel.value as FeedFilter; try { localStorage.setItem(FILTER_KEY, this.filter); } catch { /* ignore */ } this.render(); });
    const clear = document.createElement('button'); clear.textContent = 'Clear'; clear.title = 'Remove all news rows';
    clear.addEventListener('click', () => { this.feed.clear(); this.unread = 0; this.render(); });
    bar.append(this.filterSel, clear);
    const tabs = document.createElement('div'); tabs.className = 'tabs'; tabs.setAttribute('role', 'tablist');
    for (const [b, k] of [[this.tabNews, 'news'], [this.tabRev, 'reviews']] as const) {
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => { this.tab = k; if (k === 'reviews') this.revUnread = 0; this.render(); });
    }
    tabs.append(this.tabNews, this.tabRev);
    this.revSel.setOptions(REVIEW_FILTERS.map((f) => ({ value: f, label: REVIEW_FILTER_LABEL[f] })), this.revFilter); this.revSel.title = 'Which reviews to list';
    this.revSel.addEventListener('change', () => { this.revFilter = this.revSel.value as ReviewFilter; this.render(); });
    this.revList.className = 'list';
    this.newsPane.append(bar, this.today, this.list);
    this.revPane.append(this.revSel, this.revList);
    this.body.append(tabs, this.newsPane, this.revPane);
    wrap.append(this.head, this.body);
    this.root.appendChild(wrap);
    this.render();
  }

  get items(): readonly NewsEntry[] { return this.feed.rows; }
  get model(): NewsFeed { return this.feed; }
  get reviewRows(): readonly import('../newsFeed').ReviewRow[] { return this.reviews.rows; }

  /** Add a guest review to the Reviews tab (bounded; never a toast or a news row). */
  addReview(r: Parameters<ReviewFeed['add']>[0]): void {
    this.reviews.add({ ...r, text: sentence(r.text) }, this.api?.stamp() ?? '');
    if (!(this.open && this.tab === 'reviews')) this.revUnread++;
    this.render();
  }

  bind(bus: GameBus, api: NewsApi): void {
    this.api = api;
    const d = api.date?.();
    if (d) this.absDay = d.year * DAYS_PER_YEAR + d.day;
    const mutes = document.createElement('div'); mutes.className = 'mutes';
    for (const c of NEWS_CATEGORIES) {
      const l = document.createElement('label'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !api.muted().has(c);
      cb.addEventListener('change', () => api.setMuted(c, !cb.checked));
      l.append(cb, ` ${c}`); mutes.append(l);
    }
    const det = document.createElement('details'); const sm = document.createElement('summary'); sm.textContent = 'Categories shown'; det.append(sm, mutes);
    this.body.append(det);
    for (const name of GAME_EVENT_NAMES) {
      if (NEWS_FORMATTERS[name] === 'ignored') continue;
      this.listen(bus as never, name as never, ((p: never) => this.push(formatEvent(name, p, api.ctx))) as never);
    }
    this.listen(bus, 'guest:review', (e) => this.addReview(e));
    this.listen(bus, 'lift:opened', (e) => this.push(formatLiftOpened(e, api.ctx)));
    this.listen(bus, 'guest:arrived', () => this.push(this.miles.arrived()));
    this.listen(bus, 'day:changed', (e) => { this.absDay = e.year * DAYS_PER_YEAR + e.day; this.feed.newDay(this.absDay, e.day); this.render(); });
  }

  /** Add an item (also usable directly, e.g. for ad-hoc messages). */
  push(item: NewsItem | null): void {
    if (!item) return;
    item.text = sentence(item.text);
    const r = this.feed.push(item, this.absDay);
    if (r === 'row') {
      if (TIER_RANK[item.tier] >= TIER_RANK.important) this.api?.onItem?.(item);
      if (!this.open) this.unread++;
    }
    if (r === 'row' || r === 'coalesced' || r === 'counted') this.render();
  }

  private render(): void {
    const w = document.createElement('span'); w.className = 'w'; w.textContent = ' News';
    this.head.replaceChildren(icon('news', 14), w, ` ${this.unread ? `(${this.unread}) ` : ''}${this.open ? '▾' : '▸'}`);
    if (this.isConnected) this.classList.toggle('open', this.open);
    this.head.setAttribute('aria-expanded', String(this.open));
    this.body.hidden = !this.open;
    this.tabNews.replaceChildren('News'); this.tabRev.replaceChildren(`Reviews${this.revUnread ? ` (${this.revUnread})` : ''}`);
    for (const [b, k] of [[this.tabNews, 'news'], [this.tabRev, 'reviews']] as const) { b.classList.toggle('on', this.tab === k); b.setAttribute('aria-selected', String(this.tab === k)); }
    this.newsPane.hidden = this.tab !== 'news'; this.revPane.hidden = this.tab !== 'reviews';
    if (!this.open) return;
    if (this.tab === 'reviews') { this.renderReviews(); return; }
    const t = this.feed.today;
    this.today.textContent = `Today: ${t.arrived} arrived · ${t.left} left · Rescues today: ${t.rescues}`;
    const rows: HTMLElement[] = this.feed.visible(this.filter).map((e) => {
      const el = document.createElement('div');
      el.className = `e ${e.severity}${e.focus || e.loc ? ' loc' : ''}${e.tier === 'critical' ? ' crit' : ''}`;
      const ic = document.createElement('span'); ic.textContent = e.icon;
      const tx = document.createElement('div');
      tx.append(e.text);
      if (e.count > 1 && !e.many) { const n = document.createElement('span'); n.className = 'n'; n.textContent = `×${e.count}`; tx.append(' ', n); }
      const sm = document.createElement('small'); sm.textContent = e.stamp; tx.append(sm);
      el.append(ic, tx);
      const f: FocusTarget | undefined = e.focus ?? (e.loc ? { x: e.loc.x, y: e.loc.y } : undefined);
      if (f) {
        const go = (): void => { if (this.api?.goTo) this.api.goTo(f); else this.api?.focus?.(f.x, f.y); };
        el.title = 'Click to look at it'; el.addEventListener('click', go);
        const b = document.createElement('button'); b.className = 'go'; b.textContent = '⌖ Go to'; b.title = 'Move the camera there';
        b.addEventListener('click', (ev) => { ev.stopPropagation(); go(); });
        tx.append(b);
      }
      return el;
    });
    if (!rows.length) { const p = document.createElement('div'); p.textContent = this.filter === 'all' ? 'No news yet.' : 'Nothing important. Switch the filter to All for details.'; rows.push(p); }
    this.list.replaceChildren(...rows);
  }

  private renderReviews(): void {
    const rows: HTMLElement[] = this.reviews.visible(this.revFilter).map((r) => {
      const el = document.createElement('div');
      el.className = `r ${r.stars >= 4 ? 'pos' : r.stars <= 2 ? 'neg' : ''}${r.loc ? ' loc' : ''}`;
      const stars = document.createElement('div'); stars.className = 'stars'; stars.append(starRow(r.stars, 13));
      const p = document.createElement('p'); p.textContent = r.text;
      const sm = document.createElement('small'); sm.textContent = r.stamp;
      el.append(stars, p, sm);
      const loc = r.loc;
      if (loc) {
        const go = (): void => { if (this.api?.goTo) this.api.goTo({ x: loc.x, y: loc.y }); else this.api?.focus?.(loc.x, loc.y); };
        el.title = 'Click to look at the spot'; el.addEventListener('click', go);
        const b = document.createElement('button'); b.className = 'go'; b.textContent = '⌖ Go to'; b.title = 'Move the camera there';
        b.addEventListener('click', (ev) => { ev.stopPropagation(); go(); });
        el.append(b);
      }
      return el;
    });
    if (!rows.length) { const p = document.createElement('div'); p.textContent = this.reviews.rows.length ? 'No reviews match this filter.' : 'No reviews yet. Guests leave a few as they head home.'; rows.push(p); }
    this.revList.replaceChildren(...rows);
  }
}
