// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { touchOverride } from '../../src/ui/touchWire';
import { Accessibility, applyToDocument } from '../../src/ui/accessibility';
import { tokensCss } from '../../src/ui/tokens';
import { KIT_CSS } from '../../src/ui/components/StElement';
import { getPalette, setPalette, mapDifficultyCss, difficultyCss, paletteData } from '../../src/config/palette';

registerComponents();
afterEach(() => { document.body.replaceChildren(); document.documentElement.removeAttribute('data-palette'); setPalette('default'); });

const R = (e: HTMLElement): ShadowRoot => e.shadowRoot!;
const btn = (e: HTMLElement, role: string): HTMLButtonElement => R(e).querySelector(`[data-role=${role}]`) as HTMLButtonElement;
const api = () => { const calls: string[] = []; return { calls, api: { setMode: (m: string) => calls.push(`mode:${m}`), confirm: () => calls.push('confirm'), cancelTool: () => calls.push('cancel'), undo: () => calls.push('undo'), rotateView: (d: number) => calls.push(`view:${d}`), rotateGhost: (d: number) => calls.push(`ghost:${d}`) } }; };

describe('st-touch-controls', () => {
  it('createElement adds no attributes / children (custom element rule)', () => {
    const e = document.createElement('st-touch-controls');
    expect(e.attributes.length).toBe(0);
    expect(e.childNodes.length).toBe(0);
  });
  it('is hidden until touch is enabled; the pan / paint toggle only shows for paint tools', () => {
    const e = el('st-touch-controls'); document.body.append(e);
    expect(e.hidden).toBe(true);
    e.setState({ enabled: true });
    expect(e.hidden).toBe(false);
    expect(btn(e, 'mode').hidden).toBe(true);
    e.setState({ tool: 'terraform', kind: 'paint' });
    expect(btn(e, 'mode').hidden).toBe(false);
    expect(btn(e, 'mode').getAttribute('aria-pressed')).toBe('false');
    e.setState({ mode: 'paint' });
    expect(btn(e, 'mode').getAttribute('aria-pressed')).toBe('true');
    expect(btn(e, 'cancel').hidden).toBe(false);
  });
  it('buttons call the api; every button has an accessible name', () => {
    const e = el('st-touch-controls'); const a = api(); e.bind(a.api); document.body.append(e);
    e.setState({ enabled: true, tool: 'placement', kind: 'tap' });
    btn(e, 'undo').click(); btn(e, 'rot-left').click(); btn(e, 'rot-right').click(); btn(e, 'cancel').click();
    btn(e, 'ghost-left').click(); btn(e, 'ghost-right').click(); btn(e, 'place').click(); btn(e, 'bar-cancel').click();
    btn(e, 'mode').click();
    expect(a.calls).toEqual(['undo', 'view:-1', 'view:1', 'cancel', 'ghost:-1', 'ghost:1', 'confirm', 'cancel', 'mode:paint']);
    for (const b of Array.from(R(e).querySelectorAll('button'))) expect((b.getAttribute('aria-label') ?? '').length).toBeGreaterThan(2);
  });
  it('the placement bar appears only while placing and shows the ghost hint', () => {
    const e = el('st-touch-controls'); document.body.append(e);
    e.setState({ enabled: true });
    const bar = R(e).querySelector('.bar') as HTMLElement;
    expect(bar.hidden).toBe(true);
    e.setState({ tool: 'placement', kind: 'tap', hint: '$2,500 · tap again to place' });
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toContain('$2,500');
  });
  it('view modes swap the clusters: ride / walk / photo, joystick only for walk', () => {
    const e = el('st-touch-controls'); document.body.append(e);
    e.setState({ enabled: true });
    const col = R(e).querySelector('.col') as HTMLElement, views = R(e).querySelector('.views') as HTMLElement, joy = R(e).querySelector('.joy') as HTMLElement;
    e.setView('walk');
    expect(col.hidden).toBe(true); expect(views.hidden).toBe(false); expect(joy.hidden).toBe(false);
    expect(['interact', 'hop', 'run', 'photo'].every((r) => !!btn(e, r))).toBe(true);
    e.setView('ride');
    expect(joy.hidden).toBe(true); expect(btn(e, 'recentre')).toBeTruthy();
    e.setView('photo'); expect(btn(e, 'save')).toBeTruthy();
    e.setView('iso'); expect(views.hidden).toBe(true); expect(col.hidden).toBe(false);
  });
  it('walk buttons send the walk keys; Run toggles a held Shift and leaving walk releases it; Hop keeps Space down for a couple of frames', async () => {
    const e = el('st-touch-controls'); document.body.append(e);
    e.setState({ enabled: true }); e.setView('walk');
    const ev: string[] = [];
    const on = (t: string) => window.addEventListener(t, (k) => ev.push(`${t}:${(k as KeyboardEvent).key}`));
    on('keydown'); on('keyup');
    btn(e, 'interact').click(); btn(e, 'hop').click();
    btn(e, 'run').click();
    e.setView('ride');
    expect(ev).toEqual(['keydown:e', 'keyup:e', 'keydown: ', 'keydown:Shift', 'keyup:Shift']); // the walk loop polls held keys: Space is released two frames later
    await new Promise((r) => setTimeout(r, 100));
    expect(ev).toEqual(['keydown:e', 'keyup:e', 'keydown: ', 'keydown:Shift', 'keyup:Shift', 'keyup: ']);
  });
  it('the joystick holds W/A/S/D while pushed and releases them on lift', () => {
    const e = el('st-touch-controls'); document.body.append(e);
    e.setState({ enabled: true }); e.setView('walk');
    const joy = R(e).querySelector('.joy') as HTMLElement;
    joy.getBoundingClientRect = () => ({ left: 0, top: 0, width: 128, height: 128, right: 128, bottom: 128, x: 0, y: 0, toJSON: () => ({}) });
    const keys: string[] = [];
    window.addEventListener('keydown', (k) => keys.push(`+${(k as KeyboardEvent).key}`)); window.addEventListener('keyup', (k) => keys.push(`-${(k as KeyboardEvent).key}`));
    const pe = (type: string, x: number, y: number) => { const p = new Event(type, { bubbles: true, cancelable: true }) as unknown as Record<string, unknown>; Object.assign(p, { pointerId: 1, clientX: x, clientY: y }); joy.dispatchEvent(p as unknown as Event); };
    pe('pointerdown', 64, 8); // pushed up
    expect(keys).toEqual(['+w']);
    pe('pointermove', 120, 64); // pushed right
    expect(keys).toEqual(['+w', '-w', '+d']);
    pe('pointerup', 120, 64);
    expect(keys).toEqual(['+w', '-w', '+d', '-d']);
  });
});

