import { describe, expect, it } from 'vitest';
import { makeResort } from '../game/harness';
import type { Sim } from '../../src/game/createSim';
import { Undo, undoMessage } from '../../src/build/UndoActions';
import { UndoStack, UNDO_LIMIT, type UndoCommand } from '../../src/build/UndoStack';
import { stateHash, collectSave } from '../../src/game/saveState';
import { validatePlacement } from '../../src/sim/PlaceBuilding';
import { GState } from '../../src/sim/guests/Guest';

const liftEnv = (sim: Sim) => ({ grid: sim.grid, lifts: sim.lifts, economy: sim.economy, access: sim.networks.access });
const mk = (seed = 61) => {
  const { sim } = makeResort(64, seed);
  sim.tick(3); // let attraction runtimes exist
  return { sim, undo: new Undo(sim) };
};

/** First spot near the map centre where `type` can be placed (optionally requiring auto-flatten to change heights). */
function findSpot(sim: Sim, type: string, needFlatten: boolean, skip = 0, wide = false): { x: number; y: number } {
  let n = 0;
  for (let y = wide ? 3 : 12; y < (wide ? 60 : 52); y += wide ? 1 : 2) for (let x = wide ? 3 : 12; x < (wide ? 60 : 52); x += wide ? 1 : 2) {
    const c = validatePlacement(sim.env, type, x, y, 0, needFlatten);
    if (!c.ok) continue;
    if (!needFlatten && c.warnings.length) continue;
    if (needFlatten && !(c.flatten && c.flattenPlan && c.flattenPlan.changes.length > 0)) continue;
    if (!needFlatten && c.flatten) continue;
    if (n++ >= skip) return { x, y };
  }
  throw new Error('no spot for ' + type);
}

describe('undo: placements', () => {
  it('place → undo restores the exact state hash (flat spot)', () => {
    const { sim, undo } = mk();
    const { x, y } = findSpot(sim, 'cafe', false);
    const before = stateHash(sim);
    const m0 = sim.game.money, led0 = JSON.stringify([sim.economy.ledger, sim.economy.expenses]);
    const out = undo.placeBuilding('cafe', x, y, 0, false);
    expect(out.ok).toBe(true);
    expect(stateHash(sim).hash).not.toBe(before.hash);
    const r = undo.undo();
    expect(r.ok).toBe(true);
    expect(stateHash(sim)).toEqual(before);
    expect(sim.game.money).toBe(m0);
    expect(JSON.stringify([sim.economy.ledger, sim.economy.expenses])).toBe(led0);
  });
  it('place with auto-flatten → undo also reverts the levelling (heights + trees) and the ledger', () => {
    const { sim, undo } = mk(7);
    const { x, y } = findSpot(sim, 'cafe', true);
    const before = stateHash(sim);
    const h0 = sim.grid.heights.slice();
    const out = undo.placeBuilding('cafe', x, y, 0, true);
    expect(out.ok).toBe(true);
    expect(out.cost).toBeGreaterThan(0);
    expect(sim.grid.heights.some((v, i) => v !== h0[i])).toBe(true);
    const r = undo.undo();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.applied.touchedChunks.length).toBeGreaterThan(0);
    expect(Array.from(sim.grid.heights)).toEqual(Array.from(h0));
    expect(stateHash(sim)).toEqual(before);
  });
  it('rotated placement undoes cleanly and the id is handed out again', () => {
    const { sim, undo } = mk();
    const { x, y } = findSpot(sim, 'cafe', false);
    const before = stateHash(sim), next = sim.buildings.nextIdValue();
    const out = undo.placeBuilding('cafe', x, y, 1, false);
    expect(out.ok).toBe(true);
    expect(out.building!.rot).toBe(1);
    undo.undo();
    expect(sim.buildings.nextIdValue()).toBe(next);
    expect(stateHash(sim)).toEqual(before);
  });
  it('a failed placement records nothing', () => {
    const { sim, undo } = mk();
    const lodge = sim.buildings.all()[0]!;
    expect(undo.placeBuilding('cafe', lodge.x, lodge.y, 0, false).ok).toBe(false);
    expect(undo.size).toBe(0);
    expect(undo.undo()).toEqual({ ok: false, reason: 'Nothing to undo' });
  });
});

