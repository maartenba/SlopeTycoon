import { makeSelect } from './StSelect';
import { BUILDINGS } from '@/config/buildings';
import { LIFTS, type LiftKind } from '@/config/lifts';
import { OVERLAY_LABELS, OVERLAY_MODES, type OverlayMode } from '@/sim/Coverage';
import { SEASON_CENTERS } from '@/render/Season';
import { TERRAFORM_BRUSH_MAX, TERRAFORM_COST_PER_HALF_STEP } from '@/config/balance';
import type { SeasonId } from '@/core/events';
import type { TerraformMode, TerraformTarget } from '@/build/TerraformTool';
import { PISTE_COST_PER_TILE } from '@/world/Networks';
import { formatMoney } from '../format';
import {
  AUTO_FLATTEN_TIP, BUILDING_ICONS, BUILDING_TABS, LIFT_ICONS, NETWORK_ITEMS, buildingInfo, buildingsInTab, liftInfo, liftSeason, trailSeasonNote, networkInfo, networkSeason,
  type BuildingTab, type InfoModel, type NetworkItem,
} from '../buildInfo';
import { DRAWERS, FLATTEN_DRAWERS, digitSelectsItem, drawerReduce, type DrawerId, type DrawerState } from '../drawerState';
import { ChangeGate } from '../keyedDiff';
import { edgeState, popoverLeft, scrollIntoViewLeft, wheelToHorizontal } from '../drawerScroll';
import { icon } from '../icons';
import { TERRAIN_ICONS, VIEW_ICONS, overlayIcon } from '../dockIcons';
import { relevance, seasonBadge, seasonSort, type SeasonMode, type SeasonTag } from '../seasonOrder';
import type { LandscapeMode, LandscapeState } from '@/build/LandscapeTool';
import { DECOR, DECOR_IDS, LANDSCAPE, type DecorKind } from '@/config/landscape';
import { StElement } from './StElement';

export interface DockApi {
  funds(): number;
  /** Current season (orders the Buildings / Lifts / Pistes drawers by relevance); winter when absent. */
  season?(): SeasonId;
  buildings: { locked(id: string): string[]; cost(id: string): number; multiplier(): number; select(id: string): void };
  lifts: { select(kind: LiftKind): void; costPer100m(kind: LiftKind): number; /** Career lock reasons ('Unlocks at level 2: ...'); empty = available. */ locked?(kind: LiftKind): string[] };
  /** Toggle semantics: starting the already-active key stops it. */
  network: { start(key: NetworkItem['key']): void; setOverride(v: number | null): void; setBrush(n: number): void; setErase?(on: boolean): void; undo?(): boolean; redo?(): boolean; suggest?(want: number | null): void; pruneOrphans?(layer: 1 | 2 | 4): number };
  terraform: {
    setMode(m: TerraformMode): void; setTarget(t: TerraformTarget): void; setBrush(n: number): void; setMaxEdgeDelta(d: 1 | 2): void;
    state(): { mode: TerraformMode; brush: number; target: TerraformTarget; maxEdgeDelta?: 1 | 2 };
  };
  /** Tree planting / clearing brush (Landscape drawer, Nature tab). */
  nature?: {
    setMode(m: 'plant' | 'clear'): void; setGroup(g: string): void; setBrush(n: number): void; setDensity(d: number): void;
    state(): { mode: 'plant' | 'clear'; group: string; brush: number; density: number };
    groups: ReadonlyArray<{ id: string; label: string }>;
  };
  /** Landscape drawer (ponds, boulders, garden decor); terrain + trees reuse `terraform` / `nature`. */
  landscape?: {
    /** Make the landscape tool the active one. */
    activate(mode?: LandscapeMode): void;
    setMode(m: LandscapeMode): void; setDecor(k: DecorKind): void; setBrush(n: number): void; setRot(r: 0 | 1): void;
    state(): LandscapeState;
    /** Career lock reason for digging ponds, or null. */
    pondLocked(): string | null;
    /** Multiplier applied to every landscaping price (summer discount). */
    multiplier(): number;
  };
  setBulldoze(on: boolean): void;
  /** Shared placement / bulldoze undo (Ctrl+Z): `next()` names what Undo would revert (null = nothing). */
  undoAction?: { run(): void; next(): string | null; redo?(): void; nextRedo?(): string | null };
  /** Make the terraform tool the active one (Terrain drawer). */
  activateTerraform(): void;
  /** Return to the default (select) tool. */
  resetTool(): void;
  view: { overlay(): OverlayMode; setOverlay(m: OverlayMode): void; toggleGrid(): void; setSeason(t: number): void; /** Photo mode (P). */ photo?(): void; /** Walk mode (V). */ walk?(): void; /** Ride-along with an automatically picked guest. */ ride?(): void; /** Snap-rotate the iso camera (Q / E). */ rotate?(dir: 1 | -1): void; /** Zoom the iso camera by a factor (>1 = in). */ zoom?(factor: number): void; gridOn?(): boolean };
  autoFlatten: { get(): boolean; set(v: boolean): void };
  /** Lifts: 'Clear forest lane' (cut the trees a cable cannot clear with towers; default on). */
  clearLane?: { get(): boolean; set(v: boolean): void };
  /** Rotate the building being placed (+1 clockwise, -1 counter-clockwise; keys R / Shift+R). */
  rotate?(dir: 1 | -1): void;
  /** Data URL of a rendered thumbnail, or null (fallback tile). */
  thumb(kind: 'building' | 'lift', id: string, size: number): string | null;
  /** Finance drawer content (Task 24): elements built by main; `refresh` is called when money changes while the drawer is open. */
  finance?: { panels(): HTMLElement[]; refresh(): void };
  /** Operations drawer (lift schedule): same shape as finance. */
  operations?: { panels(): HTMLElement[]; refresh(): void };
  /** Marketing / Pricing drawers (Task 32): same shape as finance. */
  marketing?: { panels(): HTMLElement[]; refresh(): void; highlight?(id: string | null): void };
  pricing?: { panels(): HTMLElement[]; refresh(): void };
  /** Known flatten cost for the current ghost, if any. */
  flattenCost?(): number | null;
}

/** The Career level lock reason ('Unlocks at level 4: Alpine destination', config/unlocks.ts `lockedReason`). */
const LEVEL_LOCK = /^Unlocks at level (\d+)/;
interface Rail { rail: HTMLElement; grid: HTMLElement }
interface Card { id: string; el: HTMLButtonElement; price: HTMLElement; lock: HTMLElement; num: HTMLElement | null; badge: HTMLElement; tag: SeasonTag; /** Catalog index (the 'All' order). */ base: number; gate: ChangeGate<string | boolean> }
type TerraEls = { target: { value: string }; slope: { value: string }; brush: { value: string }; ghost: HTMLElement };
/** DOM built once per drawer/tab and re-attached afterwards (no re-creation, images keep decoded state, scroll survives). */
interface Built { drawer: DrawerId; sync?: () => void; nodes: HTMLElement[]; cards: Card[]; terraEls: TerraEls | null; rail: Rail | null; overlayBtns: Map<string, HTMLButtonElement>; thumbs: Array<{ img: HTMLElement; kind: 'building' | 'lift'; id: string; size: number; icon: string }> }

