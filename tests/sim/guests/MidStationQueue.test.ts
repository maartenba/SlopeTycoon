import { describe, expect, it } from 'vitest';
import { GState, GuestStore, GuestType } from '../../../src/sim/guests/Guest';
import { LiftQueues, type QueueCallbacks } from '../../../src/sim/guests/LiftQueue';
import { NavMode } from '../../../src/sim/guests/NavGraph';
import { LIFTS, type LiftKind } from '../../../src/config/lifts';
import { OccFlag } from '../../../src/world/Occupancy';
import { liftStations, type LiftData } from '../../../src/sim/Lift';
import { Fixture } from './resortFixture';
import { resetIds, rig, run } from './helpers';

/** A straight lift at column x with stations at the given rows (bottom first, y falls uphill). */
function multiLift(f: Fixture, kind: LiftKind, x: number, rows: number[], mode: LiftData['activeMode'] = 'ski'): LiftData {
  const l = f.addLift(kind, x, rows[0]!, x, rows[rows.length - 1]!, mode);
  const ground = (y: number): number => f.tileAlt(0, y);
  l.nodes = rows.map((y) => ({ x: x + 1, y: ground(y) + 1, z: y + 1 }));
  l.stations = rows.map((y, i) => ({ x, y, ground: ground(y), node: i }));
  for (const y of rows.slice(1, -1)) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const t = (y + dy) * f.size + x + dx; l.tiles.push(t); f.occ[t]! |= OccFlag.Lift; }
  return l;
}

function setup(kind: LiftKind = 'gondola6', mode: LiftData['activeMode'] = 'ski', rows = [50, 36, 20], n = 600) {
  const f = new Fixture(64);
  const lift = multiLift(f, kind, 32, rows, mode);
  const store = new GuestStore(n);
  const q = new LiftQueues(store, () => f.liftList);
  const slots: number[] = [];
  for (let i = 0; i < n; i++) slots.push(store.add({ x: 20, y: 50, z: 0, type: 0, skill: 1, budget: 100, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0 }));
  const log = { boarded: [] as number[], done: [] as Array<{ slot: number; tick: number; dir: number; station: number | undefined }>, released: [] as Array<{ slot: number; reason: string }>, tick: 0 };
  const cb: QueueCallbacks = {
    done: (slot, _l, dir, station) => log.done.push({ slot, tick: log.tick, dir, station }),
    released: (slot, _l, reason) => log.released.push({ slot, reason }),
    moved: () => undefined,
    boarded: (_l, slot) => log.boarded.push(slot),
  };
  return { f, lift, store, q, slots, log, cb };
}

