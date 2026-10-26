import { describe, expect, it } from 'vitest';
import { makeResort } from '../game/harness';
import type { Sim } from '../../src/game/createSim';
import { Undo, undoMessage, redoMessage } from '../../src/build/UndoActions';
import { UndoStack, DAY_REFUSAL, type UndoCommand } from '../../src/build/UndoStack';
import { stateHash } from '../../src/game/saveState';
import { validatePlacement } from '../../src/sim/PlaceBuilding';
import { Layer } from '../../src/world/Networks';
import { TileType } from '../../src/world/Grid';
import { raiseLowerRect, tileBrushRect } from '../../src/world/Terraform';
import { applyClearing, applyPlanting, planClearing, planPlanting } from '../../src/sim/nature/Planting';

const mk = (seed = 61) => {
  const { sim } = makeResort(64, seed);
  sim.tick(3);
  return { sim, undo: new Undo(sim) };
};
const liftEnv = (sim: Sim) => ({ grid: sim.grid, lifts: sim.lifts, economy: sim.economy, access: sim.networks.access });
const spot = (sim: Sim, type: string): { x: number; y: number } => {
  for (let y = 12; y < 52; y += 2) for (let x = 12; x < 52; x += 2) { const c = validatePlacement(sim.env, type, x, y, 0, false); if (c.ok && !c.warnings.length && !c.flatten) return { x, y }; }
  throw new Error('no spot');
};
/** A free, dry, empty tile in the middle of the map. */
const freeTile = (sim: Sim): { x: number; y: number } => {
  const g = sim.grid;
  for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) {
    let ok = true;
    for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3; dx++) { const i = g.tileIndex(x + dx, y + dy); if (g.occupancy.flags[i] || g.tileType[i] === TileType.Water || g.tileType[i] === TileType.Stream || sim.networks.kind[i] || sim.networks.layers[i]) { ok = false; break; } }
    if (ok) return { x, y };
  }
  throw new Error('no free tile');
};
const plantEnv = (sim: Sim) => ({ grid: sim.grid, props: sim.props, seed: 61, blocked: (i: number) => sim.grid.occupancy.flags[i] !== 0 || (sim.networks.layers[i] ?? 0) !== 0 || (sim.networks.kind[i] ?? 0) !== 0 });
const stroke = (sim: Sim, undo: Undo, x: number, y: number, delta: 1 | -1) => {
  const rect = tileBrushRect(sim.grid, x, y, 2);
  return {
    rect,
    run: () => { const r = raiseLowerRect(sim.grid, rect, delta, { props: sim.props, commit: true }); return { ok: r.ok, flow: r.ok ? 0 : 0 }; },
    undo,
  };
};

