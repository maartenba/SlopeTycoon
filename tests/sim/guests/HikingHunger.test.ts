import { describe, expect, it } from 'vitest';
import { Excursions, EXC, type ExcHost } from '../../../src/sim/guests/Excursion';
import { GuestStore, GState } from '../../../src/sim/guests/Guest';
import { NEEDS, tickNeeds, NEUTRAL_ENV } from '../../../src/sim/guests/Needs';
import { Layer } from '../../../src/world/Networks';
import { Pref, prefFor } from '../../../src/sim/guests/Decision';
import { buildHikingResort, runScenario, summarise } from '../../../scripts/analysis/hikingLib';

/** Hunger audit levers (docs/hiking.md 'Hunger audit'): hike pace, trip planner food check, food stops on the way, packed lunch, eat before a trip, starvation measure. */
function fixture(foodAt: (x: number, y: number) => boolean = () => false) {
  const n = 64, hikeOk = new Uint8Array(n * n), layers = new Uint8Array(n * n), kind = new Uint8Array(n * n);
  for (let x = 2; x < 62; x++) { hikeOk[5 * n + x] = 1; layers[5 * n + x] = Layer.Hike; }
  const st = new GuestStore(2000);
  const lunches: number[] = [];
  const host: ExcHost = {
    graph: () => ({ size: n, world: { hikeOk, layers, kind }, isStation: () => false }) as never,
    groundAt: () => 0, moveSlot: (s, x, y, z) => { st.x[s] = x; st.y[s] = y; st.z[s] = z; },
    hour: () => 9, leaveHour: () => 19, avoid: () => 0, reachedGoal: () => {},
    foodNear: foodAt, lunch: (s) => { lunches.push(s); st.hunger[s] = 0.05; }, finished: () => {},
  };
  const ex = new Excursions(st, host);
  /** A guest whose id does / does not carry a packed lunch. */
  const add = (packed: boolean, hunger: number): number => {
    for (;;) {
      const s = st.add({ x: 2.5, y: 5.5, z: 0, type: 0, skill: 1, budget: 100, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger });
      if (ex.packedFor(s) === packed) return s;
      st.remove(s);
    }
  };
  const route = (from = 2, to = 61): Int32Array => Int32Array.from({ length: to - from + 1 }, (_, i) => 5 * n + from + i);
  return { n, st, ex, add, route, lunches };
}

describe('hunger rate on an excursion', () => {
  it('grows more slowly than ordinary walking and faster than standing still', () => {
    expect(NEEDS.hungerHike).toBeLessThan(NEEDS.hungerWalk);
    expect(NEEDS.hungerHike).toBeGreaterThan(NEEDS.hungerIdle);
    const f = fixture(), a = f.add(false, 0.2), b = f.add(false, 0.2);
    f.st.state[a] = GState.Walking; f.st.state[b] = GState.Walking; f.st.act[a] = 7; f.st.act[b] = 5;
    tickNeeds(f.st, a, NEUTRAL_ENV); tickNeeds(f.st, b, NEUTRAL_ENV);
    expect(f.st.hunger[a]! - 0.2).toBeCloseTo(NEEDS.hungerHike, 6);
    expect(f.st.hunger[b]! - 0.2).toBeCloseTo(NEEDS.hungerWalk, 6);
  });
});

describe('trip planner food check', () => {
  it('a hungry guest with no food and no packed lunch gets a shorter route; predicted hunger at the goal stays below the cap', () => {
    const f = fixture(), s = f.add(false, 0.68);
    expect(f.ex.begin(s, f.route(), 0, 1, 64, false)).toBe(true);
    const x = f.ex.map.get(s)!;
    expect(x.route.length).toBeLessThan(60);
    expect(f.ex.plannerShort).toBe(1);
    expect(0.68 + (NEEDS.hungerHike / EXC.hourPerTick) * (x.D / 2)).toBeLessThanOrEqual(EXC.maxGoalHunger + 0.02);
  });
  it('a starving guest is refused (the guest eats first); a packed lunch or a food stop lifts the limit', () => {
    const a = fixture(); expect(a.ex.begin(a.add(false, 0.9), a.route(), 0, 1, 64, false)).toBe(false); expect(a.ex.plannerRefused).toBe(1);
    const p = fixture(), sp = p.add(true, 0.9); expect(p.ex.begin(sp, p.route(), 0, 1, 64, false)).toBe(true); expect(p.ex.map.get(sp)!.route.length).toBe(60);
    const h = fixture((x) => x > 40), sh = h.add(false, 0.5); expect(h.ex.begin(sh, h.route(), 0, 1, 64, false)).toBe(true); expect(h.ex.map.get(sh)!.route.length).toBe(60);
  });
  it('a fed guest is never constrained and plans no lunch without food', () => {
    const f = fixture(), s = f.add(false, 0.1);
    expect(f.ex.begin(s, f.route(), 0, 1, 64, false)).toBe(true);
    expect(f.ex.map.get(s)!.route.length).toBe(60); expect(f.ex.map.get(s)!.lunch).toBe(false); expect(f.ex.plannerShort + f.ex.plannerRefused).toBe(0);
  });
});

