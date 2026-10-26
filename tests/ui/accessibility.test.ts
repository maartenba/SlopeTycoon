import { describe, expect, it } from 'vitest';
import { A11Y_STORAGE_KEY, Accessibility, UI_SCALE_DEFAULT, UI_SCALE_MAX, UI_SCALE_MIN, clampUiScale } from '../../src/ui/accessibility';
import { scaledFontsCss, tokensCss } from '../../src/ui/tokens';

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } }

describe('accessibility settings', () => {
  it('UI scale is clamped to 90-130 in steps of 5; junk falls back to 100', () => {
    expect(clampUiScale(50)).toBe(UI_SCALE_MIN);
    expect(clampUiScale(500)).toBe(UI_SCALE_MAX);
    expect(clampUiScale(112)).toBe(110);
    expect(clampUiScale('x')).toBe(UI_SCALE_DEFAULT);
    expect(clampUiScale(NaN)).toBe(UI_SCALE_DEFAULT);
  });
  it('reduced motion defaults to the OS preference until the player chooses; the choice persists', () => {
    const st = new Mem();
    const a = new Accessibility(st, () => true);
    expect(a.get()).toEqual({ reducedMotion: true, uiScale: 100 });
    expect(a.followsSystem).toBe(true);
    a.set({ reducedMotion: false });
    expect(a.followsSystem).toBe(false);
    expect(new Accessibility(st, () => true).get().reducedMotion).toBe(false); // stored choice wins over the OS
    a.set({ uiScale: 125 });
    expect(JSON.parse(st.m.get(A11Y_STORAGE_KEY)!)).toEqual({ reducedMotion: false, uiScale: 125 });
    expect(new Accessibility(st).get().uiScale).toBe(125);
  });
  it('malformed storage and blocked storage fall back to defaults', () => {
    const bad = new Mem(); bad.setItem(A11Y_STORAGE_KEY, '{nope');
    expect(new Accessibility(bad).get()).toEqual({ reducedMotion: false, uiScale: 100 });
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const a = new Accessibility(throwing);
    expect(() => a.set({ uiScale: 120 })).not.toThrow();
    expect(a.get().uiScale).toBe(120);
  });
  it('notifies subscribers and applies to the document hook', () => {
    const seen: number[] = [];
    const a = new Accessibility(null, () => false, (s) => seen.push(s.uiScale));
    const got: boolean[] = [];
    const off = a.subscribe((s) => got.push(s.reducedMotion));
    a.set({ reducedMotion: true }); off(); a.set({ uiScale: 90 });
    expect(got).toEqual([true]);
    expect(seen).toEqual([100, 100, 90]);
  });
  it('font tokens are multiplied by --ui-scale after the base tokens (so the scale wins)', () => {
    const css = scaledFontsCss();
    expect(css).toContain('--fs-md:calc(12px * var(--ui-scale, 1))');
    expect(css).not.toContain('--fs-min');
    expect(tokensCss()).toContain('--fs-md:12px');
  });
});