const css = `
:host{position:absolute;left:0;right:0;bottom:8px;display:block;pointer-events:none;--dl:352px;--dr:252px}
@media (max-width:1099px){:host{--dl:72px;--dr:80px}}
.wrap{display:flex;flex-direction:column;align-items:center;gap:6px}
.wrap>*{pointer-events:auto}
.drawer{position:relative;display:flex;flex-direction:column;gap:6px;box-sizing:border-box;align-items:stretch;contain:layout;width:calc(100% - var(--dl) - var(--dr));min-width:420px;max-width:1200px;max-height:190px;margin-left:calc(var(--dl) - var(--dr));padding:6px 8px;align-self:center}
.drawer[hidden]{display:none}
.head{display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-height:28px}
.head h3{margin:0;font-size:calc(13px * var(--ui-scale, 1));color:#ffd070;white-space:nowrap}
.head .grow{flex:1 1 0;min-width:0}
.flat{display:flex;gap:5px;align-items:center;padding:3px 8px;border-radius:4px;background:rgba(224,160,48,.22);border:1px solid #e0a030;font-weight:600;cursor:pointer;white-space:nowrap}
.tabs{display:flex;gap:4px;flex-wrap:nowrap;overflow-x:auto;flex:1 1 220px;min-width:0;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tabs{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 22px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 22px),transparent);padding-right:10px}
.tabs button{flex:none;white-space:nowrap}
.body{display:flex;gap:8px;min-height:0;overflow:hidden}
.rail{position:relative;flex:1;min-width:0;display:flex}
.grid{flex:1;min-width:0;display:flex;flex-wrap:nowrap;gap:6px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x proximity;scroll-padding:0 8px;padding:2px 2px 6px;height:128px;box-sizing:border-box;overscroll-behavior:contain}
.grid::-webkit-scrollbar{height:6px}
.grid::-webkit-scrollbar-thumb{background:#5a7090;border-radius:3px}
.fade{position:absolute;top:0;bottom:8px;width:34px;display:none;align-items:center;pointer-events:none;z-index:2}
.fade.l{left:0;justify-content:flex-start;background:linear-gradient(90deg,rgba(20,28,40,.95),rgba(20,28,40,0))}
.fade.r{right:0;justify-content:flex-end;background:linear-gradient(270deg,rgba(20,28,40,.95),rgba(20,28,40,0))}
.rail.can-l .fade.l,.rail.can-r .fade.r{display:flex}
.fade button{pointer-events:auto;width:24px;height:44px;min-width:0;padding:0;font-size:calc(12px * var(--ui-scale, 1))}
.card{position:relative;display:flex;flex:none;flex-direction:column;align-items:center;gap:2px;padding:4px;width:96px;height:116px;box-sizing:border-box;overflow:hidden;text-align:center;scroll-snap-align:start}
.card .nm{font-size:calc(11px * var(--ui-scale, 1));line-height:1.15;max-height:calc(26px * var(--ui-scale, 1));max-width:100%;overflow-wrap:anywhere;text-align:center;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.card .pr{font-size:calc(11px * var(--ui-scale, 1));opacity:.9;color:#ffe9a8;white-space:nowrap}
.card.active{background:#e0a030;border-color:#ffd070;color:#111;box-shadow:0 0 0 2px #ffd070}
.card.active .pr{color:#222}
.card.poor{opacity:.55}
.card .sb{position:absolute;bottom:2px;right:3px;display:inline-flex;align-items:center;gap:2px;padding:0 4px;height:14px;border-radius:7px;background:rgba(20,28,40,.85);border:1px solid #5a7090;color:#cfe0ff;font-size:calc(9px * var(--ui-scale, 1));line-height:12px;pointer-events:none}
.card .sb[hidden]{display:none}
.card .sb.bk{left:3px;right:auto;color:#9fe0a0;border-color:#4f8a58}
.chip{display:inline-flex;gap:4px;align-items:center;white-space:nowrap}
.chip .k{opacity:.75}
.card.locked{opacity:.4;filter:grayscale(.8)}
.sec button.locked{opacity:.6}
.card.locked.lvl{opacity:.62;filter:grayscale(.35)}
.card .lk.lv{display:inline-flex;align-items:center;gap:1px;padding:0 4px;height:14px;border-radius:7px;background:rgba(20,28,40,.9);border:1px solid #d9a441;color:#ffd070;font-size:calc(9px * var(--ui-scale, 1));font-weight:700;line-height:12px}
.card .lk{position:absolute;top:2px;right:4px;font-size:calc(12px * var(--ui-scale, 1))}
.card .num{position:absolute;top:2px;left:3px;min-width:14px;height:14px;line-height:14px;border-radius:3px;background:rgba(0,0,0,.6);color:#ffd070;font-size:calc(10px * var(--ui-scale, 1));font-weight:700;padding:0 2px;z-index:1}
.card.active .num{background:rgba(0,0,0,.75)}
.thumb{width:64px;height:64px;flex:none;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;border-radius:6px;background:rgba(255,255,255,.08);font-size:30px;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:contain;display:block}
.info{position:absolute;bottom:calc(100% + 6px);left:0;width:320px;max-height:220px;box-sizing:border-box;display:grid;grid-template-columns:72px 1fr;gap:4px 8px;align-content:start;font-size:calc(11px * var(--ui-scale, 1));overflow:auto;padding:8px;background:rgba(20,28,40,.96);border:1px solid #5a7090;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.5);z-index:5;pointer-events:auto}
.info[hidden]{display:none}
.info .big svg[focusable]{width:100%;height:100%}
.info .big{width:72px;height:72px;font-size:36px}
.info .txt{display:flex;flex-direction:column;gap:3px;min-width:0}
.info .rest{grid-column:1/-1;display:flex;flex-direction:column;gap:3px}
.info .stg{display:grid;grid-template-columns:1fr 1fr;gap:1px 12px}
.info h4{margin:0;font-size:calc(13px * var(--ui-scale, 1));color:#ffd070}
.info .desc{opacity:.9}
.info .lockn{color:#ffd070;font-weight:700}
.info .st{display:flex;justify-content:space-between;gap:6px}
.info .ok{color:#8fe08f}.info .no{color:#ff9a8a}
.info ul{margin:0;padding-left:8px;list-style:none}
.sec{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.pane{flex:1;display:flex;flex-direction:column;gap:6px;padding:2px;overflow:auto;max-height:134px}
.pane.cols{flex-direction:row;flex-wrap:wrap;align-content:flex-start}
.pc{flex:none;width:280px;display:grid;grid-template-columns:1fr 1fr;gap:4px;align-content:start;overflow:auto;max-height:150px}
.pc select,.pc button{min-width:0;width:100%;box-sizing:border-box}
.drawer.tall{max-height:min(46vh,380px)}
.drawer.tall .pane{max-height:calc(min(46vh,380px) - 48px)}
.pc .small{grid-column:1/-1}
.pc.one{width:190px;grid-template-columns:1fr}
.pc .trailnote.bad{color:#ff9a8a}
.gh{flex:none;align-self:stretch;display:flex;align-items:center;justify-content:center;width:16px;margin:0 -2px;writing-mode:vertical-rl;transform:rotate(180deg);font-size:calc(10px * var(--ui-scale, 1));font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#ffd070;opacity:.85;border-right:1px solid #5a7090}
.card .thumb svg[focusable]{width:100%;height:100%;padding:4px;box-sizing:border-box}
.pc select,.pc button{min-height:var(--touch-min,0px)}
.pc .trailnote{grid-column:1/-1;font-size:11px;line-height:1.3;color:#cfe3f3;opacity:.9}.pc .trailnote[hidden]{display:none}
.dock{display:flex;gap:3px;padding:5px 6px}
.dock button{display:flex;flex-direction:column;align-items:center;min-width:64px;padding:4px 4px;font-size:calc(11px * var(--ui-scale, 1));position:relative}
.dock button .ic{font-size:20px;line-height:1}
.dock button.live::after{content:"";position:absolute;top:3px;right:4px;width:7px;height:7px;border-radius:50%;background:#7fe07f}
.small{font-size:calc(11px * var(--ui-scale, 1));opacity:.85}
@media (max-width:1099px){.dock{gap:2px;padding:5px 4px}.dock button{min-width:0;padding:4px 3px;font-size:calc(11px * var(--ui-scale, 1))}}
/* Phones / short landscape (docs/touch.md): the dock row scrolls sideways, the drawer spans the screen */
@media (max-width:760px),(max-height:520px){
:host{--dl:8px;--dr:8px;left:env(safe-area-inset-left,0px);right:env(safe-area-inset-right,0px);bottom:calc(6px + env(safe-area-inset-bottom,0px))}
.drawer{min-width:0;width:calc(100% - 16px);margin-left:0;max-height:min(54vh,300px)}
.wrap{align-items:stretch;padding:0 8px;box-sizing:border-box}
.dock{max-width:100%;box-sizing:border-box;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-x;justify-content:flex-start}
.dock::-webkit-scrollbar{display:none}
:host(.peek) .drawer{display:none} /* touch: while a building ghost is being aimed the open drawer steps aside (main/touchWire toggles the class) */
.dock button{flex:0 0 auto;min-width:58px;min-height:var(--touch-min,0px)}
.pc.one{width:148px}
}
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

interface LandItem { group?: string; id: string; name: string; icon: string; price: string; key?: string; desc: string; stats: ReadonlyArray<readonly string[]>; rules: string[]; lock?: () => string | null; run(): void; on(): boolean }
/** Emoji text, or a trusted inline `<svg>` string from config (no emoji exists for a park bench / street lamp). */
function setIcon(node: HTMLElement, ic: string): void { if (ic.startsWith('<svg')) node.innerHTML = ic; else node.textContent = ic; }
type LandTab = 'water' | 'nature' | 'decor';
const LAND_TABS: ReadonlyArray<{ id: LandTab; label: string; icon: string }> = [{ id: 'water', label: 'Water', icon: '💧' }, { id: 'nature', label: 'Nature', icon: '🌲' }, { id: 'decor', label: 'Decor', icon: '🪴' }];

/** Bottom tool dock: category buttons; ONE drawer slides up above it. Absorbs the former toolbar/network/lift/build/overlay panels. */
export class StDock extends StElement {
  private api: DockApi | null = null;
  private state: DrawerState = { open: null };
  private tab: BuildingTab = 'services';
  private landTab: LandTab = 'water';
  private landSync: (() => void) | null = null;
  /** Season ordering of the item drawers: 'now' = in-season first, off-season dimmed last; 'all' = catalog order. */
  private seasonMode: SeasonMode = 'now';
  private chip: HTMLButtonElement | null = null;
  private wrap = el('div', 'wrap');
  private drawer = el('div', 'drawer panel');
  private head = el('div', 'head');
  private body = el('div', 'body');
  private dock = el('div', 'dock panel');
  private dockBtns = new Map<DrawerId, HTMLButtonElement>();
  private cards: Card[] = [];
  private built = new Map<string, Built>();
  private cur: Built | null = null;
  private infoEl = el('div', 'info');
  private infoThumb = el('div', 'thumb big');
  private infoTxt = el('div', 'txt');
  private infoRest = el('div', 'rest');
  private rail: Rail | null = null;
  private infoSig = '';
  private infoThumbKey = '';
  private flatBox = document.createElement('input');
  private flatLabel = el('label', 'flat');
  private laneBox = document.createElement('input');
  private laneLabel = el('label', 'flat');
  private hover: string | null = null;
  private active: { drawer: DrawerId; id: string } | null = null;
  private tool = 'select';
  private terraEls: TerraEls | null = null;
  private overlayBtns = new Map<string, HTMLButtonElement>();
  /** True while a drawer is open (the Esc pause menu only opens when nothing is open). */
  get drawerOpen(): boolean { return this.state.open !== null; }
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);

  protected css(): string { return css; }

  constructor() {
    super();
    this.drawer.hidden = true;
    this.flatBox.type = 'checkbox';
    this.flatBox.checked = true;
    this.flatLabel.append(this.flatBox, 'Auto-flatten (F)');
    this.flatLabel.title = AUTO_FLATTEN_TIP;
    this.flatBox.addEventListener('change', () => this.api?.autoFlatten.set(this.flatBox.checked));
    this.laneBox.type = 'checkbox';
    this.laneBox.checked = true;
    this.laneLabel.append(this.laneBox, 'Clear forest lane (L)');
    this.laneLabel.title = 'Cut the trees the cable cannot clear with towers (cost and count shown in the preview). Off: the line is refused when trees block it.';
    this.laneBox.addEventListener('change', () => this.api?.clearLane?.set(this.laneBox.checked));
    this.infoEl.hidden = true;
    this.infoEl.append(this.infoThumb, this.infoTxt, this.infoRest);
    this.drawer.append(this.head, this.body, this.infoEl);
    this.wrap.append(this.drawer, this.dock);
    this.root.appendChild(this.wrap);
  }

  bind(api: DockApi): void {
    this.api = api;
    for (const d of DRAWERS) {
      const b = el('button');
      b.append(el('span', 'ic', d.icon), el('span', '', d.label));
      b.title = d.label + (d.key ? ` (${d.key})` : '');
      b.dataset.drawer = d.id;
      b.addEventListener('click', () => this.dispatch({ type: 'toggle', id: d.id }));
      this.dockBtns.set(d.id, b);
      this.dock.appendChild(b);
    }
    window.addEventListener('keydown', this.keyHandler, true);
    this.track(() => window.removeEventListener('keydown', this.keyHandler, true));
    this.renderDrawer();
  }

  get openDrawer(): DrawerId | null { return this.state.open; }

  /** Open/close from outside. */
  show(id: DrawerId | null): void {
    if (this.state.open === id) return;
    this.dispatch(id === null ? { type: 'close' } : { type: 'toggle', id });
  }

  /** 'Show me' for advice / goals that live in a panel rather than on the map: open the drawer and point at the item. */
  showPanel(drawer: DrawerId, item?: string): void {
    if (drawer === 'buildings' && item) { this.showItem('building', item); return; }
    if (drawer === 'lifts' && item) { this.showItem('lift', item); return; }
    if (this.state.open !== drawer) this.show(drawer);
    if (drawer === 'marketing') { this.api?.marketing?.highlight?.(item ?? null); return; }
    if (item && (drawer === 'pistes' || drawer === 'paths')) {
      const c = this.cards.find((k) => k.id === item);
      if (c) { this.scrollCardIntoView(item); this.hover = item; this.popAnchor = c.el; this.renderInfo(); }
    }
  }

  /** 'Show me' on the level-up card: open the drawer (and tab) that holds the item and point at its card (hover popover). */
  showItem(kind: 'building' | 'lift' | 'campaign' | 'landscape', id: string): void {
    if (kind === 'campaign') { this.show('marketing'); return; }
    if (kind === 'landscape') { this.landTab = 'water'; this.show('landscape'); return; }
    if (kind === 'building') { const t = BUILDING_TABS.find((x) => buildingsInTab(x.id).some((d) => d.id === id)); if (t) this.tab = t.id; }
    const wasOpen = this.state.open === (kind === 'lift' ? 'lifts' : 'buildings');
    if (wasOpen) this.renderDrawer(); else this.show(kind === 'lift' ? 'lifts' : 'buildings');
    const c = this.cards.find((k) => k.id === id);
    if (c) { this.scrollCardIntoView(id); this.hover = id; this.popAnchor = c.el; this.renderInfo(); }
  }

  private dispatch(e: Parameters<typeof drawerReduce>[1]): void {
    const prev = this.state.open;
    this.state = drawerReduce(this.state, e);
    if (prev === this.state.open) return;
    this.hover = null;
    this.infoSig = '';
    if (prev === 'bulldoze' && this.tool === 'bulldoze') this.api?.resetTool();
    // Closing/switching a drawer drops its in-progress tool (placement, lift, network) back to the default select tool.
    if (prev !== null && this.state.open !== 'bulldoze' && this.tool !== 'select' && this.tool !== 'bulldoze') this.api?.resetTool();
    if (this.state.open === 'bulldoze' && this.tool !== 'bulldoze') this.api?.setBulldoze(true);
    if (this.state.open === 'terrain' && this.tool !== 'terraform') this.api?.activateTerraform();
    if (this.state.open === 'landscape') this.activateLandTab();
    this.renderDrawer();
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === 'Escape') { this.dispatch({ type: 'escape' }); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (digitSelectsItem(this.state.open) && /^[1-9]$/.test(e.key)) {
      const c = this.cards[Number(e.key) - 1];
      if (c) { e.stopImmediatePropagation(); e.preventDefault(); this.choose(c.id); }
    }
  }

  // ---- sync from the game ----
  private natSync: (() => void) | null = null;
  syncTool(id: string): void {
    this.tool = id;
    this.natSync?.();
    this.landSync?.();
    if (id === 'bulldoze' && this.state.open !== 'bulldoze') { this.state = { open: 'bulldoze' }; this.renderDrawer(); }
    else if (id !== 'bulldoze' && this.state.open === 'bulldoze') { this.state = { open: null }; this.renderDrawer(); }
    else if (id === 'select' && (this.state.open === 'terrain' || this.state.open === 'landscape')) { this.state = { open: null }; this.renderDrawer(); }
    this.updateLive();
  }
  setActive(drawer: DrawerId | null, id: string | null): void {
    this.active = drawer && id ? { drawer, id } : null;
    this.updateCards();
    this.updateLive();
    this.renderInfo();
  }
  /** Called by main when the plant tool state or active tool changes. */
  syncNature(): void { this.natSync?.(); this.landSync?.(); }
  /** Called by main when the landscape tool state changes. */
  syncLandscape(): void { this.landSync?.(); }
  syncTerraform(s: { mode: TerraformMode; brush: number; target: TerraformTarget; maxEdgeDelta?: 1 | 2 }): void {
    const t = this.terraEls;
    if (!t) return;
    t.target.value = s.target;
    if (s.maxEdgeDelta) t.slope.value = String(s.maxEdgeDelta);
    t.brush.value = String(s.brush);
    this.updateCards(); this.renderInfo();
  }
  /** Live ghost info of the terraform brush (cost, footprint); null when the cursor is off the map. */
  syncTerraGhost(g: { text: string; blocked: boolean; tiles: number } | null): void {
    const t = this.terraEls;
    if (!t) return;
    t.ghost.textContent = g ? `${g.text} · ${g.tiles === 0 ? '1 corner' : `${g.tiles} tile${g.tiles === 1 ? '' : 's'}`}` : 'Hover the map to preview the cost.';
    t.ghost.classList.toggle('bad', !!g?.blocked);
  }
  syncOverlay(): void { if (this.state.open === 'view') { this.updateCards(); this.renderInfo(); } }
  setAutoFlatten(v: boolean): void { if (this.flatBox.checked !== v) this.flatBox.checked = v; }
  setClearLane(v: boolean): void { if (this.laneBox.checked !== v) this.laneBox.checked = v; }
  /** 'never' hides the Auto-flatten toggle for the current building. */
  setFlattenPolicy(p: 'default' | 'optional' | 'never'): void { this.flatLabel.style.display = p === 'never' ? 'none' : ''; }

  private season(): SeasonId { return this.api?.season?.() ?? 'winter'; }
  private syncChip(): void {
    const c = this.chip;
    if (!c) return;
    const now = this.seasonMode === 'now', s = this.season();
    const ic = icon(s === 'winter' ? 'flake' : 'sun', 12);
    c.replaceChildren(ic, el('span', 'k', 'Season:'), el('span', '', now ? 'Now' : 'All'));
    c.classList.toggle('active', now);
    c.title = now ? `Showing ${s}-relevant items first; off-season items are dimmed at the end. Click for the full catalog order.` : 'Showing the full catalog order. Click to put in-season items first.';
    c.setAttribute('aria-pressed', String(now));
  }

  /** The season changed (rare): reorder every built drawer in place (keyed moves, no re-creation) and refresh badges / hints. */
  seasonChanged(): void {
    const s = this.season();
    if (s === this.lastSeason) return;
    this.lastSeason = s;
    this.applyOrderAll();
  }
  private lastSeason: SeasonId | null = null;

  private applyOrderAll(): void {
    for (const b of this.built.values()) this.orderCards(b);
    for (const n of Array.from(this.root.querySelectorAll<HTMLElement>('[data-trail-note]'))) { const t = trailSeasonNote(this.season()); n.textContent = t ?? ''; n.hidden = !t; }
    this.syncChip();
    this.infoSig = '';
    this.updateCards();
    this.renderInfo();
  }

  private tagOf(drawer: DrawerId, id: string): SeasonTag {
    if (drawer === 'buildings') return BUILDINGS[id]?.season ?? 'all';
    if (drawer === 'terrain' || drawer === 'view' || drawer === 'landscape') return 'all';
    if (drawer === 'lifts') return liftSeason(id as LiftKind);
    return networkSeason(id as NetworkItem['key']);
  }

  /** Sort the cards of a built drawer by season relevance (stable) and move the DOM nodes in place; refresh number badges, dimming and season badges. */
  private orderCards(b: Built): void {
    if (b.drawer !== 'buildings' && b.drawer !== 'lifts' && b.drawer !== 'pistes') return;
    const season = this.season();
    const sorted = seasonSort(b.cards.slice().sort((x, y) => x.base - y.base), (c) => c.tag, season, this.seasonMode);
    b.cards.splice(0, b.cards.length, ...sorted);
    const grid = b.rail?.grid;
    sorted.forEach((c, i) => {
      if (grid && grid.children[i] !== c.el) grid.insertBefore(c.el, grid.children[i] ?? null);
      if (c.num && b.drawer === 'buildings') { const t = i < 9 ? String(i + 1) : ''; if (c.num.textContent !== t) c.num.textContent = t; c.num.hidden = i >= 9; }
      const off = relevance(c.tag, season) === 'off', label = seasonBadge(c.tag, season);
      if (c.gate.set('off', off)) c.el.classList.toggle('offseason', off);
      if (c.gate.set('badge', label ?? '')) {
        c.badge.hidden = !label;
        c.badge.replaceChildren(...(label ? [icon(label === 'Winter' ? 'flake' : 'sun', 9), document.createTextNode(label)] : []));
        c.badge.title = label ? `Mostly used in ${label.toLowerCase()}; build it any time` : '';
      }
    });
  }

  /** Re-evaluate lock/price/affordability (call on money/buildings change). */
  refresh(): void { this.updateCards(); this.renderInfo(); if (this.state.open === 'finance') this.api?.finance?.refresh(); if (this.state.open === 'ops') this.api?.operations?.refresh(); if (this.state.open === 'marketing') this.api?.marketing?.refresh(); if (this.state.open === 'pricing') this.api?.pricing?.refresh(); }

  // ---- rendering ----
  private updateLive(): void {
    const live: Partial<Record<string, DrawerId>> = { placement: 'buildings', lift: 'lifts', bulldoze: 'bulldoze' };
    const own = this.tool === 'network' ? this.active?.drawer : live[this.tool];
    for (const [id, b] of this.dockBtns) {
      b.classList.toggle('active', this.state.open === id);
      b.classList.toggle('live', own === id);
    }
  }

  private drawerTitle(id: DrawerId): string { return DRAWERS.find((d) => d.id === id)?.label ?? id; }

  /** Fill any thumbnail placeholders whose image has since been rendered (idle pre-render). */
  refreshThumbs(): void {
    for (const b of this.built.values()) for (const t of b.thumbs) this.fillThumb(t.img, t.kind, t.id, t.icon, t.size);
    this.infoThumbKey = '';
    this.renderInfo();
  }

  private fillThumb(box: HTMLElement, kind: 'building' | 'lift', id: string, icon: string, size: number): void {
    const url = this.api?.thumb(kind, id, size) ?? null;
    let img = box.firstElementChild as HTMLImageElement | null;
    if (url) {
      if (!img || img.tagName !== 'IMG') { box.textContent = ''; img = document.createElement('img'); img.alt = ''; img.width = size; img.height = size; box.appendChild(img); }
      if (img.src !== url) img.src = url;
    } else if (!img && !box.textContent) box.textContent = icon;
  }

  private renderDrawer(): void {
    const open = this.state.open;
    this.updateLive();
    this.cards = [];
    this.terraEls = null;
    this.overlayBtns = new Map();
    this.cur = null;
    this.rail = null;
    this.infoEl.hidden = true;
    if (!open || !this.api) { this.drawer.hidden = true; return; }
    this.drawer.hidden = false;
    this.drawer.classList.toggle('tall', open === 'finance' || open === 'ops' || open === 'marketing' || open === 'pricing');
    this.head.replaceChildren(el('h3', '', this.drawerTitle(open)));
    this.body.replaceChildren();
    if (open === 'buildings') {
      const tabs = el('div', 'tabs');
      for (const t of BUILDING_TABS) {
        const b = el('button', t.id === this.tab ? 'active' : '', `${t.icon} ${t.label}`);
        b.dataset.tab = t.id;
        b.addEventListener('click', () => { this.tab = t.id; this.hover = null; this.renderDrawer(); });
        tabs.appendChild(b);
      }
      this.head.appendChild(tabs);
    }
    if (open === 'landscape') {
      const tabs = el('div', 'tabs');
      for (const t of LAND_TABS) {
        const b = el('button', t.id === this.landTab ? 'active' : '', `${t.icon} ${t.label}`);
        b.dataset.tab = t.id;
        b.addEventListener('click', () => { this.landTab = t.id; this.activateLandTab(); this.renderDrawer(); });
        tabs.appendChild(b);
      }
      this.head.appendChild(tabs);
    }
    if (open !== 'buildings' && open !== 'landscape') this.head.appendChild(el('span', 'grow'));
    this.chip = null;
    if (open === 'buildings' || open === 'lifts' || open === 'pistes') {
      const c = el('button', 'chip');
      c.dataset.seasonChip = '';
      c.addEventListener('click', () => { this.seasonMode = this.seasonMode === 'now' ? 'all' : 'now'; this.applyOrderAll(); });
      this.chip = c;
      this.head.appendChild(c);
      this.syncChip();
    }
    if (open === 'buildings' && this.api.rotate) {
      const rot = this.api.rotate.bind(this.api);
      for (const [label, dir, tip] of [['⟲', -1, 'Rotate counter-clockwise (Shift+R)'], ['⟳', 1, 'Rotate clockwise (R)']] as const) {
        const rb = el('button', '', label); rb.title = tip; rb.setAttribute('aria-label', tip);
        rb.addEventListener('click', () => { rot(dir); rb.blur(); });
        this.head.appendChild(rb);
      }
    }
    if (FLATTEN_DRAWERS.has(open)) {
      this.flatBox.checked = this.api.autoFlatten.get();
      this.head.appendChild(this.flatLabel);
      if (open === 'lifts' && this.api.clearLane) { this.laneBox.checked = this.api.clearLane.get(); this.head.appendChild(this.laneLabel); }
    }
    const x = el('button', '', '✕');
    x.title = 'Close (Esc)';
    x.addEventListener('click', () => this.dispatch({ type: 'close' }));
    this.head.appendChild(x);

    const key = open === 'buildings' ? `buildings:${this.tab}` : open === 'landscape' ? `landscape:${this.landTab}` : open;
    let b = this.built.get(key);
    if (!b) { b = this.buildDrawer(open); this.built.set(key, b); }
    this.cur = b;
    this.orderCards(b);
    this.cards = b.cards;
    this.terraEls = b.terraEls;
    this.overlayBtns = b.overlayBtns;
    this.rail = b.rail;
    this.landSync = open === 'landscape' ? b.sync ?? null : null;
    this.body.replaceChildren(...b.nodes);
    if (b.terraEls) this.syncTerraform(this.api.terraform.state());
    this.landSync?.();
    this.infoSig = '';
    this.updateCards();
    this.renderInfo();
    this.updateEdges();
  }

  private buildDrawer(open: DrawerId): Built {
    const b: Built = { drawer: open, nodes: [], cards: [], terraEls: null, rail: null, overlayBtns: new Map(), thumbs: [] };
    const save = [this.cards, this.terraEls, this.overlayBtns, this.cur, this.body];
    this.cards = b.cards; this.overlayBtns = b.overlayBtns; this.cur = b;
    const holder = el('div');
    this.body = holder; // collect nodes without touching the live body
    switch (open) {
      case 'buildings': this.buildGrid(buildingsInTab(this.tab).map((d) => d.id), 'buildings'); break;
      case 'lifts': this.buildGrid(Object.keys(LIFTS), 'lifts'); break;
      case 'paths': this.buildGrid(NETWORK_ITEMS.filter((i) => i.group === 'paths').map((i) => i.key), 'paths'); break;
      case 'pistes': this.buildGrid(NETWORK_ITEMS.filter((i) => i.group === 'pistes').map((i) => i.key), 'pistes'); this.pisteControls(); break;
      case 'terrain': this.buildGrid(this.tvItems('terrain').map((i) => i.id), 'terrain'); this.terrainControls(); break;
      case 'landscape': b.sync = this.landscapePane(this.landTab); break;
      case 'bulldoze': {
        const p = this.textPane('Click a building, lift, path, road or piste to demolish it (50% refund). Right-click or Esc to stop.');
        const u = this.api?.undoAction;
        if (u) {
          const b = this.btn('Undo', 'Undo the last placement or bulldoze, same day only (Ctrl+Z)', () => u.run());
          b.dataset.undo = ''; b.style.alignSelf = 'flex-start'; const n = u.next(); if (n) b.title = `Undo: ${n} (Ctrl+Z)`;
          p.append(b);
          if (u.redo) { const r = this.btn('Redo', 'Redo the last undone action (Ctrl+Shift+Z or Ctrl+Y)', () => u.redo!()); r.dataset.redo = ''; r.style.alignSelf = 'flex-start'; p.append(r); }
        }
        this.body.appendChild(p); break;
      }
      case 'view': this.buildGrid(this.tvItems('view').map((i) => i.id), 'view'); break;
      case 'ops': { const p = el('div', 'pane cols'); p.append(...(this.api?.operations?.panels() ?? [])); this.body.appendChild(p); break; }
      case 'marketing': { const p = el('div', 'pane cols'); p.append(...(this.api?.marketing?.panels() ?? [])); this.body.appendChild(p); break; }
      case 'pricing': { const p = el('div', 'pane cols'); p.append(...(this.api?.pricing?.panels() ?? [])); this.body.appendChild(p); break; }
      case 'finance': { const p = el('div', 'pane cols'); p.append(...(this.api?.finance?.panels() ?? [])); this.body.appendChild(p); break; }
    }
    b.terraEls = this.terraEls;
    b.nodes = Array.from(holder.children) as HTMLElement[];
    [this.cards, this.terraEls, this.overlayBtns, this.cur, this.body] = save as [Card[], TerraEls | null, Map<string, HTMLButtonElement>, Built | null, HTMLDivElement];
    return b;
  }

  private textPane(t: string): HTMLElement { const p = el('div', 'pane'); p.appendChild(el('div', '', t)); return p; }

  private thumbEl(kind: 'building' | 'lift' | null, id: string, icon: string, size: number): HTMLElement {
    const t = el('div', 'thumb');
    if (kind) { this.cur?.thumbs.push({ img: t, kind, id, size, icon }); this.fillThumb(t, kind, id, icon, size); }
    else setIcon(t, icon);
    return t;
  }

  private itemMeta(drawer: DrawerId, id: string): { name: string; icon: string; kind: 'building' | 'lift' | null } {
    if (drawer === 'buildings') return { name: BUILDINGS[id]?.name ?? id, icon: BUILDING_ICONS[id] ?? (BUILDINGS[id]?.name.charAt(0) ?? '?'), kind: 'building' };
    if (drawer === 'lifts') return { name: LIFTS[id as LiftKind].name, icon: LIFT_ICONS[id as LiftKind], kind: 'lift' };
    if (drawer === 'landscape' || drawer === 'terrain' || drawer === 'view') { const l = this.landItem(id); return { name: l?.name ?? id, icon: l?.icon ?? '?', kind: null }; }
    const n = NETWORK_ITEMS.find((i) => i.key === id);
    return { name: n?.name ?? id, icon: n?.icon ?? '?', kind: null };
  }

  private buildGrid(ids: string[], drawer: DrawerId): void {
    const grid = el('div', 'grid');
    grid.setAttribute('role', 'listbox');
    let lastGroup = '';
    ids.forEach((id, i) => {
      const m = this.itemMeta(drawer, id);
      const grp = drawer === 'terrain' || drawer === 'view' ? this.landItem(id)?.group : undefined;
      if (grp && grp !== lastGroup) { const gh = el('div', 'gh', grp); gh.setAttribute('aria-hidden', 'true'); grid.appendChild(gh); }
      if (grp) lastGroup = grp;
      const b = el('button', 'card');
      b.dataset.id = id;
      const lock = el('span', 'lk');
      const price = el('span', 'pr');
      const lkey = drawer === 'landscape' || drawer === 'terrain' || drawer === 'view' ? this.landItem(id)?.key : undefined;
      const num = drawer === 'buildings' ? el('span', 'num', i < 9 ? String(i + 1) : '') : lkey ? el('span', 'num', lkey) : null;
      if (num) { num.hidden = drawer === 'buildings' ? i >= 9 : false; b.appendChild(num); }
      const badge = el('span', 'sb'); badge.hidden = true;
      const bike = drawer === 'lifts' && LIFTS[id as LiftKind].carriesBikes ? el('span', 'sb bk') : null;
      if (bike) { bike.append(icon('bike', 11)); bike.title = 'Carries mountain bikes in summer'; }
      b.append(lock, this.thumbEl(m.kind, id, m.icon, 96), el('span', 'nm', m.name), price, badge);
      if (bike) b.appendChild(bike);
      b.addEventListener('click', () => this.choose(id));
      b.addEventListener('mouseenter', () => this.setHover(id, b));
      b.addEventListener('focus', () => { this.setHover(id, b); this.scrollCardIntoView(id); });
      b.addEventListener('mouseleave', () => this.setHover(null, b));
      b.addEventListener('blur', () => this.setHover(null, b));
      grid.appendChild(b);
      this.cards.push({ id, el: b, price, lock, num, badge, tag: this.tagOf(drawer, id), base: i, gate: new ChangeGate() });
    });
    const rail = el('div', 'rail');
    const arrow = (cls: 'l' | 'r', label: string, dir: 1 | -1): HTMLElement => {
      const f = el('div', `fade ${cls}`);
      const bt = el('button', '', label);
      bt.tabIndex = -1;
      bt.setAttribute('aria-label', dir < 0 ? 'Scroll left' : 'Scroll right');
      bt.addEventListener('click', () => grid.scrollBy({ left: dir * Math.max(96, grid.clientWidth * 0.8), behavior: 'smooth' }));
      f.appendChild(bt);
      return f;
    };
    rail.append(grid, arrow('l', '◀', -1), arrow('r', '▶', 1));
    grid.addEventListener('wheel', (e) => {
      const d = wheelToHorizontal(e, grid.clientWidth);
      if (d === null || grid.scrollWidth <= grid.clientWidth) return;
      e.preventDefault();
      grid.scrollLeft += d;
    }, { passive: false });
    grid.addEventListener('scroll', () => { this.updateEdges(); this.positionPopover(); }, { passive: true });
    grid.addEventListener('keydown', (e) => this.onGridKey(e, grid));
    this.body.appendChild(rail);
    if (this.cur) this.cur.rail = { rail, grid };
  }

  private onGridKey(e: KeyboardEvent, grid: HTMLElement): void {
    const k = e.key;
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return;
    const idx = this.cards.findIndex((c) => c.el === (this.root as ShadowRoot).activeElement);
    const n = this.cards.length;
    const to = k === 'Home' ? 0 : k === 'End' ? n - 1 : Math.max(0, Math.min(n - 1, (idx < 0 ? 0 : idx) + (k === 'ArrowRight' ? 1 : -1)));
    e.preventDefault(); e.stopPropagation();
    this.cards[to]?.el.focus({ preventScroll: true });
    this.scrollCardIntoView(this.cards[to]!.id);
    void grid;
  }

  /** Bring a card fully into view in the rail (keys 1–9, focus). */
  private scrollCardIntoView(id: string): void {
    const r = this.rail, c = this.cards.find((k) => k.id === id);
    if (!r || !c) return;
    const g = r.grid;
    const left = c.el.offsetLeft - g.offsetLeft;
    const t = scrollIntoViewLeft(g.scrollLeft, g.clientWidth, left, c.el.offsetWidth, 8, g.scrollWidth);
    if (t !== g.scrollLeft) g.scrollLeft = t;
  }

  private updateEdges(): void {
    const r = this.rail;
    if (!r) return;
    const e = edgeState(r.grid.scrollLeft, r.grid.clientWidth, r.grid.scrollWidth);
    r.rail.classList.toggle('can-l', e.left);
    r.rail.classList.toggle('can-r', e.right);
  }

  private popAnchor: HTMLElement | null = null;
  private setHover(id: string | null, card: HTMLElement): void {
    if (id === null && this.hover !== null && this.popAnchor !== card) return; // a different card already took over
    this.hover = id;
    this.popAnchor = id === null ? null : card;
    this.renderInfo();
  }

  private positionPopover(): void {
    const a = this.popAnchor;
    if (!a || this.infoEl.hidden) return;
    const d = this.drawer.getBoundingClientRect(), r = a.getBoundingClientRect();
    const w = this.infoEl.offsetWidth || 320;
    this.infoEl.style.left = `${Math.round(popoverLeft(r.left - d.left, r.width, w, d.width))}px`;
  }

  private choose(id: string): void {
    const api = this.api, open = this.state.open;
    if (!api || !open) return;
    this.scrollCardIntoView(id);
    if (open === 'buildings') {
      const c = this.cards.find((k) => k.id === id);
      if (c?.el.classList.contains('locked') || c?.el.classList.contains('poor')) { this.hover = id; this.popAnchor = c.el; this.renderInfo(); return; }
      this.hideInfo();
      api.buildings.select(id);
    } else if (open === 'lifts') {
      const c = this.cards.find((k) => k.id === id);
      if (c?.el.classList.contains('locked')) { this.hover = id; this.popAnchor = c.el; this.renderInfo(); return; }
      this.hideInfo(); api.lifts.select(id as LiftKind);
    }
    else if (open === 'paths' || open === 'pistes') { this.hideInfo(); api.network.start(id as NetworkItem['key']); }
    else if (open === 'landscape' || open === 'terrain' || open === 'view') {
      const it = this.landItem(id), c = this.cards.find((k) => k.id === id);
      if (c?.el.classList.contains('locked')) { this.hover = id; this.popAnchor = c.el; this.renderInfo(); return; }
      this.hideInfo(); it?.run();
    }
  }

  private priceOf(drawer: DrawerId, id: string): { text: string; cost: number; lock: string[] } {
    const api = this.api!;
    if (drawer === 'buildings') return { text: formatMoney(api.buildings.cost(id)), cost: api.buildings.cost(id), lock: api.buildings.locked(id) };
    if (drawer === 'lifts') { const c = api.lifts.costPer100m(id as LiftKind); return { text: `${formatMoney(c)}/100m`, cost: c, lock: api.lifts.locked?.(id as LiftKind) ?? [] }; }
    if (drawer === 'landscape' || drawer === 'terrain' || drawer === 'view') { const l = this.landItem(id), k = l?.lock?.(); return { text: l?.price ?? '', cost: 0, lock: k ? [k] : [] }; }
    const n = NETWORK_ITEMS.find((i) => i.key === id);
    const c = n?.costPerTile || PISTE_COST_PER_TILE;
    return { text: `${formatMoney(c)}/tile`, cost: c, lock: [] };
  }

  private updateCards(): void {
    const api = this.api, open = this.state.open;
    if (!api || !open) return;
    // dispatch() resets the tool (-> setActive -> here) BEFORE renderDrawer swaps the cards: never price the old drawer's cards as the new one.
    if (this.cur?.drawer !== open) return;
    for (const c of this.cards) {
      const p = this.priceOf(open, c.id);
      const poor = open === 'buildings' && p.cost > api.funds();
      const locked = p.lock.length > 0, isPoor = poor && !locked, act = open === 'landscape' || open === 'terrain' || open === 'view' ? !!this.landItem(c.id)?.on() : this.active?.drawer === open && this.active.id === c.id;
      const lvl = p.lock.map((r) => LEVEL_LOCK.exec(r)?.[1]).find((n) => n !== undefined);
      const title = lvl ? p.lock.join('\n') : locked ? `Locked: ${p.lock.join(', ')}` : poor ? 'Not enough funds' : '';
      if (c.gate.set('price', p.text)) c.price.textContent = p.text;
      if (c.gate.set('locked', locked)) { c.el.classList.toggle('locked', locked); }
      const lockTxt = lvl ? `🔒 L${lvl}` : locked ? '🔒' : '';
      if (c.gate.set('lockTxt', lockTxt)) { c.lock.textContent = lockTxt; c.lock.className = lvl ? 'lk lv' : 'lk'; }
      if (c.gate.set('lvl', lvl ?? '')) c.el.classList.toggle('lvl', !!lvl);
      if (c.gate.set('poor', isPoor)) c.el.classList.toggle('poor', isPoor);
      if (c.gate.set('active', act)) c.el.classList.toggle('active', act);
      if (c.gate.set('title', title)) c.el.title = title;
    }
  }

  private model(drawer: DrawerId, id: string): InfoModel | null {
    const api = this.api!;
    if (drawer === 'buildings') return buildingInfo(id, { locked: api.buildings.locked, cost: api.buildings.cost, multiplier: api.buildings.multiplier, season: this.season() });
    if (drawer === 'lifts') return liftInfo(id as LiftKind, api.lifts.costPer100m(id as LiftKind), this.season(), api.lifts.locked?.(id as LiftKind) ?? []);
    if (drawer === 'landscape' || drawer === 'terrain' || drawer === 'view') { const l = this.landItem(id), k = l?.lock?.(); return l ? { id, title: l.name, desc: l.desc, icon: l.icon, stats: [...l.stats.map((x): [string, string] => [x[0] ?? '', x[1] ?? '']), ...(l.key ? [['Hotkey', l.key] as [string, string]] : [])], reqs: [], rules: l.rules, note: k && LEVEL_LOCK.test(k) ? k : undefined } : null; }
    const n = NETWORK_ITEMS.find((i) => i.key === id);
    return n ? networkInfo(n, PISTE_COST_PER_TILE, this.season()) : null;
  }

  private renderInfo(): void {
    const open = this.state.open;
    if (!this.api || !open || !this.cards.length) return;
    const id = this.hover;
    if (!id) { this.hideInfo(); return; }
    const m = this.model(open, id);
    if (!m) { this.hideInfo(); return; }
    const meta = this.itemMeta(open, m.id);
    const fc = open === 'buildings' || open === 'lifts' ? this.api.flattenCost?.() ?? null : null;
    const showFc = fc !== null && this.active?.id === m.id;
    const sig = JSON.stringify([open, m, showFc ? fc : null]);
    if (sig === this.infoSig && !this.infoEl.hidden) { this.positionPopover(); return; } // nothing changed: no DOM work
    this.infoSig = sig;
    const tk = `${meta.kind}:${m.id}`;
    if (tk !== this.infoThumbKey) {
      this.infoThumbKey = tk;
      this.infoThumb.textContent = '';
      if (meta.kind) this.fillThumb(this.infoThumb, meta.kind, m.id, m.icon, 96);
      else setIcon(this.infoThumb, m.icon);
    }
    const head: HTMLElement[] = [el('h4', '', m.title)];
    if (m.note) head.push(el('div', 'lockn', `🔒 ${m.note}`));
    if (m.desc) head.push(el('div', 'desc', m.desc));
    const kids: HTMLElement[] = [];
    if (open === 'buildings') kids.push(el('div', 'desc', 'R: rotate · Shift+R: rotate back'));
    const stg = el('div', 'stg');
    for (const [k, v] of m.stats) { const r = el('div', 'st'); r.append(el('span', '', k), el('span', '', v)); stg.appendChild(r); }
    if (showFc) { const r = el('div', 'st'); r.append(el('span', '', 'Flatten'), el('span', '', formatMoney(fc!))); stg.appendChild(r); }
    kids.push(stg);
    if (m.reqs.length) {
      const u = el('ul');
      for (const r of m.reqs) u.appendChild(el('li', r.ok ? 'ok' : 'no', `${r.ok ? '✓' : '✗'} ${r.text}`));
      kids.push(el('b', '', 'Requires'), u);
    }
    if (m.rules.length) {
      const u = el('ul');
      for (const r of m.rules) u.appendChild(el('li', '', `• ${r}`));
      kids.push(el('b', '', 'Rules'), u);
    }
    this.infoTxt.replaceChildren(...head);
    this.infoRest.replaceChildren(...kids);
    this.infoEl.hidden = false;
    this.positionPopover();
  }

  private hideInfo(): void {
    this.hover = null;
    this.popAnchor = null;
    this.infoSig = '';
    this.infoEl.hidden = true;
  }

  private btn(label: string, title: string, fn: () => void): HTMLButtonElement {
    const b = el('button', '', label);
    b.title = title;
    b.addEventListener('click', fn);
    return b;
  }

  private erasing = false;
  private pisteControls(): void {
    this.erasing = false;
    const api = this.api!;
    const side = el('div', 'pc');
    const sel = makeSelect([['auto', 'Difficulty: auto'], ['0', 'Green'], ['1', 'Blue'], ['2', 'Red'], ['3', 'Black']].map(([value, label]) => ({ value: value!, label: label! })), 'auto', 'Override piste difficulty', (v) => api.network.setOverride(v === 'auto' ? null : Number(v)));
    sel.title = 'Override piste difficulty';
    const brush = makeSelect([1, 2, 3].map((n) => ({ value: String(n), label: `Brush size ${n}` })), '1', 'Brush size', (v) => api.network.setBrush(Number(v)));
    const erase = this.btn('Erase', 'Erase piste/trail tiles (or Shift-drag)', () => { this.erasing = !this.erasing; api.network.setErase?.(this.erasing); erase.classList.toggle('active', this.erasing); });
    const undo = this.btn('Undo', 'Undo the last action, same day only (Ctrl+Z); Esc cancels the stroke in progress', () => { api.network.undo?.(); });
    const redo = this.btn('Redo', 'Redo the last undone action (Ctrl+Shift+Z or Ctrl+Y)', () => { api.network.redo?.(); });
    const prune = this.btn('Clear isolated', 'Remove unattached piste fragments', () => { api.network.pruneOrphans?.(1); });
    const suggest = this.btn('Suggest a run', 'Highlight a run that follows the fall line, matches the chosen difficulty and keeps snow at today\'s snowline (nothing is built or charged)', () => { const v = (sel as unknown as { value?: string }).value; api.network.suggest?.(v === undefined || v === 'auto' ? null : Number(v)); });
    suggest.dataset.suggest = '';
    const note = el('div', 'trailnote');
    note.dataset.trailNote = '';
    const t = trailSeasonNote(this.api?.season?.());
    note.textContent = t ?? '';
    note.hidden = !t;
    side.append(sel, brush, suggest, erase, undo, redo, prune, note);
    side.title = 'Drag to paint (interpolated, no gaps). Shift-drag erases. Trails must start at a path/building.';
    this.body.appendChild(side);
  }

  /** Cards of the Terrain and View drawers: same shape as Buildings / Landscape (icon, name, price or note, key badge, hover card, active state, group label). */
  private tvItems(drawer: 'terrain' | 'view'): LandItem[] {
    const api = this.api!;
    if (drawer === 'terrain') {
      const t = api.terraform, st = t.state(), m = api.buildings.multiplier();
      const step = `$${Math.round(TERRAFORM_COST_PER_HALF_STEP * m)}`;
      const edit = (md: TerraformMode): void => { if (this.tool !== 'terraform') api.activateTerraform(); t.setMode(md); };
      const common: Array<[string, string]> = [['Brush', `${st.brush}/${TERRAFORM_BRUSH_MAX} (  [ ]  )`], ['Target', `${st.target} (C)`], ['Max slope', st.maxEdgeDelta === 2 ? 'steep' : 'gentle']];
      const mk = (id: TerraformMode, name: string, key: string, desc: string, rules: string[]): LandItem => ({
        group: 'Sculpt', id, name, icon: TERRAIN_ICONS[id]!, price: `${step}/step`, key, desc, stats: [['Cost', `${step}/half-step`], ...common], rules,
        run: () => edit(id), on: () => this.tool === 'terraform' && t.state().mode === id,
      });
      return [
        mk('raise', 'Raise', '1', 'Lift the ground under the brush by half a step per click.', ['Drag to raise a whole hill (one undo step)', 'Not under buildings, lift towers or water']),
        mk('lower', 'Lower', '2', 'Dig the ground down under the brush.', ['Drag to cut a gully or a bowl', 'Not under buildings, lift towers or water']),
        mk('flatten', 'Flatten', '3', 'Level everything under the brush to the height of the first tile you press on.', ['Press on the height you want, then drag', 'Handy for building plots']),
        mk('smooth', 'Smooth', '4', 'Blend rough ground into gentle slopes under the brush.', ['Good for taking the bumps out of a piste line', 'Respects the max slope setting']),
      ];
    }
    const v = api.view;
    const items: LandItem[] = [];
    const add = (group: string, id: string, name: string, icon: string, key: string | undefined, desc: string, stats: Array<[string, string]>, run: () => void, on: () => boolean = () => false, price = ''): void => {
      items.push({ group, id, name, icon, price, key, desc, stats, rules: [], run, on });
    };
    if (v.rotate) {
      const r = v.rotate;
      add('Camera', 'rotL', 'Rotate left', VIEW_ICONS.rotL!, 'Q', 'Turn the camera a quarter turn counter-clockwise.', [['Also', 'Alt + drag rotates freely']], () => r(-1), undefined, 'quarter turn');
      add('Camera', 'rotR', 'Rotate right', VIEW_ICONS.rotR!, 'E', 'Turn the camera a quarter turn clockwise.', [['Also', 'Alt + drag rotates freely']], () => r(1), undefined, 'quarter turn');
    }
    if (v.zoom) {
      const z = v.zoom;
      add('Camera', 'zoomIn', 'Zoom in', VIEW_ICONS.zoomIn!, undefined, 'Move closer to the slopes.', [['Also', 'Mouse wheel / pinch']], () => z(1.25), undefined, 'wheel');
      add('Camera', 'zoomOut', 'Zoom out', VIEW_ICONS.zoomOut!, undefined, 'Pull back to see the whole resort.', [['Also', 'Mouse wheel / pinch']], () => z(0.8), undefined, 'wheel');
    }
    add('Camera', 'grid', 'Tile grid', VIEW_ICONS.grid!, 'G', 'Show or hide the tile grid on the terrain, handy for placing things exactly.', [['Toggle', 'G']], () => { v.toggleGrid(); this.refresh(); }, () => v.gridOn?.() ?? false, 'toggle');
    if (v.ride) { const f = v.ride; add('Modes', 'ride', 'Ride-along', VIEW_ICONS.ride!, undefined, 'Ride along with a guest on the slopes or lifts, from their point of view. Esc leaves.', [['Needs', 'a guest on the mountain']], () => f(), undefined, 'cosmetic'); }
    if (v.walk) { const f = v.walk; add('Modes', 'walk', 'Walk mode', VIEW_ICONS.walk!, 'V', 'Explore your resort on foot in first person. Shift+V picks the start spot.', [['Move', 'W A S D · Shift run']], () => f(), undefined, 'first person'); }
    if (v.photo) { const f = v.photo; add('Modes', 'photo', 'Photo mode', VIEW_ICONS.photo!, 'P', 'Free camera, filters and frames; exports a PNG to your device only. Nothing is uploaded.', [['Export', 'local PNG']], () => f(), undefined, 'free camera'); }
    OVERLAY_MODES.forEach((m, i) => {
      const nm = m === 'off' ? 'No overlay' : OVERLAY_LABELS[m];
      add('Overlays', `ov:${m}`, nm, overlayIcon(m), i === 0 ? 'O' : undefined, m === 'off' ? 'Hide the map overlay. O cycles through all overlays.' : `Colour the map by ${OVERLAY_LABELS[m].toLowerCase()}. O cycles through all overlays.`, [['Cycle', 'O']], () => { v.setOverlay(m); this.syncOverlay(); }, () => v.overlay() === m, m === 'off' ? 'clear' : 'map');
    });
    for (const [n, k, t, ic] of [['Winter', 'winter', SEASON_CENTERS.winter, 'winter'], ['Spring', 'spring', SEASON_CENTERS.spring, 'spring'], ['Summer', 'summer', SEASON_CENTERS.summer, 'summer'], ['Autumn', 'autumn', SEASON_CENTERS.autumn, 'autumn']] as const) {
      add('Season', `se:${k}`, n, VIEW_ICONS[ic]!, undefined, `Jump the scenery to ${n.toLowerCase()} to preview it (a view change only for the look of the world).`, [['Effect', 'look of the world']], () => v.setSeason(t), undefined, 'preview');
    }
    return items;
  }

  /** Side controls of the Terrain drawer: same column of selects as Pistes & Trails (target, brush, slope) plus the live ghost line. */
  private terrainControls(): void {
    const api = this.api!.terraform;
    const side = el('div', 'pc one');
    const target = makeSelect([{ value: 'tile', label: 'Target: tile' }, { value: 'corner', label: 'Target: corner' }], 'tile', 'Edit a whole tile or a single corner (C toggles)', (v) => api.setTarget(v as TerraformTarget));
    target.title = 'Tile or single corner (C toggles)';
    const brush = makeSelect(Array.from({ length: TERRAFORM_BRUSH_MAX }, (_, i) => ({ value: String(i + 1), label: `Brush size ${i + 1}` })), String(api.state().brush), 'Brush size', (v) => api.setBrush(Number(v)));
    brush.title = 'Brush size ([ ] changes it)';
    const slope = makeSelect([{ value: '1', label: 'Slope: gentle' }, { value: '2', label: 'Slope: steep' }], '1', 'Max slope between adjacent corners', (v) => api.setMaxEdgeDelta(Number(v) as 1 | 2));
    slope.title = 'Max slope between adjacent corners';
    const ghost = el('div', 'trailnote', 'Hover the map to preview the cost.');
    ghost.dataset.terraGhost = '';
    const hint = el('div', '', 'Click or drag on the map to edit (active while this drawer is open). Keys 1–4 mode, [ ] brush, C target. Trees and boulders live in Landscape.');
    side.title = hint.textContent ?? '';
    side.append(target, brush, slope, ghost);
    this.body.appendChild(side);
    this.terraEls = { target, slope, brush, ghost };
    this.syncTerraform(api.state());
  }
  /** Start the tool that belongs to the open Landscape tab. */
  private activateLandTab(): void {
    const api = this.api;
    if (!api) return;
    switch (this.landTab) {
      case 'water': api.landscape?.activate(api.landscape.state().mode === 'fill' ? 'fill' : 'pond'); break;
      case 'nature': { const m = api.landscape?.state().mode; if (m === 'rock' || m === 'rockClear') api.landscape?.activate(m); else api.nature?.setMode(api.nature.state().mode); break; }
      case 'decor': { const m = api.landscape?.state().mode; api.landscape?.activate(m === 'decorClear' ? 'decorClear' : 'decor'); break; }
    }
  }

  /** Cards of one Landscape tab: same shape as a Buildings / Pistes card (icon, name, price, key badge, hover card, active state). */
  private landItems(tab: LandTab): LandItem[] {
    const api = this.api!, ls = api.landscape;
    if (!ls) return [];
    const m = ls.multiplier(), usd = (n: number): string => `$${Math.round(n * m)}`;
    const onLand = (mode: LandscapeMode): boolean => this.tool === 'landscape' && ls.state().mode === mode;
    const nat = api.nature;
    switch (tab) {
      case 'water': return [
        { id: 'pond', name: 'Dig pond', icon: '💧', price: `${usd(LANDSCAPE.pond.costPerTile)}/tile`, key: '1', desc: 'Dig a pond: drag a rectangle (3–11 tiles) or click for the default size.', stats: [['Cost', `${usd(LANDSCAPE.pond.costPerTile)}/tile + earthworks`], ['Size', '3–11 tiles']],
          rules: [`Nearly level ground, ${LANDSCAPE.pond.waterGap}+ tiles from other water, buildings, pistes and lifts`, 'Freezes over in winter; counts as a lake for beaches and boat rentals'], lock: () => ls.pondLocked(), run: () => ls.activate('pond'), on: () => onLand('pond') && !ls.pondLocked() },
        { id: 'fill', name: 'Fill in', icon: '🪣', price: `${usd(LANDSCAPE.pond.fillCostPerTile)}/tile`, key: '2', desc: 'Fill a pond you dug back in to ground level.', stats: [['Cost', `${usd(LANDSCAPE.pond.fillCostPerTile)}/tile`]], rules: ['Click a pond you dug', 'Natural lakes cannot be filled'], run: () => ls.activate('fill'), on: () => onLand('fill') },
      ];
      case 'nature': return [
        ...(nat ? (['plant', 'clear'] as const).map((md, i) => ({
          id: md, name: md === 'plant' ? 'Plant trees' : 'Clear trees', icon: md === 'plant' ? '🌲' : '🪓', price: 'by area', key: String(i + 1),
          desc: md === 'plant' ? 'Paint trees with the brush; pick the species group on the right.' : 'Cut trees under the brush (timber pays a little).', stats: [['Brush', '1–5']],
          rules: md === 'plant' ? ['Not on pistes, paths, buildings, water or steep rock', 'G cycles the species group'] : ['Trees only; boulders stay'],
          run: () => { nat.setMode(md); this.landSync?.(); }, on: () => this.tool === 'plant' && nat.state().mode === md,
        })) : []),
        { id: 'rock', name: 'Boulders', icon: '🪨', price: `${usd(LANDSCAPE.rock.cost)}/rock`, key: '3', desc: 'Scatter boulders with the brush.', stats: [['Cost', `${usd(LANDSCAPE.rock.cost)} each`], ['Brush', `1–${LANDSCAPE.rock.maxBrush}`]], rules: ['Dry ground only: never on water, steep cliffs, paths, pistes or buildings'], run: () => ls.activate('rock'), on: () => onLand('rock') },
        { id: 'rockClear', name: 'Remove boulders', icon: '⛏️', price: `${usd(LANDSCAPE.rock.removeCost)}/rock`, key: '4', desc: 'Remove boulders under the brush.', stats: [['Cost', `${usd(LANDSCAPE.rock.removeCost)} each`]], rules: ['Drag across the boulders'], run: () => ls.activate('rockClear'), on: () => onLand('rockClear') },
      ];
      default: return [
        ...DECOR_IDS.map((id): LandItem => {
          const d = DECOR[id];
          return { id, name: d.label, icon: d.icon, price: usd(d.cost), desc: d.blurb, stats: [['Cost', usd(d.cost)], ['Walk mode', d.solid ? 'blocks' : 'walkable']],
            rules: [...(d.oriented ? ['Drag to draw a row; R turns it'] : []), 'Dry ground without trees or rocks', 'No upkeep'], run: () => { ls.setDecor(id); this.landSync?.(); }, on: () => onLand('decor') && ls.state().decor === id };
        }),
        { id: 'decorClear', name: 'Remove decor', icon: '🧹', price: 'free', key: '6', desc: 'Remove decor under the cursor.', stats: [['Cost', 'free']], rules: ['Click the piece'], run: () => ls.activate('decorClear'), on: () => onLand('decorClear') },
      ];
    }
  }
  private landItem(id: string): LandItem | undefined {
    if (this.state.open === 'terrain' || this.state.open === 'view') return this.tvItems(this.state.open).find((x) => x.id === id);
    for (const t of LAND_TABS) { const i = this.landItems(t.id).find((x) => x.id === id); if (i) return i; }
    return undefined;
  }

  /** Side controls of a Landscape tab: the same kind of controls the Pistes drawer has (selects, buttons), never a custom layout. */
  private landControls(tab: LandTab): { node: HTMLElement; sync: () => void } {
    const api = this.api!, ls = api.landscape!, nat = api.nature;
    const side = el('div', 'pc'), marks: Array<() => void> = [];
    const range = (lo: number, hi: number, label: string): Array<{ value: string; label: string }> => Array.from({ length: hi - lo + 1 }, (_, i) => ({ value: String(lo + i), label: `${label} ${lo + i}` }));
    const brushSel = (lo: number, hi: number, label: string, get: () => number, set: (n: number) => void): void => {
      const s = makeSelect(range(lo, hi, label), String(get()), label, (v) => { set(Number(v)); this.landSync?.(); });
      s.title = `${label} ([ ] changes it)`;
      marks.push(() => { s.value = String(get()); });
      side.appendChild(s);
    };
    if (tab === 'water') {
      const lo = LANDSCAPE.pond.minExtent, hi = LANDSCAPE.pond.maxExtent;
      brushSel(lo, hi, 'Pond size', () => ls.state().pondSize, (n) => { if (ls.state().mode !== 'pond') ls.activate('pond'); ls.setBrush(n); });
    } else if (tab === 'nature') {
      if (nat) {
        const sp = makeSelect(nat.groups.map((g) => ({ value: g.id, label: g.label })), nat.state().group, 'Species group (G cycles)', (v) => { nat.setGroup(v); this.landSync?.(); });
        sp.title = 'Species group (G cycles)';
        marks.push(() => { sp.value = nat.state().group; });
        const dn = makeSelect([[0.3, 'Density: sparse'], [0.6, 'Density: normal'], [1, 'Density: dense']].map(([v, l]) => ({ value: String(v), label: String(l) })), String(nat.state().density), 'Planting density', (v) => nat.setDensity(Number(v)));
        dn.title = 'Planting density';
        marks.push(() => { dn.value = String(nat.state().density); });
        side.append(sp, dn);
      }
      const rocks = (): boolean => this.tool === 'landscape';
      brushSel(1, LANDSCAPE.rock.maxBrush, 'Brush size', () => (rocks() || !nat ? ls.state().brush : nat.state().brush), (n) => { if (rocks() || !nat) ls.setBrush(n); else nat.setBrush(n); });
    } else {
      const turn = this.btn('⟳ Turn (R)', 'Turn the piece (R): benches, hedges, fences and walls run along x or y', () => { ls.setRot(ls.state().rot ? 0 : 1); });
      side.appendChild(turn);
    }
    const hint = el('div', 'trailnote');
    hint.textContent = ({
      water: 'Drag a rectangle on level ground; [ ] changes the default size. Streams: not available yet.',
      nature: 'Trees: 1 plant / 2 clear, G species. Boulders: 3 / 4, drag to scatter. [ ] brush.',
      decor: 'Click to place, drag to draw a row; hedges, fences and walls follow the drag. R turns a piece.',
    } as const)[tab];
    side.appendChild(hint);
    return { node: side, sync: () => { for (const m of marks) m(); } };
  }

  /** One tab of the Landscape drawer: a card rail (shared with Buildings) + side controls. Returns the function that re-marks active cards / controls. */
  private landscapePane(tab: LandTab): () => void {
    if (!this.api?.landscape) { this.body.appendChild(this.textPane('Landscaping is not available here.')); return () => {}; }
    this.buildGrid(this.landItems(tab).map((i) => i.id), 'landscape');
    const ctl = this.landControls(tab);
    this.body.appendChild(ctl.node);
    return () => { ctl.sync(); this.updateCards(); this.renderInfo(); };
  }

}
