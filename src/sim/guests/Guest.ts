/** Struct-of-arrays guest store (typed arrays, slot free-list, serialisable). No three/DOM imports. */

export const GuestType = { Solo: 0, Couple: 1, Family: 2, VIP: 3, Budget: 4, Adventure: 5 } as const;
export const GUEST_TYPE_NAMES = ['solo', 'couple', 'family', 'vip', 'budget', 'adventure'] as const;
export type GuestTypeName = (typeof GUEST_TYPE_NAMES)[number];
/** Extensible type helpers (extra types from config/guestTypes.ts; identity / the old names for the six core types). */
export { coreOf, typeKey, typeLabel, guestTypeCount } from '../../config/guestTypes';

export const Skill = { Beginner: 0, Intermediate: 1, Advanced: 2, Expert: 3 } as const;
export const SKILL_NAMES = ['beginner', 'intermediate', 'advanced', 'expert'] as const;

export const GState = { Walking: 0, Idle: 1, Leaving: 2, Sleeping: 3, Queueing: 4, Riding: 5, Using: 6, Injured: 7 } as const;
export const GSTATE_NAMES = ['walking', 'idle', 'leaving', 'sleeping', 'queueing', 'riding', 'using', 'injured'] as const;

/** How the guest arrived. */
export const Mode = { Road: 0, Rail: 1, Air: 2 } as const;

/** Internal leave reasons; mapped to the event reasons by `eventReason`. */
export const Leave = { None: 0, Satisfied: 1, Bored: 2, Broke: 3, Tired: 4, Closing: 5, Injured: 6 } as const;
export type LeaveReasonEvent = 'satisfied' | 'bored' | 'broke' | 'injured' | 'closing';
export function eventReason(code: number): LeaveReasonEvent {
  switch (code) {
    case Leave.Bored: return 'bored';
    case Leave.Broke: return 'broke';
    case Leave.Closing: return 'closing';
    case Leave.Injured: return 'injured';
    default: return 'satisfied'; // satisfied + tired (had enough)
  }
}

export interface NewGuest {
  x: number; y: number; z: number;
  type: number; skill: number; budget: number; group: number; mode: number;
  overnight: boolean; leaveDay: number; tick: number;
  hunger?: number; fatigue?: number; happiness?: number;
}

export interface GuestSnapshot {
  id: number; x: number; y: number; z: number; state: number; type: number; skill: number;
  hunger: number; fatigue: number; happiness: number; budget: number; group: number; target: number; mode: number; overnight: boolean;
}

/** Max waypoints remembered per guest per tick (render interpolation along the real path). */
export const WP_MAX = 12;

/**
 * Fixed-capacity SoA store. Slots are reused through a LIFO free list; `id` is a never-reused unique id (events use it).
 * `capacity` is the active-guest cap: `add` returns -1 when full (callers throttle/aggregate).
 */
export class GuestStore {
  readonly alive: Uint8Array;
  readonly id: Int32Array;
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array;
  /** Previous-tick position for render interpolation. */
  readonly px: Float32Array; readonly py: Float32Array; readonly pz: Float32Array;
  /**
   * Render-only: tile-centre waypoints the guest passed THIS tick (path following), in order, between `px,py` and `x,y` (so the renderer can draw the
   * real path instead of the chord). `wpN` is reset at the start of every guest update; never saved or hashed. `wp` = x,y pairs, WP_MAX per slot.
   */
  readonly wpN: Uint8Array; readonly wp: Float32Array;
  readonly state: Uint8Array; readonly type: Uint8Array; readonly skill: Uint8Array; readonly mode: Uint8Array;
  readonly hunger: Float32Array; readonly fatigue: Float32Array; readonly happiness: Float32Array; readonly budget: Float32Array;
  readonly group: Int32Array;
  /** Target building id (0 = none). */
  readonly target: Int32Array;
  readonly goalX: Float32Array; readonly goalY: Float32Array;
  readonly timer: Int32Array; // idle ticks left
  readonly visits: Uint8Array;
  readonly overnight: Uint8Array;
  /** Evening venue visits tonight (dinner / drinks / terrace); reset each morning. */
  readonly eve: Uint8Array;
  /** Comfort need (docs/comfort.md): 0 = comfortable .. 1 = desperate. Saved / hashed only while any guest has a non-zero value (flag off = bit-identical). */
  readonly urge: Float32Array;
  readonly leaveDay: Int32Array;
  readonly leaveReason: Uint8Array;
  readonly lowTicks: Uint16Array; // consecutive ticks with happiness below the unhappy threshold
  readonly bornTick: Int32Array;
  /** Navigation (Task 21): current activity (Decision Act), movement mode (NavMode), lift being queued/ridden (id), hardest piste difficulty this run. */
  readonly act: Uint8Array; readonly moveMode: Uint8Array; readonly liftId: Int32Array; readonly runMax: Uint8Array;
  /** Completed runs, skill experience, activity preference (Pref), tick the current activity/queue started, 1 = the ride is a ski/bike run. */
  readonly runs: Uint16Array; readonly skillXp: Float32Array; readonly pref: Uint8Array; readonly actTick: Int32Array; readonly rideRun: Uint8Array;
  /** Exploration (sim/guests/Exploration.ts): last three lifts ridden (id + 1, newest in recA) and the via tile of the current run (+(tile + 1) while pending, -(tile + 1) once passed (kept for novelty), 0 = none). */
  readonly recA: Uint16Array; readonly recB: Uint16Array; readonly recC: Uint16Array; readonly via: Int32Array;
  private free: number[] = [];
  private high = 0; // slots [0, high) have ever been used
  private nextId = 1;
  /** Id the next arriving guest gets (guests below it already exist). */
  get nextGuestId(): number { return this.nextId; }
  private idToSlot = new Map<number, number>();
  count = 0;
  overnightCount = 0;

