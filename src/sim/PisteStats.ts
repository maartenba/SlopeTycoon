import { HEIGHT_UNIT, RESORT_BASE_ELEVATION_M, TILE_METRES } from '../config/balance';
import type { Grid } from '../world/Grid';
import type { Pt } from './Dependencies';
import { difficultyFromSteepness } from '../world/Networks';
import type { PisteComponent } from '../world/Networks';
import type { PisteStatus } from './OpenStatus';
import { QUALITY_NAMES } from './ops/PisteQuality';

export interface PisteReport {
  /** Persistent piste id (Names). */
  id: number;
  name: string;
  autoName: string;
  /** 1 green .. 4 black. */
  difficulty: number;
  difficultyLabel: 'Green' | 'Blue' | 'Red' | 'Black';
  difficultyColor: string;
  tiles: number;
  lengthM: number;
  dropM: number;
  openLengthM: number;
  open: boolean;
  reason?: string;
  /** Mean surface quality label over painted tiles ('Groomed'...), null when nothing evaluated yet. */
  avgQuality: string | null;
  /** Busiest tile's visits today (proxy for skiers per day). */
  skiersToday: number;
  /** Runs that took a line over this piste today (exploration via tiles; 0 until guests ski it). */
  runsToday: number;
  warnings: string[];
}

export const DIFFICULTY_LABELS = ['Green', 'Blue', 'Red', 'Black'] as const;
export const DIFFICULTY_COLORS = ['#3fb950', '#3b82f6', '#e5484d', '#222222'] as const;

export interface PisteReportDeps {
  difficulty: Uint8Array | number[];
  quality: { at(i: number): number; traffic?: Uint16Array; trafficDay?: Uint16Array };
  status(c: PisteComponent): PisteStatus | undefined;
  /** Runs counted over the piste's tiles today (guests/Exploration). */
  runsAt?(tiles: readonly number[]): number;
}

/**
 * Majority difficulty over the component's tiles, as 1..4 (1 green .. 4 black). `difficulty` is the Networks array, stored 0..3 (`Difficulty.Green`
 * .. `Black`), so the stored value is shifted by one. (Before 0.1.0-m5.4 this clamped the stored value straight into 1..4, so a Black piste read as
 * Red, Red as Blue and Blue as Green; Black (4) was unreachable.)
 */
export function pisteDifficulty(tiles: readonly number[], difficulty: ArrayLike<number>): number {
  const n = [0, 0, 0, 0, 0];
  for (const t of tiles) { const d = Math.max(1, Math.min(4, (difficulty[t] ?? 0) + 1)); n[d]!++; }
  let best = 1;
  for (let d = 2; d <= 4; d++) if (n[d]! > n[best]!) best = d;
  return best;
}

/** Pure inspector numbers for a piste component (names are added by the caller). */
export function pisteReport(c: PisteComponent, d: PisteReportDeps): Omit<PisteReport, 'id' | 'name' | 'autoName'> {
  const diff = pisteDifficulty(c.tiles, d.difficulty);
  const st = d.status(c);
  const counts = new Array<number>(QUALITY_NAMES.length).fill(0);
  let n = 0, busiest = 0;
  for (const t of c.tiles) {
    const q = d.quality.at(t);
    if (q > 0) { counts[q]!++; n++; }
    const v = (d.quality.trafficDay?.[t] ?? 0) + (d.quality.traffic?.[t] ?? 0);
    if (v > busiest) busiest = v;
  }
  let avgQuality: string | null = null;
  if (n > 0) { let bi = 1; for (let i = 2; i < counts.length; i++) if (counts[i]! > counts[bi]!) bi = i; avgQuality = QUALITY_NAMES[bi]!; }
  const warnings: string[] = [];
  if (c.disconnected) warnings.push('Not connected to a lift: guests cannot reach it');
  if (st && !st.open && st.reason) warnings.push(st.reason);
  else if (!st) warnings.push('Status not evaluated yet');
  return {
    difficulty: diff, difficultyLabel: DIFFICULTY_LABELS[diff - 1]!, difficultyColor: DIFFICULTY_COLORS[diff - 1]!,
    tiles: c.count, lengthM: Math.round(c.count * TILE_METRES), dropM: Math.round(Math.max(0, c.topAlt - c.bottomAlt) * TILE_METRES),
    openLengthM: Math.round(st?.openLengthM ?? 0), open: !!st?.open, reason: st?.reason, avgQuality, skiersToday: busiest, runsToday: d.runsAt?.(c.tiles) ?? 0, warnings,
  };
}

// ---------- slope profile (build ghosts) ----------

/** One sample of a slope profile (per tile for pistes, per ~tile for lift lines). */
export interface ProfileSample {
  /** Distance from the start, metres. */
  distM: number;
  /** Altitude, metres (RESORT_BASE_ELEVATION_M + height). */
  altM: number;
  /** Local gradient (downhill positive), percent. */
  slopePct: number;
  /** 0 green .. 3 black. */
  difficulty: number;
}

export interface SlopeProfile {
  samples: ProfileSample[];
  lengthM: number;
  dropM: number;
  avgPct: number;
  maxPct: number;
  /** Altitude of the first / last sample, metres. */
  startAltM: number;
  endAltM: number;
}

