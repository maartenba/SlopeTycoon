import { describe, it, expect } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { Grid, TileType, isWaterType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { planFlatten, withChanges } from '../../src/world/FlattenPlanner';
import { BUILDINGS } from '../../src/config/buildings';
import { footprintOf } from '../../src/sim/Buildings';
import { placeBuilding, planPad, validatePlacement } from '../../src/sim/PlaceBuilding';

const TYPES = ['chalet', 'apartment', 'lodge', 'shop', 'rental', 'skiSchoolHQ', 'patrolHub', 'cafe', 'ticketOffice'];

function ramp(size: 64 | 128 | 256, gx: number, gy: number): Grid {
  const g = new Grid(size);
  for (let vy = 0; vy <= size; vy++) for (let vx = 0; vx <= size; vx++) g.setCornerUnchecked(vx, vy, 40 + Math.round(vx * gx + vy * gy));
  return g;
}

function candidates(sim: ReturnType<typeof createSim>, type: string, rot: number, stride: number): Array<{ x: number; y: number; steep: number }> {
  const { grid } = sim, occ = grid.occupancy, { w, h } = footprintOf(type, rot);
  const out: Array<{ x: number; y: number; steep: number }> = [];
  const blocked = (tx: number, ty: number): boolean => {
    const fl = occ.flags[occ.index(tx, ty)]!;
    return (fl & (OccFlag.Building | OccFlag.Lift | OccFlag.Water)) !== 0 || isWaterType(grid.tileType[grid.tileIndex(tx, ty)]!);
  };
  for (let y = 1; y + h <= grid.size - 1; y += stride) for (let x = 1; x + w <= grid.size - 1; x += stride) {
    let hard = false, steep = 0;
    for (let j = y; j < y + h && !hard; j++) for (let i = x; i < x + w; i++) {
      const fl = occ.flags[occ.index(i, j)]!;
      if ((fl & (OccFlag.Road | OccFlag.Path)) || blocked(i, j) || grid.tileType[grid.tileIndex(i, j)] === TileType.Rock) { hard = true; break; }
      steep = Math.max(steep, grid.steepness(i, j));
    }
    for (let vy = y; vy <= y + h && !hard; vy++) for (let vx = x; vx <= x + w && !hard; vx++) {
      for (let ty = vy - 1; ty <= vy; ty++) for (let tx = vx - 1; tx <= vx; tx++) if (grid.inBounds(tx, ty) && blocked(tx, ty)) hard = true;
    }
    if (!hard) out.push({ x, y, steep });
  }
  return out;
}

describe('FlattenPlanner', () => {
  it('levels a uniform 1 half-step/tile slope with a bounded apron, tilt-free, deterministic', () => {
    const g = ramp(64, 1, 0);
    const a = planFlatten(g, { x: 30, y: 30, w: 3, h: 3 }, { slack: 0 });
    const b = planFlatten(g, { x: 30, y: 30, w: 3, h: 3 }, { slack: 0 });
    expect(a.ok).toBe(true);
    expect(a).toEqual(b);
    expect(a.cost).toBeGreaterThan(0);
    expect(a.cut).toBeGreaterThan(0); expect(a.fill).toBeGreaterThan(0);
    withChanges(g, a.changes, () => {
      const hs = new Set<number>();
      for (let vy = 30; vy <= 33; vy++) for (let vx = 30; vx <= 33; vx++) hs.add(g.getCorner(vx, vy));
      expect(hs.size).toBe(1);
      expect(g.checkInvariants()).toEqual([]);
    });
    expect(g.getCorner(31, 31)).toBe(71); // preview never mutates
    expect(a.changes.every((c) => c.vx >= 0 && c.vx <= 64)).toBe(true);
  });
  it('the old unbounded ripple cannot cut a 1/tile slope; a 2/tile slope cannot be levelled at all (reported, not corrupted)', () => {
    const g = ramp(64, 2, 0);
    const p = planFlatten(g, { x: 30, y: 30, w: 3, h: 3 }, { slack: 0 });
    expect(p.ok).toBe(false);
    expect(p.changes).toEqual([]);
    expect(p.fail?.kind).toBeDefined();
    expect(g.getCorner(31, 31)).toBe(102);
  });
  it('frozen vertices (water, buildings) reject plans that would move them', () => {
    const g = ramp(64, 1, 0);
    const p = planFlatten(g, { x: 30, y: 30, w: 3, h: 3 }, { slack: 0, frozen: (vx) => (vx === 38 ? 'water' : null), margin: 10 });
    // either the apron stops before x = 18 or the plan fails on water: it never moves a frozen vertex
    if (p.ok) expect(p.changes.some((c) => c.vx === 38)).toBe(false); else expect(p.fail?.kind).toBe('water');
  });

  describe.each([[64, 61], [64, 7], [128, 5]] as const)('generated terrain %i / seed %i', (size, seed) => {
    it('flat-needing buildings: >= 90% placeable (steepness <= 1.5, no hard blockers), invariants kept, never touches occupied/water, cost > 0', () => {
      const sim = createSim({ size, seed, money: 1e12, starterResort: true });
      const { grid } = sim;
      let n = 0, ok = 0, needed = 0;
      for (const type of TYPES) for (const rot of [0, 1]) {
        for (const c of candidates(sim, type, rot, size === 64 ? 3 : 7)) {
          if (c.steep > 1.5) continue;
          const chk = validatePlacement(sim.env, type, c.x, c.y, rot, true);
          const rs = chk.reasons.filter((r) => !/^Needs [A-Z]|Limit|funds|piste/.test(r));
          n++;
          if (!rs.length) ok++;
          if (chk.flatten) {
            needed++;
            expect(chk.flattenCost).toBeGreaterThan(0);
            const { w, h } = footprintOf(type, rot);
            const plan = planPad(sim.env, type, c.x, c.y, w, h);
            for (const ch of plan.changes) for (let ty = ch.vy - 1; ty <= ch.vy; ty++) for (let tx = ch.vx - 1; tx <= ch.vx; tx++) {
              if (!grid.inBounds(tx, ty)) continue;
              const fl = grid.occupancy.flags[grid.occupancy.index(tx, ty)]!;
              expect(fl & (OccFlag.Building | OccFlag.Lift | OccFlag.Water), `${type}@${c.x},${c.y}`).toBe(0);
              expect(isWaterType(grid.tileType[grid.tileIndex(tx, ty)]!)).toBe(false);
            }
          }
        }
      }
      expect(n).toBeGreaterThan(100);
      expect(needed).toBeGreaterThan(20);
      expect(ok / n).toBeGreaterThanOrEqual(0.9);
      expect(grid.checkInvariants()).toEqual([]);
    });
    it('committing 12 placements keeps every terrain invariant and the pad flat enough', () => {
      const sim = createSim({ size, seed, money: 1e12, starterResort: true });
      const { grid } = sim;
      let placed = 0;
      const rng = (() => { let s = seed; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; })();
      for (let tries = 0; tries < 400 && placed < 12; tries++) {
        const type = TYPES[Math.floor(rng() * TYPES.length)]!;
        const rot = Math.floor(rng() * 2);
        const { w, h } = footprintOf(type, rot);
        const x = 1 + Math.floor(rng() * (size - w - 2)), y = 1 + Math.floor(rng() * (size - h - 2));
        const out = placeBuilding(sim.env, sim.props, type, x, y, rot, true);
        if (!out.ok) continue;
        placed++;
        let mn = Infinity, mx = -Infinity;
        for (let vy = y; vy <= y + h; vy++) for (let vx = x; vx <= x + w; vx++) { mn = Math.min(mn, grid.getCorner(vx, vy)); mx = Math.max(mx, grid.getCorner(vx, vy)); }
        expect(mx - mn).toBeLessThanOrEqual(BUILDINGS[type]!.site.maxSlope);
        expect(grid.checkInvariants()).toEqual([]);
      }
      expect(placed).toBe(12);
    });
  });
});
