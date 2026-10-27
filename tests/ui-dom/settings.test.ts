// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { el, registerComponents } from '../../src/ui';
import { MemStorage } from '../audio/fakeBackend';

registerComponents();

describe('st-settings', () => {
  it('constructs without attributes/children; connects and disconnects', () => {
    const e = document.createElement('st-settings');
    expect(e.attributes.length).toBe(0);
    expect(e.childNodes.length).toBe(0);
    document.body.append(e); e.remove();
  });
  it('slider API drives persisted settings and syncs back', () => {
    const st = new MemStorage(), s = new AudioSettings(st), e = el('st-settings');
    let ran = 0;
    document.body.append(e);
    e.bind(s, { state: 'locked', needsHint: true, onState: () => () => {} }, [{ label: 'x', run: () => { ran++; } }]);
    expect(e.slider('master').value).toBe('70');
    expect(e.slider('music').value).toBe('50');
    e.setVolume('sfx', 0.25);
    expect(s.get().sfx).toBe(0.25);
    expect(JSON.parse(st.m.get('slope.audio.v1')!).sfx).toBe(0.25);
    s.set({ ambience: 0.1 });
    expect(e.slider('ambience').value).toBe('10');
    expect(e.isOpen).toBe(false);
    e.toggle(); expect(e.isOpen).toBe(true);
    e.toggle(false); expect(e.isOpen).toBe(false);
    expect(e.hintVisible).toBe(true); // locked -> 🔇 hint
    s.toggleMute();
    expect(e.hintVisible).toBe(true);
    e.remove();
    const n = (e as unknown as { root: ShadowRoot }).root.querySelectorAll('.links button');
    expect(n.length).toBe(1);
    (n[0] as HTMLButtonElement).click();
    expect(ran).toBe(1);
  });
  it('hint hidden when audio is running and not muted; disconnect unsubscribes', () => {
    const s = new AudioSettings(null), e = el('st-settings');
    document.body.append(e);
    e.bind(s, { state: 'running', needsHint: false, onState: () => () => {} });
    expect(e.hintVisible).toBe(false);
    e.remove();
    s.set({ master: 0.1 });
    expect(e.slider('master').value).toBe('70'); // no longer syncing after disconnect
  });
  it('Accessibility section: Reduced motion toggle + text size slider drive the shared store', async () => {
    const { accessibility, resetAccessibilityForTests, getReducedMotion } = await import('../../src/ui/accessibility');
    resetAccessibilityForTests();
    const a = accessibility(), e = el('st-settings');
    document.body.append(e);
    e.bind(new AudioSettings(null), { state: 'running', needsHint: false, onState: () => () => {} });
    const root = (e as unknown as { root: ShadowRoot }).root;
    const acc = root.querySelector('section[data-section="accessibility"]')!;
    const box = [...acc.querySelectorAll('label.chk')].find((l) => l.textContent === 'Reduced motion')!.querySelector('input') as HTMLInputElement;
    const range = acc.querySelector('[data-row="ui-scale"] input') as HTMLInputElement;
    expect([range.min, range.max]).toEqual(['90', '130']);
    box.checked = true; box.dispatchEvent(new Event('change'));
    expect(getReducedMotion()).toBe(true);
    expect(document.documentElement.hasAttribute('data-reduced-motion')).toBe(true);
    range.value = '130'; range.dispatchEvent(new Event('input'));
    expect(a.get().uiScale).toBe(130);
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.3');
    expect(acc.querySelector('[data-row="ui-scale"] .v')!.textContent).toBe('130%');
    a.set({ uiScale: 100, reducedMotion: false });
    e.remove(); resetAccessibilityForTests();
  });
  it('Gameplay: Feedback intensity select shows the current value (Subtle) and drives the setter', () => {
    let cur = 'subtle'; const set: string[] = [];
    const e = el('st-settings');
    document.body.append(e);
    e.bind(new AudioSettings(null), { state: 'running', needsHint: false, onState: () => () => {} }, [], { feedback: { get: () => cur, set: (v) => { cur = v; set.push(v); }, options: ['off', 'subtle', 'lively'] } });
    const root = (e as unknown as { root: ShadowRoot }).root;
    const row = root.querySelector('section[data-section="gameplay"] [data-row="feedback"]')!;
    expect(row.querySelector('label')!.textContent).toBe('Feedback intensity');
    const sel = row.querySelector('st-select') as unknown as { value: string; dispatchEvent(e: Event): boolean };
    expect(sel.value).toBe('subtle');
    sel.value = 'off'; sel.dispatchEvent(new Event('change'));
    expect(set).toEqual(['off']);
    e.remove();
  });

  it('Gameplay: Month-end summary toggle reflects the setting and drives the setter', () => {
    let on = true; const set: boolean[] = [];
    const e = el('st-settings'); document.body.append(e);
    e.bind(new AudioSettings(null), { state: 'running', needsHint: false, onState: () => () => {} }, [], { monthSummary: { get: () => on, set: (v) => { on = v; set.push(v); } } });
    const root = (e as unknown as { root: ShadowRoot }).root;
    const box = root.querySelector('section[data-section="gameplay"] input[data-opt="monthSummary"]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.parentElement!.textContent).toBe('Month-end summary');
    box.checked = false; box.dispatchEvent(new Event('change'));
    expect(set).toEqual([false]);
    e.remove();
  });

  it('Gameplay: Year-end report toggle (default on) drives the setter', () => {
    let on = true; const set: boolean[] = [];
    const e = el('st-settings'); document.body.append(e);
    e.bind(new AudioSettings(null), { state: 'running', needsHint: false, onState: () => () => {} }, [], { yearReport: { get: () => on, set: (v) => { on = v; set.push(v); } } });
    const root = (e as unknown as { root: ShadowRoot }).root;
    const box = root.querySelector('section[data-section="gameplay"] input[data-opt="yearReport"]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.parentElement!.textContent).toBe('Year-end report');
    box.checked = false; box.dispatchEvent(new Event('change'));
    expect(set).toEqual([false]);
    e.remove();
  });
  it('Music style select: Auto / every track / Off drive the persisted settings; Next track only with a running game', () => {
    const st = new MemStorage(), s = new AudioSettings(st), e = el('st-settings');
    document.body.append(e);
    let next = 0;
    e.bind(s, null, [], { music: { next: () => { next++; }, now: () => 'Starlight' } });
    const root = (e as unknown as { root: ShadowRoot }).root;
    const sel = root.querySelector('[data-row="music-style"] st-select') as unknown as { value: string; setOptions: unknown; options: Array<{ value: string }> } & HTMLElement;
    expect(sel).toBeTruthy(); expect(sel.value).toBe('auto');
    expect(sel.options.length).toBe(11); // Auto + 9 tracks + Off
    s.set({ musicStyle: 'apres' }); expect(sel.value).toBe('apres');
    sel.value = 'off'; sel.dispatchEvent(new Event('change')); expect(s.get().musicOn).toBe(false);
    sel.value = 'starlight'; sel.dispatchEvent(new Event('change'));
    expect(s.get().musicOn).toBe(true); expect(s.get().musicStyle).toBe('starlight');
    const row = root.querySelector('[data-row="music-next"]') as HTMLElement;
    expect(row.hidden).toBe(false);
    (row.querySelector('button') as HTMLButtonElement).click(); expect(next).toBe(1);
    expect(row.textContent).toContain('Now playing: Starlight');
    e.remove();
    const e2 = el('st-settings'); document.body.append(e2); e2.bind(new AudioSettings(new MemStorage()), null, [], null);
    expect(((e2 as unknown as { root: ShadowRoot }).root.querySelector('[data-row="music-next"]') as HTMLElement).hidden).toBe(true);
    e2.remove();
  });
});
