import { describe, it, expect } from 'vitest';
import { GState, GuestStore, GuestType, Leave, Mode } from '../../../src/sim/guests/Guest';
import { tickNeeds, NEUTRAL_ENV, happinessTarget } from '../../../src/sim/guests/Needs';
import { TickLoop } from '../../../src/core/TickLoop';
import { createDefaultRegistry, stateHash } from '../../../src/sim/Systems';
import { createGameState } from '../../../src/core/GameState';
import { EventBus } from '../../../src/core/EventBus';
import type { GameEvents } from '../../../src/core/events';
import { GuestSim } from '../../../src/sim/guests/GuestSim';
import { resetIds, building, fakeWorld, rig, run, withStatus, GOOD_STATS } from './helpers';
import { attractiveness } from '../../../src/sim/guests/Spawner';
import { SimpleMovement } from '../../../src/sim/guests/Movement';
import { GUEST_CAP } from '../../../src/config/balance';

const modesOf = (r: ReturnType<typeof rig>): Set<number> => {
  const s = r.sim.store, out = new Set<number>();
  for (let i = 0; i < s.limit; i++) if (s.alive[i]) out.add(s.mode[i]!);
  return out;
};

describe('arrivals by mode', () => {
  it('road: cars/buses arrive to Parking (and via Bus Depot)', () => {
    const bs = [building('baseLodge', 50, 100), building('parking', 60, 100), building('shuttleDepot', 70, 100)];
    const r = rig(fakeWorld(bs, { railEntry: null }));
    run(r, 85);
    expect(r.sim.store.count).toBeGreaterThan(20);
    expect([...modesOf(r)]).toEqual([Mode.Road]);
    expect(r.sim.spawner.status().text).toBe('');
  });

  it('nobody comes without parking/road access, and the status says why', () => {
    const r = rig(fakeWorld([building('baseLodge', 50, 100)], { roadServed: false, railEntry: null }));
    run(r, 60);
    expect(r.sim.store.count).toBe(0);
    expect(r.sim.spawner.status().text).toBe('No parking/road access');
    const r2 = rig(fakeWorld([building('parking', 60, 100)], { roadEntry: null }));
    run(r2, 30);
    expect(r2.sim.store.count).toBe(0);
    expect(r2.sim.spawner.status().text).toBe('No parking/road access');
  });

  it('road capacity: parking limits concurrent road guests', () => {
    const r = rig(fakeWorld([building('parking', 60, 100)], { railEntry: null }));
    run(r, 120);
    expect(r.sim.store.count).toBeLessThanOrEqual(80 * 2.5);
  });

  it('rail + shuttle depot (station far from the core, active via depot)', () => {
    const lodge = building('baseLodge', 20, 100), station = building('trainStation', 90, 100), depot = building('shuttleDepot', 80, 100);
    const bs = [lodge, station, depot];
    withStatus(bs, { core: { x: 20, y: 100 }, roadConnected: true });
    expect(station.active).toBe(true);
    const r = rig(fakeWorld(bs, { roadEntry: null }));
    run(r, 85);
    expect(r.sim.store.count).toBeGreaterThan(10);
    expect([...modesOf(r)]).toEqual([Mode.Rail]);
  });

  it('rail walking distance (station within walking radius of the core, no depot)', () => {
    const lodge = building('baseLodge', 50, 100), station = building('trainStation', 56, 100);
    const bs = [lodge, station];
    withStatus(bs, { core: { x: 50, y: 100 } });
    expect(station.active).toBe(true);
    const r = rig(fakeWorld(bs, { roadEntry: null }));
    run(r, 85);
    expect([...modesOf(r)]).toEqual([Mode.Rail]);
    expect(r.sim.store.count).toBeGreaterThan(10);
  });

  it('inactive station (too far, no depot) brings nobody', () => {
    const lodge = building('baseLodge', 10, 100), station = building('trainStation', 100, 100);
    const bs = [lodge, station];
    withStatus(bs, { core: { x: 10, y: 100 } });
    expect(station.active).toBe(false);
    const r = rig(fakeWorld(bs, { roadEntry: null }));
    run(r, 60);
    expect(r.sim.store.count).toBe(0);
  });

  it('altiport: only luxury (VIP) guests land, via active altiport', () => {
    const lodge = building('baseLodge', 50, 100), port = building('altiport', 60, 100);
    const bs = [lodge, port];
    withStatus(bs, { core: { x: 50, y: 100 } });
    expect(port.active).toBe(true);
    const r = rig(fakeWorld(bs, { roadEntry: null, railEntry: null }));
    run(r, 85);
    const s = r.sim.store;
    expect(s.count).toBeGreaterThan(0);
    for (let i = 0; i < s.limit; i++) if (s.alive[i]) { expect(s.mode[i]).toBe(Mode.Air); expect(s.type[i]).toBe(GuestType.VIP); }
  });
});

