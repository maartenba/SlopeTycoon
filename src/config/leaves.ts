/**
 * Falling autumn leaves (docs/atmosphere.md "Falling leaves"). RENDER ONLY: read by `src/render/FallingLeaves.ts`, never by the simulation.
 * Every number of the look lives here; the maths (`leafDensity`, `leafPose`, ...) is pure and unit-tested (tests/render/fallingLeaves.test.ts).
 */
import type { GraphicsQuality } from './balance';

export const LEAVES = {
  /** Leaf pool per graphics tier (the cost is one instanced draw call whatever the count). */
  counts: { low: 40, med: 120, high: 260 } as Record<GraphicsQuality, number>,
  /** Length of one leaf cycle (s range, per leaf): spawn at the crown, fall, lie, recycle. */
  cycle: [5, 6.5] as readonly [number, number],
  /** Seconds a leaf spends on the ground, fading, before it is recycled. */
  groundTime: 1.6,
  /** Fall speed (tiles / s) range per leaf, scaled by 1 + 0.5 x wind. */
  fall: [0.6, 1.2] as readonly [number, number],
  /** Sideways sway amplitude (tiles) and rate (Hz range); wind drift speed (tiles / s at wind 1, +x with a smaller +z share). */
  sway: 0.22, swayHz: [0.25, 0.6] as readonly [number, number], drift: 1.1, driftZ: 0.3,
  /** Tumble: screen-plane spin (rad / s range) and flip rate (Hz range); the flip squashes the leaf to a sliver and back. */
  spin: [0.6, 2.4] as readonly [number, number], flipHz: [0.5, 1.1] as readonly [number, number],
  /** Leaf size (tiles) range; a floor in device pixels keeps it readable zoomed out (scaled like the snow: `precipPixelScale`). */
  size: [0.3, 0.44] as readonly [number, number], minPx: 9,
  /** Perspective views (ride / walk / photo): world size multiplier (the iso size is tuned for a far camera; up close it would be huge). */
  perspectiveScale: 0.3,
  /** Peak alpha. */
  alpha: 0.95,
  /** Camera box: only trees within `radius` tiles of the view target shed (iso: share of the view height, clamped; perspective views: `nearRadius`). */
  radiusPerView: 0.5, minRadius: 8, maxRadius: 34, nearRadius: 16,
  /** Most trees used as sources at once. */
  maxSources: 120,
  /** Only near the camera in iso: full at view height <= nearView, gone at >= farView. */
  nearView: 60, farView: 110,
  /** Density multiplier by weather: wet leaves stay down. A gust (wind) lifts the density by up to `windBoost`. */
  rain: 0.3, snow: 0.08, windBoost: 0.5,
  /** Seasonal curve over the autumn phase 0 (1 Oct) .. 1 (30 Nov): ramps up by `rise`, holds, fades out from `fadeFrom`. */
  rise: 0.15, fadeFrom: 0.62,
  /** Reduced motion: still leaves lying around the source trees (scatter radius, tiles). */
  stillRadius: 0.9,
  /** Autumn palette (golds, oranges, reds, browns): linear-ish sRGB triples, picked by a stable per-leaf hash. */
  palette: [
    [0.93, 0.72, 0.18], [0.97, 0.62, 0.12], [0.88, 0.45, 0.1], [0.78, 0.25, 0.1],
    [0.66, 0.16, 0.12], [0.55, 0.34, 0.14], [0.8, 0.58, 0.2], [0.45, 0.28, 0.12],
  ] as readonly (readonly [number, number, number])[],
} as const;
