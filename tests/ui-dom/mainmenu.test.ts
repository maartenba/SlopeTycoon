// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents, ALL_COMPONENT_TAGS } from '../../src/ui';
import { mountMainMenu } from '../../src/ui/menuHost';
import { SIZE_HINTS } from '../../src/ui/components/StNewGame';
import { PANELS } from '../../src/ui/layout';
import { installErrorBoundary } from '../../src/ui/errorBoundary';
import { parseConfig, seedName } from '../../src/game/difficulty';

registerComponents();
const root = (e: Element): ShadowRoot => (e as unknown as { root: ShadowRoot }).root;
const btn = (e: Element, text: string): HTMLButtonElement => [...root(e).querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

/** Every element in `ui` that is full-screen AND would take pointer events: the menu's overlays are the only legal ones, and only while open. */
function blockers(ui: HTMLElement): string[] {
  return [...ui.children].filter((c) => {
    const tag = c.tagName.toLowerCase();
    return ['st-main-menu', 'st-new-game', 'st-pause-menu', 'st-save-load'].includes(tag) && (tag === 'st-main-menu' ? !(c as HTMLElement).hidden : c.hasAttribute('open'));
  }).map((c) => c.tagName.toLowerCase());
}

describe('main menu + new game dialog', () => {
  it('constructors add no attributes / children; connect / disconnect are safe', () => {
    for (const tag of ['st-main-menu', 'st-new-game', 'st-pause-menu'] as const) {
      const e = document.createElement(tag);
      expect(e.attributes.length, tag).toBe(0); expect(e.childNodes.length, tag).toBe(0);
      document.body.append(e); e.remove(); document.body.append(e); e.remove();
    }
    for (const p of PANELS) if (!p.tag.startsWith('#')) expect(ALL_COMPONENT_TAGS as string[], p.tag).toContain(p.tag);
  });

  it('menu lists every entry; Continue is disabled with a hint when there is no save', async () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const went: string[] = [];
    const h = mountMainMenu({ ui, saves: null, go: (q) => went.push(q), version: '9.9.9' });
    await Promise.resolve(); await Promise.resolve();
    const text = root(h.menu).textContent ?? '';
    for (const t of ['Continue', 'New game', 'Tutorial', 'Settings', 'Help & keys', 'About', 'v9.9.9', 'procedural everything']) expect(text, t).toContain(t);
    expect(btn(h.menu, 'Continue').disabled).toBe(true);
    expect(text).toContain('No saved game yet');
    btn(h.menu, 'Tutorial').click();
    expect(went).toEqual(['tutorial=1']);
    h.menu.setContinue(true); expect(btn(h.menu, 'Continue').disabled).toBe(false);
    btn(h.menu, 'Continue').click(); expect(went[1]).toBe('continue=1');
    h.menu.setOffline(true); h.menu.setInstall(() => {});
    expect(root(h.menu).querySelector('.offline')!.hasAttribute('hidden')).toBe(false);
    btn(h.menu, 'About').click(); expect(h.menu.aboutOpen).toBe(true); btn(h.menu, 'Close').click(); expect(h.menu.aboutOpen).toBe(false);
    h.dispose(); ui.remove();
  });

  it('New Game dialog: per-size hints, seed names, presets; Start goes through the URL boot path; no blocking overlay remains', () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const went: string[] = [];
    const h = mountMainMenu({ ui, saves: null, go: (q) => went.push(q), version: '1', random: () => 1234.5 / 1e9 });
    expect(blockers(ui)).toEqual(['st-main-menu']); // the title screen is the only thing covering the page, by design
    btn(h.menu, 'New game').click();
    expect(h.newGame.isOpen).toBe(true);
    const t = root(h.newGame).textContent ?? '';
    for (const k of [64, 128, 256]) expect(SIZE_HINTS[k]).toBeTruthy();
    expect(t).toContain(SIZE_HINTS[128]);
    expect((root(h.newGame).querySelector('input[type=text]') as HTMLInputElement).value).toBe(seedName(1234)); // a fresh random seed, shown by its readable name
    const presetLabels = [...root(h.newGame).querySelectorAll('st-select')].flatMap((e) => (e as unknown as { options: Array<{ label: string }> }).options.map((o) => o.label)).join('|');
    expect(presetLabels).toContain('Gentle valleys'); expect(presetLabels).toContain('Lakeland');
    expect(root(h.newGame).querySelectorAll('select').length).toBe(0); // no native selects: themed st-select everywhere
    h.newGame.set({ size: 256, preset: 'lakeland', difficulty: 'challenging', startSeason: 'summer' });
    expect(root(h.newGame).textContent).toContain(SIZE_HINTS[256]);
    expect(h.newGame.submit()).toBe(true);
    expect(went).toHaveLength(1);
    const back = parseConfig(new URLSearchParams(went[0]!)).config;
    expect(back).toMatchObject({ size: 256, seed: 1234, preset: 'lakeland', difficulty: 'challenging', startSeason: 'summer' });
    // after Start the host reloads; in this test (no reload) tearing the menu down must leave NOTHING blocking
    h.dispose();
    expect(blockers(ui)).toEqual([]);
    expect(ui.children.length).toBe(0);
    ui.remove();
  });

  it('invalid seed is rejected with a message and nothing starts', () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const went: string[] = [];
    const h = mountMainMenu({ ui, saves: null, go: (q) => went.push(q), version: '1' });
    h.newGame.open();
    const inp = root(h.newGame).querySelector('input[type=text]') as HTMLInputElement;
    inp.value = '   ';
    expect(h.newGame.submit()).toBe(false);
    expect(went).toEqual([]);
    expect(root(h.newGame).querySelector('.err')!.textContent).toContain('seed');
    h.newGame.close(); expect(h.newGame.isOpen).toBe(false);
    h.newGame.randomSeed(); expect(h.newGame.config.seed).toBeGreaterThanOrEqual(0);
    h.dispose(); ui.remove();
  });

  it('pause menu: closed = no open attribute; open / close; actions fire', () => {
    const p = el('st-pause-menu'); document.body.append(p);
    const calls: string[] = [];
    p.bind({ resume: () => calls.push('resume'), save: () => calls.push('save'), load: () => calls.push('load'), settings: () => calls.push('settings'), help: () => calls.push('help'), mainMenu: () => calls.push('menu') });
    expect(p.isOpen).toBe(false);
    p.open(); expect(p.isOpen).toBe(true);
    btn(p, 'Main menu').click(); expect(p.isOpen).toBe(false); expect(calls).toEqual(['menu']);
    p.toggle(); btn(p, 'Save').click(); expect(calls).toEqual(['menu', 'save']);
    p.remove();
  });
});

describe('error boundary', () => {
  it('reports each distinct error once with a Copy details action and never throws', () => {
    const l = new Map<string, (e: unknown) => void>();
    const host = { addEventListener: (t: string, f: (e: unknown) => void) => { l.set(t, f); }, removeEventListener: (t: string) => { l.delete(t); } };
    const toasts: string[] = []; const logged: unknown[][] = []; let copied = '';
    const off = installErrorBoundary(host, { notify: (t, a) => { toasts.push(t); a.run(); }, copy: (t) => { copied = t; }, log: (...a) => { logged.push(a); } });
    l.get('error')!({ error: new Error('boom') }); l.get('error')!({ error: new Error('boom') });
    l.get('unhandledrejection')!({ reason: 'nope' });
    expect(toasts).toHaveLength(2); expect(logged).toHaveLength(2); expect(copied).toContain('nope');
    off(); expect(l.size).toBe(0);
  });
});