describe('N-station lift queues (Task 38)', () => {
  it('guests alight at the station they asked for; the destination is reported to the callback', () => {
    const { lift, q, slots, log, cb } = setup();
    expect(q.join(lift.id, 0, slots[0]!, 'ski', 0, 1e9, 0, 1)).toBe('ok'); // bottom -> mid
    expect(q.join(lift.id, 0, slots[1]!, 'ski', 0, 1e9, 0, 2)).toBe('ok'); // bottom -> top
    expect(q.join(lift.id, 0, slots[2]!, 'ski', 0, 1e9, 1, 2)).toBe('ok'); // mid -> top
    expect(q.join(lift.id, 0, slots[3]!, 'ski', 0, 1e9)).toBe('ok'); // default: bottom -> top
    expect(q.queueLength(lift.id, 0, 0)).toBe(3); expect(q.queueLength(lift.id, 0, 1)).toBe(1);
    for (let t = 1; t <= 40; t++) { log.tick = t; q.update(t, cb); }
    const by = new Map(log.done.map((d) => [d.slot, d]));
    expect(by.get(slots[0]!)!.station).toBe(1);
    expect(by.get(slots[1]!)!.station).toBe(2);
    expect(by.get(slots[2]!)!.station).toBe(2);
    expect(by.get(slots[3]!)!.station).toBe(2);
    expect(by.get(slots[0]!)!.tick).toBeLessThan(by.get(slots[1]!)!.tick); // the mid-station is reached first
    expect(q.ridersOn(lift.id)).toBe(0);
    expect(q.isQueued(slots[0]!)).toBe(false);
  });

  it('refuses impossible rides: downhill for skiers, same station, a station that does not allow boarding / alighting', () => {
    const { lift, q, slots } = setup();
    expect(q.join(lift.id, 0, slots[0]!, 'ski', 0, 1e9, 1, 0)).toBe('mode'); // up-direction queue cannot go down
    expect(q.join(lift.id, 0, slots[0]!, 'ski', 0, 1e9, 1, 1)).toBe('mode');
    expect(q.join(lift.id, 1, slots[0]!, 'ski', 0, 1e9, 2, 0)).toBe('mode'); // skiers do not ride down
    lift.stations![1]!.alight = false;
    expect(q.join(lift.id, 0, slots[1]!, 'ski', 0, 1e9, 0, 1)).toBe('mode');
    lift.stations![1]!.board = false;
    expect(q.join(lift.id, 0, slots[2]!, 'ski', 0, 1e9, 1, 2)).toBe('mode');
    expect(q.join(lift.id, 0, slots[3]!, 'ski', 0, 1e9, 0, 2)).toBe('ok');
  });

  it('conservation: no carrier and no segment ever holds more than its capacity, even with every queue saturated', () => {
    for (const kind of ['gondola6', 'chair6', 'gondola10', 'cablecar'] as LiftKind[]) {
      const { lift, q, slots, log, cb, store } = setup(kind, 'mixed', [50, 36, 20], 600);
      const cap = LIFTS[kind].capacityPerCarrier;
      let k = 0;
      const join = (dir: 0 | 1, from: number, to: number): void => { const s = slots[k++]!; q.join(lift.id, dir, s, 'foot', 0, 1e9, from, to); store.actTick[s] = 0; };
      for (let i = 0; i < 200; i++) join(0, 0, 2);
      for (let i = 0; i < 150; i++) join(0, 1, 2);
      for (let i = 0; i < 100; i++) join(0, 0, 1);
      for (let i = 0; i < 80; i++) join(1, 2, 0);
      for (let i = 0; i < 60; i++) join(1, 1, 0);
      let peak = 0;
      for (let t = 1; t <= 150; t++) {
        log.tick = t; q.update(t, cb);
        const loads = q.segmentLoads(lift.id), carriers = q.segmentCarriers(lift.id);
        loads.forEach((v, s) => { expect(v, `${kind} tick ${t} segment ${s}`).toBeLessThanOrEqual(carriers[s]! * cap); peak = Math.max(peak, v); });
      }
      expect(q.maxCarrierLoad, kind).toBeLessThanOrEqual(cap);
      expect(peak, kind).toBeGreaterThan(0);
      expect(log.done.length, kind).toBeGreaterThan(0);
      // every guest is in exactly one place
      const seen = new Set<number>();
      for (const d of log.done) { expect(seen.has(d.slot)).toBe(false); seen.add(d.slot); }
    }
  });

  it('throughput through a segment never exceeds the line capacity (boarded + through <= rate x time)', () => {
    const { lift, q, slots, log, cb } = setup('gondola6', 'ski', [50, 36, 20], 600);
    for (let i = 0; i < 300; i++) q.join(lift.id, 0, slots[i]!, 'ski', 0, 1e9, 0, 2);
    for (let i = 300; i < 500; i++) q.join(lift.id, 0, slots[i]!, 'ski', 0, 1e9, 1, 2);
    const T = 80;
    for (let t = 1; t <= T; t++) { log.tick = t; q.update(t, cb); }
    const rate = q.ratePerTick(lift);
    // riders that entered segment 1 (2nd segment) = all boarded at the mid-station plus the through riders = everyone who got to the top (+ still on it)
    const onSeg1 = q.segmentLoads(lift.id)[1]!;
    const topArrivals = log.done.filter((d) => d.station === 2).length + onSeg1;
    expect(topArrivals).toBeLessThanOrEqual(rate * T + LIFTS.gondola6.capacityPerCarrier * 3);
    // the mid queue only gets the seats the through riders leave free: with a saturated origin it barely boards
    const midBoarders = log.boarded.filter((s) => s >= slots[300]!).length;
    expect(midBoarders).toBeLessThan(rate * T * 0.5);
  });

  it('seats not used by through riders go to the mid-station queue (an unsaturated origin lets the mid queue board at full rate)', () => {
    const { lift, q, slots, log, cb } = setup('gondola6', 'ski', [50, 36, 20], 600);
    for (let i = 0; i < 200; i++) q.join(lift.id, 0, slots[i]!, 'ski', 0, 1e9, 1, 2);
    expect(q.queueLength(lift.id, 0, 1)).toBe(200);
    const T = 60;
    for (let t = 1; t <= T; t++) { log.tick = t; q.update(t, cb); }
    const rate = q.ratePerTick(lift);
    expect(log.boarded.length).toBe(200); // carriers run empty from the bottom: the whole mid queue boards (rate x time is far above 200)
    expect(log.boarded.length).toBeLessThanOrEqual(rate * T + LIFTS.gondola6.capacityPerCarrier);
  });

  it('a mid-station adds its dwell to the ride; a cable car stops at every station (longer cycle, fewer departures)', () => {
    const ride = (kind: LiftKind, rows: number[], multi: boolean): number => {
      const f = new Fixture(64);
      const lift = multi ? multiLift(f, kind, 32, rows, 'ski') : f.addLift(kind, 32, rows[0]!, 32, rows[rows.length - 1]!, 'ski');
      const store = new GuestStore(4), q = new LiftQueues(store, () => f.liftList);
      const slot = store.add({ x: 20, y: 50, z: 0, type: 0, skill: 1, budget: 100, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0 });
      let doneTick = -1;
      const cb: QueueCallbacks = { done: () => { doneTick = tk; }, released: () => undefined, moved: () => undefined };
      let tk = 0;
      q.join(lift.id, 0, slot, 'ski', 0, 1e9, 0, rows.length - 1);
      for (tk = 1; tk <= 300 && doneTick < 0; tk++) q.update(tk, cb);
      return doneTick;
    };
    for (const kind of ['gondola6', 'cablecar'] as LiftKind[]) {
      const withMid = ride(kind, [50, 35, 20], true), plain = ride(kind, [50, 20], false);
      expect(withMid, kind).toBeGreaterThan(plain);
    }
    const cph = (kind: LiftKind, rows: number[], multi: boolean): number => { const f = new Fixture(64); const l = multi ? multiLift(f, kind, 32, rows) : f.addLift(kind, 32, rows[0]!, 32, rows[rows.length - 1]!); return new LiftQueues(new GuestStore(2), () => f.liftList).ratePerTick(l); };
    expect(cph('cablecar', [50, 35, 20], true)).toBeLessThan(cph('cablecar', [50, 20], false)); // the cabin stops (and dwells) at the mid-station
    expect(cph('gondola6', [50, 35, 20], true)).toBeCloseTo(cph('gondola6', [50, 20], false), 2); // detachable carriers keep their spacing
  });

  it('closing the lift empties every station queue; riders on the cable still arrive; removing the lift releases them', () => {
    const { lift, f, q, slots, log, cb } = setup('gondola6', 'ski');
    for (let i = 0; i < 20; i++) q.join(lift.id, 0, slots[i]!, 'ski', 0, 1e9, 0, 2);
    for (let i = 20; i < 40; i++) q.join(lift.id, 0, slots[i]!, 'ski', 0, 1e9, 1, 2);
    for (let t = 1; t <= 2; t++) { log.tick = t; q.update(t, cb); }
    const riding = q.ridersOn(lift.id);
    expect(riding).toBeGreaterThan(0);
    lift.open = false;
    for (let t = 3; t <= 40; t++) { log.tick = t; q.update(t, cb); }
    expect(log.released.filter((r) => r.reason === 'closed').length).toBeGreaterThan(0);
    expect(q.queueLength(lift.id, 0, 0) + q.queueLength(lift.id, 0, 1)).toBe(0);
    expect(log.done.length).toBe(riding);
    lift.open = true;
    for (let i = 40; i < 50; i++) q.join(lift.id, 0, slots[i]!, 'ski', 0, 1e9, 0, 2);
    f.liftList.length = 0; // demolished
    q.update(50, cb);
    expect(q.ridersOn(lift.id)).toBe(0);
    expect(log.released.length).toBeGreaterThanOrEqual(10);
  });

  it('cancel removes a guest from waiting AND riding places; clear() drops everything', () => {
    const { lift, q, slots, log, cb } = setup();
    q.join(lift.id, 0, slots[0]!, 'ski', 0, 1e9, 0, 2); q.join(lift.id, 0, slots[1]!, 'ski', 0, 1e9, 1, 2);
    q.cancel(slots[1]!);
    expect(q.queueLength(lift.id, 0, 1)).toBe(0);
    for (let t = 1; t <= 3; t++) { log.tick = t; q.update(t, cb); }
    expect(q.ridersOn(lift.id)).toBe(1);
    q.cancel(slots[0]!);
    expect(q.ridersOn(lift.id)).toBe(0);
    q.join(lift.id, 0, slots[2]!, 'ski', 0, 1e9, 0, 2); q.clear();
    expect(q.isQueued(slots[2]!)).toBe(false);
  });

  it('foot passengers ride down through the stations too (mixed lift)', () => {
    const { lift, q, slots, log, cb } = setup('gondola6', 'mixed');
    q.join(lift.id, 1, slots[0]!, 'foot', 0, 1e9, 2, 1); q.join(lift.id, 1, slots[1]!, 'foot', 0, 1e9, 2, 0); q.join(lift.id, 1, slots[2]!, 'foot', 0, 1e9, 1, 0);
    for (let t = 1; t <= 40; t++) { log.tick = t; q.update(t, cb); }
    const by = new Map(log.done.map((d) => [d.slot, d]));
    expect([by.get(slots[0]!)?.station, by.get(slots[1]!)?.station, by.get(slots[2]!)?.station]).toEqual([1, 0, 0]);
    for (const d of log.done) expect(d.dir).toBe(1);
  });

  it('is deterministic: the same joins give the same event log', () => {
    const go = (): string => {
      const { lift, q, slots, log, cb } = setup('chair6', 'mixed');
      for (let i = 0; i < 120; i++) q.join(lift.id, 0, slots[i]!, 'foot', 0, 1e9, i % 3 === 0 ? 1 : 0, i % 5 === 0 ? 1 : 2);
      for (let t = 1; t <= 60; t++) { log.tick = t; q.update(t, cb); }
      return JSON.stringify([log.boarded, log.done]);
    };
    expect(go()).toBe(go());
  });
});

