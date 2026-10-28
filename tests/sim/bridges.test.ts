import { describe, expect, it } from 'vitest';
import { bridgeWorld, eastSide } from './bridgeHelper';
import { planBridge } from '../../src/world/Bridges';
import { Layer, NetKind, lineTiles } from '../../src/world/Networks';
import { NavMode } from '../../src/sim/guests/NavGraph';
import { routeOnKind, VehicleKind } from '../../src/sim/guests/Arrivals';
import { defaultMarketing } from '../../src/sim/guests/Spawner';
import { Undo } from '../../src/build/UndoActions';
import { collectSave, stateHash } from '../../src/game/saveState';
import { encodeSave, decodeSave, makeMeta } from '../../src/persist/Serializer';
import { createSim } from '../../src/game/createSim';
import { buildChunkData } from '../../src/render/meshes/Paths';
import { CHUNK_SIZE } from '../../src/world/Grid';
import { BRIDGE_KINDS, type BridgeKind } from '../../src/config/bridges';

const nav = (sim: ReturnType<typeof bridgeWorld>) => { const g = sim.guestSim.graph()!; g.update(0); g.pf.maxBuildsPerTick = Infinity; return g; };
const tile = (x: number, y: number): number => y * 64 + x;
const tilesOf = (nodes: ArrayLike<number>): number[] => Array.from(nodes);

describe('bridges: pathing', () => {
  it('footpath: no way across the stream before, a path over the footbridge after (and it is one tile edge per deck tile)', () => {
    const sim = bridgeWorld(); const n = sim.networks;
    let g = nav(sim);
    expect(g.pf.find(NavMode.Walk, tile(36, 47), tile(39, 47))).toBeTruthy();
    n.buildSegment(NetKind.Path, lineTiles({ x: 41, y: 47 }, { x: 45, y: 47 }));
    g = nav(sim);
    expect(g.pf.find(NavMode.Walk, tile(36, 47), tile(43, 47)) ?? null).toBeNull();
    const b = n.buildBridge(planBridge(n, sim.grid, 'footbridge', { x: 39, y: 47 }, { x: 41, y: 47 }))!;
    g = nav(sim);
    const r = g.pf.find(NavMode.Walk, tile(36, 47), tile(43, 47));
    expect(r).toBeTruthy();
    expect(tilesOf(r!.nodes)).toContain(tile(40, 47));
    expect(b.span).toEqual([{ x: 40, y: 47 }]);
    // water under the deck is untouched
    expect(sim.grid.tileType[tile(40, 47)]).toBe(6);
  });
  it('hiking bridge: hikers cross it (summer); the trail layer + bridge flag sit on the span', () => {
    const sim = bridgeWorld({ summer: true }); const n = sim.networks;
    n.paint(Layer.Hike, lineTiles({ x: 36, y: 49 }, { x: 39, y: 49 }));
    n.paint(Layer.Hike, lineTiles({ x: 41, y: 49 }, { x: 45, y: 49 }));
    sim.tick(5);
    let g = nav(sim);
    expect(g.pf.find(NavMode.Hike, tile(37, 49), tile(44, 49)) ?? null).toBeNull();
    const b = n.buildBridge(planBridge(n, sim.grid, 'hikeBridge', { x: 39, y: 49 }, { x: 41, y: 49 }))!;
    expect(b.kind).toBe('hikeBridge');
    g = nav(sim); g.touch(tile(40, 49));
    const r = g.pf.find(NavMode.Hike, tile(37, 49), tile(44, 49));
    expect(r).toBeTruthy();
    expect(tilesOf(r!.nodes)).toContain(tile(40, 49));
  });
  it('road bridge: the car route crosses it, the car park is road-served and cars arrive over it', () => {
    const sim = bridgeWorld(); const n = sim.networks;
    const park = () => sim.buildings.all().find((b) => b.type === 'parking')!;
    expect(n.planSegment(NetKind.Road, lineTiles({ x: 41, y: 46 }, { x: 52, y: 46 })).reason).toBe('Roads must start at the road entry'); // no way across yet
    const b = n.buildBridge(planBridge(n, sim.grid, 'roadBridge', { x: 39, y: 46 }, { x: 41, y: 46 }))!;
    eastSide(sim); // the road beyond the bridge links through it
    expect(n.isRoadServed(park().id)).toBe(true);
    expect(park().active).toBe(true);
    const p = park();
    const route = routeOnKind(n.kind, 64, NetKind.Road, n.roadEntry!, { x: p.x, y: p.y, w: p.w, h: p.h }, n.cross);
    expect(route.some((t) => t.x === 40 && t.y === 46)).toBe(true);
    // cars drive over it
    const sp = sim.guestSim.spawner; sp.rateMult = 5; sp.marketingFn = () => ({ ...defaultMarketing(), railBias: -50 });
    let crossed = 0; const seen = new Set<number>();
    for (let t = 0; t < 600; t++) {
      sim.tick(1);
      for (const v of sp.vehicles) if ((v.kind === VehicleKind.Car || v.kind === VehicleKind.Bus) && !seen.has(v.id)) { seen.add(v.id); if (v.pts.some((q, k) => k % 2 === 0 && Math.floor(q) === 40 && Math.floor(v.pts[k + 1]!) === 46)) crossed++; }
    }
    expect(crossed).toBeGreaterThan(0);
    expect(b.cost).toBeGreaterThan(600);
    // the deck lifts a car (and a walking guest) above the water
    expect(n.deckY(40.5, 46.5)!).toBeCloseTo(b.deck * 0.5, 6);
    expect(sim.guestSim.spawner['world'].groundAt(40.5, 46.5)).toBeCloseTo(b.deck * 0.5, 6);
  });
  it('rail stays refused over water', () => {
    const sim = bridgeWorld(); const n = sim.networks;
    expect(planBridge(n, sim.grid, 'rail', { x: 39, y: 46 }, { x: 41, y: 46 }).reason).toBe('Rail cannot cross water');
  });
});

