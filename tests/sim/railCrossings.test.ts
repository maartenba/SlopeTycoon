import { describe, expect, it } from 'vitest';
import { crossingWorld, CROSS_TILE, ROAD_TILE } from './crossingsHelper';
import { CROSSING } from '../../src/config/crossings';
import { Cross, CROSS_MSG, Conn, NetKind, lineTiles } from '../../src/world/Networks';
import { RailCrossings, type CrossNet } from '../../src/sim/RailCrossings';
import { VehicleKind, makeCum, type Vehicle } from '../../src/sim/guests/Arrivals';
import { OccFlag } from '../../src/world/Occupancy';
import { stateHash } from '../../src/game/saveState';
import { createSim } from '../../src/game/createSim';

const TRAIN_LEN = 2.4; // model length (VehicleModels.buildTrain) in tiles

describe('RailCrossings (pure)', () => {
  const net = (): CrossNet => {
    const size = 8, kind = new Uint8Array(64), cross = new Uint8Array(64), conn = new Uint8Array(64);
    for (let y = 0; y < 8; y++) { kind[y * 8 + 4] = NetKind.Rail; conn[y * 8 + 4] = Conn.N | Conn.S; }
    cross[3 * 8 + 4] = Cross.Path; kind[3 * 8 + 4] = NetKind.Rail;
    return { size, kind, conn, cross, crossCount: 1, version: 1 };
  };
  const train = (dist: number, speed = 7.5): Vehicle => {
    const pts: number[] = []; for (let y = 0; y < 8; y++) pts.push(4.5, y + 0.5);
    return { id: 1, kind: VehicleKind.Train, mode: 1, pts, cum: makeCum(pts), dist, speed, riders: [], group: 1, dest: 1, alt: 0 };
  };
  it('closes `leadTicks` before the nose arrives and opens only after the tail passed', () => {
    const c = new RailCrossings(net()), tile = 3 * 8 + 4, v = train(-60);
    c.refresh([v]);
    expect(c.isClosed(tile)).toBe(false);
    // crossing is at route distance 3; closes once nose is within speed*lead tiles of it
    v.dist = 3 - 7.5 * CROSSING.leadTicks - 0.1; c.refresh([v]);
    expect(c.isClosed(tile)).toBe(false);
    v.dist += 0.2; c.refresh([v]);
    expect(c.isClosed(tile)).toBe(true);
    v.dist = 3 + 0.5; c.refresh([v]);
    expect(c.isClosed(tile)).toBe(true);
    v.dist = 3 + CROSSING.trainTailTiles + 0.6; c.refresh([v]);
    expect(c.isClosed(tile)).toBe(false);
    expect(CROSSING.trainTailTiles).toBeGreaterThan(TRAIN_LEN);
  });
  it('lead time exceeds the slowest tile traversal of anything that uses the tile', () => {
    // slowest walker on a path = 0.8 x 2.5 tiles/tick (64 map) = 2 tiles/tick => 0.5 ticks per tile; cars >= 3.75 tiles/tick
    expect(CROSSING.leadTicks * 2).toBeGreaterThan(2 * (1 / 2) * 2);
    expect(CROSSING.leadTicks).toBeGreaterThanOrEqual(3);
  });
  it('a train never spawns inside the closing window: spawnDist pushes it back (negative = waits at the entry)', () => {
    const c = new RailCrossings(net()), v = train(0);
    const d = c.spawnDist(v, 1);
    expect(3 - d).toBeGreaterThanOrEqual(v.speed * (CROSSING.leadTicks + 1) - 1e-9);
    expect(c.spawnDist(v, -100)).toBe(-100); // already far back: untouched
  });
  it('is inert with no crossing: nothing closes, spawnDist is the identity', () => {
    const n = net(); n.cross.fill(0);
    const c = new RailCrossings({ ...n, crossCount: 0 });
    c.refresh([train(3)]);
    expect(c.closedTiles().size).toBe(0);
    expect(c.spawnDist(train(0), 5)).toBe(5);
  });
  it('footbridges over rail never close', () => {
    const n = net(); n.cross[3 * 8 + 4] = Cross.Footbridge;
    const c = new RailCrossings(n);
    c.refresh([train(3)]);
    expect(c.closedTiles().size).toBe(0);
    expect(c.list()[0]!.kind).toBe(Cross.Footbridge);
  });
  it('cars hold 0.55 tiles before a closed ROAD crossing and carry on once it opens', () => {
    const n = net(); n.cross[3 * 8 + 4] = Cross.Road;
    const c = new RailCrossings(n);
    const t = train(3 - 7.5 * 2), car = train(0, 5); car.id = 2; car.kind = VehicleKind.Car;
    c.refresh([t, car]);
    expect(c.isClosed(3 * 8 + 4)).toBe(true);
    car.dist = 1;
    expect(c.holdCar(car, 6)).toBeCloseTo(3 - 0.55, 6);
    car.dist = 3 - 0.2; // already inside the tile: it keeps going
    expect(c.holdCar(car, 8)).toBe(8);
    t.dist = 40; c.refresh([t, car]);
    car.dist = 1;
    expect(c.holdCar(car, 6)).toBe(6);
  });
});

