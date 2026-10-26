import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/core/Rng';
import { Economy } from '../../../src/sim/Economy';
import { AttractionSystem } from '../../../src/sim/attractions/AttractionSystem';
import { Decider } from '../../../src/sim/guests/Decision';
import type { DecisionPort } from '../../../src/sim/guests/AttractionPort';
import { GState, GuestStore, GuestType } from '../../../src/sim/guests/Guest';
import { resetIds, rig, run } from '../guests/helpers';
import { starterResort } from '../guests/resortFixture';

function resort(extra: string[]) {
  resetIds();
  const f = starterResort(64);
  const street = Math.floor(64 * 0.78) + 2;
  extra.forEach((t, i) => f.addBuildingOnStreet(t, 8 + i * 6, street));
  const r = rig(f.guestWorld({ roadEntry: null, railEntry: null }), 42, 64);
  const money = { money: 0 };
  const econ = new Economy(money);
  const sys = new AttractionSystem({ buildings: () => r.world.buildings(), store: r.sim.store, hash: r.sim.hash, status: () => undefined, earn: (c, a) => econ.earn(c, a), bus: r.bus, groundAt: r.world.groundAt });
  r.reg.replace(sys.asSystem());
  r.sim.setAttractions(sys);
  return { r, f, sys, econ, street };
}

function crowd(r: ReturnType<typeof resort>['r'], n: number, x: number, y: number, type: number = GuestType.Family): void {
  for (let k = 0; k < n; k++) {
    const i = r.sim.store.add({ x: x + (k % 5) * 0.3, y: y + 0.5, z: 0, type, skill: 1, budget: 800, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0.1 });
    r.sim.hash.insert(i, r.sim.store.x[i]!, r.sim.store.y[i]!);
    r.sim.store.state[i] = GState.Idle; r.sim.store.timer[i] = 0;
  }
}

describe('guests choose, queue for, use and pay for attractions', () => {
  it('end to end through GuestSim: families use the rink/playground/shop; revenue lands in the ledger', () => {
    const { r, sys, econ, street } = resort(['iceRink', 'playground', 'shop', 'rental', 'heatedTerrace']);
    crowd(r, 60, 30, street - 1);
    let sawUsing = false;
    for (let t = 0; t < 200; t++) {
      run(r, 1);
      if (!sawUsing) for (let i = 0; i < r.sim.store.limit; i++) if (r.sim.store.alive[i] && r.sim.store.state[i] === GState.Using) { sawUsing = true; break; }
    }
    expect(sawUsing).toBe(true);
    const served = sys.all().reduce((n, a) => n + a.stats.served, 0);
    expect(served).toBeGreaterThan(10);
    const total = Object.values(econ.ledger).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    const kinds = sys.all().filter((a) => a.stats.served > 0).map((a) => a.b.type);
    expect(kinds.length).toBeGreaterThanOrEqual(2);
    // nobody stays stuck: every Using guest is a member of an attraction
    const members = new Set(sys.all().flatMap((a) => [...a.users, ...a.queue].map((u) => u.id)));
    for (let i = 0; i < r.sim.store.limit; i++) if (r.sim.store.alive[i] && r.sim.store.state[i] === GState.Using) expect(members.has(r.sim.store.id[i]!)).toBe(true);
  });

  it('is deterministic end to end', () => {
    const once = (): string => {
      const { r, sys, econ, street } = resort(['iceRink', 'shop', 'playground']);
      crowd(r, 30, 30, street - 1);
      for (let t = 0; t < 120; t++) run(r, 1);
      return `${r.sim.store.hash()}|${sys.all().map((a) => a.stats.served).join(',')}|${econ.ledger.recreation}|${econ.ledger.shops}`;
    };
    expect(once()).toBe(once());
  });
});

