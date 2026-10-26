// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { registerComponents, el } from '../../src/ui';
import type { DockApi, StDock } from '../../src/ui/components/StDock';
import { OVERLAY_MODES } from '../../src/sim/Coverage';

registerComponents();

function mount() {
  const log: string[] = [];
  let mode = 'raise', ov = 'off', grid = false, tool = 'select';
  const dock = el('st-dock') as StDock;
  const api = {
    funds: () => 1e6, buildings: { locked: () => [], cost: () => 100, multiplier: () => 1, select: () => {} }, lifts: { select: () => {}, costPer100m: () => 1 },
    network: { start: () => {}, setOverride: () => {}, setBrush: () => {} },
    terraform: { setMode: (m: string) => { mode = m; log.push(`mode:${m}`); dock.syncTerraform({ mode: m as never, brush: 3, target: 'tile', maxEdgeDelta: 1 }); }, setTarget: (t: string) => log.push(`target:${t}`), setBrush: (n: number) => log.push(`brush:${n}`), setMaxEdgeDelta: (d: number) => log.push(`slope:${d}`), state: () => ({ mode, brush: 3, target: 'tile', maxEdgeDelta: 1 }) },
    setBulldoze: () => {}, activateTerraform: () => { tool = 'terraform'; log.push('activateTerraform'); dock.syncTool('terraform'); }, resetTool: () => { tool = 'select'; dock.syncTool('select'); },
    view: {
      overlay: () => ov, setOverlay: (m: string) => { ov = m; log.push(`overlay:${m}`); }, toggleGrid: () => { grid = !grid; log.push('grid'); }, gridOn: () => grid, setSeason: (t: number) => log.push(`season:${t}`),
      photo: () => log.push('photo'), walk: () => log.push('walk'), ride: () => log.push('ride'), rotate: (d: number) => log.push(`rot:${d}`), zoom: (f: number) => log.push(`zoom:${f}`),
    },
    autoFlatten: { get: () => true, set: () => {} }, thumb: () => null,
  } as unknown as DockApi;
  document.body.append(dock);
  dock.bind(api);
  void tool;
  return { dock, log };
}
const root = (d: StDock) => d.shadowRoot!;
const cards = (d: StDock) => Array.from(root(d).querySelectorAll<HTMLButtonElement>('.body .card'));
const card = (d: StDock, name: string) => cards(d).find((c) => c.querySelector('.nm')?.textContent === name)!;
afterEach(() => { document.body.innerHTML = ''; });

describe('Terrain drawer cards', () => {
  it('shows Raise / Lower / Flatten / Smooth cards with icon, key badge, cost hint and the selected state', () => {
    const { dock, log } = mount();
    dock.show('terrain');
    expect(log).toContain('activateTerraform');
    expect(cards(dock).map((c) => c.querySelector('.nm')?.textContent)).toEqual(['Raise', 'Lower', 'Flatten', 'Smooth']);
    expect(card(dock, 'Raise').querySelector('.num')?.textContent).toBe('1');
    expect(card(dock, 'Smooth').querySelector('.num')?.textContent).toBe('4');
    expect(card(dock, 'Raise').querySelector('.pr')?.textContent).toMatch(/\$\d+\/step/);
    expect(card(dock, 'Raise').querySelector('.thumb svg')).toBeTruthy();
    expect(card(dock, 'Raise').classList.contains('active')).toBe(true);
    expect(root(dock).querySelector('.gh')?.textContent).toBe('Sculpt');
    card(dock, 'Flatten').click();
    expect(log).toContain('mode:flatten');
    expect(card(dock, 'Flatten').classList.contains('active')).toBe(true);
    expect(card(dock, 'Raise').classList.contains('active')).toBe(false);
    dock.remove();
  });

  it('hover card describes the mode with hotkey, cost and brush; side column has target / brush / slope + live ghost', () => {
    const { dock, log } = mount();
    dock.show('terrain');
    card(dock, 'Lower').dispatchEvent(new Event('mouseenter'));
    const info = root(dock).querySelector('.info')!;
    expect(info.hasAttribute('hidden')).toBe(false);
    expect(info.textContent).toMatch(/Dig the ground down/); expect(info.textContent).toMatch(/Hotkey/); expect(info.textContent).toMatch(/Brush/); expect(info.textContent).toMatch(/\$\d+\/half-step/);
    const side = root(dock).querySelector('.pc')!;
    expect(side.querySelectorAll('st-select').length).toBe(3);
    dock.syncTerraGhost({ text: 'Cost $40', blocked: false, tiles: 9 });
    expect(side.querySelector('[data-terra-ghost]')?.textContent).toBe('Cost $40 · 9 tiles');
    dock.syncTerraGhost({ text: 'Blocked: water', blocked: true, tiles: 1 });
    expect(side.querySelector('[data-terra-ghost]')?.classList.contains('bad')).toBe(true);
    void log;
    dock.remove();
  });
});

describe('View drawer cards', () => {
  it('groups Camera / Modes / Overlays / Season and keeps every overlay, with hotkey badges', () => {
    const { dock } = mount();
    dock.show('view');
    expect(Array.from(root(dock).querySelectorAll('.gh')).map((g) => g.textContent)).toEqual(['Camera', 'Modes', 'Overlays', 'Season']);
    const names = cards(dock).map((c) => c.querySelector('.nm')?.textContent);
    for (const n of ['Rotate left', 'Rotate right', 'Zoom in', 'Zoom out', 'Tile grid', 'Ride-along', 'Walk mode', 'Photo mode', 'No overlay', 'Snow depth', 'Piste difficulty', 'Winter', 'Summer']) expect(names, n).toContain(n);
    expect(cards(dock).filter((c) => (c.dataset.id ?? '').startsWith('ov:')).length).toBe(OVERLAY_MODES.length);
    expect(card(dock, 'Walk mode').querySelector('.num')?.textContent).toBe('V');
    expect(card(dock, 'Photo mode').querySelector('.num')?.textContent).toBe('P');
    expect(card(dock, 'Tile grid').querySelector('.num')?.textContent).toBe('G');
    expect(card(dock, 'Rotate left').querySelector('.num')?.textContent).toBe('Q');
    dock.remove();
  });

  it('runs actions and highlights the active overlay and grid', () => {
    const { dock, log } = mount();
    dock.show('view');
    expect(card(dock, 'No overlay').classList.contains('active')).toBe(true);
    card(dock, 'Snow depth').click();
    expect(log).toContain('overlay:snow');
    expect(card(dock, 'Snow depth').classList.contains('active')).toBe(true);
    expect(card(dock, 'No overlay').classList.contains('active')).toBe(false);
    card(dock, 'Tile grid').click();
    expect(log).toContain('grid'); expect(card(dock, 'Tile grid').classList.contains('active')).toBe(true);
    for (const [n, l] of [['Photo mode', 'photo'], ['Walk mode', 'walk'], ['Ride-along', 'ride'], ['Rotate right', 'rot:1'], ['Zoom in', 'zoom:1.25']] as const) { card(dock, n).click(); expect(log).toContain(l); }
    card(dock, 'Winter').click();
    expect(log.some((l) => l.startsWith('season:'))).toBe(true);
    dock.remove();
  });

  it('hover card shows description and hotkey', () => {
    const { dock } = mount();
    dock.show('view');
    card(dock, 'Photo mode').dispatchEvent(new Event('mouseenter'));
    const t = root(dock).querySelector('.info')!.textContent ?? '';
    expect(t).toMatch(/PNG/); expect(t).toMatch(/Hotkey/);
    dock.remove();
  });
});
