// @vitest-environment happy-dom
// Dock tab row scroll affordance on phones (owner decision 2026-11-16): chevron visibility, whole-tab snapping, short labels with the full accessible name.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { registerComponents, el } from '../../src/ui';
import { edgeState } from '../../src/ui/drawerScroll';
import { DOCK_SHORT, DRAWERS } from '../../src/ui/drawerState';
import type { DockApi, StDock } from '../../src/ui/components/StDock';

registerComponents();
const api = {
  funds: () => 1e6, buildings: { locked: () => [], cost: () => 100, multiplier: () => 1, select: () => {} }, lifts: { select: () => {}, costPer100m: () => 1 },
  network: { start: () => {}, setOverride: () => {}, setBrush: () => {} }, terraform: { setMode: () => {}, setTarget: () => {}, setBrush: () => {}, setMaxEdgeDelta: () => {}, state: () => ({ mode: 'raise', brush: 1, target: 'tile' }) },
  setBulldoze: () => {}, activateTerraform: () => {}, resetTool: () => {}, view: { overlay: () => 'off', setOverlay: () => {}, toggleGrid: () => {}, setSeason: () => {} },
  autoFlatten: { get: () => true, set: () => {} }, thumb: () => null,
} as unknown as DockApi;

describe('dock scroll affordance', () => {
  it('chevron rule is a pure function of scrollLeft / clientWidth / scrollWidth', () => {
    expect(edgeState(0, 360, 360)).toEqual({ left: false, right: false }); // everything fits
    expect(edgeState(0, 360, 900)).toEqual({ left: false, right: true });
    expect(edgeState(200, 360, 900)).toEqual({ left: true, right: true });
    expect(edgeState(540, 360, 900)).toEqual({ left: true, right: false });
  });

  it('renders two labelled 44 px chevron buttons that start hidden, and a short + full label per long tab', () => {
    const dock = el('st-dock') as StDock; document.body.append(dock); dock.bind(api);
    const r = dock.shadowRoot!;
    const next = r.querySelector<HTMLElement>('.dockw .dn.r')!, prev = r.querySelector<HTMLElement>('.dockw .dn.l')!;
    expect(next.getAttribute('aria-label')).toBe('More tabs'); expect(prev.getAttribute('aria-label')).toBe('Previous tabs');
    expect(next.tagName).toBe('BUTTON');
    expect(r.querySelector('.dockw')!.classList.contains('can-r')).toBe(false); // happy-dom has no layout: nothing to scroll
    const paths = r.querySelector<HTMLElement>('.dock button[data-drawer="paths"]')!;
    expect(paths.getAttribute('aria-label')).toBe('Paths & Roads');
    expect(paths.querySelector('.lg')!.textContent).toBe('Paths & Roads');
    expect(paths.querySelector('.sh')!.textContent).toBe('Paths');
    expect(r.querySelector('.dock button[data-drawer="pistes"] .sh')!.textContent).toBe('Pistes');
    dock.remove();
  });

  it('CSS: snap to whole tabs, 44 px chevrons, short labels only on narrow screens, desktop hides the chevrons', () => {
    const css = readFileSync('src/ui/components/StDock.ts', 'utf8'); // the component css is an adopted sheet (not readable from happy-dom)
    expect(css).toMatch(/scroll-snap-type:x mandatory/); expect(css).toMatch(/scroll-snap-align:start/);
    expect(css).toMatch(/\.dockw \.dn\{[^}]*width:44px/);
    expect(css).toMatch(/\.dockw \.dn\{display:none\}/);
    expect(css).toMatch(/@media \(max-width:520px\),\(max-height:520px\)\{\.dockw \.dock button \.lg\{display:none\}/);
  });

  it('every shortened label belongs to a real drawer and is shorter', () => {
    for (const [id, s] of Object.entries(DOCK_SHORT)) { const d = DRAWERS.find((x) => x.id === id)!; expect(d).toBeTruthy(); expect(s!.length).toBeLessThan(d.label.length); }
  });
});
