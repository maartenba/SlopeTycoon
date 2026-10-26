// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { ALL_COMPONENT_TAGS, el, registerComponents } from '../../src/ui';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';

registerComponents();

describe('UI composition smoke (happy-dom)', () => {
  it('mounts every component, fires keyboard / click / bus events, tears down: no console.error / warn, no exceptions', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {}), warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ui = document.createElement('div'); ui.id = 'ui'; document.body.append(ui);
    const bus = new EventBus<GameEvents>();
    const top = el('st-topbar'), hud = el('st-hud'), help = el('st-help');
    top.bind({ rotate: () => {}, help: () => help.toggle(), menu: () => {} });
    hud.bind(bus, () => 100);
    const rest = ALL_COMPONENT_TAGS.filter((t) => !['st-topbar', 'st-hud', 'st-help'].includes(t)).map((t) => el(t));
    ui.append(top, hud, help, ...rest);
    for (const k of ['Escape', '?', 'h', 'g', 'o', ' ', '1', 'F3']) window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    for (const b of ui.querySelectorAll('button')) b.dispatchEvent(new Event('click'));
    for (const e of [top, hud, help, ...rest]) for (const b of (e as unknown as { root: ShadowRoot }).root.querySelectorAll('button')) b.dispatchEvent(new Event('click'));
    bus.emit('money:changed', { money: 5, delta: 5, reason: 'earn', category: 'x' });
    ui.remove();
    expect(err).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
    err.mockRestore(); warn.mockRestore();
  });
});