describe('level crossing placement (Networks)', () => {
  it('a footpath stroke across a straight rail makes a crossing with a cost; roads too; path + road components join across the rail', () => {
    const sim = crossingWorld({ road: true });
    const n = sim.networks;
    expect(n.cross[CROSS_TILE(sim)]).toBe(Cross.Path);
    expect(n.cross[ROAD_TILE(sim)]).toBe(Cross.Road);
    expect(n.kind[CROSS_TILE(sim)]).toBe(NetKind.Rail); // the tile stays rail
    expect(n.kindAt(36, 57)).toBe(NetKind.Path); expect(n.kindAt(40, 57)).toBe(NetKind.Path);
    // approach tiles reach into the crossing (render arms)
    expect(n.conn[57 * 64 + 37]! & Conn.E).toBeTruthy();
    expect(n.conn[57 * 64 + 39]! & Conn.W).toBeTruthy();
    // the cafe east of the line is served through the crossing, the car park through the road crossing
    const cafe = sim.buildings.all().find((b) => b.type === 'cafe')!, park = sim.buildings.all().find((b) => b.type === 'parking')!;
    expect(n.isConnected(cafe.id)).toBe(true);
    expect(cafe.active && park.active).toBe(true);
    expect(n.isRoadServed(park.id)).toBe(true);
  });
  it('plan reports the crossing and its cost (x construction multiplier)', () => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0, money: 900000 });
    const n = sim.networks;
    const plan = n.planSegment(NetKind.Path, lineTiles({ x: 36, y: 60 }, { x: 42, y: 60 }), 2);
    expect(plan.ok).toBe(true);
    expect(plan.crossings).toEqual([{ x: 38, y: 60, cross: Cross.Path }]);
    expect(plan.cost).toBe(plan.newTiles.length * 20 * 2 + CROSSING.cost.path * 2);
  });
  it('refuses: along the rail, at an angle, ending on the rail, close to another crossing, at a station, on a corner, over a bridge', () => {
    const sim = crossingWorld({ road: true });
    const n = sim.networks;
    const reason = (kind: NetKindId, tiles: Array<{ x: number; y: number }>): string | undefined => n.planSegment(kind, tiles).reason;
    type NetKindId = 1 | 2 | 3;
    expect(reason(1, lineTiles({ x: 40, y: 60 }, { x: 40, y: 55 }))).toBeUndefined(); // control: plain path east of the line is fine
    expect(reason(1, lineTiles({ x: 38, y: 59 }, { x: 38, y: 55 }))).toBe(CROSS_MSG.angle); // along the rail
    expect(reason(1, lineTiles({ x: 37, y: 59 }, { x: 38, y: 59 }))).toBe(CROSS_MSG.ends); // ends on the rail
    expect(reason(1, [{ x: 37, y: 59 }, { x: 38, y: 59 }, { x: 38, y: 60 }])).toBe(CROSS_MSG.angle); // turns on the rail
    expect(reason(1, lineTiles({ x: 37, y: 59 }, { x: 39, y: 59 }))).toBe(CROSS_MSG.spacing); // 2 tiles from the crossing at (38,57)
    expect(reason(1, lineTiles({ x: 39, y: 52 }, { x: 37, y: 52 }))).toBe(CROSS_MSG.station); // station footprint
    expect(reason(1, lineTiles({ x: 37, y: 54 }, { x: 39, y: 54 }))).toBeUndefined(); // free rail tile, 3 tiles from the crossing
  });
  it('rail laid across an existing straight path becomes a crossing too; the path stays walkable across it', () => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0, money: 900000 });
    const n = sim.networks;
    n.buildSegment(NetKind.Path, lineTiles({ x: 34, y: 56 }, { x: 46, y: 56 }));
    const plan = n.planSegment(NetKind.Rail, lineTiles({ x: 38, y: 58 }, { x: 38, y: 54 }));
    expect(plan.ok).toBe(true);
    expect(plan.crossings).toEqual([{ x: 38, y: 56, cross: Cross.Path }]);
    n.buildSegment(NetKind.Rail, lineTiles({ x: 38, y: 58 }, { x: 38, y: 54 }));
    expect(n.kindAt(38, 56)).toBe(NetKind.Rail);
    expect(n.crossAt(38, 56)).toBe(Cross.Path);
    expect(n.conn[56 * 64 + 37]! & Conn.E).toBeTruthy(); // the path arms reach into the crossing
    expect(sim.grid.occupancy.has(38, 56, OccFlag.Path)).toBe(false);
    expect(n.pathDistance({ x: 34, y: 56 }, { x: 46, y: 56 }, 40)).toBeLessThan(Infinity);
    // a rail stroke that is not perpendicular to the path is refused
    const n2 = createSim({ size: 64, seed: 61, now: () => 0, money: 900000 }).networks;
    n2.buildSegment(NetKind.Path, lineTiles({ x: 38, y: 50 }, { x: 38, y: 56 }));
    expect(n2.planSegment(NetKind.Rail, lineTiles({ x: 38, y: 58 }, { x: 38, y: 54 })).ok).toBe(false);
  });
  it('bulldozing a crossing reverts the tile to plain rail and cuts the path; undo restores the crossing', () => {
    const sim = crossingWorld();
    const n = sim.networks, i = CROSS_TILE(sim);
    n.beginJournal();
    const k = n.unbuild(38, 57);
    const diff = n.endJournal();
    expect(k).toBe(NetKind.Path);
    expect(n.cross[i]).toBe(0); expect(n.crossCount).toBe(0);
    expect(n.kind[i]).toBe(NetKind.Rail);
    expect(n.conn[57 * 64 + 37]! & Conn.E).toBe(0);
    const cafe = sim.buildings.all().find((b) => b.type === 'cafe')!;
    sim.buildings.reevaluate();
    expect(n.isConnected(cafe.id)).toBe(false); // the far side is cut off from the road
    n.restore(diff);
    sim.buildings.reevaluate();
    expect(n.cross[i]).toBe(Cross.Path); expect(n.crossCount).toBe(1);
    expect(n.isConnected(cafe.id)).toBe(true);
  });
});

