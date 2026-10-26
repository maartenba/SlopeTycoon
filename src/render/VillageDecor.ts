import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MIN_PART_THICKNESS } from './props/Trees';

/** Static village dressing around the base lodge: stone path, lamp posts (glow at night), benches, planters + flower beds, hedges/shrubs,
 * (no parking lot: that is a real building). Pure data + 3 merged meshes (wood, plants+paint, lamp glass) = 3 draw calls. Deterministic. */
export interface DecorItem { kind: 'path' | 'lamp' | 'bench' | 'planter' | 'shrub' | 'stall' | 'lot' | 'fountain' | 'cobble' | 'awning' | 'tree' | 'bed' | 'fence' | 'hedge' | 'wall'; x: number; z: number; ry: number; w?: number; d?: number }
export interface DecorEnv { blocked: (tileIndex: number) => boolean; /** Optional: tiles that are really solid (buildings, water), ignoring paths: a fountain may stand on a plaza path tile. */ solid?: (tileIndex: number) => boolean; size: number; isWater?: (tileIndex: number) => boolean }
export interface Rect { x: number; y: number; w: number; h: number }

/** Pure layout: candidate positions around the lodge rect, rejecting tiles for which `env.blocked` is true. Entrance faces +z. */
export function layoutVillage(lodge: Rect, env: DecorEnv, homes: readonly Rect[] = []): DecorItem[] {
  const free = (x: number, z: number): boolean => {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 1 || tz < 1 || tx >= env.size - 1 || tz >= env.size - 1) return false;
    const i = tz * env.size + tx;
    return !env.blocked(i) && !(env.isWater?.(i) ?? false);
  };
  /** Every sample along a hedge / wall row (every 0.4 tiles) must be free: a row never crosses a path or road tile (it is solid in walk mode). */
  const rowFree = (x0: number, z0: number, x1: number, z1: number): boolean => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.4));
    for (let k = 0; k <= n; k++) if (!free(x0 + (x1 - x0) * (k / n), z0 + (z1 - z0) * (k / n))) return false;
    return true;
  };
  const out: DecorItem[] = [];
  const add = (it: DecorItem): void => { if (free(it.x, it.z)) out.push(it); };
  const cx = lodge.x + lodge.w / 2, front = lodge.y + lodge.h, back = lodge.y;
  // village-green path from the entrance, 3 tiles south
  for (let k = 0; k < 6; k++) add({ kind: 'path', x: cx + 0.15, z: front + 0.3 + k * 0.5, ry: 0, w: 0.9, d: 0.55 });
  // lamp posts flanking the path + at the building corners
  for (const [dx, dz] of [[-0.9, 0.6], [1.2, 0.6], [-0.9, 2.2], [1.2, 2.2], [-lodge.w / 2 - 0.5, 0.5], [lodge.w / 2 + 0.5, 0.5]] as const) add({ kind: 'lamp', x: cx + dx, z: front + dz, ry: 0 });
  // benches facing the path
  add({ kind: 'bench', x: cx - 1.1, z: front + 1.4, ry: Math.PI / 2 });
  add({ kind: 'bench', x: cx + 1.4, z: front + 1.4, ry: -Math.PI / 2 });
  // flower planters at the doorstep corners
  for (const dx of [-lodge.w / 2 + 0.4, lodge.w / 2 - 0.4]) add({ kind: 'planter', x: cx + dx, z: front + 0.35, ry: 0 });
  add({ kind: 'planter', x: cx - 1.7, z: front + 2.0, ry: 0 }); add({ kind: 'planter', x: cx + 2.0, z: front + 2.0, ry: 0 });
  // shrubs / hedge along the back and the far side
  for (let k = 0; k < lodge.w + 1; k++) add({ kind: 'shrub', x: lodge.x - 0.4 + k * 1.0, z: back - 0.5, ry: k });
  for (let k = 0; k < 3; k++) add({ kind: 'shrub', x: lodge.x + lodge.w + 0.6, z: back + 0.4 + k * 1.1, ry: k + 7 });
  // village square: cobbled patch + fountain at the end of the green path, market awnings and two more lamps (bunting anchors)
  let sqx = cx + 0.15, sqz = front + 3.5, sqOk = false, sqStrict = false;
  const squareFree = (x: number, z: number): boolean => [[-1.2, -1.0], [1.2, -1.0], [-1.2, 1.0], [1.2, 1.0], [0, 0]].every(([dx, dz]) => free(x + dx!, z + dz!));
  const solidFree = (x: number, z: number): boolean => {
    if (!env.solid) return false;
    return [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6], [0, 0]].every(([dx, dz]) => {
      const tx = Math.floor(x + dx!), tz = Math.floor(z + dz!);
      return tx >= 1 && tz >= 1 && tx < env.size - 1 && tz < env.size - 1 && !env.solid!(tz * env.size + tx) && !(env.isWater?.(tz * env.size + tx) ?? false);
    });
  };
  const lcx = lodge.x + lodge.w / 2, lcz = lodge.y + lodge.h / 2;
  const cands: Array<[number, number]> = [[sqx, sqz]];
  for (const r of [4.2, 5.2, 6.4, 8, 9.5]) for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2 + 1.2; cands.push([lcx + Math.cos(a) * (r + lodge.w / 2), lcz + Math.sin(a) * (r + lodge.h / 2)]); }
  for (const [x, z] of cands) if (squareFree(x, z)) { sqx = x; sqz = z; sqOk = sqStrict = true; break; }
  if (!sqOk) for (const [x, z] of cands) if (solidFree(x, z)) { sqx = x; sqz = z; sqOk = true; break; }
  if (sqOk) {
    out.push({ kind: 'fountain', x: sqx, z: sqz, ry: 0 });
    if (sqStrict) {
      out.push({ kind: 'cobble', x: sqx, z: sqz, ry: 0, w: 2.6, d: 2.2 });
      add({ kind: 'awning', x: sqx - 1.7, z: sqz + 0.2, ry: 0.2 }); add({ kind: 'awning', x: sqx + 1.7, z: sqz - 0.1, ry: -0.2 });
      add({ kind: 'lamp', x: sqx - 1.4, z: sqz - 0.9, ry: 0 }); add({ kind: 'lamp', x: sqx + 1.4, z: sqz - 0.9, ry: 0 });
      add({ kind: 'bench', x: sqx, z: sqz + 1.0, ry: 0 });
    } else { // plaza on existing paths: fountain + a bench and awning on whatever neighbouring tile is free
      add({ kind: 'bench', x: sqx + 0.9, z: sqz, ry: -Math.PI / 2 }); add({ kind: 'bench', x: sqx - 0.9, z: sqz, ry: Math.PI / 2 });
      add({ kind: 'awning', x: sqx, z: sqz + 1.0, ry: 0 });
    }
  }
  // gardens: seeded corner shrubs, one tree, a flower bed and a picket fence along one side of each home plot
  for (const h of homes) {
    const r = (k: number): number => { const v = Math.sin((h.x * 12.9898 + h.y * 78.233 + k * 37.719) * 1.0) * 43758.5453; return v - Math.floor(v); };
    const corners: Array<[number, number]> = [[h.x - 0.4, h.y - 0.4], [h.x + h.w + 0.4, h.y - 0.4], [h.x - 0.4, h.y + h.h + 0.4], [h.x + h.w + 0.4, h.y + h.h + 0.4]];
    const treeAt = Math.floor(r(1) * 4);
    corners.forEach(([x, z], i) => {
      if (i === treeAt) add({ kind: 'tree', x, z, ry: Math.floor(r(2) * 3) });
      else if (r(3 + i) > 0.35) add({ kind: 'shrub', x, z, ry: i + h.x });
    });
    const side = Math.floor(r(9) * 4);
    if (side < 2) { // bed + fence on the north/south side
      const z = side === 0 ? h.y - 0.45 : h.y + h.h + 0.45;
      add({ kind: 'bed', x: h.x + h.w / 2, z, ry: 0, w: Math.min(1.6, h.w) });
      const z2 = side === 0 ? h.y + h.h + 0.5 : h.y - 0.5;
      if (free(h.x + 0.5, z2) && free(h.x + h.w - 0.5, z2)) out.push({ kind: 'fence', x: h.x + h.w / 2, z: z2, ry: 0, w: h.w });
    } else {
      const x = side === 2 ? h.x - 0.45 : h.x + h.w + 0.45;
      add({ kind: 'bed', x, z: h.y + h.h / 2, ry: Math.PI / 2, w: Math.min(1.6, h.h) });
      const x2 = side === 2 ? h.x + h.w + 0.5 : h.x - 0.5;
      if (free(x2, h.y + 0.5) && free(x2, h.y + h.h - 0.5)) out.push({ kind: 'fence', x: x2, z: h.y + h.h / 2, ry: Math.PI / 2, w: h.h });
    }
    // a hedge row (or a low stone wall, seeded) on the other axis: non-blocking decor, only where both ends are free
    const hv = r(21), asWall = r(22) > 0.5;
    const lateral = side < 2 ? (hv < 0.5 ? h.x - 0.55 : h.x + h.w + 0.55) : (hv < 0.5 ? h.y - 0.55 : h.y + h.h + 0.55);
    if (side < 2) { if (rowFree(lateral, h.y + 0.02, lateral, h.y + h.h - 0.02)) out.push({ kind: asWall ? 'wall' : 'hedge', x: lateral, z: h.y + h.h / 2, ry: Math.PI / 2, w: h.h }); }
    else if (rowFree(h.x + 0.02, lateral, h.x + h.w - 0.02, lateral)) out.push({ kind: asWall ? 'wall' : 'hedge', x: h.x + h.w / 2, z: lateral, ry: 0, w: h.w });
  }
  // No decorative parking lot: a grey pad with no road looked like a broken, unconnected Parking building. The real Parking is a building the player (or the tutorial) places on a road.
  return out;
}

