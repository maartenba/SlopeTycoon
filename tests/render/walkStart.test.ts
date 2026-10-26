import { describe, expect, it } from 'vitest';
import { chooseStart, nearestStandable, pathDirection, resolveDrop, spawnPoint, tileStandable, yawToward } from '../../src/render/view/walkStart';
import { WALK, makeWalker, standable, stepWalker, settle, type WalkWorld } from '../../src/render/view/walkPhysics';
import { buildWalkWorld, decorCircles, softPush, WalkMode, PERSONAL_SPACE } from '../../src/render/view/WalkMode';
import { ViewCameraRig } from '../../src/render/view/ViewCameraRig';
import { layoutVillage } from '../../src/render/VillageDecor';
import { NetKind } from '../../src/world/Networks';
import { surfaceHeightAt } from '../../src/render/meshes/Paths';
import { makeResort } from '../game/harness';
import { fullHash } from '../game/harness';
import { createSim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';

const SIZE = 40;
const mk = (o: { solid?: Array<[number, number]>; circles?: Array<[number, number, number]> } = {}): WalkWorld => {
  const solid = new Set((o.solid ?? []).map(([x, y]) => `${x},${y}`)), circ = new Map<string, number[]>();
  for (const [x, z, r] of o.circles ?? []) { const k = `${Math.floor(x)},${Math.floor(z)}`; circ.set(k, [...(circ.get(k) ?? []), x, z, r]); }
  return { size: SIZE, ground: () => 0, solid: (tx, ty) => tx < 0 || ty < 0 || tx >= SIZE || ty >= SIZE || solid.has(`${tx},${ty}`), circles: (tx, ty) => circ.get(`${tx},${ty}`) ?? null };
};
const net = (tiles: Array<[number, number, number]>): Uint8Array => { const a = new Uint8Array(SIZE * SIZE); for (const [x, y, k] of tiles) a[y * SIZE + x] = k; return a; };

describe('chooseStart (synthetic)', () => {
  it('picks the nearest standable footpath tile, prefers a footpath to a slightly nearer road, skips blocked tiles', () => {
    const w = mk({ solid: [[10, 10]] });
    const nk = net([[10, 10, NetKind.Path], [12, 10, NetKind.Path], [11, 10, NetKind.Road]]);
    const r = chooseStart(w, { focus: { x: 10.5, z: 10.5 }, netKind: nk });
    expect(r.source).toBe('path'); expect(r.x).toBe(12.5); expect(r.z).toBe(10.5);
  });
  it('a road is used when it is the only thing around; rail never is', () => {
    const w = mk();
    expect(chooseStart(w, { focus: { x: 20, z: 20 }, netKind: net([[22, 20, NetKind.Road]]) }).source).toBe('road');
    const r = chooseStart(w, { focus: { x: 20, z: 20 }, netKind: net([[21, 20, NetKind.Rail]]) });
    expect(r.source).toBe('ring'); // no path / road, no lodge: the nearest free tile to the centre
  });
  it('falls back to the lodge door when no path is within the radius, and to the village centre without paths or a lodge', () => {
    const w = mk({ solid: [[18, 18], [19, 18], [18, 19], [19, 19]] });
    const lodge = { x: 18, y: 18, w: 2, h: 2 };
    const far = net([[2, 2, NetKind.Path]]);
    const a = chooseStart(w, { focus: { x: 30, z: 30 }, netKind: far, lodge, radius: 10 });
    expect(a.source).toBe('lodge'); expect(w.solid(Math.floor(a.x), Math.floor(a.z))).toBe(false); expect(a.z).toBeGreaterThan(19);
    const b = chooseStart(w, { focus: { x: 30, z: 30 }, netKind: null, centre: { x: 25, z: 25 } });
    expect(b.source).toBe('ring'); expect(Math.hypot(b.x - 25, b.z - 25)).toBeLessThan(1);
  });
  it('never stands inside a trunk / a solid tile: a path tile blocked by a tree is skipped', () => {
    const w = mk({ circles: [[10.5, 10.5, 0.3]] });
    const r = chooseStart(w, { focus: { x: 10.5, z: 10.5 }, netKind: net([[10, 10, NetKind.Path], [13, 10, NetKind.Path]]) });
    expect(r.x).toBe(13.5); expect(standable(w, r.x, r.z)).toBe(true);
  });
  it('faces the nearest building (2..14 tiles away), else along the path; deterministic', () => {
    const w = mk();
    const nk = net([[10, 20, NetKind.Path], [11, 20, NetKind.Path], [12, 20, NetKind.Path], [13, 20, NetKind.Path]]);
    const a = chooseStart(w, { focus: { x: 10.5, z: 20.5 }, netKind: nk, buildings: [{ x: 10, y: 14, w: 2, h: 2 }] });
    expect(a.yaw).toBeCloseTo(yawToward(0, -5), 0); // looking north at the building
    const b = chooseStart(w, { focus: { x: 10.5, z: 20.5 }, netKind: nk });
    expect(Math.abs(Math.sin(b.yaw))).toBeCloseTo(1, 5); // along the east-west path
    expect(chooseStart(w, { focus: { x: 10.5, z: 20.5 }, netKind: nk, buildings: [{ x: 10, y: 14, w: 2, h: 2 }] })).toEqual(a);
    expect(pathDirection(nk, SIZE, 10, 20)).toEqual({ x: 1, z: 0 });
  });
});

describe('chooseStart on real maps: 20 seeds x sizes, with a footpath laid from the lodge', () => {
  const run = (size: 64 | 128, seed: number): void => {
    const { sim } = makeResort(size, seed);
    const lodge = sim.buildings.all().find((b) => b.type === 'baseLodge');
    if (lodge) for (let k = 0; k < 14; k++) { const x = lodge.x + (k % 4), y = lodge.y + lodge.h + 1 + Math.floor(k / 4); if (sim.networks.inBounds(x, y)) sim.networks.build(NetKind.Path, x, y); }
    const world = buildWalkWorld(sim.grid, sim.networks, sim.props, (x, z) => surfaceHeightAt(sim.grid, x, z));
    const lodgeRect = lodge ? { x: lodge.x, y: lodge.y, w: lodge.w, h: lodge.h } : null;
    for (const f of [{ x: size / 2, z: size / 2 }, { x: 3, z: 3 }, { x: size - 3, z: size - 3 }, lodge ? { x: lodge.x + 1, z: lodge.y + 1 } : { x: 10, z: 10 }]) {
      const o = { focus: f, netKind: sim.networks.kind, lodge: lodgeRect, buildings: sim.buildings.all().map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })) };
      const r = chooseStart(world, o);
      expect(r.source, `${size}/${seed}`).not.toBe('none');
      expect(world.solid(Math.floor(r.x), Math.floor(r.z)), `${size}/${seed} solid`).toBe(false);
      expect(standable(world, r.x, r.z), `${size}/${seed} standable`).toBe(true);
      expect(r.x).toBeGreaterThan(WALK.boundsMargin); expect(r.x).toBeLessThan(size - WALK.boundsMargin);
      expect(Number.isFinite(r.yaw)).toBe(true);
      expect(chooseStart(world, o)).toEqual(r); // deterministic
      if (r.source === 'path' || r.source === 'road') expect([NetKind.Path, NetKind.Road]).toContain(sim.networks.kind[Math.floor(r.z) * size + Math.floor(r.x)]);
    }
    // a path tile near the lodge exists: the default entry from the lodge is on it
    if (lodge) {
      const r = chooseStart(world, { focus: { x: lodge.x + 1.5, z: lodge.y + lodge.h + 2 }, netKind: sim.networks.kind, lodge: lodgeRect });
      expect(['path', 'road']).toContain(r.source);
    }
  };
  it('size 64, seeds 1..20', () => { for (let s = 1; s <= 20; s++) run(64, s); }, 180000);
  it('size 128, seeds 101..105', () => { for (let s = 101; s <= 105; s++) run(128, s); }, 180000);
});

