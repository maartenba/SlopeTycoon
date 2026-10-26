import { BUILDINGS } from '../../config/buildings';
import type { Coverage } from '../Coverage';
import { INCIDENT, Sev, type Incident, type Incidents, type Responder } from './Incidents';

/** Ski patrol (Task 26): sleds from Patrol Hubs (staff count adjustable) and first-aid-hut walkers (minor incidents, on site only).
 * Travel is straight-line at a fixed speed (piste 1x, off-piste 0.55x); this is deliberate (cheap, deterministic) rather than NavGraph routing. */
export const PATROL = {
  sledSpeed: 5, walkerSpeed: 1.25, offPisteFactor: 0.55, missionCost: 60, maxStaff: 6,
} as const;

export type AgentState = 'idle' | 'out' | 'treat' | 'carry' | 'back';
export interface PatrolAgent {
  id: number; kind: 'sled' | 'hut'; homeId: number; hx: number; hy: number;
  x: number; y: number; state: AgentState; incidentId: number; t: number; dx: number; dy: number;
}

export interface PatrolDeps {
  coverage: Coverage;
  incidents: Incidents;
  isPiste?: (x: number, y: number) => boolean;
  spend?: (category: 'rescue', amount: number) => void;
}

export class Patrol implements Responder {
  agents: PatrolAgent[] = [];
  private staff = new Map<number, number>();
  private nextId = 1;
  /** Staff pool fill x patrol training (Task 19 / 20); 1 = untouched. */
  speedFactor: () => number = () => 1;

  constructor(private d: PatrolDeps) {}

  /** Save/load (Task 33): agents (positions + assignments), per-hub staff counts. */
  serialize(): unknown { return { agents: this.agents.map((a) => ({ ...a })), staff: [...this.staff], nextId: this.nextId }; }
  load(d: unknown): void {
    const s = d as { agents: PatrolAgent[]; staff: Array<[number, number]>; nextId: number } | undefined;
    if (!s) return;
    this.agents = s.agents.map((a) => ({ ...a })); this.staff = new Map(s.staff); this.nextId = s.nextId;
  }

  staffOf(hubId: number): number { return this.staff.get(hubId) ?? BUILDINGS.patrolHub?.staff ?? 2; }
  setStaff(hubId: number, n: number): void { this.staff.set(hubId, Math.max(0, Math.min(PATROL.maxStaff, Math.round(n)))); }
  /** Auto headcount for the staff pool: configured sleds of every active hub. */
  staffNeed(): number { let n = 0; for (const h of this.d.coverage.sources('patrol')) n += this.staffOf(h.id); return n; }
  sledsOf(hubId: number): number { return this.agents.filter((a) => a.kind === 'sled' && a.homeId === hubId).length; }

  /** Reconcile agents with the active patrol hubs / first-aid huts (call when coverage changes or periodically). */
  sync(): void {
    const cov = this.d.coverage;
    const hubs = cov.sources('patrol'), huts = cov.sources('firstAid');
    const alive = new Set<number>([...hubs.map((h) => h.id), ...huts.map((h) => h.id)]);
    for (const a of [...this.agents]) {
      if (alive.has(a.homeId)) continue;
      const inc = this.d.incidents.byId(a.incidentId);
      if (inc) this.d.incidents.reopen(inc);
      this.agents.splice(this.agents.indexOf(a), 1);
    }
    for (const h of hubs) {
      const have = this.agents.filter((a) => a.kind === 'sled' && a.homeId === h.id);
      const want = this.staffOf(h.id);
      for (const a of have) { a.hx = h.cx; a.hy = h.cy; }
      for (let k = have.length; k < want; k++) this.agents.push({ id: this.nextId++, kind: 'sled', homeId: h.id, hx: h.cx, hy: h.cy, x: h.cx, y: h.cy, state: 'idle', incidentId: 0, t: 0, dx: 0, dy: 0 });
      // drop surplus idle sleds first
      for (let k = have.length; k > want; k--) {
        const idle = [...this.agents].reverse().find((a) => a.kind === 'sled' && a.homeId === h.id && a.state === 'idle');
        if (!idle) break;
        this.agents.splice(this.agents.indexOf(idle), 1);
      }
    }
    for (const h of huts) {
      const a = this.agents.find((q) => q.kind === 'hut' && q.homeId === h.id);
      if (a) { a.hx = h.cx; a.hy = h.cy; } else this.agents.push({ id: this.nextId++, kind: 'hut', homeId: h.id, hx: h.cx, hy: h.cy, x: h.cx, y: h.cy, state: 'idle', incidentId: 0, t: 0, dx: 0, dy: 0 });
    }
  }

