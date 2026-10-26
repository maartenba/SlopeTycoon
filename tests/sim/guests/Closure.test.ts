import { describe, it, expect } from 'vitest';
import { Buildings } from '../../../src/sim/Buildings';
import { Networks, Layer, lineTiles } from '../../../src/world/Networks';
import { OpenStatus } from '../../../src/sim/OpenStatus';
import { NavGraph, NavMode, type NavWorld } from '../../../src/sim/guests/NavGraph';
import { resetIds, rig, run, type Rig } from './helpers';
import { GState, GuestType } from '../../../src/sim/guests/Guest';
import { OccFlag } from '../../../src/world/Occupancy';
import { starterResort } from './resortFixture';
import { runDays, world } from '../snowHelpers';
import { EventBus } from '../../../src/core/EventBus';
import type { GameEvents } from '../../../src/core/events';
import type { LiftData } from '../../../src/sim/Lift';

describe('temporary closures vs navigation (OpenStatus -> NavGraph)', () => {
  const w = world(11);
  runDays(w, 360 + 330 - 240); // deep winter
  const buildings = new Buildings(w.grid.occupancy);
  const net = new Networks(w.grid, buildings);
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('piste:opened', (e) => events.push(`piste:${e.open}`));
  bus.on('lift:opened', (e) => events.push(`lift:${e.id}:${e.open}`));
  const lifts: LiftData[] = [];
  const os = new OpenStatus({ grid: w.grid, cond: w.cond, weather: w.weather, bus, networks: () => net, lifts: () => lifts, buildings: () => buildings.all() });
  const N = w.grid.size, Y = 30;
  // two pistes: A (row 30, x 62 -> 40, downhill = towards low x is NOT guaranteed: pick the direction from altitudes)
  const rowA = lineTiles({ x: 40, y: Y }, { x: 62, y: Y });
  net.paint(Layer.Ski, rowA);
  const rowB = lineTiles({ x: 40, y: 50 }, { x: 62, y: 50 });
  net.paint(Layer.Ski, rowB);
  // both pistes touch a lift station (otherwise the smaller one counts as 'not connected to a lift')
  w.grid.occupancy.flags[Y * 64 + 39]! |= OccFlag.Lift; w.grid.occupancy.flags[50 * 64 + 39]! |= OccFlag.Lift;
  const nav: NavWorld = {
    size: N, kind: net.kind, layers: net.layers, difficulty: net.difficulty, occ: w.grid.occupancy.flags, tileType: w.grid.tileType,
    skiOpen: w.cond.skiOpen, hikeOk: w.cond.hikeOk, snow: w.grid.snowDepth, closed: os.closedMask,
    networkVersion: () => net.version, tileAlt: (x, y) => w.cond.altitude(x, y), isBikeable: () => false, lifts: () => lifts,
    consumeFlips: () => { const a = w.cond.takeFlips(), b = os.takeClosureFlips(); return a && b ? [...a, ...b] : a ?? b; },
  };
  const g = new NavGraph(nav); g.pf.maxBuildsPerTick = Infinity;
  const T = (x: number, y: number): number => y * N + x;
  it('winter fixture: pistes are skiable and open', () => {
    os.evaluate();
    expect(os.pisteAt(50, Y)?.open).toBe(true);
    expect(os.pisteAt(50, 50)?.open).toBe(true);
  });
  const hi = (y: number): number => (w.cond.altitude(62, y) > w.cond.altitude(40, y) ? 62 : 40);
  const lo = (y: number): number => (hi(y) === 62 ? 40 : 62);
  it('an avalanche closure removes the piste from skier paths and reopens after the ticks', () => {
    g.update(0);
    const a = T(hi(Y), Y), b = T(lo(Y), Y);
    expect(g.pf.find(NavMode.Ski1, a, b)).not.toBeNull();
    os.closeTiles([T(50, Y), T(51, Y)], 'Avalanche', 100, 200);
    expect(os.pisteAt(50, Y)?.open).toBe(false);
    expect(os.pisteAt(50, Y)?.reason).toContain('Avalanche');
    expect(os.pisteAt(50, 50)?.open).toBe(true); // other piste unaffected
    expect(events).toContain('piste:false');
    g.update(1);
    // whole closed component is blocked for skiers, not just the swept tiles
    expect(g.pf.find(NavMode.Ski1, a, b)).toBeNull();
    expect(g.standable(NavMode.Ski1, T(45, Y))).toBe(false);
    expect(g.standable(NavMode.Ski1, T(45, 50))).toBe(true);
    const c = T(hi(50), 50), d = T(lo(50), 50);
    expect(g.pf.find(NavMode.Ski1, c, d)).not.toBeNull();
    // not yet expired
    os.tickClosures(250); g.update(2);
    expect(g.pf.find(NavMode.Ski1, a, b)).toBeNull();
    os.tickClosures(300); g.update(3);
    expect(os.closureCount()).toBe(0);
    expect(os.pisteAt(50, Y)?.open).toBe(true);
    expect(g.pf.find(NavMode.Ski1, a, b)).not.toBeNull();
    expect(g.standable(NavMode.Ski1, T(45, Y))).toBe(true);
  });
  it('a lift whose only descent is closed is closed too, and reopens', () => {
    const top = hi(Y) === 62 ? 58 : 42;
    const l: LiftData = { id: 9, kind: 'tbar', bottom: { x: lo(Y) === 62 ? 60 : 40, y: 33, ground: 0 }, top: { x: top, y: Y - 1, ground: w.cond.altitude(top, Y) }, towers: [], nodes: [], tiles: [], open: true, speed: 1, cost: 0 };
    lifts.push(l);
    os.evaluate();
    expect(l.open).toBe(true);
    const swept: number[] = [];
    for (let yy = Y - 5; yy <= Y + 2; yy++) for (let xx = top - 4; xx <= top + 5; xx++) swept.push(T(xx, yy)); // the slide covers the off-piste ground around the station too
    os.closeTiles(swept, 'Avalanche', 400, 100);
    expect(l.open).toBe(false);
    expect(events).toContain('lift:9:false');
    os.tickClosures(600);
    expect(l.open).toBe(true);
    lifts.length = 0;
  });
});

