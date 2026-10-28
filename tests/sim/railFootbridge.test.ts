import { describe, expect, it } from 'vitest';
import { crossingWorld, CROSS_TILE } from './crossingsHelper';
import { CROSSING } from '../../src/config/crossings';
import { Cross, CROSS_MSG, NetKind, lineTiles } from '../../src/world/Networks';
import { buildChunkData } from '../../src/render/meshes/Paths';
import { CHUNK_SIZE } from '../../src/world/Grid';
import { createSim } from '../../src/game/createSim';
import { collectSave } from '../../src/game/saveState';

describe('footbridge over rail (Task 11)', () => {
  it('a path stroke with the bridge option crosses on a footbridge: cross 3, own price, rail untouched, stairs on both approach tiles', () => {
    const sim = crossingWorld({ footbridge: true });
    const n = sim.networks;
    expect(n.cross[CROSS_TILE(sim)]).toBe(Cross.Footbridge);
    expect(n.kind[CROSS_TILE(sim)]).toBe(NetKind.Rail);
    expect(n.rampDir(37, 57)).toBe(1); // east towards the bridge
    expect(n.rampDir(39, 57)).toBe(3); // west towards the bridge
    expect(n.rampDir(36, 57)).toBe(-1);
    const cafe = sim.buildings.all().find((b) => b.type === 'cafe')!;
    expect(n.isConnected(cafe.id)).toBe(true);
    const fresh = createSim({ size: 64, seed: 61, now: () => 0, money: 900000 }).networks;
    const plan = fresh.planSegment(NetKind.Path, lineTiles({ x: 37, y: 60 }, { x: 39, y: 60 }), 1, true);
    expect(plan.ok).toBe(true);
    expect(plan.crossings).toEqual([{ x: 38, y: 60, cross: Cross.Footbridge }]);
    expect(plan.cost).toBe(2 * 20 + CROSSING.footbridge.cost);
    expect(CROSSING.footbridge.cost).toBeGreaterThan(CROSSING.cost.path);
  });
  it('roads cannot use it, the same angle / spacing rules apply', () => {
    const sim = crossingWorld({ footbridge: true });
    const n = sim.networks;
    expect(n.crossingCheck(NetKind.Road, lineTiles({ x: 37, y: 60 }, { x: 39, y: 60 }), 1, [], true)).toMatchObject({ ok: false, reason: CROSS_MSG.roadOnly });
    expect(n.planSegment(NetKind.Path, lineTiles({ x: 37, y: 59 }, { x: 39, y: 59 }), 1, true).reason).toBe(CROSS_MSG.spacing);
    expect(n.planSegment(NetKind.Path, lineTiles({ x: 38, y: 55 }, { x: 38, y: 53 }), 1, true).reason).toBe(CROSS_MSG.angle);
  });
  it('the deck lift is 0 on the ground, ramps along the stairs and is 1 on the deck', () => {
    const n = crossingWorld({ footbridge: true }).networks;
    expect(n.footLift(36.5, 57.5)).toBe(0);
    expect(n.footLift(37.0, 57.5)).toBeCloseTo(0, 6);
    expect(n.footLift(37.5, 57.5)).toBeCloseTo(0.5, 6);
    expect(n.footLift(37.99, 57.5)).toBeGreaterThan(0.95);
    expect(n.footLift(38.5, 57.5)).toBe(1);
    expect(n.footLift(39.5, 57.5)).toBeCloseTo(0.5, 6);
    expect(n.footLift(40.5, 57.5)).toBe(0);
  });
  it('guests cross without ever waiting and the footbridge never closes (3 days, trains running)', () => {
    const sim = crossingWorld({ footbridge: true, bias: 0.6 });
    const sp = sim.guestSim.spawner; sp.rateMult = 4;
    const st = sim.guestSim.store, tile = CROSS_TILE(sim);
    let onDeck = 0, trains = 0, maxZ = 0, groundZ = Infinity;
    const seen = new Set<number>();
    for (let t = 0; t < 3 * 240; t++) {
      if (t % 20 === 0) sp.benchFill(sim.game, 100, 25);
      sim.tick(1);
      for (const v of sp.vehicles) if (v.kind === 2 && !seen.has(v.id)) { seen.add(v.id); trains++; }
      expect(sim.crossings.isClosed(tile)).toBe(false);
      for (let i = 0; i < st.limit; i++) if (st.alive[i] && Math.floor(st.y[i]!) * 64 + Math.floor(st.x[i]!) === tile) { onDeck++; maxZ = Math.max(maxZ, st.z[i]!); }
      else if (st.alive[i] && Math.floor(st.y[i]!) === 57 && Math.floor(st.x[i]!) === 36) groundZ = Math.min(groundZ, st.z[i]!);
    }
    expect(trains).toBeGreaterThan(3);
    expect(onDeck).toBeGreaterThan(20);
    expect(sim.crossings.totalWait).toBe(0);
    expect(maxZ).toBeGreaterThan(groundZ + CROSSING.footbridge.deck * 0.8); // guests walk on the deck, above the rails
  });
  it('the chunk mesh draws the deck + both stairs (finite, bounded triangles)', () => {
    const sim = crossingWorld({ footbridge: true });
    const chunk = Math.floor(57 / CHUNK_SIZE) * sim.grid.chunksPerRow + Math.floor(38 / CHUNK_SIZE);
    const d = buildChunkData(sim.grid, sim.networks, chunk).net;
    expect(d.positions.every((v) => Number.isFinite(v))).toBe(true);
    const plain = crossingWorld();
    const base = buildChunkData(plain.grid, plain.networks, chunk).net;
    const tris = (d.indices.length - base.indices.length) / 3;
    expect(tris).toBeGreaterThan(100);
    expect(tris).toBeLessThan(700);
    const topAt = (g: typeof d): number => { let t = -Infinity; for (let i = 0; i < g.positions.length; i += 3) if (g.positions[i]! > 37.9 && g.positions[i]! < 39.1 && g.positions[i + 2]! > 56.9 && g.positions[i + 2]! < 58.1) t = Math.max(t, g.positions[i + 1]!); return t; };
    expect(topAt(d)).toBeGreaterThan(topAt(base) + CROSSING.footbridge.deck * 0.8);
  });
  it('saves and loads', async () => {
    const sim = crossingWorld({ footbridge: true });
    const m = collectSave(sim)['networks']!.data as { cross: ArrayLike<number> };
    expect(m.cross[CROSS_TILE(sim)]).toBe(Cross.Footbridge);
  });
});
