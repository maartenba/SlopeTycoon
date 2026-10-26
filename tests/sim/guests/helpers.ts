import { createGameState, type GameState, type MapSize } from '../../../src/core/GameState';
import { EventBus } from '../../../src/core/EventBus';
import type { GameEvents } from '../../../src/core/events';
import { evaluateStatus, type BuildingInstance } from '../../../src/sim/Dependencies';
import { createDefaultRegistry, type SystemRegistry } from '../../../src/sim/Systems';
import { GuestSim } from '../../../src/sim/guests/GuestSim';
import type { GuestWorld, WorldBuilding, ResortStats } from '../../../src/sim/guests/GuestWorld';
import { BUILDINGS } from '../../../src/config/buildings';

export const GOOD_STATS: ResortStats = { openLifts: 4, openPisteTiles: 300, attractions: 4, amenityVariety: 5 };

export interface FakeOpts {
  size?: number;
  roadEntry?: { x: number; y: number } | null;
  railEntry?: { x: number; y: number } | null;
  roadServed?: boolean;
  railServed?: boolean;
  stats?: ResortStats;
  weather?: GuestWorld['weather'];
  walk?: { size: number; kind: Uint8Array; version: number } | null;
}

let nid = 0;
export const resetIds = (): void => { nid = 0; };
export function building(type: string, x: number, y: number, active = true, reason?: string): WorldBuilding {
  const d = BUILDINGS[type]!;
  return { id: ++nid, type, x, y, w: d.w, h: d.h, active, reason };
}

export function fakeWorld(buildings: WorldBuilding[], o: FakeOpts = {}): GuestWorld {
  const size = o.size ?? 128;
  return {
    mapSize: size,
    buildings: () => buildings,
    roadEntry: () => (o.roadEntry === undefined ? { x: 60, y: 112 } : o.roadEntry),
    railEntry: () => (o.railEntry === undefined ? { x: 90, y: 115 } : o.railEntry),
    isRoadServed: () => o.roadServed ?? true,
    isRailServed: () => o.railServed ?? true,
    networkVersion: () => 1,
    route: (_k, from, to) => [from, { x: to.x, y: to.y }],
    walkNet: () => o.walk ?? null,
    groundAt: () => 0,
    stats: () => o.stats ?? GOOD_STATS,
    weather: o.weather ?? (() => ({ kind: 'clear', intensity: 0 })),
  };
}

export interface Rig { state: GameState; bus: EventBus<GameEvents>; sim: GuestSim; reg: SystemRegistry; world: GuestWorld; arrived: number[]; left: Array<{ id: number; reason: string }> }

/** Winter morning (day 10, 07:30) game with the real clock + guest systems. */
export function rig(world: GuestWorld, seed = 42, size: MapSize = 128): Rig {
  const state = createGameState(seed, size);
  state.date.day = 10; state.date.minute = 7 * 60 + 30;
  const bus = new EventBus<GameEvents>();
  const sim = new GuestSim(world, size, bus);
  sim.spawner.rateMult = 20; // unit rigs use a dense arrival rate (3/tick, the pre-balance-pass value) so mechanics tests stay short; independent of GUEST_BASE_SPAWN_PER_TICK
  const reg = createDefaultRegistry(bus, () => 0, sim);
  const arrived: number[] = [], left: Array<{ id: number; reason: string }> = [];
  bus.on('guest:arrived', (e) => arrived.push(e.id));
  bus.on('guest:left', (e) => left.push(e));
  return { state, bus, sim, reg, world, arrived, left };
}

export function run(r: Rig, ticks: number): void {
  for (let i = 0; i < ticks; i++) { r.reg.update(r.state, r.state.date.tick + 1); }
}

/** Real dependency evaluation for station rules. */
export function withStatus(all: WorldBuilding[], opts: { core?: { x: number; y: number }; roadConnected?: boolean } = {}): void {
  const ctx = { buildings: all as BuildingInstance[], core: opts.core ?? null, roadConnected: opts.roadConnected === undefined ? undefined : () => opts.roadConnected! };
  for (const b of all) { const st = evaluateStatus(b, ctx); b.active = st.active; b.reason = st.reason; }
}
