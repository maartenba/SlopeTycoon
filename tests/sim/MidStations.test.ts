import { describe, expect, it } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { Economy } from '../../src/sim/Economy';
import { LIFTS, type LiftKind } from '../../src/config/lifts';
import { LIFT_MID_TOWER_GAP, LIFT_STATION_SIZE } from '../../src/config/balance';
import {
  LiftStore, computeStats, demolishLift, isMultiStation, liftSegments, liftStations, liftStats, midStationsAllowed, placeLift, stationAnchor,
  stationCount, stationDistances, stationIndexAt, validateLift, type LiftData, type LiftEnv,
} from '../../src/sim/Lift';

/** Slope rising towards +x: height (half-steps) = round(x * rise). */
function slopeGrid(rise: number): Grid {
  const g = new Grid(64);
  for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) g.setCornerUnchecked(vx, vy, Math.round(vx * rise));
  return g;
}
const mkEnv = (g: Grid, money = 1e9): LiftEnv => ({ grid: g, lifts: new LiftStore(g.occupancy), economy: new Economy({ money }) });
const A = (g: Grid, x: number, y: number) => stationAnchor(g, x, y);

describe('N-station lifts: model (Task 36)', () => {
  it('only detachable chairs, gondolas and cable cars may have mid-stations', () => {
    const allowed = (Object.keys(LIFTS) as LiftKind[]).filter((k) => midStationsAllowed(k)).sort();
    expect(allowed).toEqual(['cablecar', 'chair4d', 'chair6', 'chair6b', 'chair6d', 'chair8b', 'gondola10', 'gondola6']);
    for (const k of ['tbar', 'chair2', 'chair4', 'funicular'] as LiftKind[]) expect(LIFTS[k].detachable && LIFTS[k].family !== 'funicular').toBe(false);
  });

  it('an ordinary lift is a 2-station lift: no `stations` field, derived [bottom, top], identical to an explicit empty mids list', () => {
    const g = slopeGrid(0.5), e = mkEnv(g);
    const a = validateLift(e, 'gondola6', A(g, 10, 30), A(g, 50, 30));
    const b = validateLift(e, 'gondola6', A(g, 10, 30), A(g, 50, 30), { mids: [] });
    expect(a.ok).toBe(true);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect('stations' in a.data!).toBe(false);
    const d = { ...a.data!, id: 1 } as LiftData;
    expect(stationCount(d)).toBe(2);
    expect(isMultiStation(d)).toBe(false);
    const st = liftStations(d);
    expect(st.map((s) => [s.x, s.y])).toEqual([[d.bottom.x, d.bottom.y], [d.top.x, d.top.y]]);
    expect(liftSegments(d)).toHaveLength(1);
    expect(stationIndexAt(d, d.top.x + 1, d.top.y)).toBe(1);
    expect(stationIndexAt(d, 0, 0)).toBe(-1);
  });

  it('stats of a lift with mid-stations add the station dwell to the ride time, the carrier cadence is unchanged', () => {
    const g = slopeGrid(0.5), e = mkEnv(g);
    const c = validateLift(e, 'gondola6', A(g, 10, 30), A(g, 50, 30), { mids: [A(g, 30, 30)] });
    expect(c.ok, c.reasons.join()).toBe(true);
    const two = computeStats('gondola6', c.data!.nodes, 1, 0), three = computeStats('gondola6', c.data!.nodes, 1, 1);
    expect(three.rideTimeS).toBeGreaterThan(two.rideTimeS);
    expect(three.throughputPerHour).toBeCloseTo(two.throughputPerHour);
    const d = { ...c.data!, id: 1 } as LiftData;
    expect(liftStats(d).rideTimeS).toBeCloseTo(three.rideTimeS);
    const cc = computeStats('cablecar', c.data!.nodes, 1, 1), c0 = computeStats('cablecar', c.data!.nodes, 1, 0);
    expect(cc.throughputPerHour).toBeLessThan(c0.throughputPerHour); // the cabin stops at every station
  });

  it('station distances are increasing and end at the cable length', () => {
    const g = slopeGrid(0.5), e = mkEnv(g);
    const c = validateLift(e, 'gondola6', A(g, 10, 30), A(g, 50, 30), { mids: [A(g, 30, 30)] });
    const d = { ...c.data!, id: 1 } as LiftData;
    const ds = stationDistances(d);
    expect(ds).toHaveLength(3);
    expect(ds[0]).toBe(0);
    expect(ds[1]!).toBeGreaterThan(10);
    expect(ds[2]!).toBeGreaterThan(ds[1]!);
    expect(ds[2]!).toBeCloseTo(computeStats('gondola6', d.nodes).slant, 6);
  });
});

