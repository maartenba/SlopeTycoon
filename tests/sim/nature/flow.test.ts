import { describe, expect, it } from 'vitest';
import { makeResort } from '../../game/harness';
import { computeFlow, FlowModel, riverHabitatPoints, seasonFactor } from '../../../src/sim/nature/Flow';
import type { Stream } from '../../../src/world/Streams';
import type { RiverRec } from '../../../src/world/Rivers';
import { simDayOf } from '../../../src/sim/calendar';
import { applyRiver, planRiver } from '../../../src/world/RiverPlanner';
import { Layer, PISTE_WATER_MSG, NetKind } from '../../../src/world/Networks';
import { stateHash } from '../../../src/game/saveState';
import { TileType } from '../../../src/world/Grid';
import { validatePlacement } from '../../../src/sim/PlaceBuilding';
import type { Sim } from '../../../src/game/createSim';

const line = (x0: number, y: number, n: number): Array<{ x: number; y: number }> => Array.from({ length: n }, (_, i) => ({ x: x0 + i, y }));
const nat = (path: Array<{ x: number; y: number }>, level: number[], end: Stream['end'] = 'edge'): Stream => ({ path, level, end });
const rec = (id: number, path: Array<{ x: number; y: number }>, level: number[], source: RiverRec['source'], sink: RiverRec['sink'], end: RiverRec['end']): RiverRec =>
  ({ id, path, level, source, sink, end, carved: [], cost: 0 });

describe('flow model (pure)', () => {
  it('season factor: spring melt, low late summer, autumn lower, winter normal', () => {
    const apr = seasonFactor(simDayOf(3, 5)), jun = seasonFactor(simDayOf(5, 5)), aug = seasonFactor(simDayOf(7, 5)), oct = seasonFactor(simDayOf(9, 5)), jan = seasonFactor(simDayOf(0, 5));
    expect(apr).toBe(1.5); expect(jun).toBe(1); expect(aug).toBeLessThan(jun); expect(oct).toBeLessThan(1); expect(jan).toBe(1);
  });
  it('a natural stream has base Q 1 per tile; classes follow the drop per tile', () => {
    const flat = nat(line(0, 0, 10), Array(10).fill(20));
    const steep = nat(line(0, 5, 10), Array.from({ length: 10 }, (_, i) => 40 - i * 3));
    const mid = nat(line(0, 9, 10), Array.from({ length: 10 }, (_, i) => 40 - i));
    const t = computeFlow([flat, steep, mid], [], 1);
    expect(t.get('n0')!.q.every((q) => q === 1)).toBe(true);
    expect(t.get('n0')!.maxClass).toBe(0);
    expect(t.get('n1')!.maxClass).toBe(2);
    expect(t.get('n2')!.maxClass).toBe(1);
    expect(t.get('n1')!.speed[4]!).toBeGreaterThan(t.get('n0')!.speed[4]!);
  });
  it('sources: spring 1, lake outlet 2, branch = half of the parent tile Q', () => {
    const parent = rec(1, line(0, 0, 10), Array(10).fill(30), { kind: 'lake', x: 0, y: 0 }, { kind: 'edge', x: 9, y: 0 }, 'edge');
    const spring = rec(2, line(0, 5, 6), Array(6).fill(30), { kind: 'spring', x: 0, y: 5 }, { kind: 'edge', x: 5, y: 5 }, 'edge');
    const branch = rec(3, line(4, 1, 5).map((p, i) => ({ x: 4, y: 1 + i })), Array(5).fill(30), { kind: 'stream', x: 4, y: 1, via: { x: 4, y: 0 } }, { kind: 'edge', x: 4, y: 5 }, 'edge');
    const t = computeFlow([], [parent, spring, branch], 1);
    expect(t.get('r1')!.q[0]).toBe(2);
    expect(t.get('r2')!.q[0]).toBe(1);
    expect(t.get('r3')!.q[0]).toBe(1); // 0.5 x 2
  });
  it('a tributary adds its mouth Q to the parent from the merge tile on', () => {
    const main = nat(line(0, 0, 10), Array(10).fill(30));
    const trib = rec(1, [{ x: 5, y: 3 }, { x: 5, y: 2 }, { x: 5, y: 1 }], [30, 30, 30], { kind: 'spring', x: 5, y: 3 }, { kind: 'stream', x: 5, y: 0 }, 'merge');
    const t = computeFlow([main], [trib], 1);
    const q = t.get('n0')!.q;
    expect(q[4]).toBe(1); expect(q[5]).toBe(2); expect(q[9]).toBe(2);
    expect(t.get('n0')!.mouthQ).toBe(2);
  });
  it('season scales speed; frozen dug rivers have no flow, natural streams are never frozen by this model', () => {
    const r = rec(1, line(0, 0, 8), Array.from({ length: 8 }, (_, i) => 30 - i), { kind: 'spring', x: 0, y: 0 }, { kind: 'edge', x: 7, y: 0 }, 'edge');
    const n = nat(line(0, 4, 8), Array.from({ length: 8 }, (_, i) => 30 - i));
    const melt = computeFlow([n], [r], 1.5), low = computeFlow([n], [r], 0.7);
    expect(melt.get('r1')!.speed[3]!).toBeGreaterThan(low.get('r1')!.speed[3]!);
    const ice = computeFlow([n], [r], 1, () => true);
    expect(ice.get('r1')!.frozen).toBe(true); expect(ice.get('r1')!.speed.every((v) => v === 0)).toBe(true); expect(ice.get('r1')!.mouthQ).toBe(0);
    expect(ice.get('n0')!.frozen).toBe(false); expect(ice.get('n0')!.speed[3]!).toBeGreaterThan(0);
  });
  it('habitat points: 0 without rivers, +1 per 40 tiles, capped', () => {
    expect(riverHabitatPoints([])).toBe(0);
    expect(riverHabitatPoints([rec(1, line(0, 0, 40), [], { kind: 'spring', x: 0, y: 0 }, { kind: 'edge', x: 0, y: 0 }, 'edge')])).toBe(1);
    expect(riverHabitatPoints([rec(1, line(0, 0, 400), [], { kind: 'spring', x: 0, y: 0 }, { kind: 'edge', x: 0, y: 0 }, 'edge')])).toBe(2);
  });
  it('lazy: the table is recomputed only on a river / month / ice change', () => {
    const rivers = { rivers: [] as RiverRec[], version: 0 };
    const m = new FlowModel({ natural: () => [nat(line(0, 0, 6), Array(6).fill(10))], rivers: () => rivers });
    m.onDay(simDayOf(11, 3), 0);
    const a = m.all(); const v = m.version;
    expect(m.all()).toBe(a); expect(m.version).toBe(v);
    m.onDay(simDayOf(11, 4), 0); expect(m.all()).toBe(a); // same month
    m.onDay(simDayOf(3, 4), 0); expect(m.all()).not.toBe(a); // April
    const b = m.all(); rivers.version++; expect(m.all()).not.toBe(b);
  });
});

