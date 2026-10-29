// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { wireTouch, type TouchWire } from '../../src/ui/touchWire';
import { accessibility } from '../../src/ui/accessibility';

registerComponents();

/** The drawer on a touch screen: tucked away while a map tool is active where it would cover the map, one button / one card tap / a dock tap brings it back. */
let wire: TouchWire | null = null;
let tool = 'select';
let short = false;
const win = window as unknown as { matchMedia: (q: string) => unknown };
const realMM = win.matchMedia;

function setup(canvas: HTMLElement = document.createElement('canvas')): { dock: HTMLElement; bar: ReturnType<typeof el<'st-touch-controls'>> } {
  document.body.append(canvas);
  const ui = document.createElement('div'); ui.id = 'ui'; document.body.append(ui);
  const dock = el('st-dock'); ui.append(dock);
  const bar = el('st-touch-controls'); ui.append(bar);
  accessibility().set({ touch: 'on' });
  wire = wireTouch({
    dom: canvas, camera: { active: true, rotateSnap() {}, panPixels() {}, zoomBy() {}, rotateBy() {} } as never,
    toolId: () => tool, cancelTool: () => {}, confirmPlacement: () => false, rotateGhost: () => {}, undo: () => {},
  });
  wire.bindBar(bar);
  return { dock, bar };
}
const drawerBtn = (bar: HTMLElement): HTMLButtonElement => bar.shadowRoot!.querySelector('[data-role=drawer]') as HTMLButtonElement;
const ptr = (target: EventTarget, type: string, pointerType = 'touch'): void => { const e = new Event(type, { bubbles: true, composed: true }) as unknown as Record<string, unknown>; Object.assign(e, { pointerType, pointerId: 1, clientX: 5, clientY: 5 }); target.dispatchEvent(e as unknown as Event); };

beforeEach(() => { tool = 'select'; short = false; win.matchMedia = (q: string) => ({ matches: /max-height/.test(q) ? short : false, addEventListener() {}, removeEventListener() {} }); vi.useFakeTimers(); });
afterEach(() => { wire?.dispose(); wire = null; document.body.replaceChildren(); win.matchMedia = realMM; accessibility().set({ touch: 'auto' }); vi.useRealTimers(); });

describe('touch: the drawer steps aside for map tools', () => {
  it('placement and lifts always tuck the drawer away (the ghost needs the map), select shows it', () => {
    const { dock, bar } = setup();
    tool = 'placement'; wire!.toolChanged(); expect(dock.classList.contains('peek')).toBe(true);
    expect(drawerBtn(bar).hidden).toBe(false); expect(drawerBtn(bar).getAttribute('aria-pressed')).toBe('false');
    tool = 'lift'; wire!.toolChanged(); expect(dock.classList.contains('peek')).toBe(true);
    tool = 'select'; wire!.toolChanged(); expect(dock.classList.contains('peek')).toBe(false); expect(drawerBtn(bar).hidden).toBe(true);
  });
  it('paint tools do not hide the drawer when they activate (opening Terrain activates the tool: the drawer must not vanish at once); a touch on the map tucks it away on every screen size (the tall Pistes & Trails / Landscape drawers cover the middle of a phone or tablet map; phone-portrait and tablet strokes could not be painted)', () => {
    const canvas = document.createElement('canvas'); let s = setup(canvas);
    tool = 'terraform'; wire!.toolChanged(); expect(s.dock.classList.contains('peek')).toBe(false);
    ptr(canvas, 'pointerdown', 'mouse'); expect(s.dock.classList.contains('peek')).toBe(false);
    ptr(canvas, 'pointerdown'); expect(s.dock.classList.contains('peek')).toBe(true); // tall screen too (was: short screens only)
    wire!.dispose(); document.body.replaceChildren(); short = true; const c2 = document.createElement('canvas'); s = setup(c2);
    tool = 'terraform'; wire!.toolChanged(); expect(s.dock.classList.contains('peek')).toBe(false);
    ptr(c2, 'pointerdown', 'mouse'); expect(s.dock.classList.contains('peek')).toBe(false);
    ptr(c2, 'pointerdown'); expect(s.dock.classList.contains('peek')).toBe(true);
  });
  it('the options button toggles the drawer and its pressed state', () => {
    const { dock, bar } = setup(); short = true;
    tool = 'network'; wire!.toolChanged();
    expect(dock.classList.contains('peek')).toBe(false);
    drawerBtn(bar).click();
    expect(dock.classList.contains('peek')).toBe(true); expect(drawerBtn(bar).getAttribute('aria-pressed')).toBe('false');
    drawerBtn(bar).click();
    expect(dock.classList.contains('peek')).toBe(false); expect(drawerBtn(bar).getAttribute('aria-pressed')).toBe('true');
  });
  it('a tap on a dock button brings the drawer back; a mouse does not care', () => {
    const { dock } = setup(); short = true;
    tool = 'placement'; wire!.toolChanged();
    const row = document.createElement('div'); row.className = 'dock'; dock.shadowRoot!.append(row);
    ptr(row, 'pointerdown', 'mouse'); expect(dock.classList.contains('peek')).toBe(true);
    ptr(row, 'pointerdown'); expect(dock.classList.contains('peek')).toBe(false);
  });
  it('choosing a card tucks the drawer away again (another brush, another piste kind)', () => {
    const { dock } = setup();
    tool = 'network'; wire!.toolChanged();
    const card = document.createElement('button'); card.className = 'card'; dock.shadowRoot!.append(card);
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    vi.advanceTimersByTime(200);
    expect(dock.classList.contains('peek')).toBe(true);
    // a locked card does nothing
    dock.classList.remove('peek'); card.classList.add('locked'); card.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); vi.advanceTimersByTime(200);
    expect(dock.classList.contains('peek')).toBe(false);
  });
});