  private speed(a: PatrolAgent, x: number, y: number): number {
    const base = a.kind === 'sled' ? PATROL.sledSpeed : PATROL.walkerSpeed;
    return base * (this.d.isPiste?.(x, y) === false ? PATROL.offPisteFactor : 1) * this.speedFactor();
  }

  private radius(a: PatrolAgent): number {
    return a.kind === 'sled' ? (BUILDINGS.patrolHub?.serviceRadius ?? 30) : (BUILDINGS.firstAid?.serviceRadius ?? 18);
  }

  private best(inc: Incident): { a: PatrolAgent; eta: number } | null {
    let best: { a: PatrolAgent; eta: number; d: number } | null = null;
    for (const a of this.agents) {
      if (a.state !== 'idle') continue;
      if (a.kind === 'hut' && inc.severity !== Sev.Minor) continue; // huts treat minors on site only
      const dist = Math.hypot(a.x - inc.x, a.y - inc.y);
      if (dist > this.radius(a)) continue;
      const eta = Math.ceil(dist / this.speed(a, inc.x, inc.y));
      if (!best || eta < best.eta || (eta === best.eta && a.id < best.a.id)) best = { a, eta, d: dist };
    }
    return best ? { a: best.a, eta: best.eta } : null;
  }

  quote(inc: Incident): number | null { return this.best(inc)?.eta ?? null; }

  assign(inc: Incident, tick: number): boolean {
    const b = this.best(inc);
    if (!b) return false;
    b.a.state = 'out'; b.a.incidentId = inc.id; b.a.dx = inc.x; b.a.dy = inc.y;
    inc.state = 'responding'; inc.responder = b.a.kind === 'sled' ? 'patrol' : 'firstAid'; inc.responderId = b.a.id; inc.eta = tick + b.eta;
    this.d.spend?.('rescue', PATROL.missionCost);
    return true;
  }

  cancel(inc: Incident): void {
    for (const a of this.agents) if (a.incidentId === inc.id && (inc.responder === 'patrol' || inc.responder === 'firstAid' || inc.responder === 'none')) { a.incidentId = 0; a.state = 'back'; a.dx = a.hx; a.dy = a.hy; }
  }

  private step(a: PatrolAgent): boolean {
    const dx = a.dx - a.x, dy = a.dy - a.y, d = Math.hypot(dx, dy), sp = this.speed(a, a.dx, a.dy);
    if (d <= sp) { a.x = a.dx; a.y = a.dy; return true; }
    a.x += (dx / d) * sp; a.y += (dy / d) * sp;
    return false;
  }

  /** Nearest first-aid hut or hub from a point (transport destination). */
  private dropOff(x: number, y: number): { x: number; y: number } {
    let b = { x: 0, y: 0 }, bd = Infinity;
    for (const s of [...this.d.coverage.sources('firstAid'), ...this.d.coverage.sources('patrol')]) {
      const dd = Math.hypot(s.cx - x, s.cy - y);
      if (dd < bd) { bd = dd; b = { x: s.cx, y: s.cy }; }
    }
    return b;
  }

  update(tick: number): void {
    const inc = this.d.incidents;
    for (const a of this.agents) {
      if (a.state === 'idle') continue;
      const it = a.incidentId ? inc.byId(a.incidentId) : undefined;
      if (a.state !== 'back' && !it) { a.state = 'back'; a.incidentId = 0; a.dx = a.hx; a.dy = a.hy; }
      switch (a.state) {
        case 'out':
          if (this.step(a)) { inc.arrived(it!, a.kind === 'sled' ? 'patrol' : 'firstAid', tick); a.state = 'treat'; a.t = INCIDENT.treat[it!.severity] ?? 2; }
          break;
        case 'treat':
          if (--a.t > 0) break;
          if (a.kind === 'hut' || it!.severity === Sev.Minor || it!.kind === 'stranded') { inc.resolve(it!, 'recovered', a.kind === 'sled' ? 'patrol' : 'firstAid'); break; }
          { const dp = this.dropOff(a.x, a.y); a.dx = dp.x; a.dy = dp.y; a.state = 'carry'; inc.transporting(it!); }
          break;
        case 'carry':
          it!.x = a.x; it!.y = a.y;
          if (this.step(a)) inc.resolve(it!, inc.roll(it!, 'sled'), 'patrol');
          break;
        case 'back':
          if (this.step(a) || (a.x === a.hx && a.y === a.hy)) { a.state = 'idle'; a.incidentId = 0; }
          break;
      }
    }
    // an incident left 'responding' with no sled (cancelled/removed) falls back to the queue
    for (const it of inc.open) if (it.state === 'responding' && it.responder !== 'heli' && !this.agents.some((a) => a.incidentId === it.id)) inc.reopen(it);
  }
}
