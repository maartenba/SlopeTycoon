import * as THREE from 'three';
import { MODE, type Critter } from '../sim/nature/Fauna';
import { NATURE_GEOMETRY, type NatureSpecies } from './meshes/Animals';

/** Instanced per-species rendering of livestock + wild fauna (one draw call per species, <= 9). Positions ease towards the sim positions
 * (the sim steps each animal every few ticks); walk bob / sway is a per-instance pose; far zoom hides small species. */
export const NATURE_VIEW = {
  capPerSpecies: 160,
  /** View-height (tiles) above which a species is hidden. */
  hideAbove: { cow: 90, sheep: 70, goat: 70, deer: 100, ibex: 100, chamois: 100, marmot: 55, fox: 60, eagle: 140 } as Record<NatureSpecies, number>,
  eagleHeight: 7, smooth: 7,
  /** Per-species render scale (animals are tiny at default zoom). */
  scale: { cow: 1.6, sheep: 1.5, goat: 1.5, deer: 1.4, ibex: 1.4, chamois: 1.4, marmot: 1.6, fox: 1.5, eagle: 1.3 } as Record<NatureSpecies, number>,
} as const;

/** Pure: should a species be drawn at this view height? */
export function speciesVisibleAt(sp: NatureSpecies, viewHeight: number): boolean { return viewHeight <= NATURE_VIEW.hideAbove[sp]; }

/** Pure: exponential ease of a displayed value towards its sim target (frame-rate independent). Returns the new value. */
export function easeToward(cur: number, target: number, dt: number, rate: number = NATURE_VIEW.smooth): number { return cur + (target - cur) * (1 - Math.exp(-rate * dt)); }
/** Pure: shortest-arc ease of an angle. */
export function easeAngle(cur: number, target: number, dt: number, rate: number = NATURE_VIEW.smooth): number {
  const d = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
  return cur + d * (1 - Math.exp(-rate * dt));
}

/** Walk mode: animals within this many tiles of the walker shy away (visual only: the sim never sees the walker). */
export const FLEE = { radius: 6, maxPush: 3.2, rate: 2.5,
  /** Per-species timidity 0..1 (livestock is used to people, the eagle ignores walkers). */
  timid: { cow: 0.35, sheep: 0.6, goat: 0.6, deer: 1, ibex: 0.9, chamois: 1, marmot: 1, fox: 1, eagle: 0 } as Record<NatureSpecies, number> } as const;

/** Pure: visual displacement (x, z tiles) of an animal at (ax, az) away from a disturbance at (wx, wz): 0 beyond `radius`, up to `maxPush x timid` at the walker. */
export function fleeOffset(ax: number, az: number, wx: number, wz: number, timid = 1, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  const dx = ax - wx, dz = az - wz, d = Math.hypot(dx, dz);
  if (d >= FLEE.radius || timid <= 0) { out.x = 0; out.z = 0; return out; }
  const k = ((FLEE.radius - d) / FLEE.radius) * FLEE.maxPush * timid, nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
  out.x = nx * k; out.z = nz * k;
  return out;
}

interface Disp { x: number; y: number; yaw: number; moved: number; fx: number; fy: number }

export class NatureView {
  readonly group = new THREE.Group();
  readonly meshes = new Map<NatureSpecies, THREE.InstancedMesh>();
  private mats = new Map<NatureSpecies, THREE.MeshLambertMaterial>();
  private disp = new Map<number, Disp>();
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private up = new THREE.Vector3(0, 1, 0);
  private p = new THREE.Vector3(); private sc = new THREE.Vector3(1, 1, 1); private e = new THREE.Euler(); private q2 = new THREE.Quaternion();
  private time = 0;
  private fo = { x: 0, z: 0 }; private readonly fo0 = { x: 0, z: 0 };
  private winterColor = new THREE.Color(1, 1, 1);
  drawn = 0;

  /** `ground(x, y)` = terrain surface height at tile coords. */
  constructor(private ground: (x: number, y: number) => number) {
    for (const sp of Object.keys(NATURE_GEOMETRY) as NatureSpecies[]) {
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.InstancedMesh(NATURE_GEOMETRY[sp](), mat, NATURE_VIEW.capPerSpecies);
      mesh.count = 0; mesh.frustumCulled = false; mesh.name = `nature:${sp}`;
      this.group.add(mesh); this.meshes.set(sp, mesh); this.mats.set(sp, mat);
    }
  }

  /** winter 0..1: lighter winter coats (deer/ibex/chamois/fox/goat) via the material colour. */
  setWinter(w: number): void {
    const k = 1 + 0.45 * Math.min(1, Math.max(0, w));
    this.winterColor.setRGB(k, k, k * 1.03);
    for (const sp of ['deer', 'ibex', 'chamois', 'fox', 'goat'] as const) this.mats.get(sp)!.color.copy(this.winterColor);
  }