describe('N-station lifts: per-segment validation + clearance (Task 37)', () => {
  const g0 = (): { g: Grid; e: LiftEnv } => { const g = slopeGrid(0.5); return { g, e: mkEnv(g) }; };

  it('accepts a gondola with one mid-station: 3 stations, mid node in the cable, cost = segments + one station price per station', () => {
    const { g, e } = g0();
    const c = validateLift(e, 'gondola6', A(g, 10, 30), A(g, 50, 30), { mids: [A(g, 30, 30)] });
    expect(c.reasons).toEqual([]);
    const d = c.data!;
    expect(d.stations).toHaveLength(3);
    expect(d.stations![0]!.node).toBe(0);
    expect(d.stations![2]!.node).toBe(d.nodes.length - 1);
    const mid = d.stations![1]!, mn = d.nodes[mid.node]!;
    expect(mn.x).toBeCloseTo(mid.x + LIFT_STATION_SIZE / 2); expect(mn.z).toBeCloseTo(mid.y + LIFT_STATION_SIZE / 2);
    const s1 = validateLift(e, 'gondola6', A(g, 10, 30), A(g, 30, 30)), s2 = validateLift(e, 'gondola6', A(g, 30, 30), A(g, 50, 30));
    expect(s1.ok && s2.ok).toBe(true);
    expect(c.cost).toBeCloseTo(s1.cost + s2.cost - LIFTS.gondola6.stationCost, 4);
    expect(c.supportCost).toBeCloseTo(s1.supportCost + s2.supportCost, 4);
    // the cable is continuous and rising
    for (let i = 1; i < d.nodes.length; i++) expect(d.nodes[i]!.y).toBeGreaterThanOrEqual(d.nodes[i - 1]!.y - 1e-9);
  });

  it('towers stay at least 2 tiles from the mid-station footprint, on both sides', () => {
    const { g, e } = g0();
    for (const kind of ['gondola6', 'chair6', 'cablecar'] as LiftKind[]) {
      for (const mx of [26, 28, 30, 32, 34]) {
        const c = validateLift(e, kind, A(g, 10, 30), A(g, 50, 30), { mids: [A(g, mx, 30)] });
        if (!c.ok) continue;
        const m = c.data!.stations![1]!;
        for (const t of c.data!.towers) {
          const gx = Math.max(m.x - t.tileX, t.tileX - (m.x + LIFT_STATION_SIZE - 1), 0), gy = Math.max(m.y - t.tileY, t.tileY - (m.y + LIFT_STATION_SIZE - 1), 0);
          expect(Math.max(gx, gy), `${kind} mid ${mx}`).toBeGreaterThanOrEqual(LIFT_MID_TOWER_GAP);
        }
      }
    }
  });

  it('only gondolas, cable cars and detachable chairs: others are refused with a clear reason', () => {
    const { g, e } = g0();
    for (const kind of ['tbar', 'chair2', 'chair4', 'funicular'] as LiftKind[]) {
      const c = validateLift(e, kind, A(g, 10, 30), A(g, 40, 30), { mids: [A(g, 25, 30)] });
      expect(c.ok, kind).toBe(false);
      expect(c.reasons.join(), kind).toMatch(/cannot have mid-stations/);
    }
    for (const kind of ['chair4d', 'chair6', 'chair6b', 'chair8b', 'gondola6', 'gondola10', 'cablecar'] as LiftKind[]) {
      const c = validateLift(e, kind, A(g, 10, 30), A(g, 50, 30), { mids: [A(g, 30, 30)] });
      expect(c.reasons.join(), kind).not.toMatch(/cannot have mid-stations/);
    }
  });

  it('two mid-stations are fine, three are refused; mids must lie on the line, between the ends and apart', () => {
    const { g, e } = g0();
    expect(validateLift(e, 'gondola6', A(g, 6, 30), A(g, 56, 30), { mids: [A(g, 22, 30), A(g, 40, 30)] }).ok).toBe(true);
    const three = validateLift(e, 'gondola6', A(g, 6, 30), A(g, 56, 30), { mids: [A(g, 18, 30), A(g, 30, 30), A(g, 42, 30)] });
    expect(three.ok).toBe(false); expect(three.reasons.join()).toMatch(/At most 2 mid-stations/);
    const off = validateLift(e, 'gondola6', A(g, 10, 30), A(g, 50, 30), { mids: [A(g, 30, 38)] });
    expect(off.ok).toBe(false); expect(off.reasons.join()).toMatch(/straight line/);
    const beyond = validateLift(e, 'gondola6', A(g, 10, 30), A(g, 50, 30), { mids: [A(g, 56, 30)] });
    expect(beyond.ok).toBe(false); expect(beyond.reasons.join()).toMatch(/between the end stations/);
    const close = validateLift(e, 'gondola6', A(g, 10, 30), A(g, 50, 30), { mids: [A(g, 12, 30)] });
    expect(close.ok).toBe(false);
  });

  it('each segment is validated separately: a segment that is too steep / too short / blocked names the segment', () => {
    const { g, e } = g0();
    // a wall of rock under the second segment: terrain jump makes segment 2 too steep on average
    for (let vy = 0; vy <= 64; vy++) for (let vx = 31; vx <= 64; vx++) g.setCornerUnchecked(vx, vy, Math.round(vx * 0.5) + 60);
    const c = validateLift(e, 'gondola6', A(g, 10, 30), A(g, 50, 30), { mids: [A(g, 30, 30)] });
    expect(c.ok).toBe(false);
    expect(c.reasons.join()).toMatch(/Mid-station|Segment 2|steep/);
  });

  it('a blocked / watery mid-station site is refused as a mid-station', () => {
    const { g, e } = g0();
    const m = A(g, 30, 30);
    g.occupancy.set(m.x, m.y, OccFlag.Building, 1);
    const c = validateLift(e, 'gondola6', A(g, 10, 30), A(g, 50, 30), { mids: [m] });
    expect(c.ok).toBe(false);
    expect(c.reasons.join()).toMatch(/Mid-station site occupied/);
  });

  it('the mid-station gets a flat pad (auto-flatten) and funds are checked once', () => {
    const { g, e } = g0();
    for (let vy = 29; vy <= 33; vy++) for (let vx = 29; vx <= 33; vx++) g.setCornerUnchecked(vx, vy, Math.round(vx * 0.5) + (vx + vy) % 3);
    const c = validateLift(e, 'gondola6', A(g, 10, 30), A(g, 50, 30), { mids: [A(g, 30, 30)] });
    expect(c.reasons).toEqual([]);
    expect(c.flatten).toBe(true);
    expect(c.flattenPlan.filter((p) => p.site.x === 29 || p.site.x === 30).length).toBe(1); // shared pad levelled once
    const poor = mkEnv(g, 100);
    const p = validateLift(poor, 'gondola6', A(g, 10, 30), A(g, 50, 30), { mids: [A(g, 30, 30)] });
    expect(p.reasons.join()).toMatch(/Not enough funds/);
    expect(p.reasons.filter((r) => /Not enough funds/.test(r))).toHaveLength(1);
    const noFlat = validateLift(e, 'gondola6', A(g, 10, 30), A(g, 50, 30), { mids: [A(g, 30, 30)], autoFlatten: false });
    expect(noFlat.ok).toBe(false);
  });

  it('places, occupies the mid-station tiles, round-trips through serialize/restore and demolishes cleanly', () => {
    const { g, e } = g0();
    const before = g.occupancy.flags.slice();
    const out = placeLift(e, undefined, 'gondola6', A(g, 10, 30), A(g, 50, 30), true, true, [A(g, 30, 30)]);
    expect(out.ok, out.reasons.join()).toBe(true);
    const l = out.lift!;
    expect(l.stations).toHaveLength(3);
    const m = l.stations![1]!;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) expect(e.lifts.at(m.x + i, m.y + j)?.id).toBe(l.id);
    const s = e.lifts.serialize();
    const store2 = new LiftStore(g.occupancy);
    store2.restore(JSON.parse(JSON.stringify(s)), e.lifts.nextIdValue());
    expect(JSON.stringify(store2.serialize())).toBe(JSON.stringify(s));
    expect(demolishLift(e.lifts, e.economy, l.id).ok).toBe(true);
    expect(Array.from(g.occupancy.flags)).toEqual(Array.from(before));
  });

  it('placing the same lift without mids stays byte-identical to the old behaviour (no stations field, same record shape)', () => {
    const { g, e } = g0();
    const out = placeLift(e, undefined, 'gondola6', A(g, 10, 30), A(g, 50, 30));
    expect(out.ok).toBe(true);
    expect(Object.keys(out.lift!).sort()).not.toContain('stations');
  });
});
