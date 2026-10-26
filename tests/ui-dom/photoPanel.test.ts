// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { DEFAULT_PHOTO_SETTINGS, sanitizeSettings, type PhotoSettings } from '../../src/render/view/PhotoMode';
import type { PhotoPanelApi } from '../../src/ui/components/StPhoto';

registerComponents();
const q = (e: HTMLElement, sel: string): HTMLElement | null => e.shadowRoot!.querySelector(sel);
const qa = (e: HTMLElement, sel: string): HTMLElement[] => Array.from(e.shadowRoot!.querySelectorAll(sel));

function mk(over: Partial<PhotoPanelApi> = {}): { p: ReturnType<typeof el<'st-photo'>>; s: { v: PhotoSettings }; calls: string[] } {
  const s = { v: { ...DEFAULT_PHOTO_SETTINGS } }, calls: string[] = [];
  const api: PhotoPanelApi = {
    settings: () => s.v, set: (p) => { s.v = sanitizeSettings(s.v, p); calls.push(`set:${JSON.stringify(p)}`); }, hourNow: () => 14.5,
    hero: () => calls.push('hero'), canFollow: () => false, following: () => false, follow: () => calls.push('follow'),
    save: async () => { calls.push('save'); }, exit: () => calls.push('exit'),
    gallery: { available: true, list: async () => [], saveAgain: async () => {}, full: async () => null, remove: async () => {}, clear: async () => {} },
    ...over,
  };
  const p = el('st-photo'); document.body.append(p); p.bind(api);
  return { p, s, calls };
}

