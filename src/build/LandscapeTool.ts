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

export type LandscapeMode = 'pond' | 'fill' | 'rock' | 'rockClear' | 'decor' | 'decorClear';
export interface LandscapeState { mode: LandscapeMode; brush: number; pondSize: number; decor: DecorKind; rot: 0 | 1 }

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
}

/**
 * Landscape drawer tool. Water: drag a rectangle (or click for the default size) to dig a pond, click a pond to fill it in. Nature: paint boulders / clear boulders.
 * Decor: click or drag to place the chosen piece (rows follow the drag direction, so a drag along a path edges it), remove with the eraser.
 * Keys: 1 pond, 2 fill, 3 boulders, 4 remove boulders, 5 decor, 6 remove decor, [ ] size, R rotate, Esc cancel.
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
    on(o.dom, 'pointerleave', () => { if (this.enabled && !this.painting) this.o.overlays.hide(); }); // only while this tool is the active one (Select's touch hover info must survive the finger lifting)
    on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e));
  }

  state(): LandscapeState { return { mode: this.mode, brush: this.brush, pondSize: this.pondSize, decor: this.decor, rot: this.rot }; }
  private emit(): void { this.o.onState?.(this.state()); }
  enable(): void { this.enabled = true; this.emit(); }
  disable(): void { this.enabled = false; this.cancel(); this.o.overlays.hide(); }
  cancel(): void { this.painting = false; this.start = null; this.last = null; this.stroke = null; this.lastKey = ''; }
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
      case 'decorClear': {
        const has = planDecorRemoval(this.o.ls, tile.x, tile.y);
        ov.setVertexRect(tile.x, tile.y, tile.x + 1, tile.y + 1);
        tip(0, has, has ? 'Remove decor (free)' : 'No decor here', has ? 0xffaa44 : 0xff4444);
        break;
      }
    }
  }

  private onMove(e: PointerEvent): void {
    if (this.skip(e)) return;
    const p = this.pickAt(e);
    this.hover(p, e);
    if (!p || !this.painting || !(e.buttons & 1) || e.altKey) return;
    const k = `${p.tileX},${p.tileY}`;
    if (this.mode === 'pond' || this.mode === 'fill') return; // pond commits on release
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
    this.painting = true;
    this.start = { x: p.tileX, y: p.tileY }; this.last = this.start; this.lastKey = `${p.tileX},${p.tileY}`;
    this.stroke = this.o.beginStroke?.(this.strokeLabel()) ?? null;
    if (this.mode !== 'pond' && this.mode !== 'fill') this.apply(p.tileX, p.tileY);
  }

  private onUp(e: PointerEvent): void {
    if (!this.painting || e.button !== 0) return;
    const p = this.pickAt(e);
    if (p && (this.mode === 'pond' || this.mode === 'fill')) this.apply(p.tileX, p.tileY);
    this.cancel();
    this.o.overlays.hide();
  }

  private onKey(e: KeyboardEvent): void {
    const t = ((e.composedPath?.()[0] as HTMLElement | undefined) ?? e.target) as HTMLElement | null; // the real target: events from inputs inside a shadow root are retargeted to the host
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const modes: LandscapeMode[] = ['pond', 'fill', 'rock', 'rockClear', 'decor', 'decorClear'];
    if (/^[1-6]$/.test(e.key)) { this.setMode(modes[Number(e.key) - 1]!); return; }
    switch (e.key) {
      case '[': this.setBrush(this.sizeNow() - 1); break;
      case ']': this.setBrush(this.sizeNow() + 1); break;
      case 'r': case 'R': this.setRot(this.rot ? 0 : 1); break;
      case 'Escape': this.cancel(); this.o.overlays.hide(); break;
    }
  }

  private strokeLabel(): string {
    switch (this.mode) {
      case 'pond': return 'Pond'; case 'fill': return 'Pond (filled in)';
      case 'rock': return 'Boulders'; case 'rockClear': return 'Boulders (removed)';
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
      case 'decorClear': {
        if (!planDecorRemoval(ls, x, y)) return;
        run({ x0: x, y0: y, x1: x, y1: y }, () => { ls.clearDecor(x, y); return { ok: true, flow: 0 }; });
        break;
      }
    }
  }
}

export { DECOR_IDS };
