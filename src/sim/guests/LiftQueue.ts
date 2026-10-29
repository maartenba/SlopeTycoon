import { LIFTS } from '../../config/lifts';
import { LIFT_OPS } from '../../config/liftOps';
import { LIFT_DWELL_S, LIFT_ECO_FACTOR, LIFT_MID_STATION_DWELL_S, LIFT_MIN_SPEED, LIFT_SECONDS_PER_TICK } from '../../config/balance';
import { isMultiStation, liftStations, liftStats, stationDistances, type LiftData, type LiftStats, type StationRef } from '../Lift';
import type { GuestStore } from './Guest';

export type RideKind = 'ski' | 'foot' | 'bike';
export type JoinResult = 'ok' | 'closed' | 'balk' | 'mode';
export type ReleaseReason = 'closed' | 'impatient';

export interface QueueCallbacks {
  /** Ride finished: guest emerges at the destination station (`station` = index in the lift's station list; absent = the far terminal). */
  done(slot: number, liftId: number, dir: 0 | 1, station?: number): void;
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

/**
 * N-station lifts (docs/mid-stations.md). One Line per (lift, direction): real carriers are simulated as Batches travelling station to station.
 * A carrier leaves the origin station at the lift's throughput cadence; at every mid-station the riders whose destination it is alight, the others
 * stay seated (they are 'through' riders) and the waiting guests board into the FREE seats only, so no carrier ever holds more than its capacity
 * and no segment ever carries more than capacity x cadence (conservation, tested). Two-station lifts never touch this code: they keep the original
 * single-queue model below, byte-identical.
 */
interface MRider { slot: number; dest: number }
interface Batch { riders: MRider[]; to: number; depart: number; arrive: number }
interface Line {
  liftId: number; dir: 0 | 1;
  /** Waiting guests per station index. */
  waiting: number[][];
  credit: number;
  batches: Batch[];
  boardedTotal: number;
}
const lineKey = (liftId: number, dir: 0 | 1): number => liftId * 2 + dir;

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
  private lines = new Map<number, Line>(); // N-station lifts only, key liftId*2 + dir
  private slotLine = new Map<number, { key: number; dest: number }>(); // N-station: slot -> line (waiting or riding)
  private distCache = new Map<number, { sig: string; ds: number[] }>();
  /** Diagnostics / tests: largest carrier load seen on any N-station line. */
  maxCarrierLoad = 0;

  constructor(private store: GuestStore, private lifts: () => readonly LiftData[]) {}

  private lift(id: number): LiftData | undefined { return this.lifts().find((l) => l.id === id); }

