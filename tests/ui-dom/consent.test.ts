// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { mountMainMenu } from '../../src/ui/menuHost';
import { AudioSettings } from '../../src/audio/AudioSettings';
import type { ConsentUi } from '../../src/analytics/ui';
import type { Consent } from '../../src/analytics/consent';

registerComponents();
const root = (e: Element): ShadowRoot => (e as unknown as { root: ShadowRoot }).root;
const fake = (init: Consent = null, url: string | null = '../privacy/'): ConsentUi & { v: Consent } => {
  const c = { v: init, privacyUrl: url, get: () => c.v, set: (v: 'granted' | 'denied') => { c.v = v; } };
  return c;
};
class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } }
afterEach(() => { document.body.replaceChildren(); });

describe('analytics consent card (title screen)', () => {
  it('constructors stay attribute-free', () => {
    const e = document.createElement('st-main-menu'); expect(e.attributes.length).toBe(0); expect(e.childNodes.length).toBe(0);
    const s = document.createElement('st-settings'); expect(s.attributes.length).toBe(0); expect(s.childNodes.length).toBe(0);
  });
  it('shows once while no choice exists, never blocks the menu, Allow / No thanks store the choice and hide it', () => {
    for (const [sel, want] of [['consent-allow', 'granted'], ['consent-deny', 'denied']] as const) {
      const ui = document.createElement('div'); document.body.append(ui);
      const c = fake(); const h = mountMainMenu({ ui, saves: null, go: () => {}, version: '1', consent: c });
      expect(h.menu.consentVisible).toBe(true);
      const card = root(h.menu).querySelector('.consent') as HTMLElement;
      expect(card.textContent).toContain('anonymous');
      expect((card.querySelector('a[data-privacy-link]') as HTMLAnchorElement).getAttribute('href')).toBe('../privacy/');
      expect(root(h.menu).querySelectorAll('.menu button').length).toBeGreaterThan(3); // the menu itself is untouched
      (card.querySelector(`button[data-action="${sel}"]`) as HTMLButtonElement).click();
      expect(c.v).toBe(want); expect(h.menu.consentVisible).toBe(false);
      h.dispose(); ui.remove();
    }
  });
  it('is not shown once a choice exists, in the running-game menu, or when the host passes no consent', () => {
    for (const [c, running] of [[fake('granted'), false], [fake('denied'), false], [fake(null), true], [undefined, false]] as const) {
      const ui = document.createElement('div'); document.body.append(ui);
      const h = mountMainMenu({ ui, saves: null, go: () => {}, version: '1', consent: c, running: running ? { resume: () => {} } : undefined });
      expect(h.menu.consentVisible).toBe(false); h.dispose(); ui.remove();
    }
  });
  it('no privacy link when the game is standalone (url null)', () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const h = mountMainMenu({ ui, saves: null, go: () => {}, version: '1', consent: fake(null, null) });
    expect(root(h.menu).querySelector('a[data-privacy-link]')).toBeNull(); h.dispose();
  });
  it('About mentions anonymous, opt-in statistics', () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const h = mountMainMenu({ ui, saves: null, go: () => {}, version: '1' });
    expect(root(h.menu).textContent).toMatch(/Anonymous, opt-in statistics/); h.dispose();
  });
});

describe('Settings > Privacy', () => {
  const mk = (c: ReturnType<typeof fake>) => {
    const s = el('st-settings'); document.body.append(s);
    s.bind(new AudioSettings(new Mem()), null, [], { privacy: { get: () => c.get() === 'granted', set: (on) => c.set(on ? 'granted' : 'denied'), url: c.privacyUrl } });
    return s;
  };
  it('toggle is off until granted, writes consent, reflects changes made elsewhere, link present', () => {
    const c = fake(); const s = mk(c); s.open();
    const sec = root(s).querySelector('section[data-section="privacy"]') as HTMLElement;
    expect(sec.hidden).toBe(false);
    const box = sec.querySelector('input[data-opt="analytics"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    box.checked = true; box.dispatchEvent(new Event('change')); expect(c.v).toBe('granted');
    box.checked = false; box.dispatchEvent(new Event('change')); expect(c.v).toBe('denied');
    c.v = 'granted'; s.close(); s.open(); expect(box.checked).toBe(true); // card on the title screen changed it
    expect(sec.textContent).toContain('Share anonymous usage statistics'); expect(sec.textContent).toContain('offline');
    expect(sec.querySelector('a[data-privacy-link]')!.getAttribute('href')).toBe('../privacy/');
  });
  it('hidden without a host API; link hidden when standalone', () => {
    const s = el('st-settings'); document.body.append(s); s.bind(new AudioSettings(new Mem()), null, [], {});
    expect((root(s).querySelector('section[data-section="privacy"]') as HTMLElement).hidden).toBe(true);
    const s2 = mk(fake(null, null)); expect(root(s2).querySelector('a[data-privacy-link]')).toBeNull();
  });
});