describe('food stops on the way', () => {
  it('a hut beside the route (not the goal) is a stop: lunch is eaten once, on the way out, hunger resets', () => {
    const f = fixture((x) => x >= 28 && x <= 36), s = f.add(false, 0.45);
    expect(f.ex.begin(s, f.route(), 0, 1, 64, false)).toBe(true);
    const x = f.ex.map.get(s)!;
    expect(x.lunch).toBe(true); expect(x.fa).toBeGreaterThan(0.3); expect(x.fa).toBeLessThan(0.7);
    let atLunchX = -1;
    for (let t = 0; t < 200 && f.ex.has(s); t++) { f.ex.step(s); if (f.lunches.length === 1 && atLunchX < 0) atLunchX = f.st.x[s]!; }
    expect(f.lunches).toEqual([s]); expect(atLunchX).toBeGreaterThan(20); expect(atLunchX).toBeLessThan(50);
  });
  it('the search radius is 8 tiles', () => { expect(EXC.foodRadius).toBe(8); });
  it('old saves (no fa / ate) load: a planned lunch means a stop at the goal', () => {
    const f = fixture((x) => x > 55), s = f.add(false, 0.45);
    expect(f.ex.begin(s, f.route(), 0, 1, 64, false)).toBe(true);
    const d = JSON.parse(JSON.stringify(f.ex.serialize())) as ReturnType<Excursions['serialize']>;
    for (const o of d.list) { delete o.fa; delete o.ate; delete o.pk; }
    f.ex.load(d);
    const x = f.ex.map.get(s)!; expect(x.fa).toBe(1); expect(x.ate).toBe(false);
  });
});

describe('packed lunch', () => {
  it('is eaten once when hunger passes snackAt, is free, and survives a save round trip', () => {
    const f = fixture(), s = f.add(true, 0.1);
    expect(f.ex.begin(s, f.route(), 0, 1, 64, false)).toBe(true);
    expect(f.ex.map.get(s)!.packed).toBe(true);
    f.st.hunger[s] = EXC.snackAt + 0.05;
    const budget0 = f.st.budget[s]!;
    f.ex.step(s);
    expect(f.st.hunger[s]!).toBeLessThanOrEqual(EXC.snackTo + 1e-6); expect(f.st.budget[s]).toBe(budget0);
    expect(f.ex.snacks).toBe(1); expect(f.ex.packedFor(s)).toBe(false);
    const d = JSON.parse(JSON.stringify(f.ex.serialize())) as ReturnType<Excursions['serialize']>;
    const g = fixture(); const s2 = g.add(true, 0.1); expect(s2).toBe(s); g.ex.load(d);
    expect(g.ex.packedFor(s)).toBe(false);
  });
  it('about packShare % of ids carry one', () => {
    const f = fixture(); let k = 0; const N = 1000;
    for (let i = 1; i <= N; i++) { const s = f.st.add({ x: 1, y: 1, z: 0, type: 0, skill: 1, budget: 1, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0 }); if (f.ex.packedFor(s)) k++; f.st.remove(s); }
    expect(Math.abs(k / N - EXC.packShare / 100)).toBeLessThan(0.08);
  });
});

describe('hunger audit on a real hiking resort (headless)', () => {
  it('64 map, summer: almost nobody reaches the goal above 0.75 or leaves starving (the 5 % target is measured on 5 seeds x 10 days in docs/hiking.md; this small sample allows 10 %); lunches happen; departures are counted', () => {
    for (const hungry of [0, 0.3]) {
      let departures = 0;
      const runs = [11, 23, 37].map((seed) => { const { sim, info } = buildHikingResort(64, seed, { defaultHours: true }); const r = runScenario(sim, info, { id: 'h', label: '', arriveHungry: hungry }, 6); departures += sim.guestSim.hikerLeaves.n; return r; });
      const h = summarise(runs).hunger;
      expect(h.trips).toBeGreaterThan(10);
      expect(h.goalAbove75 || 0).toBeLessThan(0.15);
      expect(h.starvingLeave || 0).toBeLessThan(0.1);
      expect(h.lunchTake).toBeGreaterThan(0);
      expect(departures).toBeGreaterThan(0);
    }
  });
});

describe('eat before a planned excursion', () => {
  it('a hungry hiker (> hungryExcursion) mostly picks the food stop first; a fed one does not; just below the threshold it does not', () => {
    const { sim } = buildHikingResort(64, 11, { defaultHours: true });
    sim.tick(30);
    const gs = sim.guestSim, st = gs.store, d = gs.decider;
    expect(d.food.length).toBeGreaterThan(0);
    const mk = (pref: number, hunger: number): number => {
      for (let k = 0; k < 400; k++) {
        const s = st.add({ x: 20.5, y: 20.5, z: 0, type: 0, skill: 1, budget: 200, group: 0, mode: 0, overnight: false, leaveDay: 99, tick: 0, hunger });
        if (prefFor(st.id[s]!, st.type[s]!) === pref) return s;
        st.remove(s);
      }
      throw new Error('no guest with that preference');
    };
    const eats = (pref: number, hunger: number): number => {
      let n = 0;
      const s = mk(pref, hunger);
      for (let k = 0; k < 60; k++) { st.hunger[s] = hunger; if (d.choose(st, s, sim.game.rng, 9.5).kind === 'eat') n++; }
      return n;
    };
    expect(eats(Pref.Hike, 0.6)).toBeGreaterThan(40);
    expect(eats(Pref.Hike, 0.2)).toBeLessThan(15);
    expect(eats(Pref.Hike, 0.6)).toBeGreaterThan(eats(Pref.Hike, NEEDS.hungryExcursion - 0.03));
  });
});
