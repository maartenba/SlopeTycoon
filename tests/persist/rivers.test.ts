import { describe, expect, it } from 'vitest';
import { makeResort } from '../game/harness';
import { createSim, type Sim } from '../../src/game/createSim';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { applySave, stateHash } from '../../src/game/saveState';
import { Undo } from '../../src/build/UndoActions';
import { TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { applyRiver, planRiver, type RiverPlan } from '../../src/world/RiverPlanner';
import { applySpring, planSpring } from '../../src/world/Rivers';

async function snapshot(sim: Sim) {
  const { bytes } = await encodeSave(sim, makeMeta(sim, 'test'), { compress: true, yieldBetween: false });
  return { envelope: (await decodeSave(bytes, { yieldBetween: false })).envelope };
}
const loadFrom = (snap: Awaited<ReturnType<typeof snapshot>>): Sim => createSim({ size: snap.envelope.mapSize, seed: snap.envelope.seed, now: () => 0, fromSave: structuredClone(snap.envelope.modules) });

/** First natural spring site with a river that can be dug (explicit lake sink preferred = longer, more interesting). */
function firstPlan(sim: Sim): { from: { x: number; y: number }; plan: RiverPlan } {
  const env = sim.riverEnv(), N = sim.size;
  for (const s of sim.rivers.natural) {
    for (const l of sim.terrainInfo.lakes) { const t = l.tileIdx[0]!, p = planRiver(env, s, { x: t % N, y: (t / N) | 0 }); if (p.ok && p.cost > 0) return { from: s, plan: p }; }
    const p = planRiver(env, s);
    if (p.ok) return { from: s, plan: p };
  }
  throw new Error('no river site');
}

describe('rivers save module', () => {
  it('a world without rivers has no `rivers` part in its stateHash and saves null', async () => {
    const { sim } = makeResort(64, 61);
    expect(stateHash(sim).parts.rivers).toBeUndefined();
    expect(sim.rivers.serialize()).toBeNull();
    const snap = await snapshot(sim);
    expect(snap.envelope.modules['rivers']?.data).toBeNull();
  });

  it('save -> load (byte format) and an in-place applySave give the same stateHash; carve, tiles and rivers survive; old saves load with none', async () => {
    const { sim } = makeResort(64, 61);
    sim.tick(2);
    const env = sim.riverEnv(), { plan } = firstPlan(sim);
    const res = applyRiver(env, sim.rivers, plan);
    expect(res.ok).toBe(true);
    // a player spring too
    for (let y = 6; y < 58 && sim.rivers.springs.length === 0; y++) for (let x = 6; x < 58 && sim.rivers.springs.length === 0; x++) { const sp = planSpring(env, sim.rivers, x, y); if (sp.ok) applySpring(env, sim.rivers, sp); }
    expect(sim.rivers.springs.length).toBe(1);
    sim.tick(20);
    const h = stateHash(sim);
    expect(h.parts.rivers).toBeDefined();

    const snap = await snapshot(sim);
    const loaded = loadFrom(snap);
    expect(JSON.stringify(loaded.rivers.serialize())).toBe(JSON.stringify(sim.rivers.serialize()));
    expect(stateHash(loaded).parts.rivers).toBe(h.parts.rivers);
    for (const p of plan.path) { const i = p.y * sim.size + p.x; expect(loaded.grid.tileType[i]).toBe(TileType.Stream); expect(loaded.grid.occupancy.flags[i]! & OccFlag.Water).toBeTruthy(); }
    for (const p of plan.path) expect(loaded.buildings.streamAt?.(p.x, p.y)).toBe(true); // river tiles block building and count as stream for hydro, like natural ones
    expect([...loaded.grid.heights]).toEqual([...sim.grid.heights]);
    expect(loaded.rivers.natural).toEqual(sim.rivers.natural); // re-derived, not saved
    expect(loaded.rivers.springs).toEqual(sim.rivers.springs);
    applySave(sim, structuredClone(snap.envelope.modules)); // control: the same save applied in place
    expect(stateHash(loaded).parts).toEqual(stateHash(sim).parts);
    loaded.tick(120); // keeps simulating

    const mods = structuredClone(snap.envelope.modules); delete mods['rivers'];
    const old = makeResort(64, 61).sim;
    const rep = applySave(old, mods);
    expect(rep.missing).toContain('rivers');
    expect(old.rivers.rivers).toHaveLength(0);
  });

  it('undo / redo: one step restores the ground, tiles, flags, money and the river list; redo digs it again identically', () => {
    const { sim } = makeResort(64, 61);
    sim.tick(2);
    const undo = new Undo(sim), env = sim.riverEnv(), { plan } = firstPlan(sim);
    const money = sim.game.money, h0 = stateHash(sim), heights0 = [...sim.grid.heights];
    const st = undo.riverStroke('River');
    expect(st.stamp(plan.rect, () => { if (!sim.economy.charge(plan.cost)) return { ok: false, flow: 0 }; return { ok: applyRiver(env, sim.rivers, plan).ok, flow: plan.cost }; })).toBe(true);
    const h1 = stateHash(sim);
    expect(sim.game.money).toBe(money - plan.cost);
    expect(h1.hash).not.toBe(h0.hash);
    const u = undo.undo();
    expect(u.ok, JSON.stringify(u)).toBe(true);
    expect(stateHash(sim).hash).toBe(h0.hash);
    expect([...sim.grid.heights]).toEqual(heights0);
    expect(sim.game.money).toBe(money);
    expect(sim.rivers.rivers).toHaveLength(0);
    expect(undo.redo().ok).toBe(true);
    expect(stateHash(sim).hash).toBe(h1.hash);
    expect(sim.rivers.rivers).toHaveLength(1);
  });
});
