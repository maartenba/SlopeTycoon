import { describe, it, expect } from 'vitest';
import { GState, GuestType } from '../../../src/sim/guests/Guest';
import { Act, Pref, prefFor } from '../../../src/sim/guests/Decision';
import { NavMode } from '../../../src/sim/guests/NavGraph';
import { Layer } from '../../../src/world/Networks';
import { resetIds, rig, run, type Rig } from './helpers';
import { Fixture, springResort, starterResort } from './resortFixture';

const T = (f: Fixture, x: number, y: number): number => y * f.size + x;

describe('skiable downhill graph', () => {
  it('ski routes follow the piste strictly downhill (no uphill piste step, flat shuffles only)', () => {
    const f = starterResort(64);
    const g = f.graph(); g.update(0);
    const l = f.liftList[0]!;
    const top = g.stationAnchor(l, 1), bottom = g.stationAnchor(l, 0);
    const r = g.pf.find(NavMode.Ski1, top, bottom)!;
    expect(r).not.toBeNull();
    const pisteTiles = Array.from(r.nodes).filter((t) => g.isPiste(t));
    expect(pisteTiles.length).toBeGreaterThan(10);
    for (let k = 1; k < r.nodes.length; k++) {
      const a = r.nodes[k - 1]!, b = r.nodes[k]!;
      if (g.isPiste(b) && !g.isStation(a)) expect(g.tileAltitude(b)).toBeLessThanOrEqual(g.tileAltitude(a) + 1e-9);
    }
    // uphill piste edges do not exist
    const mid = f.size >> 1, y = Math.floor(f.size * 0.5);
    expect(g.step(NavMode.Ski1, T(f, mid - 2, y), T(f, mid - 2, y + 1))).toBeGreaterThan(0); // downhill
    expect(g.step(NavMode.Ski1, T(f, mid - 2, y + 1), T(f, mid - 2, y))).toBe(-1); // uphill
  });

  it('skiers never path over a closed (snow-free) piste tile; fully closed = no route', () => {
    const f = starterResort(64);
    const g = f.graph(); g.update(0);
    const l = f.liftList[0]!;
    const top = g.stationAnchor(l, 1), bottom = g.stationAnchor(l, 0);
    const mid = f.size >> 1, y = Math.floor(f.size * 0.45);
    // close one of the two lanes at a row: route must use the other lane
    f.setSkiOpen(mid - 2, y, false);
    g.update(1);
    const r = g.pf.find(NavMode.Ski1, top, bottom)!;
    expect(r).not.toBeNull();
    expect(Array.from(r.nodes)).not.toContain(T(f, mid - 2, y));
    for (const t of r.nodes) if (g.isPiste(t)) expect(f.skiOpen[t]).toBe(1);
    // close the second lane too: the piste is cut, no ski route exists
    f.setSkiOpen(mid - 1, y, false);
    g.update(2);
    expect(g.pf.find(NavMode.Ski1, top, bottom)).toBeNull();
    // reopen: hysteresis flip back restores the route (incremental invalidation)
    f.setSkiOpen(mid - 1, y, true);
    g.update(3);
    expect(g.pf.find(NavMode.Ski1, top, bottom)).not.toBeNull();
  });

  it('beginners avoid black: ski mode for skill 0 excludes difficulty 3 tiles; experts take it', () => {
    const f = starterResort(64, 3);
    const g = f.graph(); g.update(0);
    const l = f.liftList[0]!;
    const top = g.stationAnchor(l, 1), bottom = g.stationAnchor(l, 0);
    expect(g.pf.find(NavMode.Ski1, top, bottom)).toBeNull(); // skill 0 -> max blue
    expect(g.pf.find(NavMode.Ski2, top, bottom)).toBeNull(); // skill 1 -> max red
    expect(g.pf.find(NavMode.Ski3, top, bottom)).not.toBeNull();
  });

  it('hikers need snow-free hikeable trails; bikers use bike-capable lifts only', () => {
    const f = new Fixture(64);
    f.path(4, 50, 60, 50);
    f.trail('hike', 20, 30, 20, 49);
    f.trail('mtb', 40, 30, 40, 49);
    f.setSnowline(0); // no snow
    const g = f.graph(); g.update(0);
    expect(g.pf.find(NavMode.Hike, T(f, 20, 50), T(f, 20, 30))).not.toBeNull();
    expect(g.pf.find(NavMode.Hike, T(f, 40, 50), T(f, 40, 30))).toBeNull(); // mtb trail is not a hiking trail
    expect(g.pf.find(NavMode.Bike, T(f, 40, 49), T(f, 40, 30))).toBeNull(); // uphill pedalling: not on MTB downhill trails
    expect(g.pf.find(NavMode.Bike, T(f, 40, 30), T(f, 40, 49))).not.toBeNull(); // downhill ok
    f.setSnowline(40); // snow above y 40: trail tiles there close for hikers
    g.update(1);
    expect(g.pf.find(NavMode.Hike, T(f, 20, 50), T(f, 20, 30))).toBeNull();
    expect(g.pf.find(NavMode.Hike, T(f, 20, 50), T(f, 20, 45))).not.toBeNull();
    // lifts: a T-bar never carries bikes; a foot-mode chairlift does
    f.setSnowline(0);
    f.addLift('tbar', 30, 48, 30, 26, 'ski');
    const g2 = f.graph(); g2.update(0);
    expect(g2.pf.find(NavMode.Bike, T(f, 30, 50), T(f, 30, 26))).toBeNull();
    f.addLift('chair4', 50, 48, 50, 26, 'foot');
    f.liftList.shift();
    const g3 = f.graph(); g3.update(0);
    expect(g3.pf.find(NavMode.Bike, T(f, 50, 50), T(f, 50, 26))).not.toBeNull();
    expect(g3.pf.find(NavMode.Ski3, T(f, 50, 50), T(f, 50, 26))).toBeNull(); // foot-mode lift: no skiers
  });

  it('off-piste is expert-only, risky (costlier) and downhill', () => {
    const f = new Fixture(64);
    f.path(4, 50, 60, 50);
    f.piste(20, 10, 22, 45, 1);
    const g = f.graph(); g.update(0);
    const off = T(f, 40, 20);
    expect(g.standable(NavMode.Ski3, off)).toBe(false);
    expect(g.standable(NavMode.SkiOff, off)).toBe(true);
    expect(g.step(NavMode.SkiOff, T(f, 40, 20), T(f, 40, 21))).toBeGreaterThan(g.step(NavMode.Ski3, T(f, 21, 20), T(f, 21, 21)));
    expect(g.step(NavMode.SkiOff, T(f, 40, 21), T(f, 40, 20))).toBe(-1); // uphill
  });
});

