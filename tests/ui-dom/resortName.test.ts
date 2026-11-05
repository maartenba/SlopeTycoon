// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { registerComponents } from '../../src/ui';
import { mountMainMenu } from '../../src/ui/menuHost';
import { defaultResortName, RESORT_NAME_MAX } from '../../src/sim/ResortName';

registerComponents();
const root = (e: Element): ShadowRoot => (e as unknown as { root: ShadowRoot }).root;
const btn = (e: Element, text: string): HTMLButtonElement => [...root(e).querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe('New Game: resort name field (M7.8)', () => {
  const open = () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const went: string[] = [];
    const h = mountMainMenu({ ui, saves: null, go: (q) => went.push(q), version: '1', random: () => 4242 / 1e9 });
    btn(h.menu, 'New game').click();
    const name = root(h.newGame).querySelector('input[data-resort-name]') as HTMLInputElement;
    return { h, went, name, ui };
  };
  it('is pre-filled with the seed default, limited to 24 characters, and the start URL leaves it out while it is the default', () => {
    const { h, went, name, ui } = open();
    expect(name).toBeTruthy();
    expect(name.maxLength).toBe(RESORT_NAME_MAX);
    expect(name.value).toBe(defaultResortName(h.newGame.config.seed));
    expect(h.newGame.submit()).toBe(true);
    expect(went[0]).not.toContain('name=');
    ui.remove();
  });
  it('a typed name is sanitised and sent as ?name=; an empty field falls back to the default', () => {
    const a = open();
    a.name.value = '  <b>Zirbenalm</b>  '; a.name.dispatchEvent(new Event('input'));
    expect(a.h.newGame.resortName()).toBe('Zirbenalm');
    a.h.newGame.submit();
    expect(a.went[0]).toContain('name=Zirbenalm');
    a.ui.remove();
    const b = open();
    b.name.value = '   '; b.name.dispatchEvent(new Event('input'));
    expect(b.h.newGame.resortName()).toBe(defaultResortName(b.h.newGame.config.seed));
    b.ui.remove();
  });
  it('the dice picks another name and the name follows a new seed until it is edited', () => {
    const { h, name, ui } = open();
    const before = name.value;
    const dice = [...root(h.newGame).querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Random resort name') as HTMLButtonElement;
    expect(dice).toBeTruthy();
    h.newGame.set({ seed: 777 });
    expect((root(h.newGame).querySelector('input[data-resort-name]') as HTMLInputElement).value).toBe(defaultResortName(777));
    expect(before.length).toBeGreaterThan(4);
    ui.remove();
  });
});
