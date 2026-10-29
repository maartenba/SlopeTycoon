import * as THREE from 'three';
import type { Grid } from '@/world/Grid';
import type { PropStore } from '@/world/Props';
import type { Overlays } from '@/render/Overlays';
import { pickHeightfield, type PickResult } from '@/render/Picking';
import { DECOR, DECOR_IDS, LANDSCAPE, type DecorKind } from '@/config/landscape';
import {
  applyDecor, applyFill, applyPond, applyRockRemoval, applyRocks, clampPondRect, planDecor, planDecorRemoval, planFill, planPond, planRockRemoval,
  planRocks, pondRectAround, type Landscape, type LandscapeEnv, type TileRect,
} from '@/sim/landscape/Landscape';
import { TileType } from '@/world/Grid';
import { applyRemoveSpring, applySpring, planRemoveSpring, planSpring, type Rivers } from '@/world/Rivers';
import { applyFillRiver, applyRiver, planFillRiver, planRiver, REASON, type RiverEnv, type RiverPlan } from '@/world/RiverPlanner';
import { RIVER } from '@/config/rivers';

export type LandscapeMode = 'pond' | 'fill' | 'rock' | 'rockClear' | 'decor' | 'decorClear' | 'river' | 'spring' | 'riverFill';
/** Modes of the Water tab (the spring markers show while one of them is active). */
export const WATER_MODES: ReadonlyArray<LandscapeMode> = ['pond', 'fill', 'river', 'spring', 'riverFill'];
export interface LandscapeState { mode: LandscapeMode; brush: number; pondSize: number; decor: DecorKind; rot: 0 | 1; /** Spring markers on (Water tab). */ showSprings?: boolean; /** A river / spring is armed and waits for the second tap (touch). */ pending?: boolean }

export interface LandscapeStroke { stamp(rect: { x0: number; y0: number; x1: number; y1: number }, run: () => { ok: boolean; flow: number }): boolean }

export interface LandscapeToolOptions {
  grid: Grid;
  props: PropStore;
  ls: Landscape;
  camera: THREE.OrthographicCamera;
  dom: HTMLElement;
  overlays: Overlays;
  env: () => LandscapeEnv;
  now: () => number;
  charge: (cost: number) => boolean;
  /** One undo step per drag. */
  beginStroke?: (label: string) => LandscapeStroke;
  /** Prop chunks / heights changed (refresh renderers), plus what happened. */
  onApplied: (chunks: number[], info: { kind: LandscapeMode }) => void;
  onState?: (s: LandscapeState) => void;
  onRefused?: (reason: string) => void;
  /** Dug rivers + springs (Phase 6 Task 14; absent = no river modes). */
  rivers?: Rivers;
  riverEnv?: () => RiverEnv;
  /** One undo step per river / spring (`Undo.riverStroke`). */
  beginRiverStroke?: (label: string) => LandscapeStroke;
  /** Career lock reason of the river tools (`gate.locked('landscape', 'river')`), or null. */
  locked?: (id: 'river') => string | null;
  /** Touch: a river / spring needs a second tap (or the Confirm button) before it is dug, like a placement ghost. */
  confirmFirst?: () => boolean;
  /** Spring markers should show / hide (the Water tab opened / closed). */
  onSprings?: (visible: boolean) => void;
}

/**
 * Landscape drawer tool. Water: drag a rectangle (or click for the default size) to dig a pond, click a pond to fill it in. Nature: paint boulders / clear boulders.
 * Decor: click or drag to place the chosen piece (rows follow the drag direction, so a drag along a path edges it), remove with the eraser.
 * Rivers (Water tab): drag from a source (spring / lake shore / stream bank) to a sink (lake / stream / map edge); the planner routes downhill and the ghost shows
 * the channel, the cut depth and the cost. Click a spring to take the cheapest outlet. Spring: $250 on rising ground. Fill in river: click a dug river.
 * Keys: 1 pond, 2 fill, 3 boulders, 4 remove boulders, 5 decor, 6 remove decor, 7 dig river, 8 spring, 9 fill in river, [ ] size, R rotate, Esc cancel.
 */
