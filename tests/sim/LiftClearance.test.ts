import { budget } from '../perfMode';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Grid } from '../../src/world/Grid';
import { generateTerrain } from '../../src/world/TerrainGen';
import { PropKind, PropStore, VEGETATION_KINDS, generateProps, surfaceHeight } from '../../src/world/Props';
import { CANOPY, matureCanopyHeight, matureCrownRadius, treeCanopyHeight } from '../../src/world/TreeHeights';
import { BUILDINGS } from '../../src/config/buildings';
import { BUILDING_HEIGHT } from '../../src/config/buildingHeights';
import { LIFTS, type LiftKind } from '../../src/config/lifts';
import { Economy } from '../../src/sim/Economy';
import { Buildings } from '../../src/sim/Buildings';
import { LiftStore, LIFT_PARAMS, STRAND_OFFSET, liftPath, liftPlantBlocker, placeLift, samplePath, stationAnchor, validateLift, type LiftEnv } from '../../src/sim/Lift';
import { CARRIER_HALF, LANE_HALF, OBSTACLE_MARGIN, STATION_SKIP, treeMapFor } from '../../src/sim/LiftClearance';
import { planPlanting, type PlantEnv } from '../../src/sim/nature/Planting';
import { heightAt } from '../../src/render/Picking';
import { KINDS, rng, sampleRoutes } from '../perf/liftSampler';
import { buildParts } from '../../src/render/meshes';
import { TREE_SPECIES } from '../../src/render/props/Trees';
import { buildCarrierGeometry } from '../../src/render/meshes/lifts';

const key = (c: { kind: number[]; tx: number[]; ty: number[]; ox: number[]; oy: number[] }, i: number): string => `${c.kind[i]}:${c.tx[i]}:${c.ty[i]}:${c.ox[i]!.toFixed(4)}:${c.oy[i]!.toFixed(4)}`;
const allTrees = (p: PropStore, rect?: { x0: number; y0: number; x1: number; y1: number }): Map<string, { x: number; z: number; kind: number; top: number; r: number }> => {
  const m = new Map<string, { x: number; z: number; kind: number; top: number; r: number }>();
  for (const c of p.chunks) for (let i = 0; i < c.kind.length; i++) {
    const kind = c.kind[i]!;
    if (!CANOPY[kind]) continue;
    if (rect && (c.tx[i]! < rect.x0 || c.tx[i]! > rect.x1 || c.ty[i]! < rect.y0 || c.ty[i]! > rect.y1)) continue;
    const x = c.tx[i]! + c.ox[i]!, z = c.ty[i]! + c.oy[i]!;
    m.set(key(c, i), { x, z, kind, top: surfaceHeight(p.grid, x, z) + matureCanopyHeight(kind, c.scale[i]!), r: matureCrownRadius(kind, c.scale[i]!) });
  }
  return m;
};

