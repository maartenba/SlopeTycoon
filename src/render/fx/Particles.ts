import * as THREE from 'three';

/** Tiny deterministic render RNG (never the sim RNG). */
export function renderRng(seed = 0x9e3779b9): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface Burst { x: number; y: number; z: number; count: number; kind: 'puff' | 'confetti'; /** puff colour (snow / dust) */ color?: number; scale?: number; /** Test/QA only: stretch the lifetime. */ lifeScale?: number }

/**
 * Pooled instanced quads: ONE draw call for every puff and confetti piece. Billboarded towards the camera, fixed pool (no allocation per
 * burst), oldest-first recycling. Puffs rise + grow + fade; confetti flutters down.
 */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly n: number;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private age: Float32Array; private life: Float32Array; private size: Float32Array; private grav: Float32Array; private alive: Uint8Array;
  private head = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private pos = new THREE.Vector3(); private sc = new THREE.Vector3();
  private col = new THREE.Color();
  constructor(capacity = 256, private rng: () => number = renderRng()) {
    this.n = capacity;
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 1, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 9; this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const f = (): Float32Array => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f(); this.age = f(); this.life = f(); this.size = f(); this.grav = f();
    this.alive = new Uint8Array(capacity);
    this.mesh.setColorAt(0, this.col.set(0xffffff));
  }
  /** Live particle count. */
  get count(): number { let c = 0; for (let i = 0; i < this.n; i++) c += this.alive[i]!; return c; }

  emit(b: Burst): void {
    const r = this.rng, conf = b.kind === 'confetti', sc = b.scale ?? 1;
    for (let k = 0; k < b.count; k++) {
      const i = this.head; this.head = (this.head + 1) % this.n;
      this.alive[i] = 1; this.age[i] = 0;
      const a = r() * Math.PI * 2;
      if (conf) {
        const sp = 1.2 + r() * 2.2;
        this.px[i] = b.x; this.py[i] = b.y; this.pz[i] = b.z;
        this.vx[i] = Math.cos(a) * sp; this.vz[i] = Math.sin(a) * sp; this.vy[i] = 3 + r() * 2.5;
        this.life[i] = 1.8 + r() * 0.8; this.size[i] = 0.18 + r() * 0.1; this.grav[i] = 5;
        this.mesh.setColorAt(i, this.col.setHSL(r(), 0.45, 0.72)); // pastel
      } else {
        const sp = 0.25 + r() * 0.5 * sc;
        this.px[i] = b.x + (r() - 0.5) * 1.2 * sc; this.py[i] = b.y + r() * 0.2; this.pz[i] = b.z + (r() - 0.5) * 1.2 * sc;
        this.vx[i] = Math.cos(a) * sp; this.vz[i] = Math.sin(a) * sp; this.vy[i] = 0.5 + r() * 0.5;
        this.life[i] = (0.7 + r() * 0.3) * (b.lifeScale ?? 1); this.size[i] = (0.5 + r() * 0.3) * sc; this.grav[i] = -0.2;
        this.mesh.setColorAt(i, this.col.set(b.color ?? 0xeef3f8));
      }
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number, camera: THREE.Camera): void {
    camera.getWorldQuaternion(this.q);
    let hi = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const a = (this.age[i] = this.age[i]! + dt), L = this.life[i]!;
      if (a >= L) { this.alive[i] = 0; this.sc.set(0, 0, 0); this.m.compose(this.pos.set(0, -999, 0), this.q, this.sc); this.mesh.setMatrixAt(i, this.m); continue; }
      this.vy[i] = this.vy[i]! - this.grav[i]! * dt;
      this.px[i] = this.px[i]! + this.vx[i]! * dt; this.py[i] = Math.max(0, this.py[i]! + this.vy[i]! * dt); this.pz[i] = this.pz[i]! + this.vz[i]! * dt;
      const t = a / L, conf = this.grav[i]! > 1;
      const s = conf ? this.size[i]! * (1 - t * 0.4) : this.size[i]! * (0.6 + t * 0.9) * (1 - t * t * 0.3);
      this.sc.set(s, s * (conf ? 0.6 : 1), 1);
      this.pos.set(this.px[i]!, this.py[i]!, this.pz[i]!);
      this.m.compose(this.pos, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
      hi = i + 1;
    }
    this.mesh.count = hi;
    this.mesh.instanceMatrix.needsUpdate = true;
    // Global fade for puffs is handled by size shrink at end of life; opacity stays fixed so one material serves both kinds.
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7;
  }
  clear(): void { this.alive.fill(0); this.mesh.count = 0; }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
