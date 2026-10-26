import { TILE_METRES } from '../config/balance';
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
