import { LIFTS } from '../../config/lifts';
import { LIFT_OPS } from '../../config/liftOps';
import { LIFT_SECONDS_PER_TICK } from '../../config/balance';
import { liftStats, type LiftData, type LiftStats } from '../Lift';
import type { GuestStore } from './Guest';

export type RideKind = 'ski' | 'foot' | 'bike';
export type JoinResult = 'ok' | 'closed' | 'balk' | 'mode';
export type ReleaseReason = 'closed' | 'impatient';

export interface QueueCallbacks {
  /** Ride finished: guest emerges at the destination station. */
  done(slot: number, liftId: number, dir: 0 | 1): void;
  /** Guest leaves the queue without riding. */
  released(slot: number, liftId: number, reason: ReleaseReason): void;
  /** Position (queue spot / cable) changed. */
  moved(slot: number, x: number, y: number, z: number): void;
  /** A guest boarded (lift-pass revenue hook, Task 24). */
  boarded?(liftId: number, slot: number): void;
}

interface Ride { slot: number; start: number; dur: number }
interface Queue {
  liftId: number; dir: 0 | 1;
  waiting: number[];
  credit: number;
  riding: Ride[];
  boardedTotal: number;
}

const HOUR_TICKS = 10; // one game hour
const cap = (l: LiftData): number => LIFTS[l.kind].capacityPerCarrier;
/** A broken-down lift freezes its riders on the cable until repaired or evacuated. */
const frozen = (l: LiftData | undefined): boolean => !!l && l.ops?.fault?.kind === 'breakdown';

/** Whether a lift in its current operating mode carries this kind of rider in this direction. */
export function liftCarries(l: LiftData, kind: RideKind, dir: 0 | 1): boolean {
  if (!l.open) return false;
  const am = l.activeMode ?? (l.kind === 'tbar' ? 'ski' : 'mixed');
  if (!am) return false;
  const def = LIFTS[l.kind];
  if (kind === 'ski') return dir === 0 ? am === 'ski' || am === 'mixed' : (am === 'foot' || am === 'mixed') && l.kind !== 'tbar';
  if (l.kind === 'tbar') return false;
  if (am !== 'foot' && am !== 'mixed') return false;
  return kind === 'bike' ? def.carriesBikes : true;
}

/**
 * Per-lift FIFO queues at the station where guests board. Boarding cadence follows the lift's throughput (carriers/hour x capacity,
 * scaled by LIFT_SECONDS_PER_TICK): one carrier departs whenever enough capacity credit accrued and loads up to its capacity.
 * Ride time = rideTimeS / LIFT_SECONDS_PER_TICK ticks. Closed lifts release their queue; long expected waits make guests balk.
 */
export class LiftQueues {
  private queues = new Map<number, Queue>(); // key = liftId*2 + dir
  private slotQueue = new Map<number, number>(); // slot -> key (waiting or riding)
  private patience = new Map<number, number>();
  private statCache = new Map<number, { sig: string; s: LiftStats }>();
  private hourRing = new Map<number, number[]>(); // liftId -> boardings per tick (ring of HOUR_TICKS)

  constructor(private store: GuestStore, private lifts: () => readonly LiftData[]) {}

  private lift(id: number): LiftData | undefined { return this.lifts().find((l) => l.id === id); }

  private stats(l: LiftData): LiftStats {
    const sig = `${l.kind}:${l.speed}:${l.ecoActive ? 'e' : ''}:${l.nodes.length}:${l.nodes[0]?.x}:${l.nodes[l.nodes.length - 1]?.x}`;
    const c = this.statCache.get(l.id);
    if (c && c.sig === sig) return c.s;
    const s = liftStats(l);
    this.statCache.set(l.id, { sig, s });
    return s;
  }

  /** Riders that can board per tick. */
  /** Lift-operator pool fill (Task 19); 1 = untouched. */
  crewFactor: () => number = () => 1;
  ratePerTick(l: LiftData): number { return (this.stats(l).throughputPerHour / 3600) * LIFT_SECONDS_PER_TICK * this.crewFactor(); }
  rideTicks(l: LiftData): number { return Math.max(2, Math.ceil((this.stats(l).rideTimeS + LIFTS[l.kind].loadTimeS) / LIFT_SECONDS_PER_TICK)); }

