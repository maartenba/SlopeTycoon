import { describe, expect, it } from 'vitest';
import { edgeState, popoverLeft, scrollIntoViewLeft, wheelToHorizontal } from '../../src/ui/drawerScroll';

describe('wheelToHorizontal', () => {
  it('maps vertical wheel to horizontal px', () => {
    expect(wheelToHorizontal({ deltaX: 0, deltaY: 100 })).toBe(100);
    expect(wheelToHorizontal({ deltaX: 0, deltaY: -3, deltaMode: 1 })).toBe(-48);
    expect(wheelToHorizontal({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 500)).toBe(500);
  });
  it('leaves horizontal-dominant or empty gestures alone', () => {
    expect(wheelToHorizontal({ deltaX: 40, deltaY: 10 })).toBeNull();
    expect(wheelToHorizontal({ deltaX: 0, deltaY: 0 })).toBeNull();
  });
});

describe('scrollIntoViewLeft', () => {
  it('keeps a visible item', () => expect(scrollIntoViewLeft(100, 400, 200, 90)).toBe(100));
  it('scrolls left to reveal an item', () => expect(scrollIntoViewLeft(300, 400, 100, 90, 8)).toBe(92));
  it('scrolls right to reveal an item', () => expect(scrollIntoViewLeft(0, 400, 500, 90, 8)).toBe(198));
  it('clamps to [0, scrollWidth-viewW]', () => {
    expect(scrollIntoViewLeft(50, 400, 0, 90, 8)).toBe(0);
    expect(scrollIntoViewLeft(0, 400, 1000, 90, 8, 1050)).toBe(650);
  });
});

describe('edgeState', () => {
  it('reports overflow on each side', () => {
    expect(edgeState(0, 400, 1000)).toEqual({ left: false, right: true });
    expect(edgeState(300, 400, 1000)).toEqual({ left: true, right: true });
    expect(edgeState(600, 400, 1000)).toEqual({ left: true, right: false });
    expect(edgeState(0, 400, 400)).toEqual({ left: false, right: false });
  });
});

describe('popoverLeft', () => {
  it('aligns to the card, flips at the right edge, stays on-screen', () => {
    expect(popoverLeft(100, 96, 320, 800)).toBe(100);
    expect(popoverLeft(600, 96, 320, 800)).toBe(376);
    expect(popoverLeft(0, 96, 320, 300)).toBe(0);
    expect(popoverLeft(-50, 96, 320, 800, 4)).toBe(4);
  });
});
