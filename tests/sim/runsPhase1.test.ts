import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { Layer } from '../../src/world/Networks';

const line = (x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> => {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)), out = [];
  for (let i = 0; i <= n; i++) out.push({ x: Math.round(x0 + ((x1 - x0) * i) / n), y: Math.round(y0 + ((y1 - y0) * i) / n) });
  return out;
};

describe('pistes are runs (owner screenshot: joined strokes)', () => {
  it('three joined strokes are several runs, each with its own difficulty and name', () => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0 });
    // a trunk (green) that forks into a blue arm and a black arm
    sim.networks.paint(Layer.Ski, line(20, 10, 20, 24), 0);
    sim.networks.paint(Layer.Ski, line(20, 24, 12, 40), 1);
    sim.networks.paint(Layer.Ski, line(20, 24, 30, 40), 3);
    const runs = sim.runIndex.runs();
    expect(sim.networks.pisteComponents().length).toBe(1);
    expect(runs.length).toBeGreaterThanOrEqual(3);
    const diffs = new Set(runs.map((r) => r.difficulty));
    expect(diffs.has(1) && diffs.has(2) && diffs.has(4)).toBe(true);
    const names = runs.map((r) => sim.pisteReportAt(r.tiles[0]! % 64, (r.tiles[0]! / 64) | 0)!.name);
    expect(new Set(names).size).toBe(runs.length);
    for (const r of runs) { expect(r.dropM).toBeGreaterThanOrEqual(0); expect(r.lengthM).toBeGreaterThan(0); }
  });
  it('names persist when a run grows; a custom name sticks', () => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0 });
    sim.networks.paint(Layer.Ski, line(20, 10, 20, 24), 0);
    sim.networks.paint(Layer.Ski, line(20, 24, 12, 40), 1);
    sim.networks.paint(Layer.Ski, line(20, 24, 30, 40), 3);
    const at = (x: number, y: number) => sim.pisteReportAt(x, y)!;
    const before = at(20, 14);
    sim.renamePisteAt(20, 14, 'Kandahar');
    sim.networks.paint(Layer.Ski, line(20, 6, 20, 10), 0);
    expect(at(20, 14).name).toBe('Kandahar');
    expect(at(20, 14).id).toBe(before.id);
    expect(at(30, 40).difficultyLabel).toBe('Black');
  });
});
