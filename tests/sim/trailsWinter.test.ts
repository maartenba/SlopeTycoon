import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import { Layer } from '../../src/world/Networks';
import { seasonStartDay } from '../../src/sim/Clock';

describe('trails are buildable year-round', () => {
  it('MTB and hiking trails paint in deep winter (snow cover does not block)', () => {
    const sim = createSim({ size: 64, seed: 61, startDay: seasonStartDay('winter') + 20, now: () => 0 });
    buildStarterResort(sim);
    const n = sim.networks, size = sim.size;
    let anchor = -1;
    for (let i = 0; i < size * size; i++) if (n.kind[i] === 1 /* path */) { anchor = i; break; }
    expect(anchor).toBeGreaterThanOrEqual(0);
    const x = anchor % size, y = (anchor / size) | 0;
    for (const layer of [Layer.Mtb, Layer.Hike]) {
      const tiles = [{ x, y }, { x: x + 1, y }, { x: x + 2, y }].filter((t) => n.canPaint(t.x, t.y, layer).ok);
      expect(tiles.length).toBeGreaterThan(0);
      expect(n.strokeAnchored(tiles, layer)).toBe(true);
      const r = n.paint(layer, tiles);
      expect(r.painted).toBeGreaterThan(0);
      expect(n.layers[tiles[0]!.y * size + tiles[0]!.x]! & layer).toBeTruthy();
    }
  });
});
