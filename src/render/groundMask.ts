import * as THREE from 'three';
import { Layer } from '@/world/Networks';

/**
 * Ground data texture (N x N RGBA8, one texel per tile, LINEAR filtered) sampled by the terrain shader, so pistes / trails / building
 * contact shadows are SOFT ground treatments instead of per-tile decal quads (no extra draw calls, no geometry rebuild: a paint stroke
 * only rewrites this texture).
 *   R = ski piste mask        G = MTB / hike trail mask
 *   B = ski mask * (difficulty + 1) / 4 (premultiplied: B / R recovers the difficulty even after bilinear blending)
 *   A = built mask (building footprints)
 */
export interface MaskNet { readonly size: number; readonly layers: ArrayLike<number>; readonly difficulty: ArrayLike<number> }
export interface MaskRect { x: number; y: number; w: number; h: number }

export const MASK_FULL = 255;

/** Fill the whole mask from the network layers and building footprints (pure; the texture just wraps the array). */
export function fillGroundMask(out: Uint8Array, net: MaskNet, buildings: readonly MaskRect[]): void {
  const n = net.size;
  for (let i = 0; i < n * n; i++) {
    const l = net.layers[i]!;
    const o = i * 4;
    const ski = l & Layer.Ski ? MASK_FULL : 0;
    out[o] = ski;
    out[o + 1] = l & (Layer.Mtb | Layer.Hike) ? MASK_FULL : 0;
    out[o + 2] = ski ? Math.round(MASK_FULL * ((net.difficulty[i]! + 1) / 4)) : 0;
    out[o + 3] = 0;
  }
  for (const b of buildings) {
    for (let y = Math.max(0, b.y); y < Math.min(n, b.y + b.h); y++) for (let x = Math.max(0, b.x); x < Math.min(n, b.x + b.w); x++) out[(y * n + x) * 4 + 3] = MASK_FULL;
  }
}

/** Soft contact-shadow dabs (tree clusters, lift towers) written into the A channel below the building level (255): `sig` changes when they must be redone. */
export interface MaskExtra { sig(): string; apply(data: Uint8Array, n: number): void }
export const AO_TREE_MAX = 120;
export const AO_TOWER = 150;
/** Raise A at (x, y) to `v` (never lowers: buildings stay 255). */
export function dabMask(data: Uint8Array, n: number, x: number, y: number, v: number): void {
  if (x < 0 || y < 0 || x >= n || y >= n) return;
  const o = (y * n + x) * 4 + 3;
  if (data[o]! < v) data[o] = v;
}
/** Tree-cluster contact AO: count tree-like props per tile, 3+ trees per tile reaches AO_TREE_MAX; towers dab a 3x3 plus. Pure so it can be tested. */
export function treeTowerAo(data: Uint8Array, n: number, trees: Iterable<{ tx: number; ty: number }>, towers: Iterable<{ tileX: number; tileY: number }>): void {
  const cnt = new Uint8Array(n * n);
  for (const t of trees) if (t.tx >= 0 && t.ty >= 0 && t.tx < n && t.ty < n) { const i = t.ty * n + t.tx; if (cnt[i]! < 255) cnt[i]!++; }
  for (let i = 0; i < n * n; i++) if (cnt[i]! >= 2) dabMask(data, n, i % n, (i / n) | 0, Math.min(AO_TREE_MAX, 40 + cnt[i]! * 26));
  for (const t of towers) { dabMask(data, n, t.tileX, t.tileY, AO_TOWER); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) dabMask(data, n, t.tileX + dx, t.tileY + dy, AO_TOWER >> 1); }
}

/** CPU twin of the GPU bilinear fetch: channel `ch` (0..3) at world (x, z) in tiles (texel centres at tile + 0.5, edge clamped). */
export function sampleMask(data: Uint8Array, n: number, ch: number, wx: number, wz: number): number {
  const fx = Math.min(n - 1, Math.max(0, wx - 0.5)), fz = Math.min(n - 1, Math.max(0, wz - 0.5));
  const x0 = Math.floor(fx), z0 = Math.floor(fz), x1 = Math.min(n - 1, x0 + 1), z1 = Math.min(n - 1, z0 + 1), tx = fx - x0, tz = fz - z0;
  const g = (x: number, z: number): number => data[(z * n + x) * 4 + ch]! / MASK_FULL;
  return (g(x0, z0) * (1 - tx) + g(x1, z0) * tx) * (1 - tz) + (g(x0, z1) * (1 - tx) + g(x1, z1) * tx) * tz;
}

/** Piste weight after the shader's soft threshold: 0 outside, 1 on the run, smooth edge band between `lo` and `hi`. */
export function pisteWeight(raw: number, lo = 0.3, hi = 0.7): number {
  const t = Math.min(1, Math.max(0, (raw - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** Difficulty (0..3) recovered from the premultiplied B channel; -1 where there is no piste. */
export function difficultyFromMask(ski: number, premult: number): number {
  if (ski < 0.02) return -1;
  return Math.max(0, Math.min(3, Math.round((premult / ski) * 4 - 1)));
}

/** Owns the texture; `update()` is cheap when nothing changed (signature check every `every` calls). */
export class GroundMask {
  readonly texture: THREE.DataTexture;
  readonly data: Uint8Array;
  private sig = '';
  private tick = 0;
  constructor(readonly size: number, private readonly getNet: () => MaskNet, private readonly getBuildings: () => readonly MaskRect[], private readonly version: () => number, private readonly every = 8, private readonly extra?: MaskExtra) {
    this.data = new Uint8Array(size * size * 4);
    this.texture = new THREE.DataTexture(this.data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.rebuild();
  }
  private rebuild(): void {
    const b = this.getBuildings();
    this.sig = `${this.version()}|${b.length}|${b.reduce((s, r, i) => s + (r.x * 31 + r.y * 17 + r.w * 7 + r.h) * (i + 1), 0)}|${this.extra?.sig() ?? ''}`;
    fillGroundMask(this.data, this.getNet(), b);
    this.extra?.apply(this.data, this.size);
    this.texture.needsUpdate = true;
  }
  update(force = false): boolean {
    if (!force && ++this.tick % this.every !== 0) return false;
    const b = this.getBuildings();
    const sig = `${this.version()}|${b.length}|${b.reduce((s, r, i) => s + (r.x * 31 + r.y * 17 + r.w * 7 + r.h) * (i + 1), 0)}|${this.extra?.sig() ?? ''}`;
    if (sig === this.sig) return false;
    this.rebuild();
    return true;
  }
  dispose(): void { this.texture.dispose(); }
}