  /** Guests currently on the cable of a lift (both directions). */
  ridersOn(liftId: number): number { return (this.queues.get(liftId * 2)?.riding.length ?? 0) + (this.queues.get(liftId * 2 + 1)?.riding.length ?? 0); }

  private q(liftId: number, dir: 0 | 1): Queue {
    const key = liftId * 2 + dir;
    let q = this.queues.get(key);
    if (!q) { q = { liftId, dir, waiting: [], credit: 0, riding: [], boardedTotal: 0 }; this.queues.set(key, q); }
    return q;
  }

  /** Guests waiting at the lift's station in this direction (inspector / overlay hook). */
  queueLength(liftId: number, dir: 0 | 1 = 0): number { return this.queues.get(liftId * 2 + dir)?.waiting.length ?? 0; }

  /** Expected wait in ticks for a guest joining now. */
  waitTicks(liftId: number, dir: 0 | 1 = 0): number {
    const q = this.queues.get(liftId * 2 + dir);
    if (!q || !q.waiting.length) return 0;
    const l = this.lift(liftId);
    if (!l) return 0;
    return (q.waiting.length + 1) / Math.max(0.01, this.ratePerTick(l));
  }

  /** Per-lift summary for UI. */
  summary(): Array<{ liftId: number; up: number; down: number; riding: number; waitTicks: number; ridersPerHour: number }> {
    const out = [];
    for (const l of [...this.lifts()].sort((a, b) => a.id - b.id)) {
      out.push({
        liftId: l.id, up: this.queueLength(l.id, 0), down: this.queueLength(l.id, 1),
        riding: (this.queues.get(l.id * 2)?.riding.length ?? 0) + (this.queues.get(l.id * 2 + 1)?.riding.length ?? 0),
        waitTicks: this.waitTicks(l.id, 0), ridersPerHour: l.riders?.perHour ?? 0,
      });
    }
    return out;
  }

  isQueued(slot: number): boolean { return this.slotQueue.has(slot); }

  /** Join the queue; positions the guest at the station. `patience` is in ticks. */
  join(liftId: number, dir: 0 | 1, slot: number, kind: RideKind, tick: number, patience: number): JoinResult {
    const l = this.lift(liftId);
    if (!l || !l.open) return 'closed';
    if (!liftCarries(l, kind, dir)) return 'mode';
    const q = this.q(liftId, dir);
    const expected = (q.waiting.length + 1) / Math.max(0.01, this.ratePerTick(l));
    if (expected > patience) return 'balk';
    q.waiting.push(slot);
    this.slotQueue.set(slot, liftId * 2 + dir);
    this.patience.set(slot, patience);
    this.store.actTick[slot] = tick;
    return 'ok';
  }

  /** Remove a guest (despawn / reset) from any queue or ride. */
  cancel(slot: number): void {
    const key = this.slotQueue.get(slot);
    if (key === undefined) return;
    const q = this.queues.get(key);
    if (q) {
      const i = q.waiting.indexOf(slot);
      if (i >= 0) q.waiting.splice(i, 1);
      else q.riding = q.riding.filter((r) => r.slot !== slot);
    }
    this.slotQueue.delete(slot); this.patience.delete(slot);
  }

  /** Drop everything (load/reset). */
  clear(): void { this.queues.clear(); this.slotQueue.clear(); this.patience.clear(); this.hourRing.clear(); }
  /** Save/load: the rolling boardings-per-hour windows (they feed lift wear); queues themselves are not saved. */
  serializeRings(): Array<[number, number[]]> { return [...this.hourRing.entries()].map(([id, r]) => [id, [...r]]); }
  loadRings(d: Array<[number, number[]]> | undefined): void { this.hourRing = new Map((d ?? []).map(([id, r]) => [id, [...r]])); }

  private spot(l: LiftData, dir: 0 | 1, n: number): [number, number] {
    const s = dir === 0 ? l.bottom : l.top;
    return [s.x + 0.15 + 0.7 * ((n * 0.37) % 1), s.y + 0.15 + 0.7 * ((n * 0.61) % 1)];
  }

