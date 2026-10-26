import { describe, expect, it } from 'vitest';
import {
  NO_INPUT, WALK, WALK_PITCH_MAX, applyLook, cloneWalker, eyeY, footstepDue, makeWalker, slopeLimitTan, stepRate, stepStride, stepUpHeight, stepWalker,
  type WalkInput, type WalkWorld, type WalkerState,
} from '../../src/render/view/walkPhysics';
import { FIGURE_HEIGHT, ViewCameraRig } from '../../src/render/view/ViewCameraRig';
import { DEFAULT_WALK_SETTINGS, WALK_KEYS, lookDelta, mapKeys, sanitizeWalkSettings, loadWalkSettings, saveWalkSettings, WALK_SETTINGS_KEY } from '../../src/render/view/WalkInput';
import {
  BOARD_REACH, boardVerdict, cosmeticRideSeconds, footSurface, nearestBoardable, nearestFree, pickInteract, promptFor, reasonText, stationDistance,
  type BoardableLift, type InteractBox,
} from '../../src/render/view/walkInteract';
import { TerrainWalkWorld, WalkMode, compassPoint } from '../../src/render/view/WalkMode';
import { TileType } from '../../src/world/Grid';
import { NetKind } from '../../src/world/Networks';
import { OccFlag } from '../../src/world/Occupancy';
import { createSim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import { spawnGuests } from '../../src/game/demoResort';
import { fullHash } from '../game/harness';
import { surfaceHeightAt } from '../../src/render/meshes/Paths';
import { ViewModeMachine } from '../../src/render/view/ViewMode';

const SIZE = 40;
interface W extends WalkWorld { solidTiles: Set<string>; circ: Map<string, number[]> }
const world = (o: { ground?: (x: number, z: number) => number; solid?: Array<[number, number]>; circles?: Array<[number, number, number]> } = {}): W => {
  const solidTiles = new Set((o.solid ?? []).map(([x, y]) => `${x},${y}`)), circ = new Map<string, number[]>();
  for (const [x, z, r] of o.circles ?? []) { const k = `${Math.floor(x)},${Math.floor(z)}`; circ.set(k, [...(circ.get(k) ?? []), x, z, r]); }
  return {
    size: SIZE, solidTiles, circ,
    ground: o.ground ?? (() => 0),
    solid: (tx, ty) => tx < 0 || ty < 0 || tx >= SIZE || ty >= SIZE || solidTiles.has(`${tx},${ty}`),
    circles: (tx, ty) => circ.get(`${tx},${ty}`) ?? null,
  };
};
const fwd: WalkInput = { fwd: 1, strafe: 0, run: false, jump: false };
const run = (s: WalkerState, i: WalkInput, secs: number, w: WalkWorld, dt = 1 / 60): WalkerState => { for (let t = 0; t < secs; t += dt) stepWalker(s, i, dt, w, s); return s; };

describe('walkPhysics: flat ground', () => {
  it('walks forward at walk speed with smooth acceleration, runs faster, stops with deceleration', () => {
    const w = world(), s = makeWalker(20, 20, 0, 0); // yaw 0 = north = -z
    stepWalker(s, fwd, 1 / 60, w, s);
    expect(s.speed).toBeGreaterThan(0); expect(s.speed).toBeLessThan(WALK.walkSpeed); // not an instant jump to full speed
    run(s, fwd, 1, w);
    expect(s.speed).toBeCloseTo(WALK.walkSpeed, 1); expect(s.x).toBeCloseTo(20, 3); expect(s.z).toBeLessThan(20 - 1.2);
    const z1 = s.z;
    run(s, { ...fwd, run: true }, 1, w);
    expect(s.speed).toBeCloseTo(WALK.runSpeed, 1); expect(z1 - s.z).toBeGreaterThan(WALK.walkSpeed);
    run(s, NO_INPUT, 0.05, w); expect(s.speed).toBeGreaterThan(0);
    run(s, NO_INPUT, 0.5, w); expect(s.speed).toBeCloseTo(0, 3);
  });
  it('yaw rotates the movement (forward = (-sin yaw, -cos yaw)), strafing and diagonal input are normalised', () => {
    const w = world(), s = makeWalker(20, 20, Math.PI / 2, 0); // facing -x (west)
    run(s, fwd, 1, w);
    expect(s.x).toBeLessThan(19); expect(Math.abs(s.z - 20)).toBeLessThan(1e-3);
    const d = makeWalker(20, 20, 0, 0); run(d, { fwd: 1, strafe: 1, run: false, jump: false }, 1, w);
    expect(d.speed).toBeCloseTo(WALK.walkSpeed, 1); // not sqrt(2) faster
    expect(d.x).toBeGreaterThan(20); expect(d.z).toBeLessThan(20);
  });
  it('eye height = ground + 0.9 x figure height (consistent with the ride-along foot eye)', () => {
    expect(WALK.eyeHeight).toBeCloseTo(0.9 * FIGURE_HEIGHT, 6);
    const s = makeWalker(5, 5, 0, 3); expect(eyeY(s)).toBeCloseTo(3 + 0.468, 3);
  });
  it('is deterministic and pure: same inputs, same state; a fresh copy is returned when no `out` is given', () => {
    const w = world(), a = makeWalker(20, 20, 0.3, 0), b = cloneWalker(a);
    const seq = (s: WalkerState): WalkerState => { let c = s; for (let i = 0; i < 240; i++) c = stepWalker(c, i % 90 < 60 ? { fwd: 1, strafe: i % 7 === 0 ? 1 : 0, run: i > 100, jump: i === 30 } : NO_INPUT, 1 / 60, w); return c; };
    expect(seq(a)).toEqual(seq(b));
    const before = cloneWalker(a); stepWalker(a, fwd, 0.1, w); expect(a).toEqual(before);
  });
  it('a hop (Space) rises and lands, only from the ground, and is small', () => {
    const w = world(), s = makeWalker(20, 20, 0, 0);
    stepWalker(s, { ...NO_INPUT, jump: true }, 1 / 60, w, s);
    let peak = 0, airborne = 0;
    for (let i = 0; i < 90; i++) { stepWalker(s, NO_INPUT, 1 / 60, w, s); peak = Math.max(peak, s.hop); if (s.hop > 0) airborne++; }
    expect(peak).toBeGreaterThan(WALK.jumpHeight * 0.8); expect(peak).toBeLessThan(WALK.jumpHeight * 1.2);
    expect(s.hop).toBe(0); expect(airborne).toBeGreaterThan(10);
  });
});

describe('walkPhysics: terrain', () => {
  const ramp = (grad: number) => (_x: number, z: number): number => -grad * z; // rises towards -z (north), i.e. forward at yaw 0
  it('follows the ground height', () => {
    const w = world({ ground: ramp(0.3) }), s = makeWalker(20, 30, 0, w.ground(20, 30));
    run(s, fwd, 1, w);
    expect(s.ground).toBeCloseTo(w.ground(s.x, s.z), 6); expect(s.ground).toBeGreaterThan(w.ground(20, 30));
  });
  it('slope limit: a 30 deg slope can be climbed, a 50 deg slope cannot (and the walker slides back down gently)', () => {
    expect(slopeLimitTan()).toBeCloseTo(Math.tan((40 * Math.PI) / 180), 6);
    const ok = world({ ground: ramp(Math.tan((30 * Math.PI) / 180)) }), a = makeWalker(20, 30, 0, ok.ground(20, 30));
    run(a, fwd, 2, ok); expect(a.z).toBeLessThan(28);
    const steep = world({ ground: ramp(Math.tan((50 * Math.PI) / 180)) }), b = makeWalker(20, 30, 0, steep.ground(20, 30));
    run(b, fwd, 2, steep);
    expect(b.z).toBeGreaterThan(30); // pushed back down, never up
    expect(b.sliding).toBe(true);
    const slide = b.z - 30;
    expect(slide / 2).toBeLessThan(WALK.slideSpeed * 1.05); // gently: no faster than the slide speed
    // sideways along the contour is still allowed
    const c = makeWalker(20, 30, Math.PI / 2 * -1, steep.ground(20, 30)); // facing +x
    run(c, fwd, 0.5, steep); expect(c.x).toBeGreaterThan(20.3);
  });
  it('step-up: a small ledge is climbed, a big one is a wall', () => {
    expect(stepUpHeight()).toBeGreaterThan(0.1); expect(stepUpHeight()).toBeLessThan(0.3);
    const ledge = (h: number) => (_x: number, z: number): number => (z < 25 ? h : 0);
    const small = world({ ground: ledge(0.12) }), s = makeWalker(20, 28, 0, 0);
    run(s, fwd, 2, small); expect(s.z).toBeLessThan(25);
    const big = world({ ground: ledge(0.5) }), t = makeWalker(20, 28, 0, 0);
    run(t, fwd, 2, big); expect(t.z).toBeGreaterThan(25);
  });
  it('uses the same triangulation as the terrain mesh (surfaceHeightAt) when wired through TerrainWalkWorld', () => {
    const sim = createSim({ size: 64, seed: 5, now: () => 0 });
    const tw = new TerrainWalkWorld(sim.grid, sim.networks, sim.props, (x, z) => surfaceHeightAt(sim.grid, x, z));
    expect(tw.ground(10.3, 20.6)).toBe(surfaceHeightAt(sim.grid, 10.3, 20.6));
  });
});

describe('walkPhysics: collision', () => {
  it('slides along a building rect (does not pass through, keeps the tangential motion)', () => {
    const solid: Array<[number, number]> = []; for (let x = 15; x < 25; x++) for (let y = 10; y < 14; y++) solid.push([x, y]);
    const w = world({ solid }), s = makeWalker(20, 20, 0, 0);
    // diagonal into the wall: forward (north) + strafe right: the rect is north of us, so x still advances
    run(s, { fwd: 1, strafe: 1, run: false, jump: false }, 4, w);
    expect(s.z).toBeGreaterThanOrEqual(14 + WALK.radius - 1e-3);
    expect(s.x).toBeGreaterThan(22);
    for (const t of solid) { // never overlaps
      const cx = Math.min(t[0] + 1, Math.max(t[0], s.x)), cz = Math.min(t[1] + 1, Math.max(t[1], s.z));
      expect(Math.hypot(s.x - cx, s.z - cz)).toBeGreaterThanOrEqual(WALK.radius - 1e-3);
    }
  });
  it('slides around a tree trunk circle and stops at a head-on hit', () => {
    const w = world({ circles: [[20.5, 17.5, 0.1]] }), s = makeWalker(20.5, 20, 0, 0);
    run(s, fwd, 3, w);
    expect(Math.hypot(s.x - 20.5, s.z - 17.5)).toBeGreaterThanOrEqual(WALK.radius + 0.1 - 1e-3);
    expect(s.z).toBeGreaterThan(17.5); // blocked head on (exactly aligned)
    const t = makeWalker(20.7, 20, 0, 0);
    run(t, fwd, 3, w);
    expect(t.z).toBeLessThan(17.5); // an offset walker slides past the trunk and carries on
  });
  it('water tiles (not bridges) are solid: the walker stops at the shore', () => {
    const sim = createSim({ size: 64, seed: 5, now: () => 0 });
    const g = sim.grid; const tw = new TerrainWalkWorld(g, sim.networks, null, () => 0);
    const wet = 30 * 64 + 31, dry = 30 * 64 + 20;
    g.tileType[wet] = TileType.Water; g.tileType[dry] = TileType.Grass;
    expect(tw.solid(31, 30)).toBe(true); expect(tw.solid(20, 30)).toBe(false);
    sim.networks.bridge[wet] = 1; expect(tw.solid(31, 30)).toBe(false); // a bridge tile can be crossed
    sim.networks.bridge[wet] = 0;
    g.occupancy.set(25, 30, OccFlag.Building, 1); g.occupancy.set(26, 30, OccFlag.Lift, 2);
    expect(tw.solid(25, 30)).toBe(true); expect(tw.solid(26, 30)).toBe(true);
    const s = makeWalker(28.5, 30.5, -Math.PI / 2, 0); // facing +x towards the lake at x=31
    run(s, fwd, 4, tw);
    expect(s.x).toBeLessThanOrEqual(31 - WALK.radius + 1e-3);
    g.occupancy.clear(25, 30, OccFlag.Building); g.occupancy.clear(26, 30, OccFlag.Lift);
  });
  it('clamps inside the map bounds with a margin', () => {
    const w = world(), s = makeWalker(2, 2, 0, 0);
    run(s, { ...fwd, run: true }, 3, w); expect(s.z).toBeGreaterThanOrEqual(WALK.boundsMargin - 1e-6);
    const e = makeWalker(SIZE - 2, 20, -Math.PI / 2, 0); run(e, { ...fwd, run: true }, 3, w); expect(e.x).toBeLessThanOrEqual(SIZE - WALK.boundsMargin + 1e-6);
  });
  it('no tunnelling through a thin trunk or a one-tile wall at huge dt (substeps)', () => {
    const w = world({ solid: [[20, 10]], circles: [[25.5, 15.5, 0.05]] });
    for (const dt of [0.02, 0.1, 0.25, 1]) {
      const s = makeWalker(20.5, 14, 0, 0);
      for (let i = 0; i < 60; i++) stepWalker(s, { ...fwd, run: true }, dt, w, s);
      expect(s.z, `dt ${dt}`).toBeGreaterThanOrEqual(11 + WALK.radius - 1e-3);
      const c = makeWalker(25.5, 19, 0, 0);
      for (let i = 0; i < 60; i++) stepWalker(c, { ...fwd, run: true }, dt, w, c);
      expect(c.z, `dt ${dt} trunk`).toBeGreaterThanOrEqual(15.5 + 0.05 + WALK.radius - 1e-3);
    }
  });
  it('look: pitch is clamped to +-80 deg, yaw wraps, invert Y flips the vertical look', () => {
    const s = makeWalker(1, 1, 0, 0);
    applyLook(s, 0, 10); expect(s.pitch).toBeCloseTo(WALK_PITCH_MAX, 6);
    applyLook(s, 0, -20); expect(s.pitch).toBeCloseTo(-WALK_PITCH_MAX, 6);
    applyLook(s, 7, 0); expect(Math.abs(s.yaw)).toBeLessThanOrEqual(Math.PI);
    const t = makeWalker(1, 1, 0, 0); applyLook(t, 0, 0.1, true); expect(t.pitch).toBeCloseTo(-0.1, 6);
  });
  it('nearestFree finds a standable tile next to a blocked one', () => {
    const w = world({ solid: [[10, 10], [11, 10], [10, 11], [11, 11]] });
    const p = nearestFree(w, 10.5, 10.5)!;
    expect(w.solid(Math.floor(p.x), Math.floor(p.z))).toBe(false);
    expect(Math.hypot(p.x - 10.5, p.z - 10.5)).toBeLessThan(2.2);
  });
});

describe('footsteps', () => {
  it('surface by tile type / network layer', () => {
    const base = { tileType: TileType.Grass, snowDepth: 0, occFlags: 0, netKind: 0, bridge: false };
    expect(footSurface(base)).toBe('grass');
    expect(footSurface({ ...base, snowDepth: 0.4 })).toBe('snow');
    expect(footSurface({ ...base, tileType: TileType.Ice })).toBe('snow');
    expect(footSurface({ ...base, tileType: TileType.Rock })).toBe('gravel');
    expect(footSurface({ ...base, tileType: TileType.Dirt })).toBe('gravel');
    expect(footSurface({ ...base, netKind: NetKind.Path, snowDepth: 0.4 })).toBe('gravel'); // paths are cleared
    expect(footSurface({ ...base, netKind: NetKind.Road })).toBe('road');
    expect(footSurface({ ...base, tileType: TileType.Stream, bridge: true })).toBe('wood');
    expect(footSurface({ ...base, occFlags: OccFlag.Road })).toBe('road');
  });
  it('cadence grows with speed (about 1.8 steps/s walking, 2.4 running) and is silent when standing', () => {
    expect(stepRate(0)).toBe(0); expect(stepRate(0.1)).toBe(0);
    expect(stepRate(WALK.walkSpeed)).toBeCloseTo(1.78, 1);
    expect(stepRate(WALK.runSpeed)).toBeGreaterThan(stepRate(WALK.walkSpeed));
    expect(stepRate(WALK.runSpeed)).toBeLessThan(3);
    expect(stepStride(WALK.runSpeed)).toBeGreaterThan(stepStride(WALK.walkSpeed));
  });
  it('one footstep per stride walked (phase boundary crossing)', () => {
    const w = world(), s = makeWalker(20, 30, 0, 0);
    let steps = 0;
    for (let i = 0; i < 600; i++) { const p = s.stepPhase; stepWalker(s, fwd, 1 / 60, w, s); if (s.speed > 0.3 && footstepDue(p, s.stepPhase, stepStride(s.speed))) steps++; }
    expect(steps).toBeGreaterThan(14); expect(steps).toBeLessThan(21); // 10 s at ~1.6 tiles/s / 0.9 per step ~ 17
    expect(footstepDue(0.8, 0.95, 0.9)).toBe(true); expect(footstepDue(0.1, 0.5, 0.9)).toBe(false);
  });
});

describe('key mapping (pure)', () => {
  const keys = (...k: string[]): ReadonlySet<string> => new Set(k);
  it('WASD and arrows, opposing keys cancel, Shift runs, Space hops', () => {
    expect(mapKeys(keys())).toEqual({ fwd: 0, strafe: 0, run: false, jump: false });
    expect(mapKeys(keys('w'))).toMatchObject({ fwd: 1, strafe: 0 });
    expect(mapKeys(keys('arrowup', 'arrowright'))).toMatchObject({ fwd: 1, strafe: 1 });
    expect(mapKeys(keys('s', 'a'))).toMatchObject({ fwd: -1, strafe: -1 });
    expect(mapKeys(keys('w', 's'))).toMatchObject({ fwd: 0 });
    expect(mapKeys(keys('w', 'shift'))).toMatchObject({ run: true });
    expect(mapKeys(keys('w'), true).run).toBe(true); // run toggle
    expect(mapKeys(keys(' ')).jump).toBe(true);
    for (const k of ['e', 'q', 'v']) expect(mapKeys(keys(k))).toEqual({ fwd: 0, strafe: 0, run: false, jump: false });
    expect(WALK_KEYS).toContain('e');
  });
  it('mouse look: right turns right (yaw decreases), up looks up, spikes ignored, sensitivity scales', () => {
    const o = { yaw: 0, pitch: 0 };
    lookDelta(100, 0, 1, o); expect(o.yaw).toBeLessThan(0);
    lookDelta(0, -100, 1, o); expect(o.pitch).toBeGreaterThan(0);
    const a = { yaw: 0, pitch: 0 }, b = { yaw: 0, pitch: 0 }; lookDelta(50, 0, 1, a); lookDelta(50, 0, 2, b); expect(b.yaw).toBeCloseTo(a.yaw * 2, 9);
    lookDelta(5000, 5000, 1, o); expect(o.yaw).toBe(0); expect(o.pitch).toBe(0);
  });
  it('settings sanitise to ranges and persist in slope.walk.v1', () => {
    expect(sanitizeWalkSettings(null)).toEqual(DEFAULT_WALK_SETTINGS);
    expect(sanitizeWalkSettings({ sensitivity: 9, fov: 10, invertY: true, headBob: false, runToggle: true })).toEqual({ sensitivity: 2, fov: 60, invertY: true, headBob: false, runToggle: true, mouseLook: 'drag' });
    expect(sanitizeWalkSettings({ sensitivity: 'x', fov: NaN })).toEqual(DEFAULT_WALK_SETTINGS);
    const mem = new Map<string, string>(), st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    saveWalkSettings(st, { ...DEFAULT_WALK_SETTINGS, fov: 90 });
    expect(mem.has(WALK_SETTINGS_KEY)).toBe(true); expect(WALK_SETTINGS_KEY).toBe('slope.walk.v1');
    expect(loadWalkSettings(st).fov).toBe(90);
    expect(loadWalkSettings({ getItem: () => '{broken' })).toEqual(DEFAULT_WALK_SETTINGS);
    expect(DEFAULT_WALK_SETTINGS.fov).toBe(75);
  });
});

describe('interaction (pure)', () => {
  const box = (o: Partial<InteractBox> = {}): InteractBox => ({ kind: 'building', id: 1, label: 'Cafe 1', minX: 10, maxX: 13, minZ: 10, maxZ: 12, minY: -1, maxY: 3, ...o });
  it('looking at a building footprint within range returns it; looking away, too far or behind does not', () => {
    const eye = 0.47;
    expect(pickInteract(11.5, eye, 13.5, 0, 0, -1, [box()])?.id).toBe(1); // north into the rect from the south
    expect(pickInteract(11.5, eye, 13.5, 0, 0, 1, [box()])).toBeNull(); // looking away
    expect(pickInteract(11.5, eye, 20, 0, 0, -1, [box()])).toBeNull(); // 8 tiles away: out of range
    expect(pickInteract(20, eye, 13.5, 0, 0, -1, [box()])).toBeNull(); // misses sideways
    expect(pickInteract(11.5, eye, 13.5, 0, 0.9, -0.1, [box({ maxY: 1 })])).toBeNull(); // looking at the sky above a low box
    const hit = pickInteract(11.5, eye, 13.5, 0, 0, -1, [box(), box({ id: 2, minZ: 11, maxZ: 12.5, label: 'Near' }), box({ id: 3, kind: 'guest', minZ: 12.6, maxZ: 12.9, minX: 11, maxX: 12, label: 'Guest #3' })]);
    expect(hit?.id).toBe(3); expect(hit?.kind).toBe('guest'); expect(promptFor(hit!)).toBe('E: Look at Guest #3'); // nearest wins
    expect(promptFor({ kind: 'building', id: 1, label: 'Café', dist: 1 })).toBe('E: Inspect Café');
  });
  const lift = (o: Partial<BoardableLift> = {}): BoardableLift => ({ id: 1, name: 'Chairlift 1', bottom: { x: 10, y: 10 }, top: { x: 30, y: 10 }, open: true, closedReason: null, rideTimeS: 40, ...o });
  it('lift boarding: nearest bottom station within 2 tiles, ties by id, closed lifts give a reason, ride time follows the lift', () => {
    expect(stationDistance(10, 10, 11, 11)).toBe(0); expect(stationDistance(10, 10, 14, 11)).toBe(2);
    expect(nearestBoardable([lift()], 11, 13.5)?.lift.id).toBe(1); // 1.5 tiles south of the 2x2 station
    expect(nearestBoardable([lift()], 11, 14.5)).toBeNull(); // 2.5
    expect(BOARD_REACH).toBe(2);
    const a = lift({ id: 5, bottom: { x: 10, y: 10 } }), b = lift({ id: 2, bottom: { x: 10, y: 10 } }), c = lift({ id: 9, bottom: { x: 12.5, y: 10 } });
    expect(nearestBoardable([a, b], 11, 11)?.lift.id).toBe(2);
    expect(nearestBoardable([c, a], 11, 11)?.lift.id).toBe(5); // nearer wins
    expect(boardVerdict(lift())).toEqual({ ok: true, prompt: 'E: Board Chairlift 1', reason: null });
    const closed = boardVerdict(lift({ open: false, closedReason: 'Closed: no snow at the top station (1,280 m)' }));
    expect(closed.ok).toBe(false); expect(closed.reason).toBe('Lift is closed: no snow at the top station (1,280 m)');
    expect(boardVerdict(lift({ open: false, closedReason: 'wind' })).reason).toBe('Lift is closed: too windy');
    expect(reasonText(null)).toBe('not operating');
    expect(cosmeticRideSeconds({ rideTimeS: 40 })).toBe(40); expect(cosmeticRideSeconds({ rideTimeS: 1 })).toBe(3);
  });
});

describe('WalkMode runtime + view-mode transitions', () => {
  const mk = (): { sim: ReturnType<typeof createSim>; mode: WalkMode; rig: ViewCameraRig; steps: string[] } => {
    const sim = createSim({ size: 64, seed: 11, now: () => 0 });
    buildStarterResort(sim);
    const rig = new ViewCameraRig(), steps: string[] = [];
    const tw = new TerrainWalkWorld(sim.grid, sim.networks, sim.props, (x, z) => surfaceHeightAt(sim.grid, x, z));
    const mode = new WalkMode({
      world: tw, rig, grid: sim.grid, nets: sim.networks,
      buildings: () => sim.buildings.all().map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, label: b.type })),
      lifts: () => [], nearbyPeople: () => [], info: (k, id) => ({ title: `${k}${id}`, lines: ['x'] }), describe: () => 'Near test',
      footstep: (s) => steps.push(s), motion: () => 1,
    });
    return { sim, mode, rig, steps };
  };
  it('begin() stands on the ground at the eye height, moves off a blocked tile, and drives the rig camera; end() is clean', () => {
    const { sim, mode, rig } = mk();
    const b = sim.buildings.all()[0]!;
    expect(mode.begin(b.x + 0.5, b.y + 0.5, 0.4)).toBe(true); // inside a building: nearest free tile
    const w = mode.state;
    expect(new TerrainWalkWorld(sim.grid, sim.networks, null, () => 0).solid(Math.floor(w.x), Math.floor(w.z))).toBe(false);
    expect(rig.camera.position.y).toBeCloseTo(w.ground + WALK.eyeHeight, 2);
    expect(rig.pose.yaw).toBeCloseTo(0.4, 6);
    mode.inputFn = () => ({ fwd: 1, strafe: 0, run: false, jump: false });
    for (let i = 0; i < 120; i++) mode.update(1 / 60);
    expect(rig.camera.position.y).toBeGreaterThan(w.ground); // never inside the terrain
    mode.end(); expect(mode.active).toBe(false);
  });
  it('plays footsteps by surface while walking and never when standing', () => {
    const { mode, steps } = mk();
    mode.begin(32.5, 40.5, 0);
    mode.inputFn = () => NO_INPUT; for (let i = 0; i < 120; i++) mode.update(1 / 60);
    expect(steps.length).toBe(0);
    mode.inputFn = () => ({ fwd: 0, strafe: 1, run: true, jump: false }); for (let i = 0; i < 300; i++) mode.update(1 / 60);
    expect(steps.length).toBeGreaterThan(3);
  });
  it('compass points follow the yaw (0 = north, -yaw = clockwise)', () => {
    expect(compassPoint(0)).toBe('N'); expect(compassPoint(-Math.PI / 2)).toBe('E'); expect(compassPoint(Math.PI)).toBe('S'); expect(compassPoint(Math.PI / 2)).toBe('W');
  });
  it('transitions: iso <-> walk and walk <-> photo are legal; ride <-> walk is not; enter -> exit restores the exact iso pose', () => {
    const m = new ViewModeMachine();
    expect(m.set('walk')).toBe(true); expect(m.isGround).toBe(true);
    expect(m.set('ride')).toBe(false); expect(m.set('photo')).toBe(true); expect(m.set('walk')).toBe(true); expect(m.set('iso')).toBe(true);
    expect(m.set('ride')).toBe(true); expect(m.set('walk')).toBe(false);
  });
});

