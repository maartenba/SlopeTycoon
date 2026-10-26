// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { registerComponents, el } from '../../src/ui';
import type { DockApi, StDock } from '../../src/ui/components/StDock';

registerComponents();

/** resetTool re-enters dock.setActive(null) synchronously (main.ts onActiveChange), like LiftTool.cancel did. */
function mount(): StDock {
  const dock = el('st-dock') as StDock;
  const api = {
    funds: () => 1e6, buildings: { locked: () => [], cost: () => 100, multiplier: () => 1, select: () => {} }, lifts: { select: () => {}, costPer100m: () => 1 },
    network: { start: () => {}, setOverride: () => {}, setBrush: () => {} }, terraform: { setMode: () => {}, setTarget: () => {}, setBrush: () => {}, setMaxEdgeDelta: () => {}, state: () => ({ mode: 'raise', brush: 1, target: 'tile' }) },
    setBulldoze: () => {}, activateTerraform: () => {}, resetTool: () => { dock.setActive(null, null); }, view: { overlay: () => 'off', setOverlay: () => {}, toggleGrid: () => {}, setSeason: () => {} },
    autoFlatten: { get: () => true, set: () => {} }, thumb: () => null,
  } as unknown as DockApi;
  document.body.append(dock);
  dock.bind(api);
  return dock;
}

describe('dock: tool reset while switching drawers', () => {
  it('never prices another drawer\'s cards (StDock.priceOf costPerTile crash)', () => {
    const dock = mount();
    const ids = ['lifts', 'paths', 'pistes', 'buildings', 'lifts', 'pistes', 'paths', 'terrain', 'lifts'] as const;
    for (const d of ids) {
      dock.syncTool('lift');
      expect(() => dock.show(d)).not.toThrow();
      for (const c of Array.from(dock.shadowRoot!.querySelectorAll<HTMLElement>('.card'))) c.click();
      expect(() => dock.setActive(d, 'chair4')).not.toThrow();
      expect(() => dock.refresh()).not.toThrow();
    }
    dock.remove();
  });
});

describe('dock.showPanel', () => {
  it('opens the marketing drawer and highlights the campaign card', () => {
    const id = 'brand';
    const hl: Array<string | null> = [];
    const dock = el('st-dock') as StDock;
    document.body.append(dock);
    dock.bind({
      funds: () => 1, buildings: { locked: () => [], cost: () => 1, multiplier: () => 1, select: () => {} }, lifts: { select: () => {}, costPer100m: () => 1 },
      network: { start: () => {}, setOverride: () => {}, setBrush: () => {} }, terraform: { state: () => ({ mode: 'raise', brush: 1, target: 'tile' }) },
      setBulldoze: () => {}, activateTerraform: () => {}, resetTool: () => {}, view: { overlay: () => 'off' }, autoFlatten: { get: () => true, set: () => {} }, thumb: () => null,
      marketing: { panels: () => [], refresh: () => {}, highlight: (i: string | null) => hl.push(i) },
    } as unknown as DockApi);
    dock.showPanel('marketing', id);
    expect(dock.openDrawer).toBe('marketing');
    expect(hl).toEqual([id]);
    dock.showPanel('pistes', 'mtb');
    expect(dock.openDrawer).toBe('pistes');
    dock.remove();
  });
});