function digOne(sim: Sim): { path: Array<{ x: number; y: number }> } {
  const env = sim.riverEnv(), N = sim.size;
  for (const s of sim.rivers.natural) {
    for (const l of sim.terrainInfo.lakes) {
      const t = l.tileIdx[0]!, p = planRiver(env, s, { x: t % N, y: (t / N) | 0 });
      if (p.ok && p.cost > 0 && applyRiver(env, sim.rivers, p).ok) return { path: p.path };
    }
    const p = planRiver(env, s);
    if (p.ok && applyRiver(env, sim.rivers, p).ok) return { path: p.path };
  }
  throw new Error('no river');
}

describe('flow in a sim with a dug river', () => {
  it('flow table covers natural + dug waterways; tileAt finds a river tile; river tiles stay non-buildable, piste-refused, rail-refused, path-bridged', () => {
    const { sim } = makeResort(64, 61);
    const { path } = digOne(sim);
    const f = sim.flow.tileAt(path[1]!.x, path[1]!.y);
    expect(f?.way.kind).toBe('dug');
    expect(f!.way.q[0]).toBeGreaterThan(0);
    expect(sim.flow.all().size).toBe(sim.terrainInfo.streams.length + 1);
    const p = path[Math.floor(path.length / 2)]!;
    expect(sim.grid.tileType[p.y * sim.size + p.x]).toBe(TileType.Stream);
    expect(sim.networks.canPaint(p.x, p.y, Layer.Ski)).toEqual({ ok: false, reason: PISTE_WATER_MSG });
    expect(sim.networks.paint(Layer.Ski, [p]).painted).toBe(0);
    expect(sim.networks.canBuild(NetKind.Rail, p.x, p.y).ok).toBe(false);
    const chk = validatePlacement(sim.env, 'chalet', p.x, p.y, 0);
    expect(chk.ok).toBe(false);
    expect(chk.reasons).toContain('Cannot build on a stream');
    expect(sim.networks.build(NetKind.Path, p.x, p.y)).toBe(true);
    expect(sim.networks.bridge[p.y * sim.size + p.x]).toBe(1);
  });
  it('a world without dug rivers: flow lookups change nothing (hash has no rivers part, same hash before / after reading the table)', () => {
    const { sim } = makeResort(64, 61);
    sim.tick(10);
    const h = stateHash(sim);
    expect(sim.flow.all().size).toBe(sim.terrainInfo.streams.length);
    sim.flow.onDay(10, -5);
    expect(stateHash(sim).hash).toBe(h.hash);
    expect(h.parts.rivers).toBeUndefined();
  });
  it('a beach beside a dug river is not "next to a lake" (lakes only)', () => {
    const { sim } = makeResort(64, 61);
    const { path } = digOne(sim);
    const lakeSet = new Set(sim.buildings.lakeTiles.map((t) => `${t.x},${t.y}`));
    for (const p of path) expect(lakeSet.has(`${p.x},${p.y}`)).toBe(false);
  });
});
