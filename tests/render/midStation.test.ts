import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LIFT_KIND_IDS, LIFTS, type LiftFamily, type LiftKind } from '../../src/config/lifts';
import { buildMidStationParts } from '../../src/render/meshes/lifts/Station';
import { MID_THEMES } from '../../src/render/meshes/lifts/midStation';
import { LiftView } from '../../src/render/meshes/lifts';
import { geometryHash } from '../../src/render/meshes/lifts/geo';
import {
  MID_SLOW_EXTRA, MID_SLOW_ZONE, carrierStates, liftPath, midDistancesOf, pathToRope, ropeToPath, computeStats, type LiftData, type V3,
} from '../../src/sim/Lift';
import { LIFT_DWELL_S, LIFT_MID_STATION_DWELL_S, LIFT_STATION_SIZE } from '../../src/config/balance';
import { nearestBoardable } from '../../src/render/view/walkInteract';

const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

/** A straight 3-station lift (no terrain needed): nodes every 10 tiles along x, mid-station on node 5. */
function fakeLift(kind: LiftKind, id = 1): LiftData {
  const nodes: V3[] = [];
  for (let i = 0; i <= 10; i++) nodes.push({ x: 4 + i * 10, y: 20 - i * 1.5, z: 30 });
  const g = (i: number): { x: number; y: number; ground: number; node: number } => ({ x: nodes[i]!.x - 1, y: 29, ground: nodes[i]!.y - 2, node: i });
  const st = [g(0), g(5), g(10)];
  return {
    id, kind, bottom: { x: st[0]!.x, y: 29, ground: st[0]!.ground }, top: { x: st[2]!.x, y: 29, ground: st[2]!.ground }, towers: [], stations: st, nodes, tiles: [], open: true, speed: 1, cost: 1,
  };
}

