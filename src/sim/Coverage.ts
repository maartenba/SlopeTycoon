import { BUILDINGS } from '../config/buildings';
import { paletteData } from '../config/palette';

/** Sim-side service coverage (no rendering imports). */
export type CoverageKind = 'firstAid' | 'patrol' | 'grooming' | 'snowmaking' | 'warning' | 'heli' | 'wildlife';
export const COVERAGE_KINDS: CoverageKind[] = ['firstAid', 'patrol', 'grooming', 'snowmaking', 'warning', 'heli', 'wildlife'];

export interface CoverageBuilding {
  id: number;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean;
}

export interface Rect { x0: number; y0: number; x1: number; y1: number } // tiles, inclusive-exclusive

export interface Source { id: number; kind: CoverageKind; cx: number; cy: number; r: number }

/** Piste difficulty codes: 0 none, 1 green, 2 blue, 3 red, 4 black. */
export type PisteDifficulty = 0 | 1 | 2 | 3 | 4;
/** Slope thresholds (rise/run). Networks (paths/pistes task) should reuse these. */
export const PISTE_SLOPE_THRESHOLDS = { green: 0.15, blue: 0.25, red: 0.4 } as const;
export function steepnessDifficulty(slope: number): PisteDifficulty {
  if (slope <= PISTE_SLOPE_THRESHOLDS.green) return 1;
  if (slope <= PISTE_SLOPE_THRESHOLDS.blue) return 2;
  if (slope <= PISTE_SLOPE_THRESHOLDS.red) return 3;
  return 4;
}

/**
 * Injectable view of the piste/path network.
 * Implemented by `networkProviderFrom` (src/build/NetworkAdapter.ts); `sim.networkProvider` is passed in at composition.
 */
export interface NetworkProvider {
  getPisteDifficultyAt(x: number, y: number): PisteDifficulty;
  isConnectedBuilding(id: number): boolean;
}
export const EMPTY_NETWORK: NetworkProvider = {
  getPisteDifficultyAt: () => 0,
  isConnectedBuilding: () => false,
};

function sourcesOf(buildings: Iterable<CoverageBuilding>): Source[] {
  const all = [...buildings];
  const out: Source[] = [];
  const reservoirs = all.filter((b) => b.active && b.type === 'reservoir');
  for (const b of all) {
    const def = BUILDINGS[b.type];
    if (!b.active || !def?.serviceRadius || !def.coverageKind || def.coverageKind === 'pipe') continue;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (def.coverageKind === 'snowmaking') {
      const pipe = BUILDINGS.reservoir?.serviceRadius ?? 0;
      const linked = reservoirs.some((r) => Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy) <= pipe);
      if (!linked) continue;
    }
    out.push({ id: b.id, kind: def.coverageKind, cx, cy, r: def.serviceRadius });
  }
  return out;
}

export class Coverage {
  private maps = new Map<CoverageKind, Uint8Array>();
  private src: Source[] = [];
  private counts = new Map<CoverageKind, number>();
  /** Bumped on every refresh; renderers compare to rebuild textures. */
  version = 0;

  constructor(readonly size: number) {
    for (const k of COVERAGE_KINDS) { this.maps.set(k, new Uint8Array(size * size)); this.counts.set(k, 0); }
  }

  map(kind: CoverageKind): Uint8Array { return this.maps.get(kind)!; }
  sources(kind?: CoverageKind): Source[] { return kind ? this.src.filter((s) => s.kind === kind) : [...this.src]; }

  /** Rect (tiles, clamped) a building could affect: its radius box; for reservoirs, all snowmaking within pipe range. */
  affectedRect(b: { x: number; y: number; w: number; h: number; type: string }): Rect {
    const def = BUILDINGS[b.type];
    let r = def?.serviceRadius ?? 0;
    if (def?.coverageKind === 'pipe') r += BUILDINGS.snowCannon?.serviceRadius ?? 0;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    return this.clamp({ x0: Math.floor(cx - r) - 1, y0: Math.floor(cy - r) - 1, x1: Math.ceil(cx + r) + 1, y1: Math.ceil(cy + r) + 1 });
  }

  private clamp(r: Rect): Rect {
    return { x0: Math.max(0, r.x0), y0: Math.max(0, r.y0), x1: Math.min(this.size, r.x1), y1: Math.min(this.size, r.y1) };
  }

