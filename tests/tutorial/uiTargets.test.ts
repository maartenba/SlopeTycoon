// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DRAWERS } from '../../src/ui/drawerState';
import { BUILDING_TABS } from '../../src/ui/buildInfo';
import { registerComponents, el } from '../../src/ui';
import type { DockApi } from '../../src/ui/components/StDock';
import { STEPS } from '../../src/tutorial/steps';
import { STATIC_TARGET_IDS, findAllDeep, isKnownTarget, resolveChain, resolveTarget, selectorsFor } from '../../src/tutorial/ui-targets';
import { makeEngine, tutorialSim } from './helpers';

registerComponents();
const always = (): boolean => true;

describe('UI target registry', () => {
  it('knows every dock category, building tab and static id; rejects unknown ones', () => {
    for (const d of DRAWERS) expect(isKnownTarget(`dock:${d.id}`)).toBe(true);
    for (const t of BUILDING_TABS) expect(isKnownTarget(`drawer:tab:${t.id}`)).toBe(true);
    for (const id of STATIC_TARGET_IDS) expect(isKnownTarget(id)).toBe(true);
    expect(isKnownTarget('dock:nope')).toBe(false);
    expect(isKnownTarget('drawer:tab:nope')).toBe(false);
    expect(selectorsFor('what')).toBeNull();
  });

  it('every ui chain used by a lesson (static and from show me on the scenario) names known targets', () => {
    const sim = tutorialSim();
    const eng = makeEngine(sim);
    eng.start({ fresh: true });
    for (const s of STEPS) {
      for (const u of s.ui) expect(isKnownTarget(u), `${s.id}: ${u}`).toBe(true);
      const r = s.showMe({ sim, q: eng.q, sink: () => {}, host: {}, notify: () => {} });
      for (const u of r.ui) expect(isKnownTarget(u), `${s.id} show: ${u}`).toBe(true);
    }
  });

  it('finds elements inside nested shadow roots and picks the deepest visible chain entry', () => {
    class Outer extends HTMLElement { constructor() { super(); const r = this.attachShadow({ mode: 'open' }); const b = document.createElement('button'); b.dataset.drawer = 'buildings'; r.append(b); const c = document.createElement('div'); c.className = 'card'; c.dataset.id = 'parking'; r.append(c); } }
    if (!customElements.get('t-outer')) customElements.define('t-outer', Outer);
    const host = document.createElement('t-outer');
    document.body.append(host);
    expect(findAllDeep(document, '[data-drawer="buildings"]').length).toBe(1);
    expect(resolveTarget('dock:buildings', { visible: always })?.getAttribute('data-drawer')).toBe('buildings');
    expect(resolveChain(['dock:buildings', 'drawer:item:parking'], { visible: always })?.className).toBe('card');
    expect(resolveChain(['dock:buildings', 'drawer:item:nothing'], { visible: always })?.getAttribute('data-drawer')).toBe('buildings'); // falls back to the shallower entry
    expect(resolveChain(['dock:buildings'], { visible: () => false })).toBeNull();
    host.remove();
  });

  it('the real dock exposes the hooks: dock buttons, building tabs and cards', () => {
    const dock = el('st-dock');
    const api = {
      funds: () => 1e6, buildings: { locked: () => [], cost: () => 100, multiplier: () => 1, select: () => {} }, lifts: { select: () => {}, costPer100m: () => 1 },
      network: { start: () => {}, setOverride: () => {}, setBrush: () => {} }, terraform: { setMode: () => {}, setTarget: () => {}, setBrush: () => {}, setMaxEdgeDelta: () => {}, state: () => ({ mode: 'raise', brush: 1, target: 'tile' }) },
      setBulldoze: () => {}, activateTerraform: () => {}, resetTool: () => {}, view: { overlay: () => 'off', setOverlay: () => {}, toggleGrid: () => {}, setSeason: () => {} },
      autoFlatten: { get: () => true, set: () => {} }, thumb: () => null,
    } as unknown as DockApi;
    document.body.append(dock);
    dock.bind(api);
    for (const d of DRAWERS) expect(resolveTarget(`dock:${d.id}`, { visible: always }), d.id).not.toBeNull();
    expect(resolveTarget('drawer:item:parking', { visible: always })).toBeNull(); // drawer closed
    dock.show('buildings');
    for (const t of BUILDING_TABS) expect(resolveTarget(`drawer:tab:${t.id}`, { visible: always }), t.id).not.toBeNull();
    // 'parking' lives in the Transport tab: the chain walks dock -> tab -> card
    const chain = ['dock:buildings', 'drawer:tab:transport', 'drawer:item:parking'];
    const step1 = resolveChain(chain, { visible: always }) as HTMLElement; // the Services tab is open: the highlight points at the Transport tab
    expect(step1.getAttribute('data-tab')).toBe('transport');
    step1.click();
    expect(resolveChain(chain, { visible: always })?.className).toContain('card'); // ...then at the card itself
    expect(resolveChain(['dock:buildings', 'drawer:tab:kids', 'drawer:item:skiSchoolHQ'], { visible: always })?.getAttribute('data-tab')).toBe('kids');
    dock.show('lifts');
    expect(resolveChain(['dock:lifts', 'drawer:item:chair4'], { visible: always })?.className).toContain('card');
    dock.remove();
  });

  it('top bar / HUD hooks live in rendered shadow content (not on the hosts)', () => {
    const hud = el('st-hud');
    expect(hud.attributes.length).toBe(0);
    document.body.append(hud);
    expect(resolveTarget('hud:guests', { visible: always })).not.toBeNull();
    expect(resolveTarget('hud:season', { visible: always })).not.toBeNull();
    hud.remove();
  });
});
