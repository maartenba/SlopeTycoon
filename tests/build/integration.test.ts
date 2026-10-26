import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { Networks, Layer } from '../../src/world/Networks';
import { networkProviderFrom } from '../../src/build/NetworkAdapter';
import { Buildings } from '../../src/sim/Buildings';
import { Economy } from '../../src/sim/Economy';
import { LiftStore, placeLift, stationAnchor, liftClearanceViolations } from '../../src/sim/Lift';
import { raiseLowerRect } from '../../src/world/Terraform';
import { validatePlacement } from '../../src/build/PlacementTool';
import { createGameState, STARTING_MONEY } from '../../src/core/GameState';

const flat = (n: 64 | 128 | 256 = 64, h = 0): Grid => {
  const g = new Grid(n);
  for (let vy = 0; vy <= n; vy++) for (let vx = 0; vx <= n; vx++) g.setCornerUnchecked(vx, vy, h);
  return g;
};

describe('network provider adapter', () => {
  it('offsets difficulty by one and reports 0 when no piste', () => {
    const g = flat();
    const b = new Buildings(g.occupancy);
    const n = new Networks(g, b);
    const p = networkProviderFrom(n);
    expect(p.getPisteDifficultyAt(5, 5)).toBe(0);
    n.paint(Layer.Ski, [{ x: 5, y: 5 }], 0);
    n.paint(Layer.Mtb, [{ x: 6, y: 5 }], 3);
    expect(p.getPisteDifficultyAt(5, 5)).toBe(1); // green
    expect(p.getPisteDifficultyAt(6, 5)).toBe(4); // black
    expect(p.getPisteDifficultyAt(-1, 0)).toBe(0);
    expect(p.getPisteDifficultyAt(999, 0)).toBe(0);
  });
  it('connectivity delegates to Networks', () => {
    const g = flat();
    const b = new Buildings(g.occupancy);
    const n = new Networks(g, b);
    n.roadEntry = { x: 0, y: 10 };
    const { building } = b.add('cafe', 10, 10);
    const p = networkProviderFrom(n);
    expect(p.isConnectedBuilding(building.id)).toBe(n.isConnected(building.id));
    expect(p.isConnectedBuilding(building.id)).toBe(false);
  });
});

describe('altiport runway + shuttle warning', () => {
  const mk = () => {
    const grid = flat();
    const buildings = new Buildings(grid.occupancy);
    const economy = new Economy({ money: 1e6 });
    return { grid, buildings, economy, env: { grid, buildings, economy } };
  };
  it('rejects a sloped altiport with the runway reason (no autoflatten)', () => {
    const { env, grid } = mk();
    for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) grid.setCornerUnchecked(vx, vy, vx >= 12 ? 2 : 0);
    const r = validatePlacement(env, 'altiport', 8, 8, 0, false);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('Runway must be flat');
    expect(r.reasons).not.toContain('Too steep');
  });
  it('accepts flat ground and warns about the shuttle depot when out of walking range', () => {
    const { env, buildings } = mk();
    buildings.add('baseLodge', 40, 40);
    const far = validatePlacement(env, 'altiport', 2, 2, 0, false);
    expect(far.reasons).toEqual([]);
    expect(far.warnings).toContain('Needs Shuttle Bus Depot');
  });
  it('no warning near the Base Lodge', () => {
    const { env, buildings } = mk();
    buildings.add('baseLodge', 20, 20);
    expect(validatePlacement(env, 'trainStation', 26, 20, 0, false).warnings).toEqual([]);
  });
});

describe('terraform vs lift clearance', () => {
  const setup = () => {
    const grid = flat(64, 0);
    for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) grid.setCornerUnchecked(vx, vy, Math.min(Math.round(vx * 0.5), 12));
    const economy = new Economy({ money: 1e9 });
    const lifts = new LiftStore(grid.occupancy);
    const out = placeLift({ grid, lifts, economy }, undefined, 'chair4', stationAnchor(grid, 10, 30), stationAnchor(grid, 40, 30), true);
    return { grid, lifts, out };
  };
  it('rejects raising terrain under the cable span, accepts it elsewhere', () => {
    const { grid, lifts, out } = setup();
    expect(out.reasons).toEqual([]);
    expect(out.ok).toBe(true);
    const l = lifts.all()[0]!;
    const hook = (ch: Parameters<typeof liftClearanceViolations>[2]) => liftClearanceViolations(grid, lifts, ch);
    // find the midspan node with least clearance and raise right under it
    const a = l.nodes[1]!, b = l.nodes[2]!; // between two towers, away from occupied tiles
    const cx = Math.round((a.x + b.x) / 2), cy = Math.round((a.z + b.z) / 2);
    const before = grid.getCorner(cx, cy);
    let res = { ok: true, reason: undefined as string | undefined };
    for (let i = 0; i < 12 && res.ok; i++) {
      const r = raiseLowerRect(grid, { vx0: cx, vy0: cy, vx1: cx, vy1: cy }, 1, { liftClearanceViolations: hook });
      res = { ok: r.ok, reason: r.reason };
    }
    expect(res.reason).toBe('lift clearance');
    // the rejected edit was rolled back
    expect(grid.getCorner(cx, cy)).toBeLessThanOrEqual(before + 11);
    const far = raiseLowerRect(grid, { vx0: 55, vy0: 5, vx1: 56, vy1: 6 }, 1, { liftClearanceViolations: hook });
    expect(far.ok).toBe(true);
    // lowering is always fine
    const low = raiseLowerRect(grid, { vx0: cx, vy0: cy, vx1: cx, vy1: cy }, -1, { liftClearanceViolations: hook });
    expect(low.reason).not.toBe('lift clearance');
  });
  it('without the hook terraform is unaffected', () => {
    const { grid } = setup();
    expect(raiseLowerRect(grid, { vx0: 20, vy0: 29, vx1: 21, vy1: 30 }, 1).reason).not.toBe('lift clearance');
  });
  it('rejected lift placement leaves terrain and money untouched', () => {
    const grid = flat(64, 0);
    for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) grid.setCornerUnchecked(vx, vy, vx < 20 ? 0 : 1 + (vx % 2));
    const state = { money: 1e9 };
    const economy = new Economy(state);
    const lifts = new LiftStore(grid.occupancy);
    const snap = Array.from(grid.heights);
    const r = placeLift({ grid, lifts, economy }, undefined, 'tbar', stationAnchor(grid, 40, 30), stationAnchor(grid, 10, 30), true);
    expect(r.ok).toBe(false); // top must be higher than bottom
    expect(Array.from(grid.heights)).toEqual(snap);
    expect(state.money).toBe(1e9);
  });
});

describe('new game', () => {
  it('starts with a playable amount of money', () => {
    expect(STARTING_MONEY).toBe(130000);
    expect(createGameState(1).money).toBe(130000);
  });
});
