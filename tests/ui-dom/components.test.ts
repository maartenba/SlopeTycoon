// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_COMPONENT_TAGS, COMPONENTS, el, registerComponents, type StTagMap } from '../../src/ui';

registerComponents();

describe('custom elements (DOM level)', () => {
  it('ALL_COMPONENT_TAGS matches every customElements.define / st-* class in src/ui/components', () => {
    const files = readdirSync('src/ui/components').filter((f) => /^St[A-Za-z]+\.ts$/.test(f) && f !== 'StElement.ts');
    expect(Object.keys(COMPONENTS).length).toBe(files.length);
    for (const f of files) expect(Object.values(COMPONENTS).some((c) => c.name === f.replace('.ts', '')), f).toBe(true);
    // Every `<st-...>` created in main.ts is registered.
    const main = readFileSync('src/main.ts', 'utf8');
    for (const m of main.matchAll(/el\('(st-[a-z-]+)'\)|createElement\('(st-[a-z-]+)'\)/g)) expect(ALL_COMPONENT_TAGS as string[]).toContain(m[1] ?? m[2]);
    for (const tag of ALL_COMPONENT_TAGS) expect(customElements.get(tag), tag).toBeDefined();
  });

  for (const tag of ALL_COMPONENT_TAGS) {
    it(`${tag}: createElement does not throw and adds no attributes/children`, () => {
      let e: HTMLElement | undefined;
      expect(() => { e = document.createElement(tag); }).not.toThrow();
      expect(e!.attributes.length, 'attributes').toBe(0);
      expect(e!.childNodes.length, 'children').toBe(0);
      expect(e instanceof COMPONENTS[tag]).toBe(true);
    });
    it(`${tag}: connect / disconnect do not throw`, () => {
      const e = el(tag);
      expect(() => document.body.append(e)).not.toThrow();
      expect(() => e.remove()).not.toThrow();
      expect(() => { document.body.append(e); e.remove(); }).not.toThrow(); // re-connect is idempotent
    });
  }

  it('guest inspector is hidden once connected and toggles with show()', () => {
    const g = el('st-guest-inspector');
    document.body.append(g);
    expect(g.hidden).toBe(true);
    g.show(null);
    expect(g.hidden).toBe(true);
    g.remove();
  });
});

/** API main.ts calls on each component. Typed: a rename/removal is a compile error, and the runtime check catches non-upgraded elements. */
function api<K extends keyof StTagMap>(tag: K, ...methods: Array<keyof StTagMap[K] & string>): [K, string[]] { return [tag, methods]; }
const MAIN_API = [
  api('st-guest-inspector', 'bind', 'show'),
  api('st-view-hud', 'bind', 'render'),
  api('st-news', 'bind'),
  api('st-help', 'toggle', 'bindTutorial'),
  api('st-assistant', 'bind', 'render', 'hint'),
  api('st-spotlight', 'bind', 'setTarget'),
  api('st-settings', 'bind', 'toggle'),
  api('st-inspector', 'bind', 'bindOps', 'bindAttraction'),
  api('st-dock', 'refresh', 'refreshThumbs', 'setAutoFlatten', 'syncTool', 'show'),
  api('st-hud', 'bindFinance'),
  api('st-goals', 'bind', 'suppress'),
  api('st-toast', 'show', 'mutedCategories', 'setMuted'),
];

describe('main.ts component API', () => {
  for (const [tag, methods] of MAIN_API) {
    it(`${tag} exposes ${methods.join(', ')}`, () => {
      const e = document.createElement(tag) as unknown as Record<string, unknown>;
      for (const m of methods) expect(typeof e[m], `${tag}.${m}`).toBe('function');
    });
  }
});
