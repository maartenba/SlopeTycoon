// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { GuestStore, GuestType } from '../../src/sim/guests/Guest';
import { guestInspectorModel } from '../../src/ui/guestInfo';

registerComponents();
const q = (e: HTMLElement, sel: string): HTMLElement | null => e.shadowRoot!.querySelector(sel);
const model = { title: 'Guest #7', activity: 'Skiing', kmh: 42, altitude: 1812.4, speed: '1x slow-mo', interior: false };

describe('st-view-hud (ride-along HUD)', () => {
  it('constructor rules: createElement adds no attributes or children', () => {
    const h = document.createElement('st-view-hud');
    expect(h.attributes.length).toBe(0); expect(h.childNodes.length).toBe(0);
  });
  it('is hidden until rendered; shows guest, activity, km/h, altitude and game speed; null hides it again', () => {
    const h = el('st-view-hud'); document.body.append(h);
    expect(h.hidden).toBe(true); expect(h.visible).toBe(false);
    h.render(model);
    expect(h.hidden).toBe(false); expect(h.visible).toBe(true);
    const text = q(h, '.card')!.textContent!;
    for (const t of ['Guest #7', 'Skiing', '42', 'km/h', '1812', 'm alt', '1x slow-mo', 'Esc exit', 'N next']) expect(text).toContain(t);
    h.render(null);
    expect(h.hidden).toBe(true);
    h.remove();
  });
  it('Exit and Next guest buttons call the API; both have SVG icons (no emoji)', () => {
    const h = el('st-view-hud'); document.body.append(h);
    const calls: string[] = [];
    h.bind({ exit: () => calls.push('exit'), next: () => calls.push('next') });
    h.render(model);
    q(h, 'button.exit')!.click(); q(h, 'button.next')!.click();
    expect(calls).toEqual(['exit', 'next']);
    expect(q(h, 'button.exit')!.querySelector('svg')).toBeTruthy(); expect(q(h, 'button.next')!.querySelector('svg')).toBeTruthy();
    expect(/\p{Extended_Pictographic}/u.test(q(h, '.card')!.textContent!)).toBe(false);
    h.remove();
  });
  it('the cabin window frame shows only for interior views and never takes pointer events (the canvas stays the drag-look surface)', () => {
    const h = el('st-view-hud'); document.body.append(h);
    h.render(model); expect(h.frameOn).toBe(false);
    h.render({ ...model, interior: true }); expect(h.frameOn).toBe(true);
    const css = Array.from(h.shadowRoot!.adoptedStyleSheets ?? []).map((s) => Array.from(s.cssRules).map((r) => r.cssText).join('')).join('') + (h.shadowRoot!.querySelector('style')?.textContent ?? '');
    expect(css).toMatch(/\.frame\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/:host\s*\{[^}]*width:\s*0(px)?;\s*height:\s*0(px)?;\s*pointer-events:\s*none/);
    h.remove();
  });
});

describe('guest inspector: Ride along button', () => {
  const s = new GuestStore(4);
  const i = s.add({ x: 3, y: 4, z: 0, type: GuestType.Solo, skill: 1, budget: 100, group: 1, mode: 0, overnight: false, leaveDay: 0, tick: 0 });
  it('shows a Ride along button (SVG icon) that calls back with the guest id', () => {
    const g = el('st-guest-inspector'); document.body.append(g);
    const ids: number[] = [];
    g.bind(() => {}, (id) => ids.push(id));
    g.show(guestInspectorModel(s, i)!);
    const b = q(g, 'button.ride')!;
    expect(b).toBeTruthy(); expect(b.textContent).toContain('Ride along'); expect(b.querySelector('svg')).toBeTruthy();
    b.click();
    expect(ids).toEqual([s.id[i]!]);
    g.remove();
  });
  it('without a ride callback (old call sites) there is no button', () => {
    const g = el('st-guest-inspector'); document.body.append(g);
    g.bind(() => {});
    g.show(guestInspectorModel(s, i)!);
    expect(q(g, 'button.ride')).toBeNull();
    g.remove();
  });
});