  constructor(readonly capacity: number) {
    const n = capacity;
    this.alive = new Uint8Array(n); this.id = new Int32Array(n);
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n);
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.wpN = new Uint8Array(n); this.wp = new Float32Array(n * WP_MAX * 2);
    this.state = new Uint8Array(n); this.type = new Uint8Array(n); this.skill = new Uint8Array(n); this.mode = new Uint8Array(n);
    this.hunger = new Float32Array(n); this.fatigue = new Float32Array(n); this.happiness = new Float32Array(n); this.budget = new Float32Array(n);
    this.group = new Int32Array(n); this.target = new Int32Array(n);
    this.goalX = new Float32Array(n); this.goalY = new Float32Array(n);
    this.timer = new Int32Array(n); this.visits = new Uint8Array(n); this.overnight = new Uint8Array(n); this.eve = new Uint8Array(n); this.urge = new Float32Array(n);
    this.leaveDay = new Int32Array(n); this.leaveReason = new Uint8Array(n); this.lowTicks = new Uint16Array(n); this.bornTick = new Int32Array(n);
    this.act = new Uint8Array(n); this.moveMode = new Uint8Array(n); this.liftId = new Int32Array(n); this.runMax = new Uint8Array(n);
    this.runs = new Uint16Array(n); this.skillXp = new Float32Array(n); this.pref = new Uint8Array(n); this.actTick = new Int32Array(n); this.rideRun = new Uint8Array(n);
    this.recA = new Uint16Array(n); this.recB = new Uint16Array(n); this.recC = new Uint16Array(n); this.via = new Int32Array(n);
  }

  /** One past the highest slot ever used: iterate `for (i < store.limit) if (alive[i])`. */
  get limit(): number { return this.high; }
  slotOf(id: number): number { return this.idToSlot.get(id) ?? -1; }

  add(g: NewGuest): number {
    if (this.count >= this.capacity) return -1;
    const i = this.free.length ? this.free.pop()! : this.high++;
    this.alive[i] = 1; this.id[i] = this.nextId++; this.idToSlot.set(this.id[i]!, i);
    this.x[i] = this.px[i] = g.x; this.y[i] = this.py[i] = g.y; this.z[i] = this.pz[i] = g.z;
    this.state[i] = GState.Walking; this.type[i] = g.type; this.skill[i] = g.skill; this.mode[i] = g.mode;
    this.hunger[i] = g.hunger ?? 0.1; this.fatigue[i] = g.fatigue ?? 0; this.happiness[i] = g.happiness ?? 0.8; this.budget[i] = g.budget;
    this.group[i] = g.group; this.target[i] = 0; this.goalX[i] = g.x; this.goalY[i] = g.y;
    this.timer[i] = 0; this.visits[i] = 0; this.overnight[i] = g.overnight ? 1 : 0; this.leaveDay[i] = g.leaveDay;
    this.leaveReason[i] = Leave.None; this.lowTicks[i] = 0; this.bornTick[i] = g.tick;
    this.act[i] = 0; this.moveMode[i] = 0; this.liftId[i] = 0; this.runMax[i] = 0; this.runs[i] = 0; this.skillXp[i] = 0; this.pref[i] = 0; this.actTick[i] = g.tick; this.rideRun[i] = 0;
    this.recA[i] = 0; this.recB[i] = 0; this.recC[i] = 0; this.via[i] = 0; this.eve[i] = 0; this.urge[i] = 0;
    this.count++;
    if (g.overnight) this.overnightCount++;
    return i;
  }

  remove(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.idToSlot.delete(this.id[i]!);
    if (this.overnight[i]) this.overnightCount--;
    this.free.push(i);
    this.count--;
  }

  snapshot(i: number): GuestSnapshot {
    return {
      id: this.id[i]!, x: this.x[i]!, y: this.y[i]!, z: this.z[i]!, state: this.state[i]!, type: this.type[i]!, skill: this.skill[i]!,
      hunger: this.hunger[i]!, fatigue: this.fatigue[i]!, happiness: this.happiness[i]!, budget: this.budget[i]!, group: this.group[i]!,
      target: this.target[i]!, mode: this.mode[i]!, overnight: !!this.overnight[i],
    };
  }

  private static readonly FIELDS = ['id', 'x', 'y', 'z', 'px', 'py', 'pz', 'state', 'type', 'skill', 'mode', 'hunger', 'fatigue', 'happiness', 'budget', 'group', 'target', 'goalX', 'goalY', 'timer', 'visits', 'overnight', 'leaveDay', 'leaveReason', 'lowTicks', 'bornTick', 'act', 'moveMode', 'liftId', 'runMax', 'runs', 'skillXp', 'pref', 'actTick', 'rideRun', 'recA', 'recB', 'recC', 'via', 'eve'] as const;

  /** FNV-1a over every live guest (slot order) — the guest-state hash used by determinism tests. */
  hash(): string {
    let h = 0x811c9dc5;
    const mix = (v: number): void => { h ^= v | 0; h = Math.imul(h, 0x01000193) >>> 0; };
    const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
    for (let i = 0; i < this.high; i++) {
      if (!this.alive[i]) continue;
      mix(i);
      for (const k of GuestStore.FIELDS) {
        const a = this[k] as ArrayLike<number>;
        if (a instanceof Float32Array) { f32[0] = a[i]!; mix(u32[0]!); } else mix(a[i]!);
      }
      if (this.urge[i]) { f32[0] = this.urge[i]!; mix(u32[0]!); } // comfort need: only mixed while in use, so a resort without it keeps its old hash
    }
    mix(this.count);
    return h.toString(16).padStart(8, '0');
  }

  serialize(): { capacity: number; nextId: number; free: number[]; high: number; cols: Record<string, number[]> } {
    const cols: Record<string, number[]> = { alive: Array.from(this.alive.subarray(0, this.high)) };
    for (const k of GuestStore.FIELDS) cols[k] = Array.from((this[k] as unknown as Float32Array).subarray(0, this.high));
    if (this.urge.subarray(0, this.high).some((v) => v !== 0)) cols.urge = Array.from(this.urge.subarray(0, this.high)); // absent = all comfortable (old saves, flag off)
    return { capacity: this.capacity, nextId: this.nextId, free: [...this.free], high: this.high, cols };
  }

  load(d: ReturnType<GuestStore['serialize']>): void {
    this.alive.fill(0); this.idToSlot.clear(); this.count = 0; this.overnightCount = 0;
    this.high = Math.min(d.high, this.capacity); this.nextId = d.nextId; this.free = d.free.filter((s) => s < this.capacity);
    for (const k of GuestStore.FIELDS) { const col = d.cols[k], a = this[k] as unknown as { [i: number]: number }; for (let i = 0; i < this.high; i++) a[i] = col?.[i] ?? 0; }
    this.urge.fill(0); if (d.cols.urge) for (let i = 0; i < this.high; i++) this.urge[i] = d.cols.urge[i] ?? 0;
    for (let i = 0; i < this.high; i++) {
      if (!d.cols.alive![i]) continue;
      this.alive[i] = 1; this.count++; this.idToSlot.set(this.id[i]!, i);
      if (this.overnight[i]) this.overnightCount++;
    }
  }
}
