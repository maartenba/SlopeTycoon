import { describe, expect, it } from 'vitest';
import { makeResort } from '../game/harness';
import { stateHash } from '../../src/game/saveState';
import { suggestPiste } from '../../src/tutorial/suggest';
import { liftProfile, slopeProfile, difficultyFromPct } from '../../src/sim/PisteStats';
import { SKIABLE_MAX, SKIABLE_MIN } from '../../src/world/Skiable';
import { TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { HEIGHT_UNIT } from '../../src/config/balance';

const hOf = (g: { getCorners(x: number, y: number): number[] }, x: number, y: number): number => { const c = g.getCorners(x, y); return ((c[0]! + c[1]! + c[2]! + c[3]!) / 4) * HEIGHT_UNIT; };
const maxH = (sim: ReturnType<typeof makeResort>['sim']): number => { let m = 0; for (let y = 0; y < sim.size; y++) for (let x = 0; x < sim.size; x++) m = Math.max(m, hOf(sim.grid, x, y)); return m; };

describe('snowline-aware piste suggestion', () => {
  it('winter (snowline in the valley): a connected, skiable, downhill run that is fully snowy', () => {
    const { sim } = makeResort(64, 61);
    const s = suggestPiste(sim.grid, sim.networks, 0);
    expect(s).not.toBeNull();
    const line = s!.line;
    expect(line.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < line.length; i++) expect(Math.abs(line[i]!.x - line[i - 1]!.x) + Math.abs(line[i]!.y - line[i - 1]!.y)).toBe(1);
    for (const t of line) {
      const i = sim.grid.tileIndex(t.x, t.y);
      expect([TileType.Water, TileType.Stream, TileType.Rock]).not.toContain(sim.grid.tileType[i]);
      expect(sim.grid.occupancy.flags[i]! & (OccFlag.Building | OccFlag.Lift | OccFlag.Water)).toBe(0);
    }
    expect(hOf(sim.grid, line[0]!.x, line[0]!.y)).toBeGreaterThan(hOf(sim.grid, line[line.length - 1]!.x, line[line.length - 1]!.y));
    expect(s!.snowReliable).toBe(true);
    expect(s!.snowFraction).toBe(1);
    expect(s!.startAltM).toBeGreaterThan(s!.endAltM);
    expect(s!.lengthM).toBeGreaterThan(50);
  });
  it('the whole first part of the walk uses the skiable steepness band (world/Skiable)', () => {
    const { sim } = makeResort(64, 7);
    const s = suggestPiste(sim.grid, sim.networks, 0)!;
    // the walk itself (before 4-connection filling) is skiable; the filled line may add corner tiles, so check the majority
    const ok = s.line.filter((t) => { const st = sim.grid.steepness(t.x, t.y); return st >= SKIABLE_MIN && st <= SKIABLE_MAX; }).length;
    expect(ok / s.line.length).toBeGreaterThan(0.7);
  });
  it('snowline above the summit (summer): flagged as not snow-reliable with an honest message', () => {
    const { sim } = makeResort(64, 61);
    const s = suggestPiste(sim.grid, sim.networks, maxH(sim) + 5)!;
    expect(s).not.toBeNull();
    expect(s.snowReliable).toBe(false);
    expect(s.snowFraction).toBe(0);
    expect(s.message).toMatch(/no snow/i);
  });
  it('a mid-slope snowline starts the run above it', () => {
    const { sim } = makeResort(64, 61);
    const top = maxH(sim), line = top * 0.7;
    const s = suggestPiste(sim.grid, sim.networks, line)!;
    expect(s).not.toBeNull();
    expect(hOf(sim.grid, s.line[0]!.x, s.line[0]!.y)).toBeGreaterThanOrEqual(line);
    expect(s.snowReliable).toBe(true);
    expect(s.snowFraction).toBeGreaterThan(0);
    expect(s.snowFraction).toBeLessThanOrEqual(1);
  });
  it('the wanted grade steers the steepness (green <= black on average, strictly on some seed)', () => {
    let strict = 0;
    for (const seed of [61, 7, 33]) {
      const { sim } = makeResort(64, seed);
      const mean = (want: number): number => { const s = suggestPiste(sim.grid, sim.networks, 0, { want })!; return s.line.reduce((a, t) => a + sim.grid.steepness(t.x, t.y), 0) / s.line.length; };
      const g = mean(0), b = mean(3);
      expect(g).toBeLessThanOrEqual(b + 0.05);
      if (g < b) strict++;
    }
    expect(strict).toBeGreaterThan(0);
  });
  it('is read-only (state hash unchanged) and deterministic', () => {
    const { sim } = makeResort(64, 61);
    const before = stateHash(sim);
    const a = suggestPiste(sim.grid, sim.networks, 0), b = suggestPiste(sim.grid, sim.networks, 0);
    expect(a).toEqual(b);
    expect(stateHash(sim)).toEqual(before);
  });
});

describe('slope profile samples', () => {
  it('piste profile: distance grows per tile, altitude falls, difficulty colours follow the gradient', () => {
    const { sim } = makeResort(64, 61);
    const s = suggestPiste(sim.grid, sim.networks, 0)!;
    const p = slopeProfile(sim.grid, s.line, null);
    expect(p.samples.length).toBe(s.line.length);
    for (let i = 1; i < p.samples.length; i++) expect(p.samples[i]!.distM).toBeGreaterThan(p.samples[i - 1]!.distM);
    expect(p.dropM).toBeGreaterThan(0);
    expect(p.startAltM).toBeGreaterThan(p.endAltM);
    expect(p.lengthM).toBe(p.samples[p.samples.length - 1]!.distM);
    for (const q of p.samples) expect([0, 1, 2, 3]).toContain(q.difficulty);
    expect(slopeProfile(sim.grid, s.line, 2).samples.every((q) => q.difficulty === 2)).toBe(true);
    expect(slopeProfile(sim.grid, s.line, new Array(s.line.length).fill(3)).samples.every((q) => q.difficulty === 3)).toBe(true);
  });
  it('lift profile: climbs from the bottom to the top station, steep ground reads red / black', () => {
    const { sim } = makeResort(64, 61);
    const l = sim.lifts.all()[0]!;
    const p = liftProfile(sim.grid, { x: l.bottom.x + 1, y: l.bottom.y + 1 }, { x: l.top.x + 1, y: l.top.y + 1 });
    expect(p.samples.length).toBeGreaterThan(3);
    expect(p.dropM).toBeGreaterThan(0); // climb
    expect(p.endAltM).toBeGreaterThan(p.startAltM);
    expect(p.maxPct).toBeGreaterThanOrEqual(Math.abs(p.avgPct));
  });
  it('gradient percent -> difficulty uses the painted-piste thresholds (50 % per half-step)', () => {
    expect(difficultyFromPct(10)).toBe(0);
    expect(difficultyFromPct(45)).toBe(1);
    expect(difficultyFromPct(75)).toBe(2);
    expect(difficultyFromPct(95)).toBe(3);
    expect(difficultyFromPct(-95)).toBe(3);
  });
});
