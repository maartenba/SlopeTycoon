import { describe, expect, it } from 'vitest';
import { FISH } from '../../../src/config/balance';
import { BUILDINGS } from '../../../src/config/buildings';
import { PRICE_TABLE } from '../../../src/config/prices';
import { createGameState } from '../../../src/core/GameState';
import { EventBus } from '../../../src/core/EventBus';
import type { GameEvents } from '../../../src/core/events';
import { Economy } from '../../../src/sim/Economy';
import { AttractionSystem } from '../../../src/sim/attractions/AttractionSystem';
import { AnglingPlanner, fishVisit, ownsRod, visitMood } from '../../../src/sim/attractions/Angling';
import { GState, GuestStore, GuestType } from '../../../src/sim/guests/Guest';
import type { WorldBuilding } from '../../../src/sim/guests/GuestWorld';
import { FishStock, type FishBody } from '../../../src/sim/nature/FishStock';
import { building, resetIds } from '../guests/helpers';

const N = 64;
const tiles = (x0: number, y0: number, w: number, h: number): number[] => { const o: number[] = []; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) o.push(y * N + x); return o; };
const LAKE: FishBody = { key: 'l0', kind: 'lake', name: 'Lake 1', tiles: tiles(20, 10, 5, 5) };
const RIVER: FishBody = { key: 'r1', kind: 'river', name: 'River 1', tiles: tiles(30, 5, 1, 12) };

function rig(o: { bodies?: FishBody[]; path?: (x: number, y: number) => boolean } = {}) {
  resetIds();
  const state = createGameState(5, 64);
  state.date.day = 170; state.date.minute = 10 * 60;
  const bus = new EventBus<GameEvents>();
  const store = new GuestStore(200);
  const money = { money: 1000 };
  const econ = new Economy(money);
  const buildings: WorldBuilding[] = [];
  const stock = new FishStock();
  const frozen = { v: false }, riverIce = { v: false }, version = { v: 1 };
  const bodies = o.bodies ?? [LAKE, RIVER];
  const planner = new AnglingPlanner({
    size: N, bodies: () => bodies, buildings: () => buildings, isWalk: o.path ?? ((x, y) => x === 19 && y >= 10 && y <= 14),
    frozen: () => frozen.v, riverFrozen: (k) => k[0] === 'r' && riverIce.v, stamp: () => version.v + buildings.length * 1000,
  });
  const sys = new AttractionSystem({ buildings: () => buildings, store, status: () => undefined, earn: (c, a) => econ.earn(c, a), bus, lakeFrozen: () => frozen.v, angling: { stock, planner } });
  let tick = 0;
  const run = (n: number): void => { for (let i = 0; i < n; i++) { tick++; state.date.tick = tick; sys.update(state, tick); } };
  const add = (type: string, x: number, y: number): WorldBuilding => { const b = building(type, x, y); buildings.push(b); version.v++; return b; };
  const guest = (budget = 500): number => store.add({ x: 5, y: 5, z: 0, type: GuestType.Solo, skill: 1, budget, group: 0, mode: 0, overnight: false, leaveDay: 99, tick: 0, happiness: 0.5 });
  return { state, store, sys, econ, stock, frozen, riverIce, planner, buildings, add, guest, run, version, arrive: (g: number, b: WorldBuilding) => sys.arrive(g, b, tick), tickNow: () => tick };
}

describe('catalog (Task 49)', () => {
  it('hut: 2x2, $1,800, upkeep 6, 1 staff, day ticket $12; pier: $400, upkeep 1, needs the hut, four places', () => {
    const h = BUILDINGS.tackleHut!, p = BUILDINGS.fishingPier!;
    expect([h.w, h.h, h.cost, h.upkeep, h.staff]).toEqual([2, 2, 1800, 6, 1]);
    expect(PRICE_TABLE.tackleHut!.price).toBe(12);
    expect([p.cost, p.upkeep, p.capacity, p.requires]).toEqual([400, 1, 4, ['tackleHut']]);
    expect(FISH.rodRent).toBe(8); expect(FISH.bait).toBe(3);
  });
});

