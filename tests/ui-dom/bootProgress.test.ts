// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bootStart, bootStage, bootFail, bootDone, bootFailed, SLOW_HINT_TEXT } from '@/ui/bootProgress';

const HTML = '<div id="splash"><div id="splash-bar" class="ind" role="progressbar"><div id="splash-fill"></div></div><span id="splash-text"></span><span id="splash-hint" hidden></span><div id="splash-err" hidden><p></p></div></div>';
describe('bootProgress DOM', () => {
  beforeEach(() => { document.body.innerHTML = HTML; vi.useFakeTimers(); bootStart(document, 8000); });
  it('updates bar, aria and text', () => {
    bootStage('world');
    const bar = document.getElementById('splash-bar')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('48');
    expect(bar.classList.contains('ind')).toBe(false);
    expect(document.getElementById('splash-fill')!.style.width).toBe('48%');
    expect(document.getElementById('splash-text')!.textContent).toBe('Carving the terrain…');
  });
  it('falls back to indeterminate for unknown stages', () => {
    bootStage('mystery');
    const bar = document.getElementById('splash-bar')!;
    expect(bar.classList.contains('ind')).toBe(true);
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
  });
  it('shows the slow hint after 8 s only', () => {
    vi.advanceTimersByTime(7000); expect(document.getElementById('splash-hint')!.hidden).toBe(true);
    vi.advanceTimersByTime(1500); const h = document.getElementById('splash-hint')!; expect(h.hidden).toBe(false); expect(h.textContent).toBe(SLOW_HINT_TEXT);
  });
  it('error state shows message and sticks', () => {
    bootFail('boom'); expect(bootFailed()).toBe(true);
    expect(document.getElementById('splash')!.classList.contains('failed')).toBe(true);
    expect(document.querySelector('#splash-err p')!.textContent).toBe('boom');
    expect(document.getElementById('splash-err')!.hidden).toBe(false);
    bootStage('lifts'); bootDone();
    expect(document.getElementById('splash-text')!.textContent).toBe('Something went wrong');
  });
  it('done completes at 100 and hides the hint', () => {
    bootDone(); expect(document.getElementById('splash-bar')!.getAttribute('aria-valuenow')).toBe('100');
  });
});