describe('redo: placements and bulldozes', () => {
  it('place → undo → redo restores the post-place hash; a new action empties redo', () => {
    const { sim, undo } = mk();
    const { x, y } = spot(sim, 'cafe');
    const before = stateHash(sim);
    expect(undo.placeBuilding('cafe', x, y, 0, false).ok).toBe(true);
    const placed = stateHash(sim);
    expect(undo.undo().ok).toBe(true);
    expect(stateHash(sim)).toEqual(before);
    expect(undo.nextRedo()?.label).toBeTruthy();
    const r = undo.redo();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(stateHash(sim)).toEqual(placed);
    expect(undo.undo().ok).toBe(true);
    expect(stateHash(sim)).toEqual(before);
    // a fresh action drops the redo list
    const s2 = spot(sim, 'cafe');
    undo.placeBuilding('cafe', s2.x, s2.y, 0, false);
    expect(undo.nextRedo()).toBeNull();
    expect(undo.redo()).toEqual({ ok: false, reason: 'Nothing to redo' });
  });
  it('place with auto-flatten: redo re-levels the ground', () => {
    const { sim, undo } = mk(7);
    let found: { x: number; y: number } | null = null;
    for (let y = 12; y < 52 && !found; y += 2) for (let x = 12; x < 52; x += 2) { const c = validatePlacement(sim.env, 'cafe', x, y, 0, true); if (c.ok && c.flatten && c.flattenPlan && c.flattenPlan.changes.length) { found = { x, y }; break; } }
    const { x, y } = found!;
    const before = stateHash(sim);
    expect(undo.placeBuilding('cafe', x, y, 0, true).ok).toBe(true);
    const placed = stateHash(sim), h1 = sim.grid.heights.slice();
    expect(undo.undo().ok).toBe(true);
    expect(stateHash(sim)).toEqual(before);
    expect(undo.redo().ok).toBe(true);
    expect(Array.from(sim.grid.heights)).toEqual(Array.from(h1));
    expect(stateHash(sim)).toEqual(placed);
  });
  it('redo is refused when the ground changed in between', () => {
    const { sim, undo } = mk(7);
    let found: { x: number; y: number } | null = null;
    for (let y = 12; y < 52 && !found; y += 2) for (let x = 12; x < 52; x += 2) { const c = validatePlacement(sim.env, 'cafe', x, y, 0, true); if (c.ok && c.flatten && c.flattenPlan && c.flattenPlan.changes.length) { found = { x, y }; break; } }
    const h0 = sim.grid.heights.slice();
    undo.placeBuilding('cafe', found!.x, found!.y, 0, true);
    const i = sim.grid.heights.findIndex((v, k) => v !== h0[k]);
    undo.undo();
    sim.grid.setCornerUnchecked(i % sim.grid.vsize, Math.floor(i / sim.grid.vsize), h0[i]! + 1);
    const r = undo.redo();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/terrain/i);
  });
  it('bulldoze → undo → redo bulldozes again (and refunds again)', () => {
    const { sim, undo } = mk();
    const b = sim.buildings.all().find((x) => x.type !== 'baseLodge')!;
    const m0 = sim.game.money;
    const res = undo.bulldozeBuilding(b.id);
    const after = stateHash(sim), m1 = sim.game.money;
    expect(m1).toBe(m0 + res.refund);
    expect(undo.undo().ok).toBe(true);
    expect(sim.game.money).toBe(m0);
    expect(undo.redo().ok).toBe(true);
    expect(sim.buildings.get(b.id)).toBeUndefined();
    expect(sim.game.money).toBe(m1);
    expect(stateHash(sim)).toEqual(after);
  });
  it('redo of a placement needs the money', () => {
    const { sim, undo } = mk();
    const { x, y } = spot(sim, 'cafe');
    undo.placeBuilding('cafe', x, y, 0, false);
    undo.undo();
    sim.game.money = 0;
    const r = undo.redo();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/funds/i);
    expect(undo.nextRedo()).not.toBeNull();
  });
  it('lift: demolish → undo → redo; place → undo → redo', () => {
    const { sim, undo } = mk();
    const l = sim.lifts.all()[0]!;
    const rec = structuredClone(l);
    undo.demolishLift(l.id);
    const gone = stateHash(sim);
    expect(undo.undo().ok).toBe(true);
    expect(undo.redo().ok).toBe(true);
    expect(stateHash(sim)).toEqual(gone);
    undo.undo();
    sim.lifts.remove(l.id);
    const base = stateHash(sim);
    const out = undo.placeLift(liftEnv(sim), sim.props, rec.kind, rec.bottom, rec.top, true);
    expect(out.ok, out.reasons.join()).toBe(true);
    const placed = stateHash(sim);
    expect(undo.undo().ok).toBe(true);
    expect(stateHash(sim)).toEqual(base);
    expect(undo.redo().ok).toBe(true);
    expect(stateHash(sim)).toEqual(placed);
  });
});

