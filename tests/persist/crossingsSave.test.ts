import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { encodeSave, decodeSave, makeMeta } from '../../src/persist/Serializer';
import { crossingWorld, CROSS_TILE, ROAD_TILE } from '../sim/crossingsHelper';
import { Cross } from '../../src/world/Networks';

const roundTrip = async (sim: ReturnType<typeof createSim>): Promise<ReturnType<typeof createSim>> => {
  const { bytes } = await encodeSave(sim, makeMeta(sim, 'x'), { compress: true, yieldBetween: false });
  const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
  return createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
};

describe('level crossings save / load', () => {
  it('round-trips crossings, their approach arms and the derived state', async () => {
    const a = crossingWorld({ road: true });
    a.tick(40);
    const b = await roundTrip(a);
    expect(Array.from(b.networks.cross)).toEqual(Array.from(a.networks.cross));
    expect(Array.from(b.networks.conn)).toEqual(Array.from(a.networks.conn));
    expect(b.networks.crossCount).toBe(2);
    expect(b.networks.cross[CROSS_TILE(b)]).toBe(Cross.Path);
    expect(b.networks.cross[ROAD_TILE(b)]).toBe(Cross.Road);
    expect(b.crossings.list().length).toBe(2);
    const cafe = b.buildings.all().find((q) => q.type === 'cafe')!;
    expect(b.networks.isConnected(cafe.id)).toBe(true);
    b.tick(60); // keeps running (trains close the crossings, guests walk)
  });
  it('an old v1 networks module (no `cross` key) loads with no crossings', async () => {
    const a = createSim({ size: 64, seed: 61, now: () => 0 });
    const { bytes } = await encodeSave(a, makeMeta(a, 'old'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const mod = env.modules['networks'] as unknown as { version: number; data: Record<string, unknown> };
    expect(mod.data['cross']).toBeUndefined();
    mod.version = 1;
    const b = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    expect(b.networks.crossCount).toBe(0);
    expect(b.crossings.active).toBe(false);
  });
});
