import * as THREE from 'three';
import type { Grid } from '@/world/Grid';
import type { SnowPark, ParkInfo, Feature } from '@/sim/park/SnowPark';
import { parkFeatures } from '@/sim/park/SnowPark';
import { PARK, type FeatureKind } from '@/config/park';
import { surfaceHeightAt } from '@/render/meshes/Paths';

/**
 * Snow park view (0.9.0, docs/snow-park.md): the auto-placed features of every marked, valid park as ONE merged mesh with vertex colours (kickers, boxes, rails; 1 draw call,
 * about 30 / 12 / 22 triangles each; rebuilt only when a park changes, re-tinted when its shape moves: a worn park looks greyer and rougher), plus ONE small instanced mesh of
 * pipe riders (1 draw call) carving the Halfpipe beside a park while freestylers are about. Read-only: everything comes from `SnowPark`. The airs of the riders themselves are
 * computed by `airFor` (a pure function of the guest's position and the features), applied by the GuestRenderer. World-space only, no `gl_FragCoord` noise.
 */
export const FEATURE_CAP = 80;
const DIM: Record<FeatureKind, { len: number; width: number; rise: number }> = {
  kickerS: { len: 1.3, width: 1.1, rise: 0.35 }, kickerM: { len: 1.7, width: 1.4, rise: 0.6 }, kickerL: { len: 2.1, width: 1.7, rise: 0.9 },
  box: { len: 1.4, width: 0.7, rise: 0.4 }, rail: { len: 2.0, width: 0.2, rise: 0.4 },
};
const LIP: Record<string, number> = { kickerS: 0xf2c14e, kickerM: 0xf08a24, kickerL: 0xd9453a };
const SNOW = 0x6fa8e0, WORN = 0x8a6f4e;
const PIPE_RIDERS = 3;

interface Piece { geo: THREE.BufferGeometry; m: THREE.Matrix4; color: number; tint: boolean }

/** One kicker wedge along +x: a concave transition rising to `rise` at the lip, `width` across z (about 30 triangles). */
function kickerGeo(len: number, width: number, rise: number): THREE.BufferGeometry {
  const s = new THREE.Shape(), steps = 5;
  s.moveTo(-len / 2, 0); s.lineTo(len / 2, 0); s.lineTo(len / 2, rise);
  for (let i = steps - 1; i >= 0; i--) { const t = i / steps; s.lineTo(-len / 2 + len * t, rise * (1 - Math.cos(t * Math.PI / 2))); }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
  g.translate(0, 0, -width / 2);
  return g.toNonIndexed();
}

/** Pure: the vertical + spin an air at (x, y) gets from the features of `feats` (grouped by tile); null when not near one. Exported for tests. */
export function airOf(map: ReadonlyMap<number, readonly Feature[]>, size: number, x: number, y: number, id: number, out: { h: number; spin: number; slide: boolean }): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  let best = 0, spin = 0, slide = false, found = false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const fs = map.get((ty + dy) * size + (tx + dx));
    if (!fs) continue;
    for (const f of fs) {
      const rx = x - f.x, ry = y - f.y, R = PARK.reach;
      const along = rx * f.dx + ry * f.dy, lat = Math.abs(-rx * f.dy + ry * f.dx);
      if (Math.abs(along) >= R || lat >= R * 0.8) continue;
      const u = (along + R) / (2 * R), k = 4 * u * (1 - u) * (1 - lat / (R * 0.8)); // 0 at the edges, 1 over the middle: continuous, no pop
      const h = PARK.air[f.kind] * k;
      if (h > best) {
        best = h; found = true; slide = f.kind === 'box' || f.kind === 'rail';
        const turns = PARK.spin[f.kind]; const dir = ((id * 2654435761) >>> 0) & 1 ? 1 : -1;
        spin = turns * Math.PI * u * dir; // half-turns, eased across the jump
      }
    }
  }
  out.h = best; out.spin = spin; out.slide = slide;
  return found;
}

