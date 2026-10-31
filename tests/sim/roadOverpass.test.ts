import { describe, expect, it } from 'vitest';
import { crossingWorld } from './crossingsHelper';
import { CROSSING } from '../../src/config/crossings';
import { HEIGHT_UNIT } from '../../src/config/balance';
import { Cross, CROSS_MSG, NetKind, lineTiles } from '../../src/world/Networks';
import { OVERPASS_MSG, overpassPrice } from '../../src/world/Overpasses';
import { buildStroke, describeExtras, planStroke } from '../../src/world/StrokePlan';
import { buildChunkData } from '../../src/render/meshes/Paths';
import { CHUNK_SIZE } from '../../src/world/Grid';
import { placeBuilding } from '../../src/sim/PlaceBuilding';
import { VehicleKind, makeCum, routeOnKind, type Vehicle } from '../../src/sim/guests/Arrivals';
import { Undo } from '../../src/build/UndoActions';
import { encodeSave, decodeSave, makeMeta } from '../../src/persist/Serializer';
import { createSim } from '../../src/game/createSim';
import { collectSave } from '../../src/game/saveState';

/** crossingWorld: rail at x = 38 (y 50..63 incl. the stub), flat enough around y = 62. The overpass road runs along y = 62 from the road entry side. */
const row = (a: number, b: number, y = 62) => lineTiles({ x: a, y }, { x: b, y });
const RAIL = { x: 38, y: 62 };

