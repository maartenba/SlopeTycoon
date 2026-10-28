// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { KIT_CSS } from '../../src/ui/components/StElement';
import { mountTownCaption } from '../../src/ui/townCaption';

/** Fixes found by the real-touch end-to-end run (scripts/touch-e2e.ts, docs/touch.md): each one guards a bug the emulated fingers exposed. */
registerComponents();
afterEach(() => { document.body.replaceChildren(); });
const R = (e: HTMLElement): ShadowRoot => e.shadowRoot!;
const btn = (e: HTMLElement, role: string): HTMLButtonElement => R(e).querySelector(`[data-role=${role}]`) as HTMLButtonElement;
const styleOf = (e: HTMLElement): string => (e as unknown as { css(): string }).css();
const nextFrames = (): Promise<void> => new Promise((r) => setTimeout(r, 80));

describe('touch bar', () => {
  it('the joystick is its own touch-action:none surface (otherwise Chrome cancels the pointer as soon as it pans: the stick never worked on a real screen)', () => {
    const e = el('st-touch-controls'); document.body.append(e);
    expect(styleOf(e)).toMatch(/\.joy\{[^}]*touch-action:none/);
  });
  it('Pause in walk mode calls the pause api (Space is Hop there and the walk handler swallows it)', () => {
    const e = el('st-touch-controls'); document.body.append(e);
    const calls: string[] = []; e.bind({ setMode: () => {}, confirm: () => {}, cancelTool: () => {}, undo: () => {}, rotateView: () => {}, rotateGhost: () => {}, togglePause: () => calls.push('pause') });
    e.setState({ enabled: true }); e.setView('walk');
    const keys: string[] = []; window.addEventListener('keydown', (k) => keys.push((k as KeyboardEvent).key));
    btn(e, 'pause').click();
    expect(calls).toEqual(['pause']);
    expect(keys).toEqual([]);
    e.setView('ride'); // ride keeps working through the global key handler when no api is bound
    const e2 = el('st-touch-controls'); document.body.append(e2); e2.setState({ enabled: true }); e2.setView('ride');
    btn(e2, 'pause').click();
    expect(keys).toEqual([' ']);
  });
  it('Hop keeps Space down for at least one frame (the walk loop polls held keys; down + up in one task was never seen)', async () => {
    const e = el('st-touch-controls'); document.body.append(e);
    e.setState({ enabled: true }); e.setView('walk');
    const ev: string[] = []; window.addEventListener('keydown', (k) => ev.push(`+${(k as KeyboardEvent).key}`)); window.addEventListener('keyup', (k) => ev.push(`-${(k as KeyboardEvent).key}`));
    btn(e, 'hop').click();
    expect(ev).toEqual(['+ ']);
    await nextFrames();
    expect(ev).toEqual(['+ ', '- ']);
  });
  it('the lift tool gets the Place bar without the building rotate buttons; placement keeps them', () => {
    const e = el('st-touch-controls'); document.body.append(e);
    e.setState({ enabled: true, tool: 'lift', kind: 'tap' });
    const bar = R(e).querySelector('.bar') as HTMLElement;
    expect(bar.hidden).toBe(false);
    expect(btn(e, 'ghost-left').hidden).toBe(true); expect(btn(e, 'ghost-right').hidden).toBe(true);
    expect(btn(e, 'place').hidden).toBe(false);
    e.setState({ tool: 'placement' });
    expect(btn(e, 'ghost-left').hidden).toBe(false);
    e.setState({ tool: 'select', kind: 'select' });
    expect(bar.hidden).toBe(true);
  });
  it('portrait: the stick and the buttons sit above the bottom view card; photo buttons move to the top (the Photo panel fills the lower half)', () => {
    const e = el('st-touch-controls'); document.body.append(e);
    const css = styleOf(e);
    expect(css).toMatch(/max-width:760px\) and \(min-height:521px\)\{[^}]*\.views\[data-view=photo\]\{top:/);
    expect(css).toMatch(/\.joy,\.views:not\(\[data-view=photo\]\)\{bottom:/);
  });
  it('the paint / pan column stays on the left in portrait (the right column is under the HUD cards, which grow)', () => {
    const e = el('st-touch-controls'); document.body.append(e);
    expect(styleOf(e)).not.toMatch(/\.col\{left:auto;right:/);
  });
});

describe('44 px targets for everything the audit found small', () => {
  it('the kit: narrow buttons, text inputs and checkbox rows scale to --touch-min', () => {
    expect(KIT_CSS).toMatch(/button \{ min-height: var\(--touch-min, 0px\); min-width: var\(--touch-min, 0px\);/);
    expect(KIT_CSS).toMatch(/input\[type=text\][^}]*\{ min-height: var\(--touch-min, 0px\); \}/);
    expect(KIT_CSS).toContain('label:has(> input[type=checkbox])');
  });
  it('speed buttons are 44 px wide on touch and wrap instead of overflowing', () => {
    const e = el('st-speed-control'); document.body.append(e);
    const css = styleOf(e);
    expect(css).toContain('.btns button{min-width:max(32px,var(--touch-min,0px))');
    expect(css).toMatch(/\.btns\{[^}]*flex-wrap:wrap/);
  });
  it('st-select options and the title-screen Shuffle button reach 44 px', () => {
    const s = el('st-select'); document.body.append(s);
    expect(styleOf(s)).toContain('li{padding:5px 9px;min-height:var(--touch-min,0px)');
    const cap = mountTownCaption(document, 'Alpine · seed 1', () => {});
    const b = cap.el.querySelector('button') as HTMLElement;
    expect(b.style.cssText).toContain('min-height: var(--touch-min-root, 0px)');
    cap.dispose();
  });
  it('settings: toggle rows and range rows (min width scales, wraps) are touch sized', () => {
    const e = el('st-settings'); document.body.append(e);
    const css = styleOf(e);
    expect(css).toContain('.chk{display:flex;gap:10px;align-items:center;cursor:pointer;min-height:var(--touch-min,0px)}');
    expect(css).toContain('flex-wrap:wrap}.row input[type=range]{flex:1;min-width:max(40px,var(--touch-min,0px) * 2.4)');
  });
});

describe('drawers on a narrow screen', () => {
  it('Pistes & Trails: the card rail gets the full width above the option grid and the body scrolls (side by side left the cards a 50 px strip: Ski piste could not be tapped)', () => {
    const e = el('st-dock'); document.body.append(e);
    const css = styleOf(e);
    expect(css).toContain('.body:has(.pc [data-suggest]),.body:has(.pc[data-path-controls]){flex-direction:column;overflow-y:auto'); // the Paths & Roads panel (Cross rails) stacks the same way
    expect(css).toContain('.body:has(.pc [data-suggest]) .pc{width:100%;grid-template-columns:repeat(3,1fr)');
  });
});

describe('compact layout', () => {
  it('the right-hand HUD column scrolls instead of hanging off the screen when it grows (speed buttons wrap, goals open)', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/@media \(max-width: 760px\), \(max-height: 520px\) \{[\s\S]*#right-col \{ max-height: calc\(100% - 80px[^}]*overflow-y: auto/);
  });
  it('dock buttons keep 44 px on a tablet (the < 1100 px rule used min-width:0)', () => {
    const e = el('st-dock'); document.body.append(e);
    expect(styleOf(e)).toContain('@media (max-width:1099px){.dock{gap:2px;padding:5px 4px}.dock button{min-width:var(--touch-min,0px)');
  });
});

describe('overlays that must not eat taps', () => {
  it('the slope / lift profile card ignores pointer events (the second tap of a lift aims right under it)', () => {
    const e = el('st-profile'); document.body.append(e);
    const css = styleOf(e);
    expect(css).toContain('pointer-events:none!important');
    expect(css).toMatch(/\.card\{pointer-events:none/);
  });
  it('the ride HUD card wraps on a phone instead of overlapping its own title and stats', () => {
    const e = el('st-view-hud'); document.body.append(e);
    expect(styleOf(e)).toMatch(/max-width:760px\)\{.*\.card\{flex-wrap:wrap/);
  });
});
