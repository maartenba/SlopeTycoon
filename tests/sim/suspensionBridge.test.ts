import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { Layer, NetKind, lineTiles, interpolateStroke } from '../../src/world/Networks';
import { buildStroke, buildTrailStroke, describeExtras, planStroke, planTrailStroke } from '../../src/world/StrokePlan';
import { planBridge } from '../../src/world/Bridges';
import { TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { BRIDGES, BRIDGE_MSG, SUSPENSION, REGULAR_MAX_SPAN } from '../../src/config/bridges';
import { lockedReason, unlockLevel } from '../../src/config/unlocks';
import { HEIGHT_UNIT } from '../../src/config/balance';
import { NavMode } from '../../src/sim/guests/NavGraph';
import { Undo } from '../../src/build/UndoActions';
import { encodeSave, decodeSave, makeMeta } from '../../src/persist/Serializer';
import { bridgeTileGeometry, BRIDGE_SNOW_U } from '../../src/render/meshes/bridges';

/**
 * Task 46 part 2: the suspension footbridge. Fixture: x 24..58 / y 38..53 levelled to 8, a footpath (y 47) and a hiking trail (y 49) coming from the west
 * bank (x 23..28), and a gorge: tiles x 30..(29 + w) are dug down to height 0 (a dry gap) or flooded at height 4 (a lake).
 */
function gorgeWorld(w: number, mode: 'gap' | 'lake' = 'gap', summer = true): Sim {
  const sim = createSim({ size: 64, seed: 61, now: () => 0, money: 900000, ...(summer ? { startSeason: 'summer' as const } : {}) });
  const g = sim.grid;
  for (let vy = 38; vy <= 53; vy++) for (let vx = 20; vx <= 58; vx++) g.setCornerUnchecked(vx, vy, 8);
  const x0 = 30, x1 = 29 + w; // gorge tiles x0..x1
  for (let vy = 38; vy <= 53; vy++) for (let vx = x0; vx <= x1 + 1; vx++) g.setCornerUnchecked(vx, vy, vx === x0 || vx === x1 + 1 ? 6 : mode === 'lake' ? 4 : 0); // shores (spread 2) + the bed
  if (mode === 'lake') for (let y = 38; y <= 52; y++) for (let x = x0; x <= x1; x++) { g.tileType[g.tileIndex(x, y)] = TileType.Water; g.occupancy.set(x, y, OccFlag.Water); }
  const n = sim.networks;
  n.roadEntry = { x: 21, y: 46 };
  n.buildSegment(NetKind.Road, lineTiles({ x: 21, y: 46 }, { x: 25, y: 46 }));
  n.buildSegment(NetKind.Path, lineTiles({ x: 21, y: 47 }, { x: 29, y: 47 }));
  n.buildSegment(NetKind.Path, lineTiles({ x: 25, y: 48 }, { x: 25, y: 49 }));
  n.paint(Layer.Hike, lineTiles({ x: 25, y: 49 }, { x: 29, y: 49 }), 0);
  return sim;
}
const row = (a: number, b: number, y: number) => lineTiles({ x: a, y }, { x: b, y });
/** Far bank x for a gorge of width w (the first dry tile east of it). */
const far = (w: number): number => 30 + w;

describe('suspension footbridge: planner', () => {
  it('footpath: a 7-tile gorge becomes a suspension footbridge ($400 / tile + $800 base), ghost names span, deck level and cost', () => {
    const sim = gorgeWorld(7); const n = sim.networks, g = sim.grid;
    const plan = planStroke(n, g, 'path', row(27, far(7) + 2, 47));
    expect(plan.ok, plan.reason).toBe(true);
    expect(plan.bridges).toHaveLength(1);
    const b = plan.bridges[0]!;
    expect(b.kind).toBe('suspensionFoot'); expect(b.span).toHaveLength(7); expect(b.deck).toBe(8);
    expect(b.spanCost).toBe(7 * 400 + 800);
    expect(describeExtras(plan)).toContain('Suspension footbridge: span 7 tiles, deck level 8, $3600');
  });
  it('hiking trail: the same drag over a lake is a suspension hike bridge; MTB and road keep their own limits', () => {
    const sim = gorgeWorld(8, 'lake'); const n = sim.networks, g = sim.grid;
    const hike = planTrailStroke(n, g, 'hike', interpolateStroke(row(27, far(8) + 2, 49)));
    expect(hike.ok, hike.reason).toBe(true);
    expect(hike.bridges[0]!.kind).toBe('suspensionHike'); expect(hike.bridges[0]!.span).toHaveLength(8);
    const mtb = planTrailStroke(n, g, 'mtb', interpolateStroke(row(27, far(8) + 2, 50)));
    expect(mtb.ok).toBe(false); expect(mtb.reason).toBe(BRIDGE_MSG.tooLong(4)); // no bikes on a suspension bridge
    const road = planStroke(n, g, 'road', row(23, far(8) + 2, 46));
    expect(road.ok).toBe(false); expect(road.reason).toBe(BRIDGE_MSG.tooLong(3));
  });
  it('spans: 4 stays a regular bridge, 5 and 12 are suspension, 13 is refused with the max', () => {
    for (const [w, ok, kind] of [[4, true, 'footbridge'], [5, true, 'suspensionFoot'], [12, true, 'suspensionFoot'], [13, false, '']] as const) {
      const sim = gorgeWorld(w, 'lake'); const plan = planStroke(sim.networks, sim.grid, 'path', row(27, far(w) + 2, 47));
      expect(plan.ok, `${w}: ${plan.reason}`).toBe(ok);
      if (ok) expect(plan.bridges[0]!.kind).toBe(kind); else expect(plan.reason).toBe(BRIDGE_MSG.tooLong(12));
    }
    expect(REGULAR_MAX_SPAN).toBe(4); expect(BRIDGES.suspensionFoot.maxSpan).toBe(12);
  });
  it('refusal reasons: banks too uneven, a shallow dip is not a gorge', () => {
    const sim = gorgeWorld(6, 'lake'); const n = sim.networks, g = sim.grid;
    for (let vy = 38; vy <= 53; vy++) for (let vx = 20; vx <= 58; vx++) if (vx <= 30 || vx >= far(6)) g.setCornerUnchecked(vx, vy, vx <= 29 ? 12 : vx === 30 ? 10 : vx === far(6) ? 4 : 2); // the near bank is 8 half-steps above the far one
    const bad = planBridge(n, g, 'suspensionFoot', { x: 29, y: 47 }, { x: far(6), y: 47 });
    expect(bad.ok).toBe(false); expect(bad.reason).toBe(BRIDGE_MSG.uneven);
    const shallow = gorgeWorld(6, 'gap'); // dip only 3 deep: not a gorge for a suspension bridge (needs 4)
    for (let vy = 38; vy <= 53; vy++) for (let vx = 31; vx <= 35; vx++) shallow.grid.setCornerUnchecked(vx, vy, 5);
    const p = planStroke(shallow.networks, shallow.grid, 'path', row(27, far(6) + 2, 47));
    expect(p.ok).toBe(false);
  });
  it('config: spec numbers', () => {
    expect(BRIDGES.suspensionHike.layer).toBe('hike'); expect(BRIDGES.suspensionFoot.layer).toBe('path');
    expect(BRIDGES.suspensionFoot.costPerTile).toBeGreaterThan(BRIDGES.footbridge.costPerTile);
    expect(BRIDGES.suspensionFoot.clearance).toBeGreaterThanOrEqual(2);
  });
});

describe('suspension footbridge: career unlock', () => {
  it('level 3 in Career; locked drags say so (regular bridges stay free), unlocked drags plan', () => {
    const sim = gorgeWorld(7); const n = sim.networks, g = sim.grid;
    expect(unlockLevel('landscape', 'suspension')).toBe(3);
    const lock = lockedReason(3);
    const p = planStroke(n, g, 'path', row(27, far(7) + 2, 47), 1, 'level', lock);
    expect(p.ok).toBe(false); expect(p.reason).toBe(lock);
    const lake = gorgeWorld(7, 'lake'); // over water a trail is never silently painted: it gets the lock reason (a dry gap is just painted, as before)
    const t = planTrailStroke(lake.networks, lake.grid, 'hike', interpolateStroke(row(27, far(7) + 2, 49)), 1, 'level', lock);
    expect(t.ok).toBe(false); expect(t.reason).toBe(lock);
    const small = gorgeWorld(3, 'lake'); // regular footbridge: never gated
    expect(planStroke(small.networks, small.grid, 'path', row(27, far(3) + 2, 47), 1, 'level', lock).ok).toBe(true);
  });
});

describe('suspension footbridge: record, undo, save / load, bulldoze', () => {
  it('builds a record with the deck sagging mid-span; undo / redo one step; save / load; bulldoze refunds half', async () => {
    const sim = gorgeWorld(8); const n = sim.networks, g = sim.grid;
    const plan = planStroke(n, g, 'path', row(27, far(8) + 2, 47));
    expect(plan.ok, plan.reason).toBe(true);
    const undo = new Undo(sim);
    const before = sim.economy.money;
    n.beginJournal(); expect(sim.economy.charge(plan.cost)).toBe(true);
    buildStroke(n, 'path', plan);
    undo.recordNetwork('Path', 'placed', n.endJournal(), plan.cost);
    expect(sim.economy.money).toBe(before - plan.cost);
    const rec = n.liveBridges()[0]!;
    expect(rec.kind).toBe('suspensionFoot'); expect(rec.cost).toBe(plan.bridges[0]!.cost);
    const endY = n.deckAlong(rec, 0.5), midY = n.deckAlong(rec, 4.5), at5 = n.deckAlong(rec, 5);
    expect(endY).toBeCloseTo(rec.deck * HEIGHT_UNIT, 6);
    expect(midY).toBeLessThan(endY); expect(endY - midY).toBeLessThanOrEqual(SUSPENSION.sagMax + 1e-9);
    expect(undo.undo().ok).toBe(true); expect(n.bridgeTiles).toBe(0);
    expect(undo.redo().ok).toBe(true); expect(n.bridgeTiles).toBe(8);
    const { bytes } = await encodeSave(sim, makeMeta(sim, 'x'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const b = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    expect(b.networks.liveBridges()[0]!.kind).toBe('suspensionFoot'); expect(b.networks.bridgeTiles).toBe(8);
    expect(b.networks.deckY(34.5, 47.5)).toBeCloseTo(at5, 5);
    n.removeBridge(n.bridgeAt(34, 47)!.id);
    expect(n.bridgeTiles).toBe(0);
  });
});

describe('suspension footbridge: guests', () => {
  const nav = (sim: Sim) => { sim.tick(5); const gr = sim.guestSim.graph()!; gr.update(0); gr.pf.maxBuildsPerTick = Infinity; return gr; };
  const idx = (x: number, y: number): number => y * 64 + x;
  it('walkers cross the footpath variant, hikers the hiking variant, nobody bikes over either', () => {
    const sim = gorgeWorld(7); const n = sim.networks, g = sim.grid;
    const pf = planStroke(n, g, 'path', row(27, far(7) + 3, 47)); buildStroke(n, 'path', pf);
    const ph = planTrailStroke(n, g, 'hike', interpolateStroke(row(27, far(7) + 3, 49)));
    expect(ph.ok, ph.reason).toBe(true); buildTrailStroke(n, 'hike', ph);
    expect(n.liveBridges().map((b) => b.kind).sort()).toEqual(['suspensionFoot', 'suspensionHike']);
    const gr = nav(sim);
    expect(gr.pf.find(NavMode.Walk, idx(28, 47), idx(far(7) + 2, 47))).toBeTruthy();
    expect(gr.pf.find(NavMode.Hike, idx(28, 49), idx(far(7) + 2, 49))).toBeTruthy();
    expect(gr.pf.find(NavMode.Bike, idx(28, 49), idx(far(7) + 2, 49)) ?? null).toBeNull();
  });
  it('the hiking variant is a viewpoint at mid-span (high view, goal tile on the deck); the footpath variant adds none', () => {
    const sim = gorgeWorld(8); const n = sim.networks, g = sim.grid;
    const dec = sim.guestSim.decider;
    const none = nav(sim); void none; dec.refresh([]);
    expect(dec.goals.pois.filter((p) => p.kind === 4)).toHaveLength(0); // inert without a bridge
    buildStroke(n, 'path', planStroke(n, g, 'path', row(27, far(8) + 3, 47)));
    buildTrailStroke(n, 'hike', planTrailStroke(n, g, 'hike', interpolateStroke(row(27, far(8) + 3, 49))));
    nav(sim); dec.refresh([]);
    const hb = n.liveBridges().find((b) => b.kind === 'suspensionHike')!;
    const mid = hb.span[hb.span.length >> 1]!;
    const pois = dec.goals.pois.filter((p) => p.kind === 4);
    expect(pois).toHaveLength(1);
    expect(pois[0]!.tile).toBe(idx(mid.x, mid.y)); expect(pois[0]!.viewId).toBe(-hb.id);
    expect(pois[0]!.view!).toBeGreaterThanOrEqual(SUSPENSION.viewpoint.floor ?? 0);
    const v = dec.viewAt(pois[0]!.tile)!;
    expect(v.score).toBeGreaterThan(0.3); expect(dec.viewDwell(pois[0]!.tile)).toBeGreaterThan(0.05);
  });
});

describe('suspension footbridge: mesh', () => {
  it('a 12-tile bridge stays under 500 triangles, deck tops carry the snow tint, summer and winter use the same geometry', () => {
    const sim = gorgeWorld(12, 'lake'); const n = sim.networks, g = sim.grid;
    const plan = planStroke(n, g, 'path', row(27, far(12) + 1, 47)); expect(plan.ok, plan.reason).toBe(true);
    buildStroke(n, 'path', plan);
    const geo = (): { positions: number[]; uvs: number[]; colors: number[]; indices: number[] } => ({ positions: [], uvs: [], colors: [], indices: [] });
    const d = geo(), bridgeOnly = (): number => { const o = geo(); for (let x = 28; x <= far(12) + 1; x++) bridgeTileGeometry(o, g, n, () => 0, x, 47); return o.indices.length / 3; };
    for (let x = 28; x <= far(12) + 1; x++) bridgeTileGeometry(d, g, n, () => 0, x, 47);
    const tris = d.indices.length / 3;
    expect(bridgeOnly()).toBe(tris);
    expect(tris).toBeGreaterThan(12 * 14);
    expect(tris).toBeLessThanOrEqual(400); // towers + catenary cables + hangers + plank deck, the whole 12-tile bridge incl. both ramps
    // deck tops carry the winter-snow u (NET_SNOW tint) like every other bridge
    expect(d.uvs.filter((_, k) => k % 2 === 0).some((u) => Math.abs(u - BRIDGE_SNOW_U) < 1e-9)).toBe(true);
  });
});
