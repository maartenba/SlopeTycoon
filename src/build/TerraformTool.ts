import * as THREE from 'three';
import type { Grid } from '@/world/Grid';
import type { PropStore } from '@/world/Props';
import type { Overlays } from '@/render/Overlays';
import { pickHeightfield, type PickResult } from '@/render/Picking';
import {
  cornerBrushRect, flattenRect, raiseLowerRect, smoothRect, tileBrushRect,
  type CornerChange, type TerraformOptions, type TerraformResult, type VRect,
} from '@/world/Terraform';
import { TERRAFORM_BRUSH_MAX, TERRAFORM_DEFAULT_BRUSH, TERRAFORM_DEFAULT_MAX_EDGE_DELTA } from '@/config/balance';

export interface TerrainStroke { stamp(heightRect: { x0: number; y0: number; x1: number; y1: number } | null, propRect: { x0: number; y0: number; x1: number; y1: number }, run: () => { ok: boolean; flow: number }): boolean }

export type TerraformMode = 'raise' | 'lower' | 'flatten' | 'smooth';
export type TerraformTarget = 'tile' | 'corner';

export interface TerraformToolOptions {
  grid: Grid;
  camera: THREE.OrthographicCamera;
  dom: HTMLElement;
  overlays: Overlays;
  props?: PropStore;
  /** Called with the cost before applying; return false to refuse (insufficient funds). */
  charge?: (cost: number) => boolean;
  constructionMultiplier?: () => number;
  /** Lift cable clearance guard (see TerraformOptions.liftClearanceViolations). */
  liftClearanceViolations?: (changed: CornerChange[]) => number;
  /** Called after a successful edit (e.g. to refresh prop layers for touched chunks). */
  onApplied?: (result: TerraformResult) => void;
  /** Shared undo: begin one undo step for a drag. `stamp` wraps each edit (vertex rect + tile rect of the preview, `run` does charge + commit). */
  beginStroke?: () => TerrainStroke;
  /** Live brush preview for the Terrain drawer (null = cursor left the map). */
  onGhost?: (g: { text: string; blocked: boolean; tiles: number } | null) => void;
  onModeChange?: (state: { mode: TerraformMode; brush: number; target: TerraformTarget; maxEdgeDelta: 1 | 2 }) => void;
}

export class TerraformTool {
  mode: TerraformMode = 'raise';
  target: TerraformTarget = 'tile';
  brush = TERRAFORM_DEFAULT_BRUSH;
  maxEdgeDelta: 1 | 2 = TERRAFORM_DEFAULT_MAX_EDGE_DELTA;
  enabled = false;
  private pick: PickResult | null = null;
  private lastKey = '';
  private painting = false;
  private stroke: TerrainStroke | null = null;
  private flatStart: { tx: number; ty: number; h: number } | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly disposers: Array<() => void> = [];

  constructor(private o: TerraformToolOptions) {
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

  enable(): void { this.enabled = true; }
  disable(): void { this.enabled = false; this.cancel(); this.o.overlays.hide(); }
  setMode(m: TerraformMode): void { this.mode = m; this.cancel(); this.emitState(); }
  setTarget(t: TerraformTarget): void { this.target = t; this.emitState(); }
  setMaxEdgeDelta(d: 1 | 2): void { this.maxEdgeDelta = d; this.emitState(); }
  setBrush(n: number): void {
    this.brush = Math.max(1, Math.min(TERRAFORM_BRUSH_MAX, Math.round(n)));
    this.emitState();
  }
  cancel(): void { this.painting = false; this.stroke = null; this.flatStart = null; this.lastKey = ''; }
  dispose(): void { for (const d of this.disposers) d(); }

  private emitState(): void {
    this.o.onModeChange?.({ mode: this.mode, brush: this.brush, target: this.target, maxEdgeDelta: this.maxEdgeDelta });
  }

  private opts(commit: boolean): TerraformOptions {
    return { commit, falloff: true, maxEdgeDelta: this.maxEdgeDelta, props: this.o.props, constructionMultiplier: this.o.constructionMultiplier, liftClearanceViolations: this.o.liftClearanceViolations };
  }

  private rectFor(p: PickResult): VRect {
    const g = this.o.grid;
    return this.target === 'tile'
      ? tileBrushRect(g, p.tileX, p.tileY, this.brush)
      : cornerBrushRect(g, p.vx, p.vy, this.brush);
  }

  private flattenRectFor(a: { tx: number; ty: number }, p: PickResult): VRect {
    return {
      vx0: Math.min(a.tx, p.tileX), vy0: Math.min(a.ty, p.tileY),
      vx1: Math.max(a.tx, p.tileX) + 1, vy1: Math.max(a.ty, p.tileY) + 1,
    };
  }

  private doPick(e: PointerEvent): PickResult | null {
    const r = this.o.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.o.camera);
    return pickHeightfield(this.o.grid, this.ray.ray.origin, this.ray.ray.direction);
  }

  /** Rect + target + delta for the current action at pick p. */
  private run(p: PickResult, commit: boolean): { rect: VRect; res: TerraformResult } {
    const g = this.o.grid;
    if (this.mode === 'flatten') {
      const rect = this.flatStart ? this.flattenRectFor(this.flatStart, p) : this.rectFor(p);
      const h = this.flatStart ? this.flatStart.h : g.getCorner(p.vx, p.vy);
      return { rect, res: flattenRect(g, rect, h, this.opts(commit)) };
    }
    const rect = this.rectFor(p);
    if (this.mode === 'smooth') return { rect, res: smoothRect(g, rect, this.opts(commit)) };
    return { rect, res: raiseLowerRect(g, rect, this.mode === 'raise' ? 1 : -1, this.opts(commit)) };
  }

