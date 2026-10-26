import { describe, expect, it } from 'vitest';
import { makeResort } from '../game/harness';
import type { Sim } from '../../src/game/createSim';
import { Undo } from '../../src/build/UndoActions';
import { stateHash } from '../../src/game/saveState';
import { TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { applyDecor, applyFill, applyPond, applyRocks, planDecor, planFill, planPond, planRocks, pondRectAround, type TileRect } from '../../src/sim/landscape/Landscape';

const mk = () => { const { sim } = makeResort(64, 61); sim.tick(2); sim.progression.unlockAll = true; return { sim, undo: new Undo(sim) }; };
const site = (sim: Sim): TileRect => { const env = sim.landscapeEnv(); for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) { const r = pondRectAround(x, y, 5); if (planPond(env, r).ok) return r; } throw new Error('no site'); };
const digStroke = (sim: Sim, undo: Undo, r: TileRect) => {
  const env = sim.landscapeEnv(), plan = planPond(env, r), st = undo.landscapeStroke('Pond');
  return st.stamp(plan.rect, () => { if (!sim.economy.charge(plan.cost)) return { ok: false, flow: 0 }; const o = applyPond(env, sim.landscape, plan); return { ok: o.ok, flow: plan.cost }; });
};

describe('landscape undo / redo', () => {
  it('pond: undo restores heights, tile types, flags, props, money and the pond list; redo digs it again identically', () => {
    const { sim, undo } = mk();
    const r = site(sim), money = sim.game.money, h0 = stateHash(sim), l0 = JSON.stringify(sim.landscape.serialize());
    expect(digStroke(sim, undo, r)).toBe(true);
    const h1 = stateHash(sim), spent = money - sim.game.money, lakes = sim.buildings.lakeTiles.length;
    expect(spent).toBeGreaterThan(300);
    expect(h1.hash).not.toBe(h0.hash);
    const u = undo.undo();
    expect(u.ok, JSON.stringify(u)).toBe(true);
    expect(u.ok && u.verb).toBe('landscaped');
    const parts = stateHash(sim).parts;
    expect(Object.keys(parts).filter((k) => parts[k] !== h0.parts[k])).toEqual([]);
    expect(stateHash(sim).hash).toBe(h0.hash);
    expect(sim.game.money).toBe(money);
    expect(JSON.stringify(sim.landscape.serialize())).toBe(l0);
    expect(sim.buildings.lakeTiles.length).toBeLessThan(lakes);
    const rd = undo.redo();
    expect(rd.ok, JSON.stringify(rd)).toBe(true);
    expect(stateHash(sim).hash).toBe(h1.hash);
    expect(sim.game.money).toBe(money - spent);
    expect(sim.landscape.ponds).toHaveLength(1);
  });

  it('fill-in is undoable too (the water comes back)', () => {
    const { sim, undo } = mk();
    digStroke(sim, undo, site(sim));
    const pond = sim.landscape.ponds[0]!, g = sim.grid, t = pond.tileIdx[0]!;
    const afterDig = stateHash(sim).hash;
    const env = sim.landscapeEnv(), plan = planFill(env, sim.landscape, t % g.size, (t / g.size) | 0);
    const st = undo.landscapeStroke('Pond (filled in)');
    expect(st.stamp({ x0: 0, y0: 0, x1: 63, y1: 63 }, () => { sim.economy.charge(plan.cost); return { ok: applyFill(env, sim.landscape, plan).ok, flow: plan.cost }; })).toBe(true);
    expect(g.tileType[t]).toBe(TileType.Grass);
    expect(undo.undo().ok).toBe(true);
    expect(g.tileType[t]).toBe(TileType.Water);
    expect(stateHash(sim).hash).toBe(afterDig);
  });

  it('a decor drag with many stamps is ONE undo step', () => {
    const { sim, undo } = mk(), env = sim.landscapeEnv(), g = sim.grid;
    const tiles: Array<[number, number]> = [];
    for (let y = 10; y < 54 && tiles.length < 6; y++) for (let x = 10; x < 54 && tiles.length < 6; x++) if (planDecor(env, x, y, 'hedge').ok && (tiles.length === 0 || (tiles.at(-1)![0] === x - 1 && tiles.at(-1)![1] === y))) tiles.push([x, y]);
    expect(tiles.length).toBeGreaterThanOrEqual(3);
    const h0 = stateHash(sim).hash, size0 = undo.size;
    const st = undo.landscapeStroke('Hedge');
    for (const [x, y] of tiles) expect(st.stamp({ x0: x, y0: y, x1: x, y1: y }, () => { sim.economy.charge(30); applyDecor(sim.landscape, x, y, 'hedge', 0); return { ok: true, flow: 30 }; })).toBe(true);
    expect(undo.size).toBe(size0 + 1);
    expect(sim.landscape.decor.size).toBe(tiles.length);
    expect(undo.undo().ok).toBe(true);
    expect(sim.landscape.decor.size).toBe(0);
    for (const [x, y] of tiles) expect(g.occupancy.flags[g.tileIndex(x, y)]! & OccFlag.Decor).toBe(0);
    expect(stateHash(sim).hash).toBe(h0);
    expect(undo.redo().ok).toBe(true);
    expect(sim.landscape.decor.size).toBe(tiles.length);
  });

  it('boulders undo / redo through the same stroke', () => {
    const { sim, undo } = mk(), env = sim.landscapeEnv(), r = site(sim);
    const plan = planRocks(env, r.x0 + 2, r.y0 + 2, 3, 3), h0 = stateHash(sim).hash;
    const st = undo.landscapeStroke('Boulders');
    expect(st.stamp({ x0: r.x0, y0: r.y0, x1: r.x0 + 5, y1: r.y0 + 5 }, () => { sim.economy.charge(plan.cost); applyRocks(sim.props, plan); return { ok: true, flow: plan.cost }; })).toBe(true);
    const h1 = stateHash(sim).hash;
    expect(h1).not.toBe(h0);
    expect(undo.undo().ok).toBe(true); expect(stateHash(sim).hash).toBe(h0);
    expect(undo.redo().ok).toBe(true); expect(stateHash(sim).hash).toBe(h1);
  });

  it('is refused when the world moved on (something placed on the pond bank) and after the day changed', () => {
    const { sim, undo } = mk();
    digStroke(sim, undo, site(sim));
    const pond = sim.landscape.ponds[0]!;
    // someone fills the pond another way: the landscape list differs -> refused
    sim.landscape.removePond(pond.id);
    const u = undo.undo();
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.reason).toMatch(/changed since|terrain|landscape/i);
  });

  it('refuses across a day boundary like every other build action', () => {
    const { sim, undo } = mk();
    digStroke(sim, undo, site(sim));
    sim.game.date.day += 1;
    const u = undo.undo();
    expect(u.ok).toBe(false);
  });
});
