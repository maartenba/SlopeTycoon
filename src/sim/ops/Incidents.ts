import type { GameBus } from '../../core/events';
import { Rng } from '../../core/Rng';
import type { Coverage, CoverageBuilding } from '../Coverage';

/** Incident queue + dispatcher (Task 26). Pure sim: no three/DOM. 1 tick = 6 game minutes (10 ticks = 1 hour). */

export const Sev = { Minor: 0, Major: 1, Critical: 2 } as const;
export const SEV_NAMES = ['minor', 'major', 'critical'] as const;
export type IncidentKind = 'injury' | 'buried' | 'attack' | 'stranded';
export type IncidentState = 'open' | 'responding' | 'treating' | 'transport' | 'resolved';
export type Outcome = 'recovered' | 'hospitalised' | 'evacuated' | 'left';
export type ResponderKind = 'none' | 'patrol' | 'firstAid' | 'heli';

export const INCIDENT = {
  /** Unresolved ticks before minor -> major, and major -> critical. */
  worsenMinor: 60, worsenMajor: 90,
  /** Unresolved critical (non-trapped) incidents end in hospitalisation (severe case) after this many ticks. */
  criticalNeglect: 80,
  /** Guests trapped in the snow can wait this many ticks for a dig-out before the hospital transfer is forced. */
  buriedSurvival: 15,
  /** Safety net: nothing stays open longer than this. */
  timeout: 600,
  /** Patrol ETA (ticks) above which a major incident escalates to the helicopter. */
  escalateEta: 18,
  /** Treatment ticks on site per severity. */
  treat: [2, 5, 8] as readonly number[],
  /** Chance a major patient recovers and returns to the slopes (else hospitalised). */
  majorRecovers: 0.5,
  /** Guests within this radius lose happiness while an incident stays open. */
  moraleRadius: 8,
  /** Stranded-on-a-lift incidents: ticks until minor -> major -> critical. */
  stranded: { worsenMajor: 6, worsenCritical: 14 },
} as const;

export interface Incident {
  id: number;
  kind: IncidentKind;
  x: number; y: number;
  severity: number;
  guestId: number;
  createdTick: number;
  state: IncidentState;
  responder: ResponderKind;
  /** Tick the responder is expected on scene (0 = none). */
  eta: number;
  /** Responder agent id (sled / hut / helicopter). */
  responderId: number;
  /** Tick the urgent-rescue window ends, forcing a severe hospital case (trapped in the snow only; 0 = n/a). */
  deadline: number;
  responseTicks: number;
  escalated: boolean;
  outcome?: Outcome;
  /** Resolved late/neglected: counts as a severe case for the safety rating. */
  severe?: boolean;
  resolvedTick?: number;
}

export interface SafetyGuestPort {
  position(id: number): { x: number; y: number } | null;
  /** Guest ids within r tiles: all (not riding/queueing) or only 'prey' (off-piste skiers / remote hikers). */
  near(x: number, y: number, r: number, mode: 'any' | 'prey'): number[];
  /** Freezes the guest where they are (state Injured). False when the guest is gone/unfreezable. */
  freeze(id: number): boolean;
  release(id: number, how: 'return' | 'leave' | 'hospital', severe?: boolean): void;
  hurtNear(x: number, y: number, r: number, amount: number): void;
  /** A bear scares the guest at (fromX, fromY): happiness drop, activity aborted, optionally leaves. False when unaffected (inside a building, riding...). */
  scare?(id: number, fromX: number, fromY: number, leave: boolean): boolean;
}

export interface IncidentDeps {
  guests: SafetyGuestPort;
  coverage: Coverage;
  buildings: () => Iterable<CoverageBuilding>;
  bus?: Pick<GameBus, 'emit'>;
  /** Economy.spend('rescue', n) sink. */
  spend?: (category: 'rescue', amount: number) => void;
  /** News toast sink. */
  news?: (msg: string) => void;
  /** Human place name for a tile ('Blue run 3'); fallback is coordinates. */
  where?: (x: number, y: number) => string;
  seed?: number;
}

