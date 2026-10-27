import { LIFTS, normalizeLiftKind } from '../../config/lifts';
import { ENERGY_COST_MULT, LIFT_OPS, LIFT_SERVICE } from '../../config/liftOps';
import { GAME_MINUTES_PER_TICK, DAYS_PER_YEAR, DAYS_PER_MONTH } from '../../config/balance';
import { simDayOf, realMonthOfDay } from '../calendar';
import type { GameState } from '../../core/GameState';
import type { GameBus } from '../../core/events';
import { Rng } from '../../core/Rng';
import { hourOfDay, seasonOf } from '../Clock';
import { autoLiftHours } from '../Daylight';
import { liftStats, upkeepPerDay, samplePath, liftPath, type InspectionLevel, type LiftMaint, type LiftData, type LiftFault, type LiftHold, type LiftOpMode, type LiftOpsData } from '../Lift';
import type { Incident } from './Incidents';
import { Sev } from './Incidents';

export type SeasonProfile = 'winter' | 'shoulder' | 'summer';
export const SEASON_PROFILES: readonly SeasonProfile[] = ['winter', 'shoulder', 'summer'];
export const profileOfSeason = (s: string): SeasonProfile => (s === 'winter' ? 'winter' : s === 'summer' ? 'summer' : 'shoulder');

/** A lift counts as "open for business" for ratings/arrivals when open, or only closed for the night / inspection. */
export const liftOpenForBusiness = (l: Pick<LiftData, 'open' | 'opsReason'>): boolean => l.open || l.opsReason === 'hours' || l.opsReason === 'inspection' || l.opsReason === 'service'; // planned closures are announced and do not count against the rating

export interface LiftOpsDeps {
  lifts: () => LiftData[];
  bus?: Pick<GameBus, 'emit'>;
  seed?: number;
  weather: () => { kind: string; intensity: number };
  /** Air temperature (deg C) at a lift's top station. */
  temperature: (l: LiftData) => number;
  hasWorkshop: () => boolean;
  /** Guests currently on the cable / waiting (guest queues). */
  queues: { ridersOn(liftId: number): number; queueLength(liftId: number): number };
  incidents?: {
    report(kind: 'stranded', x: number, y: number, severity: number, guestId?: number): Incident | null;
    resolve(inc: Incident, outcome: 'recovered' | 'evacuated' | 'left', who: 'none', severe?: boolean): void;
    byId(id: number): Incident | undefined;
  };
  /** Immediate maintenance spend (ledger 'maintenance'). */
  spend?: (amount: number) => void;
  /** Crew morale x lift-mechanics training on the breakdown rate (1 = untouched; Task 19 / 20). */
  breakdownFactor?: () => number;
  /** Lift-mechanics training on repair duration (1 = untouched). */
  repairFactor?: () => number;
  /** Planned service: duration and cost multipliers from crew morale x lift-mechanics training (1 = untouched). */
  serviceFactor?: () => { time: number; cost: number };
  /** Live absolute day (year x 180 + day) for read-only queries between ticks. */
  today?: () => number;
}

export type MaintPolicy = 'auto' | 'manual';
export type ServiceState = 'ok' | 'due' | 'overdue' | 'critical';
export type ServiceLevel = 'basic' | 'thorough';
export interface ServicePlan { level: ServiceLevel; days: number; cost: number }
export interface ServiceStatus {
  state: ServiceState; policy: MaintPolicy;
  /** Days since the last service (commissioning counts until the first one). */
  sinceDays: number; lastDay: number | null; lastLevel: ServiceLevel | null; count: number;
  /** Real month index (0 = January) of the window; `windowAuto` when it is the automatic pick. */
  windowMonth: number; windowAuto: boolean; autoMonth: number;
  /** Absolute day the next service starts (earliest), null when the policy is Manual. */
  nextDay: number | null;
  plan: ServicePlan;
  /** Breakdown-risk multiplier from the service state now (<1 fresh, >1 overdue) and if the next service is skipped. */
  riskMult: number; skipRiskMult: number;
  /** Closed for service right now: hours left. */
  inServiceHours: number;
}

export interface LiftOpsStatus {
  mode: LiftOpMode; condition: number; ageDays: number; hold: LiftHold | null;
  fault: LiftFault | null; repairEtaHours: number; stranded: number;
  lastInspectionDaysAgo: number | null; nextInspectionDays: number | null; inspection: InspectionLevel;
  breakdownRiskPerDay: number; hasWorkshop: boolean;
  service: ServiceStatus;
}

