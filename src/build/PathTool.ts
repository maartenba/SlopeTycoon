import type { ProfileView } from '../ui/components/StProfile';
import * as THREE from 'three';
import { heightAt, pickHeightfield } from '../render/Picking';
import { Cross, lineTiles, NetKind, type NetKindId, type Networks } from '../world/Networks';
import { overpassAlong, type Overpass } from '../world/OverpassProfile';
import { buildStroke, describeExtras, planStroke, type CrossMode, type StrokePlan } from '../world/StrokePlan';
import { HEIGHT_UNIT } from '../config/balance';
import { CROSSING } from '../config/crossings';
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
  /** Career lock reason of the suspension footbridge (`gate.locked('landscape', 'suspension')`), null = available. */
  suspensionLocked?: () => string | null;
  /** Career lock reason of backcountry routes, null = available. */
  backcountryLocked?: () => string | null;
  /** Called after tiles were added/removed (reevaluate deps, refresh UI). */
  onChanged: () => void;
  /** A stroke was committed: group is the tool's undo group ('path'|'road'|'rail'|'piste'), layer for pistes. */
  onStroke?: (group: string, tiles: number, erase: boolean, layer?: number) => void;
  onError: (msg: string) => void;
  onDone?: () => void;
  /** Shared stroke history for undo. */
  history?: StrokeHistory;
  /** Shared undo/redo stack hook: when given, strokes are recorded here (Ctrl+Z / Ctrl+Y are global) instead of `history`. */
  record?: (group: string, diff: import('../world/Networks').TileSnap[], cost: number, erase: boolean) => void;
  refund?: (n: number) => void;
  /** Non-error info toast (e.g. 'Removed N stray tiles'). */
  onInfo?: (msg: string) => void;
  /** Slope profile of the piste stroke being dragged (null = hide). */
  onProfile?: (v: ProfileView | null) => void;
}

/** What the preview adds on top of the plain tile line: bridge decks (blue, at deck height), crossings (gold) and the banks. */
export interface Ghost { decks: Array<{ tiles: Pt[]; deck: number }>; marks: Pt[]; /** Road overpasses: ramp + deck tiles drawn at the deck profile. */ overpasses?: Overpass[]; /** Rail footbridge / MTB ramp bridge tiles: drawn as a raised deck over the rail. */ lifted?: Pt[] }
export interface Evaluation { ok: boolean; cost: number; text: string; ghost?: Ghost }

