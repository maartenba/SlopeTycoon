import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TOURS, type TourVehicleKind } from '../config/tours';
import type { Carrier } from '../sim/attractions/Tour';

/** Body colours / sizes (tiles) of the cosmetic carriers. Kept tiny: boxes only, <= ~60 triangles each. */
const LOOK: Record<TourVehicleKind, { body: number; trim: number; len: number; wid: number; high: number }> = {
  sleigh: { body: 0x8a3b2e, trim: 0x3d2a1c, len: 0.7, wid: 0.34, high: 0.22 },
  walkers: { body: 0xd8a23a, trim: 0x44546a, len: 0.12, wid: 0.12, high: 0.34 },
  scooter: { body: 0xc8452b, trim: 0x222222, len: 0.46, wid: 0.22, high: 0.2 },
  quad: { body: 0x4a6b3a, trim: 0x222222, len: 0.42, wid: 0.3, high: 0.22 },
  raft: { body: 0xe0a030, trim: 0x2a5d86, len: 0.6, wid: 0.34, high: 0.1 },
  canyoner: { body: 0xe8782a, trim: 0x222222, len: 0.12, wid: 0.12, high: 0.3 },
};

const box = (w: number, h: number, d: number, y: number, color: number): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(0, y + h / 2, 0);
  const c = new THREE.Color(color), n = g.attributes.position!.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
};

const colored = (g: THREE.BufferGeometry, color: number, x: number, y: number, z: number): THREE.BufferGeometry => {
  g = g.index ? g.toNonIndexed() : g;
  g.translate(x, y, z);
  const c = new THREE.Color(color), n = g.attributes.position!.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
};

/** A quad bike with a rider in front and a passenger behind (forward = +x): body, cowl, seat, handlebars, four wheels, two helmets. ~230 triangles. */
export function quadGeometry(body = 0x4a6b3a): THREE.BufferGeometry {
  const wheel = (x: number, z: number): THREE.BufferGeometry => colored(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 8).rotateX(Math.PI / 2), 0x1c1c1e, x, 0.045, z);
  return mergeGeometries([
    box(0.4, 0.06, 0.2, 0.06, body),
    box(0.14, 0.07, 0.17, 0.12, body), // cowl
    colored(new THREE.BoxGeometry(0.2, 0.025, 0.14), 0x222222, -0.04, 0.135, 0), // long seat
    colored(new THREE.BoxGeometry(0.03, 0.03, 0.2), 0x2a2a2e, 0.1, 0.17, 0), // handlebars
    wheel(0.14, 0.12), wheel(0.14, -0.12), wheel(-0.14, 0.12), wheel(-0.14, -0.12),
    colored(new THREE.BoxGeometry(0.07, 0.09, 0.08), 0x3a5a8a, 0.0, 0.19, 0), // rider torso
    colored(new THREE.SphereGeometry(0.04, 6, 5), 0xd9453a, 0.0, 0.28, 0), // helmet
    colored(new THREE.BoxGeometry(0.07, 0.09, 0.08), 0xd8a23a, -0.1, 0.19, 0),
    colored(new THREE.SphereGeometry(0.04, 6, 5), 0xf2c14e, -0.1, 0.28, 0),
  ])!;
}

/**
 * An inflatable raft with four paddlers (forward = +x): four orange tubes round a floor, a bow / stern thwart, four helmeted paddlers in life jackets with paddles
 * lifted at different angles. ~320 triangles; one instance per raft (docs/water-tours.md).
 */
export function raftGeometry(body = 0xe0a030): THREE.BufferGeometry {
  const L = 0.62, W = 0.36, t = 0.075;
  const parts: THREE.BufferGeometry[] = [
    box(L - 0.08, 0.02, W - 0.08, 0.0, 0x2a5d86), // floor
    box(L, t, t, 0.0, body).translate(0, 0, W / 2 - t / 2), box(L, t, t, 0.0, body).translate(0, 0, -(W / 2 - t / 2)),
    box(t, t, W, 0.0, body).translate(L / 2 - t / 2, 0, 0), box(t, t, W, 0.0, body).translate(-(L / 2 - t / 2), 0, 0),
    box(0.04, 0.03, W - 0.1, 0.07, 0x7a4a24), // thwart
  ];
  const seats: Array<[number, number, number]> = [[0.13, 0.1, 0.5], [0.13, -0.1, -0.4], [-0.1, 0.1, -0.5], [-0.1, -0.1, 0.4]];
  const jackets = [0xd9453a, 0x4a90d9, 0xf2c14e, 0x5cb85c];
  seats.forEach(([x, z, tilt], i) => {
    parts.push(colored(new THREE.BoxGeometry(0.07, 0.1, 0.09), jackets[i]!, x, 0.1, z));
    parts.push(colored(new THREE.SphereGeometry(0.038, 6, 5), i % 2 ? 0xf2c14e : 0xfafafa, x, 0.2, z));
    const sign = z > 0 ? 1 : -1;
    parts.push(colored(new THREE.BoxGeometry(0.012, 0.012, 0.3), 0x7a4a24, x, 0.17, z + sign * 0.14).rotateY(0).applyMatrix4(new THREE.Matrix4().makeRotationX(tilt * sign * 0.35)));
    parts.push(colored(new THREE.BoxGeometry(0.06, 0.012, 0.07), 0xf2c14e, x, 0.17, z + sign * 0.27));
  });
  return mergeGeometries(parts)!;
}

