import { chaseK } from './chase';
import * as THREE from 'three';
import type { Safety } from '@/sim/ops/Safety';
import { AnimalHerd } from './meshes/Animals';
import { HelicopterMesh } from './meshes/Helicopter';
import { SnowcatFleet } from './meshes/Snowcat';

const SEV_COLOR = [0xffd34d, 0xff8a2b, 0xe02424];

/**
 * Visual layer for Task 26 (visual only; NOT verified at runtime — no WebGL in agent sessions):
 * patrol sleds (re-using the small snowcat instancing), rescue helicopter(s) with spinning rotor, bears/wolves, pulsing red-cross incident
 * markers (colour by severity) and avalanche debris/cloud decals that fade out. Cheap: instanced meshes, everything LOD'd by count caps.
 */
export class IncidentView {
  readonly group = new THREE.Group();
  private sleds = new SnowcatFleet();
  private herd = new AnimalHerd();
  private helis: HelicopterMesh[] = [];
  private markers: THREE.InstancedMesh;
  private debris: THREE.InstancedMesh;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private up = new THREE.Vector3(0, 1, 0);
  private p = new THREE.Vector3(); private s = new THREE.Vector3(); private col = new THREE.Color();
  private smooth = new Map<number, { x: number; y: number; yaw: number }>();
  private clock = 0;
  private debrisSig = '';
  static readonly MAX_MARKERS = 64;
  static readonly MAX_DEBRIS = 2048;