const HPT = GAME_MINUTES_PER_TICK / 60; // hours per tick

export function defaultOps(kind: string): LiftOpsData {
  const d = LIFTS[normalizeLiftKind(kind)];
  return {
    mode: 'auto', from: LIFT_OPS.defaultFrom, to: LIFT_OPS.defaultTo, daylight: true, eco: false,
    seasons: { winter: true, shoulder: d.carriesBikes, summer: d.carriesBikes },
    inspection: 'none', condition: 100, ageDays: 0, lastInspection: -1, fault: null, energyToday: 0, runHoursToday: 0, breakdowns: 0,
  };
}

export const inHours = (hr: number, from: number, to: number): boolean => (from <= to ? hr >= from && hr < to : hr >= from || hr < to);

/** Lift operations: open/close modes, schedules, energy, wear, inspections, breakdowns, stranded guests, repairs. Deterministic (seeded). */
export class LiftOps {
  private rng: Rng;
  private policy: MaintPolicy = 'auto';
  private tick = 0;
  private absDay = -1;
  private profile: SeasonProfile | null = null;
  private cache = new Map<number, { sig: string; lengthM: number; thr: number }>();
  private hourNow = 12;

  constructor(private d: LiftOpsDeps) { this.rng = new Rng((d.seed ?? 1) ^ 0x11f7); }

  /** Ensure a lift has operations data. */
  ops(l: LiftData): LiftOpsData { return l.ops ?? (l.ops = defaultOps(l.kind)); }

  private info(l: LiftData): { lengthM: number; thr: number } {
    const sig = `${l.kind}:${l.speed}:${l.nodes.length}:${l.nodes[0]?.x}:${l.nodes[l.nodes.length - 1]?.z}`;
    const c = this.cache.get(l.id);
    if (c && c.sig === sig) return c;
    const s = liftStats({ ...l, ecoActive: false });
    const n = { sig, lengthM: s.lengthM, thr: s.throughputPerHour };
    this.cache.set(l.id, n);
    return n;
  }

  // ---------- derived numbers ----------

  /** Dollars per running hour (energy). */
  energyPerHour(l: LiftData, eco = false): number {
    const def = LIFTS[normalizeLiftKind(l.kind)];
    const sp = l.speed * (eco ? 0.5 : 1);
    return ENERGY_COST_MULT * def.energyPerHour * (0.5 + this.info(l).lengthM / 1000) * (0.35 + 0.65 * sp);
  }

  private weatherKey(l: LiftData): 'storm' | 'heavySnow' | 'snow' | 'icing' | null {
    const w = this.d.weather();
    if (w.kind === 'storm') return 'storm';
    if (w.kind === 'heavySnow') return 'heavySnow';
    if (w.kind === 'snow') return this.d.temperature(l) < LIFT_OPS.icingTemp ? 'icing' : 'snow';
    return null;
  }

  /** Breakdown probability per operating hour. */
  breakdownPerHour(l: LiftData): number {
    const o = this.ops(l), def = LIFTS[normalizeLiftKind(l.kind)];
    const wk = this.weatherKey(l);
    const insp = o.inspection === 'none' ? 1 : this.inspectionFresh(o) ? LIFT_OPS.inspectionRisk[o.inspection] : 1;
    const wear = 1 + (100 - o.condition) / 25;
    return LIFT_OPS.breakdownPerHour * wear * wear * (1 + o.ageDays / 720) * (wk ? LIFT_OPS.breakdownWeather[wk] : 1) * insp * this.serviceRiskMult(o, this.sinceDays(o)) * def.wearRate * (this.d.breakdownFactor?.() ?? 1);
  }

  // ---------- planned maintenance ----------

  /** Today as an absolute day: the live date when wired (UI / advisor read between ticks), else the last ticked day. */
  private now(): number { return this.d.today?.() ?? this.absDay; }

  /** Days since the last service (commissioning until the first one). Lifts LiftOps has not seen yet read 0. */
  private sinceDays(o: LiftOpsData): number { return o.maint ? Math.max(0, this.now() - o.maint.last) : 0; }

