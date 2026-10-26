import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { raiseLowerRect } from '../../src/world/Terraform';
import { Economy } from '../../src/sim/Economy';
import { LIFTS, type LiftKind } from '../../src/config/lifts';
import {
  LiftStore, carrierStates, computeStats, demolishLift, liftPath, placeLift, rayDistanceToLift, sagOffset, samplePath,
  stationAnchor, validateLift, LIFT_PARAMS,
} from '../../src/sim/Lift';
import { heightAt } from '../../src/render/Picking';
import { LIFT_DWELL_S, TILE_METRES } from '../../src/config/balance';

/** Slope rising towards +x: height (half-steps) = round(x * rise). */
function slopeGrid(rise: number): Grid {
  const g = new Grid(64);
  for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) g.setCornerUnchecked(vx, vy, Math.round(vx * rise));
  return g;
}
const env = (g: Grid, money = 1e9) => {
  const state = { money };
  const economy = new Economy(state);
  return { grid: g, lifts: new LiftStore(g.occupancy), economy, state };
};
const A = (g: Grid, x: number, y: number) => stationAnchor(g, x, y);

describe('lift validation', () => {
  it('accepts a gentle straight chairlift and exposes stats', () => {
    const g = slopeGrid(0.5); // 0.25 units/tile => gradient .25
    const e = env(g);
    const c = validateLift(e, 'chair4', A(g, 10, 30), A(g, 50, 30));
    expect(c.reasons).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c.data!.towers.length).toBeGreaterThanOrEqual(3);
    expect(c.stats!.lengthTiles).toBeCloseTo(40, 0);
    expect(c.stats!.lengthM).toBeCloseTo(c.stats!.lengthTiles * TILE_METRES);
    expect(c.cost - c.supportCost).toBeCloseTo(LIFTS.chair4.costPerMetre * c.stats!.lengthM + 2 * LIFTS.chair4.stationCost);
    expect(c.supportCost).toBeGreaterThan(0); // towers cost money
  });

  it('keeps cable clearance above terrain along the whole span', () => {
    const g = slopeGrid(0.5);
    // a ridge between the stations
    for (let vy = 28; vy <= 34; vy++) for (let vx = 28; vx <= 34; vx++) g.setCornerUnchecked(vx, vy, Math.round(vx * 0.5) + 3);
    const e = env(g);
    const c = validateLift(e, 'gondola6', A(g, 10, 31), A(g, 50, 31));
    expect(c.ok).toBe(true);
    const p = liftPath({ kind: 'gondola6', nodes: c.data!.nodes });
    for (let d = 0; d <= p.length; d += 0.25) {
      const s = samplePath(p, d);
      if (d > 2 && d < p.length - 2) expect(s.y - heightAt(g, s.x, s.z)).toBeGreaterThanOrEqual(LIFT_PARAMS.gondola6.minClearance - 0.05);
    }
    for (const t of c.data!.towers) expect(t.headY - t.groundY).toBeLessThanOrEqual(LIFT_PARAMS.gondola6.maxTowerHeight + 1e-6);
  });

  it('rejects: too long, top lower than bottom, too steep, too short, out of range tile, occupied', () => {
    const g = slopeGrid(0.5);
    const e = env(g);
    expect(validateLift(e, 'tbar', A(g, 5, 30), A(g, 60, 30)).reasons.join()).toMatch(/Too long/);
    expect(validateLift(e, 'chair4', A(g, 50, 30), A(g, 10, 30)).reasons.join()).toMatch(/higher than bottom/);
    expect(validateLift(e, 'chair4', A(g, 10, 30), A(g, 12, 30)).reasons.join()).toMatch(/Too short|Too steep/);
    const steep = slopeGrid(2); // 1 unit per tile
    const s = validateLift(env(steep), 'tbar', A(steep, 10, 30), A(steep, 30, 30));
    expect(s.ok).toBe(false);
    expect(s.reasons.join()).toMatch(/Too steep/);
    g.occupancy.set(10, 30, OccFlag.Building, 99);
    const occ = validateLift(e, 'chair4', A(g, 10, 30), A(g, 40, 30));
    expect(occ.ok).toBe(false);
    expect(occ.reasons.join()).toMatch(/occupied/);
    expect(validateLift(e, 'chair4', { x: -1, y: 0 }, A(g, 40, 30)).reasons).toEqual(['Out of bounds']);
  });

  it('refuses stations on water and needs auto-flatten for rough sites', () => {
    const g = slopeGrid(0.5);
    const e = env(g);
    g.occupancy.set(40, 30, OccFlag.Water);
    expect(validateLift(e, 'chair4', A(g, 10, 30), A(g, 41, 31)).reasons.join()).toMatch(/water/);
    const g2 = slopeGrid(0.5);
    g2.setCornerUnchecked(10, 30, g2.getCorner(10, 30) + 2);
    const e2 = env(g2);
    const a = A(g2, 10, 30);
    const strict = validateLift(e2, 'chair4', { x: 9, y: 29 }, A(g2, 40, 30), { autoFlatten: false });
    expect(strict.reasons.join()).toMatch(/too steep.*auto-flatten/);
    void a;
    const flat = validateLift(e2, 'chair4', { x: 9, y: 29 }, A(g2, 40, 30));
    expect(flat.flatten).toBe(true);
    expect(flat.flattenCost).toBeGreaterThan(0);
  });

  it('fails with a reason when clearance is impossible (deep chasm needs too-tall towers)', () => {
    const g = slopeGrid(0.5);
    // tower tile column is a pit: ground far below line is fine; a spike too tall cannot be cleared by towers
    for (let vy = 20; vy <= 40; vy++) for (let vx = 28; vx <= 32; vx++) g.setCornerUnchecked(vx, vy, 60);
    const c = validateLift(env(g), 'tbar', A(g, 15, 30), A(g, 45, 30));
    expect(c.ok).toBe(false);
    expect(c.reasons.length).toBeGreaterThan(0);
  });

  it('funicular: no towers, follows terrain; rejects steep/uneven', () => {
    const g = slopeGrid(0.4);
    const c = validateLift(env(g), 'funicular', A(g, 10, 30), A(g, 40, 30));
    expect(c.reasons).toEqual([]);
    expect(c.data!.towers).toHaveLength(0);
    expect(c.data!.nodes.length).toBeGreaterThan(10);
    const steep = slopeGrid(2);
    const bad = validateLift(env(steep), 'funicular', A(steep, 10, 30), A(steep, 35, 30));
    expect(bad.ok).toBe(false);
    const bumpy = slopeGrid(0.4);
    for (let vx = 20; vx <= 40; vx += 2) for (let vy = 28; vy <= 33; vy++) bumpy.setCornerUnchecked(vx, vy, bumpy.getCorner(vx, vy) + 40);
    const b2 = validateLift(env(bumpy), 'funicular', A(bumpy, 10, 30), A(bumpy, 50, 30));
    expect(b2.ok).toBe(false);
  });
});