describe('undo: bulldoze', () => {
  const pickTarget = (sim: Sim) => sim.buildings.all().filter((b) => b.type !== 'baseLodge')[0] ?? sim.buildings.all()[0]!;
  it('bulldoze → undo restores ids, rotation, names, price/staff and the hash; refund is reversed exactly', () => {
    const { sim, undo } = mk();
    const b = pickTarget(sim);
    sim.names.rename('building', b.id, 'my place');
    const att = sim.attractions.get(b.id);
    if (att) { att.price = Math.min(att.maxPrice, att.price + 1); att.staff = Math.max(0, att.staff); }
    sim.tick(1);
    const before = stateHash(sim), led0 = JSON.stringify([sim.economy.ledger, sim.economy.expenses]), m0 = sim.game.money;
    const rec = { ...sim.buildings.get(b.id)! };
    const res = undo.bulldozeBuilding(b.id);
    expect(res.ok).toBe(true);
    expect(sim.buildings.get(b.id)).toBeUndefined();
    expect(sim.game.money).toBe(m0 + res.refund);
    const r = undo.undo();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const back = sim.buildings.get(b.id)!;
    expect(back).toMatchObject({ id: rec.id, type: rec.type, x: rec.x, y: rec.y, rot: rec.rot, w: rec.w, h: rec.h });
    expect(sim.names.buildingName(b.id)).toBe('my place');
    expect(sim.game.money).toBe(m0);
    expect(JSON.stringify([sim.economy.ledger, sim.economy.expenses])).toBe(led0);
    expect(stateHash(sim)).toEqual(before);
  });
  it('rotated building keeps its rotation', () => {
    const { sim, undo } = mk();
    const { x, y } = findSpot(sim, 'cafe', false);
    const out = sim.buildings.add('cafe', x, y, 3).building;
    sim.tick(1);
    const before = stateHash(sim);
    undo.bulldozeBuilding(out.id);
    expect(undo.undo().ok).toBe(true);
    expect(sim.buildings.get(out.id)!.rot).toBe(3);
    expect(stateHash(sim)).toEqual(before);
  });
  it('ski school instructors survive bulldoze → undo', () => {
    const { sim, undo } = mk();
    const hq = sim.buildings.all().find((b) => b.type === 'skiSchoolHQ');
    if (!hq) return; // starter resort without a school: covered by the generic case above
    const sc = sim.guestSim.families.school(hq.id);
    sc.setInstructors(sc.instructors + 1);
    const n = sc.instructors;
    undo.bulldozeBuilding(hq.id);
    expect(undo.undo().ok).toBe(true);
    expect(sim.guestSim.families.school(hq.id).instructors).toBe(n);
  });
});