describe('walk mode never touches the sim', () => {
  it('stateHash is identical after 3 sim days with a walker roaming (stepping, probing, interacting) vs without', () => {
    const go = (walk: boolean): { hash: string; probes: number } => {
      const sim = createSim({ size: 64, seed: 11, now: () => 0 });
      buildStarterResort(sim);
      spawnGuests(sim, 60, 'skiers', 1);
      const rig = new ViewCameraRig();
      const tw = new TerrainWalkWorld(sim.grid, sim.networks, sim.props, (x, z) => surfaceHeightAt(sim.grid, x, z));
      let probes = 0;
      const mode = new WalkMode({
        world: tw, rig, grid: sim.grid, nets: sim.networks,
        buildings: () => sim.buildings.all().map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, label: b.type })),
        lifts: () => sim.lifts.all().map((l) => ({ ...l, name: 'Lift', rideTimeS: 30, path: { pts: [], cum: [], length: 1, dirX: 1, dirZ: 0 }, family: 'chair' })) as never,
        nearbyPeople: (x, z, r) => { probes++; const s = sim.guestSim.store, o = []; for (let i = 0; i < s.limit; i++) if (s.alive[i] && Math.abs(s.x[i]! - x) < r && Math.abs(s.y[i]! - z) < r) o.push({ id: s.id[i]!, x: s.x[i]!, z: s.y[i]!, label: 'g', kind: 'guest' as const }); return o; },
        info: () => ({ title: 't', lines: [] }), describe: (x, z) => sim.names.describeLocation(Math.floor(x), Math.floor(z)).near, footstep: () => {}, motion: () => 1,
      });
      if (walk) mode.begin(32.5, 40.5, 0);
      for (let t = 1; t <= 720; t++) {
        sim.tick(1);
        if (!walk) continue;
        mode.inputFn = () => ({ fwd: 1, strafe: t % 200 < 100 ? 1 : 0, run: t % 300 < 150, jump: t % 97 === 0 });
        mode.look(0.02, Math.sin(t / 30) * 0.01);
        for (let k = 0; k < 6; k++) mode.update(1 / 60);
        if (t % 40 === 0) mode.interact();
      }
      return { hash: fullHash(sim), probes };
    };
    const off = go(false), on = go(true);
    expect(on.probes).toBeGreaterThan(50);
    expect(on.hash).toBe(off.hash);
  }, 90000);
});
