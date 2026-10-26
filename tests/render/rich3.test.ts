// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { Buildings } from '../../src/sim/Buildings';
import { Networks, NetKind, lineTiles } from '../../src/world/Networks';
import { networkEdgeTan, tileLines, tileNetwork, surfaceHeightAt, type GeoData, type P2 } from '../../src/render/meshes/Paths';
import { Emotes, EMOTES, EMOTE_T, WildlifeSight, feedbackPolicy, pickEmote, wildlifeAllowed, type EmoteNeeds } from '../../src/render/fx';
import { drawEmoteAtlas } from '../../src/render/fx/Emotes';
import { GuestStore } from '../../src/sim/guests/Guest';
import { layoutVillage } from '../../src/render/VillageDecor';
import { WALK, makeWalker, stepWalker, type WalkWorld } from '../../src/render/view/walkPhysics';
import { decorCircles, buildWalkWorld } from '../../src/render/view/WalkMode';
import { createSim } from '../../src/game/createSim';
import { buildTown, pruneRoads, townSimOptions } from '../../src/game/demoTowns';

const mk = () => { const grid = new Grid(64); const net = new Networks(grid, new Buildings(grid.occupancy)); return { grid, net }; };
const geo = (): GeoData => ({ positions: [], uvs: [], colors: [], indices: [] });
const stair = (kind: number, n = 8): Array<{ x: number; y: number }> => { const t: Array<{ x: number; y: number }> = []; for (let i = 0; i < n; i++) { t.push({ x: 10 + i, y: 10 + i }); t.push({ x: 11 + i, y: 10 + i }); } return t; };

