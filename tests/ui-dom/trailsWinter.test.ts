// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { registerComponents, el } from '../../src/ui';
import type { DockApi, StDock } from '../../src/ui/components/StDock';
import type { SeasonId } from '../../src/core/events';
import { trailSeasonNote } from '../../src/ui/buildInfo';

registerComponents();

function mount(): { dock: StDock; started: string[]; set: (s: SeasonId) => void } {
  const started: string[] = [];
  let season: SeasonId = 'winter';
  const dock = el('st-dock') as StDock;
  const api = {
    funds: () => 1e6, season: () => season,
    buildings: { locked: () => [], cost: () => 100, multiplier: () => 1, select: () => {} }, lifts: { select: () => {}, costPer100m: () => 1 },
    network: { start: (k: string) => started.push(k), setOverride: () => {}, setBrush: () => {} }, terraform: { state: () => ({ mode: 'raise', brush: 1, target: 'tile' }) },
    setBulldoze: () => {}, activateTerraform: () => {}, resetTool: () => {}, view: { overlay: () => 'off' }, autoFlatten: { get: () => true, set: () => {} }, thumb: () => null,
  } as unknown as DockApi;
  document.body.append(dock);
  dock.bind(api);
  return { dock, started, set: (s) => { season = s; dock.seasonChanged(); } };
}
const q = (d: StDock, sel: string): HTMLElement | null => d.shadowRoot!.querySelector<HTMLElement>(sel);

describe('MTB / hiking trails in winter', () => {
  it('stay in the drawer after the ski piste, can be picked, and a note explains they are used in the snow is gone', () => {
    const { dock, started, set } = mount();
    dock.show('pistes');
    expect(Array.from(dock.shadowRoot!.querySelectorAll<HTMLElement>('.grid .card')).map((c) => c.dataset.id)).toEqual(['ski', 'mtb', 'hike']);
    const mtb = q(dock, '.card[data-id="mtb"]')!;
    expect(mtb.classList.contains('offseason')).toBe(true);
    expect(mtb.classList.contains('locked')).toBe(false);
    mtb.click();
    q(dock, '.card[data-id="hike"]')!.click();
    expect(started).toEqual(['mtb', 'hike']);
    const note = q(dock, '[data-trail-note]')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toMatch(/snow is gone/);
    set('summer');
    expect(Array.from(dock.shadowRoot!.querySelectorAll<HTMLElement>('.grid .card')).map((c) => c.dataset.id)).toEqual(['mtb', 'hike', 'ski']);
    expect(q(dock, '[data-trail-note]')!.textContent).toMatch(/Ski pistes/);
    set('spring');
    expect(q(dock, '[data-trail-note]')!.hidden).toBe(true);
    dock.remove();
  });
  it('note text', () => { expect(trailSeasonNote('autumn')).toBeNull(); });
});
