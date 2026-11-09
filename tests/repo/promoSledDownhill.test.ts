/* eslint-disable @typescript-eslint/no-explicit-any -- walks the untyped scenes.json */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Promo sled shot: the follow camera must run DOWNHILL. A tour ride is an out-and-back along the route (route tile 0 = the hut at the top, the
 * run falls from there), the outbound leg is p < 0.5 and the return leg climbs back (`Tour.carriers`). The cue's p0 + the shot's elapsed ticks
 * must stay on the outbound leg. (scripts/promo/capture.ts also asserts at shoot time that the leading carrier's terrain height falls.)
 */
const TICKS_PER_SEC = 240 / 150; // a game day is 150 s = 240 ticks at 1x
describe('promo follow shots go downhill', () => {
  const scenes = JSON.parse(readFileSync('promo/scenes.json', 'utf8'));
  const shots = collect(scenes).filter((s: any) => s.follow && s.cue?.tour);
  it('has the sled follow shot', () => { expect(shots.map((s: any) => s.id)).toContain('s07b-sled'); });
  for (const s of shots) {
    it(`${s.id}: the whole shot stays on the outbound (downhill) leg`, () => {
      const end = s.cue.p0 + (s.len * TICKS_PER_SEC * (s.rate ?? 1)) / s.cue.ticks;
      expect(s.cue.p0).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThan(0.5);
    });
  }
});
function collect(o: any, out: any[] = []): any[] {
  if (Array.isArray(o)) o.forEach((x) => collect(x, out));
  else if (o && typeof o === 'object') { if (typeof o.id === 'string' && 'follow' in o) out.push(o); Object.values(o).forEach((x) => collect(x, out)); }
  return out;
}