/** Preview extras of a successful plan (bridge decks, crossing tiles). */
export function ghostOf(plan: StrokePlan): Ghost {
  const over = (c: number): boolean => c === Cross.Footbridge || c === Cross.MtbBridge;
  return { decks: plan.bridges.map((b) => ({ tiles: b.span, deck: b.deck })), overpasses: plan.overpasses.map((o) => ({ id: 0, x: o.x, y: o.y, axis: o.axis, n: o.n, top: o.top, endA: o.endA, endB: o.endB, cost: o.cost })), marks: plan.crossings.filter((c) => !over(c.cross) && c.cross !== Cross.Overpass).map((c) => ({ x: c.x, y: c.y })), lifted: plan.crossings.filter((c) => over(c.cross)).map((c) => ({ x: c.x, y: c.y })) };
}

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
      this.tip.style.cssText = 'position:fixed;pointer-events:none;padding:3px 7px;border-radius:4px;background:#000c;color:#fff;font:12px/1.35 sans-serif;display:none;z-index:30;max-width:min(300px,calc(100vw - 16px));white-space:normal;overflow-wrap:anywhere;box-sizing:border-box';
      document.body.appendChild(this.tip);
    }
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, t: K, f: (e: HTMLElementEventMap[K]) => void): void => {
      el.addEventListener(t, f as EventListener);
      this.disposers.push(() => el.removeEventListener(t, f as EventListener));
    };
    on(o.dom, 'pointerdown', (e) => this.onDown(e));
    on(o.dom, 'pointermove', (e) => this.onMove(e));
    on(window, 'pointerup', (e) => this.onUp(e)); // window: releasing over a HUD panel (profile card) must still end the stroke
    on(o.dom, 'contextmenu', (e) => { if (this.active) { e.preventDefault(); if (this.start) this.cancelStroke(); else this.stop(); } });
    const key = (e: KeyboardEvent): void => {
      if (!this.active) return;
      if (e.key === 'Escape') { if (this.start) this.cancelStroke(); else this.stop(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !this.o.record) { e.preventDefault(); this.undoLast(); }
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
    this.strokeEnded();
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
  /** The drag ended (committed, rejected or cancelled): subclasses hide their ghost extras. */
  protected strokeEnded(): void {}
  stop(): void {
    this.strokeEnded();
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
    this.strokeEnded();
    this.preview.visible = false;
    if (this.tip) this.tip.style.display = 'none';
    if (!t.length) return;
    const ev = this.evaluate(t);
    if (!ev.ok) { this.o.onError(ev.text); return; }
    if (!this.o.charge(ev.cost)) { this.o.onError('Not enough money'); return; }
    this.o.networks.beginJournal();
    this.commit(t);
    const diff = this.o.networks.endJournal();
    if (diff.length) { if (this.o.record) this.o.record(this.group, diff, ev.cost, this.erasing); else this.o.history?.push({ group: this.group, diff, cost: ev.cost }); }
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

  /** Keep the tooltip inside the viewport: flip to the left / above the pointer when it would run off the right / bottom edge. */
  private placeTip(cx: number, cy: number): void {
    const tip = this.tip;
    if (!tip || typeof window === 'undefined') return;
    const vw = (window as { innerWidth?: number }).innerWidth ?? 1280, vh = (window as { innerHeight?: number }).innerHeight ?? 800;
    // measure at the origin: a fixed box left near the right edge by the previous move is squeezed to the room that is left there and wraps / clips the text
    tip.style.left = '0px'; tip.style.top = '0px';
    const w = tip.offsetWidth || 0, h = tip.offsetHeight || 0, m = 8;
    let x = cx + 14, y = cy + 14;
    if (x + w + m > vw) x = cx - 14 - w;
    if (y + h + m > vh) y = cy - 14 - h;
    tip.style.left = `${Math.max(m, Math.min(x, vw - w - m))}px`;
    tip.style.top = `${Math.max(m, Math.min(y, vh - h - m))}px`;
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
    const quad = (t: Pt, y: number | null, rgb: number): void => {
      const b = pos.length / 3, cc = new THREE.Color(rgb);
      for (const [px, pz] of [[t.x, t.y], [t.x + 1, t.y], [t.x + 1, t.y + 1], [t.x, t.y + 1]] as const) {
        pos.push(px, (y ?? heightAt(g, px, pz)) + 0.16, pz);
        col.push(cc.r, cc.g, cc.b);
      }
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    };
    if (ev.ghost && ev.ok) {
      for (const d of ev.ghost.decks) for (const t of d.tiles) quad(t, d.deck * HEIGHT_UNIT, 0x5ac8ff); // the deck, raised over the water / gap
      for (const t of ev.ghost.marks) quad(t, null, 0xffd060);
      for (const o of ev.ghost.overpasses ?? []) { // ramps + deck: every tile at the real deck profile (blue), the rail tile gold-edged
        for (let j = -o.n; j <= o.n; j++) {
          const t = o.axis === 'h' ? { x: o.x + j, y: o.y } : { x: o.x, y: o.y + j };
          const b = pos.length / 3, cc = new THREE.Color(j === 0 ? 0xffd060 : 0x5ac8ff);
          for (const [px, pz] of [[t.x, t.y], [t.x + 1, t.y], [t.x + 1, t.y + 1], [t.x, t.y + 1]] as const) {
            pos.push(px, overpassAlong(o, o.axis === 'h' ? px - (o.x + 0.5) : pz - (o.y + 0.5)) + 0.2, pz);
            col.push(cc.r, cc.g, cc.b);
          }
          idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
        }
      }
      for (const t of ev.ghost.lifted ?? []) quad(t, (heightAt(g, t.x + 0.5, t.y + 0.5)) + CROSSING.footbridge.deck, 0x5ac8ff); // the raised deck over the rail
    }
    const geo = this.preview.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    this.preview.visible = tiles.length > 0;
    if (this.tip) {
      this.tip.style.display = 'block';
      this.tip.textContent = ev.text;
      this.placeTip(cx, cy);
    }
  }
}

/**
 * Footpath / road / rail: straight or L-shaped drag (R flips the corner). Bridges are part of the stroke (docs/bridges.md): over a pond / lake / gap the
 * footpath gets a footbridge and the road a road bridge automatically (rail refuses); across a rail line the stroke is a level crossing or, with
 * `crossMode = 'bridge'`, a footbridge over the rail (footpaths only: a road always takes the level crossing).
 */
export class SegmentTool extends DragTool {
  readonly group: string;
  /** Rail crossing choice (dock toggle 'Cross rails'). */
  crossMode: CrossMode = 'level';
  constructor(o: DragToolOptions, readonly kind: NetKindId) { super(o); this.group = kind === NetKind.Path ? 'path' : kind === NetKind.Road ? 'road' : 'rail'; }
  startTool(): void { this.begin_(); }
  /** Older name of `crossMode === 'bridge'` (Task 11 'Bridge over rail' toggle). */
  get overRail(): boolean { return this.crossMode === 'bridge'; }
  set overRail(on: boolean) { this.crossMode = on ? 'bridge' : 'level'; }
  private get sk(): 'path' | 'road' | 'rail' { return this.kind === NetKind.Path ? 'path' : this.kind === NetKind.Road ? 'road' : 'rail'; }
  private get mode(): CrossMode { return this.crossMode; }

  protected tiles(): Pt[] {
    return this.start && this.cur ? lineTiles(this.start, this.cur, this.vFirst) : [];
  }
  protected evaluate(tiles: Pt[]): Evaluation {
    const plan = planStroke(this.o.networks, this.o.grid, this.sk, tiles, this.o.multiplier(), this.mode, this.o.suspensionLocked?.() ?? null);
    if (!plan.ok) return { ok: false, cost: 0, text: `Blocked: ${plan.reason}` };
    const extras = describeExtras(plan);
    return { ok: true, cost: plan.cost, text: `Cost: $${Math.round(plan.cost)} (${plan.newTiles.length} tile${plan.newTiles.length === 1 ? '' : 's'}${extras ? ` + ${extras}` : ''})`, ghost: ghostOf(plan) };
  }
  protected commit(tiles: Pt[]): void {
    const plan = planStroke(this.o.networks, this.o.grid, this.sk, tiles, this.o.multiplier(), this.mode, this.o.suspensionLocked?.() ?? null);
    if (plan.ok) buildStroke(this.o.networks, this.sk, plan, this.mode);
  }
}

export class PathTool extends SegmentTool {
  constructor(o: DragToolOptions) { super(o, NetKind.Path); }
}
