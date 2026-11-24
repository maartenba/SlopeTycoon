import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { encodeSave, decodeSave, makeMeta } from '../../src/persist/Serializer';
import { applySave, stateHash } from '../../src/game/saveState';
import { mkWinter, mainRun, paintRun } from '../sim/race/helpers';

describe('run names follow a repaint (0.8.2)', () => {
  it('blue -> red renames the auto name, a custom name stays, and a save reloads identically', async () => {
    const s = mkWinter();
    paintRun(s, mainRun(s), 1); // blue
    const blue = s.names.pisteName(mainRun(s));
    expect(blue).toMatch(/^Blue Run \d+$/);
    paintRun(s, mainRun(s), 2); // red
    const red = s.names.pisteName(mainRun(s));
    expect(red).toMatch(/^Red Run \d+$/);
    const { bytes } = await encodeSave(s, makeMeta(s, 'x'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const a = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    applySave(s, structuredClone(env.modules));
    expect(a.names.pisteName(mainRun(a))).toBe(red);
    expect(stateHash(a).hash).toBe(stateHash(s).hash);
    s.names.renamePiste(mainRun(s), 'Eagle');
    paintRun(s, mainRun(s), 3);
    expect(s.names.pisteName(mainRun(s))).toBe('Eagle');
  }, 120_000);
});