describe('undo/redo: network strokes', () => {
  it('a piste stroke is one undo step with a refund; redo repaints it and charges again', () => {
    const { sim, undo } = mk();
    const net = sim.networks, { x, y } = freeTile(sim);
    const tiles = [0, 1, 2, 3, 4].map((k) => ({ x: x + k, y }));
    const cost = 5 * 12;
    sim.economy.charge(cost);
    const m1 = sim.game.money;
    net.beginJournal();
    net.paint(Layer.Ski, tiles);
    undo.recordNetwork('Piste', 'painted', net.endJournal(), cost);
    expect(tiles.every((t) => net.pisteAt(t.x, t.y))).toBe(true);
    expect(undo.next()?.verb).toBe('painted');
    expect(undo.undo().ok).toBe(true);
    expect(tiles.some((t) => net.pisteAt(t.x, t.y))).toBe(false);
    expect(sim.game.money).toBe(m1 + cost);
    const r = undo.redo();
    expect(r.ok).toBe(true);
    expect(tiles.every((t) => net.pisteAt(t.x, t.y))).toBe(true);
    expect(sim.game.money).toBe(m1);
  });
  it('a tile bulldoze undoes and redoes through the same stack', () => {
    const { sim, undo } = mk();
    const net = sim.networks, { x, y } = freeTile(sim);
    net.paint(Layer.Ski, [{ x, y }, { x: x + 1, y }]);
    net.beginJournal();
    net.clearLayers(x, y);
    undo.recordNetworkBulldoze('Piste', net.endJournal(), 6);
    expect(net.pisteAt(x, y)).toBe(false);
    expect(undo.undo().ok).toBe(true);
    expect(net.pisteAt(x, y)).toBe(true);
    expect(undo.redo().ok).toBe(true);
    expect(net.pisteAt(x, y)).toBe(false);
  });
});

describe('undo/redo: terraform + planting strokes', () => {
  it('a multi-stamp terraform drag is ONE undo step; undo restores the heights/props; redo reapplies', () => {
    const { sim, undo } = mk();
    const { x, y } = freeTile(sim);
    const g = sim.grid;
    const h0 = g.heights.slice();
    const st = undo.terrainStroke('Terrain', 'terraformed');
    for (let k = 0; k < 3; k++) {
      const s = stroke(sim, undo, x + k, y, 1);
      const pv = raiseLowerRect(g, s.rect, 1, { props: sim.props, commit: false });
      const xs = pv.changed.map((c) => c.vx), ys = pv.changed.map((c) => c.vy);
      st.stamp({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }, { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, x1: Math.max(...xs), y1: Math.max(...ys) }, s.run);
    }
    expect(undo.size).toBe(1);
    const h1 = g.heights.slice();
    expect(h1.some((v, i) => v !== h0[i])).toBe(true);
    const r = undo.undo();
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.applied.kind).toBe('terrain'); expect(r.applied.touchedChunks.length).toBeGreaterThan(0); }
    expect(Array.from(g.heights)).toEqual(Array.from(h0));
    expect(undo.redo().ok).toBe(true);
    expect(Array.from(g.heights)).toEqual(Array.from(h1));
    expect(undo.undo().ok).toBe(true);
    expect(Array.from(g.heights)).toEqual(Array.from(h0));
  });
  it('terraform undo is refused once a building stands on the changed ground', () => {
    const { sim, undo } = mk();
    const { x, y } = freeTile(sim);
    const g = sim.grid, st = undo.terrainStroke('Terrain', 'terraformed');
    const s = stroke(sim, undo, x, y, 1);
    const pv = raiseLowerRect(g, s.rect, 1, { props: sim.props, commit: false });
    const xs = pv.changed.map((c) => c.vx), ys = pv.changed.map((c) => c.vy);
    st.stamp({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }, { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, x1: Math.max(...xs), y1: Math.max(...ys) }, s.run);
    sim.buildings.add('cafe', Math.min(...xs), Math.min(...ys), 0);
    const r = undo.undo();
    expect(r.ok).toBe(false);
  });
  it('planting: undo removes the trees and refunds, redo plants the same ones again', () => {
    const { sim, undo } = mk();
    const { x, y } = freeTile(sim);
    const chunksBefore = JSON.stringify(sim.props.chunks);
    const plan = planPlanting(plantEnv(sim), x, y, 3, 'conifer', 1, 100);
    expect(plan.trees.length).toBeGreaterThan(0);
    const cost = Math.round(plan.cost);
    const st = undo.terrainStroke('Trees', 'planted');
    const m0 = sim.game.money;
    expect(st.stamp(null, { x0: x - 3, y0: y - 3, x1: x + 3, y1: y + 3 }, () => { sim.economy.charge(cost); applyPlanting(sim.props, plan, 100); return { ok: true, flow: cost }; })).toBe(true);
    const planted = JSON.stringify(sim.props.chunks);
    expect(planted).not.toBe(chunksBefore);
    expect(undo.undo().ok).toBe(true);
    expect(JSON.stringify(sim.props.chunks)).toBe(chunksBefore);
    expect(sim.game.money).toBe(m0);
    expect(undo.redo().ok).toBe(true);
    expect(JSON.stringify(sim.props.chunks)).toBe(planted);
    expect(sim.game.money).toBe(m0 - cost);
  });
  it('clearing trees: undo brings them back', () => {
    const { sim, undo } = mk();
    const { x, y } = freeTile(sim);
    const plan = planPlanting(plantEnv(sim), x, y, 3, 'conifer', 1, 0);
    applyPlanting(sim.props, plan, 0);
    const before = JSON.stringify(sim.props.chunks);
    const c = planClearing(sim.props, x, y, 3, 0);
    expect(c.count).toBeGreaterThan(0);
    const st = undo.terrainStroke('Trees', 'planted');
    st.stamp(null, { x0: x - 3, y0: y - 3, x1: x + 3, y1: y + 3 }, () => { applyClearing(sim.props, x, y, 3); return { ok: true, flow: 0 }; });
    expect(JSON.stringify(sim.props.chunks)).not.toBe(before);
    expect(undo.undo().ok).toBe(true);
    expect(JSON.stringify(sim.props.chunks)).toBe(before);
  });
});

