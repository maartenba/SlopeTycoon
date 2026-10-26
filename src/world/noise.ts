import { Rng } from '../core/Rng';

/** Seeded 2D value noise (no Math.random). Output of noise2 is in [-1, 1]. */
export class Noise2D {
  private readonly perm = new Uint8Array(512);
  private readonly vals = new Float32Array(256);

  constructor(seed: number) {
    const rng = new Rng(seed ^ 0x9e3779b9);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
    for (let i = 0; i < 256; i++) this.vals[i] = rng.next() * 2 - 1;
  }

  noise2(x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const X = xi & 255, Y = yi & 255;
    const p = this.perm, vs = this.vals;
    const a = vs[p[p[X]! + Y]!]!;
    const b = vs[p[p[X + 1]! + Y]!]!;
    const c = vs[p[p[X]! + Y + 1]!]!;
    const d = vs[p[p[X + 1]! + Y + 1]!]!;
    const ab = a + (b - a) * u;
    const cd = c + (d - c) * u;
    return ab + (cd - ab) * v;
  }

  /** Fractal Brownian motion, normalized to roughly [-1, 1]. */
  fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2(x * freq + i * 17.3, y * freq - i * 9.1);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged noise in [0, 1]: sharp crests where underlying noise crosses zero. Higher sharpness = narrower crests. */
  ridged(x: number, y: number, octaves: number, sharpness = 2): number {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.noise2(x * freq + i * 31.7, y * freq + i * 13.9));
      sum += amp * Math.pow(n, sharpness);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}