describe('smooth path / road ribbons', () => {
  it('edge tangents are symmetric (A->B = -(B->A)) and ribbons of neighbouring tiles share end point and direction', () => {
    const { net } = mk();
    net.roadEntry = { x: 10, y: 10 };
    net.buildSegment(NetKind.Path, stair(1));
    let smooth = 0;
    for (let y = 10; y < 19; y++) for (let x = 10; x < 20; x++) {
      const i = y * 64 + x;
      if (net.kind[i] !== NetKind.Path) continue;
      const ta = networkEdgeTan(net, x, y);
      for (const [d, dx, dy] of [[1, 1, 0], [2, 0, 1]] as const) {
        const j = (y + dy) * 64 + x + dx;
        if (net.kind[j] !== NetKind.Path) continue;
        const tb = networkEdgeTan(net, x + dx, y + dy), a = ta(d), b = tb((d + 2) % 4);
        if (!a && !b) continue;
        smooth++;
        expect(a && b).toBeTruthy();
        expect(a![0]).toBeCloseTo(-b![0]!, 6); expect(a![1]).toBeCloseTo(-b![1]!, 6);
        // the lines of both tiles end / start at the same point with the same tangent
        const la = tileLines(x, y, net.conn[i]!, 64, 0.2, ta)[0]!, lb = tileLines(x + dx, y + dy, net.conn[j]!, 64, 0.2, tb)[0]!;
        const edgeA = la.pts.find((p) => Math.abs(p[0] - (x + 0.5 + dx * 0.5)) < 1e-9 && Math.abs(p[1] - (y + 0.5 + dy * 0.5)) < 1e-9);
        const edgeB = lb.pts.find((p) => Math.abs(p[0] - (x + 0.5 + dx * 0.5)) < 1e-9 && Math.abs(p[1] - (y + 0.5 + dy * 0.5)) < 1e-9);
        expect(edgeA).toBeTruthy(); expect(edgeB).toBeTruthy();
        const tA = la.tans![la.pts.indexOf(edgeA!)]!, tB = lb.tans![lb.pts.indexOf(edgeB!)]!;
        expect(Math.abs(tA[0] * tB[0] + tA[1] * tB[1])).toBeCloseTo(1, 6); // same line, either travel direction
      }
    }
    expect(smooth).toBeGreaterThan(8);
  });

  it('a diagonal staircase has far less total turning than the old chain of quarter arcs', () => {
    const { net } = mk();
    net.buildSegment(NetKind.Path, stair(1));
    const chain = (smooth: boolean): P2[] => {
      const out: P2[] = [];
      for (let k = 0; k < 14; k++) { // the stair tiles in walking order (east, south, east, ...)
        const x = 11 + (k >> 1), y = 10 + (k >> 1) + (k & 1);
        const i = y * 64 + x; if (net.kind[i] !== NetKind.Path) continue;
        let pts = tileLines(x, y, net.conn[i]!, 64, 0.2, smooth ? networkEdgeTan(net, x, y) : undefined)[0]!.pts.slice();
        const last = out[out.length - 1];
        if (last && Math.hypot(pts[0]![0] - last[0], pts[0]![1] - last[1]) > Math.hypot(pts[pts.length - 1]![0] - last[0], pts[pts.length - 1]![1] - last[1])) pts = pts.reverse();
        out.push(...(last ? pts.slice(1) : pts));
      }
      return out;
    };
    const turning = (pts: P2[]): number => { // total absolute turning angle (radians) along the chain
      let m = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6 || Math.hypot(c[0] - b[0], c[1] - b[1]) < 1e-6) continue;
        m += Math.abs(Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])));
      }
      return m;
    };
    expect(turning(chain(true))).toBeLessThan(turning(chain(false)) * 0.75); // far less zig-zag: a diagonal, not stacked 90-degree arcs
  });

  it('junctions, dead ends, bridges and the map edge keep axis-aligned tangents (no smoothing)', () => {
    const { net } = mk();
    net.buildSegment(NetKind.Path, lineTiles({ x: 10, y: 10 }, { x: 14, y: 10 })); net.buildSegment(NetKind.Path, lineTiles({ x: 12, y: 10 }, { x: 12, y: 13 }));
    expect(networkEdgeTan(net, 12, 10)(3)).toBeNull(); // T junction
    expect(networkEdgeTan(net, 10, 10)(1)).toBeNull(); // dead end
    expect(networkEdgeTan(net, 11, 10)(1)).toBeNull(); // neighbour is the junction
    net.bridge[10 * 64 + 13] = 1; // a bridge segment
    expect(networkEdgeTan(net, 13, 10)(3)).toBeNull();
    expect(networkEdgeTan(net, 11, 10)(1)).toBeNull();
    expect(networkEdgeTan({ ...net, size: 64, kind: new Uint8Array(64 * 64), conn: new Uint8Array(64 * 64), bridge: new Uint8Array(64 * 64) } as Pick<Networks, 'kind' | 'conn' | 'bridge' | 'size'>, 0, 0)(0)).toBeNull();
  });

  it('smooth path + road tiles produce finite, draped, up-facing geometry that stays above the surface', () => {
    for (const kind of [NetKind.Path, NetKind.Road]) {
      const { net, grid } = mk();
      net.roadEntry = { x: 10, y: 10 };
      net.buildSegment(kind, stair(kind));
      const d = geo();
      for (let y = 10; y < 19; y++) for (let x = 10; x < 20; x++) tileNetwork(d, grid, net, x, y);
      expect(d.indices.length).toBeGreaterThan(300);
      let up = 0, down = 0;
      for (let i = 0; i < d.positions.length; i += 3) {
        expect(Number.isFinite(d.positions[i]! + d.positions[i + 1]! + d.positions[i + 2]!)).toBe(true);
        expect(d.positions[i + 1]!).toBeGreaterThanOrEqual(surfaceHeightAt(grid, d.positions[i]!, d.positions[i + 2]!) - 1e-6);
      }
      for (let i = 0; i < d.indices.length; i += 3) {
        const p = (k: number): number[] => [d.positions[d.indices[i + k]! * 3]!, d.positions[d.indices[i + k]! * 3 + 2]!];
        const [a, b, c] = [p(0), p(1), p(2)] as [number[], number[], number[]];
        const ny = (b[1]! - a[1]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[1]! - a[1]!);
        if (ny > 1e-12) up++; else if (ny < -1e-12) down++;
      }
      expect(down).toBe(0); expect(up).toBeGreaterThan(100); // consistent winding: the ribbon never folds over itself
    }
  });
});

