import type { Coverage } from '../Coverage';
import { Sev, type Incident, type Incidents, type Responder } from './Incidents';

/** Rescue helicopter (Task 26): one per active Helipad, serves incidents within the pad's 'heli' coverage radius, flies the patient
 * to an off-map hospital (nearest map edge), is away for `hospitalTicks`, then returns. Mission cost via Economy.spend('rescue'). */
export const HELI = { speed: 9.4, spinUp: 1, load: 1, hospitalTicks: 4, missionCost: 900 } as const;

export type HeliState = 'idle' | 'out' | 'load' | 'toHospital' | 'away' | 'back';
export interface HeliAgent {
  id: number; padId: number; px: number; py: number; x: number; y: number; state: HeliState;
  incidentId: number; t: number; tx: number; ty: number; /** Rotor phase (render). */ missions: number;
}

export interface HeliDeps {
  coverage: Coverage;
  incidents: Incidents;
  mapSize: number;
  spend?: (category: 'rescue', amount: number) => void;
}

export class Heli implements Responder {
  helis: HeliAgent[] = [];
  private nextId = 1;
  missions = 0;

  constructor(private d: HeliDeps) {}

  /** Save/load (Task 33). */
  serialize(): unknown { return { helis: this.helis.map((h) => ({ ...h })), nextId: this.nextId, missions: this.missions }; }
  load(d: unknown): void {
    const s = d as { helis: HeliAgent[]; nextId: number; missions: number } | undefined;
    if (!s) return;
    this.helis = s.helis.map((h) => ({ ...h })); this.nextId = s.nextId; this.missions = s.missions;
  }

  sync(): void {
    const pads = this.d.coverage.sources('heli');
    const alive = new Set(pads.map((p) => p.id));
    for (const h of [...this.helis]) {
      if (alive.has(h.padId)) continue;
      const inc = this.d.incidents.byId(h.incidentId);
      if (inc) { if (inc.state === 'transport') this.d.incidents.resolve(inc, 'hospitalised', 'heli'); else this.d.incidents.reopen(inc); }
      this.helis.splice(this.helis.indexOf(h), 1);
    }
    for (const p of pads) {
      const h = this.helis.find((q) => q.padId === p.id);
      if (h) { h.px = p.cx; h.py = p.cy; } else this.helis.push({ id: this.nextId++, padId: p.id, px: p.cx, py: p.cy, x: p.cx, y: p.cy, state: 'idle', incidentId: 0, t: 0, tx: p.cx, ty: p.cy, missions: 0 });
    }
  }

  private radius(h: HeliAgent): number { return this.d.coverage.sources('heli').find((s) => s.id === h.padId)?.r ?? 64; }

  private best(inc: Incident): { h: HeliAgent; eta: number } | null {
    let best: { h: HeliAgent; eta: number } | null = null;
    for (const h of this.helis) {
      if (h.state !== 'idle') continue;
      const dist = Math.hypot(h.x - inc.x, h.y - inc.y);
      if (dist > this.radius(h)) continue;
      const eta = HELI.spinUp + Math.ceil(dist / HELI.speed);
      if (!best || eta < best.eta || (eta === best.eta && h.id < best.h.id)) best = { h, eta };
    }
    return best;
  }

  quote(inc: Incident): number | null { return this.best(inc)?.eta ?? null; }

  assign(inc: Incident, tick: number): boolean {
    const b = this.best(inc);
    if (!b) return false;
    b.h.state = 'out'; b.h.incidentId = inc.id; b.h.tx = inc.x; b.h.ty = inc.y; b.h.t = HELI.spinUp; b.h.missions++; this.missions++;
    inc.state = 'responding'; inc.responder = 'heli'; inc.responderId = b.h.id; inc.eta = tick + b.eta;
    this.d.spend?.('rescue', HELI.missionCost);
    return true;
  }

  cancel(inc: Incident): void {
    for (const h of this.helis) if (h.incidentId === inc.id && inc.responder !== 'patrol' && inc.responder !== 'firstAid') { h.incidentId = 0; if (h.state === 'out' || h.state === 'load') { h.state = 'back'; h.tx = h.px; h.ty = h.py; } }
  }

  hospital(h: HeliAgent): { x: number; y: number } {
    const N = this.d.mapSize, m = -12;
    const dl = h.x, dr = N - h.x, dt = h.y, db = N - h.y, mn = Math.min(dl, dr, dt, db);
    return mn === dl ? { x: m, y: h.y } : mn === dr ? { x: N - m, y: h.y } : mn === dt ? { x: h.x, y: m } : { x: h.x, y: N - m };
  }

  private fly(h: HeliAgent): boolean {
    const dx = h.tx - h.x, dy = h.ty - h.y, d = Math.hypot(dx, dy);
    if (d <= HELI.speed) { h.x = h.tx; h.y = h.ty; return true; }
    h.x += (dx / d) * HELI.speed; h.y += (dy / d) * HELI.speed;
    return false;
  }

  update(tick: number): void {
    const inc = this.d.incidents;
    for (const h of this.helis) {
      if (h.state === 'idle') continue;
      const it = h.incidentId ? inc.byId(h.incidentId) : undefined;
      if ((h.state === 'out' || h.state === 'load' || h.state === 'toHospital') && !it) { h.state = 'back'; h.incidentId = 0; h.tx = h.px; h.ty = h.py; }
      switch (h.state) {
        case 'out':
          if (h.t > 0) { h.t--; break; }
          if (this.fly(h)) { inc.arrived(it!, 'heli', tick); h.state = 'load'; h.t = HELI.load + (it!.severity === Sev.Critical ? 1 : 0); }
          break;
        case 'load':
          if (--h.t > 0) break;
          { const hp = this.hospital(h); h.tx = hp.x; h.ty = hp.y; h.state = 'toHospital'; inc.transporting(it!); }
          break;
        case 'toHospital':
          it!.x = h.x; it!.y = h.y;
          if (this.fly(h)) { inc.resolve(it!, inc.roll(it!, 'heli'), 'heli'); h.incidentId = 0; h.state = 'away'; h.t = HELI.hospitalTicks; }
          break;
        case 'away':
          if (--h.t <= 0) { h.state = 'back'; h.tx = h.px; h.ty = h.py; }
          break;
        case 'back':
          if (this.fly(h)) { h.state = 'idle'; h.incidentId = 0; }
          break;
      }
    }
  }
}