/** Responders implement this; Incidents owns the lifecycle. */
export interface Responder {
  /** Try to take the incident; returns ETA in ticks (from now) or null when impossible. `commit` false = only quote. */
  quote(inc: Incident): number | null;
  assign(inc: Incident, tick: number): boolean;
  /** Drop the incident (hub removed etc.). */
  cancel(inc: Incident): void;
}

export interface IncidentStats {
  open: number;
  /** Open for longer than 30 ticks (rating input). */
  unresolved: number;
  resolved: number;
  meanResponseTicks: number;
  recovered: number; hospitalised: number; evacuated: number; left: number;
  /** Cases resolved late (neglected criticals, trapped past the window, extreme strands): the heavy rating penalty. */
  severe: number;
  /** Critical/trapped patients reached in time (not severe). */
  severeAvoided: number;
  escalations: number;
  created: number;
  /** 0..1 suggested rating penalty from open + recent severe incidents (Task 27 may use or ignore). */
  penalty: number;
}

export class Incidents {
  readonly open: Incident[] = [];
  private nextId = 1;
  private rng: Rng;
  private tick = 0;
  patrol: Responder | null = null;
  heli: Responder | null = null;
  private recentSevere: number[] = [];
  private recentStrand: number[] = [];
  private lastHelpNews = -999;
  private st = { resolved: 0, respSum: 0, recovered: 0, hospitalised: 0, evacuated: 0, severe: 0, left: 0, avoided: 0, esc: 0, created: 0 };

  constructor(private d: IncidentDeps) { this.rng = new Rng((d.seed ?? 1) ^ 0x1c1d); }

  get nowTick(): number { return this.tick; }
  byId(id: number): Incident | undefined { return this.open.find((i) => i.id === id); }

  private hasInfra(): boolean {
    for (const b of this.d.buildings()) if (b.active && (b.type === 'patrolHub' || b.type === 'firstAid' || b.type === 'helipad')) return true;
    return false;
  }

  /** A guest finished a run injured: roll severity from skill-vs-difficulty (`over`), surface (`quality`, 1 neutral, >1 worse) and off-piste. */
  onGuestInjured(guestId: number, x: number, y: number, f: { over: number; offPiste: boolean; quality: number; critical?: boolean }): Incident | null {
    const over = Math.max(0, f.over), r = this.rng.next();
    const pc = 0.02 + 0.035 * over + (f.offPiste ? 0.05 : 0) + 0.02 * Math.max(0, f.quality - 1);
    const pm = 0.22 + 0.1 * over + (f.offPiste ? 0.1 : 0) + 0.12 * Math.max(0, f.quality - 1);
    const sev = r < pc ? Sev.Critical : r < pc + pm ? Sev.Major : Sev.Minor;
    return this.report('injury', x, y, sev, guestId);
  }

  report(kind: IncidentKind, x: number, y: number, severity: number, guestId = 0, opts: { survival?: number } = {}): Incident | null {
    if (guestId && this.open.some((i) => i.guestId === guestId)) return null;
    if (guestId && !this.d.guests.freeze(guestId)) return null;
    const inc: Incident = {
      id: this.nextId++, kind, x, y, severity, guestId, createdTick: this.tick, state: 'open', responder: 'none', eta: 0, responderId: 0,
      deadline: kind === 'buried' ? this.tick + (opts.survival ?? INCIDENT.buriedSurvival) : 0, responseTicks: 0, escalated: false,
    };
    this.open.push(inc);
    this.st.created++;
    this.d.bus?.emit('incident:created', { id: inc.id, kind, severity, x, y, guestId });
    if (kind === 'stranded') this.recentStrand.push(this.tick);
    if (kind !== 'buried' && kind !== 'stranded' && !this.hasInfra() && this.tick - this.lastHelpNews > 40) {
      this.lastHelpNews = this.tick;
      this.d.news?.(`Injured ${kind === 'attack' ? 'hiker' : 'skier'} on ${this.where(x, y)} needs help – build a Ski Patrol Hub`);
    }
    this.dispatch(inc);
    return inc;
  }

  where(x: number, y: number): string { return this.d.where?.(x, y) ?? `(${Math.floor(x)}, ${Math.floor(y)})`; }