  private stats(l: LiftData): LiftStats {
    const sig = `${l.kind}:${l.speed}:${l.ecoActive ? 'e' : ''}:${l.stations?.length ?? 2}:${l.nodes.length}:${l.nodes[0]?.x}:${l.nodes[l.nodes.length - 1]?.x}`;
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
  ridersOn(liftId: number): number {
    let n = (this.queues.get(liftId * 2)?.riding.length ?? 0) + (this.queues.get(liftId * 2 + 1)?.riding.length ?? 0);
    for (const d of [0, 1] as const) for (const b of this.lines.get(lineKey(liftId, d))?.batches ?? []) n += b.riders.length;
    return n;
  }

  /** Riders on the cable right now, per segment (index k = station k <-> k + 1, both directions). N-station lifts only; [] otherwise. */
  segmentLoads(liftId: number): number[] {
    const l = this.lift(liftId);
    if (!l || !isMultiStation(l)) return [];
    const out = new Array<number>(liftStations(l).length - 1).fill(0);
    for (const d of [0, 1] as const) for (const b of this.lines.get(lineKey(liftId, d))?.batches ?? []) out[d === 0 ? b.to - 1 : b.to]! += b.riders.length;
    return out;
  }
  /** Carriers (batches) on the cable per segment right now, for the conservation check. */
  segmentCarriers(liftId: number): number[] {
    const l = this.lift(liftId);
    if (!l || !isMultiStation(l)) return [];
    const out = new Array<number>(liftStations(l).length - 1).fill(0);
    for (const d of [0, 1] as const) for (const b of this.lines.get(lineKey(liftId, d))?.batches ?? []) out[d === 0 ? b.to - 1 : b.to]! += 1;
    return out;
  }

  private q(liftId: number, dir: 0 | 1): Queue {
    const key = liftId * 2 + dir;
    let q = this.queues.get(key);
    if (!q) { q = { liftId, dir, waiting: [], credit: 0, riding: [], boardedTotal: 0 }; this.queues.set(key, q); }
    return q;
  }

  /** Guests waiting at the lift's station in this direction (inspector / overlay hook). */
  queueLength(liftId: number, dir: 0 | 1 = 0, station?: number): number {
    const line = this.lines.get(lineKey(liftId, dir));
    if (line) return line.waiting[station ?? (dir === 0 ? 0 : line.waiting.length - 1)]?.length ?? 0;
    return this.queues.get(liftId * 2 + dir)?.waiting.length ?? 0;
  }

  /** Expected wait in ticks for a guest joining now. */
  waitTicks(liftId: number, dir: 0 | 1 = 0, station?: number): number {
    const line = this.lines.get(lineKey(liftId, dir));
    if (line) {
      const n = this.queueLength(liftId, dir, station);
      const lm = this.lift(liftId);
      return n && lm ? (n + 1) / Math.max(0.01, this.ratePerTick(lm)) : 0;
    }
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
        riding: this.ridersOn(l.id),
        waitTicks: this.waitTicks(l.id, 0), ridersPerHour: l.riders?.perHour ?? 0,
      });
    }
    return out;
  }

  isQueued(slot: number): boolean { return this.slotQueue.has(slot) || this.slotLine.has(slot); }

  /** Join the queue; positions the guest at the station. `patience` is in ticks. */
  join(liftId: number, dir: 0 | 1, slot: number, kind: RideKind, tick: number, patience: number, from?: number, to?: number): JoinResult {
    const l = this.lift(liftId);
    if (!l || !l.open) return 'closed';
    if (!liftCarries(l, kind, dir)) return 'mode';
    if (isMultiStation(l)) return this.joinMulti(l, dir, slot, tick, patience, from, to);
    const q = this.q(liftId, dir);
    const expected = (q.waiting.length + 1) / Math.max(0.01, this.ratePerTick(l));
    if (expected > patience) return 'balk';
    q.waiting.push(slot);
    this.slotQueue.set(slot, liftId * 2 + dir);
    this.patience.set(slot, patience);
    this.store.actTick[slot] = tick;
    return 'ok';
  }

  private joinMulti(l: LiftData, dir: 0 | 1, slot: number, tick: number, patience: number, from?: number, to?: number): JoinResult {
    const st = liftStations(l), n = st.length;
    const f = from ?? (dir === 0 ? 0 : n - 1), t = to ?? (dir === 0 ? n - 1 : 0);
    if (f < 0 || f >= n || t < 0 || t >= n || (dir === 0 ? t <= f : t >= f)) return 'mode';
    if (st[f]!.board === false || st[t]!.alight === false) return 'mode';
    const key = lineKey(l.id, dir);
    let line = this.lines.get(key);
    if (!line) { line = { liftId: l.id, dir, waiting: st.map(() => []), credit: 0, batches: [], boardedTotal: 0 }; this.lines.set(key, line); }
    while (line.waiting.length < n) line.waiting.push([]);
    const w = line.waiting[f]!;
    if ((w.length + 1) / Math.max(0.01, this.ratePerTick(l)) > patience) return 'balk';
    w.push(slot);
    this.slotLine.set(slot, { key, dest: t });
    this.patience.set(slot, patience);
    this.store.actTick[slot] = tick;
    return 'ok';
  }

  /** Remove a guest (despawn / reset) from any queue or ride. */
  cancel(slot: number): void {
    const sl = this.slotLine.get(slot);
    if (sl) {
      const line = this.lines.get(sl.key);
      if (line) {
        for (const w of line.waiting) { const i = w.indexOf(slot); if (i >= 0) { w.splice(i, 1); break; } }
        for (const b of line.batches) { const i = b.riders.findIndex((r) => r.slot === slot); if (i >= 0) { b.riders.splice(i, 1); break; } }
      }
      this.slotLine.delete(slot); this.patience.delete(slot);
    }
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
  clear(): void { this.queues.clear(); this.slotQueue.clear(); this.patience.clear(); this.hourRing.clear(); this.lines.clear(); this.slotLine.clear(); }
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
    if (this.lines.size) this.updateLines(tick, cb, byId);
  }

  /** Cable distance (tiles) bottom -> each station, cached per lift geometry. */
  private distances(l: LiftData): number[] {
    const sig = `${l.kind}:${l.nodes.length}:${l.nodes[0]?.x}:${l.nodes[l.nodes.length - 1]?.x}:${l.stations!.map((x) => x.node).join(',')}`;
    const c = this.distCache.get(l.id);
    if (c && c.sig === sig) return c.ds;
    const ds = stationDistances(l);
    this.distCache.set(l.id, { sig, ds });
    return ds;
  }

  /** Ticks a carrier needs from station `a` to the adjacent station `b` (cable time + the dwell of a mid-station it arrives at). */
  private segTicks(l: LiftData, a: number, b: number, last: number): number {
    const def = LIFTS[l.kind], ds = this.distances(l);
    const v = def.speed * Math.max(LIFT_MIN_SPEED, Math.min(1, l.speed * (l.ecoActive ? LIFT_ECO_FACTOR : 1)));
    const secs = Math.abs(ds[b]! - ds[a]!) / v + (b !== last ? (def.reversible ? LIFT_DWELL_S : LIFT_MID_STATION_DWELL_S) : 0);
    return Math.max(1, Math.ceil(secs / LIFT_SECONDS_PER_TICK));
  }

  private spotAt(s: StationRef, n: number): [number, number] {
    return [s.x + 0.15 + 0.7 * ((n * 0.37) % 1), s.y + 0.15 + 0.7 * ((n * 0.61) % 1)];
  }

  private updateLines(tick: number, cb: QueueCallbacks, byId: Map<number, LiftData>): void {
    for (const key of [...this.lines.keys()].sort((a, b) => a - b)) {
      const line = this.lines.get(key)!;
      const l = byId.get(line.liftId);
      const dir = line.dir;
      if (!l || !isMultiStation(l)) {
        // lift gone (or rebuilt as an ordinary lift): everybody leaves
        for (const w of line.waiting) for (const s of w.splice(0)) { this.slotLine.delete(s); this.patience.delete(s); cb.released(s, line.liftId, 'closed'); }
        for (const b of line.batches) for (const r of b.riders) { this.slotLine.delete(r.slot); this.patience.delete(r.slot); cb.released(r.slot, line.liftId, 'closed'); }
        this.lines.delete(key);
        continue;
      }
      const st = liftStations(l), N = st.length, step = dir === 0 ? 1 : -1, origin = dir === 0 ? 0 : N - 1, last = dir === 0 ? N - 1 : 0;
      const capacity = cap(l);
      let boarded = 0;
      const open = l.open && (liftCarries(l, 'foot', dir) || liftCarries(l, 'ski', dir));
      if (!open) {
        for (const w of line.waiting) for (const s of w.splice(0)) { this.slotLine.delete(s); this.patience.delete(s); cb.released(s, line.liftId, 'closed'); }
        line.credit = 0;
      } else {
        for (let k = 0; k < N; k++) {
          const w = line.waiting[k]!;
          for (let i = 0; i < w.length;) {
            const s = w[i]!, pat = this.patience.get(s) ?? 60;
            if (tick - this.store.actTick[s]! > pat * 2) { w.splice(i, 1); this.slotLine.delete(s); this.patience.delete(s); cb.released(s, line.liftId, 'impatient'); }
            else { const [x, y] = this.spotAt(st[k]!, i); cb.moved(s, x, y, st[k]!.ground); i++; }
          }
        }
        // carriers leave the origin station at the lift's cadence (also empty ones: mid-station guests board into them downstream)
        line.credit += this.ratePerTick(l) / capacity;
        const dur0 = this.segTicks(l, origin, origin + step, last);
        while (line.credit >= 1) {
          line.credit -= 1;
          const riders: MRider[] = [];
          const w = line.waiting[origin]!;
          if (st[origin]!.board !== false) {
            while (riders.length < capacity && w.length) {
              const slot = w.shift()!;
              riders.push({ slot, dest: this.slotLine.get(slot)?.dest ?? last });
              boarded++; line.boardedTotal++;
              cb.boarded?.(l.id, slot);
            }
          }
          line.batches.push({ riders, to: origin + step, depart: tick, arrive: tick + dur0 });
          this.maxCarrierLoad = Math.max(this.maxCarrierLoad, riders.length);
        }
        if (line.credit > 1) line.credit = 1;
      }
      const frozenNow = frozen(l);
      const comfort = (LIFTS[l.kind].comfort - 0.5) * 0.0012;
      // carriers moving: arrivals first (stable order: by arrival tick, then creation order), then positions
      if (line.batches.length) {
        const order = line.batches.map((b, i) => ({ b, i })).sort((a, b) => a.b.arrive - b.b.arrive || a.i - b.i).map((o) => o.b);
        const keep: Batch[] = [];
        for (const b of order) {
          if (frozenNow) {
            if (l.evac) { // rescued: brought down to the bottom station
              for (const r of b.riders) { this.slotLine.delete(r.slot); this.patience.delete(r.slot); cb.moved(r.slot, l.bottom.x + 0.5, l.bottom.y + 0.5, l.bottom.ground); cb.released(r.slot, line.liftId, 'closed'); }
              continue;
            }
            b.depart++; b.arrive++; // time stands still on the cable
            for (const r of b.riders) this.store.happiness[r.slot] = Math.max(0, this.store.happiness[r.slot]! - LIFT_OPS.stranded.happinessPerTick);
            keep.push(b);
            continue;
          }
          let cur: Batch | null = b;
          while (cur && tick >= cur.arrive) {
            const at = cur.to;
            // alight: destination reached (or the end of the line)
            const stay: MRider[] = [];
            for (const r of cur.riders) {
              if (r.dest === at || at === last) { this.slotLine.delete(r.slot); this.patience.delete(r.slot); cb.done(r.slot, line.liftId, dir, at); } else stay.push(r);
            }
            cur.riders = stay;
            if (at === last) { cur = null; break; }
            // board into the free seats (through riders keep theirs)
            const w = line.waiting[at]!;
            if (st[at]!.board !== false) {
              while (cur.riders.length < capacity && w.length) {
                const slot = w.shift()!;
                cur.riders.push({ slot, dest: this.slotLine.get(slot)?.dest ?? last });
                boarded++; line.boardedTotal++;
                cb.boarded?.(l.id, slot);
              }
            }
            this.maxCarrierLoad = Math.max(this.maxCarrierLoad, cur.riders.length);
            const next = at + step;
            cur.depart = cur.arrive; cur.to = next; cur.arrive = cur.depart + this.segTicks(l, at, next, last);
          }
          if (!cur) continue;
          keep.push(cur);
          if (cur.riders.length) {
            const to = st[cur.to]!, from = st[cur.to - step]!;
            const f = Math.max(0, Math.min(1, (tick - cur.depart) / Math.max(1, cur.arrive - cur.depart)));
            for (const r of cur.riders) {
              const h = this.store.happiness[r.slot]!; this.store.happiness[r.slot] = Math.max(0, Math.min(1, h + comfort));
              cb.moved(r.slot, from.x + 0.5 + (to.x - from.x) * f, from.y + 0.5 + (to.y - from.y) * f, from.ground + (to.ground - from.ground) * f + 0.6);
            }
          }
        }
        line.batches = keep;
      }
      if (dir === 0) this.countBoardings(l, tick, boarded);
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