describe('st-photo', () => {
  it('constructor rules: createElement adds no attributes or children', () => {
    const e = document.createElement('st-photo'); expect(e.attributes.length).toBe(0); expect(e.childNodes.length).toBe(0);
  });
  it('is hidden (host + card + preview layer) until opened: nothing can intercept pointer events when closed', () => {
    const { p } = mk();
    expect(p.hidden).toBe(true); expect(p.visible).toBe(false);
    expect((q(p, '.card') as HTMLElement).hidden).toBe(true); expect((q(p, '.stage') as HTMLElement).hidden).toBe(true);
    const css = p.shadowRoot!.querySelector('style')?.textContent ?? p.shadowRoot!.adoptedStyleSheets?.map((s) => Array.from(s.cssRules).map((r) => r.cssText).join('')).join('') ?? '';
    expect(css).toMatch(/:host \{[^}]*width: 0px;[^}]*height: 0px;[^}]*pointer-events: none/); // 0x0 host
    expect(css).toMatch(/\.stage \{[^}]*pointer-events: none/); // preview layer never takes input
    expect(css).toMatch(/\.card \{[^}]*pointer-events: auto/);
    p.remove();
  });
  it('open shows the compact panel; controls: filters, frames, aspects, resolution, FOV 20-90, time, save; the viewer layer is closed', () => {
    const { p } = mk(); p.open();
    expect(p.hidden).toBe(false); expect(p.visible).toBe(true);
    const text = q(p, '.card')!.textContent!;
    for (const t of ['Photo mode', 'Hero shot', 'Field of view', 'Time of day', 'Pause game while composing', 'Show snow / rain', 'None', 'Warm', 'Cool', 'Vivid', 'Mono', 'Vintage', 'Thin border', 'Polaroid', 'Film strip', '16:9', '4:3', '1:1', '9:16', 'Window', '1×', '2×', 'Save photo', 'Exit', 'Gallery']) expect(text, t).toContain(t);
    const fov = qa(p, 'input[type=range]').find((i) => i.getAttribute('aria-label') === 'Field of view') as HTMLInputElement;
    expect(fov.min).toBe('20'); expect(fov.max).toBe('90');
    expect(q(p, '.layer')!.classList.contains('open')).toBe(false);
    p.close(); expect(p.hidden).toBe(true); p.remove();
  });
  it('buttons call the API: filter, frame, aspect, hero, exit, save; active state follows the settings', async () => {
    const { p, calls, s } = mk(); p.open();
    const btn = (label: string): HTMLButtonElement => qa(p, 'button').find((b) => b.textContent!.trim() === label) as HTMLButtonElement;
    btn('Mono').click(); expect(s.v.filter).toBe('mono'); expect(btn('Mono').classList.contains('active')).toBe(true); expect(btn('None').getAttribute('aria-pressed')).toBe('true'.replace('true', 'false'));
    btn('Polaroid').click(); expect(s.v.frame).toBe('polaroid');
    btn('16:9').click(); expect(s.v.aspect).toBe('16:9');
    btn('2×').click(); expect(s.v.scale).toBe(2);
    btn('Hero shot').click(); expect(calls).toContain('hero');
    btn('Follow game clock').click(); expect(s.v.hour).toBeNull();
    (qa(p, 'button').find((b) => b.textContent!.includes('Exit')) as HTMLButtonElement).click(); expect(calls).toContain('exit');
    (qa(p, 'button').find((b) => b.textContent!.includes('Save photo')) as HTMLButtonElement).click();
    await Promise.resolve(); expect(calls).toContain('save');
    p.remove();
  });
  it('collapse hides the controls but keeps the header; the follow-guest button is hidden without a ride target; Esc closes the viewer first', () => {
    const { p } = mk(); p.open();
    p.setCollapsed(true); expect((q(p, '.body') as HTMLElement).hidden).toBe(true); expect(p.isCollapsed).toBe(true);
    expect(q(p, '.hd')).not.toBeNull();
    p.setCollapsed(false);
    const follow = qa(p, 'button').find((b) => b.textContent === 'Follow guest') as HTMLButtonElement; expect(follow.hidden).toBe(true);
    expect(p.escape()).toBe(false);
    p.remove();
  });
  it('every SVG-icon button has an accessible name; no share / copy-link UI', () => {
    const { p } = mk(); p.open();
    for (const b of qa(p, 'button')) expect((b.textContent ?? '').trim() || b.getAttribute('aria-label') || b.title, 'button without name').toBeTruthy();
    expect(q(p, '.card')!.textContent!.toLowerCase()).not.toMatch(/share|copy link|code/);
    p.remove();
  });
  it('gallery tab: empty state, thumbnails grid, delete all asks twice; unavailable IndexedDB is explained', async () => {
    const items = [{ id: 1, createdAt: 1, resort: 'R', w: 4, h: 3, bytes: 3, filter: 'none', frame: 'none', thumb: new Uint8Array([1]), thumbType: 'image/jpeg' }, { id: 2, createdAt: 2, resort: 'R', w: 4, h: 3, bytes: 3, filter: 'none', frame: 'none', thumb: new Uint8Array([1]), thumbType: 'image/jpeg' }];
    let cleared = 0;
    const { p } = mk({ gallery: { available: true, list: async () => items, saveAgain: async () => {}, full: async () => null, remove: async () => {}, clear: async () => { cleared++; } } });
    p.open(); await p.refreshGallery();
    expect(qa(p, '.grid .thumb').length).toBe(2);
    const del = qa(p, 'button').find((b) => b.textContent === 'Delete all') as HTMLButtonElement;
    del.click(); expect(cleared).toBe(0); expect(del.textContent).toContain('Really'); del.click(); expect(cleared).toBe(1);
    p.remove();
    const n = mk({ gallery: { available: false, list: async () => [], saveAgain: async () => {}, full: async () => null, remove: async () => {}, clear: async () => {} } }); n.p.open(); await n.p.refreshGallery();
    expect(q(n.p, '.card')!.textContent).toContain('IndexedDB'); n.p.remove();
  });
  it('cosmetic frames (Alpine badge / Film noir / Gold frame) are listed; locked ones are disabled with the unlock hint and cannot be picked', () => {
    const { p, calls } = mk({ frameLock: (id) => (id === 'gold' ? 'Unlock: Gold standard' : null) }); p.open();
    const btn = (t: string): HTMLButtonElement => qa(p, 'button').find((b) => b.textContent === t) as HTMLButtonElement;
    for (const t of ['Alpine badge', 'Film noir', 'Gold frame']) expect(btn(t), t).toBeTruthy();
    expect(btn('Gold frame').disabled).toBe(true); expect(btn('Gold frame').title).toBe('Unlock: Gold standard');
    btn('Gold frame').click(); expect(calls.some((c) => c.includes('gold'))).toBe(false);
    btn('Film noir').click(); expect(calls.some((c) => c.includes('noir'))).toBe(true);
  });
});
