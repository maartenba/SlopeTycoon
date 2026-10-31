/** Phase 6 Task 34 in the real sim: Ski tourers use an open backcountry route (one lift, then up on skins) and never go at danger >= 4, even when the route is open. */
import { describe, expect, it } from 'vitest';
import { makeResort } from './harness';
import { Layer } from '../../src/world/Networks';
import type { Sim } from '../../src/game/createSim';
import { SHIPPED_TYPES, CORE_TYPE_COUNT, TOURER_MAX_DANGER } from '../../src/config/guestTypes';
import { NavMode } from '../../src/sim/guests/NavGraph';

const TOURER = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'tourer');
const WINTER = 167;

/** A route of up to 40 tiles that starts next to the top station of the first lift and climbs. */
function paintFromLiftTop(sim: Sim): number[] {
  const n = sim.size, net = sim.networks, l = sim.lifts.all()[0]!;
  let cur = l.top.y * n + l.top.x;
  const tiles: number[] = [];
  for (let k = 0; k < 80 && tiles.length < 40; k++) {
    const x = cur % n, y = (cur / n) | 0;
    let best = -1, bh = -1e9;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      const j = (y + dy) * n + x + dx;
      if (tiles.includes(j) || (net.layers[j]! & Layer.Ski) || !net.canPaint(x + dx, y + dy, Layer.Backcountry).ok) continue;
      const h = sim.guestSim.world.groundAt(x + dx + 0.5, y + dy + 0.5);
      if (h > bh) { bh = h; best = j; }
    }
    if (best < 0) break;
    tiles.push(best); cur = best;
  }
  net.paint(Layer.Backcountry, tiles.map((t) => ({ x: t % n, y: (t / n) | 0 })));
  return tiles;
}

/** Winter, 300 guests dropped in; returns tourer counts + how many guest-ticks tourers spent on the route. */
function winter(withRoute: boolean, danger?: number): { tourers: number; onRoute: number; hiking: number; tiles: number[]; sim: Sim } {
  const { sim } = makeResort(64, 3, { startDay: WINTER });
  const tiles = withRoute ? paintFromLiftTop(sim) : [];
  if (danger !== undefined) sim.backcountry.dangerOf = () => danger; // the route stays OPEN (an override): tourers must still stay away at 4+
  sim.guestSim.spawner.levelFn = () => 99; sim.guestSim.spawner.rateMult = 14;
  sim.guestSim.spawner.benchFill(sim.game, 300, 300);
  const out = { tourers: 0, onRoute: 0, hiking: 0, tiles, sim };
  const n = sim.size, seen = new Set<number>();
  for (let t = 0; t < 1800; t++) {
    sim.registry.update(sim.game, sim.game.date.tick + 1);
    const s = sim.guestSim.store;
    for (let i = 0; i < s.limit; i++) {
      if (!s.alive[i] || s.type[i] !== TOURER) continue;
      seen.add(s.id[i]!);
      if (s.moveMode[i] === NavMode.Hike) out.hiking++;
      if (tiles.includes((s.y[i]! | 0) * n + (s.x[i]! | 0))) out.onRoute++;
    }
  }
  out.tourers = seen.size;
  return out;
}

describe('Ski tourer in a real winter resort', () => {
  it('no route: no tourers at all', () => {
    expect(winter(false).tourers).toBe(0);
  });
  it('an open route below danger 4: tourers appear, ride up and skin onto the route', () => {
    const r = winter(true);
    expect(r.sim.backcountry.count).toBe(1);
    expect(r.sim.backcountry.openRoutes().length).toBe(1);
    expect(r.tourers).toBeGreaterThan(0);
    expect(r.onRoute).toBeGreaterThan(0);
    expect(r.hiking).toBeGreaterThan(0);
  }, 120_000);
  it('an OPEN route at danger >= 4 (override): no tourers spawn and none goes out on it', () => {
    const r = winter(true, TOURER_MAX_DANGER);
    expect(r.sim.backcountry.openRoutes().length).toBe(1); // still open
    expect(r.sim.guestSim.decider.touring.safeRoutes()).toEqual([]);
    expect(r.tourers).toBe(0);
    expect(r.onRoute).toBe(0);
  }, 120_000);
});