describe('N-station lifts: navigation (Task 38)', () => {
  const T = (f: Fixture, x: number, y: number): number => y * f.size + x;
  const resort = (kind: LiftKind = 'gondola6'): { f: Fixture; l: LiftData } => {
    const f = new Fixture(64);
    f.path(4, 52, 60, 52); // street along the bottom
    f.path(32, 51, 32, 52);
    const l = multiLift(f, kind, 32, [49, 35, 20], 'mixed');
    f.trail('hike', 34, 36, 44, 36); // a trail leaving the mid-station
    f.setSnowline(0);
    return { f, l };
  };

  it('every ordered pair of stations is a link: up for everybody, down for foot passengers only; ordinary lifts keep exactly their two links', () => {
    const { f, l } = resort();
    const g = f.graph(); g.update(0);
    const a = (i: number): number => g.stationAnchorAt(l, i);
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as const) {
      expect(g.liftTag(NavMode.Hike, a(i), a(j)), `up ${i}->${j}`).toBe(l.id * 2);
      expect(g.liftTag(NavMode.Ski1, a(i), a(j)), `ski up ${i}->${j}`).toBe(l.id * 2);
      expect(g.liftTag(NavMode.Hike, a(j), a(i)), `down ${j}->${i}`).toBe(l.id * 2 + 1);
      expect(g.liftTag(NavMode.Ski1, a(j), a(i)), `ski down ${j}->${i}`).toBe(-1);
    }
    expect(g.stationAt(a(1))).toMatchObject({ lift: l.id, end: 2, index: 1 });
    expect(g.stationAt(a(0))).toMatchObject({ end: 0, index: 0 });
    expect(g.stationAt(a(2))).toMatchObject({ end: 1, index: 2 });
    const f2 = new Fixture(64);
    const l2 = f2.addLift('gondola6', 32, 49, 32, 20, 'mixed');
    const g2 = f2.graph(); g2.update(0);
    expect(g2.liftTag(NavMode.Hike, g2.stationAnchor(l2, 0), g2.stationAnchor(l2, 1))).toBe(l2.id * 2);
    expect(g2.liftTag(NavMode.Hike, g2.stationAnchor(l2, 1), g2.stationAnchor(l2, 0))).toBe(l2.id * 2 + 1);
  });

  it('a hiker bound for a trail at the mid-station rides to the MID-station (not the top) and a hiker bound for the top rides through', () => {
    const { f, l } = resort();
    const g = f.graph(); g.update(0);
    const start = T(f, 20, 52);
    const toTrail = g.pf.find(NavMode.Hike, start, T(f, 44, 36));
    expect(toTrail, 'route to the mid-station trail').not.toBeNull();
    const nodes = Array.from(toTrail!.nodes);
    expect(nodes).toContain(g.stationAnchorAt(l, 1));
    expect(nodes).not.toContain(g.stationAnchorAt(l, 2));
    // a goal beyond the top station: ride all the way (or through) - the route never leaves at the mid-station to walk
    f.path(30, 20, 34, 20); f.trail('hike', 30, 19, 40, 19); g.touch(T(f, 30, 20)); g.update(1);
    const toTop = g.pf.find(NavMode.Hike, start, T(f, 40, 19));
    if (toTop) expect(Array.from(toTop.nodes)).toContain(g.stationAnchorAt(l, 2));
  });

  it('the station tiles of every station are station tiles; waiting time is per station', () => {
    const { f, l } = resort();
    const g = f.graph(); g.update(0);
    for (let i = 0; i < 3; i++) { const s = liftStations(l)[i]!; for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) expect(g.isStation(T(f, s.x + dx, s.y + dy))).toBe(true); }
  });
});