  update(tick: number, cb: QueueCallbacks): void {
    const lifts = [...this.lifts()].sort((a, b) => a.id - b.id);
    const byId = new Map(lifts.map((l) => [l.id, l]));
    for (const dirKey of [...this.queues.keys()].sort((a, b) => a - b)) {
      const q = this.queues.get(dirKey)!;
      const l = byId.get(q.liftId);
      let boarded = 0;
      if (!l || !l.open || !(liftCarries(l, 'foot', q.dir) || liftCarries(l, 'ski', q.dir))) {
        // lift closed / removed: everyone waiting leaves; riders already on the cable arrive (or are dropped if the lift is gone)
        for (const s of q.waiting.splice(0)) { this.slotQueue.delete(s); this.patience.delete(s); cb.released(s, q.liftId, 'closed'); }
        q.credit = 0;
      } else {
        // impatience
        for (let i = 0; i < q.waiting.length;) {
          const s = q.waiting[i]!, pat = this.patience.get(s) ?? 60;
          if (tick - this.store.actTick[s]! > pat * 2) {
            q.waiting.splice(i, 1); this.slotQueue.delete(s); this.patience.delete(s); cb.released(s, q.liftId, 'impatient');
          } else {
            const [x, y] = this.spot(l, q.dir, i);
            cb.moved(s, x, y, (q.dir === 0 ? l.bottom.ground : l.top.ground));
            i++;
          }
        }
        // boarding: one carrier per accrued unit of capacity
        q.credit += this.ratePerTick(l) / cap(l);
        const dur = this.rideTicks(l);
        while (q.credit >= 1 && q.waiting.length) {
          q.credit -= 1;
          for (let k = 0; k < cap(l) && q.waiting.length; k++) {
            const s = q.waiting.shift()!;
            q.riding.push({ slot: s, start: tick, dur });
            boarded++; q.boardedTotal++;
            cb.boarded?.(l.id, s);
          }
        }
        if (!q.waiting.length && q.credit > 1) q.credit = 1;
      }
      // ride progress
      if (q.riding.length) {
        const keep: Ride[] = [];
        for (const r of q.riding) {
          if (!l) { this.slotQueue.delete(r.slot); this.patience.delete(r.slot); cb.released(r.slot, q.liftId, 'closed'); continue; }
          if (frozen(l)) {
            if (l.evac) { // rescued: brought down to the bottom station
              this.slotQueue.delete(r.slot); this.patience.delete(r.slot);
              cb.moved(r.slot, l.bottom.x + 0.5, l.bottom.y + 0.5, l.bottom.ground);
              cb.released(r.slot, q.liftId, 'closed');
              continue;
            }
            r.start++; // time stands still on the cable
            this.store.happiness[r.slot] = Math.max(0, this.store.happiness[r.slot]! - LIFT_OPS.stranded.happinessPerTick);
            keep.push(r);
            continue;
          }
          { const h = this.store.happiness[r.slot]!; this.store.happiness[r.slot] = Math.max(0, Math.min(1, h + (LIFTS[l.kind].comfort - 0.5) * 0.0012)); }
          const f = Math.min(1, (tick - r.start) / r.dur);
          const a = q.dir === 0 ? l.bottom : l.top, b = q.dir === 0 ? l.top : l.bottom;
          cb.moved(r.slot, a.x + 0.5 + (b.x - a.x) * f, a.y + 0.5 + (b.y - a.y) * f, a.ground + (b.ground - a.ground) * f + 0.6);
          if (f >= 1) { this.slotQueue.delete(r.slot); this.patience.delete(r.slot); cb.done(r.slot, q.liftId, q.dir); }
          else keep.push(r);
        }
        q.riding = keep;
      }
      if (l && q.dir === 0) this.countBoardings(l, tick, boarded);
    }
  }

  private countBoardings(l: LiftData, tick: number, n: number): void {
    let ring = this.hourRing.get(l.id);
    if (!ring) { ring = new Array<number>(HOUR_TICKS).fill(0); this.hourRing.set(l.id, ring); }
    ring[tick % HOUR_TICKS] = n;
    let sum = 0;
    for (const v of ring) sum += v;
    const r = l.riders ?? (l.riders = { total: 0, perHour: 0 });
    r.total += n; r.perHour = sum;
  }
}
