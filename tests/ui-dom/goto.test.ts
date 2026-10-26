// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import type { NewsItem } from '../../src/ui/newsFormat';
import { CameraController, FOCUS_ZOOM, focusPose } from '../../src/render/CameraController';

registerComponents();
const root = (e: Element): ShadowRoot => (e as unknown as { root: ShadowRoot }).root;

const item = (o: Partial<NewsItem> = {}): NewsItem => ({ text: 'avalanche near the hut', severity: 'warn', tier: 'important', icon: '🏔️', key: 'k', category: 'incident', ...o });

describe('Go to button', () => {
  it('news rows with a focus get a "⌖ Go to" button that calls goTo with the target; rows without one do not', () => {
    const bus = new EventBus<GameEvents>();
    const news = el('st-news'); document.body.append(news);
    const goTo = vi.fn();
    news.bind(bus, { stamp: () => 'Day 1 10:00', muted: () => new Set(), setMuted: () => undefined, goTo });
    news.push(item({ focus: { x: 12, y: 20, entityKind: 'building', entityId: 3 }, key: 'a' }));
    news.push(item({ text: 'Month closed', key: 'b', category: 'finance' }));
    (root(news).querySelector('.wrap > button') as HTMLButtonElement).click(); // open
    const rows = [...root(news).querySelectorAll('.e')];
    expect(rows).toHaveLength(2);
    const buttons = root(news).querySelectorAll('.e button.go');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe('⌖ Go to');
    (buttons[0] as HTMLButtonElement).click();
    expect(goTo).toHaveBeenCalledTimes(1);
    expect(goTo).toHaveBeenCalledWith({ x: 12, y: 20, entityKind: 'building', entityId: 3 });
    root(news).querySelector('.e.loc')!.dispatchEvent(new Event('click')); // the row itself still focuses
    expect(goTo).toHaveBeenCalledTimes(2);
  });
  it('news text is sentence-cased at the sink', () => {
    const news = el('st-news'); document.body.append(news);
    news.bind(new EventBus<GameEvents>(), { stamp: () => '', muted: () => new Set(), setMuted: () => undefined });
    news.push(item({ text: 'café closed', key: 'z' }));
    expect(news.items[0]!.text).toBe('Café closed');
  });
  it('toasts with an action render the button and run it; the text is capitalised', () => {
    const t = el('st-toast'); document.body.append(t);
    const run = vi.fn();
    t.show('mountain hut inactive: not connected', 'warn', 3500, { key: 'goto', severity: 'warn', action: { label: 'Go to', run } });
    const box = root(t);
    expect(box.querySelector('.t')!.firstChild!.textContent).toBe('Mountain hut inactive: not connected');
    const b = box.querySelector('.t button') as HTMLButtonElement;
    expect(b.textContent).toBe('Go to');
    b.click(); expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('camera focus tween', () => {
  it('focusPose is pure, eased, monotonic and hits both ends exactly', () => {
    const a = { x: 0, z: 0, zoom: 1.5 }, b = { x: 10, z: -20, zoom: 3 };
    expect(focusPose(a, b, 0)).toEqual(a); expect(focusPose(a, b, 1)).toEqual(b);
    expect(focusPose(a, b, -3)).toEqual(a); expect(focusPose(a, b, 7)).toEqual(b);
    const mid = focusPose(a, b, 0.5); expect(mid.x).toBeCloseTo(5); expect(mid.z).toBeCloseTo(-10); expect(mid.zoom).toBeCloseTo(2.25);
    let prev = -1; for (let t = 0; t <= 1; t += 0.05) { const x = focusPose(a, b, t).x; expect(x).toBeGreaterThanOrEqual(prev); prev = x; }
    expect(focusPose(a, b, 0.1).x).toBeLessThan(1); // ease-in: slow start
  });
  it('CameraController.focusOn moves the target smoothly, zooms in, clamps to the map and is cancelled by panning', () => {
    const cam = new CameraController(document.createElement('div'), 64);
    cam.target.set(5, 0, 5); cam.zoom = cam.minZoom;
    cam.focusOn(40, 30);
    expect(cam.focusing).toBe(true);
    cam.update(0.1);
    expect(cam.target.x).toBeGreaterThan(5); expect(cam.target.x).toBeLessThan(40);
    for (let i = 0; i < 20; i++) cam.update(0.1);
    expect(cam.focusing).toBe(false);
    expect(cam.target.x).toBeCloseTo(40); expect(cam.target.z).toBeCloseTo(30);
    expect(cam.zoom).toBeCloseTo(Math.min(cam.maxZoom, FOCUS_ZOOM));
    cam.focusOn(9999, -5, { duration: 0 });
    expect(cam.target.x).toBe(64); expect(cam.target.z).toBe(0); expect(cam.focusing).toBe(false);
    const z0 = cam.zoom; cam.focusOn(10, 10, { zoom: 0.1 }); // never zoom outside the limits
    for (let i = 0; i < 20; i++) cam.update(0.1);
    expect(cam.zoom).toBeGreaterThanOrEqual(cam.minZoom); expect(cam.zoom).toBeLessThanOrEqual(z0 + 1e-9);
    cam.focusOn(50, 50); cam.pan(1, 0); expect(cam.focusing).toBe(false);
    cam.dispose();
  });
});
