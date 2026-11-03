import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Minimum thickness (diameter / side) of any thin building or prop part: thinner features alias and shimmer when rotating (docs/flicker.md). */
export const MIN_THIN = 0.03;

export type Layer = 'wood' | 'stone' | 'roof' | 'sign' | 'glass';

export const C = {
  cream: 0xf4e4c1, red: 0xd9453a, blue: 0x4a90d9, yellow: 0xf2c14e, green: 0x5cb85c, orange: 0xf08a24,
  wood: 0xb5773f, dark: 0x7a4a24, stone: 0xaaaeb2, white: 0xfafafa, glass: 0x6fb7e0, asphalt: 0x4b4f57,
  roofRed: 0xa9574c, roofBlue: 0x5c7a9c, roofBrown: 0x86604a, roofGreen: 0x578267, sand: 0xf0d9a0,
  water: 0x3fa7d6, black: 0x2a2a2e, pink: 0xf06292, purple: 0x8e5bd0, grey: 0x8a9099,
};

/** Chamfered box (bevelled edges): 6 inset faces + 12 edge strips + 8 corner triangles = 44 triangles, UVs per face. Pure geometry helper (exported for tests). */
export function chamferBox(sx: number, sy: number, sz: number, c: number): THREE.BufferGeometry {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2, ix = hx - c, iy = hy - c, iz = hz - c;
  const pos: number[] = [], uv: number[] = [];
  const tri = (a: number[], b: number[], d: number[]): void => { pos.push(...a, ...b, ...d); uv.push(a[0]! + a[2]!, a[1]!, b[0]! + b[2]!, b[1]!, d[0]! + d[2]!, d[1]!); };
  const quad = (a: number[], b: number[], d: number[], e: number[]): void => { tri(a, b, d); tri(a, d, e); };
  const X = [-1, 1], P = (i: number, j: number, k: number, ex: number, ey: number, ez: number): number[] => [i * (ex ? hx : ix), j * (ey ? hy : iy), k * (ez ? hz : iz)];
  // faces (outward winding is fixed by normals recompute below via orientation of the quad vertex order)
  for (const i of X) quad(P(i, -1, -1, 1, 0, 0), P(i, 1, -1, 1, 0, 0), P(i, 1, 1, 1, 0, 0), P(i, -1, 1, 1, 0, 0));
  for (const j of X) quad(P(-1, j, -1, 0, 1, 0), P(-1, j, 1, 0, 1, 0), P(1, j, 1, 0, 1, 0), P(1, j, -1, 0, 1, 0));
  for (const k of X) quad(P(-1, -1, k, 0, 0, 1), P(1, -1, k, 0, 0, 1), P(1, 1, k, 0, 0, 1), P(-1, 1, k, 0, 0, 1));
  // edges along x, y, z
  for (const j of X) for (const k of X) quad(P(-1, j, k, 0, 1, 0), P(1, j, k, 0, 1, 0), P(1, j, k, 0, 0, 1), P(-1, j, k, 0, 0, 1));
  for (const i of X) for (const k of X) quad(P(i, -1, k, 1, 0, 0), P(i, 1, k, 1, 0, 0), P(i, 1, k, 0, 0, 1), P(i, -1, k, 0, 0, 1));
  for (const i of X) for (const j of X) quad(P(i, j, -1, 1, 0, 0), P(i, j, 1, 1, 0, 0), P(i, j, 1, 0, 1, 0), P(i, j, -1, 0, 1, 0));
  for (const i of X) for (const j of X) for (const k of X) tri(P(i, j, k, 1, 0, 0), P(i, j, k, 0, 1, 0), P(i, j, k, 0, 0, 1));
  // fix winding so that every triangle's geometric normal points away from the centre
  for (let t = 0; t < pos.length; t += 9) {
    const a = new THREE.Vector3(pos[t], pos[t + 1], pos[t + 2]), b = new THREE.Vector3(pos[t + 3], pos[t + 4], pos[t + 5]), d = new THREE.Vector3(pos[t + 6], pos[t + 7], pos[t + 8]);
    const n = b.clone().sub(a).cross(d.clone().sub(a)), cen = a.clone().add(b).add(d).divideScalar(3);
    if (n.dot(cen) < 0) { for (let q = 0; q < 3; q++) { const tmp = pos[t + 3 + q]!; pos[t + 3 + q] = pos[t + 6 + q]!; pos[t + 6 + q] = tmp; } }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** UV of a light, plain texel in the stone texture (row 0 cell): a seamless white-grey surface for snow hills / piles (no mortar lines, no roof hue tint). */
export const FLAT_SNOW_UV: readonly [number, number] = [0.156, 0.875];
export interface PartOpts { rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number; /** sample ONE texel for every vertex (a seamless plain surface on a textured layer; M8 lane G) */ flatUv?: readonly [number, number] }

export interface SignSpec { text: string; bg: string; fg: string; geometry: THREE.BufferGeometry }
export interface BuiltParts {
  wood?: THREE.BufferGeometry; stone?: THREE.BufferGeometry; roof?: THREE.BufferGeometry; /** Translucent pane layer (lift carriers only). */ glass?: THREE.BufferGeometry; sign?: SignSpec;
}

/** Per-box growth (model units) that breaks ties between coplanar faces of different boxes: strictly increasing with the box index, then capped. */
export const BOX_GROW_STEP = 0.00004;
export const BOX_GROW_MAX = 0.008;
export function boxGrow(index: number): number { return Math.min(BOX_GROW_MAX, BOX_GROW_STEP * index); }

/** Collects coloured primitives per layer; origin is the footprint centre at ground level (x: width, z: depth). */
export class PartBuilder {
  private parts: Record<Layer, THREE.BufferGeometry[]> = { wood: [], stone: [], roof: [], sign: [], glass: [] };
  private boxCount = 0;
  private signText: { text: string; bg: string; fg: string } | null = null;
  constructor(readonly w: number, readonly h: number) {}

  add(g: THREE.BufferGeometry, layer: Layer, color: number, x: number, y: number, z: number, o: PartOpts = {}): this {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ')),
      new THREE.Vector3(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1),
    );
    geo.applyMatrix4(m);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) { if (o.flatUv) uv.setXY(i, o.flatUv[0], o.flatUv[1]); else uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2); }
    const col = new THREE.Color(color);
    const arr = new Float32Array(geo.getAttribute('position').count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = col.r; arr[i + 1] = col.g; arr[i + 2] = col.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts[layer].push(geo);
    return this;
  }

  /** Box with its bottom-centre at (cx, y0, cz). */
  box(cx: number, y0: number, cz: number, sx0: number, sy0: number, sz0: number, color: number, layer: Layer = 'wood', o: PartOpts = {}): this {
    // Anti z-fight: every box grows by a tiny, strictly increasing amount (later parts protrude 0.04 mm-units more than earlier ones, capped at BOX_GROW_MAX).
    // Coplanar faces of overlapping boxes (e.g. a wing bay's end wall flush with the hall's end wall) then resolve to the later part in every view instead of shimmering under camera motion.
    const e = boxGrow(this.boxCount++), sx = sx0 + 2 * e, sy = sy0 + 2 * e, sz = sz0 + 2 * e;
    const m = Math.min(sx, sy, sz);
    // big solid blocks (walls, bodies, bases) get a small chamfer so silhouettes catch the light; thin slabs / trim stay plain
    const geo = m >= 0.2 && sx * sy * sz >= 0.02 ? chamferBox(sx, sy, sz, Math.min(0.05, m * 0.14)) : new THREE.BoxGeometry(sx, sy, sz);
    return this.add(geo, layer, color, cx, y0 + sy0 / 2, cz, o);
  }
  /** Square-section beam between two points (lattice members, braces, cables). */
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, color: number, layer: Layer = 'stone'): this {
    const d = new THREE.Vector3(bx - ax, by - ay, bz - az);
    const len = d.length();
    if (len < 1e-6) return this;
    const tt = Math.max(t, MIN_THIN);
    const g = new THREE.BoxGeometry(tt, tt, len);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, new THREE.Vector3(1, 1, 1)));
    return this.add(g, layer, color, 0, 0, 0);
  }
  ball(cx: number, y0: number, cz: number, r: number, color: number, layer: Layer = 'wood', seg = 8, o: PartOpts = {}): this {
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(3, seg - 2)), layer, color, cx, y0 + r, cz, o);
  }
  /** Flat ring (torus lying in the xz plane), centre-line radius R and tube radius t. */
  ring(cx: number, y0: number, cz: number, R: number, t: number, color: number, layer: Layer = 'stone', seg = 24, o: PartOpts = {}): this {
    return this.add(new THREE.TorusGeometry(R, t, 5, seg), layer, color, cx, y0 + t, cz, { rx: Math.PI / 2, ...o });
  }
  cyl(cx: number, y0: number, cz: number, r: number, hgt: number, color: number, layer: Layer = 'wood', seg = 12, o: PartOpts = {}): this {
    return this.add(new THREE.CylinderGeometry(r, r, hgt, seg), layer, color, cx, y0 + hgt / 2, cz, o);
  }
  cone(cx: number, y0: number, cz: number, r: number, hgt: number, color: number, layer: Layer = 'roof', seg = 12, o: PartOpts = {}): this {
    return this.add(new THREE.ConeGeometry(r, hgt, seg), layer, color, cx, y0 + hgt / 2, cz, o);
  }
  /** Extruded triangular gable roof. Ridge runs along x when `ridgeX`, else along z. Width = span across the slope. */
  gable(cx: number, y0: number, cz: number, span: number, len: number, rise: number, color: number, ridgeX = true, layer: Layer = 'roof'): this {
    // roof sheet with eave thickness (a lip below the slope at the eaves) and a small bevel along the ridge/verge edges
    const s = new THREE.Shape(), hs = span / 2, t = Math.min(0.06, rise * 0.3);
    s.moveTo(-hs, -0.02); s.lineTo(hs, -0.02); s.lineTo(hs, t); s.lineTo(0, rise); s.lineTo(-hs, t); s.closePath();
    const bv = 0.028;
    const g = new THREE.ExtrudeGeometry(s, { depth: len - bv * 2, bevelEnabled: true, bevelThickness: bv, bevelSize: bv * 0.9, bevelSegments: 2 });
    g.translate(0, 0, -(len - bv * 2) / 2);
    return this.add(g, layer, color, cx, y0, cz, { ry: ridgeX ? Math.PI / 2 : 0 });
  }
  /** Right-angle wedge (ramp) rising along +x over `len`; width along z. */
  wedge(cx: number, y0: number, cz: number, len: number, rise: number, width: number, color: number, ry = 0, layer: Layer = 'wood'): this {
    const s = new THREE.Shape();
    s.moveTo(-len / 2, 0); s.lineTo(len / 2, 0); s.lineTo(len / 2, rise); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
    g.translate(0, 0, -width / 2);
    return this.add(g, layer, color, cx, y0, cz, { ry });
  }
  /** Window pane on a wall facing n(-z) s(+z) e(+x) w(-x), centred at the wall point. */
  win(x: number, y: number, z: number, face: 'n' | 's' | 'e' | 'w', color = C.glass, size = 0.2): this {
    const ns = face === 'n' || face === 's';
    return this.box(x, y, z, ns ? size : 0.05, size * 1.2, ns ? 0.05 : size, color);
  }
  /** Rail along a line with posts. */
  fence(x0: number, z0: number, x1: number, z1: number, color = C.wood, hgt = 0.3, posts = 4): this {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ang = Math.atan2(-(z1 - z0), x1 - x0);
    this.box((x0 + x1) / 2, hgt * 0.7, (z0 + z1) / 2, len, 0.045, 0.045, color, 'wood', { ry: ang });
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      this.box(x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t, 0.06, hgt, 0.06, color);
    }
    return this;
  }
  sign(text: string, cx: number, cy: number, cz: number, sx: number, sy: number, ry = 0, bg = '#7a4a24', fg = '#fff4d6'): this {
    if (this.signText && this.signText.text !== text) throw new Error('one sign text per building');
    this.signText = { text, bg, fg };
    return this.add(new THREE.PlaneGeometry(sx, sy), 'sign', 0xffffff, cx, cy, cz, { ry });
  }

  finish(): BuiltParts {
    const out: BuiltParts = {};
    for (const l of ['wood', 'stone', 'roof', 'glass'] as const) {
      if (this.parts[l].length) out[l] = mergeGeometries(this.parts[l], false) ?? undefined;
    }
    if (this.parts.sign.length && this.signText) {
      out.sign = { ...this.signText, geometry: mergeGeometries(this.parts.sign, false)! };
    }
    return out;
  }
}

