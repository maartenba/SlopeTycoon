import * as THREE from 'three';
import type { Grid } from '@/world/Grid';
import type { PropStore } from '@/world/Props';
import type { Overlays } from '@/render/Overlays';
import { pickHeightfield, type PickResult } from '@/render/Picking';
import {
  PLANT, PLANT_GROUPS, PLANT_GROUP_IDS, applyClearing, applyPlanting, planClearing, planPlanting,
  type PlantEnv, type PlantGroup,
} from '@/sim/nature/Planting';

export type PlantMode = 'plant' | 'clear';
export interface PlantState { mode: PlantMode; group: PlantGroup; brush: number; density: number }

export interface PlantToolOptions {
  grid: Grid;
  props: PropStore;
  camera: THREE.OrthographicCamera;
  dom: HTMLElement;
  overlays: Overlays;
  /** Placement rules environment (blocked tiles etc.). */
  env: () => PlantEnv;
  /** Absolute game day (growth timeline). */
  now: () => number;
  charge: (cost: number) => boolean;
  earn?: (amount: number) => void;
  multiplier?: () => number;
  /** Chunk indices whose props changed (refreshChunks hook). */
  onApplied: (chunks: number[], info: { planted: number; cleared: number }) => void;
  onState?: (s: PlantState) => void;
}

/** Terrain-drawer tool 'plant': paint saplings (species group, brush, density) or clear trees. Keys: 1 plant, 2 clear, [ ] brush, G cycle species. */
export class PlantTool {
  mode: PlantMode = 'plant';
  group: PlantGroup = 'conifer';
  brush = 2;
  density = 0.6;
  enabled = false;
  private painting = false;
  private lastKey = '';
  private readonly ray = new THREE.Raycaster();
  private readonly disposers: Array<() => void> = [];

  constructor(private o: PlantToolOptions) {
    const on = (el: HTMLElement | Window, t: string, fn: (e: never) => void): void => {
      el.addEventListener(t, fn as EventListener);
      this.disposers.push(() => el.removeEventListener(t, fn as EventListener));
    };
    on(o.dom, 'pointermove', (e: PointerEvent) => this.onMove(e));
    on(o.dom, 'pointerdown', (e: PointerEvent) => this.onDown(e));
    on(window, 'pointerup', () => { this.painting = false; this.lastKey = ''; });
    on(o.dom, 'pointerleave', () => { if (!this.painting) this.o.overlays.hide(); });
    on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e));
  }

  state(): PlantState { return { mode: this.mode, group: this.group, brush: this.brush, density: this.density }; }
  private emit(): void { this.o.onState?.(this.state()); }
  enable(): void { this.enabled = true; this.emit(); }
  disable(): void { this.enabled = false; this.painting = false; this.o.overlays.hide(); }
  setMode(m: PlantMode): void { this.mode = m; this.emit(); }
  setGroup(g: PlantGroup): void { this.group = g; this.emit(); }
  setBrush(n: number): void { this.brush = Math.max(1, Math.min(PLANT.maxBrush, Math.round(n))); this.emit(); }
  setDensity(d: number): void { this.density = Math.max(0.1, Math.min(1, d)); this.emit(); }
  cycleGroup(): void { this.setGroup(PLANT_GROUP_IDS[(PLANT_GROUP_IDS.indexOf(this.group) + 1) % PLANT_GROUP_IDS.length]!); }
  dispose(): void { for (const d of this.disposers) d(); }

  private pickAt(e: PointerEvent): PickResult | null {
    const r = this.o.dom.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.o.camera);
    return pickHeightfield(this.o.grid, this.ray.ray.origin, this.ray.ray.direction);
  }

  private mult(): number { return this.o.multiplier?.() ?? 1; }

  private preview(p: PickResult): { cost: number; text: string; ok: boolean } {
    if (this.mode === 'plant') {
      const plan = planPlanting(this.o.env(), p.tileX, p.tileY, this.brush, this.group, this.density, this.o.now());
      const cost = Math.round(plan.cost * this.mult());
      if (plan.trees.length === 0) return { cost: 0, ok: false, text: plan.liftBlocked ? 'Blocked: trees would grow into a lift cable (keep the lift line clear)' : plan.rejected > 0 ? 'Blocked: slope, water, rock, piste or building' : 'Already full' };
      return { cost, ok: true, text: `Plant ${plan.trees.length} ${PLANT_GROUPS[this.group].label.toLowerCase()} · $${cost}` };
    }
    const c = planClearing(this.o.props, p.tileX, p.tileY, this.brush, this.o.now());
    if (c.count === 0) return { cost: 0, ok: false, text: 'Nothing to clear' };
    const cost = Math.round(c.cost * this.mult());
    return { cost, ok: true, text: `Clear ${c.count} trees · $${cost}${c.revenue ? ` (timber +$${c.revenue})` : ''}` };
  }

  private hover(p: PickResult | null, e: PointerEvent): void {
    if (!p) { this.o.overlays.hide(); return; }
    const r = Math.max(1, this.brush) - 1;
    this.o.overlays.setVertexRect(p.tileX - r, p.tileY - r, p.tileX + r + 1, p.tileY + r + 1);
    const pv = this.preview(p);
    this.o.overlays.setColor(this.mode === 'clear' ? 0xff9944 : pv.ok ? 0x66dd66 : 0xff4444);
    this.o.overlays.setTooltip({ cost: pv.cost, blocked: !pv.ok, x: e.clientX, y: e.clientY, text: pv.text });
  }

  private skip(e: PointerEvent): boolean { return !this.enabled || e.target !== this.o.dom; }

  private onMove(e: PointerEvent): void {
    if (this.skip(e)) return;
    const p = this.pickAt(e);
    this.hover(p, e);
    if (this.painting && p && (e.buttons & 1) && !e.altKey) {
      const k = `${p.tileX},${p.tileY}`;
      if (k !== this.lastKey) { this.lastKey = k; this.apply(p); }
    }
  }

  private onDown(e: PointerEvent): void {
    if (this.skip(e) || e.button !== 0 || e.altKey) return;
    const p = this.pickAt(e);
    if (!p) return;
    this.painting = true; this.lastKey = `${p.tileX},${p.tileY}`;
    this.apply(p);
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!this.enabled) return;
    switch (e.key) {
      case '1': this.setMode('plant'); break;
      case '2': this.setMode('clear'); break;
      case '[': this.setBrush(this.brush - 1); break;
      case ']': this.setBrush(this.brush + 1); break;
      case 'g': case 'G': this.cycleGroup(); break;
      case 'Escape': this.painting = false; this.o.overlays.hide(); break;
    }
  }

  private apply(p: PickResult): void {
    const now = this.o.now();
    if (this.mode === 'plant') {
      const plan = planPlanting(this.o.env(), p.tileX, p.tileY, this.brush, this.group, this.density, now);
      if (!plan.trees.length) return;
      if (!this.o.charge(Math.round(plan.cost * this.mult()))) return;
      this.o.onApplied(applyPlanting(this.o.props, plan, now), { planted: plan.trees.length, cleared: 0 });
    } else {
      const c = planClearing(this.o.props, p.tileX, p.tileY, this.brush, now);
      if (!c.count) return;
      if (!this.o.charge(Math.round(c.cost * this.mult()))) return;
      if (c.revenue) this.o.earn?.(c.revenue);
      this.o.onApplied(applyClearing(this.o.props, p.tileX, p.tileY, this.brush), { planted: 0, cleared: c.count });
    }
  }
}

