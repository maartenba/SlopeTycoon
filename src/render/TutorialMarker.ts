import * as THREE from 'three';
import type { MapMark } from '../tutorial/TutorialEngine';

type Pt = { x: number; y: number };
type Ground = (x: number, y: number) => number;

const LIFT = 0.12;

/** Vertex/index data for a ribbon along a polyline of (x, y) tile coordinates, draped on the terrain via `ground`. Pure (testable without WebGL). */
export function ribbon(points: readonly Pt[], width: number, ground: Ground, lift = LIFT): { pos: number[]; idx: number[] } {
  const pos: number[] = [], idx: number[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)]!, b = points[Math.min(n - 1, i + 1)]!;
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy * width * 0.5, ny = dx * width * 0.5, p = points[i]!;
    pos.push(p.x + nx, ground(p.x + nx, p.y + ny) + lift, p.y + ny, p.x - nx, ground(p.x - nx, p.y - ny) + lift, p.y - ny);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  return { pos, idx };
}

/** Closed outline of a tile rect (grown by `pad`), sampled about every half tile. */
export function outline(r: { x: number; y: number; w: number; h: number }, pad = 0.25): Pt[] {
  const x0 = r.x - pad, y0 = r.y - pad, x1 = r.x + r.w + pad, y1 = r.y + r.h + pad;
  const pts: Pt[] = [];
  const edge = (ax: number, ay: number, bx: number, by: number): void => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    for (let i = 0; i < steps; i++) pts.push({ x: ax + ((bx - ax) * i) / steps, y: ay + ((by - ay) * i) / steps });
  };
  edge(x0, y0, x1, y0); edge(x1, y0, x1, y1); edge(x1, y1, x0, y1); edge(x0, y1, x0, y0);
  pts.push({ ...pts[0]! });
  return pts;
}

/** Geometry for a whole mark: outline of the rect, optional second rect, optional route line and a downward arrow above the target. */
export function markGeometry(mark: MapMark, ground: Ground): { pos: Float32Array; idx: Uint32Array } {
  const pos: number[] = [], idx: number[] = [];
  const add = (g: { pos: number[]; idx: number[] }): void => { const base = pos.length / 3; pos.push(...g.pos); for (const i of g.idx) idx.push(base + i); };
  add(ribbon(outline(mark), 0.28, ground));
  if (mark.extra) add(ribbon(outline(mark.extra), 0.28, ground));
  if (mark.line && mark.line.length > 1) add(ribbon(mark.line.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 })), 0.4, ground, LIFT + 0.02));
  // arrow: a 4-sided pyramid pointing down at the centre of the mark
  const cx = mark.x + mark.w / 2, cy = mark.y + mark.h / 2, tip = ground(cx, cy) + 0.6, top = tip + 1.6, r = 0.55;
  const base = pos.length / 3;
  pos.push(cx, tip, cy, cx - r, top, cy - r, cx + r, top, cy - r, cx + r, top, cy + r, cx - r, top, cy + r);
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 3, base + 4, base, base + 4, base + 1);
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

/** A pulsing highlight (outline ring + route ribbon + arrow) draped on the terrain at a tutorial target: ONE mesh, one draw call. */
export class TutorialMarker {
  readonly mesh: THREE.Mesh;
  private mark: MapMark | null = null;
  constructor(private readonly ground: Ground) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.visible = false;
    this.mesh.renderOrder = 12;
    this.mesh.frustumCulled = false;
  }

  get visible(): boolean { return this.mesh.visible; }
  get current(): MapMark | null { return this.mark; }

  /** Show the marker for `mark` (null hides it). Re-uses the geometry object; rebuilds attributes only when the mark changes. */
  set(mark: MapMark | null): void {
    const same = mark && this.mark && JSON.stringify(mark) === JSON.stringify(this.mark);
    if (same) return;
    this.mark = mark;
    if (!mark) { this.mesh.visible = false; return; }
    const g = markGeometry(mark, this.ground);
    const geo = this.mesh.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
    geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
    geo.computeBoundingSphere();
    (this.mesh.material as THREE.MeshBasicMaterial).color.setHex(mark.ok ? 0xffd23f : 0xff6a5a);
    this.mesh.visible = true;
  }

  /** Pulse (call per frame with seconds). */
  update(timeSec: number): void {
    if (!this.mesh.visible) return;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(timeSec * 4);
  }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
