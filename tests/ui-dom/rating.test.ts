// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { registerComponents } from '../../src/ui';
import { CHIP_MIN, ratingChipText, ratingDeltaStars } from '../../src/ui/components/StRating';
import type { StRating } from '../../src/ui/components/StRating';
import type { RatingBreakdown } from '../../src/sim/Rating';

describe('rating chip (pure)', () => {
  it('delta is score/20 rounded to 0.1', () => { expect(ratingDeltaStars(50, 54)).toBe(0.2); expect(ratingDeltaStars(50, 48)).toBe(-0.1); });
  it('format with ★ and a real minus; hides tiny moves', () => {
    expect(ratingChipText(0.2)).toBe('+0.2\u2605'); expect(ratingChipText(-0.1)).toBe('\u22120.1\u2605');
    expect(ratingChipText(0.04)).toBeNull(); expect(ratingChipText(0)).toBeNull(); expect(ratingChipText(NaN)).toBeNull();
    expect(CHIP_MIN).toBe(0.1);
  });
});

const bd = (score: number): RatingBreakdown => ({ score, stars: Math.round(score / 10) / 2, components: [], bonus: 0, bonusHints: [], hints: [] });
describe('st-rating', () => {
  registerComponents();
  it('createElement adds nothing; chip shows on change and not on first read', () => {
    const e = document.createElement('st-rating') as StRating;
    expect(e.attributes.length).toBe(0); expect(e.childNodes.length).toBe(0);
    document.body.append(e);
    let s = 60;
    e.bind(() => ({ breakdown: bd(s), happiness: 0.6 }));
    const chip = (): HTMLElement => e.shadowRoot!.querySelector('.chip') as HTMLElement;
    expect(chip().hidden).toBe(true);
    s = 64; e.refresh();
    expect(chip().hidden).toBe(false); expect(chip().textContent).toBe('+0.2\u2605'); expect(chip().className).toContain('up');
    s = 60; e.refresh();
    expect(chip().textContent).toBe('\u22120.2\u2605');
    e.remove();
  });
});
