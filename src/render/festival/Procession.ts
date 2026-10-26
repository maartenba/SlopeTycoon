import * as THREE from 'three';
import { createCostumeFigureGeometry, createDecoratedCowGeometry, createRacerGeometry } from '../meshes/Animals';
import { renderRng } from '../fx/Particles';
import type { Pt } from './placeDressing';

export type ProcessionKind = 'cow' | 'costume' | 'racer';

/** Tiles per second walked on screen, per kind (cows amble, revellers stroll, racers fly down the piste). */
export const PROCESSION_SPEED: Record<ProcessionKind, number> = { cow: 0.32, costume: 0.45, racer: 2.2 };
/** Visual scale per kind (cows and people are tiny at the default zoom). */
export const PROCESSION_SCALE: Record<ProcessionKind, number> = { cow: 1.6, costume: 1.15, racer: 1.5 };
/** Game hours the procession walks (daytime only). */
export const PROCESSION_HOURS = { from: 9, to: 17 } as const;
export const PROCESSION_CAP = 16;

export const processionActive = (hour: number): boolean => hour >= PROCESSION_HOURS.from && hour < PROCESSION_HOURS.to;

/** Pure: pose (x, y, heading) at arc length `s` along a polyline `loop`. `closed` wraps the loop (last point -> first). */
export function loopPose(loop: readonly Pt[], s: number, closed: boolean, out: { x: number; y: number; heading: number } = { x: 0, y: 0, heading: 0 }): { x: number; y: number; heading: number } {
  const n = loop.length;
  if (n === 0) { out.x = 0; out.y = 0; out.heading = 0; return out; }
  if (n === 1) { out.x = loop[0]!.x; out.y = loop[0]!.y; out.heading = 0; return out; }
  const segs = closed ? n : n - 1;
  let total = 0;
  for (let i = 0; i < segs; i++) { const a = loop[i]!, b = loop[(i + 1) % n]!; total += Math.hypot(b.x - a.x, b.y - a.y); }
  let d = total > 0 ? ((s % total) + total) % total : 0;
  for (let i = 0; i < segs; i++) {
    const a = loop[i]!, b = loop[(i + 1) % n]!, l = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= l || i === segs - 1) {
      const t = l > 0 ? Math.min(1, d / l) : 0;
      out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.heading = Math.atan2(b.x - a.x, b.y - a.y);
      return out;
    }
    d -= l;
  }
  return out;
}
export function loopLength(loop: readonly Pt[], closed: boolean): number {
  let t = 0;
  for (let i = 0; i < (closed ? loop.length : loop.length - 1); i++) { const a = loop[i]!, b = loop[(i + 1) % loop.length]!; t += Math.hypot(b.x - a.x, b.y - a.y); }
  return t;
}

/**
 * Cosmetic figures walking a loop along the dressed road: decorated cows (Almabtrieb), costumed revellers (Carnival), racers on the black piste
 * (World Cup). One InstancedMesh per kind; only the kind in use has instances, so a procession costs ONE draw call. Render RNG only; never sim state.
 */
export class Procession {
  readonly group = new THREE.Group();
  private meshes: Record<ProcessionKind, THREE.InstancedMesh>;
  private kind: ProcessionKind | null = null;
  private loop: Pt[] = [];
  private figures = 0;
  private offs: number[] = [];
  private time = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private up = new THREE.Vector3(0, 1, 0); private p = new THREE.Vector3(); private sc = new THREE.Vector3();
  private pose = { x: 0, y: 0, heading: 0 };
  /** Figures drawn last frame (tests / harness). */
  drawn = 0;

  constructor(private ground: (x: number, z: number) => number) {
    const mk = (g: THREE.BufferGeometry, name: string): THREE.InstancedMesh => {
      const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }), PROCESSION_CAP);
      m.count = 0; m.frustumCulled = false; m.visible = false; m.name = `procession:${name}`;
      this.group.add(m);
      return m;
    };
    this.meshes = { cow: mk(createDecoratedCowGeometry(), 'cow'), costume: mk(createCostumeFigureGeometry(), 'costume'), racer: mk(createRacerGeometry(), 'racer') };
    this.group.name = 'procession';
  }

  /** Set the procession (or none: kind null). Figures are spaced evenly along the loop with a little render-random jitter. */
  set(kind: ProcessionKind | null, loop: readonly Pt[], figures: number, seed = 1): void {
    this.kind = kind; this.loop = [...loop]; this.figures = kind ? Math.min(PROCESSION_CAP, figures) : 0;
    const r = renderRng(seed ^ 0x51ed);
    this.offs = Array.from({ length: this.figures }, (_, i) => (i + (r() - 0.5) * 0.5) / Math.max(1, this.figures));
    if (!kind || !this.loop.length) { this.figures = 0; this.hide(); }
  }

  private hide(): void { for (const m of Object.values(this.meshes)) { m.count = 0; m.visible = false; } this.drawn = 0; }

  update(dt: number, hour: number): void {
    this.time += dt;
    const kind = this.kind;
    if (!kind || !this.figures || !processionActive(hour)) { this.hide(); return; }
    const closed = kind !== 'racer', total = loopLength(this.loop, closed);
    if (total <= 0) { this.hide(); return; }
    const mesh = this.meshes[kind], k = PROCESSION_SCALE[kind], v = PROCESSION_SPEED[kind];
    for (let i = 0; i < this.figures; i++) {
      const s = this.offs[i]! * total + this.time * v;
      loopPose(this.loop, s, closed, this.pose);
      const gait = this.time * (kind === 'racer' ? 0 : 7) + i * 1.7;
      const bob = kind === 'racer' ? 0 : Math.abs(Math.sin(gait)) * 0.035;
      this.q.setFromAxisAngle(this.up, this.pose.heading);
      this.m.compose(this.p.set(this.pose.x, this.ground(this.pose.x, this.pose.y) + bob, this.pose.y), this.q, this.sc.set(k, k, k));
      mesh.setMatrixAt(i, this.m);
    }
    mesh.count = this.figures; mesh.visible = true; mesh.instanceMatrix.needsUpdate = true;
    for (const [kd, m] of Object.entries(this.meshes) as Array<[ProcessionKind, THREE.InstancedMesh]>) if (kd !== kind) { m.count = 0; m.visible = false; }
    this.drawn = this.figures;
  }

  dispose(): void { for (const m of Object.values(this.meshes)) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }
}