describe('decision hooks', () => {
  const fakePort = (over: Partial<DecisionPort> = {}): DecisionPort => ({
    accepts: () => true, canUse: () => true, queueLength: () => 0, unitPrice: () => 5, needsGear: () => false, appeal: () => 0.5, ...over,
  });
  const choose = (d: Decider, type: number, n = 60) => {
    const s = new GuestStore(4);
    const i = s.add({ x: 30, y: 50, z: 0, type, skill: 1, budget: 400, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0.1 });
    const rng = new Rng(3);
    const out: string[] = [];
    for (let k = 0; k < n; k++) { const it = d.choose(s, i, rng, 10); out.push(`${it.kind}:${it.building?.type ?? ''}`); }
    return out;
  };
  const withBuildings = (types: string[], port?: DecisionPort): Decider => {
    resetIds();
    const f = starterResort(64);
    types.forEach((t, i) => f.addBuilding(t, 30 + i * 4, 40));
    const g = f.graph(); g.update(0);
    const d = new Decider(() => g);
    d.port = port;
    d.refresh(f.buildings);
    return d;
  };

  it('closed attractions are never candidates', () => {
    const open = withBuildings(['iceRink', 'playground'], fakePort());
    const closedId = open.activity[0]!.id;
    const d = withBuildings(['iceRink', 'playground'], fakePort({ accepts: (id) => id !== closedId }));
    expect(d.activity.map((b) => b.id)).not.toContain(closedId);
    expect(open.activity.length).toBe(2);
  });

  it('families prefer playground/rink, adventure guests the adventure park, by appeal', () => {
    const appeal = (type: string, g: number): number => ({ playground: [0.1, 0.2, 1, 0.1, 0.4, 0.1], adventurePark: [0.4, 0.4, 0.6, 0.2, 0.3, 1] } as Record<string, number[]>)[type]![g]!;
    const d = withBuildings(['playground', 'adventurePark'], undefined);
    const idOf = (t: string): number => d.activity.find((b) => b.type === t)!.id;
    d.port = fakePort({ appeal: (id, g) => appeal(id === idOf('playground') ? 'playground' : 'adventurePark', g) });
    const count = (xs: string[], k: string): number => xs.filter((x) => x === `activity:${k}`).length;
    const fam = choose(d, GuestType.Family), adv = choose(d, GuestType.Adventure);
    expect(count(fam, 'playground')).toBeGreaterThan(count(fam, 'adventurePark'));
    expect(count(adv, 'adventurePark')).toBeGreaterThan(count(adv, 'playground'));
  });

  it('price sensitivity: budget guests skip expensive options, queues push guests elsewhere', () => {
    const d = withBuildings(['iceRink', 'playground'], undefined);
    const rink = d.activity.find((b) => b.type === 'iceRink')!.id;
    d.port = fakePort({ unitPrice: (id) => (id === rink ? 200 : 2), queueLength: () => 0 });
    expect(choose(d, GuestType.Budget).filter((x) => x === 'activity:iceRink')).toHaveLength(0);
    d.port = fakePort({ queueLength: (id) => (id === rink ? 30 : 0) });
    const q = choose(d, GuestType.Solo);
    expect(q.filter((x) => x === 'activity:playground').length).toBeGreaterThan(q.filter((x) => x === 'activity:iceRink').length);
  });

  it('guests without gear never ski unless they rent first; no rental = gear owners only', () => {
    const noGear = fakePort({ needsGear: () => true });
    const d = withBuildings([], noGear);
    expect(choose(d, GuestType.Solo).some((x) => x.startsWith('ski'))).toBe(false);
    expect(choose(d, GuestType.Solo).some((x) => x.startsWith('bike'))).toBe(false);
    const d2 = withBuildings(['rental'], noGear);
    const c = choose(d2, GuestType.Solo);
    expect(c.some((x) => x.startsWith('ski'))).toBe(false);
    expect(c.some((x) => x === 'shop:rental')).toBe(true);
    const d3 = withBuildings([], fakePort({ needsGear: () => false }));
    expect(choose(d3, GuestType.Solo).some((x) => x.startsWith('ski'))).toBe(true);
  });
});