/** `depth` = how far below the origin the ground can fall under the footprint (only passed to `rooted` entries: they grow roots / a trunk down to it instead of standing on a plinth). */
export type BuildFn = (b: PartBuilder, w: number, h: number, depth?: number) => void;
/** `rooted`: a tree-borne building (treehouse): seated at the MIDDLE of the footprint's corner range, trunks reach down to the lowest corner, no stone plinth / retaining skirt. */
export interface BuilderEntry { build: BuildFn; foundation: boolean; rooted?: boolean }

/** Gabled house with framed door and windows on the +z face and a window on each gable end. Returns wall top y. */
export function house(b: PartBuilder, cx: number, cz: number, w: number, d: number, wallH: number, wall: number, roof: number, rise: number, ridgeX = true, shutter = 0.07): number {
  b.box(cx, 0, cz, w, wallH, d, wall);
  b.gable(cx, wallH, cz, ridgeX ? d + 0.2 : w + 0.2, ridgeX ? w + 0.2 : d + 0.2, rise, roof, ridgeX);
  b.box(cx, wallH + rise - 0.02, cz, ridgeX ? w + 0.24 : 0.05, 0.04, ridgeX ? 0.05 : d + 0.24, C.dark, 'roof'); // ridge beam
  doorway(b, cx + (w > 1.2 ? w * 0.22 : 0), cz + d / 2, 's', 0.28, Math.min(0.5, wallH * 0.72));
  const n = Math.max(1, Math.floor(w / 0.9));
  for (let i = 0; i < n; i++) {
    const x = cx - w / 2 + (w / n) * (i + 0.5) - (w > 1.2 ? w * 0.08 : 0);
    if (Math.abs(x - (cx + (w > 1.2 ? w * 0.22 : 0))) > 0.4) frameWin(b, x, wallH * 0.4, cz + d / 2, 's', 0.18, shutter);
  }
  for (const sx of [-1, 1]) frameWin(b, cx + sx * w / 2, wallH * 0.4, cz, sx < 0 ? 'w' : 'e', 0.18);
  return wallH;
}