/** Independent re-statement of the clearance property for a placed lift (dense sampling along both strands, sag included). */
function violations(env: LiftEnv, lift: ReturnType<LiftStore['all']>[number], trees: ReturnType<typeof allTrees>): string[] {
  const out: string[] = [];
  const prm = LIFT_PARAMS[lift.kind];
  const path = liftPath(lift);
  const a = lift.nodes[0]!, b = lift.nodes[lift.nodes.length - 1]!;
  const horiz = Math.hypot(b.x - a.x, b.z - a.z);
  const nearTrees = [...trees.values()].filter((t) => {
    const rx = t.x - a.x, rz = t.z - a.z, al = (rx * path.dirX + rz * path.dirZ), lat = -rx * path.dirZ + rz * path.dirX;
    return al > -2 && al < horiz + 2 && Math.abs(lat) < 2.5;
  });
  for (let d = 0; d <= path.length; d += 0.1) {
    for (const lt of [STRAND_OFFSET, -STRAND_OFFSET]) {
      const p = samplePath(path, d, lt);
      const bottom = p.y - prm.drop;
      const hd = Math.hypot(p.x - a.x, p.z - a.z), he = Math.hypot(p.x - b.x, p.z - b.z);
      if (hd < 2.1 || he < 2.1) continue; // station taper
      if (lift.kind !== 'tbar') {
        const g = heightAt(env.grid, p.x, p.z);
        if (bottom < g - 0.04) out.push(`terrain d=${d.toFixed(1)} ${(bottom - g).toFixed(2)}`);
      }
      if (hd < STATION_SKIP + 0.3 || he < STATION_SKIP + 0.3) continue;
      for (const t of nearTrees) {
        if (Math.hypot(p.x - t.x, p.z - t.z) <= t.r + CARRIER_HALF && bottom < t.top + OBSTACLE_MARGIN - 0.02) out.push(`tree kind ${t.kind} at (${t.x.toFixed(2)},${t.z.toFixed(2)}) r=${t.r.toFixed(2)} d=${d.toFixed(1)} hd=${hd.toFixed(1)} he=${he.toFixed(1)} gap ${(bottom - t.top).toFixed(2)} towers=${lift.towers.map((q) => `${q.tileX},${q.tileY}`).join(' ')}`);
      }
      if (env.buildings) {
        for (const [ox, oz] of [[0, 0], [CARRIER_HALF, 0], [-CARRIER_HALF, 0], [0, CARRIER_HALF], [0, -CARRIER_HALF]] as const) {
          const bd = env.buildings.at(Math.floor(p.x + ox), Math.floor(p.z + oz));
          if (!bd) continue;
          let gmax = -Infinity;
          for (let vy = bd.y; vy <= bd.y + bd.h; vy++) for (let vx = bd.x; vx <= bd.x + bd.w; vx++) gmax = Math.max(gmax, env.grid.getCorner(vx, vy) * 0.5);
          if (bottom < gmax + BUILDING_HEIGHT[bd.type]! + OBSTACLE_MARGIN - 0.02) out.push(`building ${bd.type} d=${d.toFixed(1)}`);
        }
      }
    }
  }
  return out;
}

const forestEnv = (size: 64 | 128 | 256, seed: number): { env: LiftEnv; grid: Grid; props: PropStore } => {
  const grid = new Grid(size);
  const info = generateTerrain(grid, seed);
  const props = generateProps(grid, info.forestDensity, seed);
  const env: LiftEnv = { grid, lifts: new LiftStore(grid.occupancy), economy: new Economy({ money: 1e12 }), props, buildings: new Buildings(grid.occupancy) };
  return { env, grid, props };
};

