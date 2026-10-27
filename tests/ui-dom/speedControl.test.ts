// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents, Speed } from '../../src/core/events';

registerComponents();
const q = (e: HTMLElement, sel: string): HTMLElement | null => e.shadowRoot!.querySelector(sel);
const qa = (e: HTMLElement, sel: string): HTMLElement[] => [...e.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];

function mount(o: { active?: boolean; blocked?: string | null } = {}) {
  const bus = new EventBus<GameEvents>();
  const s = { speed: 1 as Speed, started: [] as string[], cancelled: 0, active: o.active ?? false, blocked: o.blocked ?? null };
  const h = el('st-speed-control'); document.body.append(h);
  h.bind({
    bus, getSpeed: () => s.speed, setSpeed: (v) => { s.speed = v; }, getDate: () => ({ year: 0, day: 12, minute: 870, tick: 0 }),
    skip: {
      options: [{ id: 'month', label: 'Next month', hint: 'K' }, { id: 'season', label: 'Next season', hint: 's' }, { id: 'event', label: 'Next event', hint: 'e' }],
      start: (id) => { if (s.blocked) return s.blocked; s.started.push(id); s.active = true; return null; }, cancel: () => { s.cancelled++; s.active = false; },
      canStart: () => s.blocked, active: () => s.active,
      progress: () => (s.active ? { label: 'next season', fraction: 0.4, daysLeft: 36, etaSeconds: 7.2, daysPerSecond: 5 } : null),
    },
  });
  return { h, s };
}

describe('st-speed-control: speed labels and the Skip menu', () => {
  it('constructor rules: createElement adds no attributes or children', () => {
    const h = document.createElement('st-speed-control');
    expect(h.attributes.length).toBe(0); expect(h.childNodes.length).toBe(0);
  });
  it('speed buttons read 1× / 3× / 10× (no 8×)', () => {
    const { h } = mount();
    const labels = qa(h, '.btns > button').map((b) => b.textContent!.trim()).filter(Boolean);
    expect(labels).toEqual(expect.arrayContaining(['1×', '3×', '10×']));
    expect(labels).not.toContain('8×');
    expect(qa(h, '.btns > button').some((b) => /15 s/.test(b.title))).toBe(true);
    h.remove();
  });
  it('the date line has a tooltip with the full date and the day of year (and no clock, which would flicker the tooltip)', () => {
    const { h } = mount();
    const t = q(h, '.when .d')!.title;
    expect(t).toContain('Day 13 of 180'); expect(t).toMatch(/April|May|June|July|August|September|October|November|December|January|February|March/); expect(t).not.toMatch(/\d\d:\d\d/);
    h.remove();
  });
  it('the Skip button is a menu button (aria) and hidden without the skip API', () => {
    const { h } = mount();
    const b = qa(h, '.btns > button').find((x) => x.getAttribute('aria-haspopup') === 'menu')! as HTMLButtonElement;
    expect(b.hidden).toBe(false); expect(b.getAttribute('aria-expanded')).toBe('false'); expect(b.getAttribute('aria-label')).toBe('Skip to…');
    h.remove();
    const h2 = el('st-speed-control'); document.body.append(h2);
    h2.bind({ bus: new EventBus<GameEvents>(), getSpeed: () => 1, setSpeed: () => {}, getDate: () => ({ year: 0, day: 0, minute: 0, tick: 0 }) });
    expect((qa(h2, '.btns > button').find((x) => x.getAttribute('aria-haspopup') === 'menu') as HTMLButtonElement).hidden).toBe(true);
    h2.remove();
  });
  it('opens a role=menu with three items, keyboard navigable, Esc closes and returns focus; choosing an item starts that skip', () => {
    const { h, s } = mount();
    const b = qa(h, '.btns > button').find((x) => x.getAttribute('aria-haspopup') === 'menu')! as HTMLButtonElement;
    b.click();
    const menu = q(h, '.menu')!;
    expect(menu.hidden).toBe(false); expect(menu.getAttribute('role')).toBe('menu'); expect(b.getAttribute('aria-expanded')).toBe('true');
    const items = qa(h, '.menu button');
    expect(items.map((i) => i.getAttribute('role'))).toEqual(['menuitem', 'menuitem', 'menuitem']);
    expect(items.map((i) => i.querySelector('span')!.textContent)).toEqual(['Next month', 'Next season', 'Next event']);
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true); expect(b.getAttribute('aria-expanded')).toBe('false');
    b.click(); qa(h, '.menu button')[1]!.click();
    expect(s.started).toEqual(['season']); expect(q(h, '.menu')!.hidden).toBe(true);
    h.remove();
  });
  it('blocked contexts disable the items and say why', () => {
    const { h } = mount({ blocked: 'Not available in ride-along, walk or photo mode' });
    (qa(h, '.btns > button').find((x) => x.getAttribute('aria-haspopup') === 'menu') as HTMLButtonElement).click();
    expect(qa(h, '.menu button').every((i) => (i as HTMLButtonElement).disabled)).toBe(true);
    expect(q(h, '.menu .note')!.textContent).toContain('Not available');
    h.remove();
  });
  it('the progress pill is a polite status region with days to go, ETA, a bar and a Cancel button', () => {
    const { h, s } = mount({ active: true });
    bus_refresh(h);
    const pill = q(h, '.pill')!;
    expect(pill.hidden).toBe(false); expect(pill.getAttribute('role')).toBe('status'); expect(pill.getAttribute('aria-live')).toBe('polite');
    expect(pill.textContent).toContain('Fast-forwarding to next season'); expect(pill.textContent).toContain('36 days to go'); expect(pill.textContent).toContain('about 7 s');
    expect((q(h, '.pill .bar > i') as HTMLElement).style.width).toBe('40%');
    qa(h, '.pill button')[0]!.click();
    expect(s.cancelled).toBe(1);
    h.remove();
  });
});

function bus_refresh(h: HTMLElement): void { h.dispatchEvent(new Event('x')); (h as unknown as { refreshPill(): void }).refreshPill(); }