export function balcony(b: PartBuilder, cx: number, y: number, cz: number, w: number, depth: number, color = C.wood): void {
  b.box(cx, y, cz, w, 0.06, depth, color);
  b.cyl(cx, y + 0.22 - w / 2, cz + depth / 2 - 0.02, 0.022, w, color, 'wood', 6, { rz: Math.PI / 2 }); // round top rail (M8)
  b.box(cx, y + 0.07, cz + depth / 2 - 0.02, w, 0.035, 0.035, color);
  for (let i = 0; i <= 4; i++) b.box(cx - w / 2 + (w * i) / 4, y + 0.06, cz + depth / 2 - 0.02, 0.04, 0.17, 0.04, color);
  for (const sx of [-1, 1]) b.beam(cx + sx * (w / 2 - 0.1), y - 0.0, cz + depth / 2 - 0.02, cx + sx * (w / 2 - 0.1), y - 0.1, cz - depth / 2 + 0.0, 0.03, color, 'wood'); // slanted support strut under the slab
}

export function awning(b: PartBuilder, cx: number, y: number, cz: number, w: number, depth: number, c1 = C.red, c2 = C.white): void {
  const n = Math.max(2, Math.round(w / 0.25));
  for (let i = 0; i < n; i++) b.box(cx - w / 2 + (w / n) * (i + 0.5), y, cz, w / n, 0.05, depth, i % 2 ? c2 : c1, 'roof', { rx: 0.25 });
}