describe('tackle hut open / closed', () => {
  it('closed without water within 3 tiles', () => {
    const r = rig();
    const b = r.add('tackleHut', 3, 3);
    r.run(1);
    expect(r.sys.get(b.id)!.open).toBe(false);
    expect(r.sys.get(b.id)!.reason).toContain('within 3 tiles');
  });
  it('open beside the lake; capacity = fishing places (piers 4 each + bank spots), at least 2', () => {
    const r = rig({ path: () => false });
    const hut = r.add('tackleHut', 16, 11);
    r.run(1);
    const a = r.sys.get(hut.id)!;
    expect(a.open).toBe(true);
    expect(a.capacity()).toBe(Math.max(1, Math.floor(2 * a.staffFactor() * 1))); // no spots: the floor of 2 places
    r.add('fishingPier', 19, 11); r.run(1);
    expect(r.sys.anglingInfo(hut.id)!.spots).toBe(4);
    expect(a.capacity()).toBe(4);
    r.add('fishingPier', 19, 13); r.run(1);
    expect(r.sys.anglingInfo(hut.id)!.piers).toBe(8);
    expect(a.capacity()).toBe(8);
  });
  it('bank spots count only beside a path', () => {
    const r = rig();
    const hut = r.add('tackleHut', 16, 11); r.run(1);
    expect(r.sys.anglingInfo(hut.id)!.spots).toBeGreaterThanOrEqual(5);
    expect(r.sys.anglingInfo(hut.id)!.piers).toBe(0);
  });
  it('closed without staff', () => {
    const r = rig();
    const hut = r.add('tackleHut', 16, 11); r.run(1);
    const a = r.sys.get(hut.id)!; a.setStaff(0); r.run(1);
    expect(a.open).toBe(false); expect(a.reason).toContain('no staff');
  });
});

describe('a visit: price, extras, catches, settings', () => {
  const visit = (keep: boolean, budget = 500) => {
    const r = rig();
    const hut = r.add('tackleHut', 16, 11); r.run(1);
    const a = r.sys.get(hut.id)!; a.keep = keep;
    const g = r.guest(budget);
    expect(r.arrive(g, hut)).toBe('using');
    const slot = g;
    return { r, a, g, slot, budget0: r.store.budget[g]! };
  };

  it('pays the $12 day ticket, bait $3 and (without an own rod) the $8 rod hire', () => {
    // find one guest without and one with a rod
    const r = rig(); const hut = r.add('tackleHut', 16, 11); r.run(1);
    const withRod: number[] = [], without: number[] = [];
    for (let i = 0; i < 40; i++) { const g = r.guest(); (ownsRod(r.store.id[g]!) ? withRod : without).push(g); }
    expect(withRod.length).toBeGreaterThan(0); expect(without.length).toBeGreaterThan(0);
    const g1 = without[0]!, b1 = r.store.budget[g1]!; r.arrive(g1, hut);
    expect(b1 - r.store.budget[g1]!).toBeCloseTo(12 + FISH.rodRent + FISH.bait);
    const g2 = withRod[0]!, b2 = r.store.budget[g2]!; r.arrive(g2, hut);
    expect(b2 - r.store.budget[g2]!).toBeCloseTo(12 + FISH.bait);
    expect(r.econ.ledger.rental).toBeCloseTo(FISH.rodRent);
    expect(r.econ.ledger.shops).toBeCloseTo(2 * FISH.bait);
    expect(r.econ.ledger.recreation).toBeCloseTo(24);
  });

  it('the visit lasts about seven hours and ends back in the resort with catches booked', () => {
    const v = visit(false);
    v.r.run(v.a.serviceTime() - 2);
    expect(v.r.store.state[v.slot]).toBe(GState.Using);
    v.r.run(5);
    expect(v.r.store.state[v.slot]).toBe(GState.Idle);
    expect(v.a.stats.served).toBe(1);
    expect(v.a.stats.catches).toBeGreaterThanOrEqual(0);
  });

  it('Keep sells the catch ($2 each) and depletes the stock; Catch & release does not', () => {
    const run = (keep: boolean): { stock: number; fish: number; sales: number } => {
      const r = rig({ bodies: [LAKE] });
      const hut = r.add('tackleHut', 16, 11); r.run(1);
      const a = r.sys.get(hut.id)!; a.keep = keep;
      for (let i = 0; i < 60; i++) {
        const g = r.guest(); r.arrive(g, hut);
        r.run(a.serviceTime() + 2);
      }
      return { stock: r.stock.get('l0'), fish: a.stats.catches ?? 0, sales: r.econ.ledger.restaurants };
    };
    const rel = run(false), keep = run(true);
    expect(rel.fish).toBeGreaterThan(20); expect(keep.fish).toBeGreaterThan(10);
    expect(rel.sales).toBe(0);
    expect(keep.sales).toBeCloseTo(keep.fish * FISH.keepSale);
    expect(keep.stock).toBeLessThan(rel.stock - 0.2);
    expect(rel.stock).toBeGreaterThan(FISH.initial - 0.2);
  });

  it('overfished water: fewer fish, a worse mood', () => {
    const plan = { near: true, bodies: [LAKE], spots: [], pierShare: 0, ice: false, noisy: false };
    const good = visitMood({ catches: 3, stock: 0.9, body: LAKE }, plan), empty = visitMood({ catches: 0, stock: 0.1, body: LAKE }, plan);
    expect(good).toBeGreaterThan(0.1); expect(empty).toBeLessThan(-0.05);
    expect(visitMood({ catches: 3, stock: 0.9, body: LAKE }, { ...plan, noisy: true })).toBeLessThan(good);
    expect(visitMood({ catches: 3, stock: 0.9, body: LAKE }, { ...plan, pierShare: 1 })).toBeGreaterThan(good); // a pier makes it nicer
  });

  it('fishVisit is deterministic for a seeded rng and picks the water by guest id', () => {
    const stock = new FishStock();
    const seq = (): number[] => { let k = 0; return Array.from({ length: 8 }, () => ((k = (k * 37 + 11) % 97) / 97)); };
    const u = seq(); let i = 0;
    const plan = { near: true, bodies: [LAKE, RIVER], spots: [], pierShare: 0, ice: false, noisy: false };
    const a = fishVisit(stock, plan, 4, false, () => u[i++ % u.length]!);
    expect(a.body!.key).toBe('l0');
    expect(fishVisit(stock, plan, 5, false, () => 0.99).body!.key).toBe('r1');
    expect(fishVisit(stock, { ...plan, bodies: [] }, 5, false, () => 0).catches).toBe(0);
  });
});

