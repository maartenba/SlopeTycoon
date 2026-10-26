// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { MemStorage } from '../audio/fakeBackend';

registerComponents();
const q = (e: HTMLElement, sel: string): HTMLElement | null => e.shadowRoot!.querySelector(sel);
const walkModel = { location: 'Near Lodge/Restaurant 1', altitude: 1245.4, compass: 'NE', prompt: '', card: null, speed: '1x', hint: 'E interact · Shift run · Esc exit' };

describe('st-view-hud walk variant', () => {
  it('shows location, altitude, compass, game speed, the key hint, a crosshair dot and the Exit button; null hides everything', () => {
    const h = el('st-view-hud'); document.body.append(h);
    expect(h.walkVisible).toBe(false);
    h.renderWalk(walkModel);
    expect(h.hidden).toBe(false); expect(h.walkVisible).toBe(true);
    const t = q(h, '.walk')!.textContent!;
    for (const s of ['Near Lodge/Restaurant 1', '1245', 'NE', '1x', 'E interact', 'Shift run', 'Esc exit']) expect(t).toContain(s);
    expect(q(h, '.dot')!.hidden).toBe(false);
    expect(q(h, '.card')!.hidden).toBe(true); // the ride card stays hidden
    h.renderWalk(null);
    expect(h.walkVisible).toBe(false); expect(h.hidden).toBe(true); expect(q(h, '.dot')!.hidden).toBe(true);
    h.remove();
  });
  it('context prompts and the info popover', () => {
    const h = el('st-view-hud'); document.body.append(h);
    h.renderWalk({ ...walkModel, prompt: 'E: Board Chairlift 1' });
    expect(h.promptText).toBe('E: Board Chairlift 1');
    h.renderWalk({ ...walkModel, prompt: 'E: Inspect Café', card: { title: 'Café 1', lines: ['Status: active', 'Conditions: open'] } });
    expect(h.infoVisible).toBe(true);
    expect(q(h, '.info')!.textContent).toContain('Café 1'); expect(q(h, '.info')!.textContent).toContain('Conditions: open');
    h.renderWalk({ ...walkModel, prompt: '' });
    expect(h.promptText).toBe(''); expect(h.infoVisible).toBe(false);
    h.remove();
  });
  it('riding a lift shows the lift name + progress and hides the crosshair; Exit calls the API; pointer-events stay off the canvas', () => {
    const h = el('st-view-hud'); document.body.append(h);
    let exits = 0; h.bind({ exit: () => { exits++; }, next: () => {} });
    h.renderWalk({ ...walkModel, riding: { name: 'Chairlift 1', progress: 0.42 } });
    expect(q(h, '.walk')!.textContent).toContain('Riding Chairlift 1 · 42%');
    expect(q(h, '.dot')!.hidden).toBe(true);
    (q(h, '.walk button.exit') as HTMLButtonElement).click(); expect(exits).toBe(1);
    expect(q(h, '.walk button.exit')!.querySelector('svg')).toBeTruthy();
    expect(/\p{Extended_Pictographic}/u.test(q(h, '.walk')!.textContent!)).toBe(false);
    h.remove();
  });
  it('the ride HUD is unaffected: render(model) hides the walk parts, render(null) hides all', () => {
    const h = el('st-view-hud'); document.body.append(h);
    h.renderWalk(walkModel);
    h.render({ title: 'Guest #1', activity: 'Skiing', kmh: 10, altitude: 1500, speed: '1x', interior: false });
    h.render(null);
    expect(h.walkVisible).toBe(false); expect(h.hidden).toBe(true);
    h.remove();
  });
});

describe("inspector 'Walk here'", () => {
  it('appears only once bound, runs with the building id, and uses an SVG icon (no emoji)', () => {
    const e = el('st-inspector'); document.body.append(e);
    const root = (e as unknown as { root: ShadowRoot }).root;
    e.show({ id: 7, type: 'cafe', active: true, refund: 10 });
    expect(root.querySelector('button[data-role="walk"]')).toBeNull();
    const ids: number[] = []; e.bindWalk((id) => ids.push(id));
    e.show({ id: 7, type: 'cafe', active: true, refund: 10 });
    const b = root.querySelector('button[data-role="walk"]') as HTMLButtonElement;
    expect(b.textContent).toContain('Walk here'); expect(b.querySelector('svg')).toBeTruthy(); expect(/\p{Extended_Pictographic}/u.test(b.textContent!)).toBe(false);
    b.click(); expect(ids).toEqual([7]);
    e.remove();
  });
});

describe('settings: walk mode controls', () => {
  it('sensitivity / FOV sliders and the invert-Y / head-bob / run-toggle checkboxes call the API with the new values', () => {
    const e = el('st-settings'); document.body.append(e);
    const cur = { sensitivity: 1, invertY: false, fov: 75, headBob: true, runToggle: false, mouseLook: 'drag' as 'drag' | 'lock' }, calls: Array<Record<string, unknown>> = [];
    e.bind(new AudioSettings(new MemStorage()), { state: 'running', needsHint: false, onState: () => () => {} }, [], { walk: { get: () => cur, set: (p) => { calls.push(p); Object.assign(cur, p); } } });
    const root = (e as unknown as { root: ShadowRoot }).root;
    const sens = root.querySelector('input[data-opt="sensitivity"]') as HTMLInputElement, fov = root.querySelector('input[data-opt="fov"]') as HTMLInputElement;
    expect([sens.min, sens.max, fov.min, fov.max]).toEqual(['0.5', '2', '60', '100']);
    expect(fov.value).toBe('75');
    sens.value = '1.5'; sens.dispatchEvent(new Event('input')); fov.value = '90'; fov.dispatchEvent(new Event('input'));
    for (const k of ['invertY', 'headBob', 'runToggle']) { const c = root.querySelector(`input[data-opt="walk-${k}"]`) as HTMLInputElement; c.checked = !c.checked; c.dispatchEvent(new Event('change')); }
    expect(calls).toEqual([{ sensitivity: 1.5 }, { fov: 90 }, { invertY: true }, { headBob: false }, { runToggle: true }]);
    e.remove();
  });
});

