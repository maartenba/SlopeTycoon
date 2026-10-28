// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { registerComponents, el } from '../../src/ui';
import type { DockApi, StDock } from '../../src/ui/components/StDock';
import { networkInfo, NETWORK_ITEMS } from '../../src/ui/buildInfo';

registerComponents();

/** The redesigned bridge UX (docs/bridges.md): no bridge select / 'Build bridge' button, a compact 'Cross rails' segmented control + a hint and price legend. */
function mount(): { dock: StDock; modes: string[]; legacy: boolean[] } {
  const modes: string[] = [], legacy: boolean[] = [];
  const dock = el('st-dock') as StDock;
  const api = {
    funds: () => 1e6, buildings: { locked: () => [], cost: () => 100, multiplier: () => 1, select: () => {} }, lifts: { select: () => {}, costPer100m: () => 1 },
    network: { start: () => {}, setOverride: () => {}, setBrush: () => {}, setCrossMode: (m: string) => modes.push(m), setOverRail: (on: boolean) => legacy.push(on) },
    terraform: { setMode: () => {}, setTarget: () => {}, setBrush: () => {}, setMaxEdgeDelta: () => {}, state: () => ({ mode: 'raise', brush: 1, target: 'tile' }) },
    setBulldoze: () => {}, activateTerraform: () => {}, resetTool: () => {}, view: { overlay: () => 'off', setOverlay: () => {}, toggleGrid: () => {}, setSeason: () => {} },
    autoFlatten: { get: () => true, set: () => {} }, thumb: () => null,
  } as unknown as DockApi;
  document.body.append(dock);
  dock.bind(api);
  return { dock, modes, legacy };
}
const q = (d: StDock, sel: string): HTMLElement | null => d.shadowRoot!.querySelector<HTMLElement>(sel);
const all = (d: StDock, sel: string): HTMLElement[] => [...d.shadowRoot!.querySelectorAll<HTMLElement>(sel)];
afterEach(() => { document.body.replaceChildren(); });

describe('Paths & Roads drawer: bridges are part of drawing, not a mode', () => {
  it('has no bridge select and no Build bridge button; has the Cross rails radio group (level crossing default) and the hint line', () => {
    const { dock, modes } = mount();
    dock.show('paths');
    expect(q(dock, '[data-bridge]')).toBeNull();
    expect(all(dock, 'button').map((b) => b.textContent).join('|')).not.toContain('Build bridge');
    expect(q(dock, 'st-select')).toBeNull();
    const group = q(dock, '[role=radiogroup][data-cross]')!;
    expect(group.getAttribute('aria-label')).toBe('Cross rails');
    const [lvl, brg] = [...group.querySelectorAll<HTMLButtonElement>('button')];
    expect(lvl!.getAttribute('aria-checked')).toBe('true'); expect(brg!.getAttribute('aria-checked')).toBe('false');
    expect(lvl!.textContent).toContain('Level crossing'); expect(lvl!.textContent).toContain('$150'); // two-line label with the price
    expect(brg!.textContent).toContain('Bridge'); expect(brg!.textContent).toContain('$900');
    expect(q(dock, '[data-bridge-hint]')!.textContent).toBe('Drag across water or rails to build a bridge. Roads always use a level crossing; rail cannot cross water.');
    expect(q(dock, '[data-bridge-list]')!.textContent).toContain('Footpath: Footbridge');
    expect(q(dock, '[data-bridge-list]')!.textContent).toContain('$600/tile, max 3');
    expect(modes).toEqual(['level']);
    dock.remove();
  });
  it('clicking Bridge selects it (radio semantics), tells the tools, and survives re-opening the drawer; Level crossing flips it back', () => {
    const { dock, modes } = mount();
    dock.show('paths');
    const btn = (m: string): HTMLButtonElement => q(dock, `[data-cross-mode=${m}]`) as HTMLButtonElement;
    btn('bridge').click();
    expect(modes.at(-1)).toBe('bridge');
    expect(btn('bridge').getAttribute('aria-checked')).toBe('true'); expect(btn('level').getAttribute('aria-checked')).toBe('false');
    expect(btn('bridge').classList.contains('active')).toBe(true);
    dock.show('pistes');
    expect(modes.at(-1)).toBe('bridge'); // the choice is shared with the trail drawer
    expect(q(dock, '[data-cross-mode=bridge]')!.getAttribute('aria-checked')).toBe('true');
    q(dock, '[data-cross-mode=level]')!.click();
    expect(modes.at(-1)).toBe('level');
    dock.remove();
  });
  it('keyboard: arrow keys move the selection; only the selected radio is in the tab order; controls are 44 px tall', () => {
    const { dock, modes } = mount();
    dock.show('paths');
    const group = q(dock, '[data-cross]')!;
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(modes.at(-1)).toBe('bridge');
    expect((q(dock, '[data-cross-mode=level]') as HTMLButtonElement).tabIndex).toBe(-1);
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(modes.at(-1)).toBe('level');
    const css = readFileSync('src/ui/components/StDock.ts', 'utf8'); // the sheet is adopted (happy-dom exposes no <style>): assert the shipped rule text
    expect(css).toMatch(/\.pc \.seg button\{[^}]*min-height:max\(44px/);
    expect(css).toMatch(/\.pc \.seg button\{[^}]*white-space:normal/); // labels wrap, never clip
    dock.remove();
  });
});

describe('Pistes & Trails drawer', () => {
  it('has the same control for trails with the trail prices and a hint for ponds', () => {
    const { dock } = mount();
    dock.show('pistes');
    const group = q(dock, '[data-cross]')!;
    expect(group.getAttribute('aria-label')).toBe('Trails over rails');
    expect(group.textContent).toContain('MTB $1,100');
    expect(q(dock, '[data-bridge-hint]')!.textContent).toBe('Drag a trail across a pond or rails to build a bridge: hiking $120/tile, MTB $140/tile, max 4. Ski pistes cannot cross water.');
    expect(q(dock, '[data-bridge]')).toBeNull();
    dock.remove();
  });
});

describe('card info names the matching bridge', () => {
  it('each kind lists its bridge type and price, rails say crossing / bridge', () => {
    const by = (k: string) => networkInfo(NETWORK_ITEMS.find((i) => i.key === k)!, 10);
    expect(by('path').stats).toContainEqual(['Over water', 'Footbridge $150/tile, max 4']);
    expect(by('road').stats).toContainEqual(['Over water', 'Road bridge $600/tile, max 3']);
    expect(by('hike').stats).toContainEqual(['Over water', 'Wooden hiking bridge $120/tile, max 4']);
    expect(by('mtb').stats).toContainEqual(['Over water', 'MTB bridge $140/tile, max 4']);
    expect(by('rail').stats.map((s) => s[0])).not.toContain('Over water');
    expect(by('road').rules.join()).toContain('level crossing');
    expect(by('path').rules.join()).toContain('level crossing or bridge');
  });
});