describe('drop mode validity (resolveDrop)', () => {
  const w = mk({ solid: [[10, 10], [11, 10]], circles: [[15.5, 15.5, 0.3]] });
  it('a free tile is ok (green) and not snapped', () => {
    expect(resolveDrop(w, 20.3, 20.7)).toEqual({ ok: true, x: 20.5, z: 20.5, snapped: false, valid: true });
  });
  it('a solid tile is blocked (red) and snaps to the nearest free tile centre', () => {
    const r = resolveDrop(w, 10.5, 10.5);
    expect(r.ok).toBe(false); expect(r.snapped).toBe(true); expect(r.valid).toBe(true);
    expect(w.solid(Math.floor(r.x), Math.floor(r.z))).toBe(false); expect(tileStandable(w, Math.floor(r.x), Math.floor(r.z))).toBe(true);
    expect(Math.hypot(r.x - 10.5, r.z - 10.5)).toBeLessThan(1.5);
  });
  it('a tile under a trunk is blocked too; the map edge is blocked', () => {
    expect(resolveDrop(w, 15.5, 15.5).ok).toBe(false);
    expect(resolveDrop(w, 0.5, 0.5).ok).toBe(false);
    const r = resolveDrop(w, 0.5, 0.5); expect(r.valid).toBe(true); expect(standable(w, r.x, r.z)).toBe(true);
  });
  it('nothing free within range = invalid (no drop)', () => {
    const all = mk(); const full: WalkWorld = { ...all, solid: () => true };
    expect(resolveDrop(full, 5, 5).valid).toBe(false); expect(nearestStandable(full, 5, 5, 4)).toBeNull();
  });
  it('spawnPoint settles into a legal point (nearest free tile) and is deterministic', () => {
    const p = spawnPoint(w, 10.5, 10.5)!; expect(standable(w, p.x, p.z)).toBe(true);
    expect(spawnPoint(w, 10.5, 10.5)).toEqual(p);
  });
});

