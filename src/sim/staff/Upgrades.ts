import { STAFF_UPGRADES, UPGRADE_BY_ID, type ModKey, type StaffUpgradeDef } from '../../config/staffUpgrades';

/**
 * The six staff upgrades (M5.4 Task 20). One-off items: pay the cost, train N days (one at a time), then the effect is permanent and a small
 * upkeep is booked daily. Effects are multipliers read through `mod(sim, key)` (config/balance.ts); with nothing trained every key is exactly 1,
 * so the pre-upgrade simulation is bit-identical. Pure sim: no three / DOM.
 */
export interface UpgradeDeps {
  /** Pay the one-time cost (ledger 'staff'). Returns false if the funds are not there. */
  pay: (amount: number) => boolean;
  funds: () => number;
  /** `null` = available; otherwise the reason (level gate). */
  gate?: (minLevel: number) => string | null;
  onDone?: (def: StaffUpgradeDef) => void;
}
export interface UpgradeView { def: StaffUpgradeDef; state: 'done' | 'training' | 'available' | 'locked' | 'busy' | 'poor'; daysLeft: number; reason: string | null }

export class StaffUpgrades {
  private done = new Set<string>();
  training: { id: string; daysLeft: number } | null = null;

  constructor(private d: UpgradeDeps) {}

  has(id: string): boolean { return this.done.has(id); }
  get count(): number { return this.done.size; }
  /** Multiplier of a balance knob (1 = untouched). */
  mod(key: ModKey): number {
    let m = 1;
    for (const u of STAFF_UPGRADES) if (this.done.has(u.id)) { const e = u.effects[key]; if (e !== undefined) m *= e; }
    return m;
  }
  /** Daily upkeep of the trained upgrades ($). */
  upkeepPerDay(): number { let t = 0; for (const u of STAFF_UPGRADES) if (this.done.has(u.id)) t += u.upkeep; return t; }
  /** 0..1 habitat-protection input for the later sustainability facet (Task 23): 1 once the rangers are trained. */
  wildlifeProtection(): number { return this.done.has('rangers') ? 1 : 0; }

  /** Why `id` cannot start now (null = it can). */
  blocker(id: string): string | null {
    const u = UPGRADE_BY_ID[id];
    if (!u) return 'Unknown upgrade';
    if (this.done.has(id)) return 'Already trained';
    if (this.training) return this.training.id === id ? 'Already training' : 'Another course is running';
    const g = this.d.gate?.(u.minLevel);
    if (g) return g;
    if (this.d.funds() < u.cost) return 'Not enough cash';
    return null;
  }
  start(id: string): boolean {
    if (this.blocker(id)) return false;
    const u = UPGRADE_BY_ID[id]!;
    if (!this.d.pay(u.cost)) return false;
    this.training = { id, daysLeft: u.days };
    return true;
  }
  /** Once per in-game day. */
  newDay(): void {
    const t = this.training;
    if (!t) return;
    if (--t.daysLeft <= 0) { this.done.add(t.id); this.training = null; this.d.onDone?.(UPGRADE_BY_ID[t.id]!); }
  }
  views(): UpgradeView[] {
    return STAFF_UPGRADES.map((def) => {
      if (this.done.has(def.id)) return { def, state: 'done', daysLeft: 0, reason: null };
      if (this.training?.id === def.id) return { def, state: 'training', daysLeft: this.training.daysLeft, reason: null };
      const g = this.d.gate?.(def.minLevel);
      if (g) return { def, state: 'locked', daysLeft: 0, reason: g };
      if (this.training) return { def, state: 'busy', daysLeft: 0, reason: 'Another course is running' };
      if (this.d.funds() < def.cost) return { def, state: 'poor', daysLeft: 0, reason: 'Not enough cash' };
      return { def, state: 'available', daysLeft: 0, reason: null };
    });
  }

  serialize(): unknown { return { done: [...this.done].sort(), training: this.training ? { ...this.training } : null }; }
  load(d: unknown): void {
    const s = d as { done?: string[]; training?: { id: string; daysLeft: number } | null } | null;
    this.reset();
    if (!s) return;
    for (const id of s.done ?? []) if (UPGRADE_BY_ID[id]) this.done.add(id);
    this.training = s.training && UPGRADE_BY_ID[s.training.id] ? { ...s.training } : null;
  }
  reset(): void { this.done.clear(); this.training = null; }
}