/** Stone chimney with a darker cap; the top of the cap is exactly y + hgt (smoke emits from there). */
export function chimney(b: PartBuilder, x: number, y: number, z: number, hgt = 0.5): void {
  b.cyl(x, y, z, 0.105, hgt - 0.05, C.stone, 'stone', 12);
  b.cyl(x, y + hgt - 0.05, z, 0.14, 0.05, C.dark, 'stone', 12);
}

export function redCross(b: PartBuilder, x: number, y: number, z: number, size: number, face: 's' | 'n' | 'e' | 'w' = 's'): void {
  const ns = face === 's' || face === 'n';
  const t = size * 0.3, th = 0.03;
  b.box(x, y, z, ns ? size : th, size, ns ? th : size, C.white);
  b.box(x, y + size / 2 - t / 2, z, ns ? size * 0.9 : th + 0.01, t, ns ? th + 0.01 : size * 0.9, C.red);
  b.box(x, y + size * 0.05, z, ns ? t : th + 0.01, size * 0.9, ns ? th + 0.01 : t, C.red);
}

// ---------------------------------------------------------------------------------------------
// Detail helpers (shared by buildings): framed windows, doors, timber framing, dormers, props.
// ---------------------------------------------------------------------------------------------
export type Face = 'n' | 's' | 'e' | 'w';
const FACE_VEC: Record<Face, readonly [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const isNS = (f: Face): boolean => f === 'n' || f === 's';

/** Thin slab hugging a wall: (x,z) is the wall point, `out` how far the slab centre sits out of the wall. */
export function wallSlab(b: PartBuilder, x: number, y: number, z: number, face: Face, along: number, hgt: number, thick: number, out: number, color: number, layer: Layer = 'wood'): void {
  const [fx, fz] = FACE_VEC[face];
  const ns = isNS(face);
  b.box(x + fx * out, y, z + fz * out, ns ? along : thick, hgt, ns ? thick : along, color, layer);
}

/** Shutter paint colours (muted so roofs / walls stay the hero). */
const SHUTTERS = [C.roofGreen, 0x4f6f8f, 0xa9574c, 0x8a6a3a, 0x6b4f7a, 0xd8b45a];
const FLOWER_BOX = [0xe0607e, 0xf2c14e, 0xf4efe2, 0xd9453a, 0x9a6bd0];
/** Framed window: trim frame, warm-glass pane (C.glass vertex colour = night glow), sill and optional shutters. */
export function frameWin(b: PartBuilder, x: number, y: number, z: number, face: Face, size = 0.22, shutter = 0, trim = C.cream, shutterColor?: number): void {
  const hgt = size * 1.2;
  const hv = hash01(`${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)},${face}`, 313);
  wallSlab(b, x, y - 0.04, z, face, size + 0.09, hgt + 0.08, 0.04, 0.0, trim);
  wallSlab(b, x, y, z, face, size, hgt, 0.05, 0.015, C.glass);
  wallSlab(b, x, y - 0.07, z, face, size + 0.12, 0.035, 0.1, 0.03, trim);
  if (size >= 0.19 && (face === 's' || shutter > 0)) wallSlab(b, x, y, z, face, 0.022, hgt, 0.06, 0.03, trim); // central glazing bar (M8): splits the pane (and its night glow) in two
  if (shutter > 0) {
    const [fx, fz] = FACE_VEC[face];
    shutterColor ??= SHUTTERS[Math.floor(hv * SHUTTERS.length)]!;
    const off = size / 2 + shutter / 2 + 0.05;
    for (const s of [-1, 1]) {
      const px = isNS(face) ? x + s * off : x, pz = isNS(face) ? z : z + s * off;
      wallSlab(b, px, y - 0.04, pz, face, shutter, hgt + 0.08, 0.03, 0.0, shutterColor);
      void fx; void fz;
    }
    // window flower box under shuttered front windows (blooms read as snow-capped in winter through the roof / up-face snow shader)
    if (face === 's' && hash01(`${x.toFixed(2)},${z.toFixed(2)}`, 41) > 0.3) {
      wallSlab(b, x, y - 0.12, z, face, size + 0.1, 0.07, 0.08, 0.05, C.dark);
      wallSlab(b, x, y - 0.075, z, face, size + 0.04, 0.035, 0.07, 0.05, FLOWER_BOX[Math.floor(hash01(`${x.toFixed(2)}${z.toFixed(2)}`, 59) * FLOWER_BOX.length)]!);
    }
  }
}

/** Door with lintel, frame and a stone step. */
export function doorway(b: PartBuilder, x: number, z: number, face: Face, w = 0.32, hgt = 0.52, color = C.dark, trim = C.cream): void {
  // arched head: rectangle up to the springing line, half-round (a short cylinder along the wall normal) above it
  const sp = Math.max(0.1, hgt - w / 2), ns = isNS(face);
  wallSlab(b, x, 0, z, face, w + 0.1, sp + 0.03, 0.04, 0.0, trim);
  wallSlab(b, x, 0, z, face, w, sp, 0.06, 0.015, color);
  b.add(new THREE.CylinderGeometry(w / 2 + 0.05, w / 2 + 0.05, 0.04, 12), 'wood', trim, x, sp, z, ns ? { rx: Math.PI / 2 } : { rz: Math.PI / 2 });
  b.add(new THREE.CylinderGeometry(w / 2, w / 2, 0.06, 12), 'wood', color, x + (ns ? 0 : (face === 'e' ? 0.015 : -0.015)), sp, z + (ns ? (face === 's' ? 0.015 : -0.015) : 0), ns ? { rx: Math.PI / 2 } : { rz: Math.PI / 2 });
  wallSlab(b, x, 0, z, face, w + 0.2, 0.05, 0.2, 0.1, C.stone, 'stone');
  wallSlab(b, x + (isNS(face) ? w * 0.3 : 0), 0.22, z + (isNS(face) ? 0 : w * 0.3), face, 0.04, 0.04, 0.03, 0.05, C.yellow);
}

/** Exposed timber framing (posts + beams) on the four wall faces of a box. */
export function timberFrame(b: PartBuilder, cx: number, cz: number, w: number, d: number, y0: number, hgt: number, color = C.dark, spacing = 0.7): void {
  for (const face of ['n', 's'] as const) {
    const zz = cz + (face === 's' ? d / 2 : -d / 2);
    const n = Math.max(2, Math.round(w / spacing));
    for (let i = 0; i <= n; i++) b.box(cx - w / 2 + (w * i) / n, y0, zz + (face === 's' ? 0.012 : -0.012), 0.06, hgt, 0.03, color);
    b.box(cx, y0 + hgt - 0.05, zz + (face === 's' ? 0.012 : -0.012), w, 0.06, 0.03, color);
    b.box(cx, y0, zz + (face === 's' ? 0.012 : -0.012), w, 0.05, 0.03, color);
  }
  for (const xx of [cx - w / 2, cx + w / 2]) {
    const n = Math.max(2, Math.round(d / spacing));
    for (let i = 0; i <= n; i += n) b.box(xx + (xx < cx ? -0.012 : 0.012), y0, cz - d / 2 + (d * i) / n, 0.03, hgt, 0.06, color);
    b.box(xx + (xx < cx ? -0.012 : 0.012), y0 + hgt - 0.05, cz, 0.03, 0.06, d, color);
  }
}

/** Height of a gable roof surface at depth offset dz from the ridge. */
export const roofHeightAt = (span: number, rise: number, dz: number): number => rise * Math.max(0, 1 - Math.abs(dz) / (span / 2));

/** Small dormer on the +z slope of an x-ridge gable roof whose eave sits at `eaveY`. */
export function dormer(b: PartBuilder, x: number, eaveY: number, ridgeZ: number, span: number, rise: number, wall = C.cream, roof = C.roofBrown): void {
  const dz = span * 0.22;
  const y = eaveY + roofHeightAt(span, rise, dz) - 0.04;
  b.box(x, y, ridgeZ + dz, 0.34, 0.28, 0.26, wall);
  b.gable(x, y + 0.28, ridgeZ + dz, 0.44, 0.34, 0.16, roof, false);
  frameWin(b, x, y + 0.04, ridgeZ + dz + 0.13, 's', 0.16);
}

export function stackedLogs(b: PartBuilder, x: number, z: number, len = 0.8): void {
  for (let row = 0; row < 3; row++) {
    const n = 3 - row;
    for (let i = 0; i < n; i++) b.cyl(x + (i - (n - 1) / 2) * 0.1, 0.05 + row * 0.085, z, 0.045, len, i % 2 ? C.wood : C.dark, 'wood', 6, { rx: Math.PI / 2 });
  }
}

/** Round table + parasol + two stools. */
export function parasolTable(b: PartBuilder, x: number, z: number, color = C.red, seed = 0): void {
  b.cyl(x, 0, z, 0.02, 0.28, C.dark, 'wood', 6);
  b.cyl(x, 0.28, z, 0.15, 0.025, C.white, 'wood', 10);
  b.cyl(x, 0.0, z, 0.02, 0.85, C.white, 'wood', 6);
  b.cone(x, 0.78, z, 0.34, 0.14, color, 'roof', 8);
  for (const s of [-1, 1]) b.cyl(x + s * 0.22, 0, z + (seed % 2 ? 0.05 : -0.05), 0.06, 0.15, C.dark, 'wood', 6);
}

export function picnicTable(b: PartBuilder, x: number, z: number, ry = 0): void {
  b.box(x, 0.18, z, 0.5, 0.03, 0.22, C.wood, 'wood', { ry });
  for (const s of [-0.18, 0.18]) b.box(x + Math.sin(ry) * 0, 0.0, z + s, 0.5, 0.1, 0.07, C.dark, 'wood', { ry });
  b.box(x, 0.02, z, 0.06, 0.16, 0.22, C.dark, 'wood', { ry });
}

const CAR_GLASS = 0x8fb4c8;
/** Little car (width along x unless rotated). */
export function car(b: PartBuilder, x: number, z: number, color: number, ry = 0, len = 0.9): void {
  b.box(x, 0.05, z, 0.46, 0.14, len, color, 'wood', { ry });
  b.box(x, 0.19, z, 0.4, 0.12, len * 0.5, CAR_GLASS, 'wood', { ry });
  b.box(x, 0.31, z, 0.42, 0.025, len * 0.52, color, 'roof', { ry });
  for (const sx of [-0.24, 0.24]) for (const sz of [-len * 0.3, len * 0.3]) {
    const px = Math.cos(ry) * sx + Math.sin(ry) * sz, pz = -Math.sin(ry) * sx + Math.cos(ry) * sz;
    b.cyl(x + px, 0.0, z + pz, 0.07, 0.06, C.black, 'wood', 6, { rz: Math.PI / 2, ry });
  }
}

export function flagPole(b: PartBuilder, x: number, z: number, hgt: number, color: number, color2?: number, y0 = 0): void {
  b.cyl(x, y0, z, 0.025, hgt, C.white, 'wood', 8);
  b.box(x + 0.14, y0 + hgt - 0.18, z, 0.26, 0.17, 0.015, color, 'roof');
  if (color2 !== undefined) b.box(x + 0.14, y0 + hgt - 0.18, z, 0.26, 0.05, 0.02, color2, 'roof');
  b.cone(x, y0 + hgt, z, 0.04, 0.06, C.yellow, 'roof', 6);
}

/** Bicycle (wheels along x... frame along z). */
export function bike(b: PartBuilder, x: number, z: number, color: number): void {
  for (const dz of [-0.17, 0.17]) b.cyl(x, 0.0, z + dz, 0.11, 0.03, C.black, 'wood', 8, { rz: Math.PI / 2 });
  b.box(x, 0.12, z, 0.03, 0.03, 0.4, color);
  b.box(x, 0.12, z + 0.17, 0.03, 0.18, 0.03, color);
  b.box(x, 0.28, z + 0.17, 0.14, 0.02, 0.03, C.dark);
}

/** Snowcat (piste groomer): tracks, body, cab (glass), blade and beacon. Front is +z before `ry`. */
export function snowcat(b: PartBuilder, x: number, z: number, ry = 0, color = C.red, scale = 1): void {
  const p = (dx: number, dz: number): [number, number] => [x + (Math.cos(ry) * dx + Math.sin(ry) * dz) * scale, z + (-Math.sin(ry) * dx + Math.cos(ry) * dz) * scale];
  const o = { ry };
  const [bx, bz] = p(0, 0);
  b.box(bx, 0.12 * scale, bz, 0.5 * scale, 0.22 * scale, 0.74 * scale, color, 'wood', o);
  const [cx, cz] = p(0, 0.12);
  b.box(cx, 0.34 * scale, cz, 0.4 * scale, 0.22 * scale, 0.34 * scale, C.glass, 'wood', o);
  b.box(cx, 0.56 * scale, cz, 0.44 * scale, 0.03 * scale, 0.38 * scale, C.dark, 'roof', o);
  for (const s of [-1, 1]) { // tracks: belt run + round sprocket / idler at each end (M8)
    const [tx, tz] = p(s * 0.27, 0);
    b.box(tx, 0.02 * scale, tz, 0.12 * scale, 0.16 * scale, 0.66 * scale, C.black, 'wood', o);
    for (const dz of [0.33, -0.33]) { const [wx, wz] = p(s * 0.27, dz); b.cyl(wx, 0.1 * scale - 0.065 * scale, wz, 0.1 * scale, 0.13 * scale, C.black, 'wood', 8, { rz: Math.PI / 2, ry }); }
  }
  const [fx, fz] = p(0, 0.5);
  b.box(fx, 0.04 * scale, fz, 0.64 * scale, 0.2 * scale, 0.05 * scale, C.orange, 'wood', o);
  const [rx, rz] = p(0, -0.42);
  b.box(rx, 0.08 * scale, rz, 0.3 * scale, 0.04 * scale, 0.12 * scale, C.grey, 'wood', o);
  b.box(bx, 0.34 * scale + 0.22 * scale, bz - 0.05 * scale, 0.06 * scale, 0.05 * scale, 0.06 * scale, C.orange, 'roof', o);
  const [lx, lz] = p(0, 0.3);
  b.box(lx, 0.56 * scale, lz, 0.3 * scale, 0.03 * scale, 0.04 * scale, C.yellow, 'roof', o); // light bar
  b.box(fx, 0.16 * scale, fz, 0.64 * scale, 0.03 * scale, 0.05 * scale, C.white, 'wood', { ry, rx: -0.5 }); // curled blade lip
}

/** Wooden ski rack with colourful skis leaning on it. */
export function skiRack(b: PartBuilder, x: number, z: number, n = 5, ry = 0): void {
  const cols = [C.red, C.yellow, C.green, C.orange, C.purple, C.pink, C.blue];
  const len = n * 0.17 + 0.1;
  b.box(x, 0.0, z, len, 0.04, 0.2, C.dark, 'wood', { ry });
  b.box(x, 0.5, z - 0.08, len, 0.04, 0.04, C.dark, 'wood', { ry });
  for (const s of [-1, 1]) b.box(x + s * len * 0.48 * Math.cos(ry), 0, z - s * len * 0.48 * Math.sin(ry), 0.04, 0.52, 0.04, C.dark);
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * 0.17;
    b.box(x + o * Math.cos(ry), 0.04, z - o * Math.sin(ry) + 0.02, 0.05, 0.5, 0.025, cols[i % cols.length]!, 'wood', { rx: -0.14 });
  }
}

