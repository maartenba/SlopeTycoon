import { createGameState, type GameState } from '../../../src/core/GameState';
import { EventBus } from '../../../src/core/EventBus';
import type { GameEvents } from '../../../src/core/events';
import { Economy } from '../../../src/sim/Economy';
import { AttractionSystem } from '../../../src/sim/attractions/AttractionSystem';
import { GuestStore, GuestType } from '../../../src/sim/guests/Guest';
import type { WorldBuilding } from '../../../src/sim/guests/GuestWorld';
import { building, resetIds } from '../guests/helpers';

export interface Harness {
  state: GameState; bus: EventBus<GameEvents>; store: GuestStore; sys: AttractionSystem; econ: Economy; money: { money: number };
  buildings: WorldBuilding[]; status: Map<number, { open: boolean; reason?: string }>; events: string[];
  frozen: { v: boolean };
  tick: number;
  add(type: string, x?: number, y?: number): WorldBuilding;
  guest(o?: { overnight?: boolean; budget?: number; type?: number }): number;
  arrive(slot: number, b: WorldBuilding): string;
  run(n: number): void;
}

/** Attraction system on a real guest store with controllable open status; no map needed. */
export function harness(): Harness {
  resetIds();
  const state = createGameState(5, 64);
  state.date.day = 170; state.date.minute = 10 * 60;
  const bus = new EventBus<GameEvents>();
  const store = new GuestStore(400);
  const money = { money: 1000 };
  const econ = new Economy(money);
  const buildings: WorldBuilding[] = [];
  const status = new Map<number, { open: boolean; reason?: string }>();
  const frozen = { v: false };
  const events: string[] = [];
  bus.on('attraction:opened', (e) => events.push(`opened:${e.id}:${e.type}`));
  bus.on('attraction:closed', (e) => events.push(`closed:${e.id}:${e.type}:${e.reason}`));
  const sys = new AttractionSystem({ buildings: () => buildings, store, status: (id) => status.get(id), earn: (c, a) => econ.earn(c, a), bus, lakeFrozen: () => frozen.v });
  const h: Harness = {
    state, bus, store, sys, econ, money, buildings, status, events, frozen, tick: 0,
    add: (type, x = 10, y = 10) => { const b = building(type, x, y); buildings.push(b); return b; },
    guest: (o = {}) => store.add({ x: 5, y: 5, z: 0, type: o.type ?? GuestType.Solo, skill: 1, budget: o.budget ?? 500, group: 0, mode: 0, overnight: !!o.overnight, leaveDay: 99, tick: 0, hunger: 0.8 }),
    arrive: (slot, b) => sys.arrive(slot, b, h.tick),
    run: (n) => { for (let i = 0; i < n; i++) { h.tick++; state.date.tick = h.tick; sys.update(state, h.tick); } },
  };
  return h;
}