describe('spawn push-out: no speed spike, no stray footstep', () => {
  it('settle() resolves an overlap; stepping from an overlapping state reports ~0 speed (push-outs are not walked distance)', () => {
    const w = mk({ circles: [[20.1, 20.1, 0.3]] });
    expect(standable(w, 20.2, 20.2)).toBe(false);
    const s = makeWalker(20.2, 20.2);
    stepWalker(s, { fwd: 0, strafe: 0, run: false, jump: false }, 1 / 60, w, s);
    expect(s.speed).toBeLessThan(0.05); expect(s.stepPhase).toBeLessThan(0.01);
    expect(standable(w, s.x, s.z)).toBe(true);
    expect(settle(w, 20.2, 20.2).moved).toBeGreaterThan(0.1);
  });
  it('WalkMode.begin next to a wall / trunk: first frames have ~0 speed and no footstep', () => {
    const w = mk({ solid: [[20, 19]], circles: [[21.3, 20.5, 0.1]] });
    let steps = 0;
    const tw = Object.assign(w, { refresh: () => {} });
    const mode = new WalkMode({
      world: tw as never, rig: new ViewCameraRig(), grid: { size: SIZE, tileType: new Uint8Array(SIZE * SIZE), snowDepth: new Float32Array(SIZE * SIZE), occupancy: { flags: new Uint8Array(SIZE * SIZE) } } as never, nets: null,
      buildings: () => [], lifts: () => [], nearbyPeople: () => [], info: () => null, describe: () => 'x', footstep: () => { steps++; }, motion: () => 1,
    });
    expect(mode.begin(20.5, 19.4, 0)).toBe(true);
    mode.inputFn = () => ({ fwd: 0, strafe: 0, run: false, jump: false });
    let max = 0; for (let i = 0; i < 60; i++) { mode.update(1 / 60); max = Math.max(max, mode.state.speed); }
    expect(max).toBeLessThan(0.05); expect(steps).toBe(0);
  });
});

