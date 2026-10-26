import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import { spawnGuests } from '../../src/game/demoResort';
import { Act } from '../../src/sim/guests/Decision';
import { GState, GuestStore, GuestType } from '../../src/sim/guests/Guest';
import { NavMode } from '../../src/sim/guests/NavGraph';
import { RideAlong, SPEED_DISPLAY_SCALE, displayKmh, pickAutoSlot, rideActivityLabel, rideKindOf, type RideDeps } from '../../src/render/view/RideAlong';
import type { RideSample } from '../../src/render/view/ViewCameraRig';
import { fullHash } from '../game/harness';

const mkGuest = (s: GuestStore, x: number, y: number, z: number, o: { state?: number; act?: number; mode?: number; liftId?: number } = {}): number => {
  const i = s.add({ x, y, z, type: GuestType.Solo, skill: 1, budget: 100, group: 1, mode: 0, overnight: false, leaveDay: 0, tick: 0 });
  s.state[i] = o.state ?? GState.Walking; s.act[i] = o.act ?? Act.None; s.moveMode[i] = o.mode ?? NavMode.Walk; s.liftId[i] = o.liftId ?? 0;
  return i;
};
const sample = (): RideSample => ({ x: 0, y: 0, z: 0, hx: 0, hz: 0, speed: 0, slope: 0, kind: 'foot' });
const deps = (store: GuestStore, o: Partial<RideDeps> = {}): RideDeps => ({ store, liftFamily: (id) => (id === 7 ? 'gondola' : id === 8 ? 'tbar' : 'chair'), ticksPerSecond: () => 10, ...o });

describe('ride kinds and labels', () => {
  it('maps sim state to a POV kind', () => {
    expect(rideKindOf(GState.Riding, NavMode.Walk, 'chair')).toBe('chair');
    expect(rideKindOf(GState.Riding, NavMode.Walk, 'gondola')).toBe('gondola');
    expect(rideKindOf(GState.Riding, NavMode.Walk, 'cablecar')).toBe('cablecar');
    expect(rideKindOf(GState.Riding, NavMode.Walk, 'funicular')).toBe('funicular');
    expect(rideKindOf(GState.Riding, NavMode.Walk, 'tbar')).toBe('ski');
    expect(rideKindOf(GState.Walking, NavMode.Ski2, undefined)).toBe('ski');
    expect(rideKindOf(GState.Walking, NavMode.SkiOff, undefined)).toBe('ski');
    expect(rideKindOf(GState.Walking, NavMode.Bike, undefined)).toBe('bike');
    expect(rideKindOf(GState.Walking, NavMode.Hike, undefined)).toBe('foot');
    expect(rideActivityLabel('ski', GState.Walking)).toBe('Skiing');
    expect(rideActivityLabel('foot', GState.Queueing)).toBe('Queueing for a lift');
  });
  it('km/h readout is plausible for the arcade speeds (average skier ~6 tiles/tick) and capped', () => {
    expect(SPEED_DISPLAY_SCALE).toBeGreaterThan(0);
    expect(displayKmh(0)).toBe(0);
    expect(displayKmh(6.3)).toBeGreaterThan(25); expect(displayKmh(6.3)).toBeLessThan(60);
    expect(displayKmh(500)).toBeLessThanOrEqual(95);
  });
});

describe('target selection', () => {
  it('auto: the highest skier on a run, else a lift rider, else a biker, else anyone awake', () => {
    const s = new GuestStore(20);
    const walker = mkGuest(s, 1, 1, 0);
    expect(pickAutoSlot(s)).toBe(walker);
    const biker = mkGuest(s, 2, 2, 0, { mode: NavMode.Bike });
    expect(pickAutoSlot(s)).toBe(biker);
    const rider = mkGuest(s, 3, 3, 0, { state: GState.Riding, liftId: 1 });
    expect(pickAutoSlot(s)).toBe(rider);
    const low = mkGuest(s, 4, 4, 2, { act: Act.SkiDown, mode: NavMode.Ski1 }), high = mkGuest(s, 5, 5, 9, { act: Act.SkiDown, mode: NavMode.Ski1 });
    expect(pickAutoSlot(s)).toBe(high);
    expect(pickAutoSlot(s, 0, high)).toBe(low);
    s.remove(low); s.remove(high); s.remove(rider); s.remove(biker); s.remove(walker);
    expect(pickAutoSlot(s)).toBe(-1);
  });
  it('sleeping / injured guests are the last resort', () => {
    const s = new GuestStore(10);
    mkGuest(s, 1, 1, 0, { state: GState.Sleeping });
    const awake = mkGuest(s, 2, 2, 0);
    expect(pickAutoSlot(s)).toBe(awake);
  });
  it('follow / next / stop; unknown ids are refused', () => {
    const s = new GuestStore(10), r = new RideAlong(deps(s));
    const a = mkGuest(s, 1, 1, 0), b = mkGuest(s, 2, 2, 0);
    expect(r.follow(9999)).toBe(false); expect(r.active).toBe(false);
    expect(r.follow(s.id[a]!)).toBe(true); expect(r.slot).toBe(a);
    expect(r.next()).toBe(s.id[b]!); expect(r.slot).toBe(b);
    expect(r.next()).toBe(s.id[a]!); // wraps
    r.stop(); expect(r.active).toBe(false); expect(r.slot).toBe(-1);
    expect(r.followAuto()).not.toBe(0);
  });
  it('next keeps the current guest when nobody else exists', () => {
    const s = new GuestStore(10), r = new RideAlong(deps(s));
    const a = mkGuest(s, 1, 1, 0);
    r.follow(s.id[a]!);
    expect(r.next()).toBe(s.id[a]!);
  });
});