describe('bridges: undo, save / load, migration', () => {
  it('place -> undo restores the exact state; redo brings the bridge back', () => {
    const sim = bridgeWorld(); const n = sim.networks;
    const undo = new Undo(sim);
    const before = stateHash(sim).parts, arrays = () => JSON.stringify([Array.from(n.kind), Array.from(n.bridge), Array.from(n.bid), Array.from(n.layers), Array.from(n.conn)]), snap = arrays();
    n.beginJournal();
    const plan = planBridge(n, sim.grid, 'footbridge', { x: 39, y: 47 }, { x: 41, y: 47 });
    expect(sim.economy.charge(plan.cost)).toBe(true);
    n.buildBridge(plan);
    undo.recordNetwork('Bridge', 'painted', n.endJournal(), plan.cost);
    expect(n.bridgeTiles).toBe(1);
    expect(undo.undo().ok).toBe(true);
    expect(n.bridgeTiles).toBe(0);
    expect(n.kindAt(40, 47)).toBe(0);
    const after = stateHash(sim).parts;
    expect(Object.keys(before).filter((k) => k !== 'networks' && before[k] !== after[k])).toEqual([]); // 'networks' differs only by its cache-invalidating version counter
    expect(arrays()).toBe(snap);
    expect(undo.redo().ok).toBe(true);
    expect(n.bridgeTiles).toBe(1);
    expect(n.kindAt(40, 47)).toBe(NetKind.Path);
  });
  it('a world with bridges saves and loads (records, ids, deck); a world without keeps its old save shape', async () => {
    const sim = bridgeWorld(); const n = sim.networks;
    expect(Object.keys(collectSave(sim)['networks']!.data as object)).not.toContain('bridges');
    n.buildBridge(planBridge(n, sim.grid, 'footbridge', { x: 39, y: 47 }, { x: 41, y: 47 }));
    expect(Object.keys(collectSave(sim)['networks']!.data as object)).toContain('bridges');
    const { bytes } = await encodeSave(sim, makeMeta(sim, 'b'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const b = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    expect(b.networks.bridgeTiles).toBe(1);
    expect(b.networks.liveBridges()).toEqual(n.liveBridges());
    expect(b.networks.deckY(40.5, 47.5)).toBeCloseTo(n.deckY(40.5, 47.5)!, 6);
    // bulldozing after the load still removes it whole
    expect(b.networks.unbuild(40, 47)).toBe(NetKind.Path);
    expect(b.networks.bridgeTiles).toBe(0);
  });
  it('old stream crossings (the per-tile flag, no record) migrate to zero-cost auto records and stay connected after save / load', async () => {
    const sim = bridgeWorld(); const n = sim.networks;
    n.buildSegment(NetKind.Path, lineTiles({ x: 39, y: 47 }, { x: 41, y: 47 })); // the OLD way: a plain stroke across the stream
    expect(n.bridge[tile(40, 47)]).toBe(1);
    expect(n.bridgeTiles).toBe(0);
    const legacy = n.legacyBridges();
    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toMatchObject({ kind: 'footbridge', cost: 0, auto: true, span: [{ x: 40, y: 47 }] });
    expect(n.allBridges()).toHaveLength(1);
    const { bytes } = await encodeSave(sim, makeMeta(sim, 'old'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const mod = env.modules['networks'] as unknown as { version: number; data: Record<string, unknown> };
    expect(mod.data['bid']).toBeUndefined(); mod.version = 1; // exactly what a pre-bridges save looks like
    const b = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    expect(b.networks.bridge[tile(40, 47)]).toBe(1);
    expect(b.networks.allBridges()).toHaveLength(1);
    const g = nav(b);
    expect(g.pf.find(NavMode.Walk, tile(37, 47), tile(41, 47))).toBeTruthy();
  });
  it('a world without any bridge hashes like before (nothing new is serialised)', () => {
    const a = createSim({ size: 64, seed: 61, now: () => 0 });
    expect(Object.keys(collectSave(a)['networks']!.data as object).sort()).toEqual(['bridge', 'conn', 'difficulty', 'kind', 'layers', 'quality', 'railEntry', 'roadEntry', 'version']);
  });
});

describe('bridges: render', () => {
  for (const kind of BRIDGE_KINDS as readonly BridgeKind[]) {
    it(`${kind}: deck, banks and supports build finite geometry above the water, bounded triangles, one chunk mesh`, () => {
      const sim = bridgeWorld({ summer: true }); const n = sim.networks;
      const y = kind === 'roadBridge' ? 46 : kind === 'footbridge' ? 47 : 49;
      if (kind === 'hikeBridge' || kind === 'mtbBridge') n.paint(kind === 'hikeBridge' ? Layer.Hike : Layer.Mtb, lineTiles({ x: 38, y }, { x: 39, y }));
      const chunk = Math.floor(y / CHUNK_SIZE) * sim.grid.chunksPerRow + Math.floor(40 / CHUNK_SIZE);
      const before = buildChunkData(sim.grid, n, chunk).net;
      const plan = planBridge(n, sim.grid, kind, { x: 39, y }, { x: 41, y });
      expect(plan.ok, plan.reason).toBe(true);
      const br = n.buildBridge(plan)!;
      const after = buildChunkData(sim.grid, n, chunk).net;
      expect(after.positions.every((v) => Number.isFinite(v))).toBe(true);
      const tris = (after.indices.length - before.indices.length) / 3;
      expect(tris).toBeGreaterThan(20);
      expect(tris).toBeLessThan(260);
      let top = -Infinity; for (let i = 0; i < after.positions.length; i += 3) if (after.positions[i]! > 39.9 && after.positions[i]! < 41.1 && after.positions[i + 2]! > y - 0.1 && after.positions[i + 2]! < y + 1.1) top = Math.max(top, after.positions[i + 1]!);
      expect(top).toBeGreaterThanOrEqual(br.deck * 0.5 - 0.01); // the deck stands at its level over the water
    });
  }
});
