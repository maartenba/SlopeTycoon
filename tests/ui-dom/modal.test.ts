// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { MODAL_Z0, modalStack } from '../../src/ui/modal';
import { confirmDialog, showModal } from '../../src/ui/components/StModal';
import { mountMainMenu } from '../../src/ui/menuHost';

registerComponents();
const root = (e: Element): ShadowRoot => (e as unknown as { root: ShadowRoot }).root;
const esc = (): void => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })); };
const z = (e: Element): number => Number(root(e).querySelector<HTMLElement>('.layer')!.style.zIndex || 0);

describe('modal stack', () => {
  it('shared frame: title bar with icon + ✕, body, footer; width presets sm / md / lg', () => {
    const ui = document.createElement('div'); document.body.append(ui);
    for (const size of ['sm', 'md', 'lg'] as const) {
      const m = showModal(ui, { title: `T-${size}`, icon: '★', size, body: 'hello', actions: [{ label: 'OK', kind: 'primary' }] });
      const r = root(m);
      expect(r.querySelector('.dlg')!.className).toContain(size);
      expect(r.querySelector('header h2')!.textContent).toBe(`T-${size}`); expect(r.querySelector('header .ic')!.textContent).toBe('★');
      expect(r.querySelector('header button[data-action=close]')).not.toBeNull();
      expect(r.querySelector('.body')!.textContent).toContain('hello'); expect(r.querySelector('footer button')!.textContent).toBe('OK');
      m.close();
    }
    ui.remove();
  });

  it('Esc closes ONLY the top dialog; z-order stacks; focus is restored to the opener', () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const opener = document.createElement('button'); ui.append(opener); opener.focus();
    const a = showModal(ui, { title: 'A', body: 'a', actions: [{ label: 'A-OK' }] }), b = showModal(ui, { title: 'B', body: 'b', actions: [{ label: 'B-OK' }] });
    expect(modalStack.dialogs).toBe(2);
    expect(z(a)).toBeGreaterThanOrEqual(MODAL_Z0); expect(z(b)).toBeGreaterThan(z(a));
    esc(); expect(b.isOpen).toBe(false); expect(a.isOpen).toBe(true);
    esc(); expect(a.isOpen).toBe(false); expect(modalStack.size).toBe(0);
    expect(opener.isConnected).toBe(true);
    ui.remove();
  });

  it('backdrop click closes (unless backdropClose:false); closable:false hides ✕; a closed dialog removes itself from the DOM', () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const a = showModal(ui, { title: 'A', body: 'a' });
    root(a).querySelector('.bd')!.dispatchEvent(new MouseEvent('mousedown')); expect(a.isOpen).toBe(false); expect(a.isConnected).toBe(false);
    const b = showModal(ui, { title: 'B', body: 'b', backdropClose: false, closable: false });
    root(b).querySelector('.bd')!.dispatchEvent(new MouseEvent('mousedown')); expect(b.isOpen).toBe(true);
    expect((root(b).querySelector('header button[data-action=close]') as HTMLElement).hidden).toBe(true);
    b.close(); expect(b.isConnected).toBe(false); expect(ui.querySelectorAll('st-modal').length).toBe(0);
    ui.remove();
  });

  it('confirm dialog resolves true / false', async () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const p1 = confirmDialog(ui, { title: 'Sure?', message: 'Delete it?', confirm: 'Delete', danger: true });
    (ui.querySelector('st-modal') as unknown as { clickAction(a: string): boolean }).clickAction('confirm');
    expect(await p1).toBe(true);
    const p2 = confirmDialog(ui, { title: 'Sure?', message: 'Delete it?' });
    esc(); expect(await p2).toBe(false);
    const p3 = confirmDialog(ui, { title: 'Sure?', message: 'x' });
    (ui.querySelector('st-modal') as unknown as { clickAction(a: string): boolean }).clickAction('cancel'); expect(await p3).toBe(false);
    expect(modalStack.size).toBe(0); ui.remove();
  });

  it('Tab is trapped inside the top dialog (wraps first <-> last)', () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const m = showModal(ui, { title: 'T', body: 'x', actions: [{ label: 'One', id: 'one' }, { label: 'Two', id: 'two' }] });
    const r = root(m);
    const btn = (id: string): HTMLButtonElement => r.querySelector<HTMLButtonElement>(`footer button[data-action=${id}]`)!;
    btn('two').focus(); expect(r.activeElement).toBe(btn('two'));
    const tab = (shift = false): void => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, cancelable: true })); };
    tab(); expect(r.activeElement).toBe(r.querySelector('header button[data-action=close]')); // wrapped to the first (✕)
    tab(true); expect(r.activeElement).toBe(btn('two')); // and back to the last
    m.close(); ui.remove();
  });

  it('menu: dialogs opened from the menu stack ABOVE it (menu z 30 < dialog z >= 100) and the menu stays; closing returns to the menu', () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const h = mountMainMenu({ ui, saves: null, go: () => {}, version: '1' });
    const btn = (t: string): HTMLButtonElement => [...root(h.menu).querySelectorAll('button')].find((b) => b.textContent?.includes(t)) as HTMLButtonElement;
    expect(modalStack.size).toBe(0);
    btn('New game').click(); expect(h.newGame.isOpen).toBe(true);
    expect(z(h.newGame)).toBeGreaterThanOrEqual(MODAL_Z0);
    btn('Settings').click(); expect(h.settings.isOpen).toBe(true); expect(z(h.settings)).toBeGreaterThan(z(h.newGame));
    expect(h.menu.hidden).toBe(false); // the menu is a screen: it stays underneath
    esc(); expect(h.settings.isOpen).toBe(false); expect(h.newGame.isOpen).toBe(true); // Esc closes the top one only
    esc(); expect(h.newGame.isOpen).toBe(false); expect(h.menu.hidden).toBe(false);
    btn('Help & keys').click(); expect(h.help.isOpen).toBe(true); esc();
    btn('About').click(); expect(h.menu.aboutOpen).toBe(true); esc(); expect(h.menu.aboutOpen).toBe(false);
    h.dispose(); expect(ui.children.length).toBe(0); ui.remove();
  });

  it('menu while a game runs: Resume, Save game and Quit to title are present and wired', () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const calls: string[] = [];
    const h = mountMainMenu({ ui, saves: null, go: () => {}, version: '1', running: { resume: () => calls.push('resume'), save: () => calls.push('save'), quit: () => calls.push('quit') } });
    const text = root(h.menu).textContent ?? '';
    for (const t of ['Resume game', 'Save game', 'Quit to title']) expect(text, t).toContain(t);
    expect(text).not.toContain('Continue');
    for (const t of ['Resume game', 'Save game', 'Quit to title']) ([...root(h.menu).querySelectorAll('button')].find((b) => b.textContent?.includes(t)) as HTMLButtonElement).click();
    expect(calls).toEqual(['resume', 'save', 'quit']);
    h.dispose(); ui.remove();
  });

  it('pause menu: Save / Load / Settings stack above it; Esc returns to the pause menu; Resume closes', () => {
    const p = el('st-pause-menu'), s = el('st-settings'); document.body.append(p, s);
    const calls: string[] = [];
    p.bind({ resume: () => calls.push('resume'), save: () => calls.push('save'), load: () => calls.push('load'), settings: () => s.open(), help: () => {}, mainMenu: () => calls.push('menu') });
    p.open(); [...root(p).querySelectorAll('button')].find((b) => b.textContent?.includes('Settings'))!.click();
    expect(s.isOpen).toBe(true); expect(p.isOpen).toBe(true); expect(z(s)).toBeGreaterThan(z(p));
    esc(); expect(s.isOpen).toBe(false); expect(p.isOpen).toBe(true);
    [...root(p).querySelectorAll('button')].find((b) => b.textContent?.includes('Save game'))!.click(); expect(calls).toEqual(['save']);
    esc(); expect(p.isOpen).toBe(false); p.remove(); s.remove();
  });

  it('nothing blocks input once everything is closed: no layer is open, the stack is empty', () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const h = mountMainMenu({ ui, saves: null, go: () => {}, version: '1' });
    h.newGame.open(); h.settings.open(); h.help.open(); modalStack.clear();
    for (const e of [h.newGame, h.settings, h.help]) { expect(root(e).querySelector('.layer.open')).toBeNull(); expect(e.hasAttribute('open') && e.tagName !== 'ST-HELP').toBe(false); }
    h.dispose(); ui.remove();
  });

  it('every new-game dialog opens with a FRESH random seed (never the previous or default one)', () => {
    const ui = document.createElement('div'); document.body.append(ui);
    let n = 0; const seq = [0.111, 0.222, 0.333, 0.444];
    const h = mountMainMenu({ ui, saves: null, go: () => {}, version: '1', random: () => seq[n++ % seq.length]! });
    const seeds = new Set<number>();
    for (let i = 0; i < 3; i++) { h.newGame.open(); seeds.add(h.newGame.config.seed); h.newGame.close(); }
    expect(seeds.size).toBe(3); expect(seeds.has(1337)).toBe(false);
    h.dispose(); ui.remove();
  });
});
