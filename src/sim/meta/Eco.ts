import { ECO, ECO_POLICIES, ECO_POLICY_BY_ID, type EcoPolicyId } from '../../config/eco';

/** What the programme reads from the live game (wired by createSim; plain data so tests can feed it). */
export interface EcoSources {
  /** An Eco Centre stands and is connected (policies only work while it does). */
  centreActive(): boolean;
  /** Cash now, and a way to pay (ledger: upkeep). */
  funds(): number;
  pay(amount: number): void;
  /** A Train Station or Shuttle Depot works (softens the car-free arrivals dip). */
  transit(): boolean;
  /** Net tree deficit (felled - planted, incl. nursery credit); the sapling credit never exceeds it. */
  treeDeficit(): number;
  /** Yesterday's grid: energy dollars demanded and taken off the bill by renewables. */
  grid(): { demand: number; applied: number };
  /** Called once when the certificate is first earned. */
  onCertified?(): void;
}

export type EcoState = 'on' | 'off' | 'poor' | 'locked';
export interface EcoPolicyView { id: EcoPolicyId; state: EcoState; reason: string | null }
export interface EcoCertView {
  held: boolean; ever: boolean;
  /** Requirements for the certificate: policies running, renewable share, days held in a row. */
  policies: { have: number; need: number }; share: { have: number; need: number }; days: { have: number; need: number };
  /** Why the certificate cannot start (null = it can be started or already runs). */
  reason: string | null;
  /** The player switched the audit on (it costs `cert.perDay` while on). */
  on: boolean;
}
const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The Eco programme (docs/eco.md): five policies + the carbon-neutral certificate. Every effect is a multiplier that is exactly 1 (or an addend that
 * is exactly 0) when nothing is on or the Eco Centre is missing, so a game without it is bit-identical to one from before it existed.
 * Pure sim: no RNG, no three / DOM. Saved as module `eco` (null until the player touches it).
 */
export class Eco {
  private on = new Set<EcoPolicyId>();
  private certOn = false;
  private hold = 0;
  private everCertified = false;
  private eSum = 0; private gSum = 0;
  private credit = 0;
  private touched = false;
  constructor(private readonly src: EcoSources) {}

  /** Policies work only while the centre does. */
  get enabled(): boolean { return this.src.centreActive(); }
  has(id: EcoPolicyId): boolean { return this.enabled && this.on.has(id); }
  activeCount(): number { let n = 0; for (const p of ECO_POLICIES) if (this.has(p.id)) n++; return n; }
  get certified(): boolean { return this.enabled && this.certOn && this.hold >= ECO.cert.holdDays; }
  get everCertifiedFlag(): boolean { return this.everCertified; }
  /** Rolling share (0..1) of the energy demand that renewables took off the bill. */
  renewableShare(): number { return this.gSum > 0 ? Math.min(1, this.eSum / this.gSum) : 0; }

  /** Multiplier a policy puts on a knob (1 = untouched). */
  groomFuelMod(): number { return this.has('electricFleet') ? ECO.groomFuelMult : 1; }
  snowEnergyMod(): number { return this.has('smartSnow') ? ECO.smartSnowMult : 1; }
  liftEnergyMod(): number { return this.has('smartSnow') ? ECO.smartLiftMult : 1; }
  restaurantMod(): number { return this.has('localProduce') ? ECO.produceRestaurantMult : 1; }
  /** Arrivals: car-free village (-5%, -1.5% with transit) x certificate (+4%). */
  arrivalMult(): number {
    let m = 1;
    if (this.has('carFree')) m *= this.src.transit() ? ECO.carFreeArrivalsTransit : ECO.carFreeArrivals;
    if (this.certified) m *= ECO.cert.arrivals;
    return m;
  }
  /** Saplings credited as planted trees (floor), against the net deficit only. */
  treeCredit(): number { return this.credit; }
  /** Running cost per day ($): policies + the audit. */
  upkeepPerDay(): number {
    if (!this.enabled) return 0;
    let t = 0;
    for (const p of ECO_POLICIES) if (this.on.has(p.id)) t += p.perDay;
    if (this.certOn) t += ECO.cert.perDay;
    return t;
  }
  /** Facet points: the policies' points + the certificate's, bounded by `ECO.maxPoints`. */
  points(): number {
    if (!this.enabled) return 0;
    let t = 0;
    for (const p of ECO_POLICIES) if (this.on.has(p.id)) t += p.points;
    if (this.certified) t += ECO.cert.points;
    return Math.min(ECO.maxPoints, t);
  }
  /** Points all policies + the certificate would give (the documented maximum). */
  static maxPossible(): number { return Math.min(ECO.maxPoints, ECO_POLICIES.reduce((a, p) => a + p.points, 0) + ECO.cert.points); }

