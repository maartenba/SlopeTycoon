import { describe, expect, it } from 'vitest';
import { chordIdx, hashSeed, inScale, mulberry32, nearestChordTone, scaleNote, speedTempoMul, voiceLead, beatsToSeconds, MODES } from '../../src/audio/theory';

describe('theory', () => {
  it('scaleNote handles octaves and negatives', () => {
    expect(scaleNote(60, 'ionian', 0)).toBe(60);
    expect(scaleNote(60, 'ionian', 7)).toBe(72);
    expect(scaleNote(60, 'ionian', -1)).toBe(59);
    expect(scaleNote(60, 'aeolian', 2)).toBe(63);
  });
  it('chords are scale tones', () => {
    for (const m of Object.keys(MODES) as Array<keyof typeof MODES>) for (let d = 0; d < 7; d++) for (const i of chordIdx(d)) expect(inScale(scaleNote(57, m, i), 57, m)).toBe(true);
  });
  it('nearestChordTone returns chord tone', () => { expect(nearestChordTone(1, chordIdx(0))).toBe(0); expect(nearestChordTone(3, chordIdx(0))).toBe(2); });
  it('voiceLead stays compact and close', () => {
    const a = voiceLead(null, chordIdx(0), 4), b = voiceLead(a, chordIdx(3), 4);
    expect(a[2]! - a[0]!).toBeLessThanOrEqual(8);
    expect(Math.abs(b[0]! - a[0]!)).toBeLessThanOrEqual(5);
  });
  it('prng deterministic', () => { const a = mulberry32(5), b = mulberry32(5); expect([a(), a()]).toEqual([b(), b()]); expect(hashSeed(1, 2)).not.toBe(hashSeed(2, 1)); });
  it('time conversion + speed tempo', () => {
    expect(beatsToSeconds(4, 120)).toBe(2);
    expect(speedTempoMul(1)).toBe(1); expect(speedTempoMul(3)).toBeCloseTo(1.25);
  });
});
