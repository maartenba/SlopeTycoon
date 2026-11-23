import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { encodeSave, decodeSave, makeMeta } from '../../src/persist/Serializer';
import { applySave, stateHash } from '../../src/game/saveState';
import { advanceTo, nextSaturday, mkSummer, prepareDownhill } from '../sim/race/helpers';

describe('downhill course save / load and race day (0.8.2)', () => {
  it('a Downhill Race books in summer (not winter wording), closes the trail, saves mid-race and reloads identically', async () => {
    const s = mkSummer(); const { id } = prepareDownhill(s, 3);
    expect(s.setRunCourse(id, true).ok).toBe(true); s.guestSim.spawner.rateMult = 4; s.tick(1);
    const sat = nextSaturday(s);
    expect(s.bookRaceDay(id, sat)).toBeNull();
    advanceTo(s, sat, 11.5);
    expect(s.raceDay.session?.mtb).toBe(true);
    expect(s.openStatus.activeClosures(s.safety.incidents.nowTick ?? 0).some((c) => c.reason === 'Race day')).toBe(true);
    const { bytes } = await encodeSave(s, makeMeta(s, 'x'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const a = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    applySave(s, structuredClone(env.modules));
    a.guestSim.spawner.rateMult = 4;
    expect(a.race.courses().map((c) => [c.id, c.mtb, c.valid])).toEqual(s.race.courses().map((c) => [c.id, c.mtb, c.valid]));
    const differing = (): string[] => { const x = stateHash(s).parts, y = stateHash(a).parts; return Object.keys({ ...x, ...y }).filter((k) => x[k] !== y[k]); };
    expect(differing()).toEqual([]);
    for (let d = 0; d < 120; d += 20) { s.ops.quality.attachTraffic(); s.tick(20); a.ops.quality.attachTraffic(); a.tick(20); expect(differing(), `after ${d + 20} ticks`).toEqual([]); }
    expect(a.raceDay.results.length).toBe(1); expect(a.raceDay.results[0]).toEqual(s.raceDay.results[0]);
  }, 180_000);
});