  blocker(id: EcoPolicyId): string | null {
    const p = ECO_POLICY_BY_ID[id];
    if (!p) return 'Unknown policy';
    if (!this.enabled) return 'Needs a working Eco Centre';
    if (this.on.has(id)) return 'Already running';
    if (this.src.funds() < p.fee) return 'Not enough cash';
    return null;
  }
  /** Start a policy (pays the fee). */
  start(id: EcoPolicyId): boolean {
    if (this.blocker(id)) return false;
    this.src.pay(ECO_POLICY_BY_ID[id]!.fee);
    this.on.add(id); this.touched = true;
    return true;
  }
  /** Switch a policy off (the fee is not refunded). */
  stop(id: EcoPolicyId): boolean { if (!this.on.delete(id)) return false; this.touched = true; return true; }
  startCert(): string | null {
    if (!this.enabled) return 'Needs a working Eco Centre';
    if (this.certOn) return 'Already running';
    if (this.src.funds() < ECO.cert.fee) return 'Not enough cash';
    this.src.pay(ECO.cert.fee); this.certOn = true; this.hold = 0; this.touched = true;
    return null;
  }
  stopCert(): boolean { if (!this.certOn) return false; this.certOn = false; this.hold = 0; this.touched = true; return true; }

  views(): EcoPolicyView[] {
    return ECO_POLICIES.map((p) => {
      if (!this.enabled) return { id: p.id, state: 'locked', reason: 'Needs a working Eco Centre' };
      if (this.on.has(p.id)) return { id: p.id, state: 'on', reason: null };
      if (this.src.funds() < p.fee) return { id: p.id, state: 'poor', reason: 'Not enough cash' };
      return { id: p.id, state: 'off', reason: null };
    });
  }
  certView(): EcoCertView {
    const C = ECO.cert, n = this.activeCount();
    let reason: string | null = null;
    if (!this.enabled) reason = 'Needs a working Eco Centre';
    else if (!this.certOn && this.src.funds() < C.fee) reason = 'Not enough cash';
    return { held: this.certified, ever: this.everCertified, policies: { have: n, need: C.policies }, share: { have: r2(this.renewableShare()), need: C.renewableShare }, days: { have: Math.min(this.hold, C.holdDays), need: C.holdDays }, reason, on: this.certOn };
  }

  /** Once per game day (after the previous day settled). */
  newDay(): void {
    const g = this.src.grid(), k = ECO.cert.decay;
    if (g.demand > 0 || g.applied > 0) { this.eSum += (g.applied - this.eSum) * k; this.gSum += (g.demand - this.gSum) * k; }
    if (this.has('habitat')) {
      const deficit = this.src.treeDeficit() - this.credit;
      if (deficit > 0) this.credit = r2(Math.min(this.credit + ECO.habitatSaplingsPerDay, this.credit + deficit));
    }
    const ok = this.enabled && this.certOn && this.activeCount() >= ECO.cert.policies && this.renewableShare() >= ECO.cert.renewableShare;
    const was = this.certified;
    this.hold = ok ? this.hold + 1 : 0;
    if (!was && this.certified) { const first = !this.everCertified; this.everCertified = true; this.touched = true; if (first) this.src.onCertified?.(); }
  }

  serialize(): unknown {
    if (!this.touched) return null;
    return { on: [...this.on].sort(), c: this.certOn, h: this.hold, e: this.everCertified, es: this.eSum, gs: this.gSum, cr: this.credit };
  }
  load(d: unknown): void {
    const o = d as { on?: string[]; c?: boolean; h?: number; e?: boolean; es?: number; gs?: number; cr?: number } | null;
    this.reset();
    if (!o) return;
    for (const id of o.on ?? []) if (ECO_POLICY_BY_ID[id]) this.on.add(id as EcoPolicyId);
    this.certOn = !!o.c; this.hold = o.h ?? 0; this.everCertified = !!o.e; this.eSum = o.es ?? 0; this.gSum = o.gs ?? 0; this.credit = o.cr ?? 0; this.touched = true;
  }
  reset(): void { this.on.clear(); this.certOn = false; this.hold = 0; this.everCertified = false; this.eSum = 0; this.gSum = 0; this.credit = 0; this.touched = false; }
}