  private updateHover(p: PickResult | null, e: PointerEvent): void {
    if (!p) { this.o.overlays.hide(); this.o.onGhost?.(null); return; }
    const { rect, res } = this.run(p, false);
    this.o.overlays.setVertexRect(rect.vx0, rect.vy0, rect.vx1, rect.vy1);
    this.o.overlays.setColor(res.reason === 'occupied' || res.reason === 'water' || res.reason === 'lift clearance' ? 0xff4444 : 0xffee55);
    this.o.overlays.setTooltip({
      cost: res.cost, blocked: res.reason === 'occupied' || res.reason === 'water' || res.reason === 'lift clearance', x: e.clientX, y: e.clientY,
      text: res.reason === 'lift clearance' ? 'Blocked: lift clearance' : res.reason === 'water' ? 'Blocked: water' : res.reason === 'occupied' ? 'Blocked: occupied' : res.ok ? `Cost: $${Math.round(res.cost)}` : 'No change',
    });
    if (this.o.onGhost) { const bl = res.reason === 'occupied' || res.reason === 'water' || res.reason === 'lift clearance'; this.o.onGhost({ text: res.reason === 'lift clearance' ? 'Blocked: lift clearance' : res.reason === 'water' ? 'Blocked: water' : res.reason === 'occupied' ? 'Blocked: occupied' : res.ok ? `Cost $${Math.round(res.cost)}` : 'No change', blocked: bl, tiles: Math.max(0, (rect.vx1 - rect.vx0)) * Math.max(0, (rect.vy1 - rect.vy0)) }); }
  }

  /** Ignore when disabled, over UI (event not targeted at canvas). */
  private skip(e: PointerEvent): boolean {
    return !this.enabled || e.target !== this.o.dom;
  }

  private key(p: PickResult): string {
    return this.target === 'tile' ? `${p.tileX},${p.tileY}` : `${p.vx},${p.vy}`;
  }

  private onMove(e: PointerEvent): void {
    if (this.skip(e)) return;
    this.pick = this.doPick(e);
    this.updateHover(this.pick, e);
    if (this.painting && this.pick && this.mode !== 'flatten' && (e.buttons & 1) && !e.altKey) {
      const k = this.key(this.pick);
      if (k !== this.lastKey) { this.lastKey = k; this.apply(this.pick); }
    }
  }

  private onDown(e: PointerEvent): void {
    if (this.skip(e) || e.button !== 0 || e.altKey) return;
    const p = this.doPick(e);
    if (!p) return;
    this.pick = p;
    this.painting = true;
    this.stroke = this.o.beginStroke?.() ?? null;
    if (this.mode === 'flatten') {
      this.flatStart = { tx: p.tileX, ty: p.tileY, h: this.o.grid.getCorner(p.vx, p.vy) };
      this.updateHover(p, e);
    } else {
      this.lastKey = this.key(p);
      this.apply(p);
    }
  }

  private onUp(e: PointerEvent): void {
    if (!this.painting || e.button !== 0) return;
    if (this.mode === 'flatten' && this.flatStart) {
      const p = this.doPick(e) ?? this.pick;
      if (p) this.apply(p);
    }
    this.cancel();
  }

  private onKey(e: KeyboardEvent): void {
    const t = ((e.composedPath?.()[0] as HTMLElement | undefined) ?? e.target) as HTMLElement | null; // the real target: events from inputs inside a shadow root are retargeted to the host
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!this.enabled) return;
    switch (e.key) {
      case '1': this.setMode('raise'); break;
      case '2': this.setMode('lower'); break;
      case '3': this.setMode('flatten'); break;
      case '4': this.setMode('smooth'); break;
      case '[': this.setBrush(this.brush - 1); break;
      case ']': this.setBrush(this.brush + 1); break;
      case 'c': case 'C': this.setTarget(this.target === 'tile' ? 'corner' : 'tile'); break;
      case 'Escape': this.cancel(); this.o.overlays.hide(); break;
    }
  }

  private apply(p: PickResult): void {
    const preview = this.run(p, false).res;
    if (!preview.ok) return;
    const doIt = (): { ok: boolean; flow: number } => {
      if (this.o.charge && !this.o.charge(preview.cost)) return { ok: false, flow: 0 };
      const out = this.run(p, true).res;
      if (out.ok) this.o.onApplied?.(out);
      return { ok: out.ok, flow: out.ok ? preview.cost : 0 };
    };
    if (!this.stroke) { doIt(); return; }
    // vertex bbox of what the edit will move (the preview already includes the edge-delta ripple), props are cleared one tile beyond
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of preview.changed) { x0 = Math.min(x0, c.vx); y0 = Math.min(y0, c.vy); x1 = Math.max(x1, c.vx); y1 = Math.max(y1, c.vy); }
    const g = this.o.grid;
    this.stroke.stamp({ x0, y0, x1, y1 }, { x0: Math.max(0, x0 - 1), y0: Math.max(0, y0 - 1), x1: Math.min(g.size - 1, x1), y1: Math.min(g.size - 1, y1) }, doIt);
  }
}