const tileHeight = (grid: Grid, x: number, y: number): number => {
  const c = grid.getCorners(x, y);
  return ((c[0] + c[1] + c[2] + c[3]) / 4) * HEIGHT_UNIT;
};

/** Gradient percent -> difficulty bucket (same thresholds as painted pistes: steepness 0.75 / 1.25 / 1.75 half-steps per tile, 50 % per half-step). */
export const difficultyFromPct = (pct: number): number => difficultyFromSteepness(Math.abs(pct) / (HEIGHT_UNIT * 100));

function summarise(samples: ProfileSample[]): SlopeProfile {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s.slopePct));
  const first = samples[0], last = samples[samples.length - 1];
  const lengthM = last ? last.distM : 0, drop = first && last ? first.altM - last.altM : 0;
  return { samples, lengthM, dropM: drop, avgPct: lengthM > 0 ? (drop / lengthM) * 100 : 0, maxPct: max, startAltM: first?.altM ?? 0, endAltM: last?.altM ?? 0 };
}

/**
 * Per-tile profile of a piste centre-line (the stroke ghost). `difficulty` = per-tile 0..3 (e.g. `networks.autoDifficulty`), a single override value,
 * or null to derive it from the 3x3-smoothed steepness of each tile (same rule as painting).
 */
export function slopeProfile(grid: Grid, line: ReadonlyArray<Pt>, difficulty: ReadonlyArray<number> | number | null = null): SlopeProfile {
  const samples: ProfileSample[] = [];
  let dist = 0;
  for (let i = 0; i < line.length; i++) {
    const t = line[i]!;
    if (i > 0) { const p = line[i - 1]!; dist += Math.hypot(t.x - p.x, t.y - p.y) * TILE_METRES; }
    const alt = Math.round(RESORT_BASE_ELEVATION_M + tileHeight(grid, t.x, t.y) * TILE_METRES);
    let pct = 0;
    if (i > 0) { const prev = samples[i - 1]!; const dd = dist - prev.distM; pct = dd > 0 ? ((prev.altM - alt) / dd) * 100 : 0; }
    else if (line.length > 1) { const n = line[1]!; const dd = Math.hypot(n.x - t.x, n.y - t.y) * TILE_METRES; pct = dd > 0 ? ((alt - (RESORT_BASE_ELEVATION_M + tileHeight(grid, n.x, n.y) * TILE_METRES)) / dd) * 100 : 0; }
    let d: number;
    if (typeof difficulty === 'number') d = difficulty;
    else if (difficulty) d = difficulty[i] ?? 0;
    else { let s = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (grid.inBounds(t.x + dx, t.y + dy)) { s += grid.steepness(t.x + dx, t.y + dy); n++; } d = difficultyFromSteepness(n ? s / n : 0); }
    samples.push({ distM: Math.round(dist), altM: alt, slopePct: Math.round(pct), difficulty: d });
  }
  return summarise(samples);
}

/** Ground profile under a lift line (bottom -> top station centres, tile-space coordinates), one sample per tile; colour = how steep the ground is there. */
export function liftProfile(grid: Grid, bottom: Pt, top: Pt): SlopeProfile {
  const len = Math.max(1, Math.round(Math.hypot(top.x - bottom.x, top.y - bottom.y)));
  const samples: ProfileSample[] = [];
  const at = (x: number, y: number): number => {
    const tx = Math.min(grid.size - 1, Math.max(0, Math.floor(x))), ty = Math.min(grid.size - 1, Math.max(0, Math.floor(y)));
    const u = Math.min(1, Math.max(0, x - tx)), v = Math.min(1, Math.max(0, y - ty));
    const [n, e, s, w] = grid.getCorners(tx, ty);
    return (n * (1 - u) * (1 - v) + e * u * (1 - v) + s * u * v + w * (1 - u) * v) * HEIGHT_UNIT;
  };
  const stepM = (Math.hypot(top.x - bottom.x, top.y - bottom.y) / len) * TILE_METRES;
  // a lift climbs: the profile reads bottom (left) -> top (right), so altitude RISES and the gradient is positive uphill; colour by |gradient|
  let prevAlt = 0;
  for (let i = 0; i <= len; i++) {
    const f = i / len;
    const alt = Math.round(RESORT_BASE_ELEVATION_M + at(bottom.x + (top.x - bottom.x) * f, bottom.y + (top.y - bottom.y) * f) * TILE_METRES);
    const pct = i === 0 ? 0 : ((alt - prevAlt) / stepM) * 100;
    samples.push({ distM: Math.round(i * stepM), altM: alt, slopePct: Math.round(pct), difficulty: difficultyFromPct(pct) });
    prevAlt = alt;
  }
  if (samples.length > 1) { samples[0]!.slopePct = samples[1]!.slopePct; samples[0]!.difficulty = samples[1]!.difficulty; }
  const s = summarise(samples);
  // lifts climb: drop is negative; report the climb as a positive figure
  return { ...s, dropM: -s.dropM, avgPct: -s.avgPct };
}
