import * as THREE from 'three';

/** Visual-only snapshot of one attraction (derived from sim state; tile coordinates). */
export interface ActivityView {
  id: number; type: string; x: number; y: number; w: number; h: number;
  /** Guests currently in service. */
  users: number;
  open: boolean;
  /** Lake tiles near the building (boats sail between them). */
  lake?: Array<{ x: number; y: number }>;
  /** Tackle hut: the fishing places (pier / bank / ice) with the cast direction (sim `AnglingPlan.spots`). */
  spots?: ReadonlyArray<{ x: number; y: number; kind: 'pier' | 'bank' | 'ice'; heading: number }>;
}

export type PropKind = 'figure' | 'boat' | 'umbrella' | 'rod' | 'bobber' | 'hole' | 'stool';
export interface Pose { kind: PropKind; x: number; y: number; heading: number; seed: number }

export const ACTIVITY_FAR_VIEW_HEIGHT = 70;
export const MAX_FIGURES_PER_ATTRACTION = 12;
export const MAX_BOATS = 8;
/** Anglers drawn per tackle hut (the sim may seat more). */
export const MAX_ANGLERS = 12;

const hash = (n: number): number => ((Math.imul(n + 1, 2654435761) >>> 0) % 1000) / 1000;

/**
 * Deterministic prop poses for one attraction at simulation time `t` (ticks, fractional). Pure: same view + t => same poses.
 * Returns the number of poses written to `out`.
 */
export function activityPoses(v: ActivityView, t: number, out: Pose[]): number {
  out.length = 0;
  if (!v.open || v.users <= 0) return 0;
  const n = Math.min(v.users, MAX_FIGURES_PER_ATTRACTION);
  const cx = v.x + v.w / 2, cy = v.y + v.h / 2, rx = Math.max(0.3, v.w / 2 - 0.5), ry = Math.max(0.3, v.h / 2 - 0.5);
  const push = (kind: PropKind, x: number, y: number, heading: number, seed: number): void => { out.push({ kind, x, y, heading, seed }); };
  switch (v.type) {
    case 'iceRink': // skaters circle counter-clockwise at slightly different speeds
      for (let i = 0; i < n; i++) {
        const a = t * (0.07 + 0.012 * (i % 3)) + (i * Math.PI * 2) / n, k = 0.55 + 0.4 * hash(v.id * 31 + i);
        push('figure', cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k, a + Math.PI / 2, i);
      }
      break;
    case 'boatRental': {
      const nb = Math.min(v.users, MAX_BOATS), lake = v.lake ?? [];
      for (let i = 0; i < nb; i++) {
        if (lake.length >= 2) {
          const p = t * 0.02 + i * 1.7, k = Math.floor(p), f = p - k;
          const a = lake[(k + i * 3) % lake.length]!, b = lake[(k + i * 3 + 1) % lake.length]!;
          push('boat', a.x + 0.5 + (b.x - a.x) * f, a.y + 0.5 + (b.y - a.y) * f, Math.atan2(b.y - a.y, b.x - a.x), i);
        } else {
          const a = t * 0.03 + i; push('boat', cx + Math.cos(a) * (v.w + 1), cy + Math.sin(a) * (v.h + 1), a, i);
        }
      }
      break;
    }
    case 'beach': // sunbathers lie on towels under umbrellas, swimmers paddle at the water edge
      for (let i = 0; i < n; i++) {
        const x = v.x + 0.4 + hash(v.id * 17 + i) * (v.w - 0.8), y = v.y + 0.4 + hash(v.id * 29 + i) * (v.h - 0.8);
        const swim = i % 3 === 0;
        push('figure', swim ? x + Math.sin(t * 0.1 + i) * 0.15 : x, y, 0, i);
        if (i % 4 === 0) push('umbrella', x + 0.25, y, 0, i);
      }
      break;
    case 'playground': case 'kidsGround': // kids dart around small loops
      for (let i = 0; i < n; i++) {
        const bx = v.x + 0.5 + hash(v.id * 13 + i) * (v.w - 1), by = v.y + 0.5 + hash(v.id * 7 + i) * (v.h - 1), a = t * 0.12 + i * 2.1;
        push('figure', bx + Math.cos(a) * 0.35, by + Math.sin(a) * 0.35, a, i);
      }
      break;
    case 'stuntPark': case 'adventurePark': case 'magicCarpet': { // riders move along the long axis
      const horiz = v.w >= v.h;
      for (let i = 0; i < n; i++) {
        const p = (t * 0.03 * (1 + 0.1 * (i % 4)) + i / n) % 1;
        const u = (p < 0.5 ? p * 2 : 2 - p * 2), side = 0.5 + 0.8 * hash(v.id * 5 + i);
        const x = horiz ? v.x + 0.5 + u * (v.w - 1) : v.x + side * (v.w - 0.5), y = horiz ? v.y + side * (v.h - 0.5) : v.y + 0.5 + u * (v.h - 1);
        push('figure', x, y, horiz ? (p < 0.5 ? 0 : Math.PI) : (p < 0.5 ? Math.PI / 2 : -Math.PI / 2), i);
      }
      break;
    }
    case 'tackleHut': { // anglers stand at their place facing the water: a rod, a bobber that bobs on the water, on the ice a hole and a stool (view only)
      const spots = v.spots ?? [], na = Math.min(v.users, spots.length, MAX_ANGLERS);
      for (let i = 0; i < na; i++) {
        const sp = spots[i]!, dx = Math.cos(sp.heading), dy = Math.sin(sp.heading);
        push('figure', sp.x, sp.y, sp.heading, i);
        push('rod', sp.x, sp.y, sp.heading, i);
        if (sp.kind === 'ice') { push('hole', sp.x + dx * 0.32, sp.y + dy * 0.32, 0, i); push('stool', sp.x - dx * 0.2, sp.y - dy * 0.2, 0, i); }
        else push('bobber', sp.x + dx * 0.85, sp.y + dy * 0.85, 0, i); // bobbing is applied at draw time from the tick
      }
      break;
    }
    default: return 0;
  }
  return out.length;
}