export const col = (g: THREE.BufferGeometry, hex: number, x: number, y: number, z: number, ry = 0): THREE.BufferGeometry => {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1)));
  const c = new THREE.Color(hex), n = geo.getAttribute('position').count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
};
/** One bunting pennant hanging from (x, y, z), the flag plane along the string direction (dx, dz); both faces. */
export function pennant(x: number, y: number, z: number, dx: number, dz: number, hex: number): THREE.BufferGeometry {
  const hw = 0.05, h = 0.13, c = new THREE.Color(hex);
  const pos = [x - dx * hw, y, z - dz * hw, x + dx * hw, y, z + dz * hw, x, y - h, z,  x + dx * hw, y, z + dz * hw, x - dx * hw, y, z - dz * hw, x, y - h, z];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(18).map((_, i) => [c.r, c.g, c.b][i % 3]!), 3));
  return g;
}
/** A thin cord between two points. */
export function cord(a: THREE.Vector3, b: THREE.Vector3): THREE.BufferGeometry {
  const d = b.clone().sub(a), len = d.length(), g = new THREE.BoxGeometry(len, MIN_PART_THICKNESS, MIN_PART_THICKNESS).toNonIndexed();
  g.deleteAttribute('uv');
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.clone().normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  const c = new THREE.Color(0x3a2e26), n = g.getAttribute('position').count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const bx = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
const FLOWERS = [0xf06292, 0xf2c14e, 0xfafafa, 0x8e5bd0, 0xf08a24, 0xd9453a];
const FESTIVAL_FLAGS = [0xd9534a, 0xf2c14e, 0x4f86a8, 0xf4efe2, 0x6fae5a];

export class VillageDecor {
  readonly group = new THREE.Group();
  readonly wood: THREE.Mesh; readonly plants: THREE.Mesh; readonly glass: THREE.Mesh;
  items: DecorItem[] = [];
  private glassMat = new THREE.MeshLambertMaterial({ color: 0xf0b25a, emissive: 0xff8a1e, emissiveIntensity: 0 });
  private key = '';
  /** Cosmetic bunting colours (config/cosmetics.ts flags:*); empty = none (the default: the village looks exactly as before). */
  private flags: readonly number[] = [];
  private last: { lodge: Rect; env: DecorEnv; version: number } | null = null;
  /** Plots of chalets / apartments / huts that get a garden (set before build(); part of the layout key). */
  homes: Rect[] = [];
  /** Festival Town: colourful default bunting between the lamp posts when no cosmetic flag set is chosen. */
  festival = false;

  constructor(private ground: (x: number, z: number) => number) {
    const lam = new THREE.MeshLambertMaterial({ vertexColors: true });
    const empty = (): THREE.BufferGeometry => new THREE.BufferGeometry();
    this.wood = new THREE.Mesh(empty(), lam); this.plants = new THREE.Mesh(empty(), new THREE.MeshLambertMaterial({ vertexColors: true })); this.glass = new THREE.Mesh(empty(), this.glassMat);
    for (const m of [this.wood, this.plants, this.glass]) { m.frustumCulled = false; this.group.add(m); }
    this.group.name = 'villageDecor';
  }

  setNight(n: number): void { this.glassMat.emissiveIntensity = 1.3 * Math.min(1, Math.max(0, n)); }

  /** Cosmetic flag set: pennant colours strung between the lamp posts (empty = no bunting). Rebuilds the village meshes when it changes. */
  setFlags(colors: readonly number[]): void {
    if (colors.length === this.flags.length && colors.every((c, i) => c === this.flags[i])) return;
    this.flags = [...colors];
    if (this.last) { const l = this.last; this.key = ''; this.build(l.lodge, l.env, l.version); }
  }
  get flagColors(): readonly number[] { return this.flags; }

  /** Rebuild for a lodge rect + blocked-tile function; a no-op when the layout key is unchanged. */
  build(lodge: Rect, env: DecorEnv, version = 0): void {
    this.last = { lodge, env, version };
    const key = `${lodge.x},${lodge.y},${lodge.w},${lodge.h},${version},${this.homes.length}`;
    if (key === this.key) return;
    this.key = key;
    const wood: THREE.BufferGeometry[] = [], plants: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
    const items = layoutVillage(lodge, env, this.homes);
    this.items = items;
    this.emit(items, wood, plants, glass);
    const flags = this.flags.length ? this.flags : this.festival ? FESTIVAL_FLAGS : [];
    if (flags.length) this.bunting(items, wood, plants, flags);
    const set = (m: THREE.Mesh, parts: THREE.BufferGeometry[]): void => { m.geometry.dispose(); m.geometry = parts.length ? mergeGeometries(parts, false)! : new THREE.BufferGeometry(); m.visible = parts.length > 0; };
    set(this.wood, wood); set(this.plants, plants); set(this.glass, glass);
  }

  /** Meshes for a list of decor items (shared by the village layout and the player's Landscape decor). */
  emit(items: readonly DecorItem[], wood: THREE.BufferGeometry[], plants: THREE.BufferGeometry[], glass: THREE.BufferGeometry[]): void {
    let n = 0;
    for (const it of items) {
      n++;
      const y = this.ground(it.x, it.z);
      switch (it.kind) {
        case 'path': plants.push(col(bx(it.w!, 0.025, it.d!), n % 2 ? 0xc9c1ad : 0xb9b29f, it.x, y + 0.012, it.z)); break;
        case 'lamp': { // park lamp: stone plinth, base flare, slim tapered pole, collar, glowing lantern under a pointed cap
          const IRON = 0x2f2a28, LT = 0x3a3431;
          wood.push(col(new THREE.CylinderGeometry(0.085, 0.1, 0.07, 8), 0x8d8a82, it.x, y + 0.035, it.z));
          wood.push(col(new THREE.CylinderGeometry(0.05, 0.07, 0.1, 8), IRON, it.x, y + 0.12, it.z));
          wood.push(col(new THREE.CylinderGeometry(0.02, 0.034, 0.62, 8), IRON, it.x, y + 0.45, it.z));
          wood.push(col(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 8), IRON, it.x, y + 0.77, it.z));
          wood.push(col(bx(0.15, 0.03, 0.15), LT, it.x, y + 0.805, it.z));
          glass.push(col(bx(0.11, 0.16, 0.11), 0xffd98a, it.x, y + 0.9, it.z));
          for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) wood.push(col(bx(0.03, 0.16, 0.03), LT, it.x + dx * 0.065, y + 0.9, it.z + dz * 0.065));
          wood.push(col(new THREE.ConeGeometry(0.13, 0.09, 4), LT, it.x, y + 1.025, it.z, Math.PI / 4));
          wood.push(col(new THREE.SphereGeometry(0.03, 6, 4), LT, it.x, y + 1.09, it.z));
          break;
        }
        case 'bench': { // park bench: long along local z (0.84 x 0.28), slatted seat + two-slat backrest at -x, iron side frames with armrests
          const c = Math.cos(it.ry), sn = Math.sin(it.ry), W = 0x8b5a2b, W2 = 0x9a6a38, IR = 0x2f2a28;
          const P = (g: THREE.BufferGeometry, hex: number, lx: number, ly: number, lz: number): void => { wood.push(col(g, hex, it.x + lx * c + lz * sn, y + ly, it.z - lx * sn + lz * c, it.ry)); };
          [-0.09, 0, 0.09].forEach((lx, i) => P(bx(0.085, 0.03, 0.84), i % 2 ? W2 : W, lx + 0.01, 0.23, 0));
          P(bx(0.03, 0.07, 0.84), W2, -0.155, 0.34, 0); P(bx(0.03, 0.07, 0.84), W, -0.16, 0.43, 0);
          for (const lz of [-0.37, 0.37]) {
            P(bx(0.04, 0.5, 0.04), IR, -0.15, 0.25, lz); // back leg rises into the backrest
            P(bx(0.04, 0.35, 0.04), IR, 0.11, 0.175, lz); // front leg rises into the armrest
            P(bx(0.3, 0.03, 0.04), IR, -0.02, 0.07, lz); // foot rail
            P(bx(0.3, 0.03, 0.05), IR, -0.02, 0.355, lz + Math.sign(lz) * 0.025); // armrest
          }
          break;
        }
        case 'planter':
          wood.push(col(bx(0.5, 0.14, 0.26), 0x7a4a24, it.x, y + 0.07, it.z));
          plants.push(col(bx(0.44, 0.04, 0.2), 0x2f6b2f, it.x, y + 0.16, it.z));
          for (let k = 0; k < 5; k++) plants.push(col(new THREE.IcosahedronGeometry(0.06, 0), FLOWERS[(n + k) % FLOWERS.length]!, it.x + (k - 2) * 0.09, y + 0.22 + (k % 2) * 0.02, it.z + ((k * 7) % 3 - 1) * 0.04));
          break;
        case 'shrub': {
          const r = 0.2 + ((it.ry * 37) % 5) * 0.03;
          plants.push(col(new THREE.IcosahedronGeometry(r, 1), n % 3 === 0 ? 0x3f7d33 : 0x2f6b2f, it.x, y + r * 0.75, it.z));
          break;
        }
        case 'lot': plants.push(col(bx(it.w!, 0.02, it.d!), 0x55585f, it.x, y + 0.01, it.z)); break;
        case 'stall': plants.push(col(bx(0.035, 0.012, 1.3), 0xf4f4f0, it.x, y + 0.026, it.z, 0)); break;
        case 'cobble':
          for (let a = 0; a < 4; a++) for (let b2 = 0; b2 < 3; b2++) plants.push(col(bx(it.w! / 4 - 0.02, 0.022, it.d! / 3 - 0.02), (a + b2) % 2 ? 0xb3a896 : 0xa59b89, it.x - it.w! / 2 + (a + 0.5) * it.w! / 4, y + 0.011, it.z - it.d! / 2 + (b2 + 0.5) * it.d! / 3));
          break;
        case 'fountain':
          wood.push(col(new THREE.CylinderGeometry(0.46, 0.5, 0.2, 14), 0xa9a69c, it.x, y + 0.1, it.z));
          plants.push(col(new THREE.CylinderGeometry(0.38, 0.38, 0.02, 14), 0x5fb3dc, it.x, y + 0.205, it.z));
          wood.push(col(new THREE.CylinderGeometry(0.06, 0.08, 0.45, 8), 0xb9b5aa, it.x, y + 0.4, it.z));
          wood.push(col(new THREE.CylinderGeometry(0.2, 0.1, 0.06, 10), 0xb9b5aa, it.x, y + 0.62, it.z));
          plants.push(col(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 10), 0x7cc6e8, it.x, y + 0.655, it.z));
          break;
        case 'awning': {
          const c = n % 2 ? 0xc65a4a : 0x4f86a8;
          wood.push(col(bx(0.7, 0.2, 0.32), 0x8b5a2b, it.x, y + 0.1, it.z, it.ry));
          for (const sx of [-0.33, 0.33]) wood.push(col(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 5), 0x6b4a2a, it.x + Math.cos(it.ry) * sx, y + 0.25, it.z - Math.sin(it.ry) * sx));
          plants.push(col(bx(0.8, 0.035, 0.46), c, it.x, y + 0.52, it.z, it.ry));
          plants.push(col(bx(0.8, 0.035, 0.12), 0xf4efe2, it.x, y + 0.505, it.z + 0.2, it.ry));
          break;
        }
        case 'tree': {
          const v = Math.round(it.ry) % 3;
          if (v === 0) { wood.push(col(new THREE.CylinderGeometry(0.03, 0.04, 0.2, 5), 0x5a3d26, it.x, y + 0.1, it.z)); plants.push(col(new THREE.ConeGeometry(0.28, 0.95, 7), 0x2f5f3a, it.x, y + 0.65, it.z)); }
          else if (v === 1) { wood.push(col(new THREE.CylinderGeometry(0.025, 0.035, 0.55, 5), 0xe6e2d6, it.x, y + 0.28, it.z)); plants.push(col(new THREE.IcosahedronGeometry(0.27, 0), 0x9bba55, it.x, y + 0.72, it.z)); }
          else { wood.push(col(new THREE.CylinderGeometry(0.03, 0.04, 0.35, 5), 0x6b4a2a, it.x, y + 0.18, it.z)); plants.push(col(new THREE.IcosahedronGeometry(0.28, 0), 0x5b8f45, it.x, y + 0.55, it.z)); for (let k = 0; k < 3; k++) plants.push(col(new THREE.IcosahedronGeometry(0.035, 0), 0xd9453a, it.x + (k - 1) * 0.15, y + 0.5 + (k % 2) * 0.12, it.z + 0.2)); }
          break;
        }
        case 'bed': {
          const dd = it.d ?? 0.3, c = Math.cos(it.ry), sn = Math.sin(it.ry);
          wood.push(col(bx(it.w!, 0.07, dd), 0x6b4a2a, it.x, y + 0.035, it.z, it.ry));
          if (it.d) { // a full tile: soil with three rows of flowers (Landscape flower bed)
            plants.push(col(bx(it.w! - 0.08, 0.02, dd - 0.08), 0x4a3524, it.x, y + 0.075, it.z, it.ry));
            for (let k = 0; k < 9; k++) { const t = ((k % 3) - 1) * (it.w! / 3.4), u = (Math.floor(k / 3) - 1) * (dd / 3.4); plants.push(col(new THREE.IcosahedronGeometry(0.075, 0), FLOWERS[(n + k * 2) % FLOWERS.length]!, it.x + c * t + sn * u, y + 0.13 + (k % 2) * 0.02, it.z - sn * t + c * u)); }
          } else for (let k = 0; k < 6; k++) { const t = (k + 0.5) / 6 - 0.5; plants.push(col(new THREE.IcosahedronGeometry(0.07, 0), FLOWERS[(n + k) % FLOWERS.length]!, it.x + c * t * it.w!, y + 0.12, it.z - sn * t * it.w!)); }
          break;
        }
        case 'hedge': { // clipped hedge: dense box body with a slightly narrower top row and a few leafy lumps
          const L = it.w!, c = Math.cos(it.ry), sn = Math.sin(it.ry), k = Math.max(3, Math.round(L / 0.3));
          plants.push(col(bx(L, 0.2, 0.24), 0x2f6b2f, it.x, y + 0.1, it.z, it.ry));
          plants.push(col(bx(L - 0.04, 0.07, 0.19), 0x3a7a37, it.x, y + 0.235, it.z, it.ry));
          for (let i = 0; i < k; i++) { const t = ((i + 0.5) / k - 0.5) * L; plants.push(col(new THREE.IcosahedronGeometry(0.085, 0), (i + n) % 2 === 0 ? 0x44853a : 0x3a7a37, it.x + c * t, y + 0.29, it.z - sn * t)); }
          break;
        }
        case 'wall': { // dry-stone wall: three staggered courses of blocks + cap stones
          const L = it.w!, c = Math.cos(it.ry), sn = Math.sin(it.ry), k = Math.max(3, Math.round(L / 0.25));
          for (let row = 0; row < 3; row++) for (let i = 0; i < k; i++) {
            const t = ((i + 0.5 + (row % 2) * 0.5) / k - 0.5) * L;
            if (Math.abs(t) > L / 2 - 0.02) continue;
            wood.push(col(bx(L / k - 0.012, 0.055, 0.14), (i + row + n) % 3 === 0 ? 0x8f8d85 : (i + row) % 2 ? 0xa09d94 : 0xaeaba1, it.x + c * t, y + 0.03 + row * 0.058, it.z - sn * t, it.ry));
          }
          wood.push(col(bx(L + 0.03, 0.035, 0.18), 0xbab7ad, it.x, y + 0.2, it.z, it.ry));
          break;
        }
        case 'fence': {
          const L = it.w!, c = Math.cos(it.ry), sn = Math.sin(it.ry);
          for (const hy of [0.07, 0.16]) wood.push(col(bx(L, 0.025, 0.025), 0xf1ede2, it.x, y + hy, it.z, it.ry));
          const k = Math.max(3, Math.round(L / 0.2));
          for (let i = 0; i < k; i++) { const t = ((i + 0.5) / k - 0.5) * L; wood.push(col(bx(0.035, 0.2, 0.02), 0xf1ede2, it.x + c * t, y + 0.1, it.z - sn * t, it.ry)); }
          break;
        }
      }
    }
  }

  /** Build meshes straight from an item list (player-placed decor: no village layout, no bunting). Stable `items` reference until the next call. */
  buildFrom(items: readonly DecorItem[]): void {
    this.items = [...items];
    const wood: THREE.BufferGeometry[] = [], plants: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
    this.emit(items, wood, plants, glass);
    const set = (m: THREE.Mesh, parts: THREE.BufferGeometry[]): void => { m.geometry.dispose(); m.geometry = parts.length ? mergeGeometries(parts, false)! : new THREE.BufferGeometry(); m.visible = parts.length > 0; };
    set(this.wood, wood); set(this.plants, plants); set(this.glass, glass);
  }

  /** Bunting between neighbouring lamp posts (lamps closer than 3.3 tiles are strung together), pennants every ~0.2 tiles along a gentle sag. */
  private bunting(items: readonly DecorItem[], wood: THREE.BufferGeometry[], plants: THREE.BufferGeometry[], flags: readonly number[]): void {
    const lamps = items.filter((i) => i.kind === 'lamp');
    let k = 0;
    for (let i = 0; i < lamps.length; i++) for (let j = i + 1; j < lamps.length; j++) {
      const a = lamps[i]!, b = lamps[j]!, dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len > 3.3 || len < 0.6) continue;
      const ya = this.ground(a.x, a.z) + 0.78, yb = this.ground(b.x, b.z) + 0.78, sag = 0.05 * len, nx = dx / len, nz = dz / len;
      const pts = Math.max(3, Math.round(len / 0.2));
      let prev = new THREE.Vector3(a.x, ya, a.z);
      for (let s = 1; s <= pts; s++) {
        const t = s / pts, y = ya + (yb - ya) * t - Math.sin(Math.PI * t) * sag, cur = new THREE.Vector3(a.x + dx * t, y, a.z + dz * t);
        wood.push(cord(prev, cur));
        if (s < pts) plants.push(pennant(cur.x, cur.y, cur.z, nx, nz, flags[k++ % flags.length]!));
        prev = cur;
      }
    }
  }

  dispose(): void { for (const m of [this.wood, this.plants, this.glass]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }
}
