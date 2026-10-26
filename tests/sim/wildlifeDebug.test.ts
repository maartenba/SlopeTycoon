import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { bearsInOrder, findBear, spawnBear } from '../../src/sim/ops/wildlifeDebug';
import { SPECIES_IDS } from '../../src/sim/nature/Fauna';

const mk = (season: 'winter' | 'summer', seed = 7) => { const sim = createSim({ size: 128, seed, startSeason: season, now: () => 0 }); sim.safety.wildlife.refresh(); return sim; };

describe('Find bear', () => {
  it('summer: cycles through all bears in a fixed (id) order and wraps', () => {
    const w = mk('summer').safety.wildlife;
    const bears = bearsInOrder(w);
    expect(bears.length).toBeGreaterThan(0);
    let cur = -1;
    const seen: number[] = [];
    for (let i = 0; i < bears.length * 2; i++) { const r = findBear(w, cur)!; cur = r.cursor; seen.push(r.focus.id); expect(r.focus.kind).toBe(w.animals.find((a) => a.id === r.focus.id)!.asleep ? 'den' : 'bear'); }
    expect(seen).toEqual([...bears.map((b) => b.id), ...bears.map((b) => b.id)]);
  });
  it('winter: shows dens with the hibernation message', () => {
    const w = mk('winter').safety.wildlife;
    expect(w.hibernating).toBe(true);
    const r = findBear(w, -1)!;
    expect(r.focus.kind).toBe('den');
    expect(r.focus.message).toMatch(/hibernating \(in dens\)/);
    const b = bearsInOrder(w)[0]!;
    expect([r.focus.x, r.focus.y]).toEqual([b.denX, b.denY]);
  });
  it('a fresh game (no day change yet) computes its bears lazily', () => {
    const sim = createSim({ size: 128, seed: 7, startSeason: 'summer', now: () => 0 });
    expect(sim.safety.wildlife.animals.length).toBe(0);
    expect(findBear(sim.safety.wildlife, -1)).not.toBeNull();
  });
  it('null when the map has no bears', () => {
    const w = mk('summer').safety.wildlife;
    w.animals = [];
    (w as unknown as { remoteList: Int32Array; d: { forest: Uint8Array } }).d.forest.fill(0);
    expect(findBear(w, -1)).toBeNull();
  });
});

describe('Spawn bear', () => {
  it('never spawns in hibernation season', () => {
    const w = mk('winter').safety.wildlife, n = w.animals.length;
    const r = spawnBear(w, 7, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('hibernating');
    expect(w.animals.length).toBe(n);
    expect(spawnBear(w, 7, 1, { x: 10, y: 10 }).ok).toBe(false);
  });
  it('summer: refuses while a bear already roams, spawns when none is present', () => {
    const w = mk('summer').safety.wildlife;
    const r0 = spawnBear(w, 7, 0);
    expect(r0.ok).toBe(false);
    if (!r0.ok) expect(r0.reason).toBe('exists');
    w.animals = w.animals.filter((a) => a.kind !== 'bear');
    const r = spawnBear(w, 7, 0);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(w.free(r.bear.x, r.bear.y) || w.remote[(r.bear.y | 0) * 128 + (r.bear.x | 0)] === 1).toBe(true); expect(r.bear.debug).toBe(true); }
    expect(bearsInOrder(w)).toHaveLength(1);
  });
  it('near camera: picks the remote forest tile nearest to the point (and works with bears present)', () => {
    const w = mk('summer').safety.wildlife;
    const r = spawnBear(w, 7, 0, { x: 64, y: 64 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = Math.hypot(r.bear.x - 64, r.bear.y - 64);
      for (let i = 0; i < w.remote.length; i += 7) if (w.remote[i]) expect(Math.hypot((i % 128) + 0.5 - 64, ((i / 128) | 0) + 0.5 - 64)).toBeGreaterThanOrEqual(d - 8); // sampled: never much closer than the choice
    }
  });
  it('no valid territory -> clear fallback message, nothing spawned', () => {
    const w = mk('summer').safety.wildlife;
    w.refresh();
    w.animals = w.animals.filter((a) => a.kind !== 'bear');
    (w as unknown as { d: { forest: Uint8Array } }).d.forest.fill(0); // no dense forest anywhere
    w.refresh();
    w.animals = w.animals.filter((a) => a.kind !== 'bear');
    const r = spawnBear(w, 7, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('noTerritory'); expect(r.message).toMatch(/No valid remote forest/); }
    expect(bearsInOrder(w)).toHaveLength(0);
  });
  it('is deterministic per (seed, counter) and leaves the sim RNG stream untouched', () => {
    const run = (): { x: number; y: number; rng: number } => {
      const sim = mk('summer'); const w = sim.safety.wildlife;
      w.animals = w.animals.filter((a) => a.kind !== 'bear');
      const rng0 = sim.game.rng.getState();
      const r = spawnBear(w, 7, 3);
      if (!r.ok) throw new Error('spawn failed');
      expect(sim.game.rng.getState()).toBe(rng0);
      return { x: r.bear.x, y: r.bear.y, rng: rng0 };
    };
    expect(run()).toEqual(run());
  });
  it('debug bears survive a refresh() cull; refresh() of a normal sim does not spawn debug bears', () => {
    const w = mk('summer').safety.wildlife;
    spawnBear(w, 7, 0, { x: 30, y: 30 });
    const dbg = w.animals.filter((a) => a.debug).length;
    w.refresh();
    expect(w.animals.filter((a) => a.debug).length).toBe(dbg);
    expect(mk('summer').safety.wildlife.animals.some((a) => a.debug)).toBe(false);
  });
});

describe('Fauna.findNearest', () => {
  it('orders by distance then id, filters by species', () => {
    const f = mk('summer').nature.fauna;
    const all = f.findNearest(null, 64, 64);
    expect(all.length).toBeGreaterThan(0);
    for (let i = 1; i < all.length; i++) {
      const a = Math.hypot(all[i - 1]!.x - 64, all[i - 1]!.y - 64), b = Math.hypot(all[i]!.x - 64, all[i]!.y - 64);
      expect(b).toBeGreaterThanOrEqual(a - 1e-9);
    }
    for (const sp of SPECIES_IDS) for (const c of f.findNearest(sp, 0, 0)) expect(c.species).toBe(sp);
    expect(f.findNearest(null, 10, 10).map((c) => c.id)).toEqual(f.findNearest(null, 10, 10).map((c) => c.id));
  });
});