  constructor(private safety: Safety, private groundAt: (x: number, y: number) => number) {
    this.sleds.bodies.scale.setScalar(0.6);
    // marker: floating flat red-cross billboard-ish diamond (two crossed quads)
    const a = new THREE.BoxGeometry(0.5, 0.15, 0.15), b = new THREE.BoxGeometry(0.15, 0.5, 0.15);
    const mg = new THREE.BufferGeometry();
    const merged = [a, b].map((g) => g.toNonIndexed());
    const pos: number[] = [];
    for (const g of merged) pos.push(...Array.from(g.getAttribute('position').array));
    mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    mg.computeVertexNormals();
    this.markers = new THREE.InstancedMesh(mg, new THREE.MeshBasicMaterial({ color: 0xffffff }), IncidentView.MAX_MARKERS);
    this.markers.count = 0; this.markers.frustumCulled = false;
    const dg = new THREE.PlaneGeometry(1, 1); dg.rotateX(-Math.PI / 2);
    this.debris = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ color: 0xdfe7ee, transparent: true, opacity: 0.8, depthWrite: false }), IncidentView.MAX_DEBRIS);
    this.debris.count = 0; this.debris.frustumCulled = false; this.debris.renderOrder = 5;
    this.group.add(this.sleds.group, this.herd.group, this.markers, this.debris);
  }

  /** Per rendered frame. `dt` seconds, `tick` current sim tick (for debris fade). */
  update(dt: number, tick: number, ticksPerSecond = 10): void {
    const kc = chaseK(dt, ticksPerSecond);
    this.clock += dt;
    const sf = this.safety;
    // sleds
    const agents = sf.patrol.agents;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]!;
      let st = this.smooth.get(a.id);
      if (!st) { st = { x: a.x, y: a.y, yaw: 0 }; this.smooth.set(a.id, st); }
      const dx = a.x - st.x, dy = a.y - st.y;
      if (dx * dx + dy * dy > 1e-4) st.yaw = Math.atan2(dx, dy);
      st.x += dx * kc; st.y += dy * kc;
      this.sleds.set(i, st.x, this.groundAt(st.x, st.y) + 0.03, st.y, st.yaw);
    }
    this.sleds.commit(agents.length, false);
    // helicopters
    while (this.helis.length < sf.heli.helis.length) { const h = new HelicopterMesh(); this.helis.push(h); this.group.add(h.group); }
    for (let i = 0; i < this.helis.length; i++) {
      const h = sf.heli.helis[i], mesh = this.helis[i]!;
      if (!h || h.state === 'idle') { mesh.group.visible = false; continue; }
      let st = this.smooth.get(-h.id);
      if (!st) { st = { x: h.x, y: h.y, yaw: 0 }; this.smooth.set(-h.id, st); }
      const dx = h.x - st.x, dy = h.y - st.y;
      if (dx * dx + dy * dy > 1e-4) st.yaw = Math.atan2(dx, dy);
      st.x += dx * kc; st.y += dy * kc;
      mesh.group.visible = true;
      const gx = Math.max(0, Math.min(sf.o.size - 1, st.x)), gy = Math.max(0, Math.min(sf.o.size - 1, st.y));
      mesh.set(st.x, this.groundAt(gx, gy) + 2.2, st.y, st.yaw, this.clock * 40);
    }
    // animals: eased positions (sim moves in small steps), shortest-arc heading, cubs trail their mother, rangers drive ATVs
    let nb = 0, nw = 0, np = 0;
    const k = Math.max(1 - Math.exp(-dt * 6), kc);
    for (const a of sf.wildlife.animals) {
      let st = this.smooth.get(a.id + 1e6);
      if (!st) { st = { x: a.x, y: a.y, yaw: 0 }; this.smooth.set(a.id + 1e6, st); }
      const ddx = a.x - st.x, ddy = a.y - st.y, jump = ddx * ddx + ddy * ddy > 64; // relocated: snap
      if (a.asleep) { st.x = a.x; st.y = a.y; continue; }
      if (jump) { st.x = a.x; st.y = a.y; } else { st.x += ddx * k; st.y += ddy * k; }
      if (ddx * ddx + ddy * ddy > 1e-3) { const want = Math.atan2(ddx, ddy); let d = want - st.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); st.yaw += d * Math.min(1, k * 1.5); }
      if (a.mode === 'sedated') continue;
      const moving = ddx * ddx + ddy * ddy > 4e-3;
      const bob = moving ? Math.abs(Math.sin(this.clock * 7 + a.id)) * 0.03 : 0;
      const pitch = a.mode === 'forage' ? 0.35 + 0.05 * Math.sin(this.clock * 3 + a.id) : 0;
      const idx = a.kind === 'bear' ? nb++ : nw++;
      this.herd.set(a.kind, idx, st.x, this.groundAt(st.x, st.y) + bob, st.y, st.yaw, a.kind === 'bear' ? 1.7 : 1.5, pitch);
      if (a.kind === 'bear') this.herd.paw(np++, st.x, this.groundAt(st.x, st.y) + 2.6 + 0.12 * Math.sin(this.clock * 2 + a.id), st.y, this.clock * 0.8, a.hazed > 0 || a.mode === 'wander' ? 0.85 : 0.65);
      if (a.kind === 'bear' && a.cub && nb < 30) {
        const cx = st.x - Math.sin(st.yaw) * 0.9 + Math.cos(st.yaw) * 0.3, cy = st.y - Math.cos(st.yaw) * 0.9 - Math.sin(st.yaw) * 0.3;
        this.herd.set('bear', nb++, cx, this.groundAt(cx, cy) + bob, cy, st.yaw, 0.85, pitch * 0.5);
      }
    }
    let nr = 0;
    for (const ag of sf.wildlife.agents) {
      let st = this.smooth.get(-1e6 - ag.id);
      if (!st) { st = { x: ag.x, y: ag.y, yaw: 0 }; this.smooth.set(-1e6 - ag.id, st); }
      const dx = ag.x - st.x, dy = ag.y - st.y;
      if (dx * dx + dy * dy > 1e-4) st.yaw = Math.atan2(dx, dy);
      st.x += dx * kc; st.y += dy * kc;
      this.herd.set('ranger', nr++, st.x, this.groundAt(st.x, st.y), st.y, st.yaw, 1.5);
    }
    this.herd.commit(nb, nw, nr, np);
    // markers
    const open = sf.incidents.open;
    const pulse = 1 + 0.2 * Math.sin(this.clock * 6);
    let n = 0;
    for (const inc of open) {
      if (n >= IncidentView.MAX_MARKERS) break;
      this.p.set(inc.x, this.groundAt(inc.x, inc.y) + 1.1 + 0.1 * Math.sin(this.clock * 3 + inc.id), inc.y);
      this.q.setFromAxisAngle(this.up, this.clock * 1.5);
      this.s.setScalar(pulse * (0.8 + 0.2 * inc.severity));
      this.m.compose(this.p, this.q, this.s);
      this.markers.setMatrixAt(n, this.m); this.markers.setColorAt(n, this.col.setHex(SEV_COLOR[inc.severity] ?? 0xe02424));
      n++;
    }
    this.markers.count = n; this.markers.instanceMatrix.needsUpdate = true;
    if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
    // avalanche debris: only rewritten when the set of slides changed (it is static between slides)
    const N = sf.o.size;
    let sig = '';
    for (const sl of sf.avalanche.slides) sig += `${sl.tiles.length}:${sl.tiles[0] ?? 0},`;
    if (sig !== this.debrisSig) {
      this.debrisSig = sig;
      let d = 0;
      for (const sl of sf.avalanche.slides) {
        for (const t of sl.tiles) {
          if (d >= IncidentView.MAX_DEBRIS) break;
          const x = (t % N) + 0.5, y = ((t / N) | 0) + 0.5;
          this.p.set(x, this.groundAt(x, y) + 0.06, y); this.s.set(1, 1, 1); this.q.identity();
          this.m.compose(this.p, this.q, this.s);
          this.debris.setMatrixAt(d++, this.m);
        }
      }
      this.debris.count = d; this.debris.instanceMatrix.needsUpdate = true;
    }
    void tick;
  }

  dispose(): void { this.sleds.dispose(); this.herd.dispose(); for (const h of this.helis) h.dispose(); this.markers.geometry.dispose(); this.debris.geometry.dispose(); }
}
