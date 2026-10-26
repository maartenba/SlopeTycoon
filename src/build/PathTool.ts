import * as THREE from 'three';
import { heightAt, pickHeightfield } from '../render/Picking';
import { lineTiles, NetKind, type NetKindId, type Networks } from '../world/Networks';
import type { Grid } from '../world/Grid';
import type { Pt } from '../sim/Dependencies';
import type { StrokeHistory } from './StrokeHistory';

export interface DragToolOptions {
  grid: Grid;
  networks: Networks;
  camera: THREE.Camera;
  dom: HTMLElement;
  scene: THREE.Scene;
  charge: (cost: number) => boolean;
  multiplier: () => number;
  /** Called after tiles were added/removed (reevaluate deps, refresh UI). */
  onChanged: () => void;
  /** A stroke was committed: group is the tool's undo group ('path'|'road'|'rail'|'piste'), layer for pistes. */
  onStroke?: (group: string, tiles: number, erase: boolean, layer?: number) => void;
  onError: (msg: string) => void;
  onDone?: () => void;
  /** Shared stroke history for undo. */
  history?: StrokeHistory;
  refund?: (n: number) => void;
  /** Non-error info toast (e.g. 'Removed N stray tiles'). */
  onInfo?: (msg: string) => void;
}

export interface Evaluation { ok: boolean; cost: number; text: string }

/** Shared pointer-drag plumbing: preview mesh, tooltip, Esc/right-click cancel. */
export abstract class DragTool {
  active = false;
  protected start: Pt | null = null;
  protected cur: Pt | null = null;
  protected vFirst = false;
  /** Undo group name. */
  abstract readonly group: string;
  /** Shift-drag erase stroke in progress (tools with `canErase`). */
  protected erasing = false;
  /** Persistent erase toggle (dock button). */
  eraseMode = false;
  protected readonly canErase: boolean = false;
  private preview = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthTest: false, vertexColors: true }));
  private tip = typeof document !== 'undefined' ? document.createElement('div') : null;
  private ray = new THREE.Raycaster();
  private disposers: Array<() => void> = [];

  constructor(protected o: DragToolOptions) {
    this.preview.renderOrder = 10;
    this.preview.frustumCulled = false;
    this.preview.visible = false;
    o.scene.add(this.preview);
    if (this.tip) {
      this.tip.style.cssText = 'position:fixed;pointer-events:none;padding:2px 6px;border-radius:4px;background:#000a;color:#fff;font:12px sans-serif;display:none;z-index:30';
      document.body.appendChild(this.tip);
    }
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, t: K, f: (e: HTMLElementEventMap[K]) => void): void => {
      el.addEventListener(t, f as EventListener);
      this.disposers.push(() => el.removeEventListener(t, f as EventListener));
    };
    on(o.dom, 'pointerdown', (e) => this.onDown(e));
    on(o.dom, 'pointermove', (e) => this.onMove(e));
    on(o.dom, 'pointerup', (e) => this.onUp(e));
    on(o.dom, 'contextmenu', (e) => { if (this.active) { e.preventDefault(); if (this.start) this.cancelStroke(); else this.stop(); } });
    const key = (e: KeyboardEvent): void => {
      if (!this.active) return;
      if (e.key === 'Escape') { if (this.start) this.cancelStroke(); else this.stop(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); this.undoLast(); }
      else if (e.key === 'r' || e.key === 'R') { this.vFirst = !this.vFirst; this.refresh(); }
    };
    window.addEventListener('keydown', key);
    this.disposers.push(() => window.removeEventListener('keydown', key));
  }

  /** Tiles to apply for the current drag. */
  protected abstract tiles(): Pt[];
  protected abstract evaluate(tiles: Pt[]): Evaluation;
  protected abstract commit(tiles: Pt[]): void;
  protected begin(p: Pt): void { this.cur = p; }
  /** Called for every picked tile while a stroke is in progress (freehand tools accumulate here). */
  protected sample(p: Pt): void { void p; }
  /** Tiles shown on hover (brush footprint). */
  protected hoverTiles(p: Pt): Pt[] { return [p]; }

  /** Abort the stroke in progress without committing (Esc). */
  cancelStroke(): void {
    this.start = null; this.cur = null; this.erasing = false;
    this.preview.visible = false;
    if (this.tip) this.tip.style.display = 'none';
  }

  /** Undo the latest stroke of this tool's group: restores tiles and refunds what was charged. */
  undoLast(): boolean {
    const e = this.o.history?.pop(this.group);
    if (!e) { this.o.onInfo?.('Nothing to undo'); return false; }
    this.o.networks.restore(e.diff);
    this.o.refund?.(e.cost);
    this.o.onChanged();
    return true;
  }

  begin_(): void { this.active = true; }
  stop(): void {
    const was = this.active;
    this.active = false; this.start = null; this.cur = null;
    this.preview.visible = false;
    if (this.tip) this.tip.style.display = 'none';
    if (was) this.o.onDone?.();
  }
  dispose(): void {
    for (const d of this.disposers) d();
    this.o.scene.remove(this.preview);
    this.preview.geometry.dispose();
    this.tip?.remove();
  }

  private pick(e: PointerEvent): Pt | null {
    const r = this.o.dom.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.o.camera);
    const p = pickHeightfield(this.o.grid, this.ray.ray.origin, this.ray.ray.direction);
    return p ? { x: p.tileX, y: p.tileY } : null;
  }

  private onDown(e: PointerEvent): void {
    if (!this.active || e.button !== 0 || e.target !== this.o.dom) return;
    const p = this.pick(e);
    if (!p) return;
    this.erasing = this.canErase && (e.shiftKey || this.eraseMode);
    this.start = p; this.cur = p;
    this.begin(p);
    this.refresh(e);
  }

  private onMove(e: PointerEvent): void {
    if (!this.active || e.target !== this.o.dom) return;
    const p = this.pick(e);
    if (!p) return;
    if (this.start && !(e.buttons & 1)) { this.cancelStroke(); return; } // pointerup was lost (left the canvas)
    this.cur = p;
    if (!this.start) { this.hover(p, e); return; }
    this.sample(p);
    this.refresh(e);
  }

  private hover(p: Pt, e: PointerEvent): void {
    const t = this.hoverTiles(p);
    this.show(t, this.evaluate(t), e.clientX, e.clientY);
  }

  /** Piste tools report their layer bit with onStroke. */
  protected strokeLayer(): number | undefined { return undefined; }

  private onUp(e: PointerEvent): void {
    if (!this.active || !this.start || e.button !== 0) return;
    const t = this.tiles();
    this.start = null;
    this.preview.visible = false;
    if (this.tip) this.tip.style.display = 'none';
    if (!t.length) return;
    const ev = this.evaluate(t);
    if (!ev.ok) { this.o.onError(ev.text); return; }
    if (!this.o.charge(ev.cost)) { this.o.onError('Not enough money'); return; }
    this.o.networks.beginJournal();
    this.commit(t);
    const diff = this.o.networks.endJournal();
    if (diff.length) this.o.history?.push({ group: this.group, diff, cost: ev.cost });
    this.o.onStroke?.(this.group, t.length, this.erasing, this.strokeLayer());
    this.erasing = false;
    this.o.onChanged();
  }

  private lastE: PointerEvent | null = null;
  private refresh(e?: PointerEvent): void {
    if (e) this.lastE = e;
    if (!this.cur || !this.start) return;
    const t = this.tiles();
    this.show(t, this.evaluate(t), this.lastE?.clientX ?? 0, this.lastE?.clientY ?? 0);
  }

  private show(tiles: Pt[], ev: Evaluation, cx: number, cy: number): void {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const c = new THREE.Color(!ev.ok ? 0xff4444 : this.erasing ? 0xffa030 : 0x66ff88);
    const g = this.o.grid;
    for (const t of tiles.slice(0, 600)) {
      const b = pos.length / 3;
      for (const [px, pz] of [[t.x, t.y], [t.x + 1, t.y], [t.x + 1, t.y + 1], [t.x, t.y + 1]] as const) {
        pos.push(px, heightAt(g, px, pz) + 0.12, pz);
        col.push(c.r, c.g, c.b);
      }
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    const geo = this.preview.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    this.preview.visible = tiles.length > 0;
    if (this.tip) {
      this.tip.style.display = 'block';
      this.tip.style.left = `${cx + 14}px`; this.tip.style.top = `${cy + 14}px`;
      this.tip.textContent = ev.text;
    }
  }
}