function skiers(r: Rig, count: number, x: number, y: number): void {
  for (let n = 0; n < count; n++) {
    const i = r.sim.store.add({ x: x + (n % 3) * 0.3, y: y + 0.5, z: 0, type: GuestType.Solo, skill: 1, budget: 5000, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0 });
    r.sim.hash.insert(i, r.sim.store.x[i]!, r.sim.store.y[i]!);
    r.sim.store.state[i] = GState.Idle; r.sim.store.timer[i] = 0;
  }
}

describe('guests on a piste that gets closed', () => {
  it('guests leave the closed area (no softlock) and ski again after it reopens', () => {
    resetIds();
    const f = starterResort(64);
    const mid = f.size >> 1, base = Math.floor(f.size * 0.78), top = Math.floor(f.size * 0.2), street = base + 2;
    const r = rig(f.guestWorld({ size: 64, roadEntry: null, railEntry: null }), 5, 64);
    const x0 = mid - 2, x1 = mid - 1, y0 = top + 5, y1 = base - 6;
    skiers(r, 30, mid - 3, street - 1);
    const s = r.sim.store;
    const onClosed = (): number => {
      let n = 0;
      for (let i = 0; i < s.limit; i++) if (s.alive[i] && s.state[i] !== GState.Riding && s.state[i] !== GState.Queueing) {
        if (f.closed[Math.floor(s.y[i]!) * f.size + Math.floor(s.x[i]!)] === 1) n++;
      }
      return n;
    };
    let wasOnPiste = 0;
    for (let t = 0; t < 120 && !wasOnPiste; t++) { run(r, 1); f.setClosed(x0, y0, x1, y1, false); for (let i = 0; i < s.limit; i++) if (s.alive[i] && s.act[i] === 5 && s.y[i]! > y0 && s.y[i]! < y1) wasOnPiste++; }
    expect(wasOnPiste).toBeGreaterThan(0); // guests are mid-run when the avalanche hits
    f.setClosed(x0, y0, x1, y1, true);
    r.state.date.minute = 8 * 60;
    let stuckPeak = 0;
    for (let t = 0; t < 60; t++) { run(r, 1); if (t > 25) stuckPeak = Math.max(stuckPeak, onClosed()); }
    expect(stuckPeak).toBe(0); // everyone skied/walked off the closed strip (or left); nobody frozen inside it
    const runs = r.sim.runsCompleted;
    f.setClosed(x0, y0, x1, y1, false);
    skiers(r, 20, mid - 3, street - 1);
    r.state.date.minute = 8 * 60;
    for (let t = 0; t < 80; t++) run(r, 1);
    expect(r.sim.runsCompleted).toBeGreaterThan(runs);
  });
});
