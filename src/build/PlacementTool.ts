import * as THREE from 'three';
import { type Grid } from '../world/Grid';
import { HEIGHT_UNIT } from '../config/balance';
import type { PropStore } from '../world/Props';
import { autoFlattenDefault, autoFlattenPolicy } from '../sim/PlacementRules';
import { footprintOf } from '../sim/Buildings';
import { pickHeightfield, type PickResult } from '../render/Picking';
import type { BuildingMeshes } from '../render/meshes';
import type { Overlays } from '../render/Overlays';

import { baseHeight, EDGE_MARGIN, validatePlacement, placeBuilding, anchorFor, type PlacementEnv, type PlacementCheck, type PlaceOutcome } from '../sim/PlaceBuilding';
export { baseHeight, EDGE_MARGIN, validatePlacement, placeBuilding, anchorFor };
export type { PlacementEnv, PlacementCheck, PlaceOutcome };

/** Position a mesh group (origin = footprint centre) on terrain, foundation reaching the lowest corner. */
export function positionMesh(g: THREE.Group, grid: Grid, b: { x: number; y: number; w: number; h: number; rot: number }): void {
  g.position.set(b.x + b.w / 2, baseHeight(grid, b.x, b.y, b.w, b.h), b.y + b.h / 2);
  g.rotation.y = -(b.rot % 4) * (Math.PI / 2);
}

export interface GhostLine { kind: 'error' | 'warn' | 'info' | 'ok'; text: string }

const REASON_HINTS: Record<string, string> = {
  'Tile occupied': 'pick a free spot',
  'Cannot build on water': 'pick dry land',
  'Cannot build on a stream': 'streams cannot be built on',
  'Cannot build on a road, path or rail': 'build beside the road, not on it',
  'Blocked by a lift line': 'keep clear of lift lines',
  'Cannot build on bare rock': 'try grass or forest',
  'Cannot build on a piste': 'build beside the piste instead',
  'Too close to the map edge': 'move away from the map edge',
};

/** Ghost tooltip content: every blocking reason with its hint, then warnings (amber, non-blocking), then neutral notes. */
export function ghostLines(chk: PlacementCheck): GhostLine[] {
  const out: GhostLine[] = [];
  if (chk.ok) out.push({ kind: 'ok', text: `Cost: $${Math.round(chk.cost + chk.flattenCost)}${chk.flatten ? ' (incl. levelling)' : ''}` });
  else {
    for (const r of chk.reasons) {
      const h = chk.hintFor[r] ?? REASON_HINTS[r];
      out.push({ kind: 'error', text: h ? `${r} \u2014 ${h}` : r });
    }
  }
  for (const w of chk.warnings) out.push({ kind: 'warn', text: `${w} (will be inactive)` });
  for (const i of chk.info) out.push({ kind: 'info', text: i });
  return out;
}

export interface PlacementToolOptions {
  env: PlacementEnv;
  props?: PropStore;
  meshes: BuildingMeshes;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  dom: HTMLElement;
  overlays: Overlays;
  /** Replaces `placeBuilding` (main wires the undo recorder in here). */
  place?(type: string, x: number, y: number, rot: number, autoFlatten: boolean): PlaceOutcome;
  onPlaced(out: PlaceOutcome): void;
  onError(msg: string): void;
  onCancel(): void;
  onState?(s: { type: string | null; rot: number; autoFlatten: boolean; reasons: string[]; flattenPolicy?: 'default' | 'optional' | 'never' }): void;
}

export class PlacementTool {
  type: string | null = null;
  rot = 0;
  autoFlatten = false;
  private ghost: THREE.Group | null = null;
  private ghostMats: THREE.Material[] = [];
  private pick: PickResult | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly disposers: Array<() => void> = [];
  private lastReasons: string[] = [];
  private lastChk: PlacementCheck | null = null;

