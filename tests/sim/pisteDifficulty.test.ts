import { describe, expect, it } from 'vitest';
import { DIFFICULTY_LABELS, pisteDifficulty } from '../../src/sim/PisteStats';
import { Difficulty, difficultyFromSteepness } from '../../src/world/Networks';
import { FESTIVAL_BY_ID } from '../../src/config/festivals';

/** Regression (M5.4): Networks stores difficulty 0..3 (Black = 3); pisteDifficulty / DIFFICULTY_LABELS are 1..4. A Black piste used to read as Red. */
describe('piste difficulty code mapping', () => {
  it('stored 0..3 maps to 1..4 and the right labels', () => {
    const arr = (d: number): number[] => [d, d, d, d];
    const tiles = [0, 1, 2, 3];
    expect(pisteDifficulty(tiles, arr(Difficulty.Green))).toBe(1);
    expect(pisteDifficulty(tiles, arr(Difficulty.Blue))).toBe(2);
    expect(pisteDifficulty(tiles, arr(Difficulty.Red))).toBe(3);
    expect(pisteDifficulty(tiles, arr(Difficulty.Black))).toBe(4);
    expect(DIFFICULTY_LABELS[pisteDifficulty(tiles, arr(Difficulty.Black)) - 1]).toBe('Black');
    expect(DIFFICULTY_LABELS[pisteDifficulty(tiles, arr(Difficulty.Red)) - 1]).toBe('Red');
    expect(DIFFICULTY_LABELS[pisteDifficulty(tiles, arr(Difficulty.Green)) - 1]).toBe('Green');
  });
  it('majority wins; steepness gives the stored code the festival / world-cup code expects (Black = 3)', () => {
    expect(pisteDifficulty([0, 1, 2, 3], [3, 3, 1, 0])).toBe(4);
    expect(difficultyFromSteepness(2)).toBe(3);
    expect(FESTIVAL_BY_ID.worldCup.needs).toContain('blackPiste');
  });
});

import { createSim } from '../../src/game/createSim';
import { Layer } from '../../src/world/Networks';

describe('in a real sim', () => {
  it('a piste painted with the Black override reports Black (inspector label + colour), Red reads Red, and the world-cup check sees stored code 3', () => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0 });
    const line = (y: number, d: number): void => { const t = Array.from({ length: 8 }, (_, i) => ({ x: 20 + i, y })); sim.networks.paint(Layer.Ski, t, d); };
    line(10, 3); line(20, 2); line(30, 0);
    const label = (y: number): string | undefined => sim.pisteReportAt(22, y)?.difficultyLabel;
    expect(label(10)).toBe('Black'); expect(label(20)).toBe('Red'); expect(label(30)).toBe('Green');
    expect(sim.pisteReportAt(22, 10)?.difficultyColor).toBe('#222222');
    expect(sim.networks.difficulty[10 * 64 + 22]).toBe(3);
  });
});