/** Little lamp post with a glowing (glass-colour) lamp. */
export function lampPost(b: PartBuilder, x: number, z: number, hgt = 0.6): void {
  b.cyl(x, 0, z, 0.025, hgt, C.dark, 'wood', 8);
  b.box(x, hgt, z, 0.09, 0.07, 0.09, C.glass);
}

/** Hip-ish roof: pyramid-like gable with overhang on both axes (cone with 4 segments rotated 45°). */
export function pyramidRoof(b: PartBuilder, cx: number, y0: number, cz: number, w: number, d: number, rise: number, color: number): void {
  b.cone(cx, y0, cz, 0.5, rise, color, 'roof', 4, { ry: Math.PI / 4, sx: w * 1.414, sz: d * 1.414 });
}

/** Deterministic hash 0..1 from integers/strings. */
export function hash01(a: number | string, salt = 0): number {
  let h = 2166136261 ^ salt;
  const s = String(a);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000;
}

/** Foundation top: flagstones with subtle colour variation over a deep plinth. Top surface at y=0. */
export function flagstoneFoundation(b: PartBuilder, w: number, h: number, depth: number): void {
  const pw = w - 0.06, ph = h - 0.06;
  b.box(0, -depth, 0, pw, Math.max(0.01, depth - 0.03), ph, C.stone, 'stone');
  const nx = Math.max(1, Math.round(pw / 0.9)), nz = Math.max(1, Math.round(ph / 0.9));
  const shades = [0xa7adb3, 0x9aa1a8, 0xb3b8bd, 0xa2a6a0, 0xaeb2b8];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    b.box(-pw / 2 + (pw / nx) * (i + 0.5), -0.03, -ph / 2 + (ph / nz) * (j + 0.5), pw / nx - 0.015, 0.04, ph / nz - 0.015, shades[Math.floor(hash01(i * 31 + j, w * 7 + h) * shades.length)]!, 'stone');
  }
}