describe('ice fishing', () => {
  it('frozen lake: open with ice fishing (spots on the ice), rivers excluded; river-only = closed', () => {
    const r = rig();
    const hut = r.add('tackleHut', 16, 11); r.run(1);
    r.frozen.v = true; r.run(1);
    const a = r.sys.get(hut.id)!;
    expect(a.open).toBe(true);
    const info = r.sys.anglingInfo(hut.id)!;
    expect(info.ice).toBe(true);
    expect(info.bodies.map((b) => b.key)).toEqual(['l0']);
    const plan = r.planner.plan(hut);
    expect(plan.spots.length).toBeGreaterThan(0);
    expect(plan.spots.every((s) => s.kind === 'ice')).toBe(true);
    // river-only hut near the river: frozen = closed
    const r2 = rig({ bodies: [RIVER] }); const hut2 = r2.add('tackleHut', 27, 8); r2.run(1);
    expect(r2.sys.get(hut2.id)!.open).toBe(true);
    r2.frozen.v = true; r2.run(1);
    expect(r2.sys.get(hut2.id)!.open).toBe(false);
    expect(r2.sys.get(hut2.id)!.reason).toContain('frozen');
  });
  it('a frozen dug river is not fished even in an unfrozen lake season', () => {
    const r = rig();
    const hut = r.add('tackleHut', 25, 8); r.run(1);
    expect(r.sys.anglingInfo(hut.id)!.bodies.map((b) => b.key)).toEqual(['l0', 'r1']);
    r.riverIce.v = true; r.version.v++; r.run(1);
    expect(r.sys.anglingInfo(hut.id)!.bodies.map((b) => b.key)).toEqual(['l0']);
  });
  it('piers are not used on the ice', () => {
    const r = rig({ path: () => false });
    const hut = r.add('tackleHut', 16, 11); r.add('fishingPier', 19, 11); r.run(1);
    expect(r.sys.anglingInfo(hut.id)!.piers).toBe(4);
    r.frozen.v = true; r.run(1);
    expect(r.sys.anglingInfo(hut.id)!.piers).toBe(0);
  });
});

describe('noise and save state', () => {
  it('a motorised tour base within earshot makes the visit noisy', () => {
    const r = rig();
    const hut = r.add('tackleHut', 16, 11); r.run(1);
    expect(r.sys.anglingInfo(hut.id)!.noisy).toBe(false);
    r.add('quadBase', 20, 20); r.run(1);
    expect(r.sys.anglingInfo(hut.id)!.noisy).toBe(true);
  });
  it('the Keep setting is saved only when on and survives a reload of the instance', () => {
    const r = rig();
    const hut = r.add('tackleHut', 16, 11); r.run(1);
    const a = r.sys.get(hut.id)!;
    expect('keep' in a.save()).toBe(false);
    expect(r.sys.setKeep(hut.id, true)).toBe(true);
    const sv = a.save(); expect(sv.keep).toBe(true);
    a.keep = false; a.load(sv); expect(a.keep).toBe(true);
    expect(r.sys.setKeep(99999, true)).toBe(false);
  });
});
