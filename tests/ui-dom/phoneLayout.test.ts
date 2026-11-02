// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerComponents, el } from '../../src/ui';
import type { DockApi, StDock } from '../../src/ui/components/StDock';
import type { StSheet } from '../../src/ui/components/StSheet';

registerComponents();
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.useRealTimers(); });

const sr = (e: HTMLElement): ShadowRoot => e.shadowRoot!;

describe('phone layout: top bar overflow (M7.5)', () => {
  it('has a ... overflow button; the secondary buttons carry .sec, the primary ones do not; the button toggles the second row', () => {
    const t = el('st-topbar');
    document.body.append(t);
    t.bind({ rotate: () => {}, help: () => {}, settings: () => {}, saveLoad: () => {}, menu: () => {}, photo: () => {}, stats: () => {}, walk: () => {}, quality: { get: () => 'med', set: () => {}, options: ['low', 'med', 'high'] } });
    const panel = sr(t).querySelector('.panel')!;
    const label = (b: Element): string => b.getAttribute('aria-label') ?? b.textContent ?? '';
    const sec = Array.from(panel.querySelectorAll('.sec:not(.sep)')).map(label);
    expect(sec.some((s) => /Rotate left/.test(s))).toBe(true);
    expect(sec.some((s) => /Rotate right/.test(s))).toBe(true);
    expect(sec.some((s) => /shortcuts/i.test(s))).toBe(true);
    const primary = Array.from(panel.querySelectorAll('button:not(.sec):not(.more)')).map(label).join('|');
    for (const p of ['main menu', 'Save game', 'Photo mode', 'Statistics', 'settings']) expect(primary, p).toContain(p);
    const more = panel.querySelector('button.more') as HTMLButtonElement;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    more.click();
    expect(panel.classList.contains('open')).toBe(true); expect(more.getAttribute('aria-expanded')).toBe('true');
    more.click();
    expect(panel.classList.contains('open')).toBe(false);
    const css = sr(t).querySelector('style')?.textContent ?? (sr(t) as unknown as { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets.map((s) => Array.from(s.cssRules).map((r) => r.cssText).join('')).join('');
    expect(css).toMatch(/\.more\s*\{\s*display:\s*none/); // desktop never shows it
    // the tutorial's rotate target still exists (also in the touch column on phones)
    expect(panel.querySelector('[data-tutorial-id="topbar:rotate"]')).toBeTruthy();
  });
});

describe('phone layout: HUD strip (M7.5)', () => {
  it('the expander toggles the details (aria-expanded) and folds back by itself after 8 s', () => {
    vi.useFakeTimers();
    const h = el('st-hud');
    document.body.append(h);
    const panel = sr(h).querySelector('.panel')!;
    const tgl = panel.querySelector('button.tgl') as HTMLButtonElement;
    expect(tgl).toBeTruthy();
    expect(tgl.getAttribute('aria-expanded')).toBe('false'); expect(panel.classList.contains('exp')).toBe(false);
    tgl.click();
    expect(panel.classList.contains('exp')).toBe(true); expect(tgl.getAttribute('aria-expanded')).toBe('true');
    vi.advanceTimersByTime(8100);
    expect(panel.classList.contains('exp')).toBe(false); expect(tgl.getAttribute('aria-expanded')).toBe('false');
    tgl.click(); tgl.click();
    expect(panel.classList.contains('exp')).toBe(false);
  });
});

describe('phone layout: dock drawers are sheets (M7.5)', () => {
  const mount = (): StDock => {
    const dock = el('st-dock') as StDock;
    const api = {
      funds: () => 1e6, buildings: { locked: () => [], cost: () => 100, multiplier: () => 1, select: () => {} }, lifts: { select: () => {}, costPer100m: () => 1 },
      network: { start: () => {}, setOverride: () => {}, setBrush: () => {} }, terraform: { setMode: () => {}, setTarget: () => {}, setBrush: () => {}, setMaxEdgeDelta: () => {}, state: () => ({ mode: 'raise', brush: 2, target: 'tile' }) },
      setBulldoze: () => {}, activateTerraform: () => {}, resetTool: () => {}, view: { overlay: () => 'off', setOverlay: () => {}, toggleGrid: () => {}, setSeason: () => {} },
      autoFlatten: { get: () => true, set: () => {} }, thumb: () => null,
    } as unknown as DockApi;
    document.body.append(dock);
    dock.bind(api);
    return dock;
  };
  const sheetOf = (d: StDock): StSheet => sr(d).querySelector('st-sheet') as StSheet;

  it('the drawer lives inside an st-sheet; the sheet is hidden while no drawer is open and follows it', () => {
    const d = mount();
    const sh = sheetOf(d);
    expect(sh).toBeTruthy();
    expect(sh.querySelector('.drawer')).toBeTruthy();
    expect(sh.hidden).toBe(true);
    d.show('buildings'); expect(sh.hidden).toBe(false); expect(sh.getAttribute('label')).toBe('Buildings');
    d.show(null); expect(sh.hidden).toBe(true);
  });

  it('each drawer remembers its own sheet height (localStorage slope.sheet.dock-<id>), default peek', () => {
    const d = mount(); const sh = sheetOf(d);
    d.show('terrain'); expect(sh.snap).toBe('peek');
    sh.setSnap('half');
    d.show('buildings'); expect(sh.snap).toBe('peek');
    d.show('terrain'); expect(sh.snap).toBe('half');
    expect(localStorage.getItem('slope.sheet.dock-terrain')).toBe('half');
  });

  it('while a tool is active (touchWire sets .peek) the sheet folds to its grabber; clearing it brings the cards back', async () => {
    const d = mount(); const sh = sheetOf(d);
    d.show('buildings');
    expect(sh.getAttribute('peek-h')).toBe('196');
    d.classList.add('peek');
    await Promise.resolve();
    expect(sh.getAttribute('peek-h')).toBe('44');
    d.classList.remove('peek');
    await Promise.resolve();
    expect(sh.getAttribute('peek-h')).toBe('196');
  });

  it('grabbing the folded sheet (any snap but peek) un-folds it: the class goes, touchWire is told, the cards (peek) are back', async () => {
    const d = mount(); const sh = sheetOf(d);
    d.show('buildings');
    d.classList.add('peek'); await Promise.resolve();
    const told = vi.fn(); window.addEventListener('st-drawer-unpeek', told);
    sh.setSnap('half', false); // the sheet fires st-sheet-snap
    expect(told).toHaveBeenCalledTimes(1);
    expect(d.classList.contains('peek')).toBe(false);
    expect(sh.snap).toBe('peek');
    window.removeEventListener('st-drawer-unpeek', told);
  });
});

describe('phone layout: inspectors, Rudi and news are sheets (M7.5)', () => {
  it('the building inspector panel sits in an st-sheet that follows its display', async () => {
    const i = el('st-inspector');
    document.body.append(i);
    const sh = sr(i).querySelector('st-sheet') as HTMLElement;
    expect(sh).toBeTruthy();
    expect(sh.hidden).toBe(true); // nothing selected
    const panel = sh.querySelector('.panel') as HTMLElement;
    panel.style.display = 'flex'; await Promise.resolve();
    expect(sh.hidden).toBe(false);
    panel.style.display = 'none'; await Promise.resolve();
    expect(sh.hidden).toBe(true);
  });

  it('Rudi advice and the news body are wrapped (hidden follows the panel)', async () => {
    const a = el('st-assistant'); const n = el('st-news');
    document.body.append(a, n);
    const adv = sr(a).querySelector('st-sheet') as HTMLElement; expect(adv).toBeTruthy();
    expect(adv.hidden).toBe(true);
    const card = adv.querySelector('.advice') as HTMLElement; card.hidden = false; await Promise.resolve(); expect(adv.hidden).toBe(false);
    const news = sr(n).querySelector('st-sheet') as HTMLElement; expect(news).toBeTruthy();
  });
});