  /** Recompute tiles in `region` (whole map when omitted) from the current building set. */
  refresh(buildings: Iterable<CoverageBuilding>, region?: Rect): void {
    this.src = sourcesOf(buildings);
    const R = region ? this.clamp(region) : { x0: 0, y0: 0, x1: this.size, y1: this.size };
    const N = this.size;
    for (const k of COVERAGE_KINDS) {
      const m = this.maps.get(k)!;
      for (let y = R.y0; y < R.y1; y++) m.fill(0, y * N + R.x0, y * N + R.x1);
    }
    for (const s of this.src) {
      const m = this.maps.get(s.kind)!;
      const y0 = Math.max(R.y0, Math.floor(s.cy - s.r)), y1 = Math.min(R.y1, Math.ceil(s.cy + s.r) + 1);
      const x0 = Math.max(R.x0, Math.floor(s.cx - s.r)), x1 = Math.min(R.x1, Math.ceil(s.cx + s.r) + 1);
      const r2 = s.r * s.r;
      for (let y = y0; y < y1; y++) {
        const dy = y + 0.5 - s.cy;
        for (let x = x0; x < x1; x++) {
          const dx = x + 0.5 - s.cx;
          if (dx * dx + dy * dy <= r2) { const i = y * N + x; if (m[i]! < 255) m[i]!++; }
        }
      }
    }
    // coverage fractions are cheap to keep exact: recount only on full refresh, else lazily
    this.counts.clear();
    this.version++;
  }

  isCovered(kind: CoverageKind, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return false;
    return this.maps.get(kind)![Math.floor(y) * this.size + Math.floor(x)]! > 0;
  }

  /** Nearest active source of `kind` (any distance), or null. */
  nearestResponder(kind: CoverageKind, x: number, y: number): { id: number; distance: number } | null {
    let best: { id: number; distance: number } | null = null;
    for (const s of this.src) {
      if (s.kind !== kind) continue;
      const d = Math.hypot(s.cx - x, s.cy - y);
      if (!best || d < best.distance) best = { id: s.id, distance: d };
    }
    return best;
  }

  coverageFraction(kind: CoverageKind): number {
    let c = this.counts.get(kind);
    if (c === undefined) {
      c = 0;
      for (const v of this.maps.get(kind)!) if (v) c++;
      this.counts.set(kind, c);
    }
    return c / (this.size * this.size);
  }
}

export type OverlayMode = 'off' | CoverageKind | 'piste' | 'connectivity' | 'snow' | 'quality' | 'threat' | 'traffic' | 'runs';
export const OVERLAY_MODES: OverlayMode[] = ['off', ...COVERAGE_KINDS, 'piste', 'connectivity', 'snow', 'quality', 'threat', 'traffic', 'runs'];
export const OVERLAY_LABELS: Record<OverlayMode, string> = {
  off: 'Overlay: off', firstAid: 'First aid', patrol: 'Ski patrol', grooming: 'Grooming', snowmaking: 'Snowmaking',
  warning: 'Warning signs', heli: 'Helicopter', piste: 'Piste difficulty', connectivity: 'Connectivity', snow: 'Snow depth', quality: 'Piste quality', wildlife: 'Ranger coverage', threat: 'Wildlife threat', traffic: 'Piste traffic', runs: 'Runs',
};

const COVER_RGBA: Record<CoverageKind, [number, number, number]> = {
  firstAid: [230, 60, 60], patrol: [240, 140, 40], grooming: [160, 100, 230], snowmaking: [70, 200, 255],
  warning: [240, 220, 40], heli: [60, 220, 120], wildlife: [90, 190, 70],
};

/** Piste quality overlay colours by quality id (see sim/ops/PisteQuality Q): powder, groomed, packed, icy, bumpy, slush. */
export const QUALITY_RGB: Array<[number, number, number]> = [
  [0, 0, 0], [225, 238, 255], [130, 225, 120], [150, 150, 155], [60, 220, 235], [190, 110, 40], [120, 150, 170],
];
/** Quality colours of the active palette (Settings > Colour palette): same as QUALITY_RGB in the default palette. */
export const qualityRgb = (): Array<[number, number, number]> => paletteData().quality;

/** Label value of node (junction / station) tiles in the 'runs' overlay map. */
export const RUN_LABEL_NODE = 65535;
/** Distinct run colours (cycled; neighbours get different ones because ids follow tile order). */
export const RUN_RGB: Array<[number, number, number]> = [
  [230, 80, 80], [70, 150, 240], [240, 190, 50], [80, 200, 120], [200, 100, 220], [240, 140, 60], [70, 210, 210], [170, 200, 60], [240, 120, 170], [150, 130, 240],
];

