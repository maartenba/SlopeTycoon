import { describe, it, expect } from 'vitest';
import { Grid, TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { Networks, NetKind } from '../../src/world/Networks';
import { Buildings } from '../../src/sim/Buildings';
import { Economy } from '../../src/sim/Economy';
import { PropStore, PropKind } from '../../src/world/Props';
import { validatePlacement, placeBuilding, ghostLines } from '../../src/build/PlacementTool';
import { rotateBuilding } from '../../src/sim/PlaceBuilding';
import { autoFlattenDefault, autoFlattenPolicy } from '../../src/sim/PlacementRules';

const mk = (gx = 1, gy = 0) => {
  const grid = new Grid(64);
  for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) grid.setCornerUnchecked(vx, vy, 40 + Math.round(vx * gx + vy * gy));
  const buildings = new Buildings(grid.occupancy);
  const economy = new Economy({ money: 1e7 });
  const net = new Networks(grid, buildings);
  buildings.setNetwork({ pathDistance: net.pathDistance, roadConnected: net.roadConnected, access: net.access });
  const props = new PropStore(grid);
  return { grid, buildings, economy, net, props, env: { grid, buildings, economy, props } };
};

describe('chalet on a forested slope (the reported case)', () => {
  it('is placeable with auto-flatten on a 1 half-step/tile slope: pad level, trees cleared, cost shown, invariants kept', () => {
    const { env, grid, props } = mk(1, 0);
    for (let y = 18; y < 28; y++) for (let x = 18; x < 28; x++) props.add(PropKind.Conifer, x, y, 0.5, 0.5, 1, 0, 1);
    const chk = validatePlacement(env, 'chalet', 20, 20, 0, true);
    expect(chk.ok, chk.reasons.join()).toBe(true);
    expect(chk.flatten).toBe(true);
    expect(chk.trees).toBe(9);
    expect(chk.info.join()).toMatch(/Levelling: \$\d+ \(cut \d+ \/ fill \d+\)/);
    expect(chk.info.join()).toMatch(/Trees will be cleared \(9\)/);
    const out = placeBuilding(env, props, 'chalet', 20, 20, 0, true);
    expect(out.ok).toBe(true);
    const hs = new Set<number>();
    for (let vy = 20; vy <= 23; vy++) for (let vx = 20; vx <= 23; vx++) hs.add(grid.getCorner(vx, vy));
    expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(1);
    expect(grid.checkInvariants()).toEqual([]);
    expect(props.countInRect(20, 20, 22, 22)).toBe(0);
    expect(props.countInRect(24, 18, 27, 27)).toBeGreaterThan(0); // apron trees are kept (they re-seat on the new ground)
    expect(out.touchedChunks.length).toBeGreaterThan(0);
  });
  it('without auto-flatten: every reason listed in plain language with the Auto-flatten hint', () => {
    const { env } = mk(1, 0);
    const chk = validatePlacement(env, 'chalet', 20, 20, 0, false);
    expect(chk.ok).toBe(false);
    const lines = ghostLines(chk).map((l) => l.text).join('|');
    expect(lines).toMatch(/Too steep — enable Auto-flatten \(F\)/);
  });
  it('missing road access is an amber warning, not a blocker', () => {
    const { env } = mk(0, 0);
    const chk = validatePlacement(env, 'chalet', 20, 20, 0, true);
    expect(chk.ok).toBe(true);
    expect(chk.warnings.join()).toMatch(/needs a footpath or road/i);
    expect(ghostLines(chk).some((l) => l.kind === 'warn' && /inactive/.test(l.text))).toBe(true);
  });
  it('lists every blocking reason at once (water ripple + occupied tile)', () => {
    const { env, grid, buildings } = mk(1, 0);
    buildings.add('shop', 20, 20);
    grid.tileType[grid.tileIndex(21, 23)] = TileType.Water;
    grid.occupancy.set(21, 23, OccFlag.Water);
    const chk = validatePlacement(env, 'chalet', 20, 20, 0, true);
    expect(chk.reasons.length).toBeGreaterThanOrEqual(2);
    expect(ghostLines(chk).filter((l) => l.kind === 'error').length).toBe(chk.reasons.length);
  });
  it('flattening next to water is refused with a hint', () => {
    const { env, grid } = mk(1.5, 0);
    for (const x of [18, 24]) for (let y = 19; y < 25; y++) { grid.tileType[grid.tileIndex(x, y)] = TileType.Water; grid.occupancy.set(x, y, OccFlag.Water); }
    const chk = validatePlacement(env, 'chalet', 20, 20, 0, true);
    expect(chk.ok).toBe(false);
    expect(chk.reasons.join()).toMatch(/Cannot flatten/);
    expect(chk.hintFor[chk.reasons[0]!]).toMatch(/water/);
  });
  it('a road in the apron is tolerated while it keeps its slope limit', () => {
    const { env, net, grid } = mk(1, 0);
    for (let y = 14; y < 30; y++) net.build(NetKind.Road, 28, y);
    const chk = validatePlacement(env, 'chalet', 20, 20, 0, true);
    expect(chk.ok, chk.reasons.join()).toBe(true);
    placeBuilding(env, undefined, 'chalet', 20, 20, 0, true);
    for (let y = 14; y < 30; y++) { const c = grid.getCorners(28, y); expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(1); }
  });
});

describe('auto-flatten policy and rotation', () => {
  it('chalet defaults on; cannon/sign/magic carpet never flatten; huts optional', () => {
    expect(autoFlattenDefault('chalet')).toBe(true);
    for (const id of ['snowCannon', 'warningSign', 'magicCarpet']) expect(autoFlattenPolicy(id)).toBe('never');
    expect(autoFlattenPolicy('mountainHut')).toBe('optional');
    const { env } = mk(1, 0);
    expect(validatePlacement(env, 'snowCannon', 20, 20, 0, true).flatten).toBe(false);
    expect(validatePlacement(env, 'magicCarpet', 20, 20, 0, true).flatten).toBe(false);
  });
  it('rotation never flattens: a rotated chalet on level ground turns, on a slope it refuses', () => {
    const flat = mk(0, 0);
    const b = flat.buildings.add('apartment', 20, 20).building;
    expect(rotateBuilding(flat.env, undefined, b.id, 1).ok).toBe(true);
    const slope = mk(1, 0);
    const c = slope.buildings.add('apartment', 20, 20).building;
    const r = rotateBuilding(slope.env, undefined, c.id, 1);
    expect(r.ok).toBe(false);
    expect(slope.grid.getCorner(21, 21)).toBe(61);
  });
});
