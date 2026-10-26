import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { Economy } from '../../src/sim/Economy';
import { LiftStore, stationAnchor, validateLift, placeLift } from '../../src/sim/Lift';
import { snapLift, validKinds, whyNot, routeFacts } from '../../src/sim/LiftAssist';

function slopeGrid(rise: number): Grid {
  const g = new Grid(64);
  for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) g.setCornerUnchecked(vx, vy, Math.round(vx * rise));
  return g;
}
const mk = (g: Grid) => ({ grid: g, lifts: new LiftStore(g.occupancy), economy: new Economy({ money: 1e9 }) });
const A = (g: Grid, x: number, y: number) => stationAnchor(g, x, y);

describe('lift assist', () => {
  it('suggests kinds: a steep line is invalid for a T-bar but fine for a chairlift/gondola', () => {
    const g = slopeGrid(1.6); // 80% gradient
    const e = mk(g);
    const b = A(g, 10, 30), t = A(g, 30, 30);
    expect(validateLift(e, 'tbar', b, t).ok).toBe(false);
    const kinds = validKinds(e, b, t);
    expect(kinds).not.toContain('tbar');
    expect(kinds).toContain('chair4');
    expect(kinds).toContain('gondola6');
    const msg = whyNot('tbar', validateLift(e, 'tbar', b, t), kinds);
    expect(msg).toMatch(/Too steep/);
    expect(msg).toMatch(/Chairlift/);
  });

  it('stations auto-flatten by default; only fail on steep sites when flatten is off', () => {
    const g = slopeGrid(1.9);
    const e = mk(g);
    const b = A(g, 10, 30), t = A(g, 25, 30);
    const on = validateLift(e, 'cablecar', b, t);
    expect(on.reasons).toEqual([]);
    expect(on.flatten).toBe(true);
    expect(on.flattenCost).toBeGreaterThan(0);
    const off = validateLift(e, 'cablecar', b, t, { autoFlatten: false });
    expect(off.reasons.join()).toMatch(/too steep.*auto-flatten/);
  });

  it('snaps the top station to a nearby valid site', () => {
    const g = slopeGrid(0.5);
    const e = mk(g);
    // water around the requested top site; a dry site exists 3 tiles away
    for (let y = 28; y <= 33; y++) for (let x = 38; x <= 41; x++) g.occupancy.set(x, y, OccFlag.Water);
    const b = A(g, 10, 30), t = A(g, 40, 30);
    expect(validateLift(e, 'chair4', b, t).ok).toBe(false);
    const s = snapLift(e, 'chair4', b, t, { adjust: 'top' });
    expect(s).not.toBeNull();
    expect(s!.moved).toBe(true);
    expect(s!.check.ok).toBe(true);
    expect(s!.distance).toBeLessThanOrEqual(3.01);
    expect(s!.bottom).toEqual(b);
    // and the snapped line can actually be placed
    expect(placeLift(e, undefined, 'chair4', s!.bottom, s!.top).ok).toBe(true);
  });

  it('does not move a valid line, and gives up when nothing is near', () => {
    const g = slopeGrid(0.5);
    const e = mk(g);
    const b = A(g, 10, 30), t = A(g, 40, 30);
    const s = snapLift(e, 'chair4', b, t);
    expect(s!.moved).toBe(false);
    expect(s!.top).toEqual(t);
    expect(snapLift(e, 'tbar', b, A(g, 4, 30))).toBeNull(); // top not higher: no nearby fix
  });

  it('routeFacts reports length, drop, average gradient', () => {
    const g = slopeGrid(0.5);
    const c = validateLift(mk(g), 'chair4', A(g, 10, 30), A(g, 50, 30));
    const f = routeFacts(c)!;
    expect(f.lengthM).toBeCloseTo(400, -1);
    expect(f.dropM).toBeGreaterThan(0);
    expect(f.avgGradient).toBeCloseTo(0.25, 1);
  });
});
