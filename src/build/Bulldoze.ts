import { BUILDINGS } from '../config/buildings';
import type { Buildings, PlacedBuilding } from '../sim/Buildings';
import type { Economy } from '../sim/Economy';

export const REFUND_FRACTION = 0.5;

export const refundValue = (type: string): number => Math.round((BUILDINGS[type]?.cost ?? 0) * REFUND_FRACTION);

export interface BulldozeResult {
  ok: boolean;
  removed?: PlacedBuilding;
  refund: number;
  /** Buildings whose status changed (cascade); inspect `.active`/`.reason`. */
  changed: PlacedBuilding[];
}

/** Remove a building: 50% refund, frees occupancy, cascades dependents. */
export function bulldoze(store: Buildings, economy: Economy, id: number): BulldozeResult {
  const r = store.remove(id);
  if (!r) return { ok: false, refund: 0, changed: [] };
  const refund = refundValue(r.removed.type);
  economy.refund(refund);
  const changed = r.changed.map((c) => store.get(c)).filter((b): b is PlacedBuilding => !!b);
  return { ok: true, removed: r.removed, refund, changed };
}