  /** Pick patrol / helicopter / both quotes. Critical & slow-patrol incidents go to the helicopter. */
  dispatch(inc: Incident): void {
    if (inc.state !== 'open') return;
    const pq = this.patrol?.quote(inc) ?? null;
    const hq = (inc.severity >= Sev.Major) ? (this.heli?.quote(inc) ?? null) : null;
    const wantHeli = hq !== null && (
      inc.kind === 'buried' ? pq === null || hq < pq
        : inc.severity === Sev.Critical || pq === null || pq > INCIDENT.escalateEta);
    if (wantHeli && this.heli?.assign(inc, this.tick)) {
      inc.escalated = pq !== null || inc.severity === Sev.Critical;
      if (inc.escalated) { this.st.esc++; this.d.bus?.emit('incident:escalated', { id: inc.id, to: 'heli' }); }
      return;
    }
    if (pq !== null) this.patrol?.assign(inc, this.tick);
  }

  /** Responder reached the patient. */
  arrived(inc: Incident, who: ResponderKind, tick: number): void {
    inc.state = 'treating'; inc.responder = who; inc.responseTicks = Math.max(1, tick - inc.createdTick);
  }
  /** Responder is taking the patient away. */
  transporting(inc: Incident): void { inc.state = 'transport'; }

  /** Release a responder's claim (its home vanished): back to the open queue. */
  reopen(inc: Incident): void { inc.state = 'open'; inc.responder = 'none'; inc.eta = 0; inc.responderId = 0; }

  resolve(inc: Incident, outcome: Outcome, who: ResponderKind, severe = false): void {
    if (inc.state === 'resolved') return;
    inc.state = 'resolved'; inc.outcome = outcome; inc.resolvedTick = this.tick;
    if (inc.responseTicks === 0 && who !== 'none') inc.responseTicks = this.tick - inc.createdTick;
    if (who !== 'none') inc.responder = who;
    const i = this.open.indexOf(inc);
    if (i >= 0) this.open.splice(i, 1);
    this.st.resolved++; this.st.respSum += who === 'none' ? this.tick - inc.createdTick : inc.responseTicks;
    this.st[outcome]++;
    if (severe) { inc.severe = true; this.st.severe++; this.recentSevere.push(this.tick); }
    else if (inc.severity === Sev.Critical && who !== 'none') this.st.avoided++;
    this.patrol?.cancel(inc); this.heli?.cancel(inc);
    if (inc.guestId) this.d.guests.release(inc.guestId, outcome === 'recovered' ? 'return' : outcome === 'hospitalised' ? 'hospital' : 'leave', severe);
    this.d.bus?.emit('incident:resolved', { id: inc.id, responder: inc.responder, responseTicks: inc.responseTicks, outcome, kind: inc.kind, ...(severe ? { severe: true } : {}) });
  }

  /** Rolls the final outcome for a treated patient (used by sled/hut; the helicopter always flies the patient to hospital). */
  roll(inc: Incident, via: 'sled' | 'hut' | 'heli'): Outcome {
    if (via === 'heli') return 'hospitalised';
    if (inc.severity === Sev.Minor) return 'recovered';
    if (inc.severity === Sev.Major) return this.rng.chance(INCIDENT.majorRecovers) ? 'recovered' : 'hospitalised';
    return 'hospitalised';
  }

