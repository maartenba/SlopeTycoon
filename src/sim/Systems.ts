import type { GameState } from '../core/GameState';
import type { GameBus } from '../core/events';
import { SYSTEM_BUDGET_MS } from '../config/balance';
import { advanceDate, monthIndex, seasonOfMonth } from './Clock';
import type { SeasonId } from '../core/events';
import type { GuestSim } from './guests/GuestSim';

export interface SimSystem {
  readonly id: string;
  /** Advance by exactly one fixed tick. Must be deterministic (use state.rng, never Math.random/Date.now). */
  update(state: GameState, tick: number): void;
  serialize?(): unknown;
  load?(data: unknown): void;
}

/** Execution order. */
export const SYSTEM_ORDER = ['clock', 'season', 'weather', 'spawner', 'guests', 'attractions', 'ops', 'economy', 'rating'] as const;
export type SystemId = (typeof SYSTEM_ORDER)[number];

export interface SystemStats { id: string; avgMs: number; p95Ms: number; lastMs: number; overBudget: boolean }

const RING = 120;

/** Ordered system registry with a per-system frame-time profiler (ring buffer). */
export class SystemRegistry {
  private systems: SimSystem[] = [];
  private samples = new Map<string, { ring: number[]; i: number }>();
  private total: { ring: number[]; i: number } = { ring: [], i: 0 };

  /** `now` is injectable for tests; profiling never feeds back into simulation state. */
  constructor(private now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : 0), readonly budgetMs = SYSTEM_BUDGET_MS) {}

  register(sys: SimSystem): void {
    const idx = (SYSTEM_ORDER as readonly string[]).indexOf(sys.id);
    if (idx < 0) throw new Error(`Unknown system '${sys.id}'`);
    if (this.systems.some((s) => s.id === sys.id)) throw new Error(`System '${sys.id}' already registered`);
    this.systems.push(sys);
    this.systems.sort((a, b) => (SYSTEM_ORDER as readonly string[]).indexOf(a.id) - (SYSTEM_ORDER as readonly string[]).indexOf(b.id));
    this.samples.set(sys.id, { ring: [], i: 0 });
  }

  /** Replace a stub by id (keeps order). */
  replace(sys: SimSystem): void {
    this.systems = this.systems.filter((s) => s.id !== sys.id);
    this.samples.delete(sys.id);
    this.register(sys);
  }

  ids(): string[] { return this.systems.map((s) => s.id); }
  get(id: string): SimSystem | undefined { return this.systems.find((s) => s.id === id); }

  update(state: GameState, tick: number): void {
    const tStart = this.now();
    for (const s of this.systems) {
      const t0 = this.now();
      s.update(state, tick);
      const dt = this.now() - t0;
      const r = this.samples.get(s.id)!;
      r.ring[r.i] = dt;
      r.i = (r.i + 1) % RING;
    }
    this.total.ring[this.total.i] = this.now() - tStart;
    this.total.i = (this.total.i + 1) % RING;
  }

  /** Whole-tick cost over the last ~120 ticks (all systems), ms. */
  tickStats(): { avgMs: number; p95Ms: number; maxMs: number } {
    const ring = this.total.ring;
    if (ring.length === 0) return { avgMs: 0, p95Ms: 0, maxMs: 0 };
    const sorted = [...ring].sort((a, b) => a - b);
    return { avgMs: ring.reduce((a, b) => a + b, 0) / ring.length, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!, maxMs: sorted[sorted.length - 1]! };
  }

  /** The `n` most expensive systems by average ms. */
  topSystems(n = 5): SystemStats[] { return this.stats().sort((a, b) => b.avgMs - a.avgMs).slice(0, n); }

  stats(): SystemStats[] {
    return this.systems.map((s) => {
      const ring = this.samples.get(s.id)!.ring;
      if (ring.length === 0) return { id: s.id, avgMs: 0, p95Ms: 0, lastMs: 0, overBudget: false };
      const sorted = [...ring].sort((a, b) => a - b);
      const avg = ring.reduce((a, b) => a + b, 0) / ring.length;
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
      const last = ring[(this.samples.get(s.id)!.i + ring.length - 1) % ring.length]!;
      return { id: s.id, avgMs: avg, p95Ms: p95, lastMs: last, overBudget: p95 > this.budgetMs };
    });
  }

  serialize(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const s of this.systems) if (s.serialize) out[s.id] = s.serialize();
    return out;
  }

  load(data: Record<string, unknown>): void {
    for (const s of this.systems) if (s.load && s.id in data) s.load(data[s.id]);
  }
}

export const stubSystem = (id: SystemId): SimSystem => ({ id, update: () => {} });

/** Advances state.date by one tick and emits clock events. */
export function createClockSystem(bus?: GameBus): SimSystem {
  return { id: 'clock', update: (state) => advanceDate(state.date, bus) };
}

/** Emits season:changed when the calendar month crosses into a new season. */
export function createSeasonSystem(bus?: GameBus): SimSystem {
  let last: SeasonId | null = null;
  return {
    id: 'season',
    update: (state) => {
      const cur = seasonOfMonth(monthIndex(state.date));
      if (last !== null && cur !== last) bus?.emit('season:changed', { season: cur, previous: last });
      last = cur;
    },
    serialize: () => ({ last }),
    load: (d) => { last = (d as { last: SeasonId | null }).last; },
  };
}

/** Registry with the full ordered pipeline; unimplemented systems are no-op stubs. */
export function createDefaultRegistry(bus?: GameBus, now?: () => number, guests?: GuestSim): SystemRegistry {
  const r = new SystemRegistry(now);
  r.register(createClockSystem(bus));
  r.register(createSeasonSystem(bus));
  for (const id of ['weather', 'spawner', 'guests', 'attractions', 'ops', 'economy', 'rating'] as const) r.register(stubSystem(id));
  if (guests) registerGuestSystems(r, guests);
  return r;
}

/** FNV-1a hash over date, money, rng state and every system's serialised state. */
export function stateHash(state: GameState, registry: SystemRegistry): string {
  const text = JSON.stringify({ date: state.date, money: state.money, rng: state.rng.getState(), systems: registry.serialize() });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Replace the spawner + guests stubs with the real guest systems. */
export function registerGuestSystems(r: SystemRegistry, guests: GuestSim): void {
  for (const sys of guests.systems()) r.replace(sys);
}