export class ParkView {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private pipeRiders: THREE.InstancedMesh;
  private mat: THREE.MeshLambertMaterial;
  private riderMat: THREE.MeshLambertMaterial;
  private riderGeo: THREE.BufferGeometry;
  private sig = ''; private shapeSig = '';
  private acc = 0; private clock = 0;
  private featureMap = new Map<number, Feature[]>();
  private pieces: Array<{ park: number; first: number; count: number }> = [];
  private pipes: Array<{ x: number; y: number; w: number; h: number }> = [];
  private colorBase: number[] = []; private tintable: boolean[] = [];
  /** Features drawn / pipe riders drawn (tests, debug). */
  featureCount = 0; riderCount = 0; tris = 0;
  private baseColors: Float32Array = new Float32Array(0);

  constructor(private grid: Grid, private park: SnowPark, private ridersNow: () => number = () => 0) {
    this.group.name = 'snowPark';
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true }); this.mat.name = 'parkFeatures';
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat); this.mesh.name = 'parkFeatures'; this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.visible = false;
    this.group.add(this.mesh);
    // a pipe rider: body, head, board (box figure, ~36 triangles)
    const parts: THREE.BufferGeometry[] = [];
    const body = new THREE.BoxGeometry(0.16, 0.3, 0.12); body.translate(0, 0.33, 0); parts.push(body);
    const head = new THREE.BoxGeometry(0.12, 0.12, 0.12); head.translate(0, 0.54, 0); parts.push(head);
    const board = new THREE.BoxGeometry(0.1, 0.03, 0.5); board.translate(0, 0.1, 0); parts.push(board);
    this.riderGeo = mergeSimple(parts);
    this.riderMat = new THREE.MeshLambertMaterial({ color: 0xd63fa0 }); this.riderMat.name = 'parkPipeRider';
    this.pipeRiders = new THREE.InstancedMesh(this.riderGeo, this.riderMat, PIPE_RIDERS * PARK.maxParks);
    this.pipeRiders.name = 'parkPipeRiders'; this.pipeRiders.count = 0; this.pipeRiders.frustumCulled = false; this.pipeRiders.castShadow = true;
    this.group.add(this.pipeRiders);
  }

  /** The features near a tile are looked up through this map (the guest renderer's air hook). */
  airFor(x: number, y: number, id: number, out: { h: number; spin: number; slide: boolean }): boolean {
    return this.featureMap.size > 0 && airOf(this.featureMap, this.grid.size, x, y, id, out);
  }

  update(dt: number): void {
    this.clock += dt; this.acc += dt;
    this.animatePipe();
    if (this.acc < 0.4) return;
    this.acc = 0;
    const list = this.park.parks().filter((p) => p.valid);
    const sig = list.map((p) => `${p.id}:${p.run.tiles.length}:${p.run.poly.length}:${p.run.difficulty}:${p.pipe ? `${p.pipe.x},${p.pipe.y}` : ''}`).join('|');
    if (sig !== this.sig) { this.sig = sig; this.rebuild(list); this.shapeSig = ''; }
    const ssig = list.map((p) => Math.round(p.shape * 20)).join(',');
    if (ssig !== this.shapeSig) { this.shapeSig = ssig; this.retint(list); }
  }

  private rebuild(list: readonly ParkInfo[]): void {
    const pieces: Piece[] = [], owners: number[] = [];
    this.featureMap.clear(); this.pieces = []; this.pipes = [];
    const g = this.grid, n = g.size, q = new THREE.Quaternion(), qy = new THREE.Quaternion(), qz = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), fw = new THREE.Vector3(0, 0, 1);
    let count = 0;
    const geos = new Map<string, THREE.BufferGeometry>();
    const geo = (k: string, f: () => THREE.BufferGeometry): THREE.BufferGeometry => { let v = geos.get(k); if (!v) { v = f(); geos.set(k, v); } return v; };
    for (const pk of list) {
      const first = pieces.length;
      for (const f of parkFeatures(pk.run, n)) {
        if (count >= FEATURE_CAP) break;
        count++;
        const key = Math.floor(f.y) * n + Math.floor(f.x);
        const arr = this.featureMap.get(key); if (arr) arr.push(f); else this.featureMap.set(key, [f]);
        const d = DIM[f.kind];
        const h0 = surfaceHeightAt(g, f.x - f.dx * d.len / 2, f.y - f.dy * d.len / 2), h1 = surfaceHeightAt(g, f.x + f.dx * d.len / 2, f.y + f.dy * d.len / 2);
        const pitch = Math.atan2(h1 - h0, d.len), yaw = -Math.atan2(f.dy, f.dx);
        qy.setFromAxisAngle(up, yaw); qz.setFromAxisAngle(fw, 0); q.copy(qy);
        const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch); q.multiply(pitchQ);
        const cy = surfaceHeightAt(g, f.x, f.y);
        p.set(f.x, cy, f.y);
        const m = new THREE.Matrix4().compose(p, q, sc);
        const T = (x: number, y: number, z: number): THREE.Matrix4 => m.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z));
        if (f.kind === 'box') {
          pieces.push({ geo: geo('boxBody', () => new THREE.BoxGeometry(1, 1, 1).toNonIndexed()), m: T(0, d.rise / 2 - 0.02, 0).multiply(new THREE.Matrix4().makeScale(d.len, d.rise, d.width)), color: 0x8e5bd0, tint: false });
          pieces.push({ geo: geo('boxTop', () => new THREE.BoxGeometry(1, 1, 1).toNonIndexed()), m: T(0, d.rise, 0).multiply(new THREE.Matrix4().makeScale(d.len + 0.04, 0.04, d.width + 0.04)), color: 0xf2c14e, tint: false });
        } else if (f.kind === 'rail') {
          pieces.push({ geo: geo('railBar', () => new THREE.BoxGeometry(1, 1, 1).toNonIndexed()), m: T(0, d.rise, 0).multiply(new THREE.Matrix4().makeScale(d.len, 0.05, 0.05)), color: 0x8a9099, tint: false });
          for (const x of [-d.len / 2 + 0.1, d.len / 2 - 0.1]) pieces.push({ geo: geo('railLeg', () => new THREE.BoxGeometry(1, 1, 1).toNonIndexed()), m: T(x, d.rise / 2, 0).multiply(new THREE.Matrix4().makeScale(0.05, d.rise, 0.05)), color: 0x2a2a2e, tint: false });
        } else {
          pieces.push({ geo: geo(f.kind, () => kickerGeo(d.len, d.width, d.rise)), m, color: SNOW, tint: true });
          pieces.push({ geo: geo('lip', () => new THREE.BoxGeometry(1, 1, 1).toNonIndexed()), m: T(d.len / 2 - 0.03, d.rise - 0.015, 0).multiply(new THREE.Matrix4().makeScale(0.07, 0.04, d.width + 0.02)), color: LIP[f.kind]!, tint: false });
        }
      }
      if (pk.pipe) this.pipes.push({ x: pk.pipe.x, y: pk.pipe.y, w: pk.pipe.w, h: pk.pipe.h });
      this.pieces.push({ park: pk.id, first, count: pieces.length - first });
      for (let i = first; i < pieces.length; i++) owners.push(pk.id);
    }
    this.featureCount = count;
    // merge: transform each piece, colours per vertex (tintable ones are re-coloured by `retint`)
    let verts = 0; for (const pc of pieces) verts += pc.geo.getAttribute('position').count;
    const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), col = new Float32Array(verts * 3);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3(), c = new THREE.Color();
    let o = 0; this.colorBase = []; this.tintable = [];
    for (const pc of pieces) {
      const pa = pc.geo.getAttribute('position'), na = pc.geo.getAttribute('normal');
      nm.getNormalMatrix(pc.m); c.setHex(pc.color);
      const start = o;
      for (let i = 0; i < pa.count; i++, o++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(pc.m); pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
        v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); nor[o * 3] = v.x; nor[o * 3 + 1] = v.y; nor[o * 3 + 2] = v.z;
        col[o * 3] = c.r; col[o * 3 + 1] = c.g; col[o * 3 + 2] = c.b;
      }
      this.colorBase.push(start, o - start); this.tintable.push(pc.tint);
    }
    this.baseColors = col.slice();
    this.mesh.geometry.dispose();
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bg.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); bg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.mesh.geometry = bg; this.mesh.visible = verts > 0;
    this.tris = verts / 3;
    this.ownerOfPiece = owners;
    for (const gm of geos.values()) gm.dispose();
  }
  private ownerOfPiece: number[] = [];

  /** Worn parks look greyer / brown: the tintable pieces blend from snow white-blue to a dirty tone by (1 - shape). */
  private retint(list: readonly ParkInfo[]): void {
    const attr = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const a = attr.array as Float32Array, shapeOf = new Map(list.map((p) => [p.id, p.shape])), snow = new THREE.Color(SNOW), worn = new THREE.Color(WORN), c = new THREE.Color();
    for (let k = 0; k < this.tintable.length; k++) {
      if (!this.tintable[k]) continue;
      const start = this.colorBase[k * 2]!, cnt = this.colorBase[k * 2 + 1]!, s = shapeOf.get(this.ownerOfPiece[k]!) ?? 1;
      c.copy(snow).lerp(worn, Math.min(1, Math.max(0, 1 - s)) * 0.85);
      for (let i = start; i < start + cnt; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    }
    attr.needsUpdate = true;
  }

  /** Pipe riders: up to three per Halfpipe, only while freestylers are about, carving back and forth along the channel (render only; deterministic from the clock). */
  private animatePipe(): void {
    const on = this.pipes.length > 0 && this.ridersNow() > 0;
    if (!on) { this.pipeRiders.count = 0; this.riderCount = 0; return; }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (const pp of this.pipes) {
      const cx = pp.x + pp.w / 2, cz = pp.y + pp.h / 2, len = pp.h - 0.6, half = pp.w / 2 - 0.3;
      for (let r = 0; r < PIPE_RIDERS && n < this.pipeRiders.instanceMatrix.count; r++) {
        const t = this.clock * 0.45 + r / PIPE_RIDERS, along = (t % 1), x = Math.sin(t * Math.PI * 6) * half, z = (along - 0.5) * len;
        const wall = Math.abs(x) / half, y = surfaceHeightAt(this.grid, cx, cz) + 0.06 + wall * wall * 0.42 + Math.max(0, wall - 0.7) * 3 * Math.abs(Math.sin(t * Math.PI * 6 + 1)) * 0.25;
        p.set(cx + x, y, cz + z);
        e.set(0, 0, -Math.cos(t * Math.PI * 6) * 0.5 * Math.sign(x)); // lean into the wall
        q.setFromEuler(e); m.compose(p, q, sc); this.pipeRiders.setMatrixAt(n++, m);
      }
    }
    this.pipeRiders.count = n; this.riderCount = n; this.pipeRiders.instanceMatrix.needsUpdate = true;
  }

  /** Triangles drawn (tests: the budget). */
  triangles(): number { return this.tris + this.riderCount * 12 * 3; }
  dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); this.riderMat.dispose(); this.riderGeo.dispose(); }
}

function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let verts = 0; const ng = parts.map((p) => p.toNonIndexed());
  for (const p of ng) verts += p.getAttribute('position').count;
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3);
  let o = 0;
  for (const p of ng) { const pa = p.getAttribute('position'), na = p.getAttribute('normal'); for (let i = 0; i < pa.count; i++, o++) { pos.set([pa.getX(i), pa.getY(i), pa.getZ(i)], o * 3); nor.set([na.getX(i), na.getY(i), na.getZ(i)], o * 3); } p.dispose(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