describe('undo/redo: day boundary', () => {
  it('undo and redo are refused across a day boundary with a clear message', () => {
    const { sim, undo } = mk();
    const { x, y } = spot(sim, 'cafe');
    undo.placeBuilding('cafe', x, y, 0, false);
    undo.undo();
    sim.game.date.day += 1;
    const r = undo.redo();
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe(DAY_REFUSAL); expect(redoMessage(r)).toMatch(/earlier day.*same day/i); }
    const s2 = spot(sim, 'cafe');
    undo.placeBuilding('cafe', s2.x, s2.y, 0, false);
    sim.game.date.day += 1;
    const u = undo.undo();
    expect(u.ok).toBe(false);
    if (!u.ok) expect(undoMessage(u)).toMatch(/Can't undo .*earlier day/i);
  });
});

describe('UndoStack redo mechanics', () => {
  const cmd = (log: string[], id: string): UndoCommand => ({
    label: id, verb: 'placed', day: 1, cost: 0, do: () => true, check: () => null,
    undo: () => { log.push(`u${id}`); return { touchedChunks: [], changed: [], kind: 'building' }; },
    checkRedo: () => null, redo: () => { log.push(`r${id}`); return { touchedChunks: [], changed: [], kind: 'building' }; },
  });
  it('redo replays in reverse order of the undos', () => {
    const s = new UndoStack(), log: string[] = [], ctx = { day: 1, canAfford: () => true };
    s.execute(cmd(log, 'a')); s.execute(cmd(log, 'b'));
    s.undo(ctx); s.undo(ctx);
    expect(s.redoSize).toBe(2);
    s.redo(ctx); s.redo(ctx);
    expect(log).toEqual(['ub', 'ua', 'ra', 'rb']);
    expect(s.redo(ctx)).toEqual({ ok: false, reason: 'Nothing to redo' });
  });
  it('a failing redo keeps the command available', () => {
    const s = new UndoStack(), ctx = { day: 1, canAfford: () => true };
    const c = cmd([], 'a'); c.redo = () => ({ fail: 'nope' });
    s.execute(c); s.undo(ctx);
    expect(s.redo(ctx)).toMatchObject({ ok: false, reason: 'nope' });
    expect(s.redoSize).toBe(1);
  });
});
