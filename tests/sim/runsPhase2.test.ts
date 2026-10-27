import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { Layer } from '../../src/world/Networks';
import { applySave, collectSave, stateHash } from '../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';

const line = (x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> => {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)), out = [];
  for (let i = 0; i <= n; i++) out.push({ x: Math.round(x0 + ((x1 - x0) * i) / n), y: Math.round(y0 + ((y1 - y0) * i) / n) });
  return out;
};
const fork = (): Sim => {
  const sim = createSim({ size: 64, seed: 61, now: () => 0 });
  sim.networks.paint(Layer.Ski, line(20, 10, 20, 24), 0);
  sim.networks.paint(Layer.Ski, line(20, 24, 12, 40), 1);
  sim.networks.paint(Layer.Ski, line(20, 24, 30, 40), 3);
  sim.openStatus.evaluate();
  return sim;
};
const rep = (s: Sim, x: number, y: number) => s.pisteReportAt(x, y)!;

describe('per-run independence', () => {
  it('closing one run leaves its neighbours open; reopening restores it', () => {
    const sim = fork();
    const blue = rep(sim, 13, 38), black = rep(sim, 29, 38);
    expect(blue.id).not.toBe(black.id);
    sim.setRunClosed(blue.id, true);
    expect(rep(sim, 13, 38).open).toBe(false);
    expect(rep(sim, 13, 38).reason).toBe('Closed by you');
    expect(rep(sim, 13, 38).closedByPlayer).toBe(true);
    expect(rep(sim, 29, 38).open).toBe(true);
    expect(rep(sim, 20, 14).open).toBe(true);
    sim.setRunClosed(blue.id, false);
    expect(rep(sim, 13, 38).open).toBe(true);
  });
  it('a closure on tiles (avalanche) closes only the runs it touches', () => {
    const sim = fork();
    const t = 38 * 64 + 29;
    sim.openStatus.closeTiles([t], 'avalanche', 0, 1000);
    expect(rep(sim, 29, 38).open).toBe(false);
    expect(rep(sim, 13, 38).open).toBe(true);
  });
  it('manual close survives a paint that grows the run (persistent id)', () => {
    const sim = fork();
    const id = rep(sim, 13, 38).id;
    sim.setRunClosed(id, true);
    sim.networks.paint(Layer.Ski, line(12, 40, 12, 44), 1);
    sim.openStatus.evaluate();
    expect(rep(sim, 13, 38).id).toBe(id);
    expect(rep(sim, 13, 38).open).toBe(false);
  });
  it('grooming orders are per run (skip excludes its tiles, first outranks)', () => {
    const sim = fork();
    const a = rep(sim, 13, 38), b = rep(sim, 29, 38);
    sim.setRunGroomMode(a.id, 'skip'); sim.setRunGroomMode(b.id, 'first');
    expect(sim.ops.grooming.tileOrder(38 * 64 + 13)).toBe(2);
    expect(sim.ops.grooming.tileOrder(38 * 64 + 29)).toBe(1);
    expect(sim.ops.grooming.tileOrder(14 * 64 + 20)).toBe(0);
    expect(rep(sim, 13, 38).groomMode).toBe('skip');
  });
  it('runList lists every run with its own numbers', () => {
    const sim = fork();
    const list = sim.runList();
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(new Set(list.map((r) => r.id)).size).toBe(list.length);
    expect(list.map((r) => r.difficultyLabel)).toEqual(expect.arrayContaining(['Green', 'Blue', 'Black']));
  });
  it('rename via id sticks', () => {
    const sim = fork();
    const id = rep(sim, 29, 38).id;
    sim.renameRun(id, 'Direttissima');
    expect(rep(sim, 29, 38).name).toBe('Direttissima');
  });
});

describe('run settings persist', () => {
  it('round-trips closed flags, grooming orders, names; hash equal; old save (no runs module) = all open / Auto', async () => {
    const sim = fork();
    const a = rep(sim, 13, 38), b = rep(sim, 29, 38);
    sim.setRunClosed(a.id, true); sim.setRunGroomMode(b.id, 'first'); sim.renameRun(b.id, 'Lawine');
    const { bytes } = await encodeSave(sim, makeMeta(sim, 'runs'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const restored = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    expect(rep(restored, 13, 38).closedByPlayer).toBe(true);
    expect(rep(restored, 13, 38).open).toBe(false);
    expect(rep(restored, 29, 38).groomMode).toBe('first');
    expect(rep(restored, 29, 38).name).toBe('Lawine');
    expect(stateHash(restored).parts.runs).toBe(stateHash(sim).parts.runs);
    // an old save: no `runs` module
    const old = structuredClone(env.modules); delete old.runs; delete old.runStats;
    const legacy = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: old });
    expect(rep(legacy, 13, 38).open).toBe(true);
    expect(rep(legacy, 13, 38).groomMode).toBe('auto');
    expect(rep(legacy, 13, 38).name).toBe(a.name); // names module still maps
    expect(collectSave(legacy).runs).toBeDefined();
    applySave(sim, structuredClone(old)); // in place too
    expect(rep(sim, 13, 38).closedByPlayer).toBe(false);
  });
  it('an old component-era name moves to the largest overlapping run', () => {
    const sim = fork();
    const names = sim.names.serialize();
    // pretend the save knew ONE piste covering the whole network, named 'Old Faithful'
    const all: number[] = []; for (let i = 0; i < 64 * 64; i++) if (sim.networks.layers[i]! & Layer.Ski) all.push(i);
    const legacy = { ...names, custom: [['piste:1', 'Old Faithful']] as Array<[string, string]>, pistes: [{ id: 1, name: 'Black Run 1', diff: 4, size: all.length, sample: all.filter((_, i) => i % 3 === 0) }], pisteNext: 2 };
    sim.names.load(legacy as never);
    const names3 = sim.runList().map((r) => r.name);
    expect(names3.filter((n) => n === 'Old Faithful')).toHaveLength(1);
    // the biggest run took it
    const big = sim.runList().sort((x, y) => y.tiles - x.tiles)[0]!;
    expect(big.name).toBe('Old Faithful');
  });
});
