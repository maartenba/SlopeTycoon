import type { AttractionSpec, Appeal } from './Attraction';
import type { LodgingTier } from '../../config/prices';

/** Chalet / Apartment: overnight guests only (rooms = catalog capacity); Base Lodge rooms live on its restaurant spec. */
export const LODGING_SPECS: Record<string, AttractionSpec> = {
  chalet: { kind: 'lodging', serviceTicks: 8, slots: 4, effects: { fatigue: -0.4, happiness: 0.05 }, appeal: [0.1, 0.4, 0.4, 0.5, 0.1, 0.2], overnightOnly: true, rooms: 12 },
  apartment: { kind: 'lodging', serviceTicks: 8, slots: 8, effects: { fatigue: -0.4, happiness: 0.03 }, appeal: [0.1, 0.3, 0.4, 0.2, 0.3, 0.2], overnightOnly: true, rooms: 40 },
};

/**
 * Lodging v2: appeal shift per tier, [solo, couple, family, vip, budget, adventure]. Budget houses draw budget guests and put VIPs off;
 * luxury is the opposite. Standard is neutral. Use `tierAppeal(base, tier)` when authoring a tiered spec.
 */
export const TIER_APPEAL_SHIFT: Record<LodgingTier, Appeal> = {
  budget: [0, -0.05, 0, -0.3, 0.3, 0],
  standard: [0, 0, 0, 0, 0, 0],
  luxury: [0, 0.1, 0, 0.4, -0.25, 0],
};
export function tierAppeal(base: Appeal, tier: LodgingTier): Appeal {
  const d = TIER_APPEAL_SHIFT[tier];
  return base.map((v, i) => Math.max(0, Math.min(1, +(v + d[i]!).toFixed(3)))) as unknown as Appeal;
}

/** Who sleeps where. Guests are tracked by id; stale ones (left the resort) are purged before each check-in. */
export class RoomBook {
  private rooms = new Map<number, Set<number>>();
  private of = new Map<number, number>();

  occupied(buildingId: number): number { return this.rooms.get(buildingId)?.size ?? 0; }
  roomOf(guestId: number): number | undefined { return this.of.get(guestId); }
  assign(guestId: number, buildingId: number): void {
    let s = this.rooms.get(buildingId);
    if (!s) this.rooms.set(buildingId, (s = new Set()));
    s.add(guestId); this.of.set(guestId, buildingId);
  }
  /** Free every room whose guest is gone or whose building was removed. */
  purge(alive: (guestId: number) => boolean, hasBuilding: (id: number) => boolean): void {
    for (const [b, set] of this.rooms) {
      if (!hasBuilding(b)) { for (const g of set) this.of.delete(g); this.rooms.delete(b); continue; }
      for (const g of set) if (!alive(g)) { set.delete(g); this.of.delete(g); }
    }
  }
  clear(): void { this.rooms.clear(); this.of.clear(); }
  serialize(): Array<[number, number[]]> { return [...this.rooms].map(([b, s]) => [b, [...s].sort((a, c) => a - c)] as [number, number[]]).sort((a, c) => a[0] - c[0]); }
  load(d: Array<[number, number[]]> | undefined): void { this.clear(); for (const [b, ids] of d ?? []) for (const g of ids) this.assign(g, b); }
  total(): number { return this.of.size; }
}