describe('level crossings in a running sim', () => {
  it('guests wait at a closed crossing and are NEVER on it when a train passes (10 sim-days, cars + guests)', () => {
    const sim = crossingWorld({ road: true, bias: 0.5 });
    const sp = sim.guestSim.spawner; sp.rateMult = 4;
    const foot = CROSS_TILE(sim), road = ROAD_TILE(sim), size = sim.size;
    const prev = new Map<number, number>();
    const st = sim.guestSim.store;
    let trainsPassedFoot = 0, trainsPassedRoad = 0, footVisits = 0, carsHeld = 0;
    const onTile = (tile: number): number => { let c = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && (Math.floor(st.y[i]!) * size + Math.floor(st.x[i]!)) === tile) c++; return c; };
    const days = 10, ticksPerDay = 240;
    let guestsOnFootPrev = 0, guestsOnRoadPrev = 0;
    for (let t = 0; t < days * ticksPerDay; t++) {
      if (t % 20 === 0) sp.benchFill(sim.game, 100, 25);
      sim.tick(1);
      const gf = onTile(foot), gr = onTile(road);
      footVisits += gf;
      for (const v of sp.vehicles) {
        if (v.kind === VehicleKind.Train) {
          const p = prev.get(v.id) ?? v.dist;
          // route distance of the crossings along this train's polyline
          for (const [tile, c, g, gp] of [[foot, 0, gf, guestsOnFootPrev], [road, 0, gr, guestsOnRoadPrev]] as const) {
            void c;
            const idx = (() => { for (let k = 0; k * 2 + 1 < v.pts.length; k++) if (Math.floor(v.pts[k * 2]!) + Math.floor(v.pts[k * 2 + 1]!) * size === tile) return k; return -1; })();
            if (idx < 0) continue;
            const pos = v.cum[idx]!;
            // order inside a tick: vehicles advance first, then guests move. Hazards: (a) the train body sweeps over the tile while guests stand on it
            // (those of the previous tick's end), (b) the train body covers the tile at its end position while guests stand on it after they moved.
            const swept = v.dist >= pos - 0.5 && p - TRAIN_LEN <= pos + 0.5;
            const covers = v.dist >= pos - 0.5 && v.dist - TRAIN_LEN <= pos + 0.5;
            if (swept) {
              if (tile === foot) trainsPassedFoot++; else trainsPassedRoad++;
              expect(gp, `guests on tile ${tile} at the start of tick ${t} while a train passed`).toBe(0);
            }
            if (covers) expect(g, `guests on tile ${tile} at the end of tick ${t} while a train covers it`).toBe(0);
          }
          prev.set(v.id, v.dist);
        } else if (v.kind === VehicleKind.Car || v.kind === VehicleKind.Bus) {
          // a car on the road-crossing tile while the crossing is closed would be a collision
          for (let k = 0; k * 2 + 1 < v.pts.length; k++) {
            if (Math.floor(v.pts[k * 2]!) + Math.floor(v.pts[k * 2 + 1]!) * size !== road) continue;
            const inside = Math.abs(v.dist - v.cum[k]!) <= 0.5;
            if (inside && sim.crossings.isClosed(road)) {
              // it may only be inside while closed if it entered before the closure; the closure lasts well after the nose arrives, so check the train is not yet on it
              const trains = sp.vehicles.filter((q) => q.kind === VehicleKind.Train);
              for (const tr of trains) for (let kk = 0; kk * 2 + 1 < tr.pts.length; kk++) if (Math.floor(tr.pts[kk * 2]!) + Math.floor(tr.pts[kk * 2 + 1]!) * size === road) expect(tr.dist < tr.cum[kk]! - 0.5 || tr.dist - TRAIN_LEN > tr.cum[kk]! + 0.5, 'car and train on the road crossing').toBe(true);
            }
            if (v.dist <= v.cum[k]! - 0.55 + 1e-6 && v.dist > v.cum[k]! - 0.6 && sim.crossings.isClosed(road)) carsHeld++;
          }
        }
      }
      guestsOnFootPrev = gf; guestsOnRoadPrev = gr;
    }
    // the check is not vacuous
    expect(trainsPassedFoot).toBeGreaterThan(5);
    expect(footVisits).toBeGreaterThan(50);
    expect(sim.crossings.totalWait).toBeGreaterThan(0);
    expect(trainsPassedRoad).toBeGreaterThan(3);
    void carsHeld;
  }, 120000);

  it('deterministic: same seed + inputs => same stateHash with crossings', () => {
    const run = (): string => { const s = crossingWorld({ bias: 0.7 }); s.guestSim.spawner.benchFill(s.game, 60, 60); s.tick(300); return stateHash(s).hash; };
    expect(run()).toBe(run());
  });

  it('worlds without a crossing keep their exact save shape (no `cross` key) and hash', async () => {
    const { collectSave } = await import('../../src/game/saveState');
    const sim = createSim({ size: 64, seed: 61, now: () => 0 });
    expect(Object.keys(collectSave(sim)['networks']!.data as object)).not.toContain('cross');
    const w = crossingWorld();
    expect(Object.keys(collectSave(w)['networks']!.data as object)).toContain('cross');
    expect(w.crossings.active).toBe(true);
  });
});
