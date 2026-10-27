import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { Layer } from '../../src/world/Networks';
import { raiseLowerRect } from '../../src/world/Terraform';
import { buildRuns } from '../../src/world/Runs';

const line = (x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> => {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)), out = [];
  for (let i = 0; i <= n; i++) out.push({ x: Math.round(x0 + ((x1 - x0) * i) / n), y: Math.round(y0 + ((y1 - y0) * i) / n) });
  return out;
};
const rep = (s: Sim, x: number, y: number) => s.pisteReportAt(x, y)!;

describe('run split identity', () => {
  const make = (): Sim => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0 });
    sim.networks.paint(Layer.Ski, line(20, 8, 20, 40), 1);
    sim.openStatus.evaluate();
    return sim;
  };
  it('the cut-off part inherits the closed flag and gets a derived name "X (2)"', () => {
    const sim = make();
    const whole = rep(sim, 20, 10);
    sim.renameRun(whole.id, 'Hauptpiste');
    sim.setRunClosed(whole.id, true);
    sim.setRunGroomMode(whole.id, 'skip');
    for (let y = 22; y <= 24; y++) sim.networks.unpaint(Layer.Ski, 20, y); // cut it in two
    sim.openStatus.evaluate();
    const a = rep(sim, 20, 12), b = rep(sim, 20, 38);
    expect(a.id).not.toBe(b.id);
    const names = [a.name, b.name].sort();
    expect(names).toEqual(['Hauptpiste', 'Hauptpiste (2)']);
    for (const r of [a, b]) { expect(r.closedByPlayer).toBe(true); expect(r.open).toBe(false); expect(r.groomMode).toBe('skip'); }
    // a second split does not stack suffixes
    const bigger = a.name === 'Hauptpiste' ? a : b;
    const y = bigger === a ? 14 : 34;
    sim.networks.unpaint(Layer.Ski, 20, y);
    sim.openStatus.evaluate();
    const all = new Set([rep(sim, 20, 10).name, rep(sim, 20, 38).name]);
    for (const nm of all) expect(nm).not.toMatch(/\(\d+\) \(\d+\)/);
  });
  it('a split of an OPEN run stays open, and a brand-new piste is not a split', () => {
    const sim = make();
    for (let y = 22; y <= 24; y++) sim.networks.unpaint(Layer.Ski, 20, y);
    sim.openStatus.evaluate();
    expect(rep(sim, 20, 12).closedByPlayer || rep(sim, 20, 38).closedByPlayer).toBe(false);
    sim.networks.paint(Layer.Ski, line(40, 8, 40, 30), 1);
    sim.openStatus.evaluate();
    expect(rep(sim, 40, 20).name).toMatch(/^Blue Run \d+$/);
  });
});

describe('terraforming under a piste refreshes run figures', () => {
  it('slope / drop of the run change after raising its lower end (no network edit needed)', () => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0 });
    sim.networks.paint(Layer.Ski, line(20, 10, 20, 30), 1);
    sim.openStatus.evaluate();
    const before = sim.runIndex.runs()[0]!;
    const drop0 = before.dropM;
    const tv = sim.grid.terrainVersion;
    // lower the top end by several half-steps
    const r = raiseLowerRect(sim.grid, { vx0: 19, vy0: 26, vx1: 22, vy1: 29 }, 3, {});
    expect(r.ok).toBe(true);
    expect(sim.grid.terrainVersion).toBeGreaterThan(tv);
    const after = sim.runIndex.runs()[0]!;
    expect(after).not.toBe(before);
    expect(after.dropM).not.toBe(drop0);
  });
});

describe('RunNetwork rebuild time on realistic resorts', () => {
  /** Synthetic piste layer: a trunk plus branches, `w` tiles wide, on an NxN map. */
  const resort = (size: number, branches: number, w: number): { mask: Uint8Array; n: number } => {
    const mask = new Uint8Array(size * size), c = size >> 1;
    const stamp = (x: number, y: number): void => { for (let k = 0; k < w; k++) if (x + k < size && y < size) mask[y * size + x + k] = 1; };
    for (let y = c - 30; y <= c; y++) stamp(c, y);
    for (let i = 0; i < branches; i++) {
      const y0 = c - 26 + i * 3, dir = i % 2 ? 1 : -1;
      for (let t = 0; t <= 24; t++) stamp(c + dir * t - (dir < 0 ? 0 : 0), Math.min(size - 1, y0 + t));
    }
    return { mask, n: mask.reduce((a, b) => a + b, 0) };
  };
  it.each([[128, 7, 3], [256, 11, 3], [256, 11, 5]] as const)('map %i, %i branches, width %i: median rebuild is cheap [perf]', (size, branches, w) => {
    const { mask, n } = resort(size, branches, w);
    const alt = (i: number): number => ((i / size) | 0) * 0.5 - (i % size) * 0.01;
    const times: number[] = []; let runs = 0;
    for (let k = 0; k < 15; k++) { const t0 = performance.now(); runs = buildRuns({ size, mask, alt, difficulty: new Uint8Array(size * size), stations: [] }).runs.length; times.push(performance.now() - t0); }
    times.sort((a, b) => a - b);
    const med = times[times.length >> 1]!;
    console.log(`[run-rebuild] ${size} w${w}: ${n} piste tiles, ${runs} runs, median ${med.toFixed(2)} ms, max ${times[times.length - 1]!.toFixed(2)} ms`);
    expect(n).toBeGreaterThan(500);
    expect(med).toBeLessThan(w === 5 ? 15 : 5); // w5 = 1.4k tiles of heavily overlapping branches (stress, measured ~6 ms); typical resorts < 2 ms. Rebuilds are lazy (network edits only)
  });
});
