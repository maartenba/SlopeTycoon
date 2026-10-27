import { SUSTAIN } from '../../config/rivals';
import { TRAIN_SUSTAIN } from '../../config/marketing';

/** Raw measurements behind the sustainability facet. */
export interface SustainRaw {
  /** Rolling dollars of energy + snowmaking per arriving guest; -1 = not measurable yet. */
  energyPerGuest: number;
  /** Net share (0..1) of the original forest that was felled and not replanted. */
  treeLoss: number;
  /** Share (0..1) of forest-habitat tiles that carry something built; before the ranger relief. */
  habitatOverlap: number;
  /** 0 / 1: trained rangers (`staffUpgrades.wildlifeProtection()`). */
  protection: number;
  /** Flat bonus points (0..~4) from green buildings (recycling centre); the score is capped at 100. Absent = 0. */
  bonus?: number;
  /** Facet points (0..TRAIN_SUSTAIN.maxPoints) from the share of arrivals by rail (Come by Train). Absent = 0. */
  train?: number;
}

/** The facet as the rating reads it: three 0..1 parts and the weighted 0..100 score. */
export interface SustainParts { energy: number; trees: number; habitat: number; score: number; raw: SustainRaw }

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));
const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Facet points for a rail share of the last days' arrivals: linear up to `TRAIN_SUSTAIN.full`, never more than `TRAIN_SUSTAIN.maxPoints` (3). */
export const trainSharePoints = (share: number | null | undefined): number => (share == null ? 0 : Math.round(TRAIN_SUSTAIN.maxPoints * Math.min(1, Math.max(0, share / TRAIN_SUSTAIN.full)) * 10) / 10);

/** Pure scoring of the raw numbers. Each part: 1 = gentle on the mountain, 0 = heavy footprint. */
export function sustainParts(raw: SustainRaw): SustainParts {
  const e = SUSTAIN.energy;
  const energy = raw.energyPerGuest < 0 ? SUSTAIN.idleEnergy : 1 - clamp((raw.energyPerGuest - e.good) / (e.bad - e.good));
  const trees = 1 - clamp((raw.treeLoss - SUSTAIN.trees.allowance) / SUSTAIN.trees.span);
  const overlap = raw.habitatOverlap * (1 - SUSTAIN.habitat.protection * clamp(raw.protection));
  const habitat = 1 - clamp((overlap - SUSTAIN.habitat.free) / SUSTAIN.habitat.span);
  const w = SUSTAIN.weights;
  const score = r1(Math.min(100, 100 * (w.energy * energy + w.trees * trees + w.habitat * habitat) + Math.max(0, raw.bonus ?? 0) + Math.min(TRAIN_SUSTAIN.maxPoints, Math.max(0, raw.train ?? 0))));
  return { energy, trees, habitat, score, raw };
}

/** Rating hint of the weakest part ('' = nothing to improve). */
export function sustainHint(p: SustainParts): string {
  if (p.score >= 75) return 'Gentle on the mountain';
  const worst = Math.min(p.energy, p.trees, p.habitat);
  if (worst === p.trees) return 'Plant trees to make up for the forest you cleared';
  if (worst === p.habitat) return p.raw.protection > 0 ? 'Pistes and buildings crowd the wildlife: keep to open ground' : 'Pistes and buildings crowd the wildlife: train rangers or keep to open ground';
  return 'Energy use per guest is high: build solar, wind or hydro power, close idle lifts, fewer snow cannons';
}

/** What the tracker reads from the live game (all read-only). */
export interface SustainSources {
  /** Dollars of energy + snowmaking booked so far on the day being closed. */
  energyToday(): number;
  trees(): { felled: number; planted: number; live: number };
  /** Share (0..1) of forest-habitat tiles carrying something built. Daily; may scan the map. */
  habitat(): number;
  protection(): number;
  /** Flat bonus points from green buildings (recycling centre). */
  bonus?(): number;
  /** Share (0..1) of the last 14 days' arrivals by rail; null = unknown / not tracked (no points). */
  trainShare?(): number | null;
}

/**
 * Sustainability measurements of one game. Energy is an exponential moving average of (energy $) and (arrivals) per day, so the ratio is stable in
 * the quiet months; trees and habitat are evaluated fresh whenever the rating asks (daily). Saved with the `rivals` module.
 */
export class Sustainability {
  private eSum = 0; private gSum = 0; private arrivalsToday = 0; private noonToday = 0;
  private cache: SustainParts | null = null;
  constructor(private readonly src: SustainSources | null = null) {}

  noteArrival(): void { this.arrivalsToday++; }
  /** Guests in the resort at noon (counts guests that did not arrive through the spawner, e.g. the title-screen demo crowd). */
  noteNoon(count: number): void { this.noonToday = count; }
  /** Day end (after the day's energy was booked). */
  closeDay(): void {
    if (!this.src) return;
    const k = SUSTAIN.energy.decay;
    this.eSum += (this.src.energyToday() - this.eSum) * k;
    this.gSum += (Math.max(this.arrivalsToday, this.noonToday) - this.gSum) * k;
    this.arrivalsToday = 0; this.noonToday = 0;
  }
  /** Fresh measurement (trees / habitat scanned now). */
  measure(): SustainParts {
    const s = this.src!, t = s.trees();
    const original = Math.max(1, t.live + t.felled - t.planted);
    const raw: SustainRaw = {
      energyPerGuest: this.gSum >= 1 ? this.eSum / this.gSum : -1,
      treeLoss: clamp((t.felled - t.planted) / original),
      habitatOverlap: s.habitat(), protection: clamp(s.protection()), bonus: s.bonus?.() ?? 0, train: trainSharePoints(s.trainShare?.()),
    };
    this.cache = sustainParts(raw);
    return this.cache;
  }
  /** Last measurement (null before the first one). */
  last(): SustainParts | null { return this.cache; }
  serialize(): unknown { return { e: this.eSum, g: this.gSum, a: this.arrivalsToday, n: this.noonToday }; }
  load(d: unknown): void {
    const o = d as { e?: number; g?: number; a?: number; n?: number } | null;
    this.eSum = o?.e ?? 0; this.gSum = o?.g ?? 0; this.arrivalsToday = o?.a ?? 0; this.noonToday = o?.n ?? 0; this.cache = null;
  }
  reset(): void { this.load(null); }
}
