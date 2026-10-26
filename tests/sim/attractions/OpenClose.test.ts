import { DAYS_PER_YEAR } from '@/config/balance';
import { describe, expect, it } from 'vitest';
import { Buildings } from '../../../src/sim/Buildings';
import { OpenStatus } from '../../../src/sim/OpenStatus';
import { Networks } from '../../../src/world/Networks';
import { EventBus } from '../../../src/core/EventBus';
import type { GameEvents } from '../../../src/core/events';
import { createGameState } from '../../../src/core/GameState';
import { Economy } from '../../../src/sim/Economy';
import { AttractionSystem } from '../../../src/sim/attractions/AttractionSystem';
import { GState, GuestStore, GuestType } from '../../../src/sim/guests/Guest';
import { runDays, world } from '../snowHelpers';
import { harness } from './harness';

describe('inactive and closed attractions refuse guests', () => {
  it('inactive (dependency missing): refuses, reports reason, emits attraction:closed', () => {
    const h = harness();
    const b = h.add('iceRink');
    b.active = false; b.reason = 'Not connected';
    h.run(1);
    const a = h.sys.get(b.id)!;
    expect(a.open).toBe(false);
    expect(h.sys.accepts(b.id)).toBe(false);
    const g = h.guest();
    expect(h.arrive(g, b)).toBe('handled');
    expect(h.store.state[g]).not.toBe(GState.Using);
    expect(a.stats.turnedAway).toBe(1);
    expect(h.econ.ledger.recreation).toBe(0);
    expect(h.events).toEqual([`closed:${b.id}:iceRink:Inactive: Not connected`]);
  });

  it('condition closure shows the OpenStatus reason, releases guests, and reopens on change (typed events)', () => {
    const h = harness();
    const b = h.add('stuntPark');
    h.run(1);
    expect(h.events).toEqual([`opened:${b.id}:stuntPark`]);
    const g = h.guest();
    expect(h.arrive(g, b)).toBe('using');
    h.status.set(b.id, { open: false, reason: 'Closed: no snow at 1,450 m' });
    h.run(1);
    const a = h.sys.get(b.id)!;
    expect(a.reason).toBe('Closed: no snow at 1,450 m');
    expect(a.info().reason).toBe('Closed: no snow at 1,450 m');
    expect(h.store.state[g]).toBe(GState.Idle); // kicked out
    expect(h.events[1]).toBe(`closed:${b.id}:stuntPark:Closed: no snow at 1,450 m`);
    h.run(5);
    expect(h.events).toHaveLength(2); // no repeats while the state is unchanged
    h.status.delete(b.id);
    h.run(1);
    expect(h.events[2]).toBe(`opened:${b.id}:stuntPark`);
  });

  it('beach and boats close when the lake is frozen', () => {
    const h = harness();
    const beach = h.add('beach'), boat = h.add('boatRental', 30, 10);
    h.frozen.v = true;
    h.run(1);
    expect(h.sys.get(beach.id)!.reason).toBe('Closed: the lake is frozen');
    expect(h.sys.get(boat.id)!.open).toBe(false);
    h.frozen.v = false;
    h.run(1);
    expect(h.sys.get(beach.id)!.open).toBe(true);
  });

  it('removing a building frees its guests', () => {
    const h = harness();
    const b = h.add('cafe'); h.run(1);
    const g = h.guest(); h.arrive(g, b);
    h.buildings.length = 0;
    h.run(1);
    expect(h.sys.get(b.id)).toBeUndefined();
    expect(h.store.state[g]).toBe(GState.Idle);
  });
});

describe('open from tile conditions, not the global season (spring snowline fixture)', () => {
  const w = world(11);
  runDays(w, 15 + DAYS_PER_YEAR - 120); // mid-spring
  const buildings = new Buildings(w.grid.occupancy);
  const net = new Networks(w.grid, buildings);
  const bus = new EventBus<GameEvents>();
  const os = new OpenStatus({ grid: w.grid, cond: w.cond, weather: w.weather, bus, networks: () => net, lifts: () => [], buildings: () => buildings.all() });
  const put = (type: string, x: number, y: number) => buildings.add(type, x, y, 0).building;
  const highRink = put('iceRink', 56, 4), highStunt = put('stuntPark', 56, 12), highTerrace = put('heatedTerrace', 58, 22);
  const valleyStunt = put('stuntPark', 1, 40), valleyPlay = put('playground', 1, 50), highPlay = put('playground', 58, 34);
  const valleyAdv = put('adventurePark', 1, 56), valleyBeach = put('beach', 1, 20);
  for (const b of buildings.all()) b.active = true;
  os.evaluate();
  const events: string[] = [];
  bus.on('attraction:opened', (e) => events.push(`o:${e.type}`));
  bus.on('attraction:closed', (e) => events.push(`c:${e.type}`));
  const money = { money: 0 };
  const econ = new Economy(money);
  const store = new GuestStore(50);
  const sys = new AttractionSystem({ buildings: () => buildings.all(), store, status: (id) => os.buildingStatus(id), earn: (c, a) => econ.earn(c, a), bus });
  const state = createGameState(1, 64);
  state.date.day = 15; state.date.minute = 10 * 60;
  sys.update(state, 1);
  const serve = (b: { id: number }, tick: number): boolean => {
    const slot = store.add({ x: 1, y: 1, z: 0, type: GuestType.Solo, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 0, tick });
    const wb = buildings.get(b.id)!;
    const res = sys.arrive(slot, wb, tick);
    for (let t = 1; t <= 40; t++) sys.update(state, tick + t);
    return res === 'using' && sys.get(b.id)!.stats.served >= 1;
  };

  it('snow-dependent high attractions are open in spring; valley ones are closed with a reason', () => {
    expect(os.buildingStatus(highStunt.id)!.open).toBe(true);
    expect(sys.get(highStunt.id)!.open).toBe(true);
    expect(sys.get(valleyStunt.id)!.open).toBe(false);
    expect(sys.get(valleyStunt.id)!.reason).toMatch(/^Closed: no snow at [\d,]+ m$/);
  });
  it('snow-free attractions are the other way round', () => {
    expect(sys.get(valleyPlay.id)!.open).toBe(true);
    expect(sys.get(valleyAdv.id)!.open).toBe(true);
    expect(sys.get(highPlay.id)!.open).toBe(false);
    expect(sys.get(highPlay.id)!.reason).toMatch(/^Closed: snow cover at/);
  });
  it('cold-needing high attractions serve guests in spring while a warm valley beach is judged by its own tile', () => {
    expect(sys.get(highRink.id)!.open).toBe(true);
    expect(sys.get(highTerrace.id)!.open).toBe(true);
    expect(serve(highRink, 100)).toBe(true);
    expect(serve(highStunt, 200)).toBe(true);
    expect(serve(valleyPlay, 300)).toBe(true);
    expect(serve(valleyAdv, 400)).toBe(true);
    expect(serve(valleyStunt, 500)).toBe(false);
    expect(serve(highPlay, 600)).toBe(false);
    expect(econ.ledger.recreation).toBeGreaterThan(0);
    expect(sys.get(valleyBeach.id)!.open).toBe(os.buildingStatus(valleyBeach.id)!.open);
  });
  it('events fired once per state change, with reasons', () => {
    expect(events).toContain('o:iceRink');
    expect(events).toContain('c:stuntPark'); // the valley stunt park
    expect(events.filter((e) => e === 'o:stuntPark')).toHaveLength(1);
  });
});