/** Snow data for the 'snow' overlay (depth in metres, skiOpen from TileConditions). */
export interface SnowView { depth: Float32Array; skiOpen: Uint8Array }

/** Fills an N*N*4 RGBA buffer for the mode (pure; texture upload is the renderer's job). */
export function paintOverlay(
  out: Uint8Array | Uint8ClampedArray, size: number, mode: OverlayMode,
  cov: Coverage, net: NetworkProvider, buildings: Iterable<CoverageBuilding>, snow?: SnowView | null, quality?: Uint8Array | null, threat?: Uint8Array | null, traffic?: Uint16Array | null, gain?: Float32Array | null, runs?: Uint16Array | null,
): void {
  out.fill(0);
  const put = (i: number, c: [number, number, number], a: number): void => {
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = a;
  };
  if (mode === 'off') return;
  if (mode === 'quality') {
    if (!quality) return;
    for (let i = 0; i < size * size; i++) { const q = quality[i]!; if (q > 0 && q < QUALITY_RGB.length) put(i, qualityRgb()[q]!, 170); }
    return;
  }
  if (mode === 'runs') {
    // every run in its own colour (RUN_LABEL_NODE = junction / station tile, drawn white): see sim/Runs.ts runLabels()
    if (!runs) return;
    for (let i = 0; i < size * size; i++) { const v = runs[i]!; if (v) put(i, v === RUN_LABEL_NODE ? [255, 255, 255] : RUN_RGB[(v - 1) % RUN_RGB.length]!, 175); }
    return;
  }
  if (mode === 'traffic') {
    // heatmap of today's skier passes per piste tile (log scale): unridden pistes stay dark slate, then blue -> yellow -> red
    let max = 0;
    if (traffic) for (let i = 0; i < size * size; i++) if (traffic[i]! > max) max = traffic[i]!;
    const lm = Math.log1p(max) || 1;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (!net.getPisteDifficultyAt(x, y)) continue;
      const i = y * size + x, v = traffic ? traffic[i]! : 0;
      if (!v) { put(i, [50, 55, 80], 110); continue; }
      const t = Math.log1p(v) / lm;
      put(i, t < 0.5 ? [60 + 390 * t, 140 + 110 * t, 255 - 330 * t] : [255, 255 - 440 * (t - 0.5), 60 - 60 * (t - 0.5)], 130 + 90 * t);
    }
    return;
  }
  if (mode === 'threat') {
    // heatmap: yellow (faint territory) -> orange -> red (bear nearby), alpha grows with the threat
    if (!threat) return;
    for (let i = 0; i < size * size; i++) {
      const v = threat[i]!;
      if (v < 6) continue;
      const t = v / 255;
      put(i, [255, Math.round(215 - 175 * t), Math.round(40 - 30 * t)], Math.round(60 + 150 * t));
    }
    return;
  }
  if (mode === 'snow') {
    if (!snow) return;
    for (let i = 0; i < size * size; i++) {
      const d = snow.depth[i]!;
      if (snow.skiOpen[i]) put(i, [235, 245, 255], Math.min(200, 90 + d * 60)); // skiable: white, denser with depth
      else if (d > 0.05) put(i, [120, 170, 210], 120); // slush / thin cover
    }
    return;
  }
  if (mode === 'piste') {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const d = net.getPisteDifficultyAt(x, y);
      if (d) put(y * size + x, paletteData().pisteRgb[d]!, 150);
    }
  } else if (mode === 'connectivity') {
    for (const b of buildings) {
      if (!BUILDINGS[b.type]) continue;
      const ok = net.isConnectedBuilding(b.id);
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x >= 0 && y >= 0 && x < size && y < size) put(y * size + x, ok ? [60, 210, 80] : [230, 60, 60], 190);
      }
    }
  } else if (mode === 'snowmaking') {
    // covered tiles are cyan; tiles that actually received snow (last night / tonight) glow white-blue, brighter with more depth gained
    const m = cov.map(mode);
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue;
      const g = gain ? gain[i]! : 0;
      if (g > 0.005) { const t = Math.min(1, g / 0.5); put(i, [Math.round(150 + 90 * t), Math.round(225 + 25 * t), 255], Math.round(130 + 100 * t)); } else put(i, COVER_RGBA.snowmaking, 80);
    }
  } else {
    const m = cov.map(mode), c = COVER_RGBA[mode];
    for (let i = 0; i < m.length; i++) if (m[i]) put(i, c, 110);
  }
}