describe('lift clearance property (final placed state)', () => {
  const kinds: LiftKind[] = ['tbar', 'chair4', 'gondola6', 'cablecar'];
  for (const clearLane of [true, false]) {
    it(`carrier bottom >= max(canopy, roof, terrain) + margin along the whole cable (lane clearing ${clearLane ? 'ON' : 'OFF'})`, () => {
      let placed = 0, cut = 0, refused = 0;
      for (const size of [64, 128, 256] as const) for (let seed = 1; seed <= (size === 256 ? 6 : clearLane ? 20 : 8); seed++) {
        const { env, grid, props } = forestEnv(size, seed);
        const routes = sampleRoutes(size, seed, 4);
        for (const kind of kinds) for (const r of routes.routes[kind as 'tbar']!.slice(0, 3)) {
          const bottom = stationAnchor(grid, r.bx, r.by), top = stationAnchor(grid, r.tx, r.ty);
          const rect = { x0: Math.min(bottom.x, top.x) - 22, y0: Math.min(bottom.y, top.y) - 22, x1: Math.max(bottom.x, top.x) + 24, y1: Math.max(bottom.y, top.y) + 24 };
          const before = allTrees(props, rect);
          const hBefore = grid.heights.slice();
          const chk = validateLift(env, kind, bottom, top, { skipFunds: true, clearLane });
          const out = placeLift(env, props, kind, bottom, top, true, clearLane);
          if (!chk.ok) { expect(out.ok, 'place agrees with validate').toBe(false); if (chk.reasons.some((x) => /trees/.test(x))) refused++; continue; }
          if (!out.ok) continue; // levelling changed the line between preview and build (placement re-validates): allowed to refuse
          placed++;
          const lift = out.lift!;
          const after = allTrees(props, rect);
          const bad = violations(env, lift, after);
          expect(bad.slice(0, 5), `${size}/${seed} ${kind} ${lift.id}`).toEqual([]);
          for (const t of lift.towers) expect(t.headY - t.groundY, 'tower height').toBeLessThanOrEqual(LIFT_PARAMS[lift.kind].maxTowerHeight + 1e-6);
          // tower tiles hold no vegetation after the build
          for (const t of lift.towers) expect(props.countInRect(t.tileX, t.tileY, t.tileX, t.tileY, (k) => VEGETATION_KINDS.includes(k)), 'tree under tower').toBe(0);
          // Only trees under the corridor (lane) or on a station / tower tile were removed
          const fb = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
          for (let i = 0; i < hBefore.length; i++) if (hBefore[i] !== grid.heights[i]) { const vx = i % grid.vsize, vy = Math.floor(i / grid.vsize); fb.x0 = Math.min(fb.x0, vx); fb.x1 = Math.max(fb.x1, vx); fb.y0 = Math.min(fb.y0, vy); fb.y1 = Math.max(fb.y1, vy); }
          const path = liftPath(lift), a = lift.nodes[0]!, b = lift.nodes[lift.nodes.length - 1]!;
          const horiz = Math.hypot(b.x - a.x, b.z - a.z);
          const tiles = new Set(lift.tiles);
          for (const [k, t] of before) {
            if (after.has(k)) continue;
            cut++;
            const rx = t.x - a.x, rz = t.z - a.z, al = rx * path.dirX + rz * path.dirZ, lat = -rx * path.dirZ + rz * path.dirX;
            const onTile = tiles.has(Math.floor(t.z) * grid.size + Math.floor(t.x)) || Math.min(Math.hypot(t.x - a.x, t.z - a.z), Math.hypot(t.x - b.x, t.z - b.z)) < 4.5;
            const tx = Math.floor(t.x), ty = Math.floor(t.z);
            const levelled = tx >= fb.x0 - 1 && tx <= fb.x1 && ty >= fb.y0 - 1 && ty <= fb.y1; // inside the re-levelled bounding rect (auto-flatten clears it, existing behaviour)
            expect(onTile || levelled || (al > -0.5 && al < horiz + 0.5 && Math.abs(lat) <= LANE_HALF + 1e-6), `removed tree outside corridor (${al.toFixed(1)}, ${lat.toFixed(1)}) horiz=${horiz.toFixed(1)} dA=${Math.hypot(t.x - a.x, t.z - a.z).toFixed(1)} dB=${Math.hypot(t.x - b.x, t.z - b.z).toFixed(1)} ${size}/${seed} ${kind} flat=${chk.flattenPlan.length}`).toBe(true);
            if (!clearLane && !onTile && !levelled) expect(al < 7.2 || al > horiz - 7.2, 'lane OFF only cuts the station approaches').toBe(true);
          }
        }
      }
      expect(placed).toBeGreaterThan(clearLane ? 150 : 20);
      if (clearLane) expect(cut).toBeGreaterThan(50);
      else expect(refused).toBeGreaterThan(0);
    }, 600000);
  }
});