  constructor(private o: PlacementToolOptions) {
    const on = (el: HTMLElement | Window, t: string, fn: (e: never) => void): void => {
      el.addEventListener(t, fn as EventListener);
      this.disposers.push(() => el.removeEventListener(t, fn as EventListener));
    };
    on(o.dom, 'pointermove', (e: PointerEvent) => this.onMove(e));
    on(o.dom, 'pointerdown', (e: PointerEvent) => this.onDown(e));
    on(o.dom, 'contextmenu', (e: Event) => { if (this.type) { e.preventDefault(); this.cancel(); } });
    on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e));
  }

  get active(): boolean { return this.type !== null; }

  /** Current ghost check summary (null when nothing is being placed / no ghost on the map). */
  ghostInfo(): { valid: boolean; reasons: string[]; hints: string[]; warnings: string[]; info: string[]; trees: number; flattenCost: number; totalCost: number } | null {
    const c = this.type ? this.lastChk : null;
    return c ? { valid: c.ok, reasons: [...c.reasons], hints: [...c.hints], warnings: [...c.warnings], info: [...c.info], trees: c.trees, flattenCost: c.flatten ? c.flattenCost : 0, totalCost: c.cost + c.flattenCost } : null;
  }

  start(type: string): void {
    this.clearGhost();
    this.type = type;
    this.rot = 0;
    this.autoFlatten = autoFlattenDefault(type);
    const g = this.o.meshes.create(type);
    // Clone materials so tinting the ghost does not touch placed buildings.
    this.ghostMats = [];
    g.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = (mesh.material as THREE.Material).clone() as THREE.MeshLambertMaterial;
        mat.transparent = true; mat.opacity = 0.7;
        mesh.material = mat;
        this.ghostMats.push(mat);
      }
    });
    g.visible = false;
    this.ghost = g;
    this.o.scene.add(g);
    this.emit();
  }

  cancel(): void {
    if (!this.type) return;
    this.type = null;
    this.clearGhost();
    this.o.overlays.hide();
    this.emit();
    this.o.onCancel();
  }

  setAutoFlatten(v: boolean): void { this.autoFlatten = v && (this.type ? autoFlattenPolicy(this.type) !== 'never' : true); this.refresh(this.lastPtr ?? undefined); this.emit(); }
  /** Quarter turn (+1 clockwise, -1 counter-clockwise). Keeps the tooltip at the last pointer position. */
  rotate(dir: 1 | -1 = 1): void { if (!this.type) return; this.rot = (this.rot + dir + 4) % 4; this.refresh(this.lastPtr ?? undefined); this.emit(); }
  private lastPtr: { clientX: number; clientY: number } | null = null;
  dispose(): void { this.clearGhost(); for (const d of this.disposers) d(); }

  private emit(): void {
    this.o.onState?.({ type: this.type, rot: this.rot, autoFlatten: this.autoFlatten, reasons: this.lastReasons, flattenPolicy: this.type ? autoFlattenPolicy(this.type) : undefined });
  }

  private clearGhost(): void {
    if (this.ghost) this.o.scene.remove(this.ghost);
    for (const m of this.ghostMats) m.dispose();
    this.ghostMats = [];
    this.ghost = null;
  }

  private doPick(e: PointerEvent): PickResult | null {
    const r = this.o.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.o.camera);
    return pickHeightfield(this.o.env.grid, this.ray.ray.origin, this.ray.ray.direction);
  }

  private refresh(e?: { clientX: number; clientY: number }): PlacementCheck | null {
    const type = this.type, p = this.pick, ghost = this.ghost;
    if (!type || !ghost) return null;
    if (!p) { this.lastChk = null; ghost.visible = false; this.o.overlays.hide(); return null; }
    const { x, y } = anchorFor(type, this.rot, p.tileX, p.tileY);
    const { w, h } = footprintOf(type, this.rot);
    const clampX = Math.max(0, Math.min(this.o.env.grid.size - w, x));
    const clampY = Math.max(0, Math.min(this.o.env.grid.size - h, y));
    const chk = validatePlacement(this.o.env, type, clampX, clampY, this.rot, this.autoFlatten);
    positionMesh(ghost, this.o.env.grid, { x: clampX, y: clampY, w, h, rot: this.rot });
    if (chk.flattenPlan) ghost.position.y = chk.flattenPlan.base * HEIGHT_UNIT; // show the building on the levelled pad
    ghost.visible = true;
    // Red = blocked, amber = placeable with a warning (e.g. inactive without access), green = fine.
    const color = !chk.ok ? 0xff5555 : chk.warnings.length ? 0xffbb33 : 0x66ff66;
    const glow = !chk.ok ? 0x551111 : chk.warnings.length ? 0x553a0a : 0x114411;
    for (const m of this.ghostMats) (m as THREE.MeshLambertMaterial).emissive?.setHex(glow);
    // Outline = the real footprint; the levelled area (cut & fill) is a separate faint preview.
    this.o.overlays.setVertexRect(clampX, clampY, clampX + w, clampY + h);
    this.o.overlays.setColor(color);
    this.o.overlays.setTerraformPreview(chk.flattenPlan?.changes ?? null, color);
    const lines = ghostLines(chk);
    const text = lines.map((l) => (l.kind === 'error' ? '\u2716 ' : l.kind === 'warn' ? '\u26a0 ' : '')+ l.text).join(' \u00b7 ') + ' \u00b7 R: rotate';
    this.o.overlays.setTooltip({ cost: chk.cost + chk.flattenCost, blocked: !chk.ok, text, lines, x: e?.clientX ?? 0, y: e?.clientY ?? 0 });
    this.lastReasons = chk.reasons;
    this.lastChk = chk;
    this.lastAt = { x: clampX, y: clampY };
    return chk;
  }

  private lastAt = { x: 0, y: 0 };

  private onMove(e: PointerEvent): void {
    if (!this.type || e.target !== this.o.dom) return;
    this.pick = this.doPick(e);
    this.lastPtr = { clientX: e.clientX, clientY: e.clientY };
    this.refresh(e);
  }

  private onDown(e: PointerEvent): void {
    if (!this.type || e.button !== 0 || e.target !== this.o.dom) return;
    this.pick = this.doPick(e);
    this.commit(this.refresh(e), e.shiftKey, e);
  }

  /** Touch: place at the ghost's current spot (the Confirm button of the two-step placement; docs/touch.md). False when there is no valid ghost. */
  confirm(): boolean {
    if (!this.type || !this.ghost?.visible || !this.lastChk) return false;
    this.commit(this.lastChk, false, this.lastPtr ?? undefined);
    return true;
  }

  private commit(chk: PlacementCheck | null, several: boolean, e?: { clientX: number; clientY: number }): void {
    if (!chk || !this.type) return;
    const type = this.type;
    const out = this.o.place ? this.o.place(type, this.lastAt.x, this.lastAt.y, this.rot, this.autoFlatten) : placeBuilding(this.o.env, this.o.props, type, this.lastAt.x, this.lastAt.y, this.rot, this.autoFlatten);
    if (!out.ok) { this.o.onError(out.reasons.join(', ')); return; }
    this.o.onPlaced(out);
    if (several) this.refresh(e);
    else this.cancel();
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!this.type) return;
    if (e.key === 'r' || e.key === 'R') this.rotate(e.shiftKey ? -1 : 1);
    else if (e.key === 'f' || e.key === 'F') this.setAutoFlatten(!this.autoFlatten);
    else if (e.key === 'Escape') this.cancel();
  }
}