describe('mid-station mesh (Task 39)', () => {
  it('is at most 600 triangles for every family, themed per family, and a pass-through station (no bullwheel, symmetric)', () => {
    const hashes = new Map<string, LiftFamily>();
    for (const k of LIFT_KIND_IDS) {
      if (!LIFTS[k].midStations) continue;
      const p = buildMidStationParts(k);
      expect(tris(p.geometry), `${k} mid-station triangles`).toBeLessThanOrEqual(600);
      expect(tris(p.geometry)).toBeGreaterThan(40);
      expect(p.geometry.userData.meshInfo).toMatchObject({ kind: k, role: 'mid' });
      hashes.set(geometryHash(p.geometry), LIFTS[k].family);
    }
    expect(hashes.size).toBe(3); // chair / gondola / cablecar
    for (const f of Object.keys(MID_THEMES) as LiftFamily[]) expect(MID_THEMES[f].bg).toMatch(/^#/);
    // footprint stays inside the 2x2 station square (+ a little roof overhang)
    const g = buildMidStationParts('gondola6').geometry;
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeLessThanOrEqual(LIFT_STATION_SIZE + 0.2);
    expect(bb.max.z - bb.min.z).toBeLessThanOrEqual(LIFT_STATION_SIZE + 0.2);
    // mirror symmetry along the line: bounding box centred on z = 0
    expect(Math.abs(bb.min.z + bb.max.z)).toBeLessThan(0.15);
  });

  it('LiftView draws a station mesh for every station of an N-station lift (bottom, mid, top) and rebuilds when the record is replaced', () => {
    const view = new LiftView();
    const lift = fakeLift('gondola6');
    view.add(lift);
    const entry = view.group.children[0] as THREE.Group;
    const stationGroups = entry.children.filter((c) => c instanceof THREE.Group) as THREE.Group[];
    expect(stationGroups).toHaveLength(3);
    for (const [i, s] of lift.stations!.entries()) {
      expect(stationGroups[i]!.position.x).toBeCloseTo(s.x + LIFT_STATION_SIZE / 2, 5);
      expect(stationGroups[i]!.position.y).toBeCloseTo(s.ground, 5);
    }
    // the mid-station mesh is not one of the terminals' meshes
    const geos = stationGroups.map((g) => (g.children[0] as THREE.Mesh).geometry);
    expect(geos[1]).not.toBe(geos[0]); expect(geos[1]).not.toBe(geos[2]);
    expect(view.dataOf(1)).toBe(lift);
    const two: LiftData = { ...lift, stations: undefined };
    delete two.stations;
    view.add(two);
    expect((view.group.children[0] as THREE.Group).children.filter((c) => c instanceof THREE.Group)).toHaveLength(2);
    expect(view.dataOf(1)).toBe(two);
    view.dispose();
  });
});

describe('carriers slow down in the mid-station zone (Task 39)', () => {
  it('rope <-> path mapping is monotone, continuous and invertible; the slow zone is 1/10 of the line speed and nothing else changes', () => {
    const mids = [30, 70], P = 100;
    let prev = -1;
    for (let r = 0; r <= P + 2 * MID_SLOW_EXTRA; r += 0.25) {
      const d = ropeToPath(r, mids, P);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9); prev = d;
      expect(pathToRope(Math.min(P, d), mids)).toBeCloseTo(Math.min(r, pathToRope(P, mids)), 4);
    }
    expect(ropeToPath(0, mids, P)).toBe(0);
    expect(ropeToPath(pathToRope(P, mids), mids, P)).toBeCloseTo(P, 6);
    expect(ropeToPath(10, mids, P)).toBeCloseTo(10, 9); // free running before the first zone
    const slow = (ropeToPath(pathToRope(30, mids) + 0.1, mids, P) - 30) / 0.1;
    expect(slow).toBeCloseTo(MID_SLOW_ZONE / (MID_SLOW_ZONE + MID_SLOW_EXTRA), 5);
    expect(slow).toBeLessThanOrEqual(0.11);
    expect(ropeToPath(50, [], P)).toBe(50); // no mid-station: untouched
  });

  it('loop lift: carriers crawl through the mid-station and run at full speed elsewhere; the visual dwell is close to the sim dwell', () => {
    const lift = fakeLift('gondola6');
    const path = liftPath(lift);
    const mids = midDistancesOf(lift, path);
    expect(mids).toHaveLength(1);
    const speedOf = (phase: number, i: number): number => {
      const a = carrierStates(lift, phase, path)[i]!, b = carrierStates(lift, phase + 0.05, path)[i]!;
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.05;
    };
    let slowest = Infinity, fastest = 0, nearSlow = 0;
    const n = carrierStates(lift, 0, path).length;
    for (let ph = 0; ph < 120; ph += 0.5) for (let i = 0; i < n; i++) {
      const c = carrierStates(lift, ph, path)[i]!;
      if (c.strand !== 0) continue;
      const v = speedOf(ph, i);
      const dMid = Math.hypot(c.x - lift.nodes[5]!.x, c.z - lift.nodes[5]!.z);
      if (dMid < MID_SLOW_ZONE / 2 - 0.3) { nearSlow = Math.max(nearSlow, v); slowest = Math.min(slowest, v); } else fastest = Math.max(fastest, v);
    }
    expect(nearSlow).toBeLessThan(0.2 * 1.05); // <= ~10% of the rope speed (1 tile per tile of phase) with slack for the slope
    expect(fastest).toBeGreaterThan(0.9);
    // extra time through the zone vs free running, at the lift's speed: within 40% of the sim's dwell (the rest is the platform boarding)
    const extraS = MID_SLOW_EXTRA / LIFTS.gondola6.speed;
    expect(extraS).toBeGreaterThan(0.6 * LIFT_MID_STATION_DWELL_S);
    expect(extraS).toBeLessThanOrEqual(LIFT_MID_STATION_DWELL_S);
  });

  it('reversible cable car stops (dwell) at the mid-station both ways; a 2-station cable car is unchanged', () => {
    const lift = fakeLift('cablecar');
    const path = liftPath(lift);
    const [m] = midDistancesOf(lift, path);
    const D = LIFT_DWELL_S * LIFTS.cablecar.speed;
    // sample the up cabin position over a cycle: it sits at the mid distance for a stretch of D rope tiles
    const cyc = 2 * path.length + 3 * D + 0; // up: D,P,D(mid? see carrierStates) -> just measure
    let still = 0, last = -1;
    for (let ph = 0; ph < cyc + 2 * D; ph += 0.25) {
      const c = carrierStates(lift, ph, path)[0]!;
      const x = (c.x - lift.nodes[0]!.x);
      if (Math.abs(x - (lift.nodes[5]!.x - lift.nodes[0]!.x)) < 0.01 && Math.abs(x - last) < 1e-6) still++;
      last = x;
    }
    expect(still * 0.25, 'cabin waits at the mid-station').toBeGreaterThan(D * 0.8);
    void m;
    // 2 stations: classic dwell at the ends only
    const two = fakeLift('cablecar'); delete two.stations;
    const p2 = liftPath(two), D2 = LIFT_DWELL_S * LIFTS.cablecar.speed;
    expect(carrierStates(two, 0, p2)[0]!.x).toBeCloseTo(two.nodes[0]!.x, 3);
    expect(carrierStates(two, D2 / 2, p2)[0]!.x).toBeCloseTo(two.nodes[0]!.x, 3);
    expect(carrierStates(two, D2 + 20, p2)[0]!.x).toBeGreaterThan(two.nodes[0]!.x + 10);
  });
});

describe('walk mode boards at the mid-station (Task 39)', () => {
  it('nearestBoardable offers every station but the top one, with its index', () => {
    const lift = { ...fakeLift('gondola6'), name: 'G', rideTimeS: 30, closedReason: null };
    const mid = lift.stations![1]!;
    const b = nearestBoardable([lift], mid.x + 1, mid.y + 1);
    expect(b?.station).toBe(1);
    const top = lift.stations![2]!;
    expect(nearestBoardable([lift], top.x + 1, top.y + 1)).toBeNull();
    const bot = lift.stations![0]!;
    expect(nearestBoardable([lift], bot.x + 1, bot.y + 1)?.station).toBe(0);
    const plain = { ...lift, stations: undefined };
    expect(nearestBoardable([plain], bot.x + 1, bot.y + 1)?.station).toBe(0);
  });
});