describe('collision: decor (lamps, benches, planters, hedges) and bridges', () => {
  const items = layoutVillage({ x: 20, y: 20, w: 4, h: 3 }, { size: 64, blocked: () => false });
  it('decorCircles covers lamp / bench / planter / shrub items and ignores flat decor', () => {
    const c = decorCircles(items);
    const solidKinds = items.filter((i) => ['lamp', 'bench', 'planter', 'shrub'].includes(i.kind)).length;
    expect(c.length).toBeGreaterThanOrEqual(solidKinds); expect(solidKinds).toBeGreaterThan(8);
    expect(decorCircles([{ kind: 'path', x: 1, z: 1, ry: 0 }, { kind: 'lot', x: 1, z: 1, ry: 0 }, { kind: 'stall', x: 1, z: 1, ry: 0 }])).toEqual([]);
  });
  it('the real world blocks walking through a lamp post and a bench (slides, never passes through)', () => {
    const { sim } = makeResort(64, 7);
    const lodge = sim.buildings.all().find((b) => b.type === 'baseLodge')!;
    const dec = layoutVillage({ x: lodge.x, y: lodge.y, w: lodge.w, h: lodge.h }, { size: 64, blocked: () => false });
    const lamp = dec.find((d) => d.kind === 'lamp')!;
    const world = buildWalkWorld(sim.grid, sim.networks, sim.props, () => 0, () => dec);
    const circles = world.circles(Math.floor(lamp.x), Math.floor(lamp.z))!;
    expect(circles).toBeTruthy(); expect(circles.length % 3).toBe(0);
    // walk straight at the lamp from the south: stops outside lamp radius + walker radius
    const s = makeWalker(lamp.x, lamp.z + 1.5, 0, 0);
    for (let i = 0; i < 180; i++) stepWalker(s, { fwd: 1, strafe: 0, run: false, jump: false }, 1 / 60, world, s);
    const d = Math.hypot(s.x - lamp.x, s.z - lamp.z);
    expect(d).toBeGreaterThanOrEqual(WALK.radius + 0.08 - 0.02);
  });
  it('a bench blocks the walker (3 circles along its length): spawning in it pushes out to a legal spot', () => {
    const cs = decorCircles([{ kind: 'bench', x: 20.9, z: 24.4, ry: Math.PI / 2 }]);
    const w = mk({ circles: cs.map(([x, z, r]) => [x!, z!, r!] as [number, number, number]) });
    const t = makeWalker(20.9, 24.4, 0, 0); stepWalker(t, { fwd: 0, strafe: 0, run: false, jump: false }, 1 / 60, w, t);
    expect(standable(w, t.x, t.z)).toBe(true); expect(Math.hypot(t.x - 20.9, t.z - 24.4)).toBeGreaterThan(0.3);
    expect(t.speed).toBeLessThan(0.05);
  });
  it('a bridge makes a stream tile walkable; without it the tile is solid', () => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0 });
    const g = sim.grid; let i = -1;
    for (let k = 0; k < g.tileType.length; k++) if (g.tileType[k] === 6) { i = k; break; }
    expect(i).toBeGreaterThanOrEqual(0);
    const tx = i % 64, ty = Math.floor(i / 64);
    const world = buildWalkWorld(g, sim.networks, sim.props, () => 0);
    expect(world.solid(tx, ty)).toBe(true);
    sim.networks.bridge[i] = 1;
    expect(world.solid(tx, ty)).toBe(false);
  });
  it('farm / pasture fences live inside the building footprint (solid tiles)', () => {
    const sim = createSim({ size: 64, seed: 3, now: () => 0 }); buildStarterResort(sim);
    const b = sim.buildings.all()[0]!;
    const world = buildWalkWorld(sim.grid, sim.networks, sim.props, () => 0);
    expect(world.solid(b.x, b.y)).toBe(true); expect(world.solid(b.x + b.w - 1, b.y + b.h - 1)).toBe(true);
  });
});

describe('soft push away from guests / animals', () => {
  it('pushes the walker out of personal space, softly (<= maxMove), and not at all beyond it', () => {
    const s = { x: 10, z: 10 };
    expect(softPush(s, [{ x: 10.1, z: 10 }], PERSONAL_SPACE, 0.05)).toBeCloseTo(0.05, 6); expect(s.x).toBeLessThan(10);
    const t = { x: 10, z: 10 }; expect(softPush(t, [{ x: 12, z: 10 }], PERSONAL_SPACE, 1)).toBe(0); expect(t).toEqual({ x: 10, z: 10 });
    const u = { x: 10, z: 10 }; softPush(u, [{ x: 10.2, z: 10 }, { x: 9.8, z: 10 }], PERSONAL_SPACE, 1); expect(Math.hypot(u.x - 10, u.z - 10)).toBeLessThan(1e-6); // opposite pushes cancel
  });
});

describe('start position never touches the sim', () => {
  it('stateHash is identical with a default-entry walker standing around vs none', () => {
    const go = (walk: boolean): string => {
      const sim = createSim({ size: 64, seed: 11, now: () => 0 }); buildStarterResort(sim);
      const world = buildWalkWorld(sim.grid, sim.networks, sim.props, (x, z) => surfaceHeightAt(sim.grid, x, z));
      if (walk) { const r = chooseStart(world, { focus: { x: 32, z: 32 }, netKind: sim.networks.kind }); makeWalker(r.x, r.z, r.yaw); }
      for (let t = 0; t < 240; t++) sim.tick(1);
      return fullHash(sim);
    };
    expect(go(true)).toBe(go(false));
  }, 60000);
});
