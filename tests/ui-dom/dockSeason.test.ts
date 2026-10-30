// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { registerComponents, el } from '../../src/ui';
import type { DockApi, StDock } from '../../src/ui/components/StDock';
import type { SeasonId } from '../../src/core/events';
import { LIFTS } from '../../src/config/lifts';
import { buildingsInTab } from '../../src/ui/buildInfo';

registerComponents();

function mount(): { dock: StDock; picked: string[]; set: (s: SeasonId) => void } {
  const picked: string[] = [];
  let season: SeasonId = 'winter';
  const dock = el('st-dock') as StDock;
  const api = {
    funds: () => 1e6, season: () => season,
    buildings: { locked: () => [], cost: () => 100, multiplier: () => 1, select: (id: string) => picked.push(id) }, lifts: { select: () => {}, costPer100m: () => 1 },
    network: { start: () => {}, setOverride: () => {}, setBrush: () => {} }, terraform: { setMode: () => {}, setTarget: () => {}, setBrush: () => {}, setMaxEdgeDelta: () => {}, state: () => ({ mode: 'raise', brush: 1, target: 'tile' }) },
    setBulldoze: () => {}, activateTerraform: () => {}, resetTool: () => {}, view: { overlay: () => 'off', setOverlay: () => {}, toggleGrid: () => {}, setSeason: () => {} },
    autoFlatten: { get: () => true, set: () => {} }, thumb: () => null,
  } as unknown as DockApi;
  document.body.append(dock);
  dock.bind(api);
  return { dock, picked, set: (s) => { season = s; dock.seasonChanged(); } };
}
const q = (d: StDock, sel: string): HTMLElement | null => d.shadowRoot!.querySelector<HTMLElement>(sel);
const ids = (d: StDock): string[] => Array.from(d.shadowRoot!.querySelectorAll<HTMLElement>('.grid .card')).map((c) => c.dataset.id!);
const tab = (d: StDock, t: string): void => q(d, `.tabs button[data-tab="${t}"]`)!.click();

describe('season-ordered build drawer (DOM)', () => {
  it('winter: beach is dimmed with a Summer badge at the end of Recreation; ice rink first', () => {
    const { dock } = mount();
    dock.show('buildings'); tab(dock, 'recreation');
    const order = ids(dock);
    expect(order.slice(0, 3)).toEqual(['iceRink', 'heatedTerrace', 'stuntPark']);
    expect(order.indexOf('beach')).toBeGreaterThan(order.indexOf('stuntPark'));
    const beach = q(dock, '.card[data-id="beach"]')!;
    expect(beach.classList.contains('offseason')).toBe(true);
    expect(beach.querySelector('.sb')!.hasAttribute('hidden')).toBe(false);
    expect(beach.querySelector('.sb')!.textContent).toContain('Summer');
    expect(q(dock, '.card[data-id="iceRink"]')!.classList.contains('offseason')).toBe(false);
    expect(q(dock, '.card[data-id="iceRink"] .sb')!.hasAttribute('hidden')).toBe(true);
    dock.remove();
  });

  it('season change reorders IN PLACE (same DOM nodes), numbers and hotkeys follow the visible order', () => {
    const { dock, picked, set } = mount();
    dock.show('buildings'); tab(dock, 'recreation');
    const before = new Map(Array.from(dock.shadowRoot!.querySelectorAll<HTMLElement>('.grid .card')).map((c) => [c.dataset.id!, c]));
    set('summer');
    const order = ids(dock);
    expect(order.slice(-3)).toEqual(['iceRink', 'heatedTerrace', 'stuntPark']);
    for (const c of dock.shadowRoot!.querySelectorAll<HTMLElement>('.grid .card')) expect(before.get(c.dataset.id!)).toBe(c);
    expect(q(dock, '.card[data-id="beach"]')!.classList.contains('offseason')).toBe(false);
    expect(q(dock, '.card[data-id="iceRink"]')!.classList.contains('offseason')).toBe(true);
    expect(q(dock, '.card[data-id="iceRink"] .sb')!.textContent).toContain('Winter');
    const nums = Array.from(dock.shadowRoot!.querySelectorAll<HTMLElement>('.grid .card .num')).filter((n) => !n.hidden).map((n) => n.textContent);
    expect(nums).toEqual(order.slice(0, 9).map((_, i) => String(i + 1)));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    expect(picked).toEqual([order[0]]);
    dock.remove();
  });

  it("the Season chip toggles 'Now' / 'All': All = original catalog order; off-season items stay placeable", () => {
    const { dock, picked } = mount();
    dock.show('buildings'); tab(dock, 'recreation');
    const chip = q(dock, '.chip')!;
    expect(chip.textContent).toContain('Now');
    chip.click();
    expect(q(dock, '.chip')!.textContent).toContain('All');
    expect(ids(dock)).toEqual(buildingsInTab('recreation').map((d) => d.id));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: String(ids(dock).indexOf('beach') + 1), bubbles: true }));
    expect(picked).toEqual(['beach']); // not locked: can be built in advance
    q(dock, '.chip')!.click();
    expect(ids(dock)[0]).toBe('iceRink');
    dock.remove();
  });

  it('hover info of an off-season item says it is not usable until its season', () => {
    const { dock } = mount();
    dock.show('buildings'); tab(dock, 'recreation');
    q(dock, '.card[data-id="beach"]')!.dispatchEvent(new MouseEvent('mouseenter'));
    expect(q(dock, '.info')!.textContent).toMatch(/Mostly used from summer on/);
    q(dock, '.card[data-id="beach"]')!.dispatchEvent(new MouseEvent('mouseleave'));
    dock.remove();
  });

  it('Services tab: parking etc. (all-year) are never dimmed; lifts: bike badge and summer order; pistes: trails first in summer', () => {
    const { dock, set } = mount();
    dock.show('buildings');
    expect(dock.shadowRoot!.querySelectorAll('.card.offseason').length).toBe(0); // Services: all-year (apresBar is winter but not off-season now)
    expect(q(dock, '.card[data-id="parking"]')).toBeNull(); // parking lives in Transport Hubs
    dock.show('lifts');
    expect(dock.shadowRoot!.querySelectorAll('.card .sb.bk').length).toBe(Object.values(LIFTS).filter((l) => l.carriesBikes).length);
    set('summer');
    const lifts = ids(dock);
    const winterOnly = Object.values(LIFTS).filter((l) => !l.carriesBikes).map((l) => l.id).sort();
    expect(lifts.slice(-winterOnly.length).sort()).toEqual(winterOnly);
    expect(q(dock, '.card[data-id="tbar"]')!.classList.contains('offseason')).toBe(true);
    dock.show('pistes');
    expect(ids(dock)).toEqual(['mtb', 'hike', 'ski', 'backcountry']);
    set('winter');
    expect(ids(dock)).toEqual(['ski', 'backcountry', 'mtb', 'hike']);
    dock.remove();
  });
});