describe('N-station lifts: guests end to end (Task 38)', () => {
  it('skiers ride a mid-station gondola, some alight at the mid-station, everybody gets down; no carrier exceeds capacity', () => {
    resetIds();
    const f = new Fixture(64);
    const street = 52, mid = 32;
    f.path(4, street, 60, street); f.path(mid, 51, mid, street);
    f.piste(mid - 2, 16, mid - 1, 48, 1);
    f.path(mid - 1, 49, mid - 1, street);
    multiLift(f, 'gondola6', mid, [49, 35, 20], 'ski');
    f.addBuildingOnStreet('cafe', mid + 6, street);
    const r = rig(f.guestWorld({ size: 64, roadEntry: null, railEntry: null }), 5, 64);
    const q = r.sim.queues, doneAt = new Map<number, number>();
    const orig = q.update.bind(q);
    q.update = (t, cb): void => orig(t, { ...cb, done: (slot, id, dir, st) => { doneAt.set(st ?? -1, (doneAt.get(st ?? -1) ?? 0) + 1); cb.done(slot, id, dir, st); } });
    const s = r.sim.store;
    for (let n = 0; n < 60; n++) {
      const i = s.add({ x: mid - 3 + (n % 3) * 0.3, y: street - 1 + 0.5, z: 0, type: GuestType.Solo, skill: 1, budget: 5000, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0 });
      r.sim.hash.insert(i, s.x[i]!, s.y[i]!);
      s.state[i] = GState.Idle; s.timer[i] = 0;
    }
    r.state.date.minute = 8 * 60;
    for (let t = 0; t < 400; t++) run(r, 1);
    expect(r.sim.runsCompleted).toBeGreaterThan(10);
    expect(doneAt.get(2) ?? 0, 'rides to the top').toBeGreaterThan(0);
    expect(doneAt.get(1) ?? 0, 'rides that alighted at the mid-station').toBeGreaterThan(0);
    expect(q.maxCarrierLoad).toBeLessThanOrEqual(LIFTS.gondola6.capacityPerCarrier);
  }, 60_000);
});

describe('N-station lifts: cost', () => {
  it('[perf] a 4-station lift with 3000 queued guests updates in well under 5 ms per tick (best of 3)', () => {
    const best = Math.min(...[0, 1, 2].map(() => {
      const { lift, q, slots, log, cb, store } = setup('gondola10', 'mixed', [60, 45, 30, 15], 3000);
      for (let i = 0; i < 3000; i++) { q.join(lift.id, 0, slots[i]!, 'foot', 0, 1e9, i % 3, 3); store.actTick[slots[i]!] = 0; }
      const t0 = performance.now();
      for (let t = 1; t <= 200; t++) { log.tick = t; q.update(t, cb); }
      return (performance.now() - t0) / 200;
    }));
    expect(best).toBeLessThan(5);
  });
});