describe('specific reasons and buildings', () => {
  const flat = (): { grid: Grid; env: LiftEnv; buildings: Buildings } => {
    const g = new Grid(64);
    for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) g.setCornerUnchecked(vx, vy, Math.round(vx * 0.5));
    const buildings = new Buildings(g.occupancy);
    return { grid: g, buildings, env: { grid: g, lifts: new LiftStore(g.occupancy), economy: new Economy({ money: 1e9 }), buildings } };
  };

  it('cable over a low shed is fine (clearance honoured), over a lodge it is refused with a named reason', () => {
    const { grid, env, buildings } = flat();
    // level pad for the building: slopeGrid is a ramp, so just place on it (the sim does not validate here)
    buildings.add('shop', 30, 30, 0);
    const lowOk = validateLift(env, 'chair4', stationAnchor(grid, 10, 31), stationAnchor(grid, 50, 31), { skipFunds: true });
    expect(lowOk.reasons).toEqual([]);
    const placed = placeLift(env, undefined, 'chair4', stationAnchor(grid, 10, 31), stationAnchor(grid, 50, 31));
    expect(placed.ok).toBe(true);
    expect(violations(env, placed.lift!, new Map())).toEqual([]);
    expect(placed.lift!.towers.some((t) => t.tileX >= 30 && t.tileX < 32 && t.tileY >= 30 && t.tileY < 32)).toBe(false);
    const g2 = flat();
    g2.buildings.add('baseLodge', 30, 30, 0);
    for (const kind of ['chair4', 'tbar', 'gondola6'] as const) {
      const c = validateLift(g2.env, kind, stationAnchor(g2.grid, 10, 31), stationAnchor(g2.grid, 50, 31), { skipFunds: true });
      expect(c.ok, kind).toBe(false);
      expect(c.reasons.join('|'), kind).toContain('Cable would hit Base Lodge');
    }
  });

  it('a forest the towers cannot clear gives the specific tree reason when lane clearing is off; on: cut and charged', () => {
    const grid = new Grid(64);
    for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) grid.setCornerUnchecked(vx, vy, Math.round(vx * 0.5));
    const props = new PropStore(grid);
    for (let x = 12; x < 49; x++) for (let y = 28; y < 36; y++) for (const [ox, oy] of [[0.2, 0.3], [0.7, 0.6]] as const) props.add(PropKind.Conifer, x, y, ox, oy, 1.4, 0, 0);
    const env: LiftEnv = { grid, lifts: new LiftStore(grid.occupancy), economy: new Economy({ money: 1e9 }), props };
    const off = validateLift(env, 'tbar', stationAnchor(grid, 10, 32), stationAnchor(grid, 50, 32), { skipFunds: true, clearLane: false });
    expect(off.ok).toBe(false);
    expect(off.reasons.join('|')).toContain('Cable would pass through trees');
    const on = validateLift(env, 'tbar', stationAnchor(grid, 10, 32), stationAnchor(grid, 50, 32), { skipFunds: true, clearLane: true });
    expect(on.reasons).toEqual([]);
    expect(on.lane!.count).toBeGreaterThan(20);
    expect(on.lane!.laneCost).toBeGreaterThan(0);
    expect(on.cost).toBeGreaterThanOrEqual(on.lane!.laneCost);
    const before = props.count();
    const out = placeLift(env, props, 'tbar', stationAnchor(grid, 10, 32), stationAnchor(grid, 50, 32), true, true);
    expect(out.ok).toBe(true);
    expect(before - props.count()).toBeGreaterThanOrEqual(on.lane!.count);
    // trees outside the +-1.5 lane stay
    expect(props.countInRect(20, 28, 20, 29)).toBeGreaterThan(0);
  });
});

