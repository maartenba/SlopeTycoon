import { STAFF, STAFF_POOLS, WAGE_LEVELS, type StaffPoolId, type WageLevel } from '../../config/staff';
import { STAFF_WAGE_PER_DAY } from '../../config/prices';

/**
 * Light staff (M5.4 Task 19): four pools, AUTO by default.
 *  - AUTO: the headcount is whatever the buildings are configured for today (instructors per school, sleds per hub, snowcats per garage,
 *    one crew per lift): fill ratio is exactly 1, nothing is slowed and no extra wage is paid, so the simulation is bit-identical to the
 *    pre-staff game (golden hash, tests/sim/staff.test.ts).
 *  - Override (per pool): the player picks a headcount. Fill = count / auto need, clamped to [minFill, 1]; the matching system slows by that
 *    factor. Each head above / below the auto need adds / saves STAFF_WAGE_PER_DAY a day. Over-staffing never speeds anything up (cost only).
 *  - Wage level (low / normal / high) scales the staff bill and sets the morale the crew settles at; understaffing drags morale down.
 *    Sloppy (low-morale) crews break lifts more often, careful ones slightly less. Normal morale is a dead band: factor exactly 1.
 * No named staff, no hiring screens. Pure sim: no three / DOM.
 */
export interface StaffNeeds { instructors: number; patrol: number; groomers: number; liftOps: number }
export interface StaffDeps {
  /** Auto headcounts from the world (called at most every `refreshTicks` while a pool is overridden, and by the UI). */
  needs: () => StaffNeeds;
  /** Wage multiplier of the difficulty (so overrides pay like the rest of the staff bill). */
  wageScale?: () => number;
}
export interface PoolState { auto: boolean; count: number }

export class Staff {
  readonly pools: Record<StaffPoolId, PoolState> = {
    instructors: { auto: true, count: 0 }, patrol: { auto: true, count: 0 }, groomers: { auto: true, count: 0 }, liftOps: { auto: true, count: 0 },
  };
  wage: WageLevel = 'normal';
  morale = STAFF.moraleTarget.normal;
  private cache: StaffNeeds = { instructors: 0, patrol: 0, groomers: 0, liftOps: 0 };
  private cacheTick = -1e9;
  private tick = 0;
  private anyOverride = false;

  constructor(private d: StaffDeps) {}

  /** Call every tick (cheap). */
  update(tick: number): void { this.tick = tick; }

  /** Auto headcounts (cached for `refreshTicks`; the UI forces a fresh read). */
  needs(fresh = false): StaffNeeds {
    if (fresh || this.tick - this.cacheTick >= STAFF.refreshTicks || this.tick < this.cacheTick) { this.cache = this.d.needs(); this.cacheTick = this.tick; }
    return this.cache;
  }

  isAuto(p: StaffPoolId): boolean { return this.pools[p].auto; }
  /** Headcount working in a pool right now (auto = the need). */
  headcount(p: StaffPoolId): number { return this.pools[p].auto ? this.needs()[p] : this.pools[p].count; }

  /** Switch a pool to Auto (true) or override (false; starts from today's headcount). */
  setAuto(p: StaffPoolId, auto: boolean): void {
    const s = this.pools[p];
    if (s.auto === auto) return;
    s.auto = auto;
    if (!auto) s.count = this.needs(true)[p];
    this.anyOverride = STAFF_POOLS.some((q) => !this.pools[q].auto);
  }
  setCount(p: StaffPoolId, n: number): void {
    if (this.pools[p].auto) this.setAuto(p, false);
    this.pools[p].count = Math.max(0, Math.min(STAFF.maxPerPool, Math.round(n)));
  }
  setWage(w: WageLevel): void { if (WAGE_LEVELS.includes(w)) this.wage = w; }

  /** 0..1 fill of a pool (1 in Auto, 1 when over-staffed or when nothing is needed). Clamped to `minFill`. */
  fill(p: StaffPoolId): number {
    const s = this.pools[p];
    if (s.auto) return 1;
    const need = this.needs()[p];
    if (need <= 0 || s.count >= need) return 1;
    return Math.max(STAFF.minFill, s.count / need);
  }
  /** Headcount cap for the groomers (null = no cap, i.e. Auto). */
  groomerLimit(): number | null { return this.pools.groomers.auto ? null : this.pools.groomers.count; }

  /** Wage multiplier for the existing staff bill (1 at 'normal'). */
  wageMult(): number { return STAFF.wageMult[this.wage]; }
  /** Extra (or saved) wages per day from overridden pools, before the wage multiplier. 0 in Auto. */
  extraWagesPerDay(): number {
    if (!this.anyOverride) return 0;
    const need = this.needs();
    let t = 0;
    for (const p of STAFF_POOLS) if (!this.pools[p].auto) t += (this.pools[p].count - need[p]) * STAFF_WAGE_PER_DAY * (this.d.wageScale?.() ?? 1);
    return t;
  }

  /** Breakdown multiplier from crew morale (exactly 1 in the dead band). */
  breakdownFactor(): number {
    const m = this.morale;
    return m < STAFF.lowBelow ? 1 + (STAFF.lowBelow - m) * STAFF.sloppy : m > STAFF.highAbove ? STAFF.careful : 1;
  }
  moraleLabel(): string { return this.morale < STAFF.lowBelow ? 'Grumpy' : this.morale > STAFF.highAbove ? 'Delighted' : this.morale < 0.65 ? 'Tired' : 'Content'; }

  /** Once per in-game day. */
  newDay(): void {
    let worst = 1;
    for (const p of STAFF_POOLS) worst = Math.min(worst, this.fill(p));
    const target = Math.max(0, STAFF.moraleTarget[this.wage] - STAFF.overworkPenalty * (1 - worst));
    const delta = target - this.morale;
    if (delta !== 0) this.morale = Math.max(0, Math.min(1, this.morale + Math.max(-STAFF.moraleStep, Math.min(STAFF.moraleStep, delta))));
  }

  serialize(): unknown { return { pools: STAFF_POOLS.map((p) => [p, this.pools[p].auto, this.pools[p].count]), wage: this.wage, morale: this.morale }; }
  load(d: unknown): void {
    const s = d as { pools: Array<[StaffPoolId, boolean, number]>; wage: WageLevel; morale: number } | null;
    this.reset();
    if (!s) return;
    for (const [p, auto, count] of s.pools ?? []) if (this.pools[p]) { this.pools[p].auto = auto; this.pools[p].count = count; }
    this.wage = WAGE_LEVELS.includes(s.wage) ? s.wage : 'normal';
    this.morale = typeof s.morale === 'number' ? s.morale : STAFF.moraleTarget.normal;
    this.anyOverride = STAFF_POOLS.some((q) => !this.pools[q].auto);
    this.cacheTick = -1e9;
  }
  reset(): void {
    for (const p of STAFF_POOLS) { this.pools[p].auto = true; this.pools[p].count = 0; }
    this.wage = 'normal'; this.morale = STAFF.moraleTarget.normal; this.anyOverride = false; this.cacheTick = -1e9;
  }
}