  /** Draw `animals` (hidden ones skipped). centre/radius = camera target + view radius in tiles for off-screen culling. */
  update(dt: number, animals: Iterable<Critter>, cx: number, cz: number, viewHeight: number, disturb: { x: number; z: number } | null = null): void {
    this.time += dt;
    const counts = new Map<NatureSpecies, number>();
    const R = viewHeight * 1.3 + 8, R2 = R * R;
    let drawn = 0;
    for (const a of animals) {
      let d = this.disp.get(a.id);
      if (a.hidden) { if (d) this.disp.delete(a.id); continue; }
      if (!d) { d = { x: a.x, y: a.y, yaw: Math.PI / 2 - a.heading, moved: 0, fx: 0, fy: 0 }; this.disp.set(a.id, d); }
      const ox = d.x, oy = d.y;
      // walk mode: shy away from the walker. Purely a DISPLAY offset on top of the sim position (the animal's sim state is never touched)
      const fo = disturb ? fleeOffset(a.x, a.y, disturb.x, disturb.z, FLEE.timid[a.species as NatureSpecies] ?? 1, this.fo) : this.fo0;
      d.fx = easeToward(d.fx, fo.x, dt, FLEE.rate); d.fy = easeToward(d.fy, fo.z, dt, FLEE.rate);
      d.x = easeToward(d.x, a.x + d.fx, dt); d.y = easeToward(d.y, a.y + d.fy, dt);
      const fl = Math.hypot(d.fx, d.fy);
      d.yaw = fl > 0.3 ? easeAngle(d.yaw, Math.atan2(d.fx, d.fy), dt, 5) : easeAngle(d.yaw, Math.PI / 2 - a.heading, dt, 5); // fleeing: face away from the walker
      const v = dt > 0 ? Math.hypot(d.x - ox, d.y - oy) / dt : 0; // tiles / s actually travelled on screen
      d.moved += (Math.min(1.6, v * 1.6) - d.moved) * Math.min(1, dt * 8);
      const sp = a.species as NatureSpecies;
      if (!speciesVisibleAt(sp, viewHeight)) continue;
      if ((d.x - cx) ** 2 + (d.y - cz) ** 2 > R2) continue;
      const mesh = this.meshes.get(sp)!, i = counts.get(sp) ?? 0;
      if (i >= NATURE_VIEW.capPerSpecies) continue;
      counts.set(sp, i + 1);
      const gy = this.ground(d.x, d.y), mv = d.moved, run = a.mode === MODE.run;
      const gait = this.time * (run ? 15 : 9) + a.phase * 3, ph = gait;
      let bob = 0, pitch = 0, roll = 0;
      if (sp === 'eagle') {
        bob = NATURE_VIEW.eagleHeight + Math.sin(this.time * 0.8 + a.phase) * 0.5; roll = -0.4; pitch = 0.1 * Math.sin(this.time + a.phase);
      } else {
        bob = Math.abs(Math.sin(ph)) * (run ? 0.09 : 0.06) * Math.min(1, mv);
        pitch = Math.sin(ph) * 0.09 * Math.min(1, mv);
        roll = Math.sin(ph * 0.5) * 0.07 * Math.min(1, mv);
        if (mv < 0.25) { // standing: graze with the head down + nodding, or look up
          const still = 1 - mv * 4;
          if (a.mode === MODE.graze) pitch += still * (0.32 + 0.06 * Math.sin(this.time * 1.7 + a.phase * 5));
          else if (a.mode === MODE.rest) pitch -= still * (sp === 'marmot' ? 0.55 : 0.06) + (sp === 'marmot' ? 0 : 0.03 * Math.sin(this.time + a.phase));
        }
      }
      this.e.set(pitch, 0, roll, 'YXZ');
      this.q.setFromAxisAngle(this.up, d.yaw); this.q.multiply(this.q2.setFromEuler(this.e));
      const k = NATURE_VIEW.scale[sp]; this.sc.set(k, k, k);
      this.m.compose(this.p.set(d.x, gy + bob, d.y), this.q, this.sc);
      mesh.setMatrixAt(i, this.m);
      drawn++;
    }
    this.drawn = drawn;
    for (const [sp, mesh] of this.meshes) { mesh.count = counts.get(sp) ?? 0; mesh.instanceMatrix.needsUpdate = true; mesh.visible = mesh.count > 0; }
    if (this.disp.size > 4000) this.disp.clear();
  }

  dispose(): void { for (const m of this.meshes.values()) m.geometry.dispose(); for (const m of this.mats.values()) m.dispose(); }
}