describe('planting near a lift corridor', () => {
  it('refuses trees that would reach the carriers (mature height) and allows them beside the lane', () => {
    const { env, grid, props } = forestEnv(128, 5);
    const routes = sampleRoutes(128, 5, 10);
    let lift = null as ReturnType<LiftStore['all']>[number] | null;
    for (const r of routes.routes.chair4) { const o = placeLift(env, props, 'chair4', stationAnchor(grid, r.bx, r.by), stationAnchor(grid, r.tx, r.ty)); if (o.ok) { lift = o.lift!; break; } }
    expect(lift).not.toBeNull();
    const blocks = liftPlantBlocker(env.lifts, grid);
    const path = liftPath(lift!);
    const mid = samplePath(path, path.length * 0.5, 0);
    // Plant a tree right under the cable mid-span: only blocked when a mature crown would reach the carrier.
    const need = mid.y - LIFT_PARAMS.chair4.drop - OBSTACLE_MARGIN - heightAt(grid, mid.x, mid.z);
    const tall = need < matureCanopyHeight(PropKind.Pine, 1.2);
    if (tall) expect(blocks(mid.x, mid.z, PropKind.Pine, 1.2)).toBe(true); // never allows a tree that would reach the carrier
    if (need < matureCanopyHeight(PropKind.Shrub, 0.6)) expect(blocks(mid.x, mid.z, PropKind.Shrub, 0.6)).toBe(true);
    if (need > matureCanopyHeight(PropKind.Pine, 1.2) + 1.5) expect(blocks(mid.x, mid.z, PropKind.Pine, 1.2)).toBe(false);
    // far from the line: fine
    expect(blocks(mid.x + 20 * -path.dirZ, mid.z + 20 * path.dirX, PropKind.Pine, 1.4)).toBe(false);
    // planPlanting honours the hook for every planned tree
    const penv: PlantEnv = { grid, props, seed: 3, blocked: () => false, liftBlocks: blocks };
    const plan = planPlanting(penv, Math.floor(mid.x), Math.floor(mid.z), 5, 'conifer', 1, 100);
    for (const t of plan.trees) expect(blocks(t.tx + t.ox, t.ty + t.oy, t.kind, t.scale)).toBe(false);
  });

  it('forces a low cable region to refuse saplings even when they are small today (mature height rule)', () => {
    const g = new Grid(64);
    for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) g.setCornerUnchecked(vx, vy, Math.round(vx * 0.3));
    const env: LiftEnv = { grid: g, lifts: new LiftStore(g.occupancy), economy: new Economy({ money: 1e9 }) };
    const o = placeLift(env, undefined, 'chair4', stationAnchor(g, 10, 30), stationAnchor(g, 50, 30));
    expect(o.ok).toBe(true);
    const blocks = liftPlantBlocker(env.lifts, g);
    const path = liftPath(o.lift!);
    // find the lowest carrier point and plant just under it
    let low = { d: 0, gap: Infinity };
    for (let d = 8; d < path.length - 8; d += 0.5) { const p = samplePath(path, d, 0); const gap = p.y - LIFT_PARAMS.chair4.drop - OBSTACLE_MARGIN - heightAt(g, p.x, p.z); if (gap < low.gap) low = { d, gap }; }
    const p = samplePath(path, low.d, 0);
    if (low.gap < matureCanopyHeight(PropKind.Conifer, 1)) expect(blocks(p.x, p.z, PropKind.Conifer, 1)).toBe(true);
  });
});