describe('undo: refusals', () => {
  const setup = () => {
    const { sim, undo } = mk();
    const { x, y } = findSpot(sim, 'cafe', false);
    const out = undo.placeBuilding('cafe', x, y, 0, false);
    return { sim, undo, out, x, y };
  };
  const addGuest = (sim: Sim, target: number, state: number) => {
    const st = sim.guestSim.store;
    const slot = st.add({ x: 5, y: 5, z: 0, type: 0, skill: 1, budget: 100, group: 0, mode: 0, overnight: false, leaveDay: 99, tick: 0 });
    st.target[slot] = target; st.state[slot] = state;
    return slot;
  };
  it('guests inside → refused with a reason; allowed again once they are gone', () => {
    const { sim, undo, out } = setup();
    const slot = addGuest(sim, out.building!.id, GState.Using);
    const r = undo.undo();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/guests are inside/i);
    expect(sim.buildings.get(out.building!.id)).toBeDefined();
    expect(undo.size).toBe(1);
    sim.guestSim.store.state[slot] = GState.Walking;
    expect(undo.undo().ok).toBe(true);
  });
  it('guests on a lift → refused', () => {
    const { sim, undo } = mk();
    const l = sim.lifts.all()[0]!;
    const rec = structuredClone(l);
    sim.lifts.remove(l.id);
    const out = undo.placeLift(liftEnv(sim), sim.props, rec.kind, rec.bottom, rec.top, true);
    expect(out.ok, out.reasons.join()).toBe(true);
    const st = sim.guestSim.store;
    const slot = st.add({ x: 5, y: 5, z: 0, type: 0, skill: 1, budget: 100, group: 0, mode: 0, overnight: false, leaveDay: 99, tick: 0 });
    st.liftId[slot] = out.lift!.id; st.state[slot] = GState.Queueing;
    const r = undo.undo();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/queueing|riding/i);
  });
  it('next day → refused and the stack is dropped', () => {
    const { sim, undo } = setup();
    sim.game.date.day += 1;
    const r = undo.undo();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/same day/i);
    expect(undo.size).toBe(0);
  });
  it('bulldoze undo with insufficient funds → refused, nothing changes', () => {
    const { sim, undo } = mk();
    const b = sim.buildings.all().find((x) => x.type !== 'baseLodge')!;
    undo.bulldozeBuilding(b.id);
    sim.game.money = 0;
    const r = undo.undo();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/funds/i);
    expect(sim.buildings.get(b.id)).toBeUndefined();
    expect(undo.size).toBe(1);
  });
  it('tile occupied again → refused', () => {
    const { sim, undo } = mk();
    const b = sim.buildings.all().find((x) => x.type !== 'baseLodge')!;
    undo.bulldozeBuilding(b.id);
    sim.buildings.add('cafe', b.x, b.y, 0);
    const r = undo.undo();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/occupied|changed/i);
  });
  it('terrain changed (tile version) → refused for a flattened placement', () => {
    const { sim, undo } = mk(7);
    const { x, y } = findSpot(sim, 'cafe', true);
    const h0 = sim.grid.heights.slice();
    const out = undo.placeBuilding('cafe', x, y, 0, true);
    expect(out.ok).toBe(true);
    const i = sim.grid.heights.findIndex((v, k) => v !== h0[k]);
    sim.grid.setCornerUnchecked(i % sim.grid.vsize, Math.floor(i / sim.grid.vsize), sim.grid.heights[i]! + 1);
    const r = undo.undo();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/terrain/i);
    expect(sim.buildings.get(out.building!.id)).toBeDefined();
  });
});

describe('undo: lifts', () => {
  it('lift place → undo and demolish → undo restore the hash', () => {
    const { sim, undo } = mk();
    const l = sim.lifts.all()[0]!;
    const rec = structuredClone(l);
    // demolish → undo
    const before = stateHash(sim);
    expect(undo.demolishLift(l.id).ok).toBe(true);
    expect(sim.lifts.get(l.id)).toBeUndefined();
    expect(undo.undo().ok).toBe(true);
    expect(stateHash(sim)).toEqual(before);
    // place → undo (re-place the same lift after removing it raw)
    sim.lifts.remove(l.id);
    const base = stateHash(sim);
    const out = undo.placeLift(liftEnv(sim), sim.props, rec.kind, rec.bottom, rec.top, true);
    expect(out.ok, out.reasons.join()).toBe(true);
    expect(undo.undo().ok).toBe(true);
    expect(stateHash(sim)).toEqual(base);
  });
});

