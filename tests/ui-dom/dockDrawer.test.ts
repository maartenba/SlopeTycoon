// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { registerComponents, el } from '../../src/ui';
import type { DockApi, StDock } from '../../src/ui/components/StDock';

registerComponents();

function mount(): { dock: StDock; picked: string[] } {
  const picked: string[] = [];
  const dock = el('st-dock') as StDock;
  const api = {
    funds: () => 1e6, buildings: { locked: () => [], cost: () => 100, multiplier: () => 1, select: (id: string) => picked.push(id) }, lifts: { select: () => {}, costPer100m: () => 1 },
    network: { start: () => {}, setOverride: () => {}, setBrush: () => {} }, terraform: { setMode: () => {}, setTarget: () => {}, setBrush: () => {}, setMaxEdgeDelta: () => {}, state: () => ({ mode: 'raise', brush: 1, target: 'tile' }) },
    setBulldoze: () => {}, activateTerraform: () => {}, resetTool: () => {}, view: { overlay: () => 'off', setOverlay: () => {}, toggleGrid: () => {}, setSeason: () => {} },
    autoFlatten: { get: () => true, set: () => {} }, thumb: () => null,
  } as unknown as DockApi;
  document.body.append(dock);
  dock.bind(api);
  return { dock, picked };
}
const q = (d: StDock, sel: string): HTMLElement | null => d.shadowRoot!.querySelector<HTMLElement>(sel);

describe('low-profile build drawer (DOM)', () => {
  it('renders ONE horizontal rail of cards with number badges, tabs + controls in the header, and a hidden popover', () => {
    const { dock } = mount();
    dock.show('buildings');
    const grid = q(dock, '.rail > .grid')!;
    expect(grid).toBeTruthy();
    expect(grid.querySelectorAll('.card').length).toBeGreaterThan(3);
    expect(grid.querySelector('.card .num')?.textContent).toBe('1');
    const head = q(dock, '.head')!;
    expect(head.querySelector('.tabs')).toBeTruthy();
    expect(head.querySelectorAll('.tabs button').length).toBe(7);
    expect(head.querySelector('.flat')).toBeTruthy();
    expect((q(dock, '.info') as HTMLElement).hidden).toBe(true);
    expect(q(dock, '.rail .fade.l button')).toBeTruthy();
    dock.remove();
  });

  it('hover shows the popover (outside the layout flow), leaving hides it, selecting hides it and keys 1-9 pick items', () => {
    const { dock, picked } = mount();
    dock.show('buildings');
    const card = q(dock, '.card:nth-child(2)')!;
    card.dispatchEvent(new MouseEvent('mouseenter'));
    const info = q(dock, '.info')!;
    expect(info.hidden).toBe(false);
    expect(info.parentElement).toBe(q(dock, '.drawer'));
    card.dispatchEvent(new MouseEvent('mouseleave'));
    expect(info.hidden).toBe(true);
    card.dispatchEvent(new MouseEvent('mouseenter'));
    card.click();
    expect(info.hidden).toBe(true);
    expect(picked.length).toBe(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    expect(picked.length).toBe(2);
    dock.remove();
  });

  it('lifts / paths drawers use the same rail and Escape closes', () => {
    const { dock } = mount();
    dock.show('lifts');
    expect(q(dock, '.rail > .grid')!.querySelectorAll('.card').length).toBe(11);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dock.drawerOpen).toBe(false);
    dock.remove();
  });
});
