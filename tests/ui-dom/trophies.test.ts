// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { el, registerComponents } from '../../src/ui';
import { modalStack } from '../../src/ui/modal';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { ProfileStore } from '../../src/persist/ProfileStore';
import { ACHIEVEMENTS } from '../../src/config/achievements';
import { COSMETICS } from '../../src/config/cosmetics';
import { cosmeticsApiFromProfile, trophiesApiFromProfile, trophySummary } from '../../src/ui/trophyData';
import { mountMainMenu } from '../../src/ui/menuHost';
import { MemStorage } from '../audio/fakeBackend';
import { StToast } from '../../src/ui/components/StToast';

registerComponents();
const q = (e: HTMLElement, sel: string): HTMLElement[] => Array.from(e.shadowRoot!.querySelectorAll<HTMLElement>(sel));
const mem = () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
afterEach(() => { modalStack.clear(); localStorage.clear(); document.body.replaceChildren(); });

async function profileWith(unlocked: string[] = [], counters: Record<string, number> = {}, owned: string[] = []): Promise<ProfileStore> {
  const s = new ProfileStore(new IDBFactory(), mem());
  await s.update((p) => { for (const id of unlocked) p.achievements.unlocked[id] = { at: 1_700_000_000_000 + (id === 'first-guest' ? 0 : 1000), ...(id === 'first-groom' ? { sandbox: true } : {}) }; p.achievements.counters = counters; p.achievements.cosmetics.owned = owned; });
  return s;
}