const FIGURE_CAP = 480, BOAT_CAP = 64, UMBRELLA_CAP = 64, ANGLER_CAP = 96;

/**
 * Cheap instanced props for attraction activity: figures, boats and umbrellas = 3 draw calls total. Hidden when zoomed far out.
 * Positions are a pure function of the sim tick + attraction state (no per-frame random).
 */
export class AttractionActivity {
  readonly group = new THREE.Group();
  private figures: THREE.InstancedMesh;
  private boats: THREE.InstancedMesh;
  private umbrellas: THREE.InstancedMesh;
  private rods: THREE.InstancedMesh;
  private bobbers: THREE.InstancedMesh;
  private holes: THREE.InstancedMesh;
  private stools: THREE.InstancedMesh;
  private poses: Pose[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  far = false;
  /** Multiplier on ACTIVITY_FAR_VIEW_HEIGHT (graphics quality). */
  farScale = 1;
  private lastTick = NaN;
  private lastFar = true;

  constructor(private views: () => Iterable<ActivityView>, private heightAt: (x: number, y: number) => number) {
    const fig = new THREE.CapsuleGeometry(0.07, 0.2, 2, 5); fig.translate(0, 0.17, 0);
    this.figures = new THREE.InstancedMesh(fig, new THREE.MeshLambertMaterial({ color: 0xffb347 }), FIGURE_CAP);
    const boat = new THREE.BoxGeometry(0.5, 0.12, 0.24); boat.translate(0, 0.06, 0);
    this.boats = new THREE.InstancedMesh(boat, new THREE.MeshLambertMaterial({ color: 0xd9534f }), BOAT_CAP);
    const umb = new THREE.ConeGeometry(0.26, 0.16, 8); umb.translate(0, 0.52, 0);
    this.umbrellas = new THREE.InstancedMesh(umb, new THREE.MeshLambertMaterial({ color: 0xf0ad4e }), UMBRELLA_CAP);
    // Angling props: a slanted rod held out over the water, a red bobber, an ice hole and a stool. 4 more instanced draws, only while anglers fish.
    const rod = new THREE.CylinderGeometry(0.008, 0.016, 0.6, 4); rod.translate(0, 0.3, 0); rod.rotateZ(-(Math.PI / 2 - 0.55)); rod.translate(0.07, 0.17, 0);
    this.rods = new THREE.InstancedMesh(rod, new THREE.MeshLambertMaterial({ color: 0x6b4226 }), ANGLER_CAP);
    this.bobbers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshLambertMaterial({ color: 0xd9453a }), ANGLER_CAP);
    const hole = new THREE.CylinderGeometry(0.11, 0.11, 0.012, 8); hole.translate(0, 0.012, 0);
    this.holes = new THREE.InstancedMesh(hole, new THREE.MeshLambertMaterial({ color: 0x1b3a52 }), ANGLER_CAP);
    const stool = new THREE.CylinderGeometry(0.06, 0.05, 0.1, 6); stool.translate(0, 0.05, 0);
    this.stools = new THREE.InstancedMesh(stool, new THREE.MeshLambertMaterial({ color: 0xb5773f }), ANGLER_CAP);
    for (const m of [this.figures, this.boats, this.umbrellas, this.rods, this.bobbers, this.holes, this.stools]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0; this.group.add(m); }
  }

  /** `tick` = sim tick (+ fraction); `viewHeight` = camera.top - camera.bottom. */
  update(tick: number, viewHeight: number): void {
    this.far = viewHeight > ACTIVITY_FAR_VIEW_HEIGHT * this.farScale;
    this.group.visible = !this.far;
    if (this.far) { this.lastFar = true; return; }
    if (tick === this.lastTick && !this.lastFar) return; // poses are a pure function of the tick: nothing to redo while paused
    this.lastTick = tick; this.lastFar = false;
    const all = [this.figures, this.boats, this.umbrellas, this.rods, this.bobbers, this.holes, this.stools];
    const caps = [FIGURE_CAP, BOAT_CAP, UMBRELLA_CAP, ANGLER_CAP, ANGLER_CAP, ANGLER_CAP, ANGLER_CAP];
    const slot = { figure: 0, boat: 1, umbrella: 2, rod: 3, bobber: 4, hole: 5, stool: 6 } as const;
    const n = [0, 0, 0, 0, 0, 0, 0];
    for (const v of this.views()) {
      const cnt = activityPoses(v, tick, this.poses);
      for (let k = 0; k < cnt; k++) {
        const po = this.poses[k]!, si = slot[po.kind], idx = n[si]!;
        if (idx >= caps[si]!) continue;
        const bob = po.kind === 'bobber' ? 0.012 * Math.sin(tick * 0.35 + po.seed * 1.9) : 0;
        this.p.set(po.x, this.heightAt(po.x, po.y) + bob, po.y);
        this.q.setFromAxisAngle(this.up, -po.heading);
        this.m.compose(this.p, this.q, this.s);
        all[si]!.setMatrixAt(idx, this.m);
        n[si]!++;
      }
    }
    all.forEach((m, i) => { m.count = n[i]!; m.instanceMatrix.needsUpdate = true; });
  }
}