describe('road overpass over rail', () => {
  it('Bridge mode builds an overpass: cross 5, 7-9 tiles, price 900 + 150/tile, ramps are road tiles with an id; level stays the default', () => {
    const sim = crossingWorld(); const n = sim.networks, g = sim.grid;
    const lvl = planStroke(n, g, 'road', row(26, 50), 1, 'level');
    expect(lvl.ok, lvl.reason).toBe(true);
    expect(lvl.crossings).toEqual([{ ...RAIL, cross: Cross.Road }]); expect(lvl.overpasses).toHaveLength(0);
    const plan = planStroke(n, g, 'road', row(26, 50), 1, 'bridge');
    expect(plan.ok, plan.reason).toBe(true);
    expect(plan.crossings).toEqual([{ ...RAIL, cross: Cross.Overpass }]);
    const op = plan.overpasses[0]!;
    expect([3, 4]).toContain(op.n); expect(op.tiles.length).toBe(2 * op.n + 1);
    expect(op.cost).toBe(overpassPrice(op.n)); expect(op.cost).toBe(900 + 150 * op.tiles.length);
    expect(plan.cost).toBe(plan.newTiles.length * n.costOf(NetKind.Road) + op.cost);
    expect(describeExtras(plan)).toContain('road overpass over the rail');
    buildStroke(n, 'road', plan, 'bridge');
    expect(n.cross[n.idxOf(RAIL.x, RAIL.y)]).toBe(Cross.Overpass);
    expect(n.kind[n.idxOf(RAIL.x, RAIL.y)]).toBe(NetKind.Rail);
    expect(n.overpassTiles).toBe(op.tiles.length);
    expect(n.liveOverpasses()).toHaveLength(1);
    for (const t of op.tiles) expect(n.overpassAt(t.x, t.y)!.id).toBe(1);
    expect(n.overpassAt(RAIL.x + op.n + 1, RAIL.y)).toBeNull();
    expect(n.kind[n.idxOf(RAIL.x + 1, RAIL.y)]).toBe(NetKind.Road);
  });

  it('clearance: the deck is >= train height + margin above the rail, ramps climb gently, ground meets the ramp ends', () => {
    const sim = crossingWorld(); const n = sim.networks, g = sim.grid;
    buildStroke(n, 'road', planStroke(n, g, 'road', row(26, 50), 1, 'bridge'), 'bridge');
    const o = n.liveOverpasses()[0]!;
    const rail = g.getCorners(RAIL.x, RAIL.y).reduce((a, b) => a + b, 0) / 4 * HEIGHT_UNIT;
    expect(n.deckY(RAIL.x + 0.5, RAIL.y + 0.5)! - rail).toBeGreaterThanOrEqual(1.1 - 1e-6);
    expect(CROSSING.overpass.deck).toBeGreaterThanOrEqual(0.6 + 0.4); // a train is ~0.6 tall
    let prev = n.deckY(RAIL.x + 0.5, RAIL.y + 0.5)!;
    for (let s = 0.5; s <= o.n + 0.49; s += 0.25) { const y = n.deckY(RAIL.x + 0.5 + s, RAIL.y + 0.5)!; expect(Math.abs(prev - y)).toBeLessThanOrEqual(CROSSING.overpass.maxGrade * 0.25 + 1e-6); prev = y; }
    expect(n.deckY(RAIL.x + o.n + 1.5, RAIL.y + 0.5)).toBeNull();
    expect(n.deckY(RAIL.x - o.n + 0.1, RAIL.y + 0.5)).not.toBeNull();
  });

  it('refusals: ramps need free tiles (No room for the ramps) and a gentle ground (Too steep); other rules stay', () => {
    const sim = crossingWorld(); const n = sim.networks, g = sim.grid;
    n.buildSegment(NetKind.Road, row(26, 36));
    expect(planStroke(n, g, 'road', row(37, 50), 1, 'bridge').reason).toBe(OVERPASS_MSG.noRoom); // no ramp room on the west side
    expect(planStroke(n, g, 'road', row(34, 42), 1, 'bridge').ok).toBe(true); // exactly 4 + 1 + 4 (the ground rises east, so the short ramp does not fit)
    n.build(NetKind.Path, 40, 62); // a footpath tile where a ramp tile would be
    const second = planStroke(n, g, 'road', row(26, 50), 1, 'bridge');
    expect(second.ok).toBe(false); expect(second.reason).toBeTruthy();
    const sim2 = crossingWorld(); const n2 = sim2.networks, g2 = sim2.grid;
    for (let vy = 58; vy <= 66; vy++) for (let vx = 39; vx <= 50; vx++) g2.setCornerUnchecked(vx, vy, Math.max(0, 9 - (vx - 39))); // the ground falls one half-step per tile east of the rail
    const steep = planStroke(n2, g2, 'road', row(26, 50), 1, 'bridge');
    expect(steep.ok).toBe(false); expect(steep.reason).toContain(OVERPASS_MSG.steep);
    expect(planStroke(n2, g2, 'road', row(26, 50), 1, 'level').reason ?? '').not.toBe(OVERPASS_MSG.steep);
    // a path with the bridge option still builds a footbridge; an overpass is for roads only
    expect(n.crossingCheck(NetKind.Path, lineTiles({ x: 37, y: 62 }, { x: 39, y: 62 }), 1, [], Cross.Overpass)).toMatchObject({ ok: false, reason: CROSS_MSG.pathOnly });
    expect(n.crossingCheck(NetKind.Road, lineTiles({ x: 37, y: 62 }, { x: 39, y: 62 }), 1, [], true)).toMatchObject({ ok: false, reason: CROSS_MSG.roadOnly });
  });

  it('cars drive over it (never closed, never held), trains pass underneath at a different height, guests are not blocked', () => {
    const sim = crossingWorld({ bias: 0.5 }); const n = sim.networks, g = sim.grid;
    buildStroke(n, 'road', planStroke(n, g, 'road', row(26, 50), 1, 'bridge'), 'bridge');
    placeBuilding(sim.env, sim.props, 'parking', 47, 58, 0, true, true);
    sim.buildings.reevaluate();
    expect(n.isRoadServed(sim.buildings.all().find((b) => b.type === 'parking')!.id)).toBe(true);
    const sp = sim.guestSim.spawner; sp.rateMult = 4;
    const tile = n.idxOf(RAIL.x, RAIL.y), size = sim.size;
    let carsOver = 0, trains = 0, overlap = 0;
    const seen = new Set<number>();
    for (let t = 0; t < 6 * 240; t++) {
      if (t % 20 === 0) sp.benchFill(sim.game, 100, 25);
      sim.tick(1);
      expect(sim.crossings.isClosed(tile)).toBe(false);
      let car = false, train = false;
      for (const v of sp.vehicles) {
        for (let k = 0; k * 2 + 1 < v.pts.length; k++) {
          if (Math.floor(v.pts[k * 2]!) + Math.floor(v.pts[k * 2 + 1]!) * size !== tile || Math.abs(v.dist - v.cum[k]!) > 0.5) continue;
          if (v.kind === VehicleKind.Car || v.kind === VehicleKind.Bus) { car = true; if (!seen.has(v.id)) { seen.add(v.id); carsOver++; } } else if (v.kind === VehicleKind.Train) train = true;
        }
        if (v.kind === VehicleKind.Train && !seen.has(-v.id)) { seen.add(-v.id); trains++; }
      }
      if (car && train) overlap++; // legal: the car is on the deck, the train underneath
    }
    expect(trains).toBeGreaterThan(2);
    expect(sim.crossings.worstWaited()?.tile).not.toBe(tile); // only the footpath crossing at (38,57) ever makes anyone wait
    void overlap; void carsOver;
    // a car's route from the road entry to the car park runs over the overpass (cross 5 counts as road) and holdCar never stops it, train or not
    const park = sim.buildings.all().find((b) => b.type === 'parking')!;
    const route = routeOnKind(n.kind, size, NetKind.Road, n.roadEntry!, park, n.cross);
    expect(route.length).toBeGreaterThan(10);
    expect(route.some((p) => p.x === RAIL.x && p.y === RAIL.y)).toBe(true);
    const pts = route.flatMap((p) => [p.x + 0.5, p.y + 0.5]);
    const car: Vehicle = { id: 99, kind: VehicleKind.Car, mode: 0, pts, cum: makeCum(pts), dist: 0, speed: 5, riders: [], group: 1, dest: 1, alt: 0 };
    const tp = [38.5, 40.5, 38.5, 70.5], train: Vehicle = { id: 98, kind: VehicleKind.Train, mode: 1, pts: tp, cum: makeCum(tp), dist: 2.1, speed: 7.5, riders: [], group: 1, dest: 1, alt: 0 };
    sim.crossings.refresh([train]);
    expect(sim.crossings.isClosed(tile)).toBe(false);
    for (let d = 0; d < car.cum[car.cum.length - 1]!; d += 1) expect(sim.crossings.holdCar({ ...car, dist: d }, d + 5)).toBe(d + 5);
    // the deck is above the track the whole way over (the car's height is the deck, the train's the ground)
    const rail = g.getCorners(RAIL.x, RAIL.y).reduce((a, b) => a + b, 0) / 4 * HEIGHT_UNIT;
    expect(n.deckY(RAIL.x + 0.5, RAIL.y + 0.5)! - (rail + 0.6)).toBeGreaterThanOrEqual(0.4);
  }, 120000);

  it('undo / redo is one step, bulldozing any overpass tile removes it whole (rail stays), save / load keeps it', async () => {
    const sim = crossingWorld(); const n = sim.networks, g = sim.grid;
    const plan = planStroke(n, g, 'road', row(26, 50), 1, 'bridge');
    const undo = new Undo(sim), c0 = n.crossCount;
    n.beginJournal(); expect(sim.economy.charge(plan.cost)).toBe(true);
    buildStroke(n, 'road', plan, 'bridge');
    undo.recordNetwork('Road', 'painted', n.endJournal(), plan.cost);
    const tiles = plan.overpasses[0]!.tiles.length;
    expect(n.overpassTiles).toBe(tiles);
    expect(undo.undo().ok).toBe(true); expect(n.overpassTiles).toBe(0); expect(n.crossCount).toBe(c0); expect(n.kind[n.idxOf(RAIL.x, RAIL.y)]).toBe(NetKind.Rail);
    expect(undo.redo().ok).toBe(true); expect(n.overpassTiles).toBe(tiles); expect(n.liveOverpasses()).toHaveLength(1);
    const saved = collectSave(sim)['networks']!.data as { oid: ArrayLike<number>; overpasses: unknown[] };
    expect(saved.overpasses).toHaveLength(1); expect(saved.oid[n.idxOf(RAIL.x, RAIL.y)]).toBe(1);
    const { bytes } = await encodeSave(sim, makeMeta(sim, 'x'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const b = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    expect(b.networks.overpassTiles).toBe(tiles); expect(b.networks.deckY(RAIL.x + 0.5, RAIL.y + 0.5)).toBeCloseTo(n.deckY(RAIL.x + 0.5, RAIL.y + 0.5)!, 6);
    expect(b.networks.cross[b.networks.idxOf(RAIL.x, RAIL.y)]).toBe(Cross.Overpass);
    // bulldoze a ramp tile: ramps go, rail tile is plain rail, the road beyond stays
    const ramp = plan.overpasses[0]!.tiles[0]!;
    n.unbuild(ramp.x, ramp.y);
    expect(n.overpassTiles).toBe(0); expect(n.cross[n.idxOf(RAIL.x, RAIL.y)]).toBe(0); expect(n.kind[n.idxOf(RAIL.x, RAIL.y)]).toBe(NetKind.Rail);
    expect(n.kind[n.idxOf(ramp.x, ramp.y)]).toBe(0);
    expect(n.kind[n.idxOf(RAIL.x + plan.overpasses[0]!.n + 1, RAIL.y)]).toBe(NetKind.Road);
  });

  it('a world without an overpass saves without the new fields (hash-safe)', () => {
    const sim = crossingWorld();
    const d = collectSave(sim)['networks']!.data as Record<string, unknown>;
    expect(d['oid']).toBeUndefined(); expect(d['overpasses']).toBeUndefined();
  });

  it('render data: ramp embankments + deck add geometry on the overpass chunk and nothing without it', () => {
    const sim = crossingWorld(); const n = sim.networks, g = sim.grid;
    const chunk = Math.floor(RAIL.y / CHUNK_SIZE) * g.chunksPerRow + Math.floor(RAIL.x / CHUNK_SIZE);
    const before = buildChunkData(g, n, chunk).net.indices.length;
    buildStroke(n, 'road', planStroke(n, g, 'road', row(26, 50), 1, 'bridge'), 'bridge');
    const after = buildChunkData(g, n, chunk).net.indices.length;
    expect(after).toBeGreaterThan(before + 100);
  });
});