describe('undo: stack', () => {
  it('keeps only the last 10 commands (oldest dropped)', () => {
    const s = new UndoStack();
    let undone = 0;
    const cmd = (i: number): UndoCommand => ({ label: `c${i}`, verb: 'placed', day: 1, cost: 0, do: () => true, check: () => null, undo: () => { undone++; return { touchedChunks: [], changed: [], kind: 'building' }; }, checkRedo: () => null, redo: () => ({ touchedChunks: [], changed: [], kind: 'building' }) });
    for (let i = 0; i < 12; i++) expect(s.execute(cmd(i))).toBe(true);
    expect(s.size).toBe(UNDO_LIMIT);
    const labels: string[] = [];
    for (;;) { const r = s.undo({ day: 1, canAfford: () => true }); if (!r.ok) break; labels.push(r.label); }
    expect(labels).toEqual(['c11', 'c10', 'c9', 'c8', 'c7', 'c6', 'c5', 'c4', 'c3', 'c2']);
    expect(undone).toBe(10);
  });
  it('real placements: 12 placed, 10 undoable', () => {
    const { sim, undo } = mk();
    sim.game.money = 1e7;
    let placed = 0;
    for (let k = 0; placed < 12 && k < 60; k++) {
      let spot: { x: number; y: number };
      try { spot = findSpot(sim, 'cafe', false, 0, true); } catch { break; }
      if (undo.placeBuilding('cafe', spot.x, spot.y, 0, false).ok) placed++;
    }
    expect(placed).toBe(12);
    expect(undo.size).toBe(10);
    let n = 0;
    while (undo.undo().ok) n++;
    expect(n).toBe(10);
  });
  it('is deterministic: the same actions give the same hashes', () => {
    const run = () => {
      const { sim, undo } = mk(11);
      const { x, y } = findSpot(sim, 'cafe', false);
      undo.placeBuilding('cafe', x, y, 2, false);
      const mid = stateHash(sim).hash;
      undo.undo();
      return [mid, stateHash(sim).hash];
    };
    expect(run()).toEqual(run());
  });
  it('is not persisted: no save module, and a loaded sim starts with an empty stack', () => {
    const { sim, undo } = mk();
    const { x, y } = findSpot(sim, 'cafe', false);
    const h = stateHash(sim).hash;
    undo.placeBuilding('cafe', x, y, 0, false);
    expect(Object.keys(collectSave(sim)).some((k) => /undo/i.test(k))).toBe(false);
    expect(new Undo(sim).size).toBe(0);
    undo.undo();
    expect(stateHash(sim).hash).toBe(h);
  });
  it('messages', () => {
    expect(undoMessage({ ok: false, reason: 'Nothing to undo' })).toBe('Nothing to undo');
    expect(undoMessage({ ok: false, reason: 'Guests are inside the Café', label: 'Café' })).toBe("Can't undo Café: Guests are inside the Café");
  });
});

describe('undo: network tiles', () => {
  it('tile bulldoze (journal) → undo restores the tile, the refund and the hash', () => {
    const { sim, undo } = mk();
    const n = sim.networks;
    let i = -1;
    for (let k = 0; k < n.kind.length; k++) if (n.kind[k] === 1 || n.kind[k] === 2) { i = k; break; }
    expect(i).toBeGreaterThanOrEqual(0);
    const x = i % sim.size, y = Math.floor(i / sim.size);
    const before = stateHash(sim);
    const netArrays = () => { const m = collectSave(sim)['networks']!.data as Record<string, unknown>; const { version: _v, ...rest } = m; void _v; return JSON.stringify(rest, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v)); };
    const net0 = netArrays();
    n.beginJournal();
    const k = n.unbuild(x, y);
    const refund = Math.round(n.costOf(k) * 0.5);
    sim.economy.refund(refund);
    undo.recordNetworkBulldoze('Road', n.endJournal(), refund);
    expect(n.kind[i]).toBe(0);
    const r = undo.undo();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const after = stateHash(sim);
    const diff = Object.keys(after.parts).filter((k) => after.parts[k] !== before.parts[k]);
    // the networks module only differs in its cache-invalidation `version` counter: compare its contents separately
    expect(diff.filter((k) => k !== 'networks')).toEqual([]);
    expect(netArrays()).toBe(net0);
  });
});