describe('needs and leaving', () => {
  it('hunger and fatigue grow over time; sleeping recovers fatigue', () => {
    const s = new GuestStore(4);
    const i = s.add({ x: 1, y: 1, z: 0, type: 0, skill: 0, budget: 500, group: 1, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0, fatigue: 0 });
    for (let k = 0; k < 50; k++) tickNeeds(s, i, NEUTRAL_ENV);
    expect(s.hunger[i]).toBeGreaterThan(0.1);
    expect(s.fatigue[i]).toBeGreaterThan(0.08);
    const f = s.fatigue[i]!;
    s.state[i] = GState.Sleeping;
    for (let k = 0; k < 5; k++) tickNeeds(s, i, NEUTRAL_ENV);
    expect(s.fatigue[i]).toBeLessThan(f);
    expect(happinessTarget(1, 1, NEUTRAL_ENV)).toBeLessThan(happinessTarget(0, 0, NEUTRAL_ENV));
  });

  it('leave decisions: broke, tired, unhappy', () => {
    const mk = (o: Partial<Parameters<GuestStore['add']>[0]>) => {
      const s = new GuestStore(2);
      const i = s.add({ x: 1, y: 1, z: 0, type: 0, skill: 0, budget: 500, group: 1, mode: 0, overnight: false, leaveDay: 0, tick: 0, ...o });
      return { s, i };
    };
    let g = mk({ budget: 1 });
    expect(tickNeeds(g.s, g.i, NEUTRAL_ENV)).toBe(Leave.Broke);
    g = mk({ fatigue: 0.96 });
    expect(tickNeeds(g.s, g.i, NEUTRAL_ENV)).toBe(Leave.Tired);
    g = mk({ hunger: 1, fatigue: 0.5, happiness: 0.05 });
    let res = 0;
    for (let k = 0; k < 40 && !res; k++) res = tickNeeds(g.s, g.i, { ...NEUTRAL_ENV, weatherPenalty: 0.3 });
    expect(res).toBe(Leave.Bored);
  });

  it('events: arrived/left payloads, reasons broke/closing/satisfied', () => {
    const bs = [building('baseLodge', 50, 100), building('parking', 60, 100)];
    const r = rig(fakeWorld(bs, { railEntry: null }));
    run(r, 90);
    expect(r.arrived.length).toBeGreaterThan(0);
    const s = r.sim.store;
    const ids = new Set<number>();
    for (let i = 0; i < s.limit; i++) if (s.alive[i]) ids.add(s.id[i]!);
    for (const id of ids) expect(r.arrived).toContain(id);
    // force a broke guest
    let slot = -1;
    for (let i = 0; i < s.limit; i++) if (s.alive[i]) { slot = i; break; }
    const brokeId = s.id[slot]!;
    s.budget[slot] = 0;
    run(r, 3);
    expect(r.left.find((e) => e.id === brokeId)?.reason).toBe('broke');
    expect(s.slotOf(brokeId)).toBe(-1);
    // dusk: run until 17:00 + a bit; day guests leave as 'closing'
    const before = r.left.length;
    while (r.state.date.minute < 17 * 60 + 12) run(r, 1);
    run(r, 5);
    const closing = r.left.slice(before).filter((e) => e.reason === 'closing');
    expect(closing.length).toBeGreaterThan(0);
    for (const e of r.left) expect(['satisfied', 'bored', 'broke', 'injured', 'closing']).toContain(e.reason);
    expect(new Set(r.left.map((e) => e.id)).size).toBe(r.left.length); // each guest leaves once
  });

  it('overnight guests use lodging and stay past dusk; none without lodging capacity', () => {
    const base = [building('baseLodge', 50, 100), building('parking', 60, 100)];
    const r0 = rig(fakeWorld(base, { railEntry: null }));
    run(r0, 60);
    expect(r0.sim.store.overnightCount).toBe(0);
    const bs = [...base, building('apartment', 70, 100), building('chalet', 80, 100)];
    const r = rig(fakeWorld(bs, { railEntry: null }));
    run(r, 60);
    expect(r.sim.store.overnightCount).toBeGreaterThan(0);
    expect(r.sim.store.overnightCount).toBeLessThanOrEqual(52);
    while (r.state.date.minute < 18 * 60) run(r, 1);
    expect(r.sim.store.count).toBeGreaterThan(0);
  });
});

describe('simple movement', () => {
  it('walks a footpath to a building and arrives', () => {
    const N = 32, kind = new Uint8Array(N * N);
    for (let x = 2; x < 20; x++) kind[10 * N + x] = 1;
    const lodge = building('cafe', 20, 9);
    const world = fakeWorld([lodge], { size: N, walk: { size: N, kind, version: 1 } });
    const mv = new SimpleMovement(() => world.walkNet());
    const s = new GuestStore(2);
    const i = s.add({ x: 2.5, y: 10.5, z: 0, type: 0, skill: 0, budget: 100, group: 1, mode: 0, overnight: false, leaveDay: 0, tick: 0 });
    let res = 'moving';
    for (let t = 1; t < 400 && res !== 'arrived'; t++) { mv.beginTick(t); res = mv.moveTo(s, i, { x: lodge.x, y: lodge.y, rect: { x: lodge.x, y: lodge.y, w: lodge.w, h: lodge.h }, key: 'b1' }); }
    expect(res).toBe('arrived');
    expect(s.x[i]).toBeGreaterThan(17);
  });
});

