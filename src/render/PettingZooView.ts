import * as THREE from 'three';
import { NATURE_GEOMETRY, createDonkeyGeometry, createRabbitGeometry } from './meshes/Animals';
import { ZOO_ANIMALS, ZOO_HOURS, zooPose, type ZooKind } from '../sim/attractions/PettingZoo';

/** Display scale per kind (the nature meshes are drawn 1.5x so they read at the default zoom; rabbits and the donkey match). */
export const ZOO_VIEW = { cap: 64, hideAbove: 70, scale: { goat: 1.5, sheep: 1.5, rabbit: 1.6, donkey: 1.35 } as Record<ZooKind, number> } as const;

export interface ZooSource { id: number; /** Open attraction (summer, staffed, connected): animals are out. */ open: boolean }

/**
 * Petting-zoo animals: render only (the sim never reads them; nothing is saved or hashed). Each open zoo shows `ZOO_ANIMALS` wandering inside its pen
 * (`zooPose`: pure, deterministic, always inside the pen), reusing the nature goat / sheep meshes plus a rabbit and a donkey. One instanced draw call per kind (4).
 * `toWorld(id, lx, lz, out)` maps building-local pen coordinates to world space (the building group's matrix, so rotation and ground height are right); false = no mesh yet.
 */
export class PettingZooView {
  readonly group = new THREE.Group();
  readonly meshes = new Map<ZooKind, THREE.InstancedMesh>();
  private mats: THREE.MeshLambertMaterial[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private up = new THREE.Vector3(0, 1, 0);
  private p = new THREE.Vector3(); private sc = new THREE.Vector3(1, 1, 1); private e = new THREE.Euler(); private q2 = new THREE.Quaternion();
  private a = new THREE.Vector3(); private c = new THREE.Vector3();
  private time = 0;
  /** Animals drawn last frame (tests / debug). */
  drawn = 0;

  constructor() {
    const geo: Record<ZooKind, () => THREE.BufferGeometry> = { goat: NATURE_GEOMETRY.goat, sheep: NATURE_GEOMETRY.sheep, rabbit: createRabbitGeometry, donkey: createDonkeyGeometry };
    for (const k of Object.keys(geo) as ZooKind[]) {
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.InstancedMesh(geo[k](), mat, ZOO_VIEW.cap);
      mesh.count = 0; mesh.frustumCulled = false; mesh.name = `zoo:${k}`;
      this.group.add(mesh); this.meshes.set(k, mesh); this.mats.push(mat);
    }
  }

  update(dt: number, zoos: Iterable<ZooSource>, hour: number, viewHeight: number, toWorld: (id: number, lx: number, lz: number, out: THREE.Vector3) => boolean, cx: number, cz: number): void {
    this.time += dt;
    const counts = new Map<ZooKind, number>();
    let drawn = 0;
    const R = viewHeight * 1.3 + 8, R2 = R * R, out = hour >= ZOO_HOURS.from && hour < ZOO_HOURS.to && viewHeight <= ZOO_VIEW.hideAbove;
    if (out) for (const z of zoos) {
      if (!z.open) continue;
      const yaw0 = this.groupYaw(z.id, toWorld);
      for (let i = 0; i < ZOO_ANIMALS.length; i++) {
        const kind = ZOO_ANIMALS[i]!, pose = zooPose(z.id, i, this.time);
        if (!toWorld(z.id, pose.x, pose.z, this.p)) break;
        if ((this.p.x - cx) ** 2 + (this.p.z - cz) ** 2 > R2) continue;
        const mesh = this.meshes.get(kind)!, n = counts.get(kind) ?? 0;
        if (n >= ZOO_VIEW.cap) continue;
        counts.set(kind, n + 1);
        const g = Math.sin(this.time * 9 + i * 1.7), mv = pose.moving;
        this.e.set(g * 0.08 * mv + (mv < 0.05 && kind !== 'donkey' ? 0.3 + 0.05 * Math.sin(this.time * 1.7 + i * 5) : 0), 0, Math.sin(this.time * 4.5 + i) * 0.06 * mv, 'YXZ');
        this.p.y += Math.abs(g) * 0.05 * mv;
        this.q.setFromAxisAngle(this.up, pose.yaw + yaw0); this.q.multiply(this.q2.setFromEuler(this.e));
        const k = ZOO_VIEW.scale[kind]; this.sc.set(k, k, k);
        this.m.compose(this.p, this.q, this.sc);
        mesh.setMatrixAt(n, this.m);
        drawn++;
      }
    }
    this.drawn = drawn;
    for (const [k, mesh] of this.meshes) { mesh.count = counts.get(k) ?? 0; mesh.instanceMatrix.needsUpdate = true; mesh.visible = mesh.count > 0; }
  }

  /** Yaw of the building group (0 for an unrotated pen): the world direction of local +z. */
  private groupYaw(id: number, toWorld: (id: number, lx: number, lz: number, out: THREE.Vector3) => boolean): number {
    if (!toWorld(id, 0, 0, this.a) || !toWorld(id, 0, 1, this.c)) return 0;
    return Math.atan2(this.c.x - this.a.x, this.c.z - this.a.z);
  }

  dispose(): void { for (const m of this.meshes.values()) m.geometry.dispose(); for (const m of this.mats) m.dispose(); }
}
