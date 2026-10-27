import { guestTypeCount, typeLabel } from '../../config/guestTypes';
import type { GuestStore } from './Guest';

export interface TypeRow { type: number; label: string; count: number; share: number; happiness: number }

/** Live breakdown of the guests in the resort by type (every defined type, core first; empty extras are kept so the table is stable). Pure, read-only. */
export function guestTypeBreakdown(s: GuestStore): TypeRow[] {
  const n = guestTypeCount();
  const cnt = new Array<number>(n).fill(0), hap = new Array<number>(n).fill(0);
  let total = 0;
  for (let i = 0; i < s.limit; i++) {
    if (!s.alive[i]) continue;
    const t = s.type[i]!;
    if (t >= n) continue;
    cnt[t]!++; hap[t]! += s.happiness[i]!; total++;
  }
  return cnt.map((c, t) => ({ type: t, label: typeLabel(t), count: c, share: total ? c / total : 0, happiness: c ? hap[t]! / c : 0 }));
}