/** A canyoner on a rope (forward = +x, downhill): body in a wetsuit, helmet, harness, a rope trailing back up the slope. ~120 triangles. */
export function canyonerGeometry(body = 0xe8782a): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(0.06, 0.12, 0.08), body, 0, 0.14, 0), // torso
    colored(new THREE.BoxGeometry(0.05, 0.1, 0.05), 0x222222, 0.02, 0.06, 0.02), // legs
    colored(new THREE.SphereGeometry(0.04, 6, 5), 0xf2c14e, 0.01, 0.25, 0), // helmet
    colored(new THREE.BoxGeometry(0.04, 0.03, 0.1), 0xd9453a, 0, 0.12, 0), // harness
    colored(new THREE.BoxGeometry(0.5, 0.012, 0.012), 0xd0d4da, -0.27, 0.2, 0), // rope trailing up the slope
  ])!;
}

/** Dust puffs trailing a moving quad (cosmetic; positions come from the carrier's heading only, so nothing animates on its own). */
export const DUST = { perCarrier: 3, step: 0.2, color: 0xcdb48c, opacity: 0.24 } as const;

/**
 * Cosmetic tour carriers (sleighs, walkers, scooters, quads, rafts; docs/tours.md): one InstancedMesh per vehicle kind, capped at
 * TOURS.maxCarriers in total. View only: it reads `TourSystem.carriers()` and writes nothing into the sim. With no ride in progress every
 * mesh has `count = 0`. Heights come from `ground(x, z)` (surfaceHeightAt in the game).
 */
export class TourVehicles {
  readonly group = new THREE.Group();
  readonly meshes = new Map<TourVehicleKind, THREE.InstancedMesh>();
  /** Dust trail behind moving quads (one draw call, <= maxCarriers x 3 puffs). */
  readonly dust: THREE.InstancedMesh;
  private tmp = new THREE.Object3D();
  private buf: Carrier[] = [];
  /** Rafts currently on rapids tiles (world x, y, z): the splash emitter takes these first (RapidsSplash cap unchanged). */
  readonly splashSpots: Array<{ x: number; y: number; z: number }> = [];

  constructor(private ground: (x: number, z: number) => number, private source: (tick: number, out: Carrier[], max: number) => Carrier[]) {
    this.group.name = 'tourVehicles';
    const puff = new THREE.IcosahedronGeometry(0.5, 1);
    this.dust = new THREE.InstancedMesh(puff, new THREE.MeshBasicMaterial({ color: DUST.color, transparent: true, opacity: DUST.opacity, depthWrite: false }), TOURS.maxCarriers * DUST.perCarrier);
    this.dust.count = 0; this.dust.frustumCulled = false; this.dust.name = 'tour:dust';
    this.group.add(this.dust);
    for (const kind of Object.keys(LOOK) as TourVehicleKind[]) {
      const l = LOOK[kind];
      const geo = mergeGeometries([box(l.len, l.high * 0.55, l.wid, 0.04, l.body), box(l.len * 0.5, l.high * 0.45, l.wid * 0.8, 0.04 + l.high * 0.55, l.trim)])!;
      const mesh = new THREE.InstancedMesh(kind === 'quad' ? quadGeometry(l.body) : kind === 'raft' ? raftGeometry(l.body) : kind === 'canyoner' ? canyonerGeometry(l.body) : geo, new THREE.MeshLambertMaterial({ vertexColors: true }), TOURS.maxCarriers);
      mesh.count = 0; mesh.frustumCulled = false; mesh.name = `tour:${kind}`;
      this.meshes.set(kind, mesh); this.group.add(mesh);
    }
  }

  /** Carriers currently drawn (all kinds). */
  get count(): number { let n = 0; for (const m of this.meshes.values()) n += m.count; return n; }

  update(tick: number): void {
    const list = this.source(tick, this.buf, TOURS.maxCarriers);
    const used = new Map<TourVehicleKind, number>();
    this.splashSpots.length = 0;
    this.tmp.rotation.order = 'YZX';
    for (const c of list) {
      const m = this.meshes.get(c.kind)!, i = used.get(c.kind) ?? 0;
      if (i >= TOURS.maxCarriers) continue;
      used.set(c.kind, i + 1);
      const gy = this.ground(c.x, c.y), lift = c.kind === 'raft' ? 0.05 : 0;
      this.tmp.position.set(c.x, gy + lift, c.y);
      let pitch = 0;
      if (c.kind === 'canyoner') { const dx = Math.cos(c.heading) * 0.25, dz = Math.sin(c.heading) * 0.25; pitch = Math.atan2(this.ground(c.x + dx, c.y + dz) - this.ground(c.x - dx, c.y - dz), 0.5); }
      this.tmp.rotation.set(0, -c.heading, pitch);
      if (c.splash && this.splashSpots.length < 8) this.splashSpots.push({ x: c.x, y: gy + 0.1, z: c.y });
      this.tmp.updateMatrix();
      m.setMatrixAt(i, this.tmp.matrix);
    }
    let d = 0;
    for (const c of list) {
      if (c.kind !== 'quad') continue;
      const dx = Math.cos(c.heading), dz = Math.sin(c.heading);
      for (let k = 1; k <= DUST.perCarrier && d < this.dust.instanceMatrix.count; k++) {
        if (DUST.step * k > c.back) break; // never behind the start of the route (that is inside the base)
        const px = c.x - dx * DUST.step * k, pz = c.y - dz * DUST.step * k;
        this.tmp.position.set(px, this.ground(px, pz) + 0.06 + 0.03 * k, pz);
        this.tmp.rotation.set(0, 0, 0);
        this.tmp.scale.setScalar(0.08 + 0.045 * k);
        this.tmp.updateMatrix();
        this.dust.setMatrixAt(d++, this.tmp.matrix);
      }
    }
    this.tmp.scale.setScalar(1);
    this.dust.count = d; this.dust.instanceMatrix.needsUpdate = true;
    for (const [kind, m] of this.meshes) { m.count = used.get(kind) ?? 0; m.instanceMatrix.needsUpdate = true; }
  }
}
