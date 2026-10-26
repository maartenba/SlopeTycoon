import * as THREE from 'three';

/** Pure: ring / disc vertices around (cx, cz) with heights from `ground` (draped on the terrain). Returns [x, y, z, ...] for `seg` points at radius r. */
export function drapedCircle(cx: number, cz: number, r: number, seg: number, ground: (x: number, z: number) => number, lift = 0.04): number[] {
  const out: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    out.push(x, ground(x, z) + lift, z);
  }
  return out;
}

export const DROP_OK = 0x4ade80, DROP_BLOCKED = 0xf87171;
const SEG = 40;

/** Walk 'choose start' marker on the terrain: a ring draped on the surface around the hovered tile (green = walkable, red = blocked) plus a small
 *  dim ring at the snapped target when the hovered tile is blocked. Render-only; 2 meshes, geometry rewritten in place. */
export class DropRing {
  readonly group = new THREE.Group();
  private ring: THREE.Mesh; private snap: THREE.Mesh; private fill: THREE.Mesh;
  private mats: THREE.MeshBasicMaterial[] = [];
  constructor(private ground: (x: number, z: number) => number) {
    const mk = (opacity: number): THREE.Mesh => {
      const mat = new THREE.MeshBasicMaterial({ color: DROP_OK, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, opacity });
      this.mats.push(mat);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEG * 2 * 3), 3));
      const idx: number[] = [];
      for (let i = 0; i < SEG; i++) { const a = i * 2, b = ((i + 1) % SEG) * 2; idx.push(a, a + 1, b, b, a + 1, b + 1); }
      g.setIndex(idx);
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 30; return m;
    };
    this.ring = mk(0.95); this.snap = mk(0.55);
    const fm = new THREE.MeshBasicMaterial({ color: DROP_OK, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, opacity: 0.22 });
    this.mats.push(fm);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
    const fi: number[] = []; for (let i = 0; i < SEG; i++) fi.push(SEG, i, (i + 1) % SEG);
    fg.setIndex(fi);
    this.fill = new THREE.Mesh(fg, fm); this.fill.frustumCulled = false; this.fill.renderOrder = 29;
    this.group.add(this.fill, this.ring, this.snap);
    this.group.visible = false; this.group.name = 'walkDropRing';
  }
  private write(m: THREE.Mesh, cx: number, cz: number, r0: number, r1: number): void {
    const a = (m.geometry.getAttribute('position') as THREE.BufferAttribute), o = drapedCircle(cx, cz, r0, SEG, this.ground), p = drapedCircle(cx, cz, r1, SEG, this.ground);
    for (let i = 0; i < SEG; i++) { a.setXYZ(i * 2, o[i * 3]!, o[i * 3 + 1]!, o[i * 3 + 2]!); a.setXYZ(i * 2 + 1, p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!); }
    a.needsUpdate = true;
  }
  /** Show the ring at tile (tx, ty); `ok` colours it; `snapTo` (a free tile centre) adds the snap hint when the tile is blocked. */
  set(tx: number, ty: number, ok: boolean, snapTo: { x: number; z: number } | null): void {
    const c = ok ? DROP_OK : DROP_BLOCKED, cx = tx + 0.5, cz = ty + 0.5;
    this.mats[0]!.color.setHex(c); this.mats[2]!.color.setHex(c); this.mats[1]!.color.setHex(DROP_OK);
    this.write(this.ring, cx, cz, 0.38, 0.48);
    const f = this.fill.geometry.getAttribute('position') as THREE.BufferAttribute, d = drapedCircle(cx, cz, 0.38, SEG, this.ground);
    for (let i = 0; i < SEG; i++) f.setXYZ(i, d[i * 3]!, d[i * 3 + 1]!, d[i * 3 + 2]!);
    f.setXYZ(SEG, cx, this.ground(cx, cz) + 0.04, cz); f.needsUpdate = true;
    if (!ok && snapTo) { this.write(this.snap, snapTo.x, snapTo.z, 0.2, 0.28); this.snap.visible = true; } else this.snap.visible = false;
    this.group.visible = true;
  }
  hide(): void { this.group.visible = false; }
  dispose(): void { for (const m of [this.ring, this.snap, this.fill]) m.geometry.dispose(); for (const m of this.mats) m.dispose(); }
}
