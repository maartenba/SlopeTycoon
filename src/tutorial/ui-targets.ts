import { BUILDING_TABS } from '../ui/buildInfo';
import { DRAWERS } from '../ui/drawerState';

/**
 * Registry mapping LOGICAL tutorial targets to DOM selectors. Components expose stable hooks inside their rendered shadow DOM
 * (`data-drawer`, `data-id`, `data-tab`, `data-tutorial-id`); nothing is set on custom-element hosts (constructors stay attribute-free).
 *
 * Ids:  dock:<drawer>   drawer:tab:<tab>   drawer:item:<id>   topbar:rotate|save   hud:speed|season|guests|rating   panel:pricing|loans|marketing   tool:status
 * A step gives an ordered CHAIN (shallow → deep, e.g. dock:buildings → drawer:tab:services → drawer:item:parking); `resolveChain` highlights
 * the deepest element that is currently visible, so the highlight walks the player through the menus.
 */
const STATIC: Record<string, string[]> = {
  'topbar:rotate': ['[data-tutorial-id="topbar:rotate"]'],
  'topbar:save': ['[data-tutorial-id="topbar:save"]'],
  'tool:status': ['#tool-status'],
  'hud:speed': ['st-speed-control'],
  'hud:season': ['[data-tutorial-id="hud:season"]', 'st-hud'],
  'hud:guests': ['[data-tutorial-id="hud:guests"]', 'st-hud'],
  'hud:rating': ['st-rating', 'st-hud'],
  'panel:pricing': ['st-pricing'],
  'panel:loans': ['st-loans'],
  'panel:marketing': ['st-marketing'],
};

/** Candidate selectors for a logical id, or null when the id is unknown. */
export function selectorsFor(id: string): string[] | null {
  if (STATIC[id]) return STATIC[id]!;
  let m = /^dock:(\w+)$/.exec(id);
  if (m && DRAWERS.some((d) => d.id === m![1])) return [`[data-drawer="${m[1]}"]`];
  m = /^drawer:tab:(\w+)$/.exec(id);
  if (m && BUILDING_TABS.some((t) => t.id === m![1])) return [`[data-tab="${m[1]}"]`];
  m = /^drawer:item:(\w+)$/.exec(id);
  if (m) return [`.card[data-id="${m[1]}"]`];
  return null;
}

export const isKnownTarget = (id: string): boolean => selectorsFor(id) !== null;
export const STATIC_TARGET_IDS: readonly string[] = Object.keys(STATIC);

type Scope = Document | DocumentFragment | Element;

/** querySelector that also looks inside open shadow roots (breadth-first by tree, document order within a scope). */
export function findAllDeep(root: Scope, selector: string, out: Element[] = []): Element[] {
  try { out.push(...Array.from(root.querySelectorAll(selector))); } catch { return out; }
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const sr = (el as Element).shadowRoot;
    if (sr) findAllDeep(sr, selector, out);
  }
  return out;
}

export function isElementVisible(el: Element): boolean {
  const h = el as HTMLElement;
  if (typeof h.checkVisibility === 'function') { try { if (!h.checkVisibility()) return false; } catch { /* old engines */ } }
  if (el.getClientRects().length === 0) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export interface ResolveOpts { root?: Scope; visible?(el: Element): boolean }

/** First visible element for a logical id. */
export function resolveTarget(id: string, o: ResolveOpts = {}): Element | null {
  const sels = selectorsFor(id);
  if (!sels) return null;
  const root = o.root ?? document, vis = o.visible ?? isElementVisible;
  for (const s of sels) for (const el of findAllDeep(root, s)) if (vis(el)) return el;
  return null;
}

/** Deepest visible element of a chain (falls back to shallower entries while menus are closed). */
export function resolveChain(chain: readonly string[], o: ResolveOpts = {}): Element | null {
  for (let i = chain.length - 1; i >= 0; i--) { const el = resolveTarget(chain[i]!, o); if (el) return el; }
  return null;
}
