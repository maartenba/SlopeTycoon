/** Property: the ghost verdict (validatePlacement warnings) always equals the real post-placement verdict (Buildings.active/reason). */
import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { Grid } from '../../src/world/Grid';
import { Networks, NetKind, lineTiles } from '../../src/world/Networks';
import { Buildings } from '../../src/sim/Buildings';
import { Economy } from '../../src/sim/Economy';
import { validatePlacement, placeBuilding } from '../../src/build/PlacementTool';
import { isAccessReason } from '../../src/sim/PlacementRules';
import { Rng } from '../../src/core/Rng';

const mk = () => {
  const grid = new Grid(64);
  const buildings = new Buildings(grid.occupancy);
  const economy = new Economy({ money: 1e9 });
  const net = new Networks(grid, buildings);
  buildings.setNetwork({ pathDistance: net.pathDistance, roadConnected: net.roadConnected, access: net.access });
  net.roadEntry = { x: 0, y: 32 };
  net.railEntry = { x: 0, y: 40 };
  return { grid, buildings, economy, net, env: { grid, buildings, economy } };
};

describe('ghost verdict equals post-placement verdict', () => {
  const ids = Object.keys(BUILDINGS).filter((id) => BUILDINGS[id]!.access !== 'none');
  it('random placements around roads / footpaths / disconnected paths / diagonals', () => {
    const rng = new Rng(12345);
    let checked = 0;
    for (let round = 0; round < 40; round++) {
      const { env, net, buildings } = mk();
      for (const t of lineTiles({ x: 0, y: 32 }, { x: 40, y: 32 })) net.build(NetKind.Road, t.x, t.y);
      for (let k = 0; k < 4; k++) { // random footpath stubs, some linked, some not
        const x0 = 5 + Math.floor(rng.next() * 50), y0 = 5 + Math.floor(rng.next() * 50);
        const horiz = rng.next() < 0.5, len = 2 + Math.floor(rng.next() * 8);
        for (let i = 0; i < len; i++) net.build(NetKind.Path, horiz ? x0 + i : x0, horiz ? y0 : y0 + i);
      }
      for (let n = 0; n < 12; n++) {
        const id = ids[Math.floor(rng.next() * ids.length)]!;
        const rot = Math.floor(rng.next() * 4);
        const x = 4 + Math.floor(rng.next() * 52), y = 4 + Math.floor(rng.next() * 52);
        const v = validatePlacement(env, id, x, y, rot);
        if (!v.ok) continue;
        const res = placeBuilding(env, undefined, id, x, y, rot);
        if (!res.ok || !res.building) continue;
        buildings.reevaluate();
        const b = buildings.get(res.building.id)!;
        const previewAccess = v.warnings.find((w) => isAccessReason(w));
        if (previewAccess) { expect(b.active, `${id} rot${rot} @${x},${y}`).toBe(false); expect(b.reason).toBe(previewAccess); }
        else if (!v.warnings.length) expect(b.active, `${id} rot${rot} @${x},${y}: ${b.reason}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('precise hints: corner-only, unlinked footpath, one-tile gap, side-adjacent = no problem', () => {
    const { env, net } = mk();
    for (const t of lineTiles({ x: 0, y: 32 }, { x: 20, y: 32 })) net.build(NetKind.Road, t.x, t.y);
    for (const t of lineTiles({ x: 10, y: 31 }, { x: 10, y: 20 })) net.build(NetKind.Path, t.x, t.y); // linked footpath, top end (10,20)
    for (const t of lineTiles({ x: 40, y: 10 }, { x: 40, y: 20 })) net.build(NetKind.Path, t.x, t.y); // island, not linked
    const hint = (id: string, x: number, y: number, rot = 0) => {
      const v = validatePlacement(env, id, x, y, rot);
      return { warn: v.warnings.filter(isAccessReason), info: v.info.join('|') };
    };
    const w = BUILDINGS.apresBar!.w, h = BUILDINGS.apresBar!.h;
    expect(hint('apresBar', 11, 22).warn).toEqual([]); // beside the path
    const corner = hint('apresBar', 11, 20 - h); // footprint corner (11,19+..) diagonal to path end (10,20)
    expect(corner.warn.length).toBe(1);
    expect(corner.info).toMatch(/touches only the corner/);
    expect(hint('apresBar', 12, 22).info).toMatch(/one tile away/);
    const unlinked = hint('apresBar', 41, 12);
    expect(unlinked.warn.length).toBe(1);
    expect(unlinked.info).toMatch(/Needs a connected footpath/);
    expect(hint('apresBar', 50, 50).info).toBe('');
    void w;
  });
});