describe('auto-exit on despawn', () => {
  it('check() reports the guest gone once, clears the target and fires onGone; a reused slot never matches (ids are unique)', () => {
    const s = new GuestStore(4);
    const gone: string[] = [];
    const r = new RideAlong(deps(s, { onGone: (why) => gone.push(why) }));
    const a = mkGuest(s, 1, 1, 0);
    const id = s.id[a]!;
    r.follow(id);
    expect(r.check()).toBe(true);
    s.remove(a);
    const b = mkGuest(s, 9, 9, 0); // takes the freed slot (LIFO free list)
    expect(b).toBe(a); expect(s.id[b]).not.toBe(id);
    expect(r.check()).toBe(false);
    expect(gone).toEqual(['despawned']); expect(r.active).toBe(false); expect(r.wasGone).toBe(true);
    expect(r.check()).toBe(false); expect(gone.length).toBe(1);
  });
});

describe('sampling is read-only and follows the sim state', () => {
  it('interpolates position, derives heading / slope / kind, and never writes the store', () => {
    const s = new GuestStore(4), r = new RideAlong(deps(s));
    const i = mkGuest(s, 10, 20, 5, { act: Act.SkiDown, mode: NavMode.Ski1 });
    s.px[i] = 8; s.py[i] = 20; s.pz[i] = 6; // moved +2 in x, -1 in height this tick
    r.follow(s.id[i]!);
    const before = JSON.stringify([Array.from(s.x), Array.from(s.y), Array.from(s.z), Array.from(s.px), Array.from(s.state), Array.from(s.act), Array.from(s.happiness)]);
    const out = sample();
    expect(r.sample(0.5, out)).toBe(true);
    expect(out.x).toBeCloseTo(9); expect(out.z).toBeCloseTo(20); expect(out.y).toBeCloseTo(5.5);
    expect(out.hx).toBeCloseTo(1); expect(out.hz).toBeCloseTo(0);
    expect(out.slope).toBeCloseTo(Math.atan2(-1, 2));
    expect(out.speed).toBeCloseTo(2 * 10);
    expect(out.kind).toBe('ski');
    expect(JSON.stringify([Array.from(s.x), Array.from(s.y), Array.from(s.z), Array.from(s.px), Array.from(s.state), Array.from(s.act), Array.from(s.happiness)])).toBe(before);
  });
  it('lift riders: kind from the lift family and the cable height replaces the sim line', () => {
    const s = new GuestStore(4);
    const r = new RideAlong(deps(s, { cableY: (id) => (id === 7 ? 42 : undefined) }));
    const g = mkGuest(s, 1, 1, 3, { state: GState.Riding, liftId: 7 });
    r.follow(s.id[g]!);
    const out = sample();
    r.sample(1, out);
    expect(out.kind).toBe('gondola'); expect(out.y).toBe(42);
    s.liftId[g] = 3; // chair, no cable info
    r.sample(1, out);
    expect(out.kind).toBe('chair'); expect(out.y).toBe(3);
  });
  it('a guest standing still has no heading (the rig keeps the last one)', () => {
    const s = new GuestStore(4), r = new RideAlong(deps(s));
    const g = mkGuest(s, 1, 1, 0); r.follow(s.id[g]!);
    const out = sample(); r.sample(1, out);
    expect(out.hx).toBe(0); expect(out.hz).toBe(0);
  });
});

describe('ride mode never touches the sim', () => {
  it('stateHash is identical after 3 sim days with a ride-along running (sampling, next, retargeting) vs without', () => {
    const go = (ride: boolean): { hash: string; samples: number } => {
      const sim = createSim({ size: 64, seed: 11, now: () => 0 });
      buildStarterResort(sim);
      spawnGuests(sim, 60, 'skiers', 1);
      const along = new RideAlong({ store: sim.guestSim.store, liftFamily: (id) => sim.lifts.get(id) ? 'chair' : undefined, ticksPerSecond: () => 10 });
      const out = sample();
      let n = 0;
      for (let t = 1; t <= 720; t++) {
        sim.tick(1);
        if (!ride) continue;
        if (!along.active && along.followAuto() === 0) continue;
        if (!along.check()) continue; // the guest left: auto-exit, pick another next tick
        if (along.sample((t % 10) / 10, out)) n++;
        if (t % 50 === 0) along.next();
      }
      return { hash: fullHash(sim), samples: n };
    };
    const off = go(false), on = go(true);
    expect(on.samples).toBeGreaterThan(100);
    expect(on.hash).toBe(off.hash);
  }, 60000);
});
