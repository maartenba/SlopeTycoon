import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { encodeSave, decodeSave, makeMeta } from '../../src/persist/Serializer';
import { applySave, stateHash } from '../../src/game/saveState';
import { mainRun, parkFixture } from '../sim/park/helpers';

describe('snow park save / load', () => {
  it('keeps the park flag, the shape and the laps; a reloaded sim runs on identically to the control for two days', async () => {
    const { s, id } = parkFixture(1, 5);
    s.setRunPark(id, true); s.guestSim.spawner.rateMult = 6;
    for (let d = 0; d < 3; d++) { for (const t of mainRun(s).tiles) s.ops.quality.groom(t); s.tick(240); }
    expect(s.park.total).toBeGreaterThan(0);
    const { bytes } = await encodeSave(s, makeMeta(s, 'x'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const a = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    applySave(s, structuredClone(env.modules));
    a.guestSim.spawner.rateMult = 6;
    expect(a.runSettings.parkIds()).toEqual([id]);
    expect(a.park.serialize()).toEqual(s.park.serialize());
    const differing = (): string[] => { const x = stateHash(s).parts, y = stateHash(a).parts; return Object.keys({ ...x, ...y }).filter((k) => x[k] !== y[k]); };
    expect(differing()).toEqual([]);
    for (let d = 0; d < 480; d += 40) { s.ops.quality.attachTraffic(); s.tick(40); a.ops.quality.attachTraffic(); a.tick(40); expect(differing(), `after ${d + 40} ticks`).toEqual([]); }
  }, 120_000);
  it('an old save without the module loads with no park', async () => {
    const s = createSim({ size: 64, seed: 61, starterResort: true, now: () => 0 });
    s.tick(40);
    expect(stateHash(s).parts['snowPark']).toBeUndefined();
    const { bytes } = await encodeSave(s, makeMeta(s, 'old'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    delete (env.modules as Record<string, unknown>)['snowPark'];
    const b = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    expect(b.park.parks().length).toBe(0); expect(b.park.total).toBe(0);
    b.tick(20);
  });
});
