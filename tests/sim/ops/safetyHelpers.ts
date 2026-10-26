import { Coverage, type CoverageBuilding } from '../../../src/sim/Coverage';
import { BUILDINGS } from '../../../src/config/buildings';
import type { SafetyGuestPort } from '../../../src/sim/ops/Incidents';
import { Safety, type SafetyOptions } from '../../../src/sim/ops';
import { SpatialHash } from '../../../src/sim/guests/SpatialHash';
import { GameBus } from '../../../src/core/events';
import { EventBus } from '../../../src/core/EventBus';
import { Rng } from '../../../src/core/Rng';

let bid = 1;
export const mkB = (type: string, x: number, y: number): CoverageBuilding => ({ id: bid++, type, x, y, w: BUILDINGS[type]!.w, h: BUILDINGS[type]!.h, active: true });

export interface FakeGuest { id: number; x: number; y: number; frozen: boolean; gone?: string; prey?: boolean }

/** In-memory guest port (a SpatialHash-backed lookup like the real one). */
export class FakeGuests implements SafetyGuestPort {
  guests = new Map<number, FakeGuest>();
  released: Array<{ id: number; how: string }> = [];
  hurt = 0;
  private hash: SpatialHash;
  private xs: Float32Array; private ys: Float32Array;
  private slot = new Map<number, number>();
  constructor(size: number, cap = 4000) { this.hash = new SpatialHash(size, cap); this.xs = new Float32Array(cap); this.ys = new Float32Array(cap); }
  add(id: number, x: number, y: number, prey = false): void {
    const s = this.slot.size; this.slot.set(id, s); this.xs[s] = x; this.ys[s] = y; this.hash.insert(s, x, y);
    this.guests.set(id, { id, x, y, frozen: false, prey });
  }
  position(id: number) { const g = this.guests.get(id); return g && !g.gone ? { x: g.x, y: g.y } : null; }
  near(x: number, y: number, r: number, mode: 'any' | 'prey'): number[] {
    const out: number[] = [];
    const slots = this.hash.query(x, y, r, this.xs, this.ys, []);
    const byslot = new Map([...this.slot].map(([id, s]) => [s, id]));
    for (const s of slots) { const g = this.guests.get(byslot.get(s)!)!; if (g.gone || g.frozen || (mode === 'prey' && !g.prey)) continue; out.push(g.id); }
    return out;
  }
  freeze(id: number): boolean { const g = this.guests.get(id); if (!g || g.gone || g.frozen) return false; g.frozen = true; return true; }
  release(id: number, how: 'return' | 'leave' | 'hospital'): void {
    const g = this.guests.get(id)!; this.released.push({ id, how });
    if (how === 'return') g.frozen = false; else g.gone = how;
  }
  hurtNear(): void { this.hurt++; }
}

export function mkSafety(all: Partial<Omit<SafetyOptions, 'buildings' | 'guests'>> & { size?: 64 | 128 | 256; buildings?: CoverageBuilding[]; guests?: FakeGuests; seed?: number } = {}) {
  const { buildings: bl, guests: gs, ...over } = all;
  const size = over.size ?? 64, seed = over.seed ?? 1;
  const cov = new Coverage(size);
  const blds = bl ?? [];
  cov.refresh(blds);
  const guests = gs ?? new FakeGuests(size);
  const bus = new EventBus() as GameBus;
  const events: Array<{ name: string; p: unknown }> = [];
  for (const n of ['incident:created', 'incident:resolved', 'incident:escalated', 'incident:avalanche', 'incident:wildlife'] as const) bus.on(n, (p: unknown) => events.push({ name: n, p }));
  const spent: number[] = [];
  const news: string[] = [];
  const closed: Array<{ n: number; reason: string }> = [];
  const forest = over.forest ?? new Uint8Array(size * size);
  const safety = new Safety({
    size, seed, guests, coverage: cov, buildings: () => blds, bus,
    spend: (_c, a) => { spent.push(a); }, news: (m) => news.push(m),
    isPiste: () => true, forest, blocked: () => false, season: () => 'winter',
    avalanche: {
      grid: { steepness: () => 0, getCorners: () => [0, 0, 0, 0] as const, snowDepth: new Float32Array(size * size) },
      weather: { current: { intensity: 0, kind: 'clear' }, temperatureAt: () => -5 },
      altitude: () => 100, addSnow: () => {}, closeTiles: (t, reason) => closed.push({ n: t.length, reason }),
    },
    ...over,
  });
  return { safety, cov, guests, bus, events, spent, news, closed, blds, size };
}

/** Runs `ticks` ticks (10 ticks = 1 hour), hour starts at `hour0`. */
export function run(safety: Safety, ticks: number, t0 = 0, hour0 = 10): number {
  for (let k = 0; k < ticks; k++) {
    const t = t0 + k, hp = t % 240, hour = (hour0 + Math.floor(hp / 10)) % 24;
    safety.update({ tick: t, hour, tickInHour: hp % 10, day: Math.floor(t / 240) });
  }
  return t0 + ticks;
}
export { Rng };