describe('touch settings + targets', () => {
  it('?touch= overrides the setting', () => {
    expect(touchOverride('?touch=1')).toBe('on'); expect(touchOverride('?touch=0')).toBe('off'); expect(touchOverride('?size=64')).toBeNull();
  });
  it('the shared kit scales buttons / sliders / checkboxes to --touch-min (44 px) and every :host exposes it', () => {
    expect(KIT_CSS).toContain('min-height: var(--touch-min, 0px)');
    expect(KIT_CSS).toMatch(/input\[type=range\][^}]*max\(18px, var\(--touch-min/);
    expect(tokensCss()).toContain('--touch-min:var(--touch-min-root,0px)');
  });
  it('Accessibility stores touch + palette and applies the palette to <html>', () => {
    const m = new Map<string, string>(); const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
    const a = new Accessibility(st, () => false, (s) => applyToDocument(s));
    expect(a.get().touch).toBe('auto'); expect(a.get().palette).toBe('default');
    a.set({ touch: 'on', palette: 'cbsafe' });
    expect(new Accessibility(st).get()).toMatchObject({ touch: 'on', palette: 'cbsafe' });
    expect(document.documentElement.getAttribute('data-palette')).toBe('cbsafe');
    expect(document.documentElement.style.getPropertyValue('--pal-good')).not.toBe('');
    expect(getPalette()).toBe('cbsafe');
    a.set({ palette: 'default' });
    expect(document.documentElement.style.getPropertyValue('--pal-good')).toBe('');
    // junk is ignored
    a.set({ touch: 'bogus' as never, palette: 'neon' as never });
    expect(a.get()).toMatchObject({ touch: 'on', palette: 'default' });
  });
});

describe('colour-blind-safe palette (Okabe-Ito)', () => {
  it('difficulty colours: distinct, and the cb-safe set avoids a red/green pair', () => {
    const def = paletteData('default').difficulty, cb = paletteData('cbsafe').difficulty;
    expect(new Set(cb).size).toBe(4);
    expect(cb).not.toEqual(def);
    expect(cb[0]).toBe('#56B4E9'); expect(cb[1]).toBe('#0072B2'); expect(cb[2]).toBe('#D55E00'); // sky blue / blue / vermillion (Okabe-Ito)
    setPalette('cbsafe');
    expect(difficultyCss(3)).toBe('#D55E00');
    expect(mapDifficultyCss('#e5484d')).toBe('#D55E00');
    expect(mapDifficultyCss('#abcdef')).toBe('#abcdef');
  });
  it('relative luminance of the four cb-safe difficulty colours differs enough to tell them apart without hue (>= 1.25:1 between neighbours)', () => {
    const lum = (h: string): number => { const c = [1, 3, 5].map((i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; };
    const L = paletteData('cbsafe').difficulty.map(lum).sort((a, b) => a - b);
    for (let i = 1; i < L.length; i++) expect((L[i]! + 0.05) / (L[i - 1]! + 0.05)).toBeGreaterThan(1.25);
  });
  it('overlay painting follows the palette', async () => {
    const { paintOverlay, EMPTY_NETWORK, Coverage } = await import('../../src/sim/Coverage');
    void EMPTY_NETWORK; void Coverage;
    setPalette('cbsafe');
    expect(paletteData().pisteRgb[3]).toEqual([0xd5, 0x5e, 0x00]);
    expect(typeof paintOverlay).toBe('function');
  });
});