describe('st-trophies (trophy shelf)', () => {
  it('constructor adds no attributes / children; closed = no open layer, a 0x0 host, no pointer events', () => {
    const e = document.createElement('st-trophies');
    expect(e.attributes.length).toBe(0); expect(e.childNodes.length).toBe(0);
    document.body.append(e); e.remove(); document.body.append(e); e.remove();
    const x = el('st-trophies'); document.body.append(x);
    expect(q(x, '.layer.open').length).toBe(0);
    const sheets = (x.shadowRoot as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
    const css = [...sheets.flatMap((sh) => Array.from(sh.cssRules).map((r) => r.cssText)), ...Array.from(x.shadowRoot!.querySelectorAll('style')).map((s) => s.textContent ?? '')].join('\n').replace(/\s+/g, '');
    expect(css).toMatch(/:host\{display:block;width:0(px)?;height:0(px)?;?\}/); expect(css).toMatch(/\.layer\{display:none;/);
    expect(x.hasAttribute('open')).toBe(false);
  });

  it('shows the summary, scenario medals, one card per achievement; hidden ones read ??? until unlocked; counters show a progress bar', async () => {
    const profile = await profileWith(['first-guest', 'first-groom', 'bear-necessities'], { guests: 400 });
    const e = el('st-trophies'); document.body.append(e);
    e.bind(trophiesApiFromProfile(profile)); e.open();
    expect(e.isOpen).toBe(true); expect(modalStack.dialogs).toBe(1); expect(e.hasAttribute('open')).toBe(true);
    expect(q(e, '.sum .big')[0]!.textContent).toBe('3 / 48');
    expect(q(e, '.card').length).toBe(48);
    expect(q(e, '[data-row="medals"] .med').length).toBe(6);
    const got = q(e, '.card[data-state="unlocked"]'); expect(got.length).toBe(3);
    const guests = q(e, '[data-ach="guests-1000"]')[0]!;
    expect(guests.querySelector('[role="progressbar"]')).toBeTruthy(); expect(guests.textContent).toContain('400 / 1,000');
    expect(q(e, '[data-ach="first-groom"]')[0]!.textContent).toContain('Sandbox');
    expect(q(e, '[data-ach="first-guest"]')[0]!.textContent).toMatch(/Unlocked/);
    // hidden: ??? while locked, real title once unlocked
    const hidden = ACHIEVEMENTS.find((a) => a.hidden && a.id !== 'bear-necessities')!;
    expect(q(e, `[data-ach="${hidden.id}"]`)[0]!.textContent).toContain('???'); expect(q(e, `[data-ach="${hidden.id}"]`)[0]!.textContent).not.toContain(hidden.title);
    expect(q(e, '[data-ach="bear-necessities"]')[0]!.textContent).toContain('Bear necessities');
    e.close(); expect(modalStack.dialogs).toBe(0); expect(e.hasAttribute('open')).toBe(false);
  });

  it('filters: unlocked / locked / tier', async () => {
    const profile = await profileWith(['first-guest', 'four-stars']);
    const e = el('st-trophies'); document.body.append(e); e.bind(trophiesApiFromProfile(profile)); e.open();
    const click = (filter: string, value: string): void => { (q(e, `[data-filter="${filter}"] button[data-value="${value}"]`)[0] as HTMLButtonElement).click(); };
    click('show', 'unlocked'); expect(q(e, '.card').length).toBe(2);
    click('show', 'locked'); expect(q(e, '.card').length).toBe(46);
    click('show', 'all'); click('tier', '3'); expect(q(e, '.card').length).toBe(ACHIEVEMENTS.filter((a) => a.tier === 3).length);
    click('show', 'unlocked'); expect(q(e, '.card').length).toBe(0); expect(q(e, '.empty').length).toBe(1);
    click('tier', '2'); expect(q(e, '.card').length).toBe(1);
  });

  it('updates live while open (a new unlock appears) and offers no import / export / share control', async () => {
    const profile = await profileWith([]);
    const e = el('st-trophies'); document.body.append(e); e.bind(trophiesApiFromProfile(profile)); e.open();
    expect(q(e, '.sum .big')[0]!.textContent).toBe('0 / 48');
    await profile.update((p) => { p.achievements.unlocked['first-guest'] = { at: 5 }; });
    expect(q(e, '.sum .big')[0]!.textContent).toBe('1 / 48');
    const text = e.shadowRoot!.textContent ?? '';
    expect(/\b(share|import|export|copy link|upload)\b/i.test(text)).toBe(false);
    expect(e.shadowRoot!.querySelector('input[type="file"], a[download]')).toBeNull();
    expect(trophySummary(['roy-gold']).points).toBe(5);
  });

  it('is reachable from the main menu (Trophies) and the pause menu', async () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const profile = await profileWith([]);
    const h = mountMainMenu({ ui, saves: null, go: () => {}, version: 't', profile, storage: new MemStorage() as unknown as Storage });
    const btn = [...h.menu.shadowRoot!.querySelectorAll('button')].find((b) => b.textContent?.includes('Trophies'))!;
    expect(btn).toBeTruthy(); (btn as HTMLButtonElement).click();
    expect(h.trophies.isOpen).toBe(true); h.trophies.close();
    const p = el('st-pause-menu'); document.body.append(p);
    let n = 0; p.bind({ save() {}, load() {}, settings() {}, help() {}, mainMenu() {}, trophies: () => { n++; } });
    p.open(); ([...p.shadowRoot!.querySelectorAll('button')].find((b) => b.textContent?.includes('Trophies')) as HTMLButtonElement).click(); expect(n).toBe(1);
    h.dispose();
  });
});

describe('quiet achievement toast', () => {
  it('renders a small iconed toast (class ach) through the toast limiter', () => {
    const t = new StToast(); document.body.append(t);
    t.show('Achievement unlocked: First lift opened', 'info', 5000, { key: 'ach:first-lift', category: 'achievement', icon: 'lift', ttlMs: 5000 });
    const row = t.shadowRoot!.querySelector('.t')!;
    expect(row.classList.contains('ach')).toBe(true); expect(row.querySelector('svg')).toBeTruthy(); expect(row.textContent).toContain('First lift opened');
  });
});

describe('st-settings: cosmetics + reset profile', () => {
  const bindSettings = async (owned: string[], onSelect: (k: string, id: string) => boolean = () => true, reset: () => void = () => {}) => {
    const profile = await profileWith([], {}, owned);
    const e = el('st-settings'); document.body.append(e);
    e.bind(new AudioSettings(new MemStorage()), null, [], { profile: { cosmetics: cosmeticsApiFromProfile(profile, onSelect as never), reset } });
    e.open();
    return e;
  };
  it('hidden without a profile; with one it lists every cosmetic, locked ones show the lock and how to unlock', async () => {
    const plain = el('st-settings'); document.body.append(plain); plain.bind(new AudioSettings(new MemStorage())); plain.open();
    expect(q(plain, '[data-section="cosmetics"]')[0]!.hidden).toBe(true);
    plain.remove();
    const e = await bindSettings(['chair:blue']);
    expect(q(e, '[data-section="cosmetics"]')[0]!.hidden).toBe(false);
    expect(q(e, 'button.tile').length).toBe(COSMETICS.length);
    const blue = q(e, '[data-cosmetic="chair:blue"]')[0] as HTMLButtonElement, yellow = q(e, '[data-cosmetic="chair:yellow"]')[0] as HTMLButtonElement;
    expect(blue.disabled).toBe(false); expect(yellow.disabled).toBe(true);
    expect(yellow.textContent).toContain('Unlock: Mountain rescue');
    expect((q(e, '[data-cosmetic="chair:red"]')[0] as HTMLButtonElement).classList.contains('sel')).toBe(true); // default selected
    expect(q(e, '[data-cosmetic="palette:classic"]')[0]!.getAttribute('aria-pressed')).toBe('true');
  });
  it('choosing an owned tile calls the host; locked tiles do nothing', async () => {
    const calls: string[] = [];
    const e = await bindSettings(['frame:noir'], (k, id) => { calls.push(`${k}=${id}`); return true; });
    (q(e, '[data-cosmetic="frame:noir"]')[0] as HTMLButtonElement).click();
    (q(e, '[data-cosmetic="frame:gold"]')[0] as HTMLButtonElement).click();
    expect(calls).toEqual(['frame=frame:noir']);
  });
  it('Reset profile asks first: Keep does nothing, Reset calls the host once', async () => {
    let resets = 0;
    const e = await bindSettings([], undefined, () => { resets++; });
    (q(e, '[data-action="reset-profile"]')[0] as HTMLButtonElement).click();
    expect(modalStack.dialogs).toBe(2);
    (q(e, '[data-action="reset-cancel"]')[0] as HTMLButtonElement).click();
    expect(resets).toBe(0); expect(modalStack.dialogs).toBe(1);
    (q(e, '[data-action="reset-profile"]')[0] as HTMLButtonElement).click();
    (q(e, '[data-action="reset-confirm"]')[0] as HTMLButtonElement).click();
    expect(resets).toBe(1);
    e.close(); expect(modalStack.dialogs).toBe(0);
  });
});
