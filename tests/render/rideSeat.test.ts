import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { Economy } from '../../src/sim/Economy';
import { LiftStore, STRAND_OFFSET, liftPath, samplePath, stationAnchor, validateLift } from '../../src/sim/Lift';
import { LIFTS } from '../../src/config/lifts';
import { EYE, MIN_SEAT_OUT, ViewCameraRig, eyeLateral, eyePosition, seatLateral, type RideKind, type RideSample } from '../../src/render/view/ViewCameraRig';
import { RIDE_NEAR } from '../../src/render/view/ViewCameraRig';

const sample = (kind: RideKind, over: Partial<RideSample> = {}): RideSample => ({ x: 0, y: 0, z: 0, hx: 0, hz: -1, speed: 1, slope: 0, kind, ...over });

describe('ride eye seat offset (cable carriers)', () => {
  it('seat lateral is deterministic per guest, >= the minimum, and varies between guests', () => {
    for (const kind of ['chair', 'gondola', 'cablecar'] as const) {
      const vals = new Set<number>();
      for (let id = 1; id <= 60; id++) {
        const a = seatLateral(kind, id, 4), b = seatLateral(kind, id, 4);
        expect(a).toBe(b);
        expect(a).toBeGreaterThanOrEqual(MIN_SEAT_OUT - 1e-9);
        vals.add(a);
      }
      if (kind === 'chair') expect(vals.size).toBe(2); // 4 seats: two outer seats
    }
    expect(seatLateral('chair', 7, 2)).toBeCloseTo(MIN_SEAT_OUT); // 2-seater has one outer seat
    expect(new Set(Array.from({ length: 80 }, (_, i) => seatLateral('chair', i + 1, 8))).size).toBeGreaterThan(2);
    expect(seatLateral('ski', 3)).toBe(0);
    expect(seatLateral('funicular', 3)).toBe(0);
    expect(eyeLateral(sample('chair', { seat: 5 }))).toBeCloseTo(STRAND_OFFSET + seatLateral('chair', 5, 4));
    expect(eyeLateral(sample('ski'))).toBe(0);
  });

  it('eye shifts to the rider\'s right, whatever the heading', () => {
    const out = { x: 0, y: 0, z: 0 };
    for (const [hx, hz] of [[0, -1], [1, 0], [0, 1], [-1, 0], [0.6, 0.8]] as const) {
      eyePosition(sample('chair', { hx, hz, seat: 2 }), 0, 1, out);
      const lat = eyeLateral(sample('chair', { seat: 2 }));
      expect(out.x - hx * EYE.chair.fwd).toBeCloseTo(-hz * lat, 6);
      expect(out.z - hz * EYE.chair.fwd).toBeCloseTo(hx * lat, 6);
    }
  });

  it('keeps the offset (and the last heading) while the carrier dwells at a station (no heading)', () => {
    const rig = new ViewCameraRig();
    const s = sample('chair', { x: 5, z: 5, hx: 1, hz: 0, seat: 3 });
    rig.update(1 / 60, s);
    const p1 = { x: rig.pose.x, z: rig.pose.z };
    s.hx = 0; s.hz = 0; // stopped: unknown heading
    for (let i = 0; i < 30; i++) rig.update(1 / 60, s);
    expect(Math.hypot(rig.pose.x - p1.x, rig.pose.z - p1.z)).toBeLessThan(1e-3);
  });

  for (const kind of ['chair2', 'chair4', 'chair6', 'gondola6', 'cablecar'] as const) {
    it(`simulated pass of every tower on a ${kind}: the head stays beside the mast and clear of the sheaves / crossarm`, () => {
      const g = new Grid(64);
      for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) g.setCornerUnchecked(vx, vy, Math.round(vx * 0.5));
      const env = { grid: g, lifts: new LiftStore(g.occupancy), economy: new Economy({ money: 1e9 }) };
      const chk = validateLift(env, kind, stationAnchor(g, 8, 30), stationAnchor(g, 52, 30), { skipFunds: true });
      expect(chk.ok, chk.reasons.join(',')).toBe(true);
      const path = liftPath(chk.data!);
      const def = LIFTS[kind], fam = def.family;
      const rk: RideKind = fam === 'gondola' ? 'gondola' : fam === 'cablecar' ? 'cablecar' : 'chair';
      const out = { x: 0, y: 0, z: 0 };
      let minMast = Infinity, minSheave = Infinity, minArmGap = Infinity;
      for (const guest of [1, 2, 3, 4, 5, 6, 7, 8]) for (const t of chk.data!.towers) {
        for (let d = 0; d <= path.length; d += 0.02) {
          const sp = samplePath(path, d, 0); // the sim position: on the line axis
          if (Math.hypot(sp.x - t.x, sp.z - t.z) > 1.2) continue;
          eyePosition(sample(rk, { x: sp.x, y: sp.y, z: sp.z, hx: path.dirX, hz: path.dirZ, seat: guest, seats: def.capacityPerCarrier }), 0, 0, out);
          const horiz = Math.hypot(out.x - t.x, out.z - t.z);
          minMast = Math.min(minMast, horiz);
          // sheave trains sit ON the strands (lateral +-0.3) just under the cable (cable y at the head: t.headY)
          for (const sgn of [-1, 1]) {
            const sx = t.x - path.dirZ * STRAND_OFFSET * sgn, sz = t.z + path.dirX * STRAND_OFFSET * sgn;
            minSheave = Math.min(minSheave, Math.hypot(out.x - sx, out.z - sz, out.y - (t.headY - 0.12)));
          }
          if (Math.hypot(out.x - t.x, out.z - t.z) < 0.4) minArmGap = Math.min(minArmGap, Math.abs(out.y - (t.headY - 0.1)));
        }
      }
      // the head is never on the mast axis / inside the sheave trains; far from the near plane (0.05)
      expect(minMast, 'eye to mast axis').toBeGreaterThanOrEqual(STRAND_OFFSET + MIN_SEAT_OUT - 0.02);
      if (rk === 'chair') expect(minSheave, 'eye to sheave').toBeGreaterThanOrEqual(0.14);
      else expect(minSheave, 'eye to sheave').toBeGreaterThanOrEqual(0.4);
      expect(minMast).toBeGreaterThan(RIDE_NEAR * 6);
      expect(minArmGap).toBeGreaterThanOrEqual(0.09);
    });
  }
});
