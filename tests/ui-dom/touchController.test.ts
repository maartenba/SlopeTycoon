// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TouchController, type TouchControllerOptions } from '../../src/render/TouchController';

/** The DOM glue of the touch input (docs/touch.md) driven with real DOM events on a fake canvas: two-step placement / lift, photo-mode pan, long-press vs a busy main thread. */
const camera = () => ({ active: true, panPixels: vi.fn(), zoomBy: vi.fn(), rotateBy: vi.fn() });
let dom: HTMLElement;
let now = 0;
let ctl: TouchController | null = null;
let seen: Array<{ type: string; x: number; y: number; shift: boolean; id: number }> = [];

const ptr = (type: string, id: number, x: number, y: number, target: EventTarget = dom): void => {
  const e = new Event(type, { bubbles: true, cancelable: true }) as unknown as Record<string, unknown>;
  Object.assign(e, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true });
  target.dispatchEvent(e as unknown as Event);
};
const tap = (id: number, x: number, y: number): void => { ptr('pointerdown', id, x, y); now += 80; ptr('pointerup', id, x, y); now += 50; };

function make(tool: () => string, extra: Partial<TouchControllerOptions> = {}): { cam: ReturnType<typeof camera>; confirm: ReturnType<typeof vi.fn>; states: Array<{ confirming: boolean; hint: string }> } {
  const cam = camera(), confirm = vi.fn(() => true), states: Array<{ confirming: boolean; hint: string }> = [];
  ctl = new TouchController({ dom, camera: cam as never, toolId: tool, enabled: () => true, confirmPlacement: confirm, ghostText: () => 'hint', now: () => now, onState: (s) => states.push({ confirming: s.confirming, hint: s.hint }), ...extra });
  ctl.toolChanged();
  return { cam, confirm, states };
}

beforeEach(() => {
  now = 0; seen = [];
  dom = document.createElement('canvas'); document.body.append(dom);
  for (const t of ['pointerdown', 'pointermove', 'pointerup']) dom.addEventListener(t, (e) => { const p = e as unknown as { clientX: number; clientY: number; shiftKey?: boolean; pointerId: number }; seen.push({ type: t, x: p.clientX, y: p.clientY, shift: !!p.shiftKey, id: p.pointerId }); });
});
afterEach(() => { ctl?.dispose(); ctl = null; document.body.replaceChildren(); document.body.className = ''; vi.useRealTimers(); delete (navigator as unknown as { scheduling?: unknown }).scheduling; });

describe('two-step lift stations (tap aims, a second tap or Place commits)', () => {
  it('the first tap only previews (a hover, no click) and the second tap near it confirms at the PREVIEW', () => {
    const { confirm, states } = make(() => 'lift');
    tap(1, 100, 100);
    expect(confirm).not.toHaveBeenCalled();
    expect(seen.map((s) => s.type)).toEqual(['pointermove']); // preview only: LiftTool.onMove, never onDown
    expect(states.at(-1)).toEqual({ confirming: true, hint: 'hint' });
    tap(2, 108, 104);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(seen.map((s) => s.type)).toEqual(['pointermove']); // the commit goes through confirmPlacement, not a click at the finger-width-away tile
    expect(states.at(-1)!.confirming).toBe(false);
  });
  it('a tap far from the preview re-aims instead of committing', () => {
    const { confirm } = make(() => 'lift');
    tap(1, 100, 100); tap(2, 220, 160);
    expect(confirm).not.toHaveBeenCalled();
    expect(seen.filter((s) => s.type === 'pointermove').map((s) => [s.x, s.y])).toEqual([[100, 100], [220, 160]]);
    tap(3, 224, 158);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it('shows the lift hint even before the first tap (bar text for the bottom station)', () => {
    const { states } = make(() => 'lift');
    expect(states.at(-1)).toEqual({ confirming: false, hint: 'hint' });
  });
  it('other tap tools (bulldoze) still click straight away', () => {
    make(() => 'bulldoze');
    tap(1, 50, 60);
    expect(seen.map((s) => s.type)).toEqual(['pointermove', 'pointerdown']);
  });
});

describe('photo mode: two-finger drag pans the focus', () => {
  it('fires a synthetic Shift + drag (the mouse pan gesture) while two fingers are down, and ends it on lift', () => {
    document.body.classList.add('view-photo');
    const cam = camera(); cam.active = false; // ground-level view owns the camera
    ctl = new TouchController({ dom, camera: cam as never, toolId: () => 'select', enabled: () => true, now: () => now });
    ptr('pointerdown', 1, 100, 200); ptr('pointerdown', 2, 200, 200);
    const down = seen.find((s) => s.type === 'pointerdown' && s.id === 9002);
    expect(down).toBeTruthy(); expect(down!.shift).toBe(true);
    ptr('pointermove', 1, 130, 230); ptr('pointermove', 2, 230, 230);
    const mv = seen.filter((s) => s.type === 'pointermove' && s.id === 9002);
    expect(mv.length).toBeGreaterThan(0);
    expect(mv.at(-1)).toMatchObject({ x: 180, y: 230, shift: true });
    ptr('pointerup', 2, 230, 230);
    expect(seen.some((s) => s.type === 'pointerup' && s.id === 9002)).toBe(true);
  });
  it('not in ride / walk (no pan pointer, only the wheel)', () => {
    document.body.classList.add('view-ride');
    const cam = camera(); cam.active = false;
    ctl = new TouchController({ dom, camera: cam as never, toolId: () => 'select', enabled: () => true, now: () => now });
    const wheels: number[] = []; dom.addEventListener('wheel', (e) => wheels.push((e as WheelEvent).deltaY));
    ptr('pointerdown', 1, 100, 200); ptr('pointerdown', 2, 200, 200); ptr('pointermove', 2, 260, 200);
    expect(seen.some((s) => s.id === 9002)).toBe(false);
    expect(wheels.length).toBeGreaterThan(0);
  });
});

describe('long press waits for queued input (a busy main thread must not turn a drag into a long press)', () => {
  it('the tick is skipped while the browser reports pending input, and fires once it is clear', () => {
    vi.useFakeTimers();
    let pending = true;
    (navigator as unknown as { scheduling: unknown }).scheduling = { isInputPending: () => pending };
    const ctxs: number[] = [];
    dom.addEventListener('contextmenu', () => ctxs.push(1));
    make(() => 'placement');
    ptr('pointerdown', 1, 100, 100);
    now = 700; vi.advanceTimersByTime(200);
    expect(ctxs.length).toBe(0); // 700 ms but input is queued: the finger may already have moved
    pending = false; now = 760; vi.advanceTimersByTime(200);
    expect(ctxs.length).toBe(1); // alternative action = cancel the tool
  });
});
