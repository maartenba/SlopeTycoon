import { describe, expect, it } from 'vitest';
import { confettiAllowed, DEFAULT_INTENSITY, feedbackPolicy, FX_STORAGE_KEY, loadIntensity, saveIntensity } from '../../src/render/fx/feedbackPolicy';
import { MemStorage } from '../audio/fakeBackend';

describe('feedbackPolicy', () => {
  it('Subtle (the default) table', () => {
    expect(DEFAULT_INTENSITY).toBe('subtle');
    const p = feedbackPolicy('subtle');
    expect(p).toMatchObject({ moneyMin: 500, moneyRel: 0.05, maxPopups: 6, puffScale: 0.6, puffGain: 0.25, emotePerGuestPerDay: 1, maxEmotes: 12, confettiOn: 'major', cameraKick: false, popupLifeS: 1, aggregateS: 2, kachingGapS: 3 });
  });
  it('Lively halves thresholds, doubles caps, allows the camera kick', () => {
    const s = feedbackPolicy('subtle'), l = feedbackPolicy('lively');
    expect(l.moneyMin).toBe(s.moneyMin / 2); expect(l.moneyRel).toBe(s.moneyRel / 2);
    expect(l.maxPopups).toBe(s.maxPopups * 2); expect(l.maxEmotes).toBe(s.maxEmotes * 2);
    expect(l.cameraKick).toBe(true);
  });
  it('Off disables everything optional', () => {
    const o = feedbackPolicy('off');
    expect(o).toMatchObject({ maxPopups: 0, puffScale: 0, puffGain: 0, maxEmotes: 0, emotePerGuestPerDay: 0, confettiOn: 'never', cameraKick: false });
    expect(o.moneyMin).toBe(Infinity);
  });
  it('reduced motion clamps Lively to Subtle and disables confetti + kick', () => {
    const l = feedbackPolicy('lively', { reducedMotion: true });
    expect(l.intensity).toBe('subtle'); expect(l.maxPopups).toBe(6); expect(l.cameraKick).toBe(false); expect(l.confettiOn).toBe('never');
    expect(feedbackPolicy('subtle', { reducedMotion: true }).confettiOn).toBe('never');
    expect(feedbackPolicy('off', { reducedMotion: true }).intensity).toBe('off');
  });
  it('confetti never for non-major milestones', () => {
    for (const i of ['off', 'subtle', 'lively'] as const) expect(confettiAllowed(feedbackPolicy(i), false)).toBe(false);
    expect(confettiAllowed(feedbackPolicy('subtle'), true)).toBe(true);
    expect(confettiAllowed(feedbackPolicy('subtle', { reducedMotion: true }), true)).toBe(false);
    expect(confettiAllowed(feedbackPolicy('off'), true)).toBe(false);
  });
  it('persists the choice; garbage falls back to Subtle', () => {
    const st = new MemStorage();
    expect(loadIntensity(st)).toBe('subtle');
    saveIntensity(st, 'off'); expect(loadIntensity(st)).toBe('off');
    st.setItem(FX_STORAGE_KEY, '{"intensity":"wild"}'); expect(loadIntensity(st)).toBe('subtle');
    st.setItem(FX_STORAGE_KEY, 'nope'); expect(loadIntensity(st)).toBe('subtle');
  });
});
