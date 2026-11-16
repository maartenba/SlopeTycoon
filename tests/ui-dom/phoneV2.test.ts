// @vitest-environment happy-dom
// Mobile UI v2 (docs/mobile-ui-v2.md): speed chip popover, overflow menu contents, tool bar message routing / sparkline / Place state, held toasts, the coordinator.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents, Speed } from '../../src/core/events';
import { installPhoneCards } from '../../src/ui/phoneCards';
import type { StTouchControls } from '../../src/ui/components/StTouchControls';

registerComponents();
afterEach(() => { document.body.replaceChildren(); document.documentElement.removeAttribute('data-toolfirst'); document.documentElement.removeAttribute('data-phone-mode'); document.documentElement.removeAttribute('data-profile-open'); vi.useRealTimers(); vi.unstubAllGlobals(); });
const q = (e: HTMLElement, sel: string): HTMLElement | null => e.shadowRoot!.querySelector(sel);
const qa = (e: HTMLElement, sel: string): HTMLElement[] => [...e.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
const phoneMq = (on: boolean): void => { vi.stubGlobal('matchMedia', (query: string) => ({ matches: on && /max-width: 520px/.test(query), media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })); };

describe('speed chip popover (phones)', () => {
  it('a chip shows the current speed; tapping it opens the popover with pause / 1x / 3x / 10x, a pick closes it', () => {
    const bus = new EventBus<GameEvents>(); const s = { speed: 1 as Speed };
    const h = el('st-speed-control'); document.body.append(h);
    h.bind({ bus, getSpeed: () => s.speed, setSpeed: (v) => { s.speed = v; bus.emit('speed:changed', { speed: v } as never); }, getDate: () => ({ year: 0, day: 3, minute: 600, tick: 0 }) });
    const chip = q(h, '.chipb') as HTMLButtonElement, panel = q(h, '.panel')!;
    expect(chip.textContent).toBe('1×');
    expect(chip.dataset.role).toBe('speed-chip'); expect(chip.getAttribute('aria-expanded')).toBe('false');
    chip.click();
    expect(panel.classList.contains('pop')).toBe(true); expect(chip.getAttribute('aria-expanded')).toBe('true');
    const labels = qa(h, '.btns > button').map((b) => b.getAttribute('aria-label') ?? '');
    expect(labels.length).toBeGreaterThanOrEqual(4);
    (qa(h, '.btns > button')[3] as HTMLButtonElement).click(); // 10x
    expect(s.speed).toBe(3);
    expect(panel.classList.contains('pop')).toBe(false);
    chip.click(); chip.click();
    expect(panel.classList.contains('pop')).toBe(false);
  });
});

describe('overflow menu contents', () => {
  it('lists Rudi\'s tips, News, Photo, Statistics, Save, Settings, Rotate, Walk, Help and calls the handlers; closes after a pick', () => {
    const t = el('st-topbar'); document.body.append(t);
    const calls: string[] = [];
    t.bind({ rotate: (d) => calls.push(`rot${d}`), help: () => calls.push('help'), settings: () => calls.push('settings'), saveLoad: () => calls.push('save'), menu: () => {}, photo: () => calls.push('photo'), stats: () => calls.push('stats'), walk: () => calls.push('walk'), rudi: () => calls.push('rudi'), news: () => calls.push('news'), info: () => ['Sat 14 Feb · Winter · Year 1', 'Clear 2°C'] });
    const panel = q(t, '.panel')!, more = q(t, 'button.more') as HTMLButtonElement;
    more.click();
    const items = qa(t, '.ovf button');
    const texts = items.map((b) => b.textContent ?? '').join('|');
    for (const w of ["Rudi's tips", 'News', 'Photo', 'Statistics', 'Save', 'Settings', 'Rotate left', 'Rotate right', 'Walk', 'Help']) expect(texts, w).toContain(w);
    expect(q(t, '.ovf .info')!.textContent).toContain('Winter'); // date / weather lines (the HUD strip shows only money, stars, guests)
    const rudi = items.find((b) => /Rudi/.test(b.textContent ?? ''))!;
    rudi.click();
    expect(calls).toContain('rudi'); expect(panel.classList.contains('open')).toBe(false);
    more.click(); items.find((b) => /News/.test(b.textContent ?? ''))!.click(); expect(calls).toContain('news');
    for (const b of items) expect(b.getAttribute('role')).toBe('menuitem');
  });
});

function bar(): { b: StTouchControls; calls: string[] } {
  const b = el('st-touch-controls'); document.body.append(b);
  const calls: string[] = [];
  b.bind({ setMode: () => calls.push('mode'), confirm: () => calls.push('confirm'), cancelTool: () => calls.push('cancel'), undo: () => calls.push('undo'), rotateView: () => {}, rotateGhost: (d) => calls.push(`rot${d}`), toggleDrawer: () => calls.push('options') });
  b.setState({ enabled: true });
  return { b, calls };
}
const role = (b: HTMLElement, r: string): HTMLButtonElement => b.shadowRoot!.querySelector(`[data-role=${r}]`) as HTMLButtonElement;

describe('tool bar (phones)', () => {
  it('row B has Cancel, rotate, Undo, Options, Place and they call the handlers', () => {
    const { b, calls } = bar();
    b.setState({ tool: 'placement', kind: 'tap', hint: '$6,030 · tap again to place' });
    for (const r of ['bar-cancel', 'ghost-left', 'bar-undo', 'bar-options', 'place']) expect(role(b, r), r).toBeTruthy();
    role(b, 'bar-undo').click(); role(b, 'bar-options').click(); role(b, 'bar-cancel').click(); role(b, 'place').click(); role(b, 'ghost-left').click();
    expect(calls).toEqual(['undo', 'options', 'cancel', 'confirm', 'rot-1']);
  });
  it('the ONE message routes the first reason; Place is disabled while the line is invalid and enabled for a valid one', () => {
    const { b } = bar();
    b.setState({ tool: 'lift', kind: 'tap', hint: '\u2716 Bottom station cannot be on water' });
    expect(b.message).toContain('cannot be on water'); expect(b.placeDisabled).toBe(true);
    expect(b.shadowRoot!.querySelector('.hint')!.classList.contains('bad')).toBe(true);
    b.setState({ hint: '$48,117 · tap again or ✓ to build' });
    expect(b.placeDisabled).toBe(false);
    expect(b.shadowRoot!.querySelector('.hint')!.classList.contains('bad')).toBe(false);
  });
  it('long details sit behind the i button (one reason in the bar, the rest in a card)', () => {
    const { b } = bar();
    b.setState({ tool: 'lift', kind: 'tap', hint: '\u2716 Top station must be higher than bottom' });
    const info = role(b, 'bar-info'), detail = b.shadowRoot!.querySelector('.detail') as HTMLElement;
    expect(info.hidden).toBe(true);
    b.setDetails([{ kind: 'error', text: 'Top station must be higher than bottom.' }, { kind: 'info', text: 'No lift kind fits this exact line, try another spot.' }, { kind: 'warn', text: 'Not connected: bottom station needs footpath access' }]);
    expect(info.hidden).toBe(false); expect(detail.hidden).toBe(true);
    info.click(); expect(detail.hidden).toBe(false); expect(detail.textContent).toContain('No lift kind fits');
    b.setDetails(null); expect(info.hidden).toBe(true);
  });
  it('a profile event draws a sparkline; tapping it opens the full chart card; clearing the profile closes it', () => {
    const { b } = bar();
    b.setState({ tool: 'lift', kind: 'tap' });
    const spark = role(b, 'bar-profile');
    expect(spark.hidden).toBe(true);
    const samples = [0, 1, 2, 3].map((i) => ({ distM: i * 30, altM: 1500 + i * 12, difficulty: i % 3 }));
    window.dispatchEvent(new CustomEvent('st-profile-view', { detail: { kind: 'lift', title: 'Lift', profile: { samples, lengthM: 90, dropM: 36, avgPct: 40, maxPct: 50 } } }));
    expect(spark.hidden).toBe(false); expect(spark.querySelectorAll('polygon').length).toBe(3); expect(spark.textContent).toContain('90 m');
    spark.click(); expect(document.documentElement.hasAttribute('data-profile-open')).toBe(true);
    window.dispatchEvent(new CustomEvent('st-profile-view', { detail: null }));
    expect(spark.hidden).toBe(true); expect(document.documentElement.hasAttribute('data-profile-open')).toBe(false);
  });
  it('phones show the bar for paint tools too, with the pan / paint toggle and Done; Done cancels the tool', () => {
    const { b, calls } = bar();
    b.setState({ tool: 'piste', kind: 'paint', mode: 'pan' });
    expect((b.shadowRoot!.querySelector('.bar') as HTMLElement).hidden).toBe(false);
    expect(role(b, 'bar-mode').hidden).toBe(false);
    expect(role(b, 'place').dataset.done).toBe('1');
    role(b, 'place').click(); expect(calls).toEqual(['cancel']);
  });
  it('a tool alert (error / critical news while a tool is active) takes the message row for a few seconds', () => {
    vi.useFakeTimers();
    const { b } = bar();
    b.setState({ tool: 'placement', kind: 'tap', hint: '$1,000 · tap again' });
    window.dispatchEvent(new CustomEvent('st-tool-alert', { detail: { text: 'Avalanche danger 4: backcountry closed', kind: 'error' } }));
    expect(b.message).toContain('Avalanche');
    vi.advanceTimersByTime(6100);
    expect(b.message).toContain('$1,000');
  });
});

describe('held toasts (phones, tool active)', () => {
  it('info toasts queue while a tool is active and show one at a time after it ends; errors go to the bar', () => {
    phoneMq(true); vi.useFakeTimers();
    const t = el('st-toast'); document.body.append(t);
    const alerts: string[] = []; window.addEventListener('st-tool-alert', (e) => alerts.push((e as CustomEvent).detail.text));
    document.documentElement.setAttribute('data-toolfirst', '');
    t.show('Snow is coming', 'info'); t.show('Guests arrived', 'info'); t.show('Cannot place here', 'error');
    expect(t.shadowRoot!.querySelectorAll('.t').length).toBe(0);
    expect(alerts).toEqual(['Cannot place here']);
    document.documentElement.removeAttribute('data-toolfirst');
    return Promise.resolve().then(() => Promise.resolve()).then(() => { // MutationObserver microtask
      expect(t.shadowRoot!.querySelectorAll('.t').length).toBe(1);
      vi.advanceTimersByTime(3900);
      expect(t.shadowRoot!.textContent).toContain('Guests arrived');
    });
  });
  it('desktop: toasts are never held', () => {
    phoneMq(false);
    const t = el('st-toast'); document.body.append(t);
    document.documentElement.setAttribute('data-toolfirst', '');
    t.show('Snow is coming', 'info');
    expect(t.shadowRoot!.querySelectorAll('.t').length).toBe(1);
  });
});

describe('phone card coordinator', () => {
  it('derives the mode and closes the other cards when a new one opens (one card at a time)', () => {
    phoneMq(true);
    const state = { a: false, b: false, dialogs: 0 };
    const cards = installPhoneCards({ dialogs: () => state.dialogs });
    const closed: string[] = [];
    cards.register({ id: 'a', isOpen: () => state.a, close: () => { state.a = false; closed.push('a'); } });
    cards.register({ id: 'b', isOpen: () => state.b, close: () => { state.b = false; closed.push('b'); } });
    const root = document.documentElement;
    cards.update(); expect(root.getAttribute('data-phone-mode')).toBe('idle');
    state.a = true; cards.update(); expect(root.getAttribute('data-phone-mode')).toBe('sheet'); expect(cards.open()).toEqual(['a']);
    state.b = true; cards.update(); expect(closed).toEqual(['a']); expect(cards.open()).toEqual(['b']);
    root.setAttribute('data-toolfirst', ''); state.b = false; cards.update(); expect(root.getAttribute('data-phone-mode')).toBe('tool');
    state.dialogs = 1; cards.update(); expect(root.getAttribute('data-phone-mode')).toBe('modal');
    cards.dispose(); expect(root.hasAttribute('data-phone-mode')).toBe(false);
  });
  it('desktop (no phone media): no data-phone-mode at all', () => {
    phoneMq(false);
    const cards = installPhoneCards({ dialogs: () => 0 });
    expect(document.documentElement.hasAttribute('data-phone-mode')).toBe(false);
    cards.dispose();
  });
});

describe('top row fit at 360 px (css contract; the real fit is measured by mobile:audit2)', () => {
  it('the HUD drops the smiley (<= 400 px) and then the guest icon (<= 380 px); the stars stay icons', () => {
    const hud = el('st-hud'); document.body.append(hud);
    const css = [...hud.shadowRoot!.querySelectorAll('style')].map((s) => s.textContent).join('') + ((hud.shadowRoot as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? []).map((s) => [...s.cssRules].map((r) => r.cssText).join('')).join('');
    expect(css).toMatch(/max-width:\s*380px/);
    const rating = el('st-rating'); document.body.append(rating);
    const rcss = [...rating.shadowRoot!.querySelectorAll('style')].map((s) => s.textContent).join('') + ((rating.shadowRoot as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? []).map((s) => [...s.cssRules].map((r) => r.cssText).join('')).join('');
    expect(rcss).toMatch(/max-width:\s*400px/);
  });
});