describe('placement, store, terraform blocking, bulldoze', () => {
  it('places all five lift kinds, charges, occupies tiles, and refunds on demolish', () => {
    const kinds: LiftKind[] = ['tbar', 'chair4', 'gondola6', 'cablecar', 'funicular'];
    const g = slopeGrid(0.4);
    const e = env(g, 1e9);
    kinds.forEach((k, i) => {
      const y = 6 + i * 10;
      const out = placeLift(e, undefined, k, A(g, 10, y), A(g, 10 + Math.min(40, LIFTS[k].maxLength - 10), y), false);
      expect(out.reasons).toEqual([]);
      expect(out.ok).toBe(true);
    });
    expect(e.lifts.size).toBe(5);
    const l = e.lifts.all()[1]!;
    expect(g.occupancy.has(10, 16, OccFlag.Lift)).toBe(true);
    expect(e.lifts.at(10, 16)?.id).toBe(l.id);
    const before = e.state.money;
    const r = demolishLift(e.lifts, e.economy, l.id);
    expect(r.ok).toBe(true);
    expect(e.state.money).toBeCloseTo(before + l.cost * 0.5, 0);
    expect(g.occupancy.has(10, 16, OccFlag.Lift)).toBe(false);
  });

  it('insufficient funds fails without placing', () => {
    const g = slopeGrid(0.4);
    const e = env(g, 10);
    const out = placeLift(e, undefined, 'chair4', A(g, 10, 30), A(g, 40, 30), false);
    expect(out.ok).toBe(false);
    expect(e.lifts.size).toBe(0);
  });

  it('terraforming under stations/towers is blocked', () => {
    const g = slopeGrid(0.4);
    const e = env(g);
    const out = placeLift(e, undefined, 'chair4', A(g, 10, 30), A(g, 50, 30), false);
    expect(out.ok).toBe(true);
    const tw = out.lift!.towers[0]!;
    const r = raiseLowerRect(g, { vx0: tw.tileX, vy0: tw.tileY, vx1: tw.tileX + 1, vy1: tw.tileY + 1 }, 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('occupied');
    const s = raiseLowerRect(g, { vx0: 10, vy0: 30, vx1: 11, vy1: 31 }, 1);
    expect(s.ok).toBe(false);
  });

  it('serialize/load roundtrips', () => {
    const g = slopeGrid(0.4);
    const e = env(g);
    placeLift(e, undefined, 'gondola6', A(g, 10, 30), A(g, 60, 30), false);
    const data = e.lifts.serialize();
    const g2 = slopeGrid(0.4);
    const s2 = new LiftStore(g2.occupancy);
    s2.load(data);
    expect(s2.all()).toEqual(data);
    expect(g2.occupancy.has(10, 30, OccFlag.Lift)).toBe(true);
  });
});

describe('derived stats and carriers', () => {
  const nodes = [{ x: 10, y: 1, z: 30 }, { x: 50, y: 11, z: 30 }];
  it('throughput = carriers/hour x capacity, scales with speed setting', () => {
    const s = computeStats('chair4', nodes, 1);
    const def = LIFTS.chair4;
    const rate = def.speed / ((2 * s.slant) / s.carriers); // carriers passing per second
    expect(s.throughputPerHour).toBeCloseTo(rate * 3600 * def.capacityPerCarrier, 3);
    expect(s.throughputPerHour).toBeGreaterThan(def.capacityPerCarrier * 3600 / def.carrierSpacing * def.speed * 0.9);
    const half = computeStats('chair4', nodes, 0.5);
    expect(half.throughputPerHour).toBeCloseTo(s.throughputPerHour / 2, 3);
    expect(half.rideTimeS).toBeCloseTo(s.rideTimeS * 2, 3);
    expect(s.rideTimeS).toBeCloseTo(s.slant / def.speed, 6);
  });
  it('cable car throughput uses cabin capacity over a cycle with dwell', () => {
    const s = computeStats('cablecar', nodes, 1);
    expect(s.throughputPerHour).toBeCloseTo((LIFTS.cablecar.capacityPerCarrier * 3600) / (s.rideTimeS + LIFT_DWELL_S), 3);
  });
  it('loop carriers are evenly spaced, move with phase, and wrap', () => {
    const l = { kind: 'chair4' as const, nodes };
    const a = carrierStates(l, 0), b = carrierStates(l, 3);
    expect(a.length).toBe(computeStats('chair4', nodes).carriers);
    expect(a.length).toBeGreaterThanOrEqual(4);
    expect(a.some((c) => c.strand === 0) && a.some((c) => c.strand === 1)).toBe(true);
    const moved = a.some((c, i) => Math.hypot(c.x - b[i]!.x, c.y - b[i]!.y, c.z - b[i]!.z) > 1);
    expect(moved).toBe(true);
    const p = liftPath(l);
    const loop = 2 * p.length;
    const w = carrierStates(l, loop);
    a.forEach((c, i) => { expect(w[i]!.x).toBeCloseTo(c.x, 5); expect(w[i]!.y).toBeCloseTo(c.y, 5); });
    for (const c of a) {
      expect(c.x).toBeGreaterThanOrEqual(10 - 0.01);
      expect(c.x).toBeLessThanOrEqual(50 + 0.01);
    }
  });
  it('reversible lifts run 2 cabins in opposition with dwell at the ends', () => {
    for (const kind of ['cablecar', 'funicular'] as const) {
      const l = { kind, nodes };
      const p = liftPath(l);
      const t0 = carrierStates(l, 0);
      expect(t0).toHaveLength(2);
      expect(t0[0]!.x).toBeCloseTo(10, 5); // A at bottom, B at top
      expect(t0[1]!.x).toBeCloseTo(50, 5);
      const dwell = LIFT_DWELL_S * LIFTS[kind].speed;
      const mid = carrierStates(l, dwell + p.length / 2);
      expect(mid[0]!.x + 0.0).toBeCloseTo(30, 0);
      expect(mid[1]!.x).toBeCloseTo(30, 0);
      expect(mid[0]!.strand).not.toBe(mid[1]!.strand);
      const end = carrierStates(l, dwell + p.length + 1);
      expect(end[0]!.x).toBeCloseTo(50, 5); // dwelling at top
      expect(end[1]!.x).toBeCloseTo(10, 5);
    }
  });
  it('catenary sag is zero at ends, maximal mid-span, and cable picking works', () => {
    expect(sagOffset(0, 10, 0.01)).toBeCloseTo(0);
    expect(sagOffset(1, 10, 0.01)).toBeCloseTo(0);
    expect(sagOffset(0.5, 10, 0.01)).toBeCloseTo(-0.1);
    const d = rayDistanceToLift({ kind: 'chair4', nodes }, { x: 30, y: 50, z: 30 }, { x: 0, y: -1, z: 0 });
    expect(d).toBeLessThan(0.5);
    const far = rayDistanceToLift({ kind: 'chair4', nodes }, { x: 30, y: 50, z: 45 }, { x: 0, y: -1, z: 0 });
    expect(far).toBeGreaterThan(10);
  });
});

import { buildCarrierGeometry } from '../../src/render/meshes/lifts';
import { buildStationGeometry } from '../../src/render/meshes/lifts/Station';
import { buildTowerGeometry } from '../../src/render/meshes/lifts/Tower';
import { buildCableGeometry } from '../../src/render/meshes/lifts/Cable';
import { buildTrackGeometry } from '../../src/render/meshes/lifts/Funicular';

describe('lift mesh geometry (data level; not rendered)', () => {
  it('builds non-empty geometry for every part and kind', () => {
    for (const k of ['tbar', 'chair4', 'gondola6', 'cablecar', 'funicular'] as const) {
      expect(buildCarrierGeometry(k).getAttribute('position').count).toBeGreaterThan(0);
      expect(buildStationGeometry(k, false).getAttribute('position').count).toBeGreaterThan(0);
      expect(buildStationGeometry(k, true).getAttribute('position').count).toBeGreaterThan(0);
    }
    expect(buildTowerGeometry(2).getAttribute('position').count).toBeGreaterThan(0);
    const nodes = [{ x: 10, y: 1, z: 30 }, { x: 30, y: 5, z: 30 }];
    expect(buildCableGeometry(liftPath({ kind: 'chair4', nodes })).getAttribute('position').count).toBeGreaterThan(0);
    expect(buildTrackGeometry(liftPath({ kind: 'funicular', nodes })).getAttribute('position').count).toBeGreaterThan(0);
  });
});