/** Footpath / road / rail: straight or L-shaped drag (R flips the corner). */
export class SegmentTool extends DragTool {
  readonly group: string;
  constructor(o: DragToolOptions, readonly kind: NetKindId) { super(o); this.group = kind === NetKind.Path ? 'path' : kind === NetKind.Road ? 'road' : 'rail'; }
  startTool(): void { this.begin_(); }

  protected tiles(): Pt[] {
    return this.start && this.cur ? lineTiles(this.start, this.cur, this.vFirst) : [];
  }
  protected evaluate(tiles: Pt[]): Evaluation {
    const plan = this.o.networks.planSegment(this.kind, tiles, this.o.multiplier());
    if (plan.ok && this.kind === NetKind.Path && plan.newTiles.length && !this.o.networks.strokeAnchored(tiles)) {
      return { ok: false, cost: 0, text: 'Paths must connect to a path, road or building' };
    }
    if (!plan.ok) return { ok: false, cost: 0, text: `Blocked: ${plan.reason}` };
    return { ok: true, cost: plan.cost, text: `Cost: $${Math.round(plan.cost)} (${plan.newTiles.length} tiles)` };
  }
  protected commit(tiles: Pt[]): void { this.o.networks.buildSegment(this.kind, tiles); }
}

export class PathTool extends SegmentTool {
  constructor(o: DragToolOptions) { super(o, NetKind.Path); }
}