// ---------------------------------------------------------------------------------------------
// M8 (lane A) smoothing helpers: curved ramps, boat hulls, eave brackets, round-rail balustrades.
// ---------------------------------------------------------------------------------------------

/**
 * Curved ramp / quarter pipe rising along +x (before `ry`) from 0 to `rise` over `len`. concave = a transition (flat at the bottom, near vertical at the top,
 * like a quarter pipe / kicker); convex = a hump. The profile is an arc sampled in `steps` segments, extruded across `width` (z). ~4 + 4 * steps triangles.
 */
export function curvedRamp(b: PartBuilder, cx: number, y0: number, cz: number, len: number, rise: number, width: number, color: number, ry = 0, concave = true, steps = 5, layer: Layer = 'wood'): PartBuilder {
  const s = new THREE.Shape();
  s.moveTo(-len / 2, 0);
  s.lineTo(len / 2, 0);
  s.lineTo(len / 2, rise);
  for (let i = steps - 1; i >= 0; i--) {
    const t = i / steps; // 1 -> 0 along the surface, from the top back to the bottom
    s.lineTo(-len / 2 + len * t, rise * (concave ? 1 - Math.cos(t * Math.PI / 2) : Math.sin(t * Math.PI / 2)));
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
  g.translate(0, 0, -width / 2);
  return b.add(g, layer, color, cx, y0, cz, { ry });
}

/** Little boat: a half-ellipsoid hull (pointed bow along +z before `ry`) with a thwart and a rim; len x width x depth. ~100 triangles. */
export function boatHull(b: PartBuilder, cx: number, y0: number, cz: number, len: number, width: number, depth: number, color: number, rim = C.white, ry = 0): PartBuilder {
  const g = new THREE.SphereGeometry(0.5, 10, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  // taper the ends: narrow the width towards the bow / stern so the plan is a pointed ellipse
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const z = p.getZ(i), k = 1 - Math.pow(Math.abs(z) * 2, 2.2) * 0.6; p.setX(i, p.getX(i) * k); p.setY(i, p.getY(i) * (1 - Math.pow(Math.abs(z) * 2, 2) * 0.25)); }
  g.computeVertexNormals();
  b.add(g, 'wood', color, cx, y0 + depth, cz, { ry, sx: width, sy: depth * 1.0, sz: len });
  b.box(cx, y0 + depth - 0.02, cz, width * 0.8, 0.025, 0.08, rim, 'wood', { ry }); // thwart
  return b;
}

/** Rounded rail: cylindrical top rail + round balusters between (x0,z0) and (x1,z1) at height y. */
export function railing(b: PartBuilder, x0: number, z0: number, x1: number, z1: number, y = 0, hgt = 0.22, color = C.wood, posts = 4): PartBuilder {
  const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(-(z1 - z0), x1 - x0);
  b.cyl((x0 + x1) / 2, y + hgt - (len + 0.02) / 2, (z0 + z1) / 2, 0.022, len + 0.02, color, 'wood', 6, { rz: Math.PI / 2, ry: ang });
  for (let i = 0; i <= posts; i++) {
    const t = i / posts;
    b.cyl(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, 0.026, hgt, color, 'wood', 6);
  }
  return b;
}

/** Row of small corbel brackets under a gable eave running along x (face 's' / 'n') or z ('e' / 'w'); (x,z) = wall centre point, `y` = eave height (brackets hang below it). */
export function eaveBrackets(b: PartBuilder, x: number, y: number, z: number, face: Face, len: number, spacing = 0.45, out = 0.11, color = C.dark): PartBuilder {
  const n = Math.max(2, Math.round(len / spacing)), [fx, fz] = FACE_VEC[face], ns = isNS(face);
  for (let i = 0; i <= n; i++) {
    const t = -len / 2 + (len * i) / n;
    const px = ns ? x + t : x, pz = ns ? z : z + t;
    b.beam(px + fx * 0.01, y - 0.14, pz + fz * 0.01, px + fx * out, y - 0.02, pz + fz * out, 0.035, color, 'wood');
  }
  return b;
}

// ---------------------------------------------------------------------------------------------
// M8 (lane A2) helpers: round tubes, wheels, drums, domes, barrel-vault roofs, arc tubes.
// ---------------------------------------------------------------------------------------------

/** Round tube (cylinder) between two points: struts, handlebars, exhaust pipes, rails. 6 sides = 24 triangles (open ends are capped). */
export function tube(b: PartBuilder, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, color: number, layer: Layer = 'wood', seg = 6): PartBuilder {
  const d = new THREE.Vector3(bx - ax, by - ay, bz - az), len = d.length();
  if (len < 1e-6) return b;
  const g = new THREE.CylinderGeometry(Math.max(r, MIN_THIN / 2), Math.max(r, MIN_THIN / 2), len, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return b.add(g, layer, color, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
}

/** Wheel standing on y0 with its axle along x (before `ry`): a tyre, a lighter hub and a hub cap. `seg` sides on the tyre (default 10, 6 for tiny wheels). ~ 2*seg + 28 triangles. */
export function tyre(b: PartBuilder, x: number, y0: number, z: number, r: number, w: number, ry = 0, color = C.black, hub = C.grey, seg = 10): PartBuilder {
  b.add(new THREE.CylinderGeometry(r, r, w, seg), 'wood', color, x, y0 + r, z, { rz: Math.PI / 2, ry });
  return b.add(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w + 0.012, 6), 'wood', hub, x, y0 + r, z, { rz: Math.PI / 2, ry });
}

/** Oil / fuel drum with two rolled rims. 10 sides. */
export function drum(b: PartBuilder, x: number, y0: number, z: number, r: number, hgt: number, color: number): PartBuilder {
  b.cyl(x, y0, z, r, hgt, color, 'wood', 10);
  for (const f of [0.28, 0.68]) b.cyl(x, y0 + hgt * f, z, r * 1.06, hgt * 0.07, C.dark, 'wood', 10);
  return b.cyl(x, y0 + hgt, z, r * 0.6, 0.02, C.black, 'wood', 6);
}

/** Dome / rounded cap: a half sphere with base radius r and height hgt (squashed ellipsoid), `seg` around. */
export function domeCap(b: PartBuilder, cx: number, y0: number, cz: number, r: number, hgt: number, color: number, layer: Layer = 'roof', seg = 10, rings = 4, flatUv?: readonly [number, number]): PartBuilder {
  const g = new THREE.SphereGeometry(r, seg, rings, 0, Math.PI * 2, 0, Math.PI / 2);
  return b.add(g, layer, color, cx, y0, cz, { sy: hgt / r, flatUv });
}

/** Barrel-vault roof (circular segment, thin shell with a flat soffit): `span` across, `len` long, `rise` above the soffit at y0. ridge along x when alongX, else along z. */
export function barrelRoof(b: PartBuilder, cx: number, y0: number, cz: number, span: number, len: number, rise: number, color: number, alongX = true, layer: Layer = 'roof', steps = 6): PartBuilder {
  const hs = span / 2, R = (hs * hs + rise * rise) / (2 * rise), a = Math.asin(Math.min(1, hs / R)), s = new THREE.Shape();
  s.moveTo(-hs, 0);
  s.lineTo(hs, 0);
  for (let i = 0; i <= steps; i++) { const th = a - (2 * a * i) / steps; s.lineTo(R * Math.sin(th), R * Math.cos(th) - (R - rise)); }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  return b.add(g, layer, color, cx, y0, cz, { ry: alongX ? Math.PI / 2 : 0 });
}

/** Arc of a torus (rail / ladder hoop / handle): centre (cx,cy,cz), radius R, tube t, sweep `arc` radians starting at +x going up, in the xy plane before `o` rotation. */
export function arcTube(b: PartBuilder, cx: number, cy: number, cz: number, R: number, t: number, arc: number, color: number, layer: Layer = 'stone', seg = 8, o: PartOpts = {}): PartBuilder {
  return b.add(new THREE.TorusGeometry(R, Math.max(t, MIN_THIN / 2), 4, seg, arc), layer, color, cx, cy, cz, o);
}

/** Windsock: a pole with a tapered, striped cone (orange / white) streaming along +x. ~70 triangles. */
export function windsock(b: PartBuilder, x: number, y0: number, z: number, hgt = 0.8, color = C.orange): PartBuilder {
  b.cyl(x, y0, z, 0.02, hgt, C.grey, 'stone', 6);
  b.ball(x, y0 + hgt, z, 0.03, C.dark, 'stone', 6);
  const top = y0 + hgt - 0.07;
  for (let i = 0; i < 3; i++) b.cone(x + 0.1 + i * 0.1, top - i * 0.012, z, 0.075 - i * 0.017, 0.11, i % 2 ? C.white : color, 'roof', 8, { rz: -Math.PI / 2 - 0.12 * i });
  return b;
}

/** Gambrel (barn) roof: two-slope profile, steep lower slope + shallow upper slope. Same orientation convention as `PartBuilder.gable` (ridge along x when ridgeX). ~44 triangles. */
export function gambrel(b: PartBuilder, cx: number, y0: number, cz: number, span: number, len: number, rise: number, color: number, ridgeX = true, layer: Layer = 'roof'): PartBuilder {
  const hs = span / 2 + 0.06, s = new THREE.Shape();
  s.moveTo(-hs, -0.02); s.lineTo(hs, -0.02); s.lineTo(hs - 0.03, rise * 0.06);
  s.lineTo(hs * 0.7, rise * 0.62); s.lineTo(0.03, rise); s.lineTo(-0.03, rise);
  s.lineTo(-hs * 0.7, rise * 0.62); s.lineTo(-hs + 0.03, rise * 0.06); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  return b.add(g, layer, color, cx, y0, cz, { ry: ridgeX ? Math.PI / 2 : 0 });
}
