/** Phase 6 Task 32 in the real sim: the paintable Backcountry layer, closing, navigation, save / load (docs/backcountry.md). */
import { describe, expect, it } from 'vitest';
import { makeResort, run } from './harness';
import { createSim, type Sim } from '../../src/game/createSim';
import { applySave, stateHash } from '../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { Layer, BACKCOUNTRY_COST_PER_TILE } from '../../src/world/Networks';
import { unlockLevel } from '../../src/config/unlocks';
import { NavMode } from '../../src/sim/guests/NavGraph';
import { fillGroundMask } from '../../src/render/groundMask';
import { flagTiles } from '../../src/render/BackcountryFlags';

const WINTER = 167;

/** Paint a 10-tile backcountry line that starts next to the starter piste. */
function paintRoute(sim: Sim): number[] {
  const n = sim.size, net = sim.networks;
  let start = -1;
  for (let i = 0; i < n * n && start < 0; i++) if ((net.layers[i]! & Layer.Ski) && net.kind[i] === 0) start = i;
  expect(start).toBeGreaterThanOrEqual(0);
  // walk away from the piste over free ground
  const tiles: number[] = [];
  const seen = new Set<number>([start]);
  let cur = start;
  for (let k = 0; k < 40 && tiles.length < 10; k++) {
    const x = cur % n, y = (cur / n) | 0;
    let next = -1;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= n - 1 || ny >= n - 1) continue;
      const j = ny * n + nx;
      if (seen.has(j) || (net.layers[j]! & Layer.Ski) || !net.canPaint(nx, ny, Layer.Backcountry).ok) continue;
      next = j; break;
    }
    if (next < 0) break;
    seen.add(next); tiles.push(next); cur = next;
  }
  expect(tiles.length).toBeGreaterThanOrEqual(6);
  const res = net.paint(Layer.Backcountry, tiles.map((t) => ({ x: t % n, y: (t / n) | 0 })));
  expect(res.painted).toBe(tiles.length);
  return tiles;
}

describe('backcountry layer', () => {
  it('is a separate bit: painting, attaching to a piste, erasing, ground mask and level-3 unlock', () => {
    const { sim } = makeResort(64, 3, { startDay: WINTER });
    expect(Layer.Backcountry).toBe(8);
    expect(unlockLevel('landscape', 'backcountry')).toBe(3);
    expect(BACKCOUNTRY_COST_PER_TILE).toBeGreaterThan(10);
    expect(sim.backcountry.count).toBe(0);
    const tiles = paintRoute(sim);
    const net = sim.networks;
    expect(net.isAnchoredTile(tiles[0]! % sim.size, (tiles[0]! / sim.size) | 0, Layer.Backcountry)).toBe(true);
    expect(net.attachedToNetwork(tiles)).toBe(true);
    for (const t of tiles) { expect(net.layers[t]! & Layer.Backcountry).toBe(8); expect(net.layers[t]! & Layer.Ski).toBe(0); }
    expect(sim.backcountry.count).toBe(1);
    expect(sim.backcountry.routeTiles(sim.backcountry.routes()[0]!.id)).toHaveLength(tiles.length);
    const mask = new Uint8Array(sim.size * sim.size * 4);
    fillGroundMask(mask, net, []);
    for (const t of tiles) { expect(mask[t * 4 + 2]).toBe(255); expect(mask[t * 4]).toBe(0); }
    // pistes are not affected: the route is not a piste (no run, no piste status)
    expect(sim.runIndex.runs().length).toBeGreaterThan(0);
    const t0 = tiles[0]!;
    expect(sim.pisteReportAt(t0 % sim.size, (t0 / sim.size) | 0)).toBeFalsy();
    // erase one end tile
    expect(net.unpaint(Layer.Backcountry, tiles.at(-1)! % sim.size, (tiles.at(-1)! / sim.size) | 0)).toBe(true);
    expect(sim.backcountry.routes()[0]!.tiles).toHaveLength(tiles.length - 1);
    expect(flagTiles(tiles, sim.size).length).toBeGreaterThanOrEqual(2);
    expect(flagTiles(tiles, sim.size).length).toBeLessThan(tiles.length);
  });

  it('a route over water or a building is refused', () => {
    const { sim } = makeResort(64, 3, { startDay: WINTER });
    const n = sim.size;
    for (let i = 0; i < n * n; i++) if (sim.grid.tileType[i] === 2) { expect(sim.networks.canPaint(i % n, (i / n) | 0, Layer.Backcountry).ok).toBe(false); break; }
    const b = sim.buildings.all()[0]!;
    expect(sim.networks.canPaint(b.x, b.y, Layer.Backcountry).ok).toBe(false);
  });

  it('a closed route has no users: its tiles are in the closed mask and no skier path enters them; an open low-danger route is preferred off-piste', () => {
    const { sim } = makeResort(64, 3, { startDay: WINTER });
    const tiles = paintRoute(sim), n = sim.size;
    sim.safety.avalanche.update(0, 10, 0, 0);
    const bc = sim.backcountry, id = bc.routes()[0]!.id;
    sim.cond.skiOpen.fill(1); // snow everywhere for this check
    bc.refresh();
    expect(bc.isOpen(id)).toBe(true);
    for (const t of tiles) expect(sim.openStatus.isTileClosed(t)).toBe(false);
    for (const t of tiles) sim.safety.avalanche.inst[t] = 2.5;
    bc.refresh();
    expect(bc.isOpen(id)).toBe(false);
    expect(bc.route(id)!.closedReason).toMatch(/^Avalanche danger [45]$/);
    for (const t of tiles) expect(sim.openStatus.isTileClosed(t)).toBe(true);
    const g = sim.guestSim.graph()!;
    const a = tiles[1]!, b = tiles[0]!; // downhill / uphill does not matter: a closed tile is never entered
    expect(g.step(NavMode.SkiOff, a, b)).toBe(-1);
    expect(g.step(NavMode.SkiOff, b, a)).toBe(-1);
    // override: open again, and the mask clears
    bc.setOverride(id, true);
    expect(bc.isOpen(id)).toBe(true);
    for (const t of tiles) expect(sim.openStatus.isTileClosed(t)).toBe(false);
    void n;
  });

  it('save -> load -> ticks equals the control; no routes = no module in the state hash (old saves unchanged)', async () => {
    const { sim } = makeResort(64, 3, { startDay: WINTER });
    run(sim, { days: 0.3 });
    expect(stateHash(sim).parts.backcountry).toBeUndefined();
    const tiles = paintRoute(sim);
    sim.backcountry.setOverride(sim.backcountry.routes()[0]!.id, true);
    expect(stateHash(sim).parts.backcountry).toBeDefined();
    run(sim, { days: 0.2 });
    const { bytes } = await encodeSave(sim, makeMeta(sim, 'bc'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const restored = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    expect(restored.backcountry.routes().map((r) => [r.id, r.override])).toEqual(sim.backcountry.routes().map((r) => [r.id, r.override]));
    expect(restored.backcountry.routes()[0]!.tiles).toHaveLength(tiles.length);
    applySave(sim, structuredClone(env.modules)); // control
    expect(stateHash(restored).parts.backcountry).toBe(stateHash(sim).parts.backcountry);
    for (let k = 0; k < 4; k++) {
      sim.ops.quality.attachTraffic(); sim.tick(60);
      restored.ops.quality.attachTraffic(); restored.tick(60);
      const x = stateHash(sim).parts, y = stateHash(restored).parts;
      expect(Object.keys(x).filter((m) => x[m] !== y[m])).toEqual([]);
    }
  }, 120_000);
});
