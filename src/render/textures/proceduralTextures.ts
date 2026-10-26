import * as THREE from 'three';

export const TEXTURE_SIZE = 128;
export type TerrainTexKind = 'grass' | 'meadow' | 'blossom' | 'dirt' | 'snow' | 'rock';
export const TERRAIN_TEX_KINDS: TerrainTexKind[] = ['grass', 'meadow', 'blossom', 'dirt', 'snow', 'rock'];

function hash(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Periodic value noise in [0,1]; wraps with `period` lattice cells over the texture so it tiles. */
function pnoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period, y = v * period;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const x0 = xi % period, y0 = yi % period;
  const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed), c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(u: number, v: number, base: number, oct: number, seed: number): number {
  let a = 1, sum = 0, norm = 0, p = base;
  for (let i = 0; i < oct; i++) {
    sum += a * pnoise(u, v, p, seed + i * 101);
    norm += a;
    a *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

type RGB = [number, number, number];
const lerp3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Scatter wrapped speckles (dabs of size `sz`) at given density. */
function speckle(px: Uint8ClampedArray, size: number, seed: number, density: number, colors: RGB[], sz: number): void {
  const n = Math.floor(size * size * density);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(hash(i, 1, seed) * size), y = Math.floor(hash(i, 2, seed) * size);
    const c = colors[Math.floor(hash(i, 3, seed) * colors.length)]!;
    for (let dy = 0; dy < sz; dy++)
      for (let dx = 0; dx < sz; dx++) {
        const o = (((y + dy) % size) * size + ((x + dx) % size)) * 4;
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
      }
  }
}

/** Deterministic tileable RGBA pixels for a terrain texture kind. Pure (no DOM). */
export function generateTexturePixels(kind: TerrainTexKind, seed: number, size = TEXTURE_SIZE): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  const ks = TERRAIN_TEX_KINDS.indexOf(kind) * 977 + seed;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const big = fbm(u, v, 4, 4, ks);
      const fine = pnoise(u, v, 32, ks + 7);
      let c: RGB;
      switch (kind) {
        case 'grass': {
          // low-contrast layered greens + fine vertical blade strokes
          const patch = fbm(u, v, 3, 3, ks + 2);
          const blade = pnoise(u, v, 96, ks + 3) * 0.6 + pnoise(u * 0.25 + 0.0, v, 128, ks + 4) * 0.4;
          const base = lerp3([66, 118, 54], [88, 140, 62], patch);
          c = lerp3(base, [78, 130, 58], 0.5 + (blade - 0.5) * 0.5);
          c = lerp3(c, [100, 148, 66], Math.max(0, big - 0.6) * 0.8);
          break;
        }
        case 'meadow': {
          const patch = fbm(u, v, 3, 3, ks + 2);
          const blade = pnoise(u, v, 96, ks + 3);
          c = lerp3(lerp3([80, 134, 56], [104, 156, 64], patch), [94, 146, 62], 0.5 + (blade - 0.5) * 0.4);
          break;
        }
        case 'blossom': {
          const patch = fbm(u, v, 3, 3, ks + 2);
          const blade = pnoise(u, v, 96, ks + 3);
          c = lerp3(lerp3([88, 138, 70], [112, 160, 82], patch), [100, 150, 76], 0.5 + (blade - 0.5) * 0.4);
          break;
        }
        case 'dirt':
          c = lerp3([88, 64, 44], [132, 100, 70], big * 0.6 + fine * 0.4);
          break;
        case 'snow':
          c = lerp3([226, 236, 246], [252, 253, 255], big * 0.6 + fine * 0.4);
          break;
        case 'rock': {
          // layered fbm + warped horizontal strata + faint ridged cracks; muted grey/brown, low contrast
          const warp = fbm(u, v, 4, 4, ks + 5);
          const strata = 0.5 + 0.5 * Math.sin(2 * Math.PI * (6 * v + warp * 1.6));
          const lump = fbm(u, v, 6, 5, ks + 9);
          const grain = pnoise(u, v, 64, ks + 13);
          const ridge = 1 - Math.abs(fbm(u, v, 5, 3, ks + 21) - 0.5) * 2; // ~1 at ridge lines
          const crack = Math.max(0, ridge - 0.93) / 0.07; // thin
          const t = lump * 0.55 + strata * 0.2 + warp * 0.15 + grain * 0.1;
          c = lerp3([112, 108, 104], [150, 144, 136], t);
          c = lerp3(c, [132, 118, 100], Math.max(0, big - 0.5) * 0.5); // brownish stain
          const dark = 1 - crack * 0.12;
          c = [c[0] * dark, c[1] * dark, c[2] * dark];
          break;
        }
      }
      const o = (y * size + x) * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
  }
  if (kind === 'dirt') speckle(px, size, ks + 70, 0.015, [[60, 45, 32], [150, 130, 105]], 2);
  return px;
}

/** Tileable tangent-space normal map pixels (RGBA) from periodic noise, for water. */
export function generateWaterNormalPixels(seed: number, size = TEXTURE_SIZE): Uint8ClampedArray {
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) hgt[y * size + x] = fbm(x / size, y / size, 4, 4, seed + 4242);
  const px = new Uint8ClampedArray(size * size * 4);
  const H = (x: number, y: number): number => hgt[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * 6, dy = (H(x, y + 1) - H(x, y - 1)) * 6;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      px[o] = (-dx / l * 0.5 + 0.5) * 255;
      px[o + 1] = (-dy / l * 0.5 + 0.5) * 255;
      px[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      px[o + 3] = 255;
    }
  return px;
}

function toCanvasTexture(pixels: Uint8ClampedArray, size: number, srgb: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.putImageData(new ImageData(pixels as unknown as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

export type TerrainTextures = Record<TerrainTexKind, THREE.CanvasTexture>;

export function createTerrainTextures(seed: number): TerrainTextures {
  const out = {} as TerrainTextures;
  for (const k of TERRAIN_TEX_KINDS) out[k] = toCanvasTexture(generateTexturePixels(k, seed), TEXTURE_SIZE, true);
  return out;
}

export function createWaterNormalTexture(seed: number): THREE.CanvasTexture {
  return toCanvasTexture(generateWaterNormalPixels(seed), TEXTURE_SIZE, false);
}
