import { PROX } from '../config/audioProximity';

/** Pure proximity / zoom curves (no audio nodes). Constants live in src/config/audioProximity.ts. */
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
/** Smoothstep window: 1 at zoom <= near, 0 at zoom >= far (no corners: smooth ramps while the player zooms). */
export function zoomWindow(zoom: number, far: number, near: number): number {
  const t = clamp01((far - zoom) / Math.max(1e-6, far - near));
  return t * t * (3 - 2 * t);
}
/** Nature gain (birds, crickets, insects, cowbells, leaves, drips) from the 0..1 'closeness' of AMB.closeZoom / farZoom. */
export function natureGain(close: number): number { return PROX.nature.far + (1 - PROX.nature.far) * Math.pow(clamp01(close), PROX.nature.power); }

export interface StreamInput { /** Tiles to the nearest stream tile (Infinity / undefined = none in reach). */ dist?: number; /** Flow class 0 calm, 1 brisk, 2 rapids. */ cls?: number; zoom: number; frozen?: boolean }
/** Brook (burble) and rapids (rush) levels 0..1. */
export function streamLevels(i: StreamInput): { brook: number; rush: number } {
  const S = PROX.stream;
  if (i.frozen) return { brook: S.frozen, rush: S.frozen };
  const d = i.dist ?? Infinity;
  if (!(d < S.reach)) return { brook: 0, rush: 0 };
  const k = zoomWindow(i.zoom, S.zoomFar, S.zoomNear) * Math.pow(1 - d / S.reach, S.falloff);
  const f = S.flow[Math.max(0, Math.min(S.flow.length - 1, Math.round(i.cls ?? 1)))]!;
  return { brook: clamp01(k * f[0]), rush: clamp01(k * f[1]) };
}
/** Pond / lake lapping 0..1 from the nearby water-tile fraction. */
export function pondLevel(water: number, zoom: number, frozen: boolean): number {
  const P = PROX.pond;
  return frozen ? P.frozen : clamp01(water) * zoomWindow(zoom, P.zoomFar, P.zoomNear) * P.max;
}

/** Level 0..1 of one open bar at `dist` tiles from the listener (before the zoom window). */
export function apresBarLevel(dist: number): number { return Math.pow(clamp01(1 - dist / PROX.apres.reach), PROX.apres.falloff); }
/** Sum of the open bars' levels, capped. */
export function apresProximity(dists: Iterable<number>): number { let s = 0; for (const d of dists) s += apresBarLevel(d); return Math.min(PROX.apres.cap, s); }
/** Final bar-music level: proximity x zoom window. */
export function apresLevel(proximity: number, zoom: number): number { return clamp01(proximity) * zoomWindow(zoom, PROX.apres.zoomFar, PROX.apres.zoomNear); }
/** Bar gating: it plays only while the bar is built and active, open (not closed by the player / staff) and serving (its opening hours). */
export function apresBarOpen(b: { active: boolean; open: boolean; serving: boolean }): boolean { return b.active && b.open && b.serving; }

/** Level 0..1 of a rail level-crossing bell `dist` tiles from the listener (camera target, or the walker) at visible height `zoom` (PROX.crossing). 0 = inaudible: do not play. */
export function crossingBellLevel(dist: number, zoom: number): number {
  const C = PROX.crossing, d = clamp01(1 - dist / C.reach);
  return d * d * zoomWindow(zoom, C.zoomFar, C.zoomNear);
}