describe('store / attractiveness / cap', () => {
  it('free-list reuse, cap and serialise round-trip', () => {
    const s = new GuestStore(3);
    const add = () => s.add({ x: 1, y: 1, z: 0, type: 1, skill: 2, budget: 10, group: 1, mode: 0, overnight: false, leaveDay: 0, tick: 0 });
    const a = add(), b = add(), c = add();
    expect([a, b, c]).toEqual([0, 1, 2]);
    expect(add()).toBe(-1);
    s.remove(b);
    expect(add()).toBe(1);
    expect(s.id[1]).toBe(4); // ids are never reused
    const t = new GuestStore(3);
    t.load(JSON.parse(JSON.stringify(s.serialize())));
    expect(t.hash()).toBe(s.hash());
    expect(t.count).toBe(3);
  });
  it('attractiveness grows with lifts/pistes and collapses without open lifts', () => {
    expect(attractiveness(GOOD_STATS)).toBeGreaterThan(attractiveness({ ...GOOD_STATS, openLifts: 1, openPisteTiles: 40 }));
    expect(attractiveness({ ...GOOD_STATS, openLifts: 0 })).toBeLessThan(0.3);
  });
  it('caps are 1000/2000/3000 and spawning never exceeds the cap (overflow aggregated)', () => {
    expect(GUEST_CAP).toEqual({ 64: 1000, 128: 2000, 256: 3000 });
    const bs = [building('baseLodge', 20, 20), building('trainStation', 30, 30), building('parking', 40, 20)];
    const r = rig(fakeWorld(bs, { size: 64, railEntry: null }), 7, 64);
    (r.sim.spawner as unknown as { prices: { dayTicket: number } }).prices.dayTicket = 1;
    // pre-fill nearly to cap
    for (let n = 0; n < 995; n++) r.sim.store.add({ x: 5, y: 5, z: 0, type: 0, skill: 0, budget: 999, group: 1, mode: 1, overnight: false, leaveDay: 0, tick: 0 });
    run(r, 60);
    expect(r.sim.store.count).toBeLessThanOrEqual(1000);
    expect(r.sim.spawner.overflow).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  const build = (dts: number[]) => {
    resetIds();
    const bs = [building('baseLodge', 50, 100), building('parking', 60, 100), building('apartment', 70, 100), building('cafe', 55, 98)];
    const world = fakeWorld(bs, { railEntry: null });
    const state = createGameState(99, 128);
    state.date.day = 10; state.date.minute = 7 * 60 + 30;
    const bus = new EventBus<GameEvents>();
    const sim = new GuestSim(world, 128, bus);
    sim.spawner.rateMult = 20; // dense arrivals (see helpers.rig)
    const reg = createDefaultRegistry(bus, () => 0, sim);
    const loop = new TickLoop({ bus, visibility: null, onTick: (t) => { if (t > 150) return; reg.update(state, t); } });
    let k = 0;
    while (loop.tickCount < 150) loop.advance(dts[k++ % dts.length]!);
    return { hash: sim.store.hash(), sys: stateHash(state, reg), count: sim.store.count, ticks: state.date.tick };
  };
  it('same seed -> same guest-state hash after N ticks, independent of frame step size', () => {
    const a = build([0.1]);
    const b = build([0.1]);
    const c = build([0.016, 0.033, 0.05, 0.07, 0.09]);
    expect(a.ticks).toBe(150);
    expect(a.count).toBeGreaterThan(20);
    expect(b.hash).toBe(a.hash);
    expect(c.ticks).toBe(150);
    expect(c.hash).toBe(a.hash);
    expect(c.sys).toBe(a.sys);
  });
  it('different seeds differ', () => {
    const bs = [building('baseLodge', 50, 100), building('parking', 60, 100)];
    const a = rig(fakeWorld(bs, { railEntry: null }), 1), b = rig(fakeWorld(bs, { railEntry: null }), 2);
    run(a, 60); run(b, 60);
    expect(a.sim.store.hash()).not.toBe(b.sim.store.hash());
  });
});

describe('routeOnKind', () => {
  it('follows road tiles from the entry to a tile next to the destination', async () => {
    const { routeOnKind } = await import('../../../src/sim/guests/Arrivals');
    const N = 16, kind = new Uint8Array(N * N);
    for (let y = 15; y >= 5; y--) kind[y * N + 3] = 2;
    for (let x = 3; x <= 8; x++) kind[5 * N + x] = 2;
    const r = routeOnKind(kind, N, 2, { x: 3, y: 15 }, { x: 9, y: 4, w: 2, h: 2 });
    expect(r[0]).toEqual({ x: 3, y: 15 });
    expect(r[r.length - 1]).toEqual({ x: 8, y: 5 });
    expect(r.length).toBe(16);
    expect(routeOnKind(kind, N, 2, { x: 3, y: 15 }, { x: 12, y: 12, w: 2, h: 2 })).toEqual([]);
  });
});