  /** Breakdown multiplier from the service state: fresh service relieves (fading over a year), overdue escalates. */
  private serviceRiskMult(o: LiftOpsData, since: number): number {
    const S = LIFT_SERVICE, over = since - S.intervalDays;
    if (over > 0) return 1 + S.overdueSlope * Math.min(over, S.overdueCapDays) / 90;
    const m = o.maint;
    if (!m || m.count === 0 || !m.level) return 1;
    return 1 - S[m.level].riskBonus * (1 - since / S.intervalDays);
  }

  private stateOf(since: number): ServiceState {
    const S = LIFT_SERVICE;
    return since > S.criticalDays ? 'critical' : since > S.intervalDays ? 'overdue' : since >= S.intervalDays - S.dueSoonDays ? 'due' : 'ok';
  }

  /** Window month (real index, 0 = January): the chosen one, else April for winter lifts and October for summer-only lifts. */
  windowMonth(l: LiftData): number {
    const w = this.ops(l).maint?.window;
    return w !== undefined ? w : this.autoMonth(l);
  }
  /** The automatic window month of a lift (ignores a chosen window). */
  autoMonth(l: LiftData): number {
    const o = this.ops(l);
    return !o.seasons.winter && (o.seasons.summer || o.seasons.shoulder) ? LIFT_SERVICE.autoMonthSummer : LIFT_SERVICE.autoMonthWinter;
  }

  /** Planned service for the lift: level follows the inspection setting (thorough, else basic). Length scales with condition and lift length, cost with length and workshop. */
  servicePlan(l: LiftData, level?: ServiceLevel): ServicePlan {
    const o = this.ops(l), S = LIFT_SERVICE, lv = level ?? (o.inspection === 'thorough' ? 'thorough' : 'basic'), B = S[lv];
    const len = this.info(l).lengthM, f = this.d.serviceFactor?.() ?? { time: 1, cost: 1 };
    const raw = B.days + (100 - o.condition) / S.conditionDays + (len > S.longLiftM ? S.longLiftDays : 0);
    const days = Math.max(1, Math.round(raw * f.time * (this.d.hasWorkshop() ? 1 : 1.25)));
    const cost = (S.labourPerDay * days + B.parts * (1 + (len / 100) * S.partsPer100m)) * (this.d.hasWorkshop() ? S.workshopCost : S.contractorCost) * f.cost;
    return { level: lv, days, cost };
  }

  private minGap(o: LiftOpsData): number { return o.maint && o.maint.count > 0 ? LIFT_SERVICE.minGapAfterServiceDays : LIFT_SERVICE.minGapDays; }

