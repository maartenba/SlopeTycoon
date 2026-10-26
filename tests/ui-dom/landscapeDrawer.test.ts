// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { registerComponents, el } from '../../src/ui';
import type { DockApi, StDock } from '../../src/ui/components/StDock';
import type { LandscapeMode, LandscapeState } from '../../src/build/LandscapeTool';
import { DRAWERS } from '../../src/ui/drawerState';
import { DECOR_IDS } from '../../src/config/landscape';

registerComponents();

function mount(opts: { locked?: string | null } = {}) {
  const log: string[] = [];
  let st: LandscapeState = { mode: 'pond', brush: 2, pondSize: 5, decor: 'bench', rot: 0 };
  const dock = el('st-dock') as StDock;
  const api = {
    funds: () => 1e6, buildings: { locked: () => [], cost: () => 100, multiplier: () => 1, select: () => {} }, lifts: { select: () => {}, costPer100m: () => 1 },
    network: { start: () => {}, setOverride: () => {}, setBrush: () => {} },
    terraform: { setMode: (m: string) => log.push(`terraform:${m}`), setTarget: () => {}, setBrush: () => {}, setMaxEdgeDelta: () => {}, state: () => ({ mode: 'raise', brush: 1, target: 'tile' }) },
    nature: { setMode: (m: string) => log.push(`plant:${m}`), setGroup: () => {}, setBrush: () => {}, setDensity: () => {}, state: () => ({ mode: 'plant', group: 'conifer', brush: 2, density: 0.6 }), groups: [{ id: 'conifer', label: 'Conifer mix' }] },
    landscape: {
      activate: (m?: LandscapeMode) => { if (m) st = { ...st, mode: m }; log.push(`landscape:${m ?? '-'}`); dock.syncTool('landscape'); },
      setMode: (m: LandscapeMode) => { st = { ...st, mode: m }; log.push(`mode:${m}`); },
      setDecor: (k: never) => { st = { ...st, mode: 'decor', decor: k }; log.push(`decor:${k}`); dock.syncTool('landscape'); },
      setBrush: (n: number) => { st = { ...st, pondSize: n }; log.push(`size:${n}`); }, setRot: (r: 0 | 1) => { st = { ...st, rot: r }; },
      state: () => st, pondLocked: () => opts.locked ?? null, multiplier: () => 1,
    },
    setBulldoze: () => {}, activateTerraform: () => { log.push('activateTerraform'); dock.syncTool('terraform'); }, resetTool: () => { dock.syncTool('select'); },
    view: { overlay: () => 'off', setOverlay: () => {}, toggleGrid: () => {}, setSeason: () => {} }, autoFlatten: { get: () => true, set: () => {} }, thumb: () => null,
  } as unknown as DockApi;
  document.body.append(dock);
  dock.bind(api);
  return { dock, log };
}
const root = (d: StDock) => d.shadowRoot!;
const buttons = (d: StDock) => Array.from(root(d).querySelectorAll<HTMLButtonElement>('.body button'));
const cards = (d: StDock) => Array.from(root(d).querySelectorAll<HTMLButtonElement>('.body .card'));
const card = (d: StDock, name: string) => cards(d).find((c) => c.querySelector('.nm')?.textContent === name)!;
const tab = (d: StDock, id: string) => root(d).querySelector<HTMLButtonElement>(`.tabs button[data-tab="${id}"]`)!;

describe('Landscape drawer', () => {
  it('is registered between Terrain and Bulldoze', () => {
    const ids = DRAWERS.map((d) => d.id), i = ids.indexOf('landscape');
    expect(i).toBeGreaterThan(ids.indexOf('terrain')); expect(i).toBeLessThan(ids.indexOf('bulldoze'));
  });

  it('opens on the Water tab, activates the pond tool, shows pond + fill buttons and the rules', () => {
    const { dock, log } = mount();
    dock.show('landscape');
    expect(dock.openDrawer).toBe('landscape');
    expect(log).toContain('landscape:pond');
    const text = root(dock).textContent ?? '';
    expect(text).toContain('Dig pond'); expect(text).toContain('Fill in');
    expect(cards(dock).map((c) => c.querySelector('.nm')?.textContent)).toEqual(['Dig pond', 'Fill in']);
    expect(card(dock, 'Dig pond').classList.contains('active')).toBe(true); // selected state = the shared card state
    expect(card(dock, 'Dig pond').querySelector('.num')?.textContent).toBe('1'); // key badge
    expect(card(dock, 'Dig pond').querySelector('.pr')?.textContent).toMatch(/\$\d+\/tile/);
    expect(Array.from(root(dock).querySelectorAll('.tabs button')).map((b) => b.getAttribute('data-tab'))).toEqual(['water', 'nature', 'decor']);
    dock.remove();
  });

  it('shows the career lock on the pond button', () => {
    const { dock } = mount({ locked: 'Unlocks at level 2: Local favourite' });
    dock.show('landscape');
    const b = card(dock, 'Dig pond');
    expect(b.textContent).toContain('🔒'); expect(b.title).toMatch(/level 2/); expect(b.classList.contains('locked')).toBe(true);
    dock.remove();
  });

  it('there is no Terrain tab here (the Terrain drawer owns terraforming); Nature tab has trees + boulders; Decor tab lists every piece', () => {
    const { dock, log } = mount();
    dock.show('landscape');
    expect(root(dock).querySelector('.tabs button[data-tab="terrain"]')).toBeNull();
    expect(root(dock).querySelectorAll('button[data-drawer="terrain"]').length).toBe(1);
    tab(dock, 'nature').click();
    const nat = (root(dock).textContent ?? '');
    expect(nat).toContain('Plant trees'); expect(nat).toContain('Boulders');
    card(dock, 'Boulders').click();
    expect(log).toContain('landscape:rock');
    tab(dock, 'decor').click();
    const names = cards(dock).map((b) => b.textContent ?? '');
    expect(names.filter((n) => /\$\d+/.test(n))).toHaveLength(DECOR_IDS.length);
    card(dock, 'Fountain').click();
    expect(log).toContain('decor:fountain');
    dock.remove();
  });

  it('uses the shared card grid and controls of the other drawers (no one-off layout)', () => {
    const { dock } = mount();
    dock.show('landscape');
    for (const t of ['water', 'nature', 'decor']) {
      tab(dock, t).click();
      expect(root(dock).querySelector('.body .rail .grid')).not.toBeNull();
      expect(cards(dock).length).toBeGreaterThan(1);
      expect(root(dock).querySelector('.body .pane')).toBeNull();
      expect(root(dock).querySelector('.body .pc')).not.toBeNull();
    }
    expect(buttons(dock).filter((b) => !b.classList.contains('card') && !b.closest('.pc') && !b.closest('.fade')).length).toBe(0);
    dock.remove();
  });

  it('closing the drawer returns to the select tool and reopening works (tab state kept)', () => {
    const { dock } = mount();
    dock.show('landscape'); tab(dock, 'decor').click();
    root(dock).querySelector<HTMLButtonElement>('button[data-drawer="landscape"]')!.click(); // the dock button toggles it closed
    expect(dock.openDrawer).toBeNull();
    root(dock).querySelector<HTMLButtonElement>('button[data-drawer="landscape"]')!.click();
    expect(dock.openDrawer).toBe('landscape');
    expect(root(dock).querySelector('.tabs button.active')?.getAttribute('data-tab')).toBe('decor');
    dock.remove();
  });
});