export class LandscapeTool {
  mode: LandscapeMode = 'pond';
  brush = 2;
  pondSize = 5;
  decor: DecorKind = 'bench';
  rot: 0 | 1 = 0;
  enabled = false;
  private painting = false;
  private start: { x: number; y: number } | null = null;
  private last: { x: number; y: number } | null = null;
  private lastKey = '';
  private stroke: LandscapeStroke | null = null;
  private lastRefusal = '';
  /** Spring markers while a Water-tab mode is active. */
  showSprings = true;
  /** Armed river / spring (touch two-step): the tiles that confirm it and how to dig it (re-planned at commit). */
  private pending: { tiles: Set<string>; run: () => boolean; label: string } | null = null;
  private riverKey = '';
  private riverPlan: RiverPlan | null = null;
  private springsShown = false;
  private readonly ray = new THREE.Raycaster();
  private readonly disposers: Array<() => void> = [];

  constructor(private o: LandscapeToolOptions) {
    const on = (el: HTMLElement | Window, t: string, fn: (e: never) => void): void => {
      el.addEventListener(t, fn as EventListener);
      this.disposers.push(() => el.removeEventListener(t, fn as EventListener));
    };
    on(o.dom, 'pointermove', (e: PointerEvent) => this.onMove(e));
    on(o.dom, 'pointerdown', (e: PointerEvent) => this.onDown(e));
    on(window, 'pointerup', (e: PointerEvent) => this.onUp(e));
    on(o.dom, 'pointerleave', () => { if (this.enabled && !this.painting && !this.pending) this.o.overlays.hide(); }); // only while this tool is the active one (Select's touch hover info must survive the finger lifting)
    on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e));
  }

  state(): LandscapeState { return { mode: this.mode, brush: this.brush, pondSize: this.pondSize, decor: this.decor, rot: this.rot, showSprings: this.showSprings, pending: !!this.pending }; }
  private emit(): void { this.syncSprings(); this.o.onState?.(this.state()); }
  private syncSprings(): void {
    const v = this.enabled && this.showSprings && WATER_MODES.includes(this.mode);
    if (v !== this.springsShown) { this.springsShown = v; this.o.onSprings?.(v); }
  }
  setShowSprings(v: boolean): void { this.showSprings = v; this.emit(); }
  enable(): void { this.enabled = true; this.emit(); }
  disable(): void { this.enabled = false; this.cancel(); this.o.overlays.hide(); this.emit(); }
  cancel(): void { this.painting = false; this.start = null; this.last = null; this.stroke = null; this.lastKey = ''; this.riverKey = ''; this.riverPlan = null; if (this.pending) { this.pending = null; this.o.overlays.hide(); this.o.onState?.(this.state()); } }
  /** Touch: dig the armed river / place the armed spring (the Confirm button). False when nothing is armed. */
  confirm(): boolean { const p = this.pending; if (!p) return false; this.pending = null; this.o.overlays.hide(); const ok = p.run(); this.emit(); return ok; }
  hasPending(): boolean { return !!this.pending; }
  setMode(m: LandscapeMode): void { this.mode = m; this.cancel(); this.o.overlays.hide(); this.emit(); }
  setDecor(k: DecorKind): void { this.decor = k; this.mode = 'decor'; this.emit(); }
  setRot(r: 0 | 1): void { this.rot = r; this.emit(); }
  setBrush(n: number): void {
    if (this.mode === 'pond') this.pondSize = Math.max(LANDSCAPE.pond.minExtent, Math.min(LANDSCAPE.pond.maxExtent, Math.round(n)));
    else this.brush = Math.max(1, Math.min(LANDSCAPE.rock.maxBrush, Math.round(n)));
    this.emit();
  }
  /** The number [ ] changes in the current mode. */
  sizeNow(): number { return this.mode === 'pond' ? this.pondSize : this.brush; }
  dispose(): void { for (const d of this.disposers) d(); }

  private pickAt(e: PointerEvent): PickResult | null {
    const r = this.o.dom.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.o.camera);
    return pickHeightfield(this.o.grid, this.ray.ray.origin, this.ray.ray.direction);
  }

  private skip(e: PointerEvent): boolean { return !this.enabled || e.target !== this.o.dom; }

  /** Footprint rect for the pond tool at the cursor (drag: start..cursor, hover: the default size). */
  private pondRect(p: { x: number; y: number }): TileRect {
    return this.start && this.painting ? clampPondRect({ x0: this.start.x, y0: this.start.y, x1: p.x, y1: p.y }) : pondRectAround(p.x, p.y, this.pondSize);
  }

  private hover(p: PickResult | null, e: PointerEvent): void {
    const ov = this.o.overlays;
    if (!p) { ov.hide(); return; }
    const env = this.o.env(), tip = (cost: number, ok: boolean, text: string, color: number): void => { ov.setColor(color); ov.setTooltip({ cost, blocked: !ok, x: e.clientX, y: e.clientY, text }); };
    const tile = { x: p.tileX, y: p.tileY };
    switch (this.mode) {
      case 'pond': {
        const r = this.pondRect(tile), plan = planPond(env, r);
        ov.setVertexRect(r.x0, r.y0, r.x1 + 1, r.y1 + 1);
        tip(plan.cost, plan.ok, plan.ok ? `Dig pond ${plan.tileIdx.length} tiles · $${plan.cost}${this.painting ? '' : ' (drag to size)'}` : `Blocked: ${plan.reason}`, plan.ok ? 0x55bbee : 0xff4444);
        break;
      }
      case 'fill': {
        const plan = planFill(env, this.o.ls, tile.x, tile.y);
        ov.setVertexRect(tile.x, tile.y, tile.x + 1, tile.y + 1);
        tip(plan.cost, plan.ok, plan.ok ? `Fill in this pond · $${plan.cost}` : `Blocked: ${plan.reason}`, plan.ok ? 0xffaa44 : 0xff4444);
        break;
      }
      case 'rock': case 'rockClear': {
        const r = Math.max(1, this.brush) - 1;
        ov.setVertexRect(tile.x - r, tile.y - r, tile.x + r + 1, tile.y + r + 1);
        if (this.mode === 'rock') { const plan = planRocks(env, tile.x, tile.y, this.brush, this.o.now()); tip(plan.cost, plan.rocks.length > 0, plan.rocks.length ? `Place ${plan.rocks.length} boulders · $${plan.cost}` : plan.rejected ? 'Blocked: water, steep ground or something built there' : 'Already full', plan.rocks.length ? 0x99aa99 : 0xff4444); }
        else { const c = planRockRemoval(env, tile.x, tile.y, this.brush); tip(c.cost, c.count > 0, c.count ? `Remove ${c.count} boulders · $${c.cost}` : 'No boulders here', c.count ? 0xffaa44 : 0xff4444); }
        break;
      }
      case 'decor': {
        const plan = planDecor(env, tile.x, tile.y, this.decor);
        ov.setVertexRect(tile.x, tile.y, tile.x + 1, tile.y + 1);
        tip(plan.cost, plan.ok, plan.ok ? `${DECOR[this.decor].label} · $${plan.cost}${DECOR[this.decor].oriented ? ' (R turns, drag to edge a path)' : ''}` : `Blocked: ${plan.reason}`, plan.ok ? 0x66dd66 : 0xff4444);
        break;
      }
      case 'river': case 'spring': case 'riverFill': this.hoverWater(tile, tip); break;
      case 'decorClear': {
        const has = planDecorRemoval(this.o.ls, tile.x, tile.y);
        ov.setVertexRect(tile.x, tile.y, tile.x + 1, tile.y + 1);
        tip(0, has, has ? 'Remove decor (free)' : 'No decor here', has ? 0xffaa44 : 0xff4444);
        break;
      }
    }
  }


  // ------------------------------------------------------------------------------------------------------------ rivers / springs (Phase 6 Task 14)

  private isWaterTile(x: number, y: number): boolean { const t = this.o.grid.tileType[y * this.o.grid.size + x]; return t === TileType.Water || t === TileType.Stream; }
  /** A tile a dragged river may END on by choice: a lake / stream tile or the map edge. Anything else = "cheapest outlet". */
  private sinkAt(t: { x: number; y: number }): { x: number; y: number } | null {
    const n = this.o.grid.size;
    return this.isWaterTile(t.x, t.y) || t.x === 0 || t.y === 0 || t.x === n - 1 || t.y === n - 1 ? { x: t.x, y: t.y } : null;
  }
  /** Worth planning from here (spring site, or dry and beside water): keeps hover planning cheap. */
  private sourceLike(t: { x: number; y: number }): boolean {
    const g = this.o.grid;
    if (this.o.rivers?.isSource(t.x, t.y)) return true;
    if (this.isWaterTile(t.x, t.y)) return false;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) if (g.inBounds(t.x + dx, t.y + dy) && this.isWaterTile(t.x + dx, t.y + dy)) return true;
    return false;
  }
  private planRiverCached(start: { x: number; y: number }, sink: { x: number; y: number } | null): RiverPlan {
    const g = this.o.grid, key = `${start.x},${start.y}>${sink ? `${sink.x},${sink.y}` : '*'}|${this.o.rivers?.version}|${g.terrainVersion}`;
    if (key === this.riverKey && this.riverPlan) return this.riverPlan;
    const plan = planRiver(this.o.riverEnv!(), start, sink);
    this.riverKey = key; this.riverPlan = plan;
    return plan;
  }
  private lockReason(): string | null { return this.o.locked?.('river') ?? null; }

  private hoverWater(tile: { x: number; y: number }, tip: (cost: number, ok: boolean, text: string, color: number) => void): void {
    const ov = this.o.overlays, rivers = this.o.rivers;
    ov.setVertexRect(tile.x, tile.y, tile.x + 1, tile.y + 1);
    if (!rivers || !this.o.riverEnv) { tip(0, false, 'Blocked: rivers are not available here', 0xff4444); return; }
    const lock = this.lockReason();
    if (lock && this.mode !== 'riverFill') { tip(0, false, lock, 0xff4444); return; }
    if (this.pending && this.pending.tiles.has(`${tile.x},${tile.y}`)) { tip(0, true, `${this.pending.label} · tap again to confirm`, 0x55bbee); return; }
    switch (this.mode) {
      case 'river': {
        const start = this.painting && this.start ? this.start : tile;
        if (!this.sourceLike(start)) { ov.setRiverGhost(null); tip(0, false, `Blocked: ${REASON.start}`, 0xff4444); return; }
        const sink = this.painting && this.start ? this.sinkAt(tile) : null, plan = this.planRiverCached(start, sink);
        if (plan.ok) {
          const drop = (plan.level[0] ?? 0) - (plan.level[plan.level.length - 1] ?? 0);
          ov.setRiverGhost(plan.path, plan.carveDepth, plan.changed, RIVER.maxCarve);
          tip(plan.cost, true, `Dig river · ${plan.path.length} tiles · drop ${drop} · deepest cut ${plan.maxCarve} · $${plan.cost}${this.painting ? '' : ' (drag to choose the end)'}`, 0x55bbee);
        } else {
          ov.setRiverGhost(null);
          const lines = plan.reasons.slice(0, 3).map((t) => ({ kind: 'error' as const, text: t }));
          ov.setColor(0xff4444); ov.setTooltip({ cost: 0, blocked: true, x: this.lastX, y: this.lastY, text: `Blocked: ${plan.reason}`, lines });
        }
        return;
      }
      case 'spring': {
        const plan = planSpring(this.o.riverEnv(), rivers, tile.x, tile.y);
        tip(plan.cost, plan.ok, plan.ok ? `Place spring · $${plan.cost} (a river can start here)` : `Blocked: ${plan.reason}`, plan.ok ? 0x66ddff : 0xff4444);
        return;
      }
      default: {
        const rec = rivers.riverAt(tile.x, tile.y);
        if (rec) {
          const plan = planFillRiver(rivers, rec.id);
          ov.setRiverGhost(rec.path, rec.path.map(() => 0), []);
          tip(0, plan.ok, plan.ok ? `Fill in this river (${rec.path.length} tiles) · restores the ground · no refund` : `Blocked: ${plan.reason}`, plan.ok ? 0xffaa44 : 0xff4444);
        } else if (rivers.isPlacedSpring(tile.x, tile.y)) {
          const plan = planRemoveSpring(rivers, tile.x, tile.y);
          tip(0, plan.ok, plan.ok ? 'Remove this spring (free, no refund)' : `Blocked: ${plan.reason}`, plan.ok ? 0xffaa44 : 0xff4444);
        } else tip(0, false, 'Click a river you dug, or a spring you placed', 0xff4444);
      }
    }
  }

  private freshStroke(label: string): LandscapeStroke | null { return this.o.beginRiverStroke?.(label) ?? null; }
  private stampWorld(label: string, rect: TileRect, body: () => { ok: boolean; flow: number; chunks?: number[] }): boolean {
    let chunks: number[] = [];
    const wrapped = (): { ok: boolean; flow: number } => { const r = body(); chunks = r.chunks ?? []; return r; };
    const st = this.freshStroke(label), ok = st ? st.stamp(rect, wrapped) : wrapped().ok;
    if (ok) { this.lastRefusal = ''; this.o.onApplied(chunks, { kind: this.mode }); }
    return ok;
  }

  /** Dig the river from `start` to `sink` (null = the cheapest outlet): re-planned on the current state, one undo step. */
  digRiver(start: { x: number; y: number }, sink: { x: number; y: number } | null): boolean {
    const rivers = this.o.rivers, env = this.o.riverEnv?.();
    if (!rivers || !env) return false;
    const lock = this.lockReason();
    if (lock) { this.refuse(lock); return false; }
    const plan = planRiver(env, start, sink);
    if (!plan.ok) { this.refuse(plan.reason ?? 'Blocked'); return false; }
    const rect = { ...plan.rect };
    for (const q of plan.path) { rect.x0 = Math.min(rect.x0, q.x); rect.y0 = Math.min(rect.y0, q.y); rect.x1 = Math.max(rect.x1, q.x); rect.y1 = Math.max(rect.y1, q.y); }
    return this.stampWorld('River', { x0: rect.x0 - 1, y0: rect.y0 - 1, x1: rect.x1 + 1, y1: rect.y1 + 1 }, () => {
      if (!this.o.charge(plan.cost)) { this.refuse('Not enough funds'); return { ok: false, flow: 0 }; }
      const r = applyRiver(env, rivers, plan);
      if (!r.ok) { this.refuse(r.reason ?? 'Blocked'); return { ok: false, flow: 0 }; }
      return { ok: true, flow: plan.cost, chunks: r.touchedChunks };
    });
  }

  placeSpring(x: number, y: number): boolean {
    const rivers = this.o.rivers, env = this.o.riverEnv?.();
    if (!rivers || !env) return false;
    const lock = this.lockReason();
    if (lock) { this.refuse(lock); return false; }
    const plan = planSpring(env, rivers, x, y);
    if (!plan.ok) { this.refuse(plan.reason ?? 'Blocked'); return false; }
    return this.stampWorld('Spring', { x0: x - 1, y0: y - 1, x1: x + 1, y1: y + 1 }, () => {
      if (!this.o.charge(plan.cost)) { this.refuse('Not enough funds'); return { ok: false, flow: 0 }; }
      applySpring(env, rivers, plan);
      return { ok: true, flow: plan.cost };
    });
  }

  private fillAt(x: number, y: number): boolean {
    const rivers = this.o.rivers, env = this.o.riverEnv?.();
    if (!rivers || !env) return false;
    const rec = rivers.riverAt(x, y);
    if (rec) {
      const plan = planFillRiver(rivers, rec.id);
      if (!plan.ok) { this.refuse(plan.reason ?? 'Blocked'); return false; }
      const g = this.o.grid, r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      const grow = (px: number, py: number): void => { r.x0 = Math.min(r.x0, px); r.y0 = Math.min(r.y0, py); r.x1 = Math.max(r.x1, px); r.y1 = Math.max(r.y1, py); };
      for (const q of rec.path) grow(q.x, q.y);
      for (const c of rec.carved) { grow((c.v % g.vsize) - 1, Math.floor(c.v / g.vsize) - 1); grow(c.v % g.vsize, Math.floor(c.v / g.vsize)); }
      return this.stampWorld('River (filled in)', { x0: r.x0 - 1, y0: r.y0 - 1, x1: r.x1 + 1, y1: r.y1 + 1 }, () => {
        const res = applyFillRiver(env, rivers, plan);
        if (!res.ok) { this.refuse(res.reason ?? 'Blocked'); return { ok: false, flow: 0 }; }
        return { ok: true, flow: 0, chunks: res.touchedChunks };
      });
    }
    if (rivers.isPlacedSpring(x, y)) {
      const plan = planRemoveSpring(rivers, x, y);
      if (!plan.ok) { this.refuse(plan.reason ?? 'Blocked'); return false; }
      return this.stampWorld('Spring (removed)', { x0: x - 1, y0: y - 1, x1: x + 1, y1: y + 1 }, () => ({ ok: applyRemoveSpring(env, rivers, x, y), flow: 0 }));
    }
    return false;
  }

  /** Release of a river / spring / fill stroke: dig now, or (touch) arm it and wait for the second tap. */
  private finishWater(start: { x: number; y: number } | null, end: { x: number; y: number }): void {
    if (!this.o.rivers) return;
    if (this.mode === 'riverFill') { this.fillAt(end.x, end.y); return; }
    if (this.mode === 'spring') {
      const plan = planSpring(this.o.riverEnv!(), this.o.rivers, end.x, end.y);
      if (!plan.ok) { this.refuse(plan.reason ?? 'Blocked'); return; }
      if (this.o.confirmFirst?.()) { this.arm('Spring', [end], () => this.placeSpring(end.x, end.y)); return; }
      this.placeSpring(end.x, end.y);
      return;
    }
    const from = start ?? end, dragged = start && (start.x !== end.x || start.y !== end.y);
    if (!this.sourceLike(from)) { this.refuse(REASON.start); return; }
    const sink = dragged ? this.sinkAt(end) : null, plan = this.planRiverCached(from, sink);
    if (!plan.ok) { this.refuse(plan.reason ?? 'Blocked'); return; }
    if (this.o.confirmFirst?.()) { this.arm(`River $${plan.cost}`, [from, end, ...(plan.path.length ? [plan.path[plan.path.length - 1]!] : [])], () => this.digRiver(from, sink)); this.o.overlays.setRiverGhost(plan.path, plan.carveDepth, plan.changed, RIVER.maxCarve); return; }
    this.digRiver(from, sink);
  }
  private arm(label: string, tiles: Array<{ x: number; y: number }>, run: () => boolean): void {
    this.pending = { tiles: new Set(tiles.map((t) => `${t.x},${t.y}`)), run, label };
    this.o.overlays.setTooltip({ cost: 0, blocked: false, x: this.lastX, y: this.lastY, text: `${label}: tap the end again (or ✓ Place) to confirm` });
    this.o.onState?.(this.state());
  }
  private lastX = 0;
  private lastY = 0;

  private onMove(e: PointerEvent): void {
    if (this.skip(e)) return;
    this.lastX = e.clientX; this.lastY = e.clientY;
    if (this.pending) return; // armed: the ghost stays until the second tap / Confirm / cancel
    const p = this.pickAt(e);
    this.hover(p, e);
    if (!p || !this.painting || !(e.buttons & 1) || e.altKey) return;
    const k = `${p.tileX},${p.tileY}`;
    if (this.mode === 'pond' || this.mode === 'fill' || this.mode === 'river' || this.mode === 'spring' || this.mode === 'riverFill') return; // these commit on release
    if (k === this.lastKey) return;
    // rows follow the drag direction
    if (this.mode === 'decor' && DECOR[this.decor].oriented && this.last) {
      const dx = Math.abs(p.tileX - this.last.x), dy = Math.abs(p.tileY - this.last.y);
      if (dx !== dy) this.rot = dx > dy ? 0 : 1;
    }
    this.lastKey = k; this.last = { x: p.tileX, y: p.tileY };
    this.apply(p.tileX, p.tileY);
  }

  private onDown(e: PointerEvent): void {
    if (this.skip(e) || e.button !== 0 || e.altKey) return;
    const p = this.pickAt(e);
    if (!p) return;
    if (this.pending) { if (this.pending.tiles.has(`${p.tileX},${p.tileY}`)) { this.confirm(); return; } this.cancel(); this.o.overlays.hide(); }
    this.painting = true;
    this.start = { x: p.tileX, y: p.tileY }; this.last = this.start; this.lastKey = `${p.tileX},${p.tileY}`;
    const world = this.mode === 'river' || this.mode === 'spring' || this.mode === 'riverFill';
    this.stroke = world ? null : this.o.beginStroke?.(this.strokeLabel()) ?? null;
    if (this.mode !== 'pond' && this.mode !== 'fill' && !world) this.apply(p.tileX, p.tileY);
  }

  private onUp(e: PointerEvent): void {
    if (!this.painting || e.button !== 0) return;
    const p = this.pickAt(e);
    if (p && (this.mode === 'pond' || this.mode === 'fill')) this.apply(p.tileX, p.tileY);
    else if (p && (this.mode === 'river' || this.mode === 'spring' || this.mode === 'riverFill')) this.finishWater(this.start, { x: p.tileX, y: p.tileY });
    this.painting = false; this.start = null; this.last = null; this.stroke = null; this.lastKey = '';
    if (!this.pending) this.o.overlays.hide();
  }

  private onKey(e: KeyboardEvent): void {
    const t = ((e.composedPath?.()[0] as HTMLElement | undefined) ?? e.target) as HTMLElement | null; // the real target: events from inputs inside a shadow root are retargeted to the host
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const modes: LandscapeMode[] = ['pond', 'fill', 'rock', 'rockClear', 'decor', 'decorClear', 'river', 'spring', 'riverFill'];
    if (/^[1-9]$/.test(e.key) && (Number(e.key) <= 6 || this.o.rivers)) { this.setMode(modes[Number(e.key) - 1]!); return; }
    switch (e.key) {
      case '[': this.setBrush(this.sizeNow() - 1); break;
      case ']': this.setBrush(this.sizeNow() + 1); break;
      case 'r': case 'R': this.setRot(this.rot ? 0 : 1); break;
      case 'Escape': this.cancel(); this.o.overlays.hide(); break;
      case 'Enter': if (this.pending) this.confirm(); break;
    }
  }

  private strokeLabel(): string {
    switch (this.mode) {
      case 'pond': return 'Pond'; case 'fill': return 'Pond (filled in)';
      case 'rock': return 'Boulders'; case 'rockClear': return 'Boulders (removed)';
      case 'river': return 'River'; case 'spring': return 'Spring'; case 'riverFill': return 'River (filled in)';
      case 'decor': return DECOR[this.decor].label; default: return 'Decor (removed)';
    }
  }

  private refuse(reason: string): void {
    if (reason && reason !== this.lastRefusal) { this.lastRefusal = reason; this.o.onRefused?.(reason); }
  }

  private apply(x: number, y: number): void {
    const env = this.o.env(), ls = this.o.ls;
    const run = (rect: TileRect, doIt: () => { ok: boolean; flow: number; chunks?: number[] }): void => {
      let chunks: number[] = [];
      const wrapped = (): { ok: boolean; flow: number } => { const r = doIt(); chunks = r.chunks ?? []; return r; };
      const ok = this.stroke ? this.stroke.stamp(rect, wrapped) : wrapped().ok;
      if (ok) { this.lastRefusal = ''; this.o.onApplied(chunks, { kind: this.mode }); }
    };
    switch (this.mode) {
      case 'pond': {
        const plan = planPond(env, this.pondRect({ x, y }));
        if (!plan.ok) { this.refuse(plan.reason ?? 'Blocked'); return; }
        // the earthworks (incl. the edge-delta ripple) decide how much ground the undo step must remember
        const area = { x0: plan.rect.x0, y0: plan.rect.y0, x1: plan.rect.x1, y1: plan.rect.y1 };
        for (const c of plan.changed) { area.x0 = Math.min(area.x0, c.vx - 1); area.y0 = Math.min(area.y0, c.vy - 1); area.x1 = Math.max(area.x1, c.vx); area.y1 = Math.max(area.y1, c.vy); }
        run(area, () => {
          if (!this.o.charge(plan.cost)) { this.refuse('Not enough funds'); return { ok: false, flow: 0 }; }
          const r = applyPond(env, ls, plan);
          return { ok: r.ok, flow: r.ok ? plan.cost : 0, chunks: r.touchedChunks };
        });
        break;
      }
      case 'fill': {
        const plan = planFill(env, ls, x, y);
        if (!plan.ok || !plan.pond) { this.refuse(plan.reason ?? 'Blocked'); return; }
        const xs = plan.pond.tileIdx.map((t) => t % this.o.grid.size), ys = plan.pond.tileIdx.map((t) => Math.floor(t / this.o.grid.size));
        run({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }, () => {
          if (!this.o.charge(plan.cost)) { this.refuse('Not enough funds'); return { ok: false, flow: 0 }; }
          const r = applyFill(env, ls, plan);
          return { ok: r.ok, flow: r.ok ? plan.cost : 0, chunks: r.touchedChunks };
        });
        break;
      }
      case 'rock': {
        const plan = planRocks(env, x, y, this.brush, this.o.now());
        if (!plan.rocks.length) return;
        const r = this.brush;
        run({ x0: x - r, y0: y - r, x1: x + r, y1: y + r }, () => {
          if (!this.o.charge(plan.cost)) { this.refuse('Not enough funds'); return { ok: false, flow: 0 }; }
          return { ok: true, flow: plan.cost, chunks: applyRocks(this.o.props, plan) };
        });
        break;
      }
      case 'rockClear': {
        const c = planRockRemoval(env, x, y, this.brush);
        if (!c.count) return;
        const r = this.brush;
        run({ x0: x - r, y0: y - r, x1: x + r, y1: y + r }, () => {
          if (!this.o.charge(c.cost)) { this.refuse('Not enough funds'); return { ok: false, flow: 0 }; }
          return { ok: true, flow: c.cost, chunks: applyRockRemoval(env, x, y, this.brush) };
        });
        break;
      }
      case 'decor': {
        const plan = planDecor(env, x, y, this.decor);
        if (!plan.ok) { if (!this.painting || !this.start || (this.start.x === x && this.start.y === y)) this.refuse(plan.reason ?? 'Blocked'); return; }
        run({ x0: x, y0: y, x1: x, y1: y }, () => {
          if (!this.o.charge(plan.cost)) { this.refuse('Not enough funds'); return { ok: false, flow: 0 }; }
          applyDecor(ls, x, y, this.decor, DECOR[this.decor].oriented ? this.rot : 0);
          return { ok: true, flow: plan.cost };
        });
        break;
      }
      case 'river': case 'spring': case 'riverFill': break; // committed on release (finishWater)
      case 'decorClear': {
        if (!planDecorRemoval(ls, x, y)) return;
        run({ x0: x, y0: y, x1: x, y1: y }, () => { ls.clearDecor(x, y); return { ok: true, flow: 0 }; });
        break;
      }
    }
  }
}

export { DECOR_IDS };
