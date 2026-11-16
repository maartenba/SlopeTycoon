import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { encodeSave, decodeSave, makeMeta } from '../../src/persist/Serializer';
import { applySave, stateHash } from '../../src/game/saveState';
import { courseFixture } from '../sim/race/helpers';


describe('race course save / load', () => {
  it('keeps the course flag, the racer laps and the board; two loads of one save run on identically for two days', async () => {
    const f = courseFixture(3); const s = f.s;
    s.setRunCourse(f.id, true); s.guestSim.spawner.rateMult = 8;
    for (let d = 0; d < 3; d++) { s.runSettings.noteGroomed(f.id, s.game.date.year * 180 + s.game.date.day); s.tick(240); }
    expect(s.race.total).toBeGreaterThan(0);
    const { bytes } = await encodeSave(s, makeMeta(s, 'x'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const a = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    applySave(s, structuredClone(env.modules)); // control: the same save applied in place (documented demotions apply to both)
    a.guestSim.spawner.rateMult = 8; // (the test knob is not saved)
    expect(a.runSettings.courseIds()).toEqual(s.runSettings.courseIds());
    expect(a.race.serialize()).toEqual(s.race.serialize());
    expect(a.race.courses().length).toBe(1);
    const differing = (): string[] => { const x = stateHash(s).parts, y = stateHash(a).parts; return Object.keys({ ...x, ...y }).filter((k) => x[k] !== y[k]); };
    expect(differing()).toEqual([]);
    for (let d = 0; d < 480; d += 40) { s.ops.quality.attachTraffic(); s.tick(40); a.ops.quality.attachTraffic(); a.tick(40); expect(differing(), `after ${d + 40} ticks`).toEqual([]); }
  }, 120_000);
  it('a save without a course has no `raceCourse` data and no `course` key (hashes of old resorts stay put); an old save loads with no courses', async () => {
    const s = createSim({ size: 64, seed: 61, starterResort: true, now: () => 0 });
    s.tick(40);
    expect(s.race.serialize()).toBeNull();
    expect(s.runSettings.serialize().course).toBeUndefined();
    expect(stateHash(s).parts['raceCourse']).toBeUndefined();
    const { bytes } = await encodeSave(s, makeMeta(s, 'old'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    delete (env.modules as Record<string, unknown>)['raceCourse'];
    const b = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    expect(b.race.courses().length).toBe(0); expect(b.race.total).toBe(0);
    b.tick(20);
  });
});