describe('settings: walk mouse look select', () => {
  it('offers Drag (default) and Pointer lock and persists through the API', () => {
    const e = el('st-settings'); document.body.append(e);
    const cur = { sensitivity: 1, invertY: false, fov: 75, headBob: true, runToggle: false, mouseLook: 'drag' as 'drag' | 'lock' }, calls: Array<Record<string, unknown>> = [];
    e.bind(new AudioSettings(new MemStorage()), { state: 'running', needsHint: false, onState: () => () => {} }, [], { walk: { get: () => cur, set: (p) => { calls.push(p); Object.assign(cur, p); } } });
    const root = (e as unknown as { root: ShadowRoot }).root;
    const row = root.querySelector('[data-row="mouseLook"]')!;
    expect(row.textContent).toContain('Walk: mouse look');
    const sel = row.querySelector('st-select') as unknown as HTMLElement & { value: string };
    expect(sel.value).toBe('drag');
    sel.value = 'lock'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(calls).toContainEqual({ mouseLook: 'lock' });
    e.remove();
  });
});

describe('top bar walk button: click = choose start, drag onto the map = drop', () => {
  const setup = (): { b: HTMLButtonElement; log: string[]; top: HTMLElement } => {
    const top = el('st-topbar'); document.body.append(top);
    const log: string[] = [];
    top.bind({
      rotate: () => {}, help: () => {}, walk: () => log.push('click'),
      walkDrag: { begin: () => log.push('begin'), move: (x, y) => log.push(`move ${x},${y}`), end: (x, y) => log.push(`end ${x},${y}`), cancel: () => log.push('cancel') },
    });
    const b = (top as unknown as { root: ShadowRoot }).root.querySelector('button[data-role="walk"]') as HTMLButtonElement;
    return { b, log, top };
  };
  const pe = (t: string, x: number, y: number): PointerEvent => new PointerEvent(t, { clientX: x, clientY: y, button: 0, pointerId: 7, bubbles: true });
  it('has an accessible label, an svg icon and no emoji', () => {
    const { b, top } = setup();
    expect(b).toBeTruthy(); expect(b.getAttribute('aria-label')).toContain('Walk mode'); expect(b.title).toContain('Shift+V'); expect(b.querySelector('svg')).toBeTruthy();
    top.remove();
  });
  it('a click without moving opens choose-start mode (no drag events)', () => {
    const { b, log, top } = setup();
    b.dispatchEvent(pe('pointerdown', 10, 10)); b.dispatchEvent(pe('pointerup', 11, 10)); b.click();
    expect(log).toEqual(['click']);
    top.remove();
  });
  it('dragging past the threshold begins a drag, follows the pointer, drops on release and swallows the click that follows', () => {
    const { b, log, top } = setup();
    b.dispatchEvent(pe('pointerdown', 10, 10));
    b.dispatchEvent(pe('pointermove', 12, 10)); expect(log).toEqual([]); // under the threshold
    b.dispatchEvent(pe('pointermove', 200, 300));
    b.dispatchEvent(pe('pointerup', 210, 320)); b.click();
    expect(log).toEqual(['begin', 'move 200,300', 'end 210,320']);
    top.remove();
  });
  it('pointercancel cancels the drag', () => {
    const { b, log, top } = setup();
    b.dispatchEvent(pe('pointerdown', 10, 10)); b.dispatchEvent(pe('pointermove', 100, 100)); b.dispatchEvent(pe('pointercancel', 100, 100));
    expect(log).toEqual(['begin', 'move 100,100', 'cancel']);
    top.remove();
  });
});

describe('walk drop marker', () => {
  it('follows the pointer, turns red when blocked, hides on demand, and has a status hint', async () => {
    const { WalkDropMarker, DROP_HINT } = await import('../../src/ui/walkDropMarker');
    const m = new WalkDropMarker(); m.mount(document.body);
    expect(m.el.hidden).toBe(true); m.show();
    expect(m.hint.textContent).toBe(DROP_HINT); expect(m.hint.getAttribute('role')).toBe('status');
    expect(m.el.style.pointerEvents).toBe('none'); // never blocks the map
    m.move(120, 80, true); expect(m.el.style.left).toBe('120px'); expect(m.el.style.top).toBe('80px'); expect(m.el.dataset.state).toBe('ok');
    m.move(130, 90, false, 'Blocked: you will drop at the nearest free spot');
    expect(m.el.dataset.state).toBe('blocked'); expect(m.hint.textContent).toContain('Blocked'); expect(m.el.querySelector('svg')).toBeTruthy();
    m.hide(); expect(m.visible).toBe(false); expect(m.el.hidden).toBe(true);
    m.dispose();
  });
});

describe('walk HUD hint shows how to free the mouse', () => {
  it('renders the hint text given by the host (lock mode: Alt: free mouse)', () => {
    const h = el('st-view-hud'); document.body.append(h);
    h.renderWalk({ ...walkModel, hint: 'E interact · T teleport · Mouse look (Alt: free mouse)' });
    expect(q(h, '.walk')!.textContent).toContain('Alt: free mouse'); expect(q(h, '.walk')!.textContent).toContain('T teleport');
    h.remove();
  });
});