describe('wildlife emote', () => {
  const n0: EmoteNeeds = { day: 3, hunger: 0.2, fatigue: 0.2, happiness: 0.6, queueMin: 0, cold: 0, runDone: false, sighting: false };
  const P = feedbackPolicy('subtle');
  const none = { day: -1, count: 0 };

  it('the atlas has a cell for every kind (7 of 8) and the paw is drawn', () => {
    expect(EMOTES).toContain('wildlife'); expect(EMOTES.length).toBeLessThanOrEqual(8);
    const calls: string[] = [];
    const ctx = new Proxy({} as CanvasRenderingContext2D, { get: (_t, k) => (k === 'canvas' ? {} : () => { calls.push(String(k)); }), set: () => true });
    drawEmoteAtlas(ctx);
    expect(calls.filter((c) => c === 'ellipse')).toHaveLength(1); // the paw pad
  });
  it('fires on the first sighting only (edge), is lowest priority and respects the daily limit / Off', () => {
    expect(pickEmote({ ...n0, wildlife: true }, n0, none, P)).toBe('wildlife');
    expect(pickEmote({ ...n0, wildlife: true }, { ...n0, wildlife: true }, none, P)).toBeNull();
    expect(pickEmote({ ...n0, wildlife: true, hunger: 0.95 }, n0, none, P)).toBe('hungry');
    expect(pickEmote({ ...n0, wildlife: true }, n0, { day: 3, count: 1 }, P)).toBeNull();
    expect(pickEmote({ ...n0, wildlife: true }, n0, none, feedbackPolicy('off'))).toBeNull();
  });
  it('the gate is rare (chance) and quiet (global cooldown)', () => {
    expect(wildlifeAllowed(1000, 0, 0.1)).toBe(true);
    expect(wildlifeAllowed(1000, 0, EMOTE_T.wildlifeChance + 0.01)).toBe(false);
    expect(wildlifeAllowed(100, 0, 0.1)).toBe(false);
    expect(wildlifeAllowed(EMOTE_T.wildlifeGapTicks, 0, 0)).toBe(true);
  });
  it('WildlifeSight: bears are seen further than deer, anything beyond its range is not', () => {
    const s = new WildlifeSight();
    s.set([{ x: 50, y: 50, kind: 'bear' }, { x: 10, y: 10, kind: 'deer' }]);
    expect(s.near(50 + EMOTE_T.bearRange - 0.1, 50)).toBe(true); expect(s.near(50 + EMOTE_T.bearRange + 0.3, 50)).toBe(false);
    expect(s.near(10 + EMOTE_T.deerRange - 0.1, 10)).toBe(true); expect(s.near(10 + EMOTE_T.deerRange + 0.3, 10)).toBe(false);
    expect(s.near(10 + 6, 10)).toBe(false); // a bear's range does not apply to deer
    expect(new WildlifeSight().near(1, 1)).toBe(false);
  });
  it('Emotes: a guest that gets a deer in range shows ONE paw, then the global cooldown holds the next guest back', () => {
    const store = new GuestStore(16);
    for (let i = 0; i < 3; i++) store.add({ x: i * 40, y: 0, z: 0, type: 0, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 99, tick: 0 });
    const near = new Set<number>();
    const em = new Emotes(store, { policy: () => feedbackPolicy('subtle'), reducedMotion: () => false, day: () => 3, cold: () => 0, wildlife: (s) => near.has(s), anchor: (s, o) => { o.set(store.x[s]!, 1, store.y[s]!); return true; }, rng: () => 0.01 });
    const cam = new THREE.OrthographicCamera(-200, 200, 200, -200); cam.position.set(0, 50, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    em.update(0.1, cam, 0, false, 400, 800); // baselines
    em.update(0.1, cam, 1, false, 400, 800); expect(em.stats.spawned).toBe(0); // nothing in range: silent
    near.add(0); em.update(0.1, cam, 2, false, 400, 800);
    expect(em.kinds()).toEqual(['wildlife']);
    near.add(1); em.update(0.1, cam, 3, false, 400, 800); // 1 tick later: cooldown
    expect(em.stats.spawned).toBe(1);
    em.update(0.1, cam, 2 + EMOTE_T.wildlifeGapTicks, false, 400, 800); // cooldown over, guest 1 is still "in range" but already seen it (no edge)
    expect(em.stats.spawned).toBe(1);
    near.add(2); em.update(0.1, cam, 4 + EMOTE_T.wildlifeGapTicks, false, 400, 800);
    expect(em.stats.spawned).toBe(2);
  });
  it('a dice roll above the chance suppresses the paw', () => {
    const store = new GuestStore(8);
    store.add({ x: 0, y: 0, z: 0, type: 0, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 99, tick: 0 });
    let on = false;
    const em = new Emotes(store, { policy: () => feedbackPolicy('subtle'), reducedMotion: () => false, day: () => 3, cold: () => 0, wildlife: () => on, anchor: (_s, o) => { o.set(0, 1, 0); return true; }, rng: () => 0.99 });
    const cam = new THREE.OrthographicCamera(-200, 200, 200, -200); cam.position.set(0, 50, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    em.update(0.1, cam, 0, false, 400, 800); on = true; em.update(0.1, cam, 500, false, 400, 800);
    expect(em.stats.spawned).toBe(0);
  });
});

describe('hedges and stone walls in walk mode', () => {
  const row = (kind: 'hedge' | 'wall', ry: number) => decorCircles([{ kind, x: 20.5, z: 20.5, ry, w: 3 }]);
  it('are a continuous barrier of overlapping circles along their length (no gap a walker could squeeze through)', () => {
    for (const kind of ['hedge', 'wall'] as const) for (const ry of [0, Math.PI / 2, 0.6]) {
      const cs = row(kind, ry);
      expect(cs.length).toBeGreaterThanOrEqual(6);
      const L = 3, c = Math.cos(ry), s = Math.sin(ry);
      for (let t = -L / 2; t <= L / 2; t += 0.02) {
        const px = 20.5 + c * t, pz = 20.5 - s * t;
        expect(cs.some(([x, z, r]) => Math.hypot(px - x!, pz - z!) <= r! + 1e-9)).toBe(true);
      }
    }
  });
  it('the walker cannot walk through a hedge or a wall (stops outside), from either side', () => {
    for (const kind of ['hedge', 'wall'] as const) for (const dir of [1, -1]) {
      const circ = new Map<string, number[]>();
      for (const [x, z, r] of row(kind, 0)) { const k = `${Math.floor(x!)},${Math.floor(z!)}`; circ.set(k, [...(circ.get(k) ?? []), x!, z!, r!]); }
      const w: WalkWorld = { size: 40, ground: () => 0, solid: (x, y) => x < 0 || y < 0 || x >= 40 || y >= 40, circles: (x, y) => circ.get(`${x},${y}`) ?? null };
      const s = makeWalker(20.5, 20.5 + dir * 1.6, 0, 0); s.yaw = dir > 0 ? 0 : Math.PI;
      for (let i = 0; i < 240; i++) stepWalker(s, { fwd: 1, strafe: 0, run: false, jump: false }, 1 / 60, w, s);
      expect(Math.abs(s.z - 20.5)).toBeGreaterThanOrEqual(WALK.radius + 0.09);
      expect(Math.sign(s.z - 20.5)).toBe(dir);
    }
  });
  it('the real world index contains them; a village layout never puts a row across a blocked (path / road) tile', () => {
    const blocked = (i: number): boolean => { const x = i % 64, y = Math.floor(i / 64); return x % 5 === 2 || y % 7 === 3; }; // a lattice of "paths"
    const homes = Array.from({ length: 12 }, (_, k) => ({ x: 8 + (k % 4) * 11, y: 8 + Math.floor(k / 4) * 13, w: 3, h: 3 }));
    let rows = 0;
    for (const lodge of [{ x: 30, y: 30, w: 4, h: 3 }]) {
      const items = layoutVillage(lodge, { size: 64, blocked: () => false }, homes);
      const lat = layoutVillage(lodge, { size: 64, blocked }, homes);
      expect(lat.filter((i) => i.kind === 'hedge' || i.kind === 'wall').length).toBeLessThanOrEqual(items.filter((i) => i.kind === 'hedge' || i.kind === 'wall').length);
      for (const it of lat) {
        if (it.kind !== 'hedge' && it.kind !== 'wall') continue;
        rows++;
        const c = Math.cos(it.ry), s = Math.sin(it.ry), L = it.w!;
        for (let t = -L / 2 + 0.03; t <= L / 2 - 0.03; t += 0.1) expect(blocked(Math.floor(it.z - s * t) * 64 + Math.floor(it.x + c * t))).toBe(false);
      }
      const world = buildWalkWorld(new Grid(64), null, null, () => 0, () => items);
      const row0 = items.find((i) => i.kind === 'hedge' || i.kind === 'wall');
      if (row0) expect(world.circles(Math.floor(row0.x), Math.floor(row0.z))).toBeTruthy();
    }
    expect(rows).toBeGreaterThan(0);
  });
});

describe('demo town roads: no orphan spurs / loops', () => {
  it('pruneRoads is idempotent after buildTown and every road tile of the network is needed; a bolted-on dead-end spur is removed', () => {
    const sim = createSim({ ...townSimOptions('alpine', 64), seed: 22, now: () => 0 });
    const rep = buildTown(sim, 'alpine', 22);
    expect(rep.failures.length).toBeLessThanOrEqual(1);
    expect(pruneRoads(sim)).toBe(0);
    const net = sim.networks, n = net.size;
    // bolt a 4-tile spur onto a straight road tile somewhere away from every building ring
    const ringed = new Set<number>();
    for (const b of sim.buildings.all()) for (let y = b.y - 2; y <= b.y + b.h + 1; y++) for (let x = b.x - 2; x <= b.x + b.w + 1; x++) ringed.add(y * n + x);
    let built = 0;
    for (let i = 0; i < n * n && !built; i++) {
      if (net.kind[i] !== NetKind.Road || ringed.has(i)) continue;
      const x = i % n, y = (i / n) | 0;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        const tiles = [1, 2, 3, 4].map((k) => ({ x: x + dx * k, y: y + dy * k }));
        if (tiles.some((t) => ringed.has(t.y * n + t.x)) || !net.planSegment(NetKind.Road, [{ x, y }, ...tiles]).ok) continue;
        built = net.buildSegment(NetKind.Road, [{ x, y }, ...tiles]).length; break;
      }
    }
    expect(built).toBe(4);
    const before = sim.buildings.all().filter((b) => net.isRoadServed(b.id)).length;
    expect(pruneRoads(sim)).toBeGreaterThanOrEqual(4);
    expect(sim.buildings.all().filter((b) => net.isRoadServed(b.id)).length).toBe(before);
  }, 60000);
});
