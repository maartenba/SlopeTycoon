import { Grid, TileType } from '../../src/world/Grid';
import { generateTerrain, terrainRelief, VALLEY_BASE } from '../../src/world/TerrainGen';

export interface SlopeMetrics {
  n: number; // non-water tiles above village
  hist: number[]; // share at steepness bins: 0, (0,.5], (.5,1], (1,1.5], (1.5,2)... see classes
  mean: number; median: number;
  ge15: number; eq2: number;
  beginner: number; intermediate: number; advanced: number; expert: number;
  benches: number; // disjoint-ish count of 5x5 patches (steep<=0.5, mid altitude)
  gradient: number; // half-steps/tile village->summit
  flank30: number; // mean slope along 30-tile flank
}

export function slopeMetrics(size: 64 | 128 | 256, seed: number): SlopeMetrics {
  const g = new Grid(size);
  const r = generateTerrain(g, seed);
  const N = size, relief = terrainRelief(N);
  const vh = VALLEY_BASE + 2;
  const st = new Float32Array(N * N), av = new Float32Array(N * N), dry = new Uint8Array(N * N);
  const vals: number[] = [];
  let hist0 = 0;
  const c = { b: 0, i: 0, a: 0, e: 0 };
  let ge15 = 0, eq2 = 0, sum = 0, hMax = -1, mx = 0, my = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, cs = g.getCorners(x, y);
    av[i] = (cs[0] + cs[1] + cs[2] + cs[3]) / 4;
    st[i] = g.steepness(x, y);
    const t = g.tileType[i];
    dry[i] = t === TileType.Water || t === TileType.Stream ? 0 : 1;
    if (av[i]! > hMax) { hMax = av[i]!; mx = x; my = y; }
    if (!dry[i] || av[i]! <= vh) continue;
    const s = st[i]!;
    vals.push(s); sum += s;
    if (s === 0) hist0++;
    if (s >= 1.5) ge15++;
    if (s >= 1.99) eq2++;
    if (s <= 0.5) c.b++; else if (s <= 1) c.i++; else if (s <= 1.5) c.a++; else c.e++;
  }
  vals.sort((a, b) => a - b);
  const n = vals.length;
  // benches: greedy non-overlapping 5x5 patches with steep<=0.5, dry, mid altitude (25-75% relief)
  const ok = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const f = (av[i]! - VALLEY_BASE) / relief;
    ok[i] = dry[i] && st[i]! <= 0.5 && f >= 0.25 && f <= 0.75 ? 1 : 0;
  }
  const used = new Uint8Array(N * N);
  let benches = 0;
  for (let y = 0; y + 5 <= N; y++) for (let x = 0; x + 5 <= N; x++) {
    let good = true;
    for (let j = 0; j < 5 && good; j++) for (let i = 0; i < 5; i++) if (!ok[(y + j) * N + x + i] || used[(y + j) * N + x + i]) { good = false; break; }
    if (!good) continue;
    benches++;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) used[(y + j) * N + x + i] = 1;
  }
  const v = r.villageAnchor;
  const dist = Math.hypot(mx - v.x, my - v.y);
  const gradient = (hMax - av[v.y * N + v.x]!) / Math.max(1, dist);
  // flank slope: mean |dh| per tile over 30 tiles along rays from village to summit (sample 30-tile windows)
  let fs = 0, fc = 0;
  const steps = Math.max(1, Math.floor(dist));
  for (let k = 0; k + 30 <= steps; k += 5) {
    const p = (t: number): number => {
      const x = Math.round(v.x + (mx - v.x) * t / steps), y = Math.round(v.y + (my - v.y) * t / steps);
      return av[y * N + x]!;
    };
    fs += Math.abs(p(k + 30) - p(k)) / 30; fc++;
  }
  return {
    n, hist: [hist0 / n], mean: sum / n, median: vals[n >> 1] ?? 0,
    ge15: ge15 / n, eq2: eq2 / n,
    beginner: c.b / n, intermediate: c.i / n, advanced: c.a / n, expert: c.e / n,
    benches, gradient, flank30: fc ? fs / fc : gradient,
  };
}

export function seedsMean(size: 64 | 128 | 256, seeds: number[]): { mean: SlopeMetrics; worst: Record<string, number> } {
  const all = seeds.map((s) => slopeMetrics(size, s));
  const keys = ['hist', 'n'];
  const mean = {} as Record<string, unknown>;
  const worst: Record<string, number> = {};
  for (const k of Object.keys(all[0]!)) {
    if (keys.includes(k)) continue;
    const vs = all.map((m) => (m as unknown as Record<string, number>)[k]!);
    mean[k] = vs.reduce((a, b) => a + b, 0) / vs.length;
  }
  worst.median = Math.max(...all.map((m) => m.median));
  worst.ge15 = Math.max(...all.map((m) => m.ge15));
  worst.eq2 = Math.max(...all.map((m) => m.eq2));
  worst.flat = Math.min(...all.map((m) => m.beginner + m.intermediate));
  worst.benches = Math.min(...all.map((m) => m.benches));
  return { mean: mean as unknown as SlopeMetrics, worst };
}
