// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WALK_SETTINGS, WALK_SETTINGS_KEY, WalkInputHandler, dragLook, loadWalkSettings, lookDelta, mouseHint, sanitizeWalkSettings, saveWalkSettings, wantsPointerLock,
} from '../../src/render/view/WalkInput';
import { MemStorage } from '../audio/fakeBackend';

describe('mouse look: Drag (default) / Pointer lock', () => {
  it('defaults to drag, sanitises garbage, persists in slope.walk.v1 and round-trips', () => {
    expect(DEFAULT_WALK_SETTINGS.mouseLook).toBe('drag');
    expect(sanitizeWalkSettings({ mouseLook: 'nope' }).mouseLook).toBe('drag');
    expect(sanitizeWalkSettings(null).mouseLook).toBe('drag');
    expect(sanitizeWalkSettings({ mouseLook: 'lock' }).mouseLook).toBe('lock');
    const st = new MemStorage();
    expect(loadWalkSettings(st).mouseLook).toBe('drag'); // older saves without the field
    saveWalkSettings(st, { ...DEFAULT_WALK_SETTINGS, mouseLook: 'lock', fov: 90 });
    expect(JSON.parse(st.getItem(WALK_SETTINGS_KEY)!).mouseLook).toBe('lock');
    expect(loadWalkSettings(st)).toMatchObject({ mouseLook: 'lock', fov: 90 });
    st.setItem(WALK_SETTINGS_KEY, JSON.stringify({ sensitivity: 1.5 })); // a pre-existing v1 blob without mouseLook
    expect(loadWalkSettings(st)).toMatchObject({ sensitivity: 1.5, mouseLook: 'drag' });
  });
  it('pure drag-look mapping: right = turn right (yaw decreases), up = look up, scaled by sensitivity; first-event spikes are ignored', () => {
    const o = { yaw: 0, pitch: 0 };
    dragLook({ x: 100, y: 100 }, { x: 110, y: 100 }, 1, o); expect(o.yaw).toBeLessThan(0); expect(o.pitch).toBe(0);
    const y1 = o.yaw; dragLook({ x: 100, y: 100 }, { x: 110, y: 100 }, 2, o); expect(o.yaw).toBeCloseTo(y1 * 2, 8);
    dragLook({ x: 100, y: 100 }, { x: 100, y: 90 }, 1, o); expect(o.pitch).toBeGreaterThan(0); // mouse up = look up
    dragLook({ x: 0, y: 0 }, { x: 900, y: 0 }, 1, o); expect(o.yaw).toBe(0);
    const p = { yaw: 0, pitch: 0 }; lookDelta(10, 0, 1, p); dragLook({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, o); expect(o.yaw).toBe(p.yaw);
  });
  it('wantsPointerLock: only in lock mode, when supported, and not while the free-mouse key is held', () => {
    expect(wantsPointerLock('drag', true, false)).toBe(false);
    expect(wantsPointerLock('lock', true, false)).toBe(true);
    expect(wantsPointerLock('lock', false, false)).toBe(false);
    expect(wantsPointerLock('lock', true, true)).toBe(false);
  });
  it('the HUD hint tells how to free the mouse in lock mode and how to look in drag mode', () => {
    expect(mouseHint('lock')).toContain('Alt'); expect(mouseHint('lock').toLowerCase()).toContain('free mouse'); expect(mouseHint('drag').toLowerCase()).toContain('drag');
  });
  it('drag mode never requests pointer lock; dragging looks around and shows no capture; releasing ends the drag (DOM)', () => {
    const dom = document.createElement('canvas'); document.body.append(dom);
    let locks = 0, looks = 0, lookYaw = 0;
    (dom as unknown as { requestPointerLock: () => void }).requestPointerLock = () => { locks++; };
    const h = new WalkInputHandler({ onLook: (dy) => { looks++; lookYaw += dy; }, onInteract: () => {}, onExit: () => {}, onPhoto: () => {} });
    h.attach(window, dom); h.mouseLook = 'drag'; h.setActive(true);
    expect(locks).toBe(0);
    const ev = (t: string, x: number, y: number): PointerEvent => new PointerEvent(t, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true });
    dom.dispatchEvent(ev('pointerdown', 100, 100));
    expect(locks).toBe(0); expect(document.body.classList.contains('walk-dragging')).toBe(true);
    window.dispatchEvent(ev('pointermove', 120, 100));
    expect(looks).toBe(1); expect(lookYaw).toBeLessThan(0);
    window.dispatchEvent(ev('pointerup', 120, 100));
    expect(document.body.classList.contains('walk-dragging')).toBe(false);
    window.dispatchEvent(ev('pointermove', 160, 100)); expect(looks).toBe(1); // no drag, no look
    h.setActive(false); h.detach(); dom.remove();
  });
  it('lock mode requests the lock on click; Alt frees the mouse without leaving walk mode', () => {
    const dom = document.createElement('canvas'); document.body.append(dom);
    let locks = 0, exits = 0;
    (dom as unknown as { requestPointerLock: () => void }).requestPointerLock = () => { locks++; };
    const h = new WalkInputHandler({ onLook: () => {}, onInteract: () => {}, onExit: () => { exits++; }, onPhoto: () => {} });
    h.attach(window, dom); h.mouseLook = 'lock'; h.setActive(true);
    expect(locks).toBe(1);
    const d = document as unknown as { pointerLockElement: Element | null; exitPointerLock: () => void };
    d.pointerLockElement = dom; document.dispatchEvent(new Event('pointerlockchange')); expect(h.locked).toBe(true); // the lock engaged
    d.exitPointerLock = () => { d.pointerLockElement = null; document.dispatchEvent(new Event('pointerlockchange')); };
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }));
    expect(h.freed).toBe(true); expect(h.locked).toBe(false);
    expect(exits).toBe(0); // the lock change after the release must not count as Esc
    // a later real Esc (lock lost without Alt) still exits
    d.pointerLockElement = dom; document.dispatchEvent(new Event('pointerlockchange')); d.pointerLockElement = null; document.dispatchEvent(new Event('pointerlockchange'));
    expect(exits).toBe(1);
    dom.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 5, button: 0, pointerId: 2, bubbles: true }));
    expect(h.freed).toBe(false); expect(locks).toBe(2); // click re-captures
    h.setActive(false); h.detach(); dom.remove();
  });
});