  update(tick: number): void {
    this.tick = tick;
    for (let k = this.open.length - 1; k >= 0; k--) {
      const inc = this.open[k]!;
      if (!inc) continue;
      const age = tick - inc.createdTick;
      if (inc.state === 'open' || inc.state === 'responding') {
        // unattended patients get worse
        if (inc.kind === 'stranded') {
          // cold + waiting: severity climbs on its own schedule; never escalates beyond severity here (the lift crew's rope rescue resolves it, see LiftOps)
          if (inc.severity === Sev.Minor && age > INCIDENT.stranded.worsenMajor) inc.severity = Sev.Major;
          else if (inc.severity === Sev.Major && age > INCIDENT.stranded.worsenCritical) inc.severity = Sev.Critical;
        } else if (inc.kind !== 'buried') {
          if (inc.severity === Sev.Minor && age > INCIDENT.worsenMinor) inc.severity = Sev.Major;
          else if (inc.severity === Sev.Major && age > INCIDENT.worsenMinor + INCIDENT.worsenMajor) inc.severity = Sev.Critical;
          else if (inc.severity === Sev.Critical && age > INCIDENT.criticalNeglect && inc.state === 'open') { this.resolve(inc, 'hospitalised', 'none', true); continue; }
        } else if (inc.deadline && tick >= inc.deadline && inc.state === 'open') { this.resolve(inc, 'hospitalised', 'none', true); continue; }
        else if (inc.deadline && tick >= inc.deadline && inc.state === 'responding' && inc.eta > tick + 2) { this.resolve(inc, 'hospitalised', 'none', true); continue; }
        if (inc.state === 'open' && (age % (inc.kind === 'stranded' ? 2 : 5) === 0)) this.dispatch(inc);
      }
      if (age > INCIDENT.timeout) { if (inc.severity === Sev.Critical) this.resolve(inc, 'hospitalised', 'none', true); else this.resolve(inc, 'left', 'none'); continue; }
      if (inc.state !== 'transport' && age % 10 === 5 && age > 10 && inc.guestId) {
        this.d.guests.hurtNear(inc.x, inc.y, INCIDENT.moraleRadius, 0.012 * (1 + inc.severity));
      }
    }
    if (this.recentSevere.length && tick - this.recentSevere[0]! > 480) this.recentSevere.shift();
    if (this.recentStrand.length && tick - this.recentStrand[0]! > 480) this.recentStrand.shift();
  }

  stats(): IncidentStats {
    let unresolved = 0;
    for (const i of this.open) if (this.tick - i.createdTick > 30) unresolved++;
    const st = this.st;
    const penalty = Math.min(1, 0.06 * unresolved + 0.03 * this.open.length + 0.12 * this.recentSevere.length + 0.04 * this.recentStrand.length);
    return {
      open: this.open.length, unresolved, resolved: st.resolved, meanResponseTicks: st.resolved ? st.respSum / st.resolved : 0,
      recovered: st.recovered, hospitalised: st.hospitalised, evacuated: st.evacuated, severe: st.severe, left: st.left, severeAvoided: st.avoided,
      escalations: st.esc, created: st.created, penalty,
    };
  }

  /** FNV-1a over incident state + counters (determinism tests). */
  hash(): string {
    let h = 0x811c9dc5;
    const mix = (v: number): void => { h ^= v | 0; h = Math.imul(h, 0x01000193) >>> 0; };
    for (const i of this.open) { mix(i.id); mix(i.severity); mix(Math.round(i.x * 10)); mix(Math.round(i.y * 10)); mix(i.createdTick); mix(i.state.length); }
    const s = this.st; for (const v of [s.resolved, s.recovered, s.hospitalised, s.evacuated, s.severe, s.left, s.avoided, s.esc, s.created]) mix(v);
    mix(this.rng.getState());
    return h.toString(16).padStart(8, '0');
  }

  serialize(): unknown { return { open: this.open.map((i) => ({ ...i })), nextId: this.nextId, rng: this.rng.getState(), st: { ...this.st } }; }
  load(data: unknown): void {
    const s = data as { open: Incident[]; nextId: number; rng: number; st: Incidents['st'] } | undefined;
    if (!s) return;
    this.open.length = 0;
    // responders are rebuilt from scratch on load: assigned incidents go back to the queue
    for (const i of s.open) this.open.push({ ...i, state: i.state === 'treating' || i.state === 'transport' || i.state === 'responding' ? 'open' : i.state, responder: 'none', eta: 0, responderId: 0 });
    this.nextId = s.nextId; this.rng.setState(s.rng);
    // old saves: the removed 'fatal' outcome/stat becomes a severe hospitalisation
    const old = s.st as Partial<Incidents['st']> & { fatal?: number };
    const fatal = old.fatal ?? 0;
    this.st = { resolved: 0, respSum: 0, recovered: 0, hospitalised: 0, evacuated: 0, severe: 0, left: 0, avoided: 0, esc: 0, created: 0, ...old };
    delete (this.st as { fatal?: number }).fatal;
    this.st.hospitalised += fatal; this.st.severe += fatal;
    for (const i of this.open) if ((i.outcome as string | undefined) === 'fatal') { i.outcome = 'hospitalised'; i.severe = true; }
  }
}
