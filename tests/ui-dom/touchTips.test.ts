// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTouchTips, tipTextFor, type TouchTipsHandle } from '../../src/ui/touchTips';

let h: TouchTipsHandle | null = null;
let on = true;
beforeEach(() => { vi.useFakeTimers(); on = true; });
afterEach(() => { h?.dispose(); h = null; document.body.replaceChildren(); vi.useRealTimers(); });

const ptr = (target: EventTarget, type: string, x = 50, y = 60, id = 1, pointerType = 'touch'): void => {
  const e = new Event(type, { bubbles: true, cancelable: true, composed: true }) as unknown as Record<string, unknown>;
  Object.assign(e, { pointerId: id, pointerType, clientX: x, clientY: y });
  target.dispatchEvent(e as unknown as Event);
};
const tipEl = (): HTMLElement | null => document.querySelector('.touch-tip');

describe('touch tooltips (hold a finger still on a labelled control)', () => {
  it('tipTextFor: first title / aria-label up the path; canvas, inputs, selects and the stick are skipped', () => {
    const b = document.createElement('button'); b.title = 'Undo (Ctrl+Z)'; const i = document.createElement('i'); b.append(i);
    expect(tipTextFor([i, b])?.text).toBe('Undo (Ctrl+Z)');
    const a = document.createElement('button'); a.setAttribute('aria-label', 'Rotate left');
    expect(tipTextFor([a])?.text).toBe('Rotate left');
    const c = document.createElement('canvas'); c.title = 'map';
    expect(tipTextFor([c])).toBeNull();
    const r = document.createElement('input'); r.title = 'slider';
    expect(tipTextFor([r])).toBeNull();
    const j = document.createElement('div'); j.dataset.role = 'joystick'; j.setAttribute('aria-label', 'Walk joystick');
    expect(tipTextFor([j])).toBeNull();
    expect(tipTextFor([document.createElement('div')])).toBeNull();
  });
  it('shows the title after the hold, hides after 2.5 s, and swallows the click that follows the release', () => {
    h = installTouchTips({ enabled: () => on });
    const b = document.createElement('button'); b.title = 'Redo the last undone action'; document.body.append(b);
    const clicks: number[] = []; b.addEventListener('click', () => clicks.push(1));
    ptr(b, 'pointerdown');
    vi.advanceTimersByTime(300); expect(tipEl()).toBeNull();
    vi.advanceTimersByTime(300); expect(tipEl()?.textContent).toBe('Redo the last undone action');
    ptr(b, 'pointerup');
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); // the click the browser fires after the release
    expect(clicks).toEqual([]);
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); // the next real tap works again
    expect(clicks).toEqual([1]);
    vi.advanceTimersByTime(2600); expect(tipEl()).toBeNull();
  });
  it('a quick tap or a drag shows nothing and still clicks', () => {
    h = installTouchTips({ enabled: () => on });
    const b = document.createElement('button'); b.title = 'x'; document.body.append(b);
    const clicks: number[] = []; b.addEventListener('click', () => clicks.push(1));
    ptr(b, 'pointerdown'); vi.advanceTimersByTime(100); ptr(b, 'pointerup');
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toEqual([1]); expect(tipEl()).toBeNull();
    ptr(b, 'pointerdown', 50, 60); ptr(b, 'pointermove', 90, 60); vi.advanceTimersByTime(800);
    expect(tipEl()).toBeNull(); ptr(b, 'pointerup', 90, 60);
  });
  it('ignores mouse pointers and does nothing while touch is off', () => {
    h = installTouchTips({ enabled: () => on });
    const b = document.createElement('button'); b.title = 'x'; document.body.append(b);
    ptr(b, 'pointerdown', 1, 1, 1, 'mouse'); vi.advanceTimersByTime(800); expect(tipEl()).toBeNull(); ptr(b, 'pointerup', 1, 1, 1, 'mouse');
    on = false; ptr(b, 'pointerdown'); vi.advanceTimersByTime(800); expect(tipEl()).toBeNull();
  });
  it('a new press removes the old bubble', () => {
    h = installTouchTips({ enabled: () => on });
    const b = document.createElement('button'); b.title = 'x'; document.body.append(b);
    ptr(b, 'pointerdown'); vi.advanceTimersByTime(600); expect(tipEl()).not.toBeNull(); ptr(b, 'pointerup');
    ptr(b, 'pointerdown', 5, 5, 2); expect(tipEl()).toBeNull(); ptr(b, 'pointerup', 5, 5, 2);
  });
  it('holdMs is adjustable (slow emulated devices) and a queued release postpones the bubble', () => {
    h = installTouchTips({ enabled: () => on, holdMs: 500 });
    expect(h.holdMs).toBe(500); h.holdMs = 2000;
    const b = document.createElement('button'); b.title = 'x'; document.body.append(b);
    ptr(b, 'pointerdown'); vi.advanceTimersByTime(1500); expect(tipEl()).toBeNull();
    vi.advanceTimersByTime(600); expect(tipEl()).not.toBeNull(); ptr(b, 'pointerup');
    h.holdMs = 100;
    let pending = true;
    (navigator as unknown as { scheduling: unknown }).scheduling = { isInputPending: () => pending };
    ptr(b, 'pointerdown', 5, 5, 3); vi.advanceTimersByTime(400);
    expect(tipEl()).toBeNull(); // the browser has input queued (maybe the release): not a hold yet
    pending = false; vi.advanceTimersByTime(100);
    expect(tipEl()).not.toBeNull();
    delete (navigator as unknown as { scheduling?: unknown }).scheduling;
  });
});