function skiers(r: Rig, count: number, skill: number, x: number, y: number): number[] {
  const out: number[] = [];
  for (let n = 0; n < count; n++) {
    const i = r.sim.store.add({ x: x + (n % 3) * 0.3, y: y + 0.5, z: 0, type: GuestType.Solo, skill, budget: 5000, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0 });
    r.sim.hash.insert(i, r.sim.store.x[i]!, r.sim.store.y[i]!);
    r.sim.store.state[i] = GState.Idle; r.sim.store.timer[i] = 0;
    out.push(i);
  }
  return out;
}

describe('guests ride lifts and descend matching pistes', () => {
  it('guests queue, ride the chairlift, ski down the piste and complete runs (events and counters)', () => {
    resetIds();
    const f = starterResort(64);
    const w = f.guestWorld({ roadEntry: null, railEntry: null });
    const r = rig(w, 42, 64);
    const mid = 32, street = Math.floor(64 * 0.78) + 2;
    const ids = skiers(r, 30, 1, mid - 3, street - 1);
    let sawQueue = false, sawRide = false, sawSki = false;
    for (let t = 0; t < 70; t++) {
      run(r, 1);
      for (const i of ids) {
        if (!r.sim.store.alive[i]) continue;
        const st = r.sim.store.state[i];
        if (st === GState.Queueing) sawQueue = true;
        if (st === GState.Riding) sawRide = true;
        if (r.sim.store.act[i] === Act.SkiDown && st === GState.Walking) {
          sawSki = true;
          // while skiing down they stand on piste / path / station tiles only
          const tile = Math.floor(r.sim.store.y[i]!) * 64 + Math.floor(r.sim.store.x[i]!);
          expect((f.layers[tile]! & Layer.Ski) !== 0 || f.kind[tile] !== 0 || r.sim.graph()!.isStation(tile)).toBe(true);
        }
      }
    }
    expect(sawQueue && sawRide && sawSki).toBe(true);
    expect(r.sim.runsCompleted).toBeGreaterThan(5);
    expect(f.liftList[0]!.riders!.total).toBeGreaterThan(5);
    // chairlift: top is high up the slope; skiers descended along the piste
    let hist = 0;
    for (const i of ids) if (r.sim.store.runs[i]! > 0) hist++;
    expect(hist).toBeGreaterThan(3);
  });

  it('beginners never ride a lift served only by black', () => {
    resetIds();
    const f = starterResort(64, 3);
    const r = rig(f.guestWorld({ roadEntry: null, railEntry: null }), 7, 64);
    const street = Math.floor(64 * 0.78) + 2;
    const ids = skiers(r, 20, 0, 31, street - 1);
    let maxRun = 0;
    for (let t = 0; t < 70; t++) {
      run(r, 1);
      for (const i of ids) if (r.sim.store.alive[i]) { maxRun = Math.max(maxRun, r.sim.store.runMax[i]!); if (r.sim.store.state[i] === GState.Riding) throw new Error('beginner rode a black-only lift'); }
    }
    expect(f.liftList[0]!.riders?.total ?? 0).toBe(0);
    expect(r.sim.runsCompleted).toBe(0);
    expect(maxRun).toBeLessThan(3);
  });

  it('skill rises with runs at appropriate difficulty (persisted per guest)', () => {
    resetIds();
    const f = starterResort(64, 1);
    const r = rig(f.guestWorld({ roadEntry: null, railEntry: null }), 3, 64);
    const street = Math.floor(64 * 0.78) + 2;
    const ids = skiers(r, 12, 0, 31, street - 1);
    for (let t = 0; t < 80; t++) run(r, 1);
    const s = r.sim.store;
    const total = ids.reduce((a, i) => a + (s.alive[i] ? s.runs[i]! : 0), 0);
    expect(total).toBeGreaterThan(0);
    for (const i of ids) if (s.alive[i] && s.runs[i]! > 0) expect(s.skillXp[i]! + s.skill[i]! * 100).toBeGreaterThan(0);
  });

  it('incident:injury is emitted by the run-completion hook with the guest id and place', () => {
    resetIds();
    const f = starterResort(64, 3);
    const r = rig(f.guestWorld({ roadEntry: null, railEntry: null }), 5, 64);
    const [i] = skiers(r, 1, 2, 31, 40);
    const events: Array<{ guestId: number; x: number; y: number }> = [];
    r.bus.on('incident:injury', (e) => events.push(e));
    r.sim.store.runMax[i!] = 3;
    const fin = (r.sim as unknown as { finishRun(i: number, rng: { chance(p: number): boolean; int(a: number, b: number): number }): void }).finishRun.bind(r.sim);
    fin(i!, { chance: (p) => p > 0.5 ? false : true, int: (a) => a });
    expect(events).toHaveLength(1);
    expect(events[0]!.guestId).toBe(r.sim.store.id[i!]);
    expect(r.sim.injuries).toBe(1);
  });
});

