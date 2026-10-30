import { FISH, ICE_FISHING } from '../../config/balance';
import { tourDefOf } from '../../config/tours';
import type { WorldBuilding } from '../guests/GuestWorld';
import type { AttractionSpec } from './Attraction';
import { bodySize, nearWater, reachable, spotsFor, type FishBody, type FishStock, type Spot } from '../nature/FishStock';

/**
 * Tackle & bait hut (Phase 6 Task 49, docs/anglers.md). The hut is the anglers' base: a guest buys the day ticket on entry (rod hire + bait on top), "uses" the
 * hut for ~7 game hours (the renderer shows them fishing at a pier / bank spot, a view-only pose) and the catches are rolled when the visit ends.
 * Capacity = the fishing places it can use (4 per pier + up to FISH.bankSpotsMax bank spots), never below 2.
 */
export const ANGLING_SPECS: Record<string, AttractionSpec> = {
  tackleHut: { kind: 'angling', serviceTicks: 70, slots: 8, effects: { fatigue: 0.12, happiness: 0.04 }, appeal: [0.2, 0.3, 0.25, 0.15, 0.2, 0.2], angling: true },
};

/** Deterministic: about FISH.rodOwners % of the guests bring their own rod. */
export const ownsRod = (guestId: number): boolean => (Math.imul(guestId + 53, 2246822519) >>> 0) % 100 < FISH.rodOwners;

export interface AnglingPlan {
  /** A fishable water is within FISH.nearWater tiles of the hut (the placement rule; without it the hut is closed). */
  near: boolean;
  /** Bodies in reach right now (frozen rivers / streams dropped; in a freeze only lakes and ponds when ICE_FISHING). */
  bodies: FishBody[];
  spots: Spot[];
  /** Share of the places that are on a pier (piers make the visit nicer). */
  pierShare: number;
  /** The water is frozen at the hut: ice fishing. */
  ice: boolean;
  /** A motorised tour base is within earshot. */
  noisy: boolean;
}

export interface PlannerDeps {
  size: number;
  bodies: () => ReadonlyArray<FishBody>;
  buildings: () => Iterable<WorldBuilding>;
  /** Walkable path / trail tile (bank spots). */
  isWalk: (x: number, y: number) => boolean;
  /** True when the water next to a building is frozen (temperature <= 0 there). */
  frozen: (b: WorldBuilding) => boolean;
  /** Dug rivers keep their own ice state: true = frozen. */
  riverFrozen?: (key: string) => boolean;
  /** Anything that changes the water, the piers or the paths (cache key). */
  stamp: () => number;
}

/** Plans (bodies in reach, places, ice / noise state) for the huts; cached per hut until the world stamp or the ice state changes. */
export class AnglingPlanner {
  private cache = new Map<number, { stamp: number; ice: boolean; plan: AnglingPlan }>();
  constructor(private d: PlannerDeps) {}

  plan(b: WorldBuilding): AnglingPlan {
    const stamp = this.d.stamp(), ice = this.d.frozen(b), c = this.cache.get(b.id);
    if (c && c.stamp === stamp && c.ice === ice) return c.plan;
    const plan = this.build(b, ice);
    this.cache.set(b.id, { stamp, ice, plan });
    return plan;
  }
  forget(id: number): void { this.cache.delete(id); }
  clear(): void { this.cache.clear(); }

  private build(hut: WorldBuilding, ice: boolean): AnglingPlan {
    const all = this.d.bodies(), size = this.d.size;
    const usable = (b: FishBody): boolean => {
      if (ice) return ICE_FISHING && (b.kind === 'lake' || b.kind === 'pond'); // ice fishing: frozen lakes and ponds only, never rivers
      return !(this.d.riverFrozen?.(b.key) ?? false);
    };
    const near = nearWater(hut, all, size);
    const bodies = reachable(hut, all, size, usable);
    const piers: WorldBuilding[] = [];
    let noisy = false;
    for (const o of this.d.buildings()) {
      if (!o.active) continue;
      if (o.type === 'fishingPier') piers.push(o);
      else if (!noisy && tourDefOf(o.type)?.motorised && Math.hypot(o.x + o.w / 2 - (hut.x + hut.w / 2), o.y + o.h / 2 - (hut.y + hut.h / 2)) <= 14) noisy = true;
    }
    const spots = bodies.length ? spotsFor(hut, bodies, ice ? [] : piers, size, this.d.isWalk, ice) : [];
    const pierSpots = spots.filter((s) => s.kind === 'pier').length;
    return { near, bodies, spots, pierShare: spots.length ? pierSpots / spots.length : 0, ice, noisy };
  }
}

export interface FishVisit { catches: number; stock: number; body: FishBody | undefined }

/** One angler's visit: `FISH.casts` casts at the body chosen by their id; returns the catches (the stock moves inside `FishStock.cast`). */
export function fishVisit(stock: FishStock, plan: AnglingPlan, guestId: number, keep: boolean, rng: () => number): FishVisit {
  const body = plan.bodies.length ? plan.bodies[guestId % plan.bodies.length] : undefined;
  if (!body) return { catches: 0, stock: 0, body };
  const size = bodySize(body);
  let catches = 0;
  for (let k = 0; k < FISH.casts; k++) if (stock.cast(body.key, size, keep, rng())) catches++;
  return { catches, stock: stock.get(body.key), body };
}

/** Mood change of a finished visit: fish (and a pier) please, an empty or overfished water, a noisy neighbour and a frozen hole in the ice do not. */
export function visitMood(v: FishVisit, plan: AnglingPlan): number {
  let m = v.catches > 0 ? 0.07 + 0.03 * Math.min(3, v.catches) : -0.03;
  if (v.stock < FISH.overfished) m -= 0.06;
  if (plan.noisy) m -= 0.05;
  if (m > 0) m *= 1 + 0.2 * plan.pierShare;
  return m;
}
