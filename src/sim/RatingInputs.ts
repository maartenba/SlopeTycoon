import { BUILDINGS } from '../config/buildings';
import type { GameBus, SeasonId } from '../core/events';
import type { RatingInput } from './Rating';

/** Food venues that count as restaurants. */
const FOOD_TYPES = new Set(['lodge', 'cafe', 'mountainHut', 'baseLodge', 'apresBar']);

/** Rolling share of 'satisfied' leavers (exponential, per departure). Fed from the typed bus; deterministic. */
export class LeaverTracker {
  private v = -1;
  constructor(private k = 0.05) {}
  record(reason: 'satisfied' | 'bored' | 'broke' | 'injured' | 'closing'): void {
    // 'closing' = dusk, a neutral departure; ignored
    if (reason === 'closing') return;
    const x = reason === 'satisfied' ? 1 : 0;
    this.v = this.v < 0 ? x : this.v + (x - this.v) * this.k;
  }
  attach(bus: Pick<GameBus, 'on'>): () => void { return bus.on('guest:left', (e) => this.record(e.reason)); }
  get share(): number { return this.v; }
  serialize(): { v: number } { return { v: this.v }; }
  load(d: { v: number } | undefined): void { this.v = d?.v ?? -1; }
}

/** Everything the adapter needs from live systems (injected by main.ts; tests stub it). */
export interface RatingSources {
  guests(): { count: number; avgHappiness: number; skillMix: number[]; avgNeighbours: number; overnight: number };
  leavers: () => number;
  incidents(): { penalty: number; open: number; unresolved: number; meanResponseTicks: number; severe: number; /** 0..1 recent bear-scare level. */ wildlife?: number };
  buildings(): Iterable<{ type: string; active: boolean }>;
  lifts(): Iterable<{ id: number; kind: string; open: boolean; name?: string }>;
  waitTicks(liftId: number): number;
  /** 0..1 debt severity (optional). */
  debt?(): number;
  /** Open piste tiles as (difficulty 0..3, quality 0..6 or 0 = unknown). Iterated once per evaluation (daily). */
  forEachOpenPisteTile(cb: (difficulty: number, quality: number) => void): void;
  season(): SeasonId;
  trailOpen(): { mtb: number; hike: number };
  /** Piste-quality liking (0..1) for a skill and quality id. */
  qualityLike(skill: number, quality: number): number;
  value?(): number;
}

const ICY = 4;

export function gatherRatingInput(s: RatingSources): RatingInput {
  const g = s.guests();
  const types = new Set<string>(), kinds = new Set<string>();
  let restaurants = 0, lodging = 0, patrol = 0;
  for (const b of s.buildings()) {
    if (!b.active) continue;
    const d = BUILDINGS[b.type];
    if (!d) continue;
    if (d.category === 'recreation' || d.category === 'kids' || d.category === 'water') types.add(b.type);
    if (FOOD_TYPES.has(b.type)) restaurants++;
    if (d.category === 'lodging') lodging += d.capacity;
    if (b.type === 'patrolHub') patrol++;
  }
  let openLifts = 0, waitSum = 0, worst: { name: string; waitTicks: number } | null = null;
  for (const l of s.lifts()) {
    if (!l.open) continue;
    openLifts++; kinds.add(l.kind);
    const w = s.waitTicks(l.id);
    waitSum += w;
    if (!worst || w > worst.waitTicks) worst = { name: l.name ?? `Lift ${l.id}`, waitTicks: w };
  }
  const pisteTiles: [number, number, number, number] = [0, 0, 0, 0];
  let good = 0, wsum = 0, icy = 0, n = 0;
  const mixTot = g.skillMix.reduce((a, b) => a + b, 0) || 1;
  s.forEachOpenPisteTile((d, q) => {
    const di = Math.max(0, Math.min(3, d));
    pisteTiles[di]!++; n++;
    const w = 0.1 + g.skillMix[di]! / mixTot;
    good += w * (q ? s.qualityLike(di, q) : 0.5); wsum += w;
    if (q === ICY) icy++;
  });
  const season = s.season(), tr = s.trailOpen();
  const snowRuns = Math.min(1, (pisteTiles[0] + pisteTiles[1] + pisteTiles[2] + pisteTiles[3]) / 100);
  const seasonal = season === 'winter' ? snowRuns : season === 'summer' ? (tr.mtb + tr.hike) / 2 : Math.max(snowRuns, (tr.mtb + tr.hike) / 2);
  return {
    guests: { count: g.count, avgHappiness: g.avgHappiness, recentSatisfied: s.leavers() },
    safety: { ...s.incidents(), patrolHubs: patrol },
    variety: { attractionTypes: types.size, liftKinds: kinds.size, pisteTiles, seasonal },
    pisteQuality: { goodShare: wsum ? good / wsum : 0.5, icyShare: n ? icy / n : 0, tiles: n },
    queues: { meanWaitTicks: openLifts ? waitSum / openLifts : 0, worst },
    crowding: { avgNeighbours: g.avgNeighbours },
    value: s.value ? s.value() : 0.5,
    amenities: { restaurants, lodgingCapacity: lodging, lodgingDemand: g.overnight },
    openLifts,
    debt: s.debt ? s.debt() : 0,
  };
}