describe('seasonal behaviour from the same save', () => {
  it('spring: skiers stay high above the snowline, hikers below it (winter: everyone can ski)', () => {
    resetIds();
    const { f, mid, base } = springResort(64);
    const r = rig(f.guestWorld({ roadEntry: null, railEntry: null }), 21, 64);
    const g = r.sim.graph()!; void g;
    const N = 64;
    // 80 guests with a spread of preferences, all at the village street by the gondola
    const ids: number[] = [];
    for (let n = 0; n < 80; n++) {
      const i = r.sim.store.add({ x: 28 + (n % 8) * 0.4, y: base + 2.5, z: 0, type: n % 2 ? GuestType.Family : GuestType.Adventure, skill: 2, budget: 5000, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0 });
      r.sim.hash.insert(i, r.sim.store.x[i]!, r.sim.store.y[i]!);
      r.sim.store.state[i] = GState.Idle; r.sim.store.timer[i] = 0; ids.push(i);
    }
    const skiY: number[] = [], hikeY: number[] = [];
    for (let t = 0; t < 85; t++) {
      run(r, 1);
      const s = r.sim.store;
      for (const i of ids) {
        if (!s.alive[i]) continue;
        const pref = prefFor(s.id[i]!, s.type[i]!);
        if (s.act[i] === Act.SkiDown && s.state[i] === GState.Walking) {
          skiY.push(s.y[i]!);
          const tile = Math.floor(s.y[i]!) * N + Math.floor(s.x[i]!);
          // never on a snow-free piste tile
          if (f.kind[tile] === 0 && (f.layers[tile]! & Layer.Ski) !== 0) expect(f.skiOpen[tile]).toBe(1);
        }
        if (s.act[i] === Act.ToTrail && s.moveMode[i] === NavMode.Hike && pref === Pref.Hike && s.state[i] === GState.Walking) hikeY.push(s.y[i]!);
      }
    }
    expect(skiY.length).toBeGreaterThan(20);
    expect(hikeY.length).toBeGreaterThan(5);
    const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    // smaller y = higher on the mountain
    expect(Math.max(...skiY)).toBeLessThanOrEqual(mid + 1.5);
    expect(mean(skiY)).toBeLessThan(mid);
    expect(mean(hikeY)).toBeGreaterThan(mid);
    console.log(`[spring] skiers y mean ${mean(skiY).toFixed(1)} (snowline y ${mid + 1}), hikers y mean ${mean(hikeY).toFixed(1)}; runs ${r.sim.runsCompleted}`);
  });

  it('snow flips mid-day: guests re-plan, nobody is stranded (no softlock through closing)', () => {
    resetIds();
    const f = starterResort(64);
    const r = rig(f.guestWorld({ roadEntry: null, railEntry: null }), 8, 64);
    const street = Math.floor(64 * 0.78) + 2;
    const ids = skiers(r, 40, 1, 31, street - 1);
    for (let t = 0; t < 30; t++) run(r, 1);
    f.setSnowline(0); // everything melts at once: piste closes under the guests
    // lift keeps running but nothing is skiable: guests must recover or leave; afterwards all leave at dusk
    let guard = 0;
    while (r.state.date.minute < 18 * 60 && guard++ < 200) run(r, 1);
    const s = r.sim.store;
    const alive = ids.filter((i) => s.alive[i]);
    expect(alive.length).toBe(0);
  });
});

describe('determinism', () => {
  function simulate(seed: number): string {
    resetIds();
    const f = starterResort(64);
    const r = rig(f.guestWorld({ roadEntry: null, railEntry: null }), seed, 64);
    skiers(r, 40, 1, 30, Math.floor(64 * 0.78) + 1);
    for (let t = 0; t < 60; t++) run(r, 1);
    return r.sim.store.hash();
  }
  it('same seed -> same guest-state hash after N ticks; different seed differs', () => {
    expect(simulate(11)).toBe(simulate(11));
    expect(simulate(11)).not.toBe(simulate(12));
  });
});