describe('catalogues stay in sync with the meshes', () => {
  it('tree canopy table >= full-mesh bounding boxes (and within 0.1)', () => {
    for (const sp of TREE_SPECIES) {
      const g = sp.full();
      g.computeBoundingBox();
      const bb = g.boundingBox!, c = CANOPY[sp.kind]!;
      expect(c, `kind ${sp.kind}`).toBeDefined();
      expect(c.height, `h ${sp.kind}`).toBeGreaterThanOrEqual(bb.max.y - 1e-6);
      expect(c.height - bb.max.y, `h slack ${sp.kind}`).toBeLessThan(0.1);
      expect(c.radius, `r ${sp.kind}`).toBeGreaterThanOrEqual(Math.max(bb.max.x, -bb.min.x, bb.max.z, -bb.min.z) - 0.011);
    }
  });
  it('building height table >= mesh bounding boxes (and within 0.15) for every building', () => {
    for (const d of Object.values(BUILDINGS)) {
      const p = buildParts(d.meshBuilder, d.w, d.h);
      const box = new THREE.Box3();
      for (const g of [p.wood, p.stone, p.roof, p.sign?.geometry]) if (g) { g.computeBoundingBox(); box.union(g.boundingBox!); }
      const h = BUILDING_HEIGHT[d.id];
      expect(h, d.id).toBeDefined();
      expect(h!, d.id).toBeGreaterThanOrEqual(box.max.y - 1e-6);
      expect(h! - box.max.y, d.id).toBeLessThan(0.15);
    }
  });
  it('carrier drop >= the carrier mesh bottom for every lift kind', () => {
    for (const k of Object.keys(LIFTS) as LiftKind[]) {
      if (k === 'funicular') continue;
      const g = buildCarrierGeometry(k);
      g.computeBoundingBox();
      expect(LIFT_PARAMS[k].drop, k).toBeGreaterThanOrEqual(-g.boundingBox!.min.y - 1e-6);
    }
  });
  it('growth: planting rules use the mature height, not the sapling height', () => {
    expect(treeCanopyHeight(PropKind.Conifer, 1, 10, 10)).toBeLessThan(matureCanopyHeight(PropKind.Conifer, 1) * 0.3);
    expect(treeCanopyHeight(PropKind.Conifer, 1, -1, 10)).toBeCloseTo(matureCanopyHeight(PropKind.Conifer, 1));
  });
});

describe('determinism, tree map and perf', () => {
  it('validation is deterministic and the tree map follows prop changes lazily', () => {
    const { env, grid, props } = forestEnv(128, 9);
    const r = sampleRoutes(128, 9, 6).routes.chair4[0]!;
    const b = stationAnchor(grid, r.bx, r.by), t = stationAnchor(grid, r.tx, r.ty);
    const a1 = validateLift(env, 'chair4', b, t, { skipFunds: true }), a2 = validateLift(env, 'chair4', b, t, { skipFunds: true });
    expect(JSON.stringify([a1.reasons, a1.cost, a1.data?.nodes, a1.lane?.count])).toBe(JSON.stringify([a2.reasons, a2.cost, a2.data?.nodes, a2.lane?.count]));
    const tm = treeMapFor(props);
    const ci = props.chunks.findIndex((c) => c.kind.some((k) => CANOPY[k]));
    const c = props.chunks[ci]!, i = c.kind.findIndex((k) => CANOPY[k]);
    const tx = c.tx[i]!, ty = c.ty[i]!;
    expect(tm.has(tx, ty)).toBe(true);
    props.removeInRect(tx, ty, tx, ty);
    expect(treeMapFor(props).has(tx, ty)).toBe(false);
    props.add(PropKind.Pine, tx, ty, 0.5, 0.5, 1, 0, 0);
    expect(treeMapFor(props).has(tx, ty)).toBe(true);
  });

  it('validate stays cheap with the obstacle map (<= 6 ms average on 256 forest maps)', () => {
    const { env, grid } = forestEnv(256, 3);
    const routes = sampleRoutes(256, 3, 30).routes.chair4;
    validateLift(env, 'chair4', stationAnchor(grid, routes[0]!.bx, routes[0]!.by), stationAnchor(grid, routes[0]!.tx, routes[0]!.ty), { skipFunds: true });
    const t0 = performance.now();
    for (const r of routes) validateLift(env, 'chair4', stationAnchor(grid, r.bx, r.by), stationAnchor(grid, r.tx, r.ty), { skipFunds: true });
    const avg = (performance.now() - t0) / routes.length;
    console.info(`[perf] validateLift forest 256: ${avg.toFixed(2)} ms avg`);
    expect(avg).toBeLessThan(budget(6));
  });

  it('is unused-safe: rng helper stays deterministic', () => { expect(rng(3)()).toBe(rng(3)()); expect(KINDS.length).toBeGreaterThan(0); });
});
