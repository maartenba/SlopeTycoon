// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { resolveSnap, SHEET_KEY_PREFIX, type SheetSnap } from '../../src/ui/components/StSheet';

registerComponents();
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

const mk = (attrs: Record<string, string> = {}): ReturnType<typeof el<'st-sheet'>> => {
  const s = el('st-sheet');
  for (const [k, v] of Object.entries({ media: 'all', 'side-media': 'never', label: 'Test sheet', ...attrs })) s.setAttribute(k, v);
  const body = document.createElement('div'); body.textContent = 'content'; s.append(body);
  document.body.append(s);
  return s;
};
const root = (s: HTMLElement): ShadowRoot => s.shadowRoot!;
const sheetEl = (s: HTMLElement): HTMLElement => root(s).querySelector('.sheet')!;
const handle = (s: HTMLElement): HTMLButtonElement => root(s).querySelector('.handle')!;
const ptr = (type: string, y: number, t: number, x = 100): Event => { const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }); Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: 'touch' }, timeStamp: { value: t } }); return e; };
const heightOf = (s: HTMLElement): number => parseFloat(sheetEl(s).style.height);

describe('st-sheet', () => {
  it('createElement adds no attributes and no children; connect / disconnect / reconnect are safe', () => {
    const e = document.createElement('st-sheet');
    expect(e.attributes.length).toBe(0); expect(e.childNodes.length).toBe(0);
    document.body.append(e); e.remove();
    expect(() => { document.body.append(e); e.remove(); }).not.toThrow();
  });

  it('is a pure passthrough while the media query does not match (desktop untouched): no handle, no ARIA, no size', () => {
    const s = mk({ media: 'never' });
    expect(s.active).toBe(false);
    expect(sheetEl(s).classList.contains('on')).toBe(false);
    expect(sheetEl(s).getAttribute('role')).toBeNull();
    expect(handle(s).hidden).toBe(true);
    expect(handle(s).tabIndex).toBe(-1);
    expect(sheetEl(s).style.height).toBe('');
  });

  it('active: role=dialog, labelled, a 44 px focusable handle with aria-expanded, snaps start at peek', () => {
    const s = mk();
    expect(s.active).toBe(true);
    const sh = sheetEl(s);
    expect(sh.getAttribute('role')).toBe('dialog'); expect(sh.getAttribute('aria-label')).toBe('Test sheet'); expect(sh.getAttribute('aria-modal')).toBe('false');
    expect(handle(s).tabIndex).toBe(0);
    expect(handle(s).getAttribute('aria-label')).toBe('Resize Test sheet');
    expect(handle(s).getAttribute('aria-expanded')).toBe('false');
    expect(s.snap).toBe('peek'); expect(sh.dataset.snap).toBe('peek');
    expect(heightOf(s)).toBe(s.size('peek'));
    // the 44 px handle is in the stylesheet (happy-dom has no layout): min-height 44px
    const css = (root(s) as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets?.map((x) => Array.from(x.cssRules).map((r) => r.cssText).join('')).join('') ?? root(s).querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/min-height:\s*44px/);
  });

  it('snap states: peek < half < full, setSnap updates the height, aria-expanded and fires st-sheet-snap', () => {
    const s = mk();
    expect(s.size('peek')).toBeLessThan(s.size('half')); expect(s.size('half')).toBeLessThan(s.size('full'));
    const seen: string[] = []; s.addEventListener('st-sheet-snap', (e) => seen.push((e as CustomEvent).detail.snap));
    s.setSnap('half');
    expect(heightOf(s)).toBe(s.size('half')); expect(handle(s).getAttribute('aria-expanded')).toBe('true'); expect(sheetEl(s).dataset.snap).toBe('half');
    s.snap = 'full'; expect(heightOf(s)).toBe(s.size('full'));
    s.collapse(); expect(s.snap).toBe('peek'); expect(handle(s).getAttribute('aria-expanded')).toBe('false');
    s.setSnap('peek'); // no change: no event
    expect(seen).toEqual(['half', 'full', 'peek']);
  });

  it('the snap attribute sets the snap; an unknown value is ignored', () => {
    const s = mk({ snap: 'half' });
    expect(s.snap).toBe('half');
    s.setAttribute('snap', 'full'); expect(s.snap).toBe('full');
    s.setAttribute('snap', 'nonsense'); expect(s.snap).toBe('full');
  });

  it('keyboard on the handle: ArrowUp / ArrowDown cycle the snaps (no wrap), Home / End jump, Escape collapses one step', () => {
    const s = mk();
    const key = (k: string): void => { handle(s).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); };
    key('ArrowUp'); expect(s.snap).toBe('half');
    key('ArrowUp'); expect(s.snap).toBe('full');
    key('ArrowUp'); expect(s.snap).toBe('full');
    key('ArrowDown'); expect(s.snap).toBe('half');
    key('Escape'); expect(s.snap).toBe('peek');
    key('Escape'); expect(s.snap).toBe('peek');
    key('End'); expect(s.snap).toBe('full');
    key('Home'); expect(s.snap).toBe('peek');
  });

  it('Escape inside the content collapses a raised sheet and is swallowed; at peek it passes through', () => {
    const s = mk(); s.setSnap('full');
    const inner = s.firstElementChild as HTMLElement;
    let reached = 0; document.body.addEventListener('keydown', () => { reached++; });
    const down = (): Event => { const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, composed: true }); inner.dispatchEvent(e); return e; };
    // the listener sits on the shadow .sheet: dispatch from inside it
    const sh = sheetEl(s);
    sh.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); expect(s.snap).toBe('half');
    sh.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); expect(s.snap).toBe('peek');
    down(); expect(s.snap).toBe('peek');
    void reached;
  });

  it('a tap on the grabber toggles peek <-> half', () => {
    const s = mk();
    handle(s).click(); expect(s.snap).toBe('half');
    handle(s).click(); expect(s.snap).toBe('peek');
  });

  it('remembers the snap per sheet in localStorage (key attribute) and restores it on the next connect', () => {
    const s = mk({ key: 'drawer-a' });
    s.setSnap('full');
    expect(localStorage.getItem(SHEET_KEY_PREFIX + 'drawer-a')).toBe('full');
    s.remove();
    const s2 = mk({ key: 'drawer-a' });
    expect(s2.snap).toBe('full');
    const other = mk({ key: 'drawer-b' });
    expect(other.snap).toBe('peek'); // per sheet
    const none = mk(); none.setSnap('half');
    expect(Object.keys(localStorage).filter((k) => k.startsWith(SHEET_KEY_PREFIX))).toEqual([SHEET_KEY_PREFIX + 'drawer-a']);
    localStorage.setItem(SHEET_KEY_PREFIX + 'bad', 'wild'); expect(mk({ key: 'bad' }).snap).toBe('peek');
  });

  it('programmatic setSnap(..., false) does not touch storage', () => {
    const s = mk({ key: 'k' }); s.setSnap('half', false);
    expect(localStorage.getItem(SHEET_KEY_PREFIX + 'k')).toBeNull();
  });

  it('drag from the handle with synthetic pointer events follows the finger, then snaps to the nearest state', () => {
    const s = mk(); const h = handle(s);
    const p0 = s.size('peek'), half = s.size('half');
    h.dispatchEvent(ptr('pointerdown', 700, 0));
    h.dispatchEvent(ptr('pointermove', 700 - (half - p0) * 0.9, 400));   // slow drag: almost to half
    expect(sheetEl(s).classList.contains('drag')).toBe(true);           // no animation while dragging
    expect(heightOf(s)).toBeCloseTo(p0 + (half - p0) * 0.9, 0);
    h.dispatchEvent(ptr('pointerup', 700 - (half - p0) * 0.9, 800));
    expect(s.snap).toBe('half'); expect(heightOf(s)).toBe(half); expect(sheetEl(s).classList.contains('drag')).toBe(false);
  });

  it('a drag clamps to the sheet range; a small drag springs back to the same snap', () => {
    const s = mk(); const h = handle(s);
    h.dispatchEvent(ptr('pointerdown', 700, 0)); h.dispatchEvent(ptr('pointermove', 690, 500)); h.dispatchEvent(ptr('pointerup', 690, 900));
    expect(s.snap).toBe('peek'); expect(heightOf(s)).toBe(s.size('peek'));
    h.dispatchEvent(ptr('pointerdown', 700, 0)); h.dispatchEvent(ptr('pointermove', -4000, 500));
    expect(heightOf(s)).toBeLessThanOrEqual(s.size('full'));
    h.dispatchEvent(ptr('pointerup', -4000, 900)); expect(s.snap).toBe('full');
  });

  it('a fast fling up moves one snap further than the release position; a fling down collapses', () => {
    const s = mk(); const h = handle(s);
    h.dispatchEvent(ptr('pointerdown', 700, 0)); h.dispatchEvent(ptr('pointermove', 660, 40)); h.dispatchEvent(ptr('pointermove', 600, 80)); h.dispatchEvent(ptr('pointerup', 600, 90));
    expect(s.snap).not.toBe('peek'); // 100 px in 90 ms = a fling
    s.setSnap('half');
    h.dispatchEvent(ptr('pointerdown', 300, 0)); h.dispatchEvent(ptr('pointermove', 360, 40)); h.dispatchEvent(ptr('pointermove', 440, 80)); h.dispatchEvent(ptr('pointerup', 440, 90));
    expect(s.snap).toBe('peek');
  });

  it('resolveSnap (pure): nearest without a fling, one step with a fling, never out of range', () => {
    const sn: Record<SheetSnap, number> = { peek: 100, half: 300, full: 600 };
    expect(resolveSnap(120, 0, sn, 'peek')).toBe('peek');
    expect(resolveSnap(210, 0, sn, 'peek')).toBe('half');
    expect(resolveSnap(500, 0, sn, 'half')).toBe('full');
    expect(resolveSnap(150, 1, sn, 'peek')).toBe('half');
    expect(resolveSnap(300, -1, sn, 'half')).toBe('peek');
    expect(resolveSnap(100, -2, sn, 'peek')).toBe('peek');
    expect(resolveSnap(600, 2, sn, 'full')).toBe('full');
  });

  it('touch drag on the content: finger up grows the sheet; a horizontal swipe is left to native scrolling; at full a finger-up scrolls', () => {
    const s = mk();
    const content = root(s).querySelector('.content') as HTMLElement;
    const touch = (type: string, x: number, y: number, t: number): Event => {
      const e = new Event(type, { bubbles: true, cancelable: true, composed: true }); Object.defineProperties(e, { touches: { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] }, timeStamp: { value: t } }); return e;
    };
    content.dispatchEvent(touch('touchstart', 100, 700, 0));
    const mv = touch('touchmove', 100, 500, 400); content.dispatchEvent(mv);
    expect(mv.defaultPrevented).toBe(true);
    expect(heightOf(s)).toBeGreaterThan(s.size('peek'));
    content.dispatchEvent(touch('touchend', 100, 500, 800));
    expect(s.snap).not.toBe('peek');
    // horizontal first move: native
    s.setSnap('peek');
    content.dispatchEvent(touch('touchstart', 100, 700, 0));
    const hz = touch('touchmove', 200, 702, 100); content.dispatchEvent(hz);
    expect(hz.defaultPrevented).toBe(false);
    content.dispatchEvent(touch('touchend', 200, 702, 200)); expect(s.snap).toBe('peek');
    // full: finger up is a native scroll
    s.setSnap('full');
    content.dispatchEvent(touch('touchstart', 100, 700, 0));
    const up = touch('touchmove', 100, 600, 100); content.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
  });

  it('the host has no box (display: contents) so it never takes pointer events itself, and passthrough content inherits them untouched (the map stays interactive beside the sheet; never a full-size child)', () => {
    const s = mk();
    const css = (root(s) as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets?.map((x) => Array.from(x.cssRules).map((r) => r.cssText).join('')).join('') ?? root(s).querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/:host\s*\{[^}]*display:\s*contents/);
    // regression (found by the tablet e2e): `pointer-events: none` on the host or on the passthrough layer is INHERITED by the slotted content and made every desktop drawer unclickable
    expect(css).not.toMatch(/:host\s*\{[^}]*pointer-events:\s*none/);
    expect(css).not.toMatch(/\.sheet\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.sheet\.on\s*\{[^}]*pointer-events:\s*auto/);
    expect(css).toMatch(/\.sheet\.on\s*\{[^}]*position:\s*fixed/);
    expect(css).not.toMatch(/\.sheet\.on\s*\{[^}]*inset:\s*0/);
  });

  it('[hidden] hides the host', () => {
    const s = mk(); s.hidden = true;
    expect(s.hidden).toBe(true);
  });

  it('prefers-reduced-motion: the stylesheet stops the height transition', () => {
    const s = mk();
    const css = (root(s) as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets?.map((x) => Array.from(x.cssRules).map((r) => r.cssText).join('')).join('') ?? root(s).querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it('side layout (landscape phones): sets a width instead of a height and uses Left / Right arrows', () => {
    const s = mk({ 'side-media': 'always' });
    expect(s.isSide).toBe(true);
    expect(sheetEl(s).style.width).toBe(`${s.size('peek')}px`); expect(sheetEl(s).style.height).toBe('');
    handle(s).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(s.snap).toBe('half'); expect(sheetEl(s).style.width).toBe(`${s.size('half')}px`);
  });

  it('side layout: peek-h <= 60 folds to just the grabber (a tool is active), otherwise a narrow column of cards', () => {
    const open = mk({ 'side-media': 'always', 'peek-h': '196' });
    const mini = mk({ 'side-media': 'always', 'peek-h': '44' });
    expect(mini.size('peek')).toBe(44);
    expect(open.size('peek')).toBeGreaterThan(120);
    expect(open.size('peek')).toBeLessThan(open.size('half'));
    mini.setAttribute('peek-h', '196'); // the attribute is live: bringing the cards back widens the sheet
    expect(mini.size('peek')).toBeGreaterThan(120);
    expect(sheetEl(mini).style.width).toBe(`${mini.size('peek')}px`);
  });
});