  private windowStart(abs: number, month: number): number { return abs - (((abs % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR) + simDayOf(month, 1); }

  /** Earliest absolute day the next planned service may start (Auto policy), or null. A window already open and not yet served returns today. */
  nextServiceDay(l: LiftData): number | null {
    if (this.policy === 'manual') return null;
    const o = this.ops(l), last = o.maint?.last ?? this.now(), m = this.windowMonth(l);
    for (let k = -1; k < 3; k++) {
      const c = this.windowStart(this.now(), m) + DAYS_PER_YEAR * k, end = c + DAYS_PER_MONTH - 1;
      const earliest = Math.max(c, last + this.minGap(o));
      if (earliest <= end && end >= this.now()) return Math.max(earliest, this.now());
    }
    return null;
  }

  serviceStatus(l: LiftData): ServiceStatus {
    const o = this.ops(l), since = this.sinceDays(o), next = this.nextServiceDay(l);
    const plan = this.servicePlan(l), f = o.fault;
    // if the service is skipped: where the risk stands 90 days after it falls due (never below 'due', so a fresh service cannot read as a bargain)
    const skip = this.serviceRiskMult(o, Math.max(since, LIFT_SERVICE.intervalDays) + 90);
    return {
      state: this.stateOf(since), policy: this.policy, sinceDays: since, lastDay: o.maint && o.maint.count > 0 ? o.maint.last : null, lastLevel: o.maint?.level ?? null, count: o.maint?.count ?? 0,
      windowMonth: this.windowMonth(l), autoMonth: this.autoMonth(l), windowAuto: o.maint?.window === undefined, nextDay: next, plan,
      riskMult: this.serviceRiskMult(o, since), skipRiskMult: skip, inServiceHours: f?.kind === 'service' ? Math.max(0, (f.endTick - this.tick) * HPT) : 0,
    };
  }

  setPolicy(p: MaintPolicy): void { this.policy = p; }
  getPolicy(): MaintPolicy { return this.policy; }
  /** Pick a service month (real index 0..11) or 'auto' for one lift. */
  setServiceWindow(id: number, month: number | 'auto'): void {
    const l = this.find(id); if (!l) return;
    const m = this.maintOf(l);
    if (month === 'auto') delete m.window; else m.window = ((Math.floor(month) % 12) + 12) % 12;
  }
  /** Bulk: every lift services in `month` (real index). */
  scheduleAll(month: number | 'auto'): void { for (const l of this.d.lifts()) this.setServiceWindow(l.id, month); }
  private maintOf(l: LiftData): LiftMaint { const o = this.ops(l); return o.maint ?? (o.maint = { last: Math.max(0, this.now()), count: 0 }); }

  /** Service now. Only when the lift carries nobody and nobody queues (guests are never stranded) and it is not broken. */
  serviceNow(id: number, level?: ServiceLevel): boolean {
    const l = this.find(id); if (!l) return false;
    const o = this.ops(l);
    if (o.fault || this.d.queues.ridersOn(l.id) > 0 || this.d.queues.queueLength(l.id) > 0) return false;
    return this.startService(l, o, level);
  }

  /** Whether a service could start right now (empty, not faulted). */
  canServiceNow(id: number): boolean {
    const l = this.find(id); if (!l) return false;
    return !this.ops(l).fault && this.d.queues.ridersOn(l.id) === 0 && this.d.queues.queueLength(l.id) === 0;
  }

  private startService(l: LiftData, o: LiftOpsData, level?: ServiceLevel): boolean {
    const plan = this.servicePlan(l, level);
    this.maintOf(l);
    this.d.spend?.(plan.cost);
    o.fault = { kind: 'service', startTick: this.tick, endTick: this.tick + Math.max(1, Math.ceil((plan.days * 24) / HPT)), stranded: 0, incidentId: 0, level: plan.level };
    this.applyHold(l, this.hourNow, this.profile ?? 'winter');
    this.d.bus?.emit('lift:serviceStarted', { id: l.id, days: plan.days, cost: Math.round(plan.cost) });
    return true;
  }

  /** Projected service spend ($) of lifts whose next service starts within `days` days from now (Auto policy). */
  projectedServiceCost(days = 30): { cost: number; count: number } {
    let cost = 0, count = 0;
    for (const l of this.d.lifts()) {
      const n = this.nextServiceDay(l);
      if (n !== null && n < this.now() + days) { cost += this.servicePlan(l).cost; count++; }
    }
    return { cost, count };
  }

  private inspectionFresh(o: LiftOpsData): boolean {
    if (o.inspection === 'none' || o.lastInspection < 0) return false;
    return this.absDay - o.lastInspection <= LIFT_OPS.inspection[o.inspection].everyDays * 1.5;
  }

  private repairPlan(o: LiftOpsData, planned: boolean): { hours: number; cost: number } {
    const R = LIFT_OPS.repair, w = this.d.hasWorkshop();
    const missing = 100 - o.condition;
    let hours = (R.baseHours + R.hoursPerPoint * missing) * (w ? LIFT_OPS.workshopTimeFactor : LIFT_OPS.contractor.timeFactor);
    if (!w && !planned) hours += LIFT_OPS.contractor.callOutHours;
    const cost = (R.baseCost + R.costPerPoint * missing) * (w ? 1 : LIFT_OPS.contractor.costFactor);
    return { hours: Math.max(1.5, hours * (this.d.repairFactor?.() ?? 1)), cost };
  }

  /** Inspection cost ($) and duration (hours) for a lift. */
  inspectionPlan(l: LiftData, level: Exclude<InspectionLevel, 'none'>): { cost: number; hours: number } {
    const I = LIFT_OPS.inspection[level], w = this.d.hasWorkshop();
    return { cost: (I.cost + (this.info(l).lengthM / 100) * I.cost * 0.15) * (w ? 1 : 1.6), hours: I.hours * (w ? 1 : 1.8) };
  }

  // ---------- player actions ----------

  setMode(id: number, mode: LiftOpMode): void {
    const l = this.find(id); if (!l) return;
    const o = this.ops(l); o.mode = mode;
    if (mode === 'closed') { if (l.open) l.open = false; l.opsClosed = true; l.opsReason = 'manual'; }
    this.applyHold(l, this.hourNow, this.profile ?? 'winter');
  }
  setDaylight(id: number, on: boolean): void { const l = this.find(id); if (l) { const o = this.ops(l); o.daylight = on; if (on) this.syncDaylight(o, this.dayNow); } }
  private syncDaylight(o: LiftOpsData, day: number): void { const w = autoLiftHours(day); o.from = Math.round(w.from * 100) / 100; o.to = Math.round(w.to * 100) / 100; }
  private dayNow = 240;
  setHours(id: number, from: number, to: number): void { const l = this.find(id); if (l) { const o = this.ops(l); o.daylight = false; o.from = Math.max(0, Math.min(24, from)); o.to = Math.max(0, Math.min(24, to)); } }
  setEco(id: number, eco: boolean): void { const l = this.find(id); if (l) { this.ops(l).eco = eco; if (!eco) l.ecoActive = false; } }
  setSeason(id: number, p: SeasonProfile, on: boolean): void { const l = this.find(id); if (l) this.ops(l).seasons[p] = on; }
  setInspection(id: number, level: InspectionLevel): void { const l = this.find(id); if (l) this.ops(l).inspection = level; }

  /** Start an inspection now (closes the lift for its duration). */
  inspectNow(id: number, level: Exclude<InspectionLevel, 'none'> = 'basic'): boolean {
    const l = this.find(id); if (!l) return false;
    const o = this.ops(l);
    if (o.fault) return false;
    const plan = this.inspectionPlan(l, level);
    this.d.spend?.(plan.cost);
    o.fault = { kind: 'inspection', startTick: this.tick, endTick: this.tick + Math.max(1, Math.ceil(plan.hours / HPT)), stranded: 0, incidentId: 0, level };
    this.applyHold(l, this.hourNow, this.profile ?? 'winter');
    return true;
  }

  /** Broken: pay a rush fee to halve the remaining repair time (once). Not broken and worn: start a planned overhaul to condition 100. */
  repairNow(id: number): boolean {
    const l = this.find(id); if (!l) return false;
    const o = this.ops(l), f = o.fault;
    if (f && (f.kind === 'breakdown' || f.kind === 'overhaul')) {
      if (f.rushed) return false;
      f.rushed = true; f.endTick = this.tick + Math.max(1, Math.ceil((f.endTick - this.tick) / 2));
      this.d.spend?.(this.repairPlan(o, false).cost * (LIFT_OPS.repair.rushCostFactor - 1));
      return true;
    }
    if (f || o.condition >= 95) return false;
    const plan = this.repairPlan(o, true);
    this.d.spend?.(plan.cost);
    o.fault = { kind: 'overhaul', startTick: this.tick, endTick: this.tick + Math.max(1, Math.ceil(plan.hours / HPT)), stranded: 0, incidentId: 0 };
    this.applyHold(l, this.hourNow, this.profile ?? 'winter');
    return true;
  }

  /** Quick action: in `profile`, run only the listed lifts (others off). Emits the aggregate schedule event. */
  keepOnly(profile: SeasonProfile, keep: ReadonlySet<number>): void {
    for (const l of this.d.lifts()) this.ops(l).seasons[profile] = keep.has(l.id);
    this.announce(profile);
  }
  /** Quick action: everything on in `profile`. */
  enableAll(profile: SeasonProfile): void { for (const l of this.d.lifts()) this.ops(l).seasons[profile] = true; this.announce(profile); }

  /** Projected energy ($/day) if the schedule for `profile` ran as configured. */
  projectedDailyEnergy(profile: SeasonProfile): number {
    let t = 0;
    for (const l of this.d.lifts()) {
      const o = this.ops(l);
      if (o.mode === 'closed' || !o.seasons[profile]) continue;
      const hours = o.to >= o.from ? o.to - o.from : 24 - o.from + o.to;
      t += this.energyPerHour(l, o.eco) * hours;
    }
    return t;
  }

  scheduleTable(): Array<{ id: number; kind: string; mode: LiftOpMode; daylight: boolean; from: number; to: number; eco: boolean; seasons: LiftOpsData['seasons']; energyPerDay: number; inspection: InspectionLevel }> {
    return [...this.d.lifts()].sort((a, b) => a.id - b.id).map((l) => {
      const o = this.ops(l), hours = o.to >= o.from ? o.to - o.from : 24 - o.from + o.to;
      return { id: l.id, kind: l.kind, mode: o.mode, daylight: !!o.daylight, from: o.from, to: o.to, eco: o.eco, seasons: { ...o.seasons }, energyPerDay: this.energyPerHour(l, o.eco) * hours, inspection: o.inspection };
    });
  }

  status(id: number): LiftOpsStatus | null {
    const l = this.find(id); if (!l) return null;
    const o = this.ops(l), f = o.fault;
    const I = o.inspection === 'none' ? null : LIFT_OPS.inspection[o.inspection];
    return {
      mode: o.mode, condition: o.condition, ageDays: o.ageDays, hold: l.opsReason ?? null, fault: f,
      repairEtaHours: f ? Math.max(0, (f.endTick - this.tick) * HPT) : 0, stranded: f && !l.evac ? f.stranded : 0,
      lastInspectionDaysAgo: o.lastInspection >= 0 ? this.absDay - o.lastInspection : null,
      nextInspectionDays: I && o.lastInspection >= 0 ? Math.max(0, I.everyDays - (this.absDay - o.lastInspection)) : null,
      inspection: o.inspection, service: this.serviceStatus(l), breakdownRiskPerDay: 1 - Math.pow(1 - this.breakdownPerHour(l), LIFT_OPS.nominalHours), hasWorkshop: this.d.hasWorkshop(),
    };
  }

  private find(id: number): LiftData | undefined { return this.d.lifts().find((l) => l.id === id); }

  // ---------- daily settlement (called by Finance via costs()) ----------

  /** Today's lift upkeep (scaled for closed time) and energy; resets the day's counters. */
  settleDay(): { upkeep: number; energy: number } {
    let upkeep = 0, energy = 0;
    for (const l of this.d.lifts()) {
      const o = this.ops(l);
      upkeep += upkeepPerDay(l) * (LIFT_OPS.closedUpkeepShare + (1 - LIFT_OPS.closedUpkeepShare) * Math.min(1, o.runHoursToday / LIFT_OPS.nominalHours));
      energy += o.energyToday;
      o.energyToday = 0; o.runHoursToday = 0;
    }
    return { upkeep, energy };
  }

  // ---------- tick ----------

  private holdFor(l: LiftData, o: LiftOpsData, hr: number, profile: SeasonProfile): LiftHold | null {
    if (o.fault) return o.fault.kind === 'inspection' ? 'inspection' : o.fault.kind === 'service' ? 'service' : 'fault';
    if (o.mode === 'closed') return 'manual';
    const def = LIFTS[normalizeLiftKind(l.kind)], w = this.d.weather();
    if (w.kind === 'storm' && 0.55 + 0.45 * Math.min(1, w.intensity) > def.windTolerance) return 'wind';
    if (o.mode === 'open') return null;
    if (!o.seasons[profile]) return 'season';
    if (!inHours(hr, o.from, o.to)) return 'hours';
    return null;
  }

  private applyHold(l: LiftData, hr: number, profile: SeasonProfile): void {
    const hold = this.holdFor(l, this.ops(l), hr, profile);
    if (hold) {
      if (l.open) l.open = false;
      l.opsClosed = true; l.opsReason = hold;
    } else if (l.opsClosed) {
      l.opsClosed = false; l.opsReason = null;
      if (l.condOpen !== false) l.open = true;
    }
  }

  update(state: GameState, tick: number): void {
    this.tick = tick;
    const hr = hourOfDay(state.date);
    this.hourNow = hr;
    const abs = state.date.year * DAYS_PER_YEAR + state.date.day;
    const profile = profileOfSeason(seasonOf(state.date));
    const lifts = [...this.d.lifts()].sort((a, b) => a.id - b.id);
    if (abs !== this.absDay) this.newDay(abs, profile, lifts);
    this.dayNow = state.date.day;
    for (const l of lifts) {
      const o = this.ops(l);
      if (o.daylight) this.syncDaylight(o, state.date.day);
      if (!o.maint) o.maint = { last: abs, count: 0 };
      if (o.fault) this.stepFault(l, o);
      // planned annual service: Auto policy, inside the window, never with riders or a queue (starts at night / off-season / whenever the lift is empty)
      if (!o.fault && this.policy === 'auto' && this.inWindow(l, o, abs) && this.d.queues.ridersOn(l.id) === 0 && this.d.queues.queueLength(l.id) === 0) this.startService(l, o);
      // periodic inspection: start while the lift is not running (night / off-season), or when badly overdue
      if (!o.fault && o.inspection !== 'none') {
        const I = LIFT_OPS.inspection[o.inspection];
        if (o.lastInspection < 0) o.lastInspection = abs;
        const due = abs - o.lastInspection;
        if (due >= I.everyDays && (!l.open || due >= I.everyDays + 5)) this.inspectNow(l.id, o.inspection);
      }
      this.applyHold(l, hr, profile);
      l.ecoActive = o.eco && l.open && !o.fault && this.d.queues.queueLength(l.id) === 0;
      if (l.open && !o.fault) {
        o.runHoursToday += HPT;
        const idle = this.d.queues.ridersOn(l.id) === 0 && this.d.queues.queueLength(l.id) === 0;
        o.energyToday += this.energyPerHour(l, !!l.ecoActive) * HPT * (idle ? LIFT_OPS.idleEnergyShare : 1);
        const wk = this.weatherKey(l), def = LIFTS[normalizeLiftKind(l.kind)];
        const load = Math.min(1.5, (l.riders?.perHour ?? 0) / Math.max(1, this.info(l).thr));
        o.condition = Math.max(0, o.condition - LIFT_OPS.wearPerHour * HPT * def.wearRate * (wk ? LIFT_OPS.wearWeather[wk] : 1) * (0.7 + 0.6 * load));
        const p = 1 - Math.pow(1 - Math.min(0.5, this.breakdownPerHour(l)), HPT);
        if (this.rng.next() < p) this.breakDown(l, o);
      }
    }
    // orphaned strand incidents (lift demolished)
    this.cache.forEach((_v, id) => { if (!lifts.some((l) => l.id === id)) this.cache.delete(id); });
  }

  private inWindow(l: LiftData, o: LiftOpsData, abs: number): boolean {
    const c = this.windowStart(abs, this.windowMonth(l));
    return abs >= c && abs < c + DAYS_PER_MONTH && abs - (o.maint?.last ?? abs) >= this.minGap(o);
  }

  private newDay(abs: number, profile: SeasonProfile, lifts: LiftData[]): void {
    const first = this.absDay < 0;
    this.absDay = abs;
    for (const l of lifts) {
      const o = this.ops(l);
      o.ageDays++;
      if (o.condition < 100) { // routine maintenance
        const r = Math.min(100 - o.condition, this.d.hasWorkshop() ? LIFT_OPS.routineRestore.workshop : LIFT_OPS.routineRestore.none);
        o.condition += r;
        this.d.spend?.(r * LIFT_OPS.routineCostPerPoint * (this.d.hasWorkshop() ? 1 : 1.5));
      }
    }
    // planned service: announce the day before a window opens; escalate overdue lifts
    if (!first) {
      let soon = 0, days = 0, month = -1;
      for (const l of lifts) {
        const o = this.ops(l), m = o.maint;
        if (!m) continue;
        if (this.policy === 'auto' && !o.fault && this.inWindow(l, o, abs + 1) && !this.inWindow(l, o, abs)) { soon++; days = Math.max(days, this.servicePlan(l).days); month = realMonthOfDay(abs + 1); }
        const st = this.stateOf(abs - m.last), lvl = st === 'critical' ? 2 : st === 'overdue' ? 1 : 0;
        if (lvl > (m.notified ?? 0)) { m.notified = lvl; this.d.bus?.emit('lift:serviceOverdue', { id: l.id, level: lvl === 2 ? 'critical' : 'overdue', days: Math.max(0, abs - m.last - LIFT_SERVICE.intervalDays) }); }
      }
      if (soon > 0) this.d.bus?.emit('ops:serviceSoon', { count: soon, month, days });
    }
    if (this.profile !== profile) {
      const prev = this.profile; this.profile = profile;
      if (!first && prev !== null) this.announce(profile);
    }
  }

  private announce(profile: SeasonProfile): void {
    const lifts = this.d.lifts();
    if (!lifts.length) return;
    const operating = lifts.filter((l) => { const o = this.ops(l); return o.mode !== 'closed' && o.seasons[profile]; }).length;
    this.d.bus?.emit('ops:schedule', { profile, operating, total: lifts.length });
  }

  private midpoint(l: LiftData): { x: number; y: number } {
    const p = samplePath(liftPath(l), liftPath(l).length / 2);
    return { x: p.x, y: p.z };
  }

  /** Debug/tests: break a lift down right now (as if the dice rolled). */
  forceBreakdown(id: number): boolean { const l = this.find(id); if (!l || this.ops(l).fault) return false; this.breakDown(l, this.ops(l)); return true; }

  private breakDown(l: LiftData, o: LiftOpsData): void {
    const riders = this.d.queues.ridersOn(l.id);
    const plan = this.repairPlan(o, false);
    this.d.spend?.(plan.cost);
    o.breakdowns++;
    const fault: LiftFault = { kind: 'breakdown', startTick: this.tick, endTick: this.tick + Math.max(1, Math.ceil(plan.hours / HPT)), stranded: riders, incidentId: 0 };
    o.fault = fault;
    l.open = false; l.opsClosed = true; l.opsReason = 'fault'; l.ecoActive = false; l.evac = false;
    this.d.bus?.emit('lift:broken', { id: l.id, kind: l.kind, stranded: riders });
    if (riders > 0) {
      const mid = this.midpoint(l);
      const def = LIFTS[normalizeLiftKind(l.kind)];
      const inc = this.d.incidents?.report('stranded', mid.x, mid.y, def.reversible ? Sev.Major : Sev.Minor, 0) ?? null;
      fault.incidentId = inc?.id ?? 0;
      this.d.bus?.emit('incident:stranded', { liftId: l.id, guests: riders, x: mid.x, y: mid.y });
    }
  }

  private stepFault(l: LiftData, o: LiftOpsData): void {
    const f = o.fault!;
    const inc = f.incidentId ? this.d.incidents?.byId(f.incidentId) : undefined;
    if (f.kind === 'breakdown' && f.stranded > 0 && !l.evac) {
      const age = this.tick - f.startTick, S = LIFT_OPS.stranded;
      if (f.incidentId && !inc) l.evac = true; // a responder resolved it: riders are brought down
      else if (age >= (this.d.hasWorkshop() ? S.selfEvacTicks : S.selfEvacTicksNoWorkshop)) {
        // nobody came in time: the lift crew rope-rescues everyone; in extreme neglect (cold, very long) the evacuation counts as a severe case (rating hit)
        const severe = age >= S.severeAfterTicks && this.d.temperature(l) < S.severeTemp && this.rng.chance(S.severeChance);
        if (inc) this.d.incidents?.resolve(inc, 'evacuated', 'none', severe);
        l.evac = true;
      }
    }
    if (this.tick >= f.endTick) {
      const hours = (this.tick - f.startTick) * HPT;
      if (inc) this.d.incidents?.resolve(inc, 'left', 'none'); // repaired before anyone came: the ride resumes
      if (f.kind === 'service') {
        const lv = f.level === 'thorough' ? 'thorough' : 'basic', B = LIFT_SERVICE[lv], m = this.maintOf(l);
        o.condition = Math.max(o.condition, B.condition); o.ageDays = Math.round(o.ageDays * B.ageKept); o.lastInspection = this.absDay;
        m.last = this.absDay; m.count++; m.level = lv; m.notified = 0;
        this.d.bus?.emit('lift:serviced', { id: l.id, days: Math.max(1, Math.round(hours / 24)), condition: o.condition });
      }
      else if (f.kind === 'overhaul') o.condition = 100;
      else if (f.kind === 'inspection') { o.condition = Math.min(100, o.condition + (f.level && f.level !== 'none' ? LIFT_OPS.inspection[f.level].boost : 0)); o.lastInspection = this.absDay; }
      else o.condition = Math.max(o.condition, 80);
      o.fault = null; l.evac = false;
      if (f.kind === 'breakdown') this.d.bus?.emit('lift:repaired', { id: l.id, hours: Math.round(hours * 10) / 10 });
    }
  }

  serialize(): unknown { return { rng: this.rng.getState(), absDay: this.absDay, profile: this.profile, ...(this.policy === 'manual' ? { policy: 'manual' } : {}) }; }
  load(data: unknown): void {
    const s = data as { rng: number; absDay: number; profile: SeasonProfile | null; policy?: MaintPolicy } | undefined;
    this.policy = s?.policy === 'manual' ? 'manual' : 'auto';
    if (!s) return;
    this.rng.setState(s.rng); this.absDay = s.absDay; this.profile = s.profile;
  }
}
