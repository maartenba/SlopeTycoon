// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { mountMainMenu } from '../../src/ui/menuHost';
import { buildUpdateCard } from '../../src/config/whatsNew';
import { modalStack } from '../../src/ui/modal';

registerComponents();
const root = (e: Element): ShadowRoot => (e as unknown as { root: ShadowRoot }).root;
afterEach(() => { document.body.replaceChildren(); });
const E = (v: string, ...h: string[]) => ({ version: v, date: '2026-10-30', highlights: h });

describe('st-whats-new', () => {
  it('update card: new version, highlights, Reload now / Later; Later dismisses and calls back; never opens a modal', () => {
    const c = el('st-whats-new'); document.body.append(c);
    const reload = vi.fn(async () => undefined), later = vi.fn();
    c.showUpdate(buildUpdateCard('0.2.2', [E('0.2.4', 'Sleighs!', 'Snow'), E('0.2.3', 'Toilets')]), { reload, later });
    const r = root(c); expect(c.showing).toBe(true); expect(c.currentMode).toBe('update');
    expect(r.querySelector('h3')!.textContent).toBe('A new version is available: 0.2.4');
    expect([...r.querySelectorAll('li')].map((l) => l.textContent)).toEqual(['Sleighs!', 'Snow', 'Toilets']);
    expect(modalStack.size).toBe(0);
    (r.querySelector('button.reload') as HTMLButtonElement).click(); expect(reload).toHaveBeenCalledTimes(1);
    (r.querySelector('button.later') as HTMLButtonElement).click(); expect(later).toHaveBeenCalledTimes(1); expect(c.showing).toBe(false);
  });
  it('offline fallback text', () => {
    const c = el('st-whats-new'); document.body.append(c);
    c.showUpdate(buildUpdateCard('0.2.2', null), { reload: () => undefined, later: () => undefined });
    expect(root(c).querySelector('h3')!.textContent).toBe('A new version is ready'); expect(root(c).querySelectorAll('li').length).toBe(0);
  });
  it('what\'s-new card: heading, bullets, changelog link only when given, Close dismisses', () => {
    const c = el('st-whats-new'); document.body.append(c); const closed = vi.fn();
    c.showWhatsNew([E('0.2.4', 'A')], 'https://example.test/c', closed);
    const r = root(c); expect(r.querySelector('h3')!.textContent).toContain('0.2.4'); expect((r.querySelector('a[data-changelog-link]') as HTMLAnchorElement).href).toBe('https://example.test/c');
    (r.querySelector('button.close-btn') as HTMLButtonElement).click(); expect(c.showing).toBe(false); expect(closed).toHaveBeenCalled();
    c.showWhatsNew([E('0.2.4', 'A')], null); expect(root(c).querySelector('a')).toBeNull();
    c.dismiss(); c.showWhatsNew([], null); expect(c.showing).toBe(false);
  });
  it('the host never takes pointer events (non-blocking)', () => {
    const c = el('st-whats-new'); document.body.append(c);
    const css = (root(c).querySelector('style')?.textContent ?? '') + ((root(c) as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? []).map((s) => [...s.cssRules].map((x) => x.cssText).join('')).join('');
    expect(css.includes('top: 86px; width: 320px; pointer-events: none')).toBe(true);
  });
});
describe('About dialog: What\'s new', () => {
  it('has a What\'s new button that reveals the newest bundled highlights', () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const h = mountMainMenu({ ui, saves: null, go: () => {}, version: '0.2.3', consent: undefined as never });
    h.menu.showAbout(true);
    const b = root(h.menu).querySelector('.wn-about button') as HTMLButtonElement; expect(b.textContent).toContain('What');
    const body = root(h.menu).querySelector('.wn-about div') as HTMLElement; expect(body.hidden).toBe(true);
    b.click(); expect(body.hidden).toBe(false); expect(body.querySelectorAll('li').length).toBeGreaterThanOrEqual(3);
  });
});
